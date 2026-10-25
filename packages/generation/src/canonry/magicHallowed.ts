import type { GenerationState } from "../process";
import type { PhysicalField } from "./field";
import type { MagicField, MagicWorkspace } from "./magicState";
import type { LocateContext } from "./magicSources";
import { nativeIndexAtSurface } from "./atlasWorkspace";
import { clamp, rockResistance, round } from "./math";

const wards = (field: MagicField) =>
  field.definition.enabled && field.definition.effects.warding > 0;

/**
 * Hallowed's seats: every inhabited seat with person-years on its cell is a source, by the
 * tenure per area, stronger by a bonus for every way that converges on it (the pilgrimage).
 * The ring it wards reaches in proportion to its strength.
 */
export function tenureSources(
  state: GenerationState,
  field: MagicField,
  _seed: number,
  { origin }: LocateContext
) {
  const society = state.society;
  if (!society) return;
  const map = state.physical!.map,
    p = field.definition.parameters,
    ways = new Map<string, number>();
  for (const link of society.region.connections) {
    ways.set(link.from, (ways.get(link.from) ?? 0) + 1);
    ways.set(link.to, (ways.get(link.to) ?? 0) + 1);
  }
  for (const c of society.region.communities) {
    if (c.status !== "inhabited") continue;
    const cell = nativeIndexAtSurface(state, c.position.x, c.position.y);
    if (cell < 0 || map.Tenure[cell] <= 0) continue;
    const tenure = map.Tenure[cell] / map.mesh.areas[cell] / p.tenureFull,
      strength = clamp(
        round(1000 * tenure * (1 + p.pilgrimageBonus * (ways.get(c.id) ?? 0))),
        1,
        1000
      );
    field.source[cell] = Math.max(field.source[cell], strength);
    field.located.push({
      origin: origin.id,
      id: `seat:${c.id}`,
      x: map.mesh.x[cell],
      y: map.mesh.y[cell],
      radius: (p.wardReach * strength) / 1000,
      strength,
    });
  }
}
/** Hallowed's lines: kept-years where people keep a frontier or a work, and the roads pilgrims wear. */
export function keptLineSources(state: GenerationState, field: MagicField) {
  const map = state.physical!.map,
    p = field.definition.parameters;
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes[i] !== 0) continue;
    const area = map.mesh.areas[i],
      kept = map.KeptLine[i] / area / p.lineFull,
      road = map.WalkedRoute[i] / area / p.roadFull,
      strength = clamp(round(1000 * Math.max(kept, road)), 0, 1000);
    if (strength >= 1) field.source[i] = strength;
  }
}
/**
 * The ward: a ring around each located seat falling to nothing at its reach, lines where
 * their sources lie; Aurora's stored charge adds where the two meet, and an open Fire
 * conduit breaks the ward at its cell.
 */
export function wardPropagation(state: GenerationState, field: MagicField) {
  const map = state.physical!.map,
    magic = state.physical!.magic!,
    p = field.definition.parameters;
  for (let i = 0; i < map.mesh.count; i++) field.intensity[i] = field.source[i];
  for (const seat of field.located)
    for (let i = 0; i < map.mesh.count; i++) {
      const distance = Math.hypot(map.mesh.x[i] - seat.x, map.mesh.y[i] - seat.y);
      field.intensity[i] = Math.max(
        field.intensity[i],
        seat.strength * Math.max(0, 1 - distance / Math.max(1, seat.radius))
      );
    }
  const others = magic.fields.filter((other) => other !== field && other.definition.enabled),
    stills = others.find((other) => other.definition.effects.stillness > 0),
    fire = others.find((other) => other.definition.effects.conduitOpening > 0);
  for (let i = 0; i < map.mesh.count; i++) {
    if (field.intensity[i] <= 0) continue;
    if (stills) field.intensity[i] += p.auroraReinforce * stills.stored[i];
    if (fire && fire.source[i] > 0) field.intensity[i] = 0;
    field.intensity[i] = Math.min(1000, field.intensity[i]);
  }
}
/**
 * Warding, applied once at the end of every other system's propagation: inside a ring the
 * intensity is scaled down by the warding, and what was removed, by area, lands on the rim
 * cells, so the ground just outside a sanctuary is the most dangerous in the world.
 */
