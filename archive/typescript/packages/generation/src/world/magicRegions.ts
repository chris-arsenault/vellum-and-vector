import {
  MapScale,
  CellQueue,
  magicEcologyFields,
  type Band,
  type MagicCondition,
  type MagicFeatureRule,
  type ReadBand,
} from "@atlas/domain";
import { retainedArray } from "./physicalNumerics";
import { riverOrders } from "../water/riverKeeping";
import type { GenerationState } from "../process";
import type { PhysicalField } from "./field";
import type { MagicField } from "./magicState";
import { meshUnitNoise as unitNoise, hashUnit } from "./noise";
import { stockSurfaceReader } from "../rock/rockMagicStock";

/** The per-cell reader for one condition: a system's own channel, another system, or a physical field. */
export function conditionReader(
  state: GenerationState,
  field: MagicField,
  test: MagicCondition,
  seed: number,
  systemRead?: (id: string, cell: number) => number
) {
  const { map, magic } = state.physical!;
  const key = test.field;
  if (key.startsWith("system:")) {
    if (systemRead) return (i: number) => systemRead(key.slice(7), i);
    const participant = magic!.fields.find((candidate) => candidate.definition.id === key.slice(7));
    return (i: number) => (participant?.definition.enabled ? participant.intensity.get(i) : NaN);
  }
  if (key.startsWith("source:")) {
    const own = field.originSources[key.slice(7)];
    return (i: number) => own?.get(i) ?? 0;
  }
  // A surface rule reads accessible stock per area; a buried bed is not a surface feature.
  if (key.startsWith("stock:")) {
    const read = stockSurfaceReader(map, field, key.slice(6)),
      mesh = map.mesh;
    return (i: number) => read(i) / mesh.area(i);
  }
  if (key === "elevation")
    return (i: number) => MapScale.metres(map.Elevation.get(i) - map.EffectiveSeaLevel, "native");
  if (key === "slope") return (i: number) => map.Slope.get(i);
  if (key === "noise")
    return (i: number) =>
      unitNoise(
        map.mesh,
        map.mesh.x(i),
        map.mesh.y(i),
        test.salt ?? 0x621d,
        field.definition.parameters.featureNoiseScale,
        1
      );
  if (key === "scatter")
    return (i: number) =>
      hashUnit(
        seed ^ (test.salt ?? 0),
        Math.floor(map.mesh.x(i) / field.definition.parameters.featureNoiseScale),
        Math.floor(map.mesh.y(i) / field.definition.parameters.featureNoiseScale) ^
          (test.index ?? 0)
      );
  const band = channelValues(map, field)[key];
  return (i: number) => band?.get(i) ?? 0;
}
/** The named per-cell channels a condition may read directly. */
function channelValues(map: PhysicalField, field: MagicField): Record<string, ReadBand> {
  return {
    intensity: field.intensity,
    history: field.history,
    source: field.source,
    wake: field.wake,
    rogue: field.rogue,
    stored: field.stored,
    sealed: field.sealed,
    wild: field.wild,
    coastalHistory: field.coastalHistory,
    firstEpoch: field.firstEpoch,
    coastalFirstEpoch: field.coastalFirstEpoch,
    upwelling: map.Upwelling,
    quickening: map.Quickening,
    stillness: map.Stillness,
    fog: map.FogForcing,
    verdure: map.Verdure,
    temperature: map.Temperature,
    ice: map.IceThickness,
    water: map.WaterKindCodes,
    moisture: map.Moisture,
    geothermal: map.Geothermal,
    fracture: map.FractureConductance,
    landform: map.LandformCodes,
    river: riverOrders(map),
    ...Object.fromEntries(
      Object.entries(magicEcologyFields).map(([term, name]) => [term, map[name]])
    ),
  };
}
function matcher(
  state: GenerationState,
  field: MagicField,
  groups: MagicCondition[][],
  seed: number,
  systemRead?: (id: string, cell: number) => number
) {
  const conditions = groups.map((group) =>
    group.map((test) => {
      const read = conditionReader(state, field, test, seed, systemRead);
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
  seed: number,
  systemRead?: (id: string, cell: number) => number
) {
  const map = state.physical!.map;
  const included = retainedArray(map, "uint8", "magic:region-members"),
    queue = new CellQueue();
  const isSeed = matcher(state, field, rule.seeds, seed, systemRead),
    retains = matcher(state, field, rule.retains ?? rule.seeds, seed, systemRead);
  for (let i = 0; i < map.mesh.count; i++)
    if (isSeed(i)) {
      included.set(i, 1);
      queue.push(i);
    }
  for (let i = queue.shift(); i >= 0; i = queue.shift())
    for (let edge = 0; edge < map.mesh.degree(i); edge++) {
      const j = map.mesh.neighbor(i, edge);
      if (j < 0 || included.get(j) || !retains(j)) continue;
      included.set(j, 1);
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
  members: Band,
  seed: number
) {
  const coverage = retainedArray(
    state.physical!.map,
    "float64",
    `magic:coverage:${rule.id}`,
    members.length
  );
  if (!rule.coverage) {
    coverage.copyFrom(members);
    return coverage;
  }
  const read = conditionReader(state, field, { field: rule.coverage.field }, seed),
    { floor, full } = rule.coverage;
  for (let i = 0; i < members.length; i++)
    if (members.get(i))
      coverage.set(i, Math.min(1, Math.max(0, (read(i) - floor) / (full - floor))));
  return coverage;
}
