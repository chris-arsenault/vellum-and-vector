import type { MagicCondition, MagicFeatureRule } from "@atlas/domain";
import type { GenerationState } from "../process";
import type { MagicField } from "./magicState";
import { meshUnitNoise as unitNoise, hashUnit } from "./noise";

/** The per-cell reader for one condition: a system's own channel, another system, or a physical field. */
export function conditionReader(
  state: GenerationState,
  field: MagicField,
  test: MagicCondition,
  seed: number
) {
  const { map, magic } = state.physical!;
  const key = test.field;
  if (key.startsWith("system:")) {
    const participant = magic!.fields.find((candidate) => candidate.definition.id === key.slice(7));
    return (i: number) => (participant?.definition.enabled ? participant.intensity[i] : NaN);
  }
  if (key.startsWith("source:")) {
    const own = field.originSources[key.slice(7)];
    return (i: number) => own?.[i] ?? 0;
  }
  const values: Record<string, ArrayLike<number>> = {
    intensity: field.intensity,
    history: field.history,
    source: field.source,
    wake: field.wake,
    rogue: field.rogue,
    stored: field.stored,
    sealed: field.sealed,
    coastalHistory: field.coastalHistory,
    firstEpoch: field.firstEpoch,
    coastalFirstEpoch: field.coastalFirstEpoch,
    upwelling: map.Upwelling,
    quickening: map.Quickening,
    stillness: map.Stillness,
    fog: map.FogForcing,
    temperature: map.Temperature,
    ice: map.IceThickness,
    water: map.WaterKindCodes,
    moisture: map.Moisture,
    geothermal: map.Geothermal,
    fracture: map.FractureConductance,
    landform: map.LandformCodes,
    river: map.RiverOrders,
    biome: map.BiomeCodes,
    treeCover: map.TreeCover,
    wetlandCover: map.WetlandCover,
    peatCarbon: map.PeatCarbon,
    oilCarbon: map.OilCarbon,
    ecologicalToxicity: map.EcologicalToxicity,
    soilWater: map.SoilWater,
    soilDepth: map.SoilDepth,
    grazers: map.Grazers,
    browsers: map.Browsers,
  };
  if (key === "elevation") return (i: number) => (map.Elevation[i] - map.BaseSeaLevel) / 1024;
  if (key === "slope") return (i: number) => map.Slope[i];
  if (key === "noise")
    return (i: number) =>
      unitNoise(
        map.mesh,
        map.mesh.x[i],
        map.mesh.y[i],
        test.salt ?? 0x621d,
        field.definition.parameters.featureNoiseScale,
        1
      );
  if (key === "scatter")
    return (i: number) =>
      hashUnit(
        seed ^ (test.salt ?? 0),
        Math.floor(map.mesh.x[i] / field.definition.parameters.featureNoiseScale),
        Math.floor(map.mesh.y[i] / field.definition.parameters.featureNoiseScale) ^
          (test.index ?? 0)
      );
  const array = values[key];
  return (i: number) => array?.[i] ?? 0;
}
function matcher(
  state: GenerationState,
  field: MagicField,
  groups: MagicCondition[][],
  seed: number
) {
  const conditions = groups.map((group) =>
    group.map((test) => {
      const read = conditionReader(state, field, test, seed);
      return (i: number) => {
        const value = read(i);
        return (
          value >= (test.min ?? -Infinity) &&
          value <= (test.max ?? Infinity) &&
          (!test.values || test.values.includes(value))
        );
      };
    })
  );
  return (i: number) => conditions.some((group) => group.every((includes) => includes(i)));
}
/** Seed cells where any seed group holds, grown through neighbours where a retain group holds. */
export function growRegion(
  state: GenerationState,
  field: MagicField,
  rule: Pick<MagicFeatureRule, "seeds" | "retains">,
  seed: number
) {
  const map = state.physical!.map;
  const included = new Uint8Array(map.mesh.count),
    queue: number[] = [];
  const isSeed = matcher(state, field, rule.seeds, seed),
    retains = matcher(state, field, rule.retains ?? rule.seeds, seed);
  for (let i = 0; i < map.mesh.count; i++)
    if (isSeed(i)) {
      included[i] = 1;
      queue.push(i);
    }
  for (let head = 0; head < queue.length; head++)
    for (let edge = 0; edge < map.mesh.degree[queue[head]]; edge++) {
      const j = map.mesh.neighbors[queue[head] * map.mesh.stride + edge];
      if (j < 0 || included[j] || !retains(j)) continue;
      included[j] = 1;
      queue.push(j);
    }
  return included;
}
/**
 * How much of each member cell a rule occupies: its declared coverage field mapped from floor
 * to full, or the whole cell when the rule declares none.
 */
export function ruleCoverage(
  state: GenerationState,
  field: MagicField,
  rule: MagicFeatureRule,
  members: Uint8Array,
  seed: number
) {
  const coverage = new Float64Array(members.length);
  if (!rule.coverage) {
    for (let i = 0; i < members.length; i++) coverage[i] = members[i];
    return coverage;
  }
  const read = conditionReader(state, field, { field: rule.coverage.field }, seed),
    { floor, full } = rule.coverage;
  for (let i = 0; i < members.length; i++)
    if (members[i]) coverage[i] = Math.min(1, Math.max(0, (read(i) - floor) / (full - floor)));
  return coverage;
}
