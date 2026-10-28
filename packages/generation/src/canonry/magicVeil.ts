import type { GenerationState } from "../process";
import type { PhysicalField } from "./field";
import type { MagicField } from "./magicState";
import type { LocateContext } from "./magicSources";
import { strainAt } from "./magicConfluences";
import { hashUnit } from "./noise";
import { clamp, round, units } from "./math";
import { rebuild } from "./surface";
import { BitSet, radixOrder, type NumericalVector } from "@atlas/domain";
import { workingValues, releaseWorking } from "./physicalNumerics";

const tears = (field: MagicField) =>
  field.definition.enabled && field.definition.effects.tearing > 0;

/**
 * Veil's tears: in each cell, the strain of every pair of other enabled systems (both
 * strong, and their gap turning sharply across the cell's edges) plus the coverage of any
 * meeting holding the cell, relaxed where Greenwood's verdure knits the ground and held at
 * its last strength on salted ground. A tear is the strain above the floor; the share of a
 * tear that moved since the last epoch is its wildness.
 */
export function strainSources(
  state: GenerationState,
  field: MagicField,
  _seed: number,
  { origin }: LocateContext
) {
  const map = state.physical!.map,
    magic = state.physical!.magic!,
    p = field.definition.parameters,
    others = magic.fields.filter((other) => other.definition.enabled && !tears(other)),
    meetings = Object.values(magic.confluences.states),
    previous = field.stocks[`${origin.id}/held`];
  for (let i = 0; i < map.mesh.count; i++) {
    field.wild[i] = 0;
    if (map.WaterKindCodes[i] === 1) continue;
    const strain = cellStrain(map, others, meetings, i) * (1 - p.knitVerdure * map.Verdure[i]),
      before = previous ? previous[i] / map.mesh.areas[i] : 0;
    let strength = tearStrength(p, strain);
    if (map.Salting[i] > 0)
      strength = Math.max(strength, round(before * p.holdSalting * map.Salting[i]));
    if (strength > 0 || before > 0)
      field.wild[i] = clamp(Math.abs(strength - before) / 1000 / p.wildShift, 0, 1);
    if (strength > 0) field.source[i] = strength;
  }
}
/** The strain of every pair of other systems in a cell, plus the coverage of any meeting there. */
function cellStrain(
  map: PhysicalField,
  others: MagicField[],
  meetings: { coverage: NumericalVector }[],
  i: number
) {
  let strain = 0;
  for (let a = 0; a < others.length; a++)
    for (let b = a + 1; b < others.length; b++) strain += strainAt(map, others[a], others[b], i);
  for (const held of meetings) strain += held.coverage[i];
  return strain;
}
/** A tear's strength: the strain above the floor, full at the declared strain. */
function tearStrength(p: MagicField["definition"]["parameters"], strain: number) {
  if (strain < p.tearFloor) return 0;
  return clamp(round((1000 * (strain - p.tearFloor)) / (p.tearFull - p.tearFloor)), 1, 1000);
}
/**
 * Veil's doors: stable tears, strong enough and not wild, paired by nearest strength at a
 * distance at least the span, up to the count; last epoch's pairs hold while both ends
 * still qualify. Aurora's stored charge closes a cell, a ward seals it, and an open or hot
 * Fire ruptures it and makes it wild.
 */