export function applyWarding(state: GenerationState, field: MagicField) {
  const map = state.physical!.map,
    magic = state.physical!.magic;
  if (!magic || wards(field) || !magic.fields.some(wards)) return;
  const displaced = removeInside(map, field);
  if (displaced > 0) landOnRim(map, magic, field, displaced);
}
/** Scale the field down inside the warding; return the amount removed, as intensity times area. */
function removeInside(map: PhysicalField, field: MagicField) {
  let displaced = 0;
  for (let i = 0; i < map.mesh.count; i++) {
    const w = map.Warding[i];
    if (w <= 0) continue;
    const removed = field.intensity[i] * w;
    field.intensity[i] = round(field.intensity[i] - removed);
    displaced += removed * map.mesh.areas[i];
  }
  return displaced;
}
/** Lay an amount of intensity times area on the rim cells, by their area. */
function landOnRim(
  map: PhysicalField,
  magic: MagicWorkspace,
  field: MagicField,
  displaced: number
) {
  let rimArea = 0;
  for (let i = 0; i < map.mesh.count; i++) if (magic.wardRim[i]) rimArea += map.mesh.areas[i];
  if (rimArea <= 0) return;
  const added = displaced / rimArea;
  for (let i = 0; i < map.mesh.count; i++)
    if (magic.wardRim[i]) field.intensity[i] = clamp(round(field.intensity[i] + added), 0, 1000);
}
/** The rim: cells with no warding that touch a cell with any. */
export function markRim(map: PhysicalField, magic: MagicWorkspace) {
  magic.wardRim.fill(0);
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.Warding[i] > 0) continue;
    for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
      const j = map.mesh.neighbors[i * map.mesh.stride + edge];
      if (j >= 0 && map.Warding[j] > 0) {
        magic.wardRim[i] = 1;
        break;
      }
    }
  }
}
/**
 * What the ward holds back is not destroyed. The storm energy on the tracks inside lands on
 * the rim's storm forcing, and where a channel leaves the ring the first reach below loses
 * the resistance the ring gained, so the sediment held back cuts there.
 */
export function hallowedWrites(state: GenerationState) {
  const map = state.physical!.map,
    magic = state.physical!.magic!,
    fields = magic.fields.filter(wards);
  if (!fields.length) return;
  let storm = 0,
    rimArea = 0;
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.Warding[i] > 0) storm += map.StormTrack[i] * map.Warding[i] * map.mesh.areas[i];
    else if (magic.wardRim[i]) rimArea += map.mesh.areas[i];
  }
  if (storm > 0 && rimArea > 0)
    for (let i = 0; i < map.mesh.count; i++)
      if (magic.wardRim[i])
        map.StormForcing[i] = clamp(round(map.StormForcing[i] + storm / rimArea), 0, 1000);
  for (const field of fields) spillBelow(map, field);
}
function spillBelow(map: PhysicalField, field: MagicField) {
  const spill = field.definition.parameters.wardSpill;
  for (let i = 0; i < map.mesh.count; i++) {
    const w = map.Warding[i],
      target = map.FlowTargets[i];
    if (w <= 0 || target < 0 || map.Warding[target] > 0 || map.WaterKindCodes[target] !== 0)
      continue;
    map.RockResistance[target] = rockResistance(map.RockResistance[target] - round(spill * w));
  }
}
/**
 * Coasts hold inside a ward: the external forcing on a warded shore moves to the shore
 * downdrift of it, along the current of the sea beside it, as past a terminal groyne.
 */
export function wardCoasts(map: PhysicalField, magic: MagicWorkspace, totals: Float64Array) {
  if (!magic.fields.some(wards)) return;
  const moved = new Float64Array(map.mesh.count);
  for (let i = 0; i < map.mesh.count; i++) {
    const w = map.Warding[i];
    if (w <= 0 || map.WaterKindCodes[i] !== 0 || totals[i] <= 0) continue;
    const taken = round(totals[i] * w);
    totals[i] -= taken;
    const target = downdrift(map, i);
    if (target >= 0) moved[target] += taken;
  }
  for (let i = 0; i < map.mesh.count; i++)
    if (moved[i] > 0) totals[i] = clamp(totals[i] + round(moved[i]), 0, 1000);
}
/** The land neighbour that lies along the strongest current of the sea beside a shore cell. */
function downdrift(map: PhysicalField, i: number) {
  let dx = 0,
    dy = 0,
    strength = 0;
  for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
    const j = map.mesh.neighbors[i * map.mesh.stride + edge];
    if (j < 0 || map.WaterKindCodes[j] !== 1 || map.OceanCurrentStrength[j] <= strength) continue;
    [dx, dy, strength] = [map.OceanCurrentX[j], map.OceanCurrentY[j], map.OceanCurrentStrength[j]];
  }
  if (strength <= 0) return -1;
  let best = -1,
    score = 0;
  for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
    const offset = i * map.mesh.stride + edge,
      j = map.mesh.neighbors[offset];
    if (j < 0 || map.WaterKindCodes[j] !== 0) continue;
    const alignment = map.mesh.edgeX[offset] * dx + map.mesh.edgeY[offset] * dy;
    if (alignment > score) [best, score] = [j, alignment];
  }
  return best;
}
