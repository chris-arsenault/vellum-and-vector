import type { GenerationState } from "../process";
import type { PhysicalField } from "./field";
import type { MagicField } from "./magicState";
import type { LocateContext } from "./magicSources";
import { strainAt } from "./magicConfluences";
import { fractalNoise } from "./noise";
import { clamp, round, units } from "./math";
import { displaceGroundField } from "../rock/groundDeformation";
import { workingArray, releaseWorking } from "./physicalNumerics";
import { wardSeals } from "./magicHallowed";
import { CellList, FloatList, radixOrder, type Band } from "@atlas/domain";
import { triangleIdentity, meshDeltaX } from "./mesh";

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
  { origin, activity }: LocateContext
) {
  const map = state.physical!.map,
    magic = state.physical!.magic!,
    p = field.definition.parameters,
    others = magic.fields.filter((other) => other.definition.enabled && !tears(other)),
    meetings = Object.values(magic.confluences.states),
    previous = field.stocks[`${origin.id}/held`];
  for (let i = 0; i < map.mesh.count; i++) {
    field.wild.set(i, 0);
    if (map.WaterKindCodes.get(i) === 1) continue;
    const strain = cellStrain(map, others, meetings, i) * (1 - p.knitVerdure * map.Verdure.get(i)),
      before = previous ? previous.get(i) / map.mesh.area(i) : 0,
      salting = map.Salting.get(i);
    const { strength, wild } = tearResponse(strain, before, salting, activity, p);
    field.wild.set(i, wild);
    if (strength > 0) field.source.set(i, strength);
  }
}
/** The strain of every pair of other systems in a cell, plus the coverage of any meeting there. */
function cellStrain(
  map: PhysicalField,
  others: MagicField[],
  meetings: { coverage: Band }[],
  i: number
) {
  let strain = 0;
  for (let a = 0; a < others.length; a++)
    for (let b = a + 1; b < others.length; b++) strain += strainAt(map, others[a], others[b], i);
  for (const held of meetings) strain += held.coverage.get(i);
  return strain;
}
/** A tear's strength: the strain above the floor, full at the declared strain. */
type TearParameters = Pick<
  MagicField["definition"]["parameters"],
  "tearFloor" | "tearFull" | "holdSalting" | "wildShift"
>;
function tearStrength(p: TearParameters, strain: number) {
  if (strain < p.tearFloor) return 0;
  return clamp(round((1000 * (strain - p.tearFloor)) / (p.tearFull - p.tearFloor)), 1, 1000);
}
/** Previous strain is memory, not a charge that can power an inactive system. */
export function tearResponse(
  strain: number,
  previous: number,
  salting: number,
  activity: number,
  p: TearParameters
) {
  if (activity <= 0) return { strength: 0, wild: 0 };
  const strength = clamp(
    round(Math.max(tearStrength(p, strain) * activity, previous * p.holdSalting * salting)),
    0,
    1000
  );
  return { strength, wild: clamp(Math.abs(strength - previous) / 1000 / p.wildShift, 0, 1) };
}
// hpc-exempt: one entry per map, holding the field whose doors are that map's.
const pairedOn = new WeakMap<PhysicalField, MagicField>();
/** The doors standing on a map now: the cells at the two ends of each paired tear. */
export const doorsOn = (map: PhysicalField): readonly { a: number; b: number }[] =>
  pairedOn.get(map)?.doors ?? [];
/**
 * Veil's doors: stable tears, strong enough and not wild, paired by nearest strength at a
 * distance at least the span; last epoch's pairs hold while both ends
 * still qualify. Aurora's stored charge closes a cell, a ward seals it, and an open or hot
 * Fire ruptures it and makes it wild.
 */
export function pairingSources(
  state: GenerationState,
  field: MagicField,
  _seed: number,
  { origin, activity }: LocateContext
) {
  const map = state.physical!.map,
    p = field.definition.parameters,
    strength = field.originSources.tear;
  pairedOn.set(map, field);
  if (!strength || activity <= 0) {
    field.doors = [];
    return;
  }
  const eligible = doorEligibility(state, field, strength);
  const used = new Uint8Array(map.mesh.count);
  field.doors = field.doors.filter((door) => eligible(door.a) && eligible(door.b));
  for (const door of field.doors) {
    used[door.a] = 1;
    used[door.b] = 1;
  }
  // Only the eligible cells are candidates; they are few, ordered strongest first.
  const cells = new CellList(),
    scores = new FloatList();
  for (let i = 0; i < map.mesh.count; i++)
    if (!used[i] && eligible(i)) {
      cells.push(i);
      scores.push(strength.get(i));
    }
  const order = radixOrder(scores.finish(), true),
    candidates = Int32Array.from(order, (k) => cells.at(k));
  for (const a of candidates) {
    if (used[a]) continue;
    const b = partner(map, strength, candidates, used, a, p.doorDistance, p.doorMatch);
    if (b < 0) continue;
    used[a] = 1;
    used[b] = 1;
    field.doors.push({ a, b });
  }
  field.doors.forEach((door) => {
    for (const [end, cell] of [
      ["a", door.a],
      ["b", door.b],
    ] as const) {
      field.source.set(cell, strength.get(cell));
      field.located.push({
        origin: origin.id,
        id: `door:${triangleIdentity(map.mesh, door.a)}:${triangleIdentity(map.mesh, door.b)}:${end}`,
        x: map.mesh.x(cell),
        y: map.mesh.y(cell),
        radius: Math.sqrt(map.mesh.area(cell)),
        strength: strength.get(cell),
      });
    }
  });
}
/** Wildness from which a tear no longer holds still; stored charge from which a door closes. */
const doorTooWild = 0.1,
  doorClosingCharge = 300;
