// Procedural siting of landscape landmarks: the generator decides which kinds a world gets,
// the epoch each forms in, where it belongs and how large it is, and records the result as
// a landmark the later epochs, the next run and the creator all read.
import {
  defaultLandmarkParameters,
  landmarkKind,
  semanticId,
  TopK,
  type Landmark,
  type World,
} from "@atlas/domain";
import type { PhysicalField } from "./field";
import { clamp } from "./math";
import { hashUnit } from "./noise";
import { distance, forwardTrack, type Point } from "./landmarkGeometry";
import { sitingRules, type Site, type Terrain } from "./landmarkSitingRules";

export interface RosterEntry {
  ordinal: number;
  kind: string;
  /** Index into the epochs; a water kind waits for rivers, the rest form early and weather. */
  epoch: number;
  sited?: boolean;
}
/** A landmark already standing, for separation. */
export interface Taken {
  point: Point;
  reach: number;
}

const km = 1000;
/** The spread a world's landmarks are drawn from, in rotation, so a few give a few kinds. */
export const landscapeMix = [
  "volcanic-mountain",
  "falls",
  "canyon",
  "dome-ring",
  "escarpment",
  "resistant-mountain",
  "impact-ring",
];
/** Magic kinds in rotation; a run offers only those whose system it generates. */
export const magicMix = [
  "fire-wellspring",
  "pressure-locus",
  "greenwood-heart",
  "aurora-vault",
  "salt-pan",
];
/** Kinds that read a climate, ice, ecology or lake history and so wait for the second epoch. */
const laterKinds = new Set(["aurora-vault", "greenwood-heart", "salt-pan"]);
const samplePool = 600;

export const landmarkId = (world: Pick<World, "id">, areaId: string, ordinal: number) =>
  semanticId(world.id, "landmark", `${areaId}:${ordinal}`);
/** Ordinals whose ids no record of this world holds yet, lowest first. */
export function freeOrdinals(
  world: Pick<World, "id" | "landmarks">,
  areaId: string,
  count: number
) {
  const held = new Set((world.landmarks ?? []).map((landmark) => landmark.id)),
    free: number[] = [];
  for (let ordinal = 0; free.length < count; ordinal++)
    if (!held.has(landmarkId(world, areaId, ordinal))) free.push(ordinal);
  return free;
}
function formingEpoch(kind: string, u: number, epochs: number) {
  const last = epochs - 1;
  if (kind === "falls" || laterKinds.has(kind))
    return Math.min(last, 1 + Math.floor(u * Math.max(1, last)));
  if (kind === "canyon") return Math.min(last, 1 + Math.floor(u * Math.max(1, last - 1)));
  if (landmarkKind(kind)?.system) return Math.min(last, Math.floor(u * epochs));
  return Math.min(last, Math.floor(u * Math.max(1, last)));
}
/** Kinds and forming epochs for the landmarks still to be sited, seeded by the world. */
export function landmarkRoster(
  seed: number,
  ordinals: number[],
  epochs: number,
  mix: readonly string[] = landscapeMix
): RosterEntry[] {
  if (!mix.length) return [];
  const offset = Math.floor(hashUnit(seed ^ 0x6c3d, 0, 0) * mix.length);
  return ordinals.map((ordinal, n) => {
    const kind = mix[(offset + n) % mix.length];
    return {
      ordinal,
      kind,
      epoch: Math.max(0, formingEpoch(kind, hashUnit(seed ^ 0x51a7, ordinal, 1), epochs)),
    };
  });
}
/** Catalogue defaults varied within a quarter either way, so two mountains are not twins. */
export function seededMeasures(kindId: string, seed: number, ordinal: number) {
  const kind = landmarkKind(kindId)!,
    values = defaultLandmarkParameters(kind);
  kind.parameters.forEach((p, n) => {
    const u = hashUnit(seed ^ 0x2e9b, ordinal, n);
    values[p.key] = p.default * (0.75 + 0.5 * u);
  });
  return clampMeasures(kindId, values);
}
export function clampMeasures(kindId: string, values: Record<string, number>) {
  const kind = landmarkKind(kindId)!;
  return Object.fromEntries(
    kind.parameters.map((p) => {
      const value = clamp(values[p.key] ?? p.default, p.min, p.max);
      return [p.key, p.unit === "rings" ? Math.round(value) : Math.round(value * 100) / 100];
    })
  );
}
function apart(map: PhysicalField, i: number, reach: number, taken: Taken[]) {
  return taken.every(
    (other) => distance(map, i, other.point) >= Math.max(reach + other.reach + 50 * km, 200 * km)
  );
}
function candidates(t: Terrain, entry: RosterEntry, seed: number) {
  const rule = sitingRules[entry.kind];
  if (rule.pool === "rivers") return t.rivers;
  if (rule.pool === "ocean") return t.ocean;
  if (rule.pool === "land") return t.land;
  const priority = (i: number) => hashUnit(seed ^ 0x3b91, i, entry.ordinal);
  const selected = new TopK(samplePool);
  for (const i of t.land) selected.consider(i, priority(i));
  return selected.best();
}
/**
 * The best anchor for this entry: among the kind's pool, the eligible cells standing apart
 * from every landmark already taken, by the kind's own score with a seeded tie-break.
 */
export function siteLandmark(
  t: Terrain,
  entry: RosterEntry,
  seed: number,
  taken: Taken[]
): { site: Site; parameters: Record<string, number> } | null {
  const rule = sitingRules[entry.kind],
    kind = landmarkKind(entry.kind);
  if (!rule || !kind) return null;
  const seeded = seededMeasures(entry.kind, seed, entry.ordinal),
    reach = kind.reach(seeded);
  let best = -1,
    top = -Infinity;
  for (const i of candidates(t, entry, seed)) {
    if (!apart(t.map, i, reach, taken)) continue;
    const score = rule.assess(t, i, seeded);
    if (score === null) continue;
    const value = score + 0.05 * hashUnit(seed ^ 0x7c21, i, entry.ordinal);
    if (value > top) {
      top = value;
      best = i;
    }
  }
  if (best < 0) return null;
  const parameters = clampMeasures(entry.kind, rule.fit?.(t, best, seeded) ?? seeded);
  return { site: rule.shape(t, best, parameters), parameters };
}
/** The record of a sited landmark, drawn where its anchor stands at present. */
export function generatedLandmark(
  map: PhysicalField,
  world: Pick<World, "id">,
  scope: { areaId: string; spaceId: string },
  entry: RosterEntry,
  site: Site,
  parameters: Record<string, number>,
  drift: number[]
): Landmark {
  const kind = landmarkKind(entry.kind)!,
    [x0, y0] = map.mesh.origin,
    present = site.path.map((p) => {
      const [x, y] = forwardTrack(map, p, drift, entry.epoch);
      return [Math.round(x + x0), Math.round(y + y0)];
    });
  return {
    id: landmarkId(world, scope.areaId, entry.ordinal),
    name: "",
    kind: entry.kind,
    geometry:
      kind.geometry === "Point"
        ? { type: "Point", coordinates: present[0] }
        : { type: "LineString", coordinates: present },
    parameters,
    emplacedAtEpoch: entry.epoch,
    origin: "generated",
    areaId: scope.areaId,
    spaceId: scope.spaceId,
  };
}