export function pairingSources(
  state: GenerationState,
  field: MagicField,
  _seed: number,
  { origin }: LocateContext
) {
  const map = state.physical!.map,
    p = field.definition.parameters,
    strength = field.originSources.tear;
  if (!strength) return;
  const eligible = doorEligibility(state, field, strength);
  const used = new BitSet(map.mesh.count);
  field.doors = field.doors.filter((door) => eligible(door.a) && eligible(door.b));
  for (const door of field.doors) {
    used.set(door.a);
    used.set(door.b);
  }
  const scores = workingValues(map, "float64", "magic:door-candidates", (i) =>
    !used.has(i) && eligible(i) ? strength[i] : -Infinity
  );
  const candidates = radixOrder(scores, true);
  for (const a of candidates) {
    if (field.doors.length >= p.doorCount || scores[a] === -Infinity) break;
    if (used.has(a)) continue;
    const b = partner(map, scores, candidates, used, a, p.doorDistance, p.doorMatch);
    if (b < 0) continue;
    used.set(a);
    used.set(b);
    field.doors.push({ a, b });
  }
  releaseWorking(map, scores, candidates);
  field.doors.forEach((door, index) => {
    for (const [end, cell] of [
      ["a", door.a],
      ["b", door.b],
    ] as const) {
      field.source[cell] = strength[cell];
      field.located.push({
        origin: origin.id,
        id: `door:${index}:${end}`,
        x: map.mesh.x[cell],
        y: map.mesh.y[cell],
        radius: Math.sqrt(map.mesh.areas[cell]),
        strength: strength[cell],
      });
    }
  });
}
function doorEligibility(state: GenerationState, field: MagicField, strength: NumericalVector) {
  const map = state.physical!.map,
    magic = state.physical!.magic!,
    p = field.definition.parameters,
    others = magic.fields.filter((other) => other.definition.enabled && other !== field),
    stills = others.find((other) => other.definition.effects.stillness > 0),
    fire = others.find((other) => other.definition.effects.conduitOpening > 0);
  return (i: number) => {
    if (strength[i] < p.doorStrain) return false;
    // A Fire release at the cell (an open vein, a cracked core, a forge) ruptures the door.
    if (fire && fire.source[i] > 0) {
      field.wild[i] = 1;
      return false;
    }
    if (field.wild[i] >= 0.1 || map.Warding[i] >= 0.5) return false;
    return !(stills && stills.stored[i] >= 300);
  };
}
function partner(
  map: PhysicalField,
  strength: NumericalVector,
  candidates: NumericalVector,
  used: BitSet,
  a: number,
  span: number,
  match: number
) {
  let best = -1,
    gap = match + 1;
  for (const b of candidates) {
    if (b === a || used.has(b)) continue;
    const difference = Math.abs(strength[a] - strength[b]);
    if (difference > match || difference >= gap) continue;
    if (Math.hypot(map.mesh.x[a] - map.mesh.x[b], map.mesh.y[a] - map.mesh.y[b]) < span) continue;
    [best, gap] = [b, difference];
  }
  return best;
}
/**
 * What Veil does to the ground once per epoch: a wild zone moves its bedrock by a hashed
 * amount within the bound and exchanges a share of its tree and grass cover, so streams
 * change course and a forest edge moves without flood or fire; a door chills its cell,
 * sinks a pool once, and rings itself with forced grass and saplings.
 */
export function veilWrites(state: GenerationState, epoch: number) {
  const map = state.physical!.map,
    fields = state.physical!.magic!.fields.filter(tears);
  for (const field of fields) {
    for (let i = 0; i < map.mesh.count; i++)
      if (field.wild[i] > 0 && map.WaterKindCodes[i] === 0) unsettle(map, field, i, epoch);
    for (const door of field.doors)
      for (const cell of [door.a, door.b]) houseDoor(map, field, cell);
  }
}
function unsettle(map: PhysicalField, field: MagicField, i: number, epoch: number) {
  const p = field.definition.parameters,
    w = field.wild[i],
    h = hashUnit(epoch ^ 0x7e11, i, 0) - 0.5;
  map.BedrockElevation[i] += units(p.wildRelief * w * 2 * h);
  rebuild(map, i);
  const share = p.wildShuffle * w;
  if (h > 0) {
    const moved = map.GrassCover[i] * share;
    map.GrassCover[i] -= moved;
    map.BroadleafCover[i] += moved;
  } else {
    const trees = map.BroadleafCover[i] + map.ConiferCover[i],
      moved = trees * share;
    if (trees > 0) {
      map.BroadleafCover[i] -= (moved * map.BroadleafCover[i]) / trees;
      map.ConiferCover[i] -= (moved * map.ConiferCover[i]) / trees;
    }
    map.GrassCover[i] += moved;
  }
  map.TreeCover[i] = map.BroadleafCover[i] + map.ConiferCover[i];
}
function houseDoor(map: PhysicalField, field: MagicField, cell: number) {
  const p = field.definition.parameters;
  map.Temperature[cell] = Math.max(0, map.Temperature[cell] - round(p.doorChill));
  if (field.subsided[cell] < p.doorPool) {
    const drop = p.doorPool - field.subsided[cell];
    field.subsided[cell] = p.doorPool;
    map.BedrockElevation[cell] -= units(drop);
    rebuild(map, cell);
  }
  for (let edge = 0; edge < map.mesh.degree[cell]; edge++) {
    const j = map.mesh.neighbors[cell * map.mesh.stride + edge];
    if (j < 0 || map.WaterKindCodes[j] !== 0) continue;
    map.GrassCover[j] = Math.max(map.GrassCover[j], 0.3);
    map.BroadleafSaplings[j] = Math.max(map.BroadleafSaplings[j], 0.05);
  }
}
