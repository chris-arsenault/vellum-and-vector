import { magicSurfaceCode, putChannel, type MagicCondition } from "@atlas/domain";
import type { GenerationState } from "../process";
import type { MagicField } from "./magicState";
import { magicKey } from "./magicState";
import { classifyNaturalSurface } from "./naturalSurface";
import { meshUnitNoise as unitNoise, hashUnit } from "./noise";
import { projectedValues } from "./atlasSampling";
import {
  magicChannels,
  magicFieldDefinitions,
  publishedMagicChannels,
} from "./magicFieldDefinitions";

function conditionReader(
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
function growRegion(
  state: GenerationState,
  field: MagicField,
  rule: MagicField["definition"]["features"][number],
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
export function independentInteraction(
  rule: MagicField["definition"]["features"][number],
  owner: string
) {
  const conditions = [...rule.seeds, ...(rule.retains ?? [])].flat();
  const local = new Set<string>([...magicChannels, `system:${owner}`]);
  return (
    conditions.some((test) => test.field.startsWith("system:")) &&
    conditions.every((test) => !local.has(test.field))
  );
}
export function effectiveMagicRules(system: MagicField["definition"]) {
  return system.features.filter(
    (rule) => system.enabled || independentInteraction(rule, system.id)
  );
}
export function classifyMagicFeatures(state: GenerationState, seed = state.domain.world.seed) {
  classifyNaturalSurface(state);
  const magic = state.physical!.magic!;
  const priority = new Float64Array(magic.finalSurface.length).fill(-Infinity);
  const definitions = magic.fields.map((field) => field.definition);
  for (const field of magic.fields) {
    field.features = {};
    const effective = new Set(effectiveMagicRules(field.definition));
    for (const rule of field.definition.features) {
      if (!effective.has(rule)) continue;
      const surfaceCode = magicSurfaceCode(definitions, field.definition.id, rule.id)!;
      const members = growRegion(state, field, rule, seed);
      field.features[rule.id] = members;
      for (let i = 0; i < members.length; i++)
        if (members[i] && rule.priority > priority[i]) {
          magic.finalSurface[i] = surfaceCode;
          priority[i] = rule.priority;
        }
    }
  }
}
export function projectMagic(state: GenerationState) {
  const work = state.physical!,
    magic = work.magic;
  if (!magic) return;
  const project = (
    key: string,
    unit: string,
    values: ArrayLike<number>,
    quantity: "intensive" | "extensive" | "category"
  ) =>
    putChannel(state.surface, key, unit, projectedMagicValues(state, values, quantity), quantity);
  project("naturalSurface", "category", magic.naturalSurface, "category");
  project("finalSurface", "category", magic.finalSurface, "category");
  project("quickening", "ratio", work.map.Quickening, "intensive");
  project("stillness", "ratio", work.map.Stillness, "intensive");
  project("fog", "ratio", work.map.FogForcing, "intensive");
  project("icePersistence", "ratio", work.map.IcePersistence, "intensive");
  for (const field of magic.fields) {
    for (const channel of publishedMagicChannels)
      project(
        magicKey(field, channel),
        magicFieldDefinitions[channel].unit,
        field[channel],
        magicFieldDefinitions[channel].quantity
      );
    for (const [id, members] of Object.entries(field.features))
      project(magicKey(field, `feature:${id}`), "category", members, "category");
  }
}
function projectedMagicValues(
  state: GenerationState,
  values: ArrayLike<number>,
  quantity: "intensive" | "extensive" | "category"
) {
  const work = state.physical!;
  if (quantity !== "extensive" || !work.interpolation)
    return projectedValues(work, values, quantity === "category");
  const density = Float64Array.from(work.map.mesh.areas, (area, i) => values[i] / area);
  return projectedValues(work, density).map((value, i) => value * state.surface.measures[i]);
}
