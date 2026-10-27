import type { GenerationState } from "../process";
import type { MagicField } from "./magicState";
import { PriorityQueue } from "./priorityQueue";
import { clamp, round } from "./math";
import { hashUnit } from "./noise";
import { edgeLeadingTo, triangleIdentity } from "./mesh";
import { oceanPropagation } from "./magicOcean";
import type { MagicPropagation, MagicSystem, NumericalVector } from "@atlas/domain";
import { retainedArray, workingArray, workingValues, releaseWorking } from "./physicalNumerics";
import { orderedIndices } from "./numericalOrder";
import { reservoirAmount, reservoirStock, withOrigin } from "./magicState";
import { applyWarding, wardPropagation } from "./magicHallowed";

function fracturePropagation(state: GenerationState, field: MagicField, activity: number) {
  const map = state.physical!.map,
    p = field.definition.parameters;
  field.parents = retainedArray(map, "int32", "magic:fracture-parents").fill(-1);
  const queue = new PriorityQueue<{ index: number; value: number }>(
    (a, b) => b.value - a.value || a.index - b.index,
    map.numerical,
    ["index", "value"]
  );
  for (let i = 0; i < map.mesh.count; i++)
    if (field.source[i] > 0) {
      field.intensity[i] = clamp(round(field.source[i] * activity), 0, 1000);
      queue.push({ index: i, value: field.intensity[i] });
    }
  while (queue.count) {
    const { index: i, value } = queue.pop();
    if (field.intensity[i] !== value) continue;
    for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
      const j = map.mesh.neighbors[i * map.mesh.stride + edge];
      // A ward seals the conduit: Fire does not enter, and its budget waits unspent.
      if (j < 0 || map.Warding[j] >= 0.5) continue;
      const conductance = (map.FractureConductance[i] + map.FractureConductance[j]) / 2;
      const next =
        value -
        ((p.baseCost + (1000 - conductance) / p.conductanceDivisor) *
          map.mesh.edgeLength[i * map.mesh.stride + edge]) /
          1000;
      if (next <= field.intensity[j]) continue;
      field.intensity[j] = next;
      field.parents[j] = i;
      queue.push({ index: j, value: next });
    }
  }
}
/**
 * Greenwood travels between roots: the cost of an edge falls as the living cover of the cell
 * it enters rises, and a cell that is bare rock (cover below the floor on thin soil), open
 * water or ice cannot be entered at all. The same priority queue as the fractures.
 */
