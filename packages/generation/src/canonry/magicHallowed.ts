import type { GenerationState } from "../process";
import type { PhysicalField } from "./field";
import type { MagicField, MagicWorkspace } from "./magicState";
import type { LocateContext } from "./magicSources";
import { nativeIndexAtSurface } from "./atlasWorkspace";
import { siteStrength } from "./magicStocks";
import { clamp, rockResistance, round } from "./math";
import { CellQueue, type Band } from "@atlas/domain";
import { workingArray, releaseWorking } from "./physicalNumerics";

const wards = (field: MagicField) =>
  field.definition.enabled && field.definition.effects.warding > 0;
/** The least strength a kept line or a pilgrimage road has; a fainter way is only a track. */
const lineFloor = 100;

/**
 * Hallowed's seats: an inhabited seat kept past the source floor of the full tenure is a
 * source, stronger by a bonus for every way that converges on it (the pilgrimage). A young
 * town is no seat. The ring a seat wards reaches in proportion to its strength.
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
    ways = waysConverging(society.region.connections);
  for (const c of society.region.communities) {
    if (c.status !== "inhabited") continue;
    const cell = nativeIndexAtSurface(state, c.position.x, c.position.y);
    if (cell < 0 || map.Tenure.get(cell) <= 0) continue;
    // A seat is a point fact: its person-years count whole, whatever the cell's size.
    const tenure = map.Tenure.get(cell) / p.tenureFull,
      strength = siteStrength(1000 * tenure * (1 + p.pilgrimageBonus * (ways.get(c.id) ?? 0)));
    if (strength === 0) continue;
    field.source.set(cell, Math.max(field.source.get(cell), strength));
    field.located.push({
      origin: origin.id,
      id: `seat:${c.id}`,
      x: map.mesh.x(cell),
      y: map.mesh.y(cell),
      radius: (p.wardReach * strength) / 1000,
      strength,
    });
  }
}
/** How many ways end at each community. */
function waysConverging(connections: { from: string; to: string }[]) {
  const ways = new Map<string, number>();
  for (const link of connections) {
    ways.set(link.from, (ways.get(link.from) ?? 0) + 1);
    ways.set(link.to, (ways.get(link.to) ?? 0) + 1);
  }
  return ways;
}
/** Hallowed's lines: kept-years where people keep a frontier or a work, and the roads pilgrims wear. */
export function keptLineSources(state: GenerationState, field: MagicField) {
  const map = state.physical!.map,
    p = field.definition.parameters;
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes.get(i) !== 0) continue;
    // A line is a line whatever cell it crosses: kept-years and traveller-years count whole.
    // Below a tenth of a full line a track is only a track: without the floor every path a
    // world has walked wards the land a little, and nothing else is itself anywhere.
    const kept = map.KeptLine.get(i) / p.lineFull,
      road = map.WalkedRoute.get(i) / p.roadFull,
      strength = clamp(round(1000 * Math.max(kept, road)), 0, 1000);
    if (strength >= lineFloor) field.source.set(i, strength);
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
  field.intensity.copyFrom(field.source);
  for (const seat of field.located)
    for (let i = 0; i < map.mesh.count; i++) {
      const distance = Math.hypot(map.mesh.x(i) - seat.x, map.mesh.y(i) - seat.y);
      field.intensity.set(
        i,
        Math.max(
          field.intensity.get(i),
          seat.strength * Math.max(0, 1 - distance / Math.max(1, seat.radius))
        )
      );
    }
  const others = magic.fields.filter((other) => other !== field && other.definition.enabled),
    stills = others.find((other) => other.definition.effects.stillness > 0),
    fire = others.find((other) => other.definition.effects.conduitOpening > 0);
  for (let i = 0; i < map.mesh.count; i++) {
    let intensity = field.intensity.get(i);
    if (intensity <= 0) continue;
    // Held charge reinforces a ward in proportion to the ward that is there to reinforce.
    if (stills) intensity += p.auroraReinforce * stills.stored.get(i) * (intensity / 1000);
    if (fire && fire.source.get(i) > 0) intensity = 0;
    field.intensity.set(i, Math.min(1000, intensity));
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
  const displaced = removeInside(map, magic, (i) => field.intensity.get(i) * map.Warding.get(i));
  for (let i = 0; i < map.mesh.count; i++) {
    const warding = map.Warding.get(i);
    if (warding > 0) field.intensity.set(i, round(field.intensity.get(i) * (1 - warding)));
  }
  landOnRim(map, magic, displaced, (i, added) => {
    field.intensity.set(i, clamp(round(field.intensity.get(i) + added), 0, 1000));
  });
}
/** What each ring removes, as an amount per ring: the removed value times the cell's area. */
function removeInside(map: PhysicalField, magic: MagicWorkspace, removed: (i: number) => number) {
  const displaced = workingArray(map, "float64", "magic:ward-displacement");
  for (let i = 0; i < map.mesh.count; i++) {
    const ring = magic.wardLabel.get(i);
    if (ring < 0) continue;
    displaced.add(ring, removed(i) * map.mesh.area(i));
  }
  return displaced;
}
/** Lay each ring's amount on that ring's own rim cells, by their area. */
function landOnRim(
  map: PhysicalField,
  magic: MagicWorkspace,
  displaced: Band,
  land: (i: number, added: number) => void
) {
  const rimArea = workingArray(map, "float64", "magic:ward-rim-area");
  for (let i = 0; i < map.mesh.count; i++) {
    const ring = magic.rimLabel.get(i);
    if (ring >= 0) rimArea.add(ring, map.mesh.area(i));
  }
  for (let i = 0; i < map.mesh.count; i++) {
    const ring = magic.rimLabel.get(i);
    if (ring < 0) continue;
    const amount = displaced.get(ring),
      area = rimArea.get(ring);
    if (amount > 0 && area > 0) land(i, amount / area);
  }
  releaseWorking(map, displaced, rimArea);
}
/**
 * The rings and their rims: every connected patch of warding is one ring, and a cell with
 * no warding that touches a ring is that ring's rim, so what a ring holds back lands beside
 * it and not on a sanctuary across the world.
 */