/** What can end a door at a cell: a rupture, wild ground, or a ward or charge that shuts it. */
export function doorConditions(state: GenerationState, field: MagicField) {
  const map = state.physical!.map,
    others = state.physical!.magic!.fields.filter(
      (other) => other.definition.enabled && other !== field
    ),
    stills = others.find((other) => other.definition.effects.stillness > 0),
    fire = others.find((other) => other.definition.effects.conduitOpening > 0);
  return {
    // A Fire release at the cell (an open vein, a cracked core, a forge) ruptures the door.
    ruptured: (i: number) => Boolean(fire && fire.source.get(i) > 0),
    unsettled: (i: number) => field.wild.get(i) >= doorTooWild,
    shut: (i: number) =>
      map.Warding.get(i) >= wardSeals ||
      Boolean(stills && stills.stored.get(i) >= doorClosingCharge),
  };
}
/** Whether a cell can hold a door: strong enough, and nothing there ends one. Writes nothing. */
export function doorHoldsOpen(state: GenerationState, field: MagicField, strength: Band) {
  const { ruptured, unsettled, shut } = doorConditions(state, field),
    p = field.definition.parameters;
  return (i: number) =>
    strength.get(i) >= p.doorStrain && !ruptured(i) && !unsettled(i) && !shut(i);
}
/** The pairing's test: a door's eligibility, and a Fire release on strong strain makes it wild. */
function doorEligibility(state: GenerationState, field: MagicField, strength: Band) {
  const { ruptured } = doorConditions(state, field),
    holdsOpen = doorHoldsOpen(state, field, strength),
    p = field.definition.parameters;
  return (i: number) => {
    if (strength.get(i) >= p.doorStrain && ruptured(i)) field.wild.set(i, 1);
    return holdsOpen(i);
  };
}
function partner(
  map: PhysicalField,
  strength: Band,
  candidates: Int32Array,
  used: Uint8Array,
  a: number,
  span: number,
  match: number
) {
  let best = -1,
    gap = match + 1;
  const here = strength.get(a);
  for (const b of candidates) {
    if (b === a || used[b]) continue;
    const difference = Math.abs(here - strength.get(b));
    if (difference > match || difference >= gap) continue;
    if (
      Math.hypot(
        meshDeltaX(map.mesh, map.mesh.x(a) - map.mesh.x(b)),
        map.mesh.y(a) - map.mesh.y(b)
      ) < span
    )
      continue;
    [best, gap] = [b, difference];
  }
  return best;
}
/**
 * What Veil does to the ground once per epoch: a wild zone displaces coherent ground and
 * exchanges a share of its tree and grass cover, so streams
 * change course and a forest edge moves without flood or fire. A door's own marks on the
 * ground are the door entry's.
 */
export function veilWrites(state: GenerationState, epoch: number) {
  const map = state.physical!.map,
    fields = state.physical!.magic!.fields.filter(tears);
  for (const field of fields) {
    const movement = workingArray(map, "float64", "veil:displacement");
    for (let i = 0; i < map.mesh.count; i++)
      if (field.wild.get(i) > 0 && map.WaterKindCodes.get(i) === 0)
        movement.set(i, unsettle(map, field, i, epoch));
    displaceGroundField(map, movement, "veil");
    releaseWorking(map, movement);
  }
}
function unsettle(map: PhysicalField, field: MagicField, i: number, epoch: number) {
  const p = field.definition.parameters,
    w = field.wild.get(i),
    h = fractalNoise(
      map.mesh.origin[0] + map.mesh.x(i),
      map.mesh.origin[1] + map.mesh.y(i),
      epoch ^ 0x7e11,
      map.scale.length(0.025),
      2
    );
  const share = p.wildShuffle * w;
  if (h > 0) {
    const moved = map.GrassCover.get(i) * share;
    map.GrassCover.add(i, -moved);
    map.BroadleafCover.add(i, moved);
  } else {
    const broadleaf = map.BroadleafCover.get(i),
      conifer = map.ConiferCover.get(i),
      trees = broadleaf + conifer,
      moved = trees * share;
    if (trees > 0) {
      map.BroadleafCover.add(i, -(moved * broadleaf) / trees);
      map.ConiferCover.add(i, -(moved * conifer) / trees);
    }
    map.GrassCover.add(i, moved);
  }
  map.TreeCover.set(i, map.BroadleafCover.get(i) + map.ConiferCover.get(i));
  return units(p.wildRelief * w * h);
}
