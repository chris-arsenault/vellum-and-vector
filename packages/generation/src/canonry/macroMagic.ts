import { type MagicFeatureRule } from "@atlas/domain";
import { landscapeInterpolator, type LandscapeProfile } from "./landscapeProfiles";
import type { GenerationState } from "../process";
import type { MagicField } from "./magicState";
import { magicMatcher, paintMagicFeatures } from "./magicFeatures";
import { macroComponents, macroDistances, reconstructRegion } from "./macroRegions";
import { branchingSections } from "./macroSkeleton";
import { sourceRegion, frontRegion, interactionRegion } from "./macroMagicShapes";
import { rockResistance } from "./math";
import type { PhysicalMesh } from "./mesh";

function physicalSupport(
  state: GenerationState,
  field: MagicField,
  rule: MagicFeatureRule,
  seed: number
) {
  const transient = new Set([
    "intensity",
    "history",
    "source",
    "wake",
    "rogue",
    "stored",
    "coastalHistory",
    "firstEpoch",
    "coastalFirstEpoch",
    "noise",
    "scatter",
  ]);
  // Thresholds select causal seeds. Physical restrictions still govern the space
  // in which their final outlines can move. Foreign fields constrain interactions.
  const groups = (rule.retains ?? rule.seeds).map((group) =>
    group.filter((test) => !transient.has(test.field))
  );
  return magicMatcher(state, field, groups, seed);
}
function corridorMask(
  state: GenerationState,
  mask: Uint8Array,
  radius: number,
  admits: (i: number) => boolean
) {
  const mesh = state.physical!.map.mesh,
    result = reconstructRegion(mesh, mask, admits, radius),
    allowed = macroDistances(mesh, (i) => Boolean(mask[i]), admits, radius),
    profiles: LandscapeProfile[] = [];
  // Section axes strengthen trunks, retaining the inherited branches and gaps
  // where the substrate cannot support a connection.
  for (const cells of macroComponents(mesh, (i) => Boolean(mask[i]))) {
    if (cells.length < 3) continue;
    for (const [branch, axis] of branchingSections(mesh, cells, radius).entries())
      profiles.push({
        id: `corridor:${cells[0]}:${branch}`,
        points: axis.map((s) => s.point),
        widths: axis.map((s) => Math.min(radius * 0.3, s.width)),
        values: { influence: axis.map(() => 1) },
        operation: "raise",
      });
  }
  const spine = landscapeInterpolator(profiles, "influence", () => 0);
  for (let i = 0; i < mesh.count; i++)
    if (
      allowed.distance[i] <= radius &&
      admits(i) &&
      spine({ x: mesh.x[i] + mesh.origin[0], y: mesh.y[i] + mesh.origin[1], z: 0 }) > 0.5
    )
      result.mask[i] = 1;
    else result.mask[i] = 0;
  return { mask: result.mask, source: allowed.source, distance: allowed.distance };
}
function composedRegion(
  state: GenerationState,
  field: MagicField,
  rule: MagicFeatureRule,
  mask: Uint8Array,
  seed: number
) {
  const mesh = state.physical!.map.mesh,
    composition = rule.composition ?? {
      role: "region",
      scale: field.definition.parameters.featureNoiseScale * 0.5,
    },
    support = physicalSupport(state, field, rule, seed),
    radius = composition.scale;
  if (composition.role === "source") {
    return sourceRegion(state, field, mask, support, radius);
  }
  if (composition.role === "corridor") return corridorMask(state, mask, radius, support);
  if (composition.role === "front") return frontRegion(state, mask, support, radius);
  if (composition.role === "interaction")
    return interactionRegion(state, field, rule, mask, support, radius, seed);
  const closing = reconstructRegion(mesh, mask, support, radius);
  return {
    ...closing,
    distance: macroDistances(mesh, (i) => Boolean(mask[i]), support, radius).distance,
  };
}
const mappedFields = ["intensity", "wake", "rogue", "history", "stored", "coastalHistory"] as const;
function remapRegion(
  field: MagicField,
  original: Uint8Array,
  composed: ReturnType<typeof composedRegion>,
  mesh: PhysicalMesh
) {
  const radius = field.definition.parameters.featureNoiseScale,
    before = magicStores(field, composed.mask, mesh);
  for (let i = 0; i < original.length; i++) {
    const source = composed.source[i];
    if (original[i] || !composed.mask[i] || source < 0) continue;
    const blend = Math.max(0.5, 1 - composed.distance[i] / radius);
    for (const key of mappedFields)
      field[key][i] = field[key][i] * (1 - blend) + field[key][source] * blend;
    field.retained[i] =
      field.retained[i] * (1 - blend) +
      ((field.retained[source] * mesh.areas[i]) / mesh.areas[source]) * blend;
    // These are inherited dates, not a newly simulated encounter.
    for (const key of ["firstEpoch", "coastalFirstEpoch"] as const)
      if (field[key][source] >= 0 && (field[key][i] < 0 || field[key][source] < field[key][i]))
        field[key][i] = field[key][source];
  }
  conserveStores(field, composed.mask, mesh, before);
}
function conserveStores(
  field: MagicField,
  mask: Uint8Array,
  mesh: PhysicalMesh,
  before: [number, number]
) {
  const after = magicStores(field, mask, mesh);
  for (let i = 0; i < mask.length; i++)
    if (mask[i]) {
      if (after[0] > 0) field.stored[i] *= before[0] / after[0];
      if (after[1] > 0) field.retained[i] *= before[1] / after[1];
    }
}
function magicStores(field: MagicField, mask: Uint8Array, mesh: PhysicalMesh): [number, number] {
  let stored = 0,
    retained = 0;
  for (let i = 0; i < mask.length; i++)
    if (mask[i]) {
      stored += field.stored[i] * mesh.areas[i];
      retained += field.retained[i];
    }
  return [stored, retained];
}

/** Shape all configured feature roles without dispatching on a preset or replaying effects. */
export function composeMagicalRegions(state: GenerationState, seed: number) {
  const work = state.physical!,
    magic = work.magic;
  if (!magic) return;
  for (const field of magic.fields) {
    const before = field.intensity.slice();
    for (const rule of field.definition.features) {
      const original = field.features[rule.id];
      if (!original?.some(Boolean)) continue;
      const composed = composedRegion(state, field, rule, original, seed);
      remapRegion(field, original, composed, work.map.mesh);
      field.features[rule.id] = composed.mask;
    }
    reconcileMagicForcing(state, field, before);
  }
  paintMagicFeatures(state);
}
function reconcileMagicForcing(state: GenerationState, field: MagicField, before: Float64Array) {
  const work = state.physical!,
    map = work.map,
    effects = field.definition.effects;
  for (let i = 0; i < map.mesh.count; i++) {
    const delta = field.intensity[i] - before[i],
      heat = delta * effects.heat;
    map.Temperature[i] = Math.max(0, Math.min(1000, map.Temperature[i] + heat));
    map.ExternalHeatForcing[i] += heat;
    work.magic!.heat[i] += heat;
    work.magic!.coastal[i] += delta * effects.coastalForcing;
    map.FireActivity[i] = Math.max(
      0,
      Math.min(1, map.FireActivity[i] + (delta * effects.fire) / 1000)
    );
    // Correct only moved forcing. Applying the epoch feedback functions here
    // would melt ice and harden rock for an additional period of history.
    map.IceThickness[i] = Math.max(0, map.IceThickness[i] - delta * effects.iceMelt);
    map.RockResistance[i] = rockResistance(
      map.RockResistance[i] + (delta * effects.rockResistance) / 1000
    );
  }
}