export function markRim(map: PhysicalField, magic: MagicWorkspace) {
  const { mesh } = map;
  magic.wardRim.fill(0);
  magic.wardLabel.fill(-1);
  magic.rimLabel.fill(-1);
  const queue = new CellQueue();
  let rings = 0;
  for (let start = 0; start < mesh.count; start++) {
    if (map.Warding.get(start) <= 0 || magic.wardLabel.get(start) >= 0) continue;
    labelRing(map, magic, start, rings, queue);
    rings++;
  }
}
/** Flood one ring from a warded cell, marking its cells and the rim cells around it. */
function labelRing(
  map: PhysicalField,
  magic: MagicWorkspace,
  start: number,
  ring: number,
  queue: CellQueue
) {
  const { mesh } = map;
  queue.clear();
  queue.push(start);
  magic.wardLabel.set(start, ring);
  for (let i = queue.shift(); i >= 0; i = queue.shift()) {
    for (let edge = 0; edge < mesh.degree(i); edge++) {
      const j = mesh.neighbor(i, edge);
      if (j < 0) continue;
      if (map.Warding.get(j) > 0 && magic.wardLabel.get(j) < 0) {
        magic.wardLabel.set(j, ring);
        queue.push(j);
      } else if (map.Warding.get(j) <= 0 && magic.rimLabel.get(j) < 0) {
        magic.rimLabel.set(j, ring);
        magic.wardRim.set(j, 1);
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
  const storm = removeInside(map, magic, (i) => map.StormTrack.get(i) * map.Warding.get(i));
  landOnRim(map, magic, storm, (i, added) => {
    map.StormForcing.set(i, clamp(round(map.StormForcing.get(i) + added), 0, 1000));
  });
  for (const field of fields) spillBelow(map, field);
}
function spillBelow(map: PhysicalField, field: MagicField) {
  const spill = field.definition.parameters.wardSpill;
  for (let i = 0; i < map.mesh.count; i++) {
    const w = map.Warding.get(i),
      target = map.FlowTargets.get(i);
    if (w <= 0 || target < 0 || map.Warding.get(target) > 0 || map.WaterKindCodes.get(target) !== 0)
      continue;
    map.RockResistance.set(
      target,
      rockResistance(map.RockResistance.get(target) - round(spill * w))
    );
  }
}
/**
 * Coasts hold inside a ward: the external forcing on a warded shore moves to the shore
 * downdrift of it, along the current of the sea beside it, as past a terminal groyne.
 */
export function wardCoasts(map: PhysicalField, magic: MagicWorkspace, totals: Band) {
  if (!magic.fields.some(wards)) return;
  const moved = workingArray(map, "float64", "magic:ward-coasts");
  for (let i = 0; i < map.mesh.count; i++) {
    const w = map.Warding.get(i),
      total = totals.get(i);
    if (w <= 0 || map.WaterKindCodes.get(i) !== 0 || total <= 0) continue;
    const taken = round(total * w);
    totals.set(i, total - taken);
    const target = downdrift(map, i);
    if (target >= 0) moved.add(target, taken);
  }
  for (let i = 0; i < map.mesh.count; i++) {
    const added = moved.get(i);
    if (added > 0) totals.set(i, clamp(totals.get(i) + round(added), 0, 1000));
  }
  releaseWorking(map, moved);
}
/** The land neighbour that lies along the strongest current of the sea beside a shore cell. */
function downdrift(map: PhysicalField, i: number) {
  let dx = 0,
    dy = 0,
    strength = 0;
  for (let edge = 0; edge < map.mesh.degree(i); edge++) {
    const j = map.mesh.neighbor(i, edge);
    if (j < 0 || map.WaterKindCodes.get(j) !== 1 || map.OceanCurrentStrength.get(j) <= strength)
      continue;
    [dx, dy, strength] = [
      map.OceanCurrentX.get(j),
      map.OceanCurrentY.get(j),
      map.OceanCurrentStrength.get(j),
    ];
  }
  if (strength <= 0) return -1;
  let best = -1,
    score = 0;
  for (let edge = 0; edge < map.mesh.degree(i); edge++) {
    const j = map.mesh.neighbor(i, edge);
    if (j < 0 || map.WaterKindCodes.get(j) !== 0) continue;
    const alignment = map.mesh.edgeX(i, edge) * dx + map.mesh.edgeY(i, edge) * dy;
    if (alignment > score) [best, score] = [j, alignment];
  }
  return best;
}