function rootPropagation(state: GenerationState, field: MagicField, activity: number) {
  const map = state.physical!.map,
    p = field.definition.parameters;
  const cover = (i: number) => map.TreeCover[i] + map.GrassCover[i] + map.WetlandCover[i];
  const barrier = (i: number) =>
    map.WaterKindCodes[i] !== 0 ||
    map.IceThickness[i] > 0 ||
    (cover(i) < p.rootFloor && map.SoilDepth[i] < 0.3);
  field.parents = retainedArray(map, "int32", "magic:root-parents").fill(-1);
  const queue = new PriorityQueue<{ index: number; value: number }>(
    (a, b) => b.value - a.value || a.index - b.index,
    map.numerical,
    ["index", "value"]
  );
  for (let i = 0; i < map.mesh.count; i++)
    if (field.source[i] > 0) {
      field.intensity[i] = clamp(round(field.source[i] * activity), 0, 1000);
      queue.push({ index: i, value: field.intensity[i] });
    }
  while (queue.count) {
    const { index: i, value } = queue.pop();
    if (field.intensity[i] !== value) continue;
    for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
      const j = map.mesh.neighbors[i * map.mesh.stride + edge];
      if (j < 0 || barrier(j)) continue;
      const next =
        value -
        (p.rootCost * map.mesh.edgeLength[i * map.mesh.stride + edge]) / 1000 / (0.1 + cover(j));
      if (next <= field.intensity[j]) continue;
      field.intensity[j] = next;
      field.parents[j] = i;
      queue.push({ index: j, value: next });
    }
  }
}
function coldTarget(state: GenerationState, i: number, seed: number) {
  const map = state.physical!.map;
  let target = -1,
    lowest = 0,
    tie = -1;
  for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
    const j = map.mesh.neighbors[i * map.mesh.stride + edge];
    if (j < 0 || map.Temperature[j] >= map.Temperature[i]) continue;
    const score = hashUnit(
      seed ^ 0x4dcb,
      triangleIdentity(map.mesh, i),
      triangleIdentity(map.mesh, j)
    );
    const gradient =
      (map.Temperature[j] - map.Temperature[i]) / map.mesh.edgeLength[i * map.mesh.stride + edge];
    if (gradient < lowest || (gradient === lowest && score > tie)) {
      target = j;
      lowest = gradient;
      tie = score;
    }
  }
  return target;
}
function coldPropagation(state: GenerationState, field: MagicField, seed: number) {
  const map = state.physical!.map,
    p = field.definition.parameters;
  // Fresh fallout drains coldward. Existing charge stays in its ice carrier;
  // it contributes local concentration without being captured a second time.
  const iceStock = reservoirStock(field, "ice");
  const accumulation = workingValues(
    map,
    "float64",
    "magic:cold-accumulation",
    (i) => field.source[i] * map.mesh.areas[i]
  );
  // Equal temperatures cannot exchange charge: coldTarget requires a strictly colder cell.
  const order = orderedIndices(map.Temperature, true, map.numerical);
  for (const i of order) {
    const target = coldTarget(state, i, seed),
      capacity = clamp(map.IceThickness[i], 0, 900);
    const edge = edgeLeadingTo(map.mesh, i, target);
    const travel =
      edge >= 0 ? map.mesh.edgeLength[i * map.mesh.stride + edge] : Math.sqrt(map.mesh.areas[i]);
    const capture =
      1 - (1 - clamp(capacity / p.iceRetention, 0, 1)) ** (travel / p.coldRetentionDistance);
    const retained = accumulation[i] * capture;
    // Local input is an intensity. Only transported charge represents an upstream
    // physical area; treating the local cell's whole inventory as inflow makes
    // coarse cells brighter even on identical terrain with no coldward transport.
    const localIce = iceStock?.[i] ?? 0,
      incoming = Math.max(0, accumulation[i] - field.source[i] * map.mesh.areas[i]);
    const concentration =
      field.source[i] + localIce / map.mesh.areas[i] + incoming / p.accumulationArea;
    field.intensity[i] = clamp(
      round(Math.log2(concentration + 1) * p.logScale) + Math.trunc(capacity / 4),
      0,
      1000
    );
    field.retained[i] = retained;
    if (target >= 0) accumulation[target] += Math.max(0, accumulation[i] - retained);
  }
  releaseWorking(map, accumulation, order);
}
function radialPropagation(state: GenerationState, field: MagicField) {
  const work = state.physical!,
    map = work.map;
  for (const source of field.located) {
    const radius = source.radius || Math.max(1, field.definition.parameters.sourceSpacing);
    for (let i = 0; i < map.mesh.count; i++) {
      const distance = Math.hypot(map.mesh.x[i] - source.x, map.mesh.y[i] - source.y);
      field.intensity[i] = Math.max(
        field.intensity[i],
        source.strength * Math.max(0, 1 - distance / radius)
      );
    }
  }
}
interface PropagationStrategy {
  label: string;
  requires: string[];
  parameters: (keyof MagicSystem["parameters"])[];
  usesSourceRadius?: boolean;
  scaleResult: boolean;
  propagate(state: GenerationState, field: MagicField, seed: number, activity: number): void;
}
export const magicPropagationStrategies: Record<MagicPropagation, PropagationStrategy> = {
  fracture: {
    label: "Through connected fractures",
    requires: ["canonry:FractureState"],
    parameters: ["baseCost", "conductanceDivisor"],
    scaleResult: false,
    propagate: (state, field, _seed, activity) => fracturePropagation(state, field, activity),
  },
  "cold-drainage": {
    label: "Toward colder neighbors, retained in ice",
    requires: ["canonry:Temperature", "canonry:IceState"],
    parameters: ["logScale", "iceRetention", "coldRetentionDistance", "accumulationArea"],
    scaleResult: true,
    propagate: coldPropagation,
  },
  "ocean-rays": {
    label: "Ocean rays, reflections & wakes",
    requires: ["canonry:Ocean", "canonry:Bathymetry"],
    parameters: [
      "rayCount",
      "rayDistance",
      "coastalRayDistance",
      "wakeDistance",
      "beamWidth",
      "coastalSources",
      "coastalSourceDistance",
      "wakeSources",
    ],
    scaleResult: false,
    propagate: oceanPropagation,
  },
  radial: {
    label: "Radial falloff",
    requires: [],
    parameters: [],
    usesSourceRadius: true,
    scaleResult: true,
    propagate: radialPropagation,
  },
  // Life spreading between roots through connected cover; bare rock, open water and ice stop it.
  roots: {
    label: "Between roots through connected cover",
    requires: ["ecology"],
    parameters: ["rootCost", "rootFloor"],
    scaleResult: false,
    propagate: (state, field, _seed, activity) => rootPropagation(state, field, activity),
  },
  // Heat where the cores lie and nowhere else: a stock in gravel, not a conduit.
  local: {
    label: "Where the stock lies",
    requires: [],
    parameters: [],
    scaleResult: true,
    propagate: (_state, field) => field.intensity.set(field.source),
  },
  // Salt is where its material is: the brine, bed and dust per area of every origin, moved
  // between evaluations by the seep, the crust, the wind and the crust's own motion.
  brine: {
    label: "Brine, bed and dust where the material lies",
    // The wind is read from the workspace as the carriers find it; no producer is required
    // of it, since a world with no wind pass lifts no dust and is otherwise whole.
    requires: ["canonry:FlowRouting"],
    parameters: [
      "saltFull",
      "brineFlush",
      "seepShare",
      "crustShare",
      "dissolveShare",
      "dustShare",
      "dustSettle",
      "glassBed",
      "glassResistance",
      "desiccation",
      "domeStrain",
      "domeRise",
      "domeLimit",
      "domeSeep",
      "saltBurn",
    ],
    scaleResult: true,
    propagate: (state, field) => brinePropagation(state, field),
  },
  // Rings around kept seats and lines where they are kept; Aurora adds, an open conduit breaks.
  ward: {
    label: "Rings around kept seats, lines where they are kept",
    requires: [],
    parameters: ["wardReach", "auroraReinforce", "wardSpill"],
    scaleResult: true,
    propagate: (state, field) => wardPropagation(state, field),
  },
};
function brinePropagation(state: GenerationState, field: MagicField) {
  const areas = state.physical!.map.mesh.areas,
    full = field.definition.parameters.saltFull;
  for (let i = 0; i < field.intensity.length; i++) {
    let salt = 0;
    for (const reservoir of ["brine", "bed", "dust"]) salt += reservoirAmount(field, reservoir, i);
    field.intensity[i] = clamp(round((1000 * salt) / areas[i] / full), 0, 1000);
  }
}
export function propagateMagic(
  state: GenerationState,
  field: MagicField,
  seed: number,
  activity: number
) {
  const map = state.physical!.map;
  field.intensity.fill(0);
  field.wake.fill(0);
  field.rogue.fill(0);
  field.retained.fill(0);
  if (field.parents) releaseWorking(map, field.parents);
  delete field.parents;
  field.wakePaths = [];
  if (!field.definition.enabled) {
    field.source.fill(0);
    field.stored.fill(0);
    field.radii.fill(0);
    field.located = [];
    return;
  }
  if (activity <= 0) {
    field.source.fill(0);
    field.located = [];
    field.radii.fill(0);
  }
  const count = field.intensity.length,
    merged: MergedRun = {
      intensity: workingArray(map, "float64", "magic:merged-intensity", count),
      wake: workingArray(map, "float64", "magic:merged-wake", count),
      rogue: workingArray(map, "float64", "magic:merged-rogue", count),
      retained: workingArray(map, "float64", "magic:merged-retained", count),
      parents: undefined,
      wakePaths: [],
    };
  // Each origin propagates from its own sources with its own strategy; the field is the
  // maximum of their intensities, wakes and rogues and the sum of what they retained. A
  // source channel set directly, without locating, belongs to the first origin.
  if (activity > 0) {
    const external = sourceSetDirectly(field);
    field.definition.origins.forEach((origin, index) =>
      propagateOrigin(state, field, origin, seed, activity, merged, external && index === 0)
    );
  }
  field.wake.set(merged.wake);
  field.rogue.set(merged.rogue);
  field.retained.set(merged.retained);
  if (merged.parents) field.parents = merged.parents;
  else delete field.parents;
  field.wakePaths = merged.wakePaths;
  for (let i = 0; i < count; i++) {
    field.intensity[i] = clamp(round(merged.intensity[i] + field.stored[i]), 0, 1000);
    field.wake[i] *= Number(field.intensity[i] > 0);
  }
  applyWarding(state, field);
  releaseWorking(map, merged.intensity, merged.wake, merged.rogue, merged.retained);
}
interface MergedRun {
  intensity: NumericalVector;
  wake: NumericalVector;
  rogue: NumericalVector;
  retained: NumericalVector;
  parents: NumericalVector | undefined;
  wakePaths: number[][][];
}
/** Whether the shared source channel holds strength no origin located. */
function sourceSetDirectly(field: MagicField) {
  const own = Object.values(field.originSources);
  for (let i = 0; i < field.source.length; i++)
    if (field.source[i] > 0 && own.every((values) => values[i] < field.source[i])) return true;
  return false;
}
/** Run one origin's strategy on cleared channels and fold its result into the merge. */
function propagateOrigin(
  state: GenerationState,
  field: MagicField,
  origin: MagicSystem["origins"][number],
  seed: number,
  activity: number,
  merged: MergedRun,
  ownsShared: boolean
) {
  const strategy = magicPropagationStrategies[origin.propagation];
  field.intensity.fill(0);
  field.wake.fill(0);
  field.rogue.fill(0);
  field.retained.fill(0);
  delete field.parents;
  field.wakePaths = [];
  const source = field.source,
    located = field.located,
    shared = field.definition.origins.length === 1 || ownsShared;
  // One origin owns the whole source channel, which callers may have set directly; several
  // origins each propagate from their own.
  field.source = shared ? source : field.originSources[origin.id];
  field.located = shared ? located : located.filter((point) => point.origin === origin.id);
  try {
    withOrigin(field, origin, () => strategy.propagate(state, field, seed, activity));
  } finally {
    field.source = source;
    field.located = located;
  }
  const scalar = strategy.scaleResult ? activity : 1;
  for (let i = 0; i < merged.intensity.length; i++) {
    merged.intensity[i] = Math.max(merged.intensity[i], field.intensity[i] * scalar);
    merged.wake[i] = Math.max(merged.wake[i], field.wake[i]);
    merged.rogue[i] = Math.max(merged.rogue[i], field.rogue[i]);
    merged.retained[i] += field.retained[i];
  }
  merged.parents ??= field.parents;
  if (field.parents && field.parents !== merged.parents)
    releaseWorking(state.physical!.map, field.parents);
  merged.wakePaths.push(...field.wakePaths);
}
