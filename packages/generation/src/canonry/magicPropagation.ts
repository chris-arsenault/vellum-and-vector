import type { GenerationState } from "../process";
import type { MagicField } from "./magicState";
import { PriorityQueue } from "./priorityQueue";
import { clamp, round } from "./math";
import { hashUnit } from "./noise";
import { edgeLeadingTo, triangleIdentity } from "./mesh";
import { oceanPropagation } from "./magicOcean";
import type { MagicSystem } from "@atlas/domain";

function fracturePropagation(state: GenerationState, field: MagicField, activity: number) {
  const map = state.physical!.map,
    p = field.definition.parameters;
  const queue = new PriorityQueue<{ index: number; value: number }>(
    (a, b) => b.value - a.value || a.index - b.index
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
      if (j < 0) continue;
      const conductance = (map.FractureConductance[i] + map.FractureConductance[j]) / 2;
      const next =
        value -
        ((p.baseCost + (1000 - conductance) / p.conductanceDivisor) *
          map.mesh.edgeLength[i * map.mesh.stride + edge]) /
          1000;
      if (next <= field.intensity[j]) continue;
      field.intensity[j] = next;
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
  const accumulation = Float64Array.from(field.source, (value, i) => value * map.mesh.areas[i]);
  const order = Array.from({ length: map.mesh.count }, (_, i) => i).sort(
    (a, b) => map.Temperature[b] - map.Temperature[a] || b - a
  );
  for (const i of order) {
    const target = coldTarget(state, i, seed),
      capacity = clamp(map.IceThickness[i], 0, 900);
    const edge = edgeLeadingTo(map.mesh, i, target);
    const travel =
      edge >= 0 ? map.mesh.edgeLength[i * map.mesh.stride + edge] : Math.sqrt(map.mesh.areas[i]);
    const capture =
      1 - (1 - clamp(capacity / p.iceRetention, 0, 1)) ** (travel / p.coldRetentionDistance);
    const retained = accumulation[i] * capture;
    field.intensity[i] = clamp(
      round(Math.log2(accumulation[i] / p.accumulationArea + 1) * p.logScale) +
        Math.trunc(capacity / 4),
      0,
      1000
    );
    field.retained[i] = retained;
    if (target >= 0) accumulation[target] += Math.max(0, accumulation[i] - retained);
  }
}
function radialPropagation(state: GenerationState, field: MagicField) {
  const work = state.physical!,
    map = work.map;
  for (const source of field.origins) {
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
export const magicPropagationStrategies: Record<MagicSystem["propagation"], PropagationStrategy> = {
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
};
export function propagateMagic(
  state: GenerationState,
  field: MagicField,
  seed: number,
  activity: number
) {
  field.intensity.fill(0);
  field.wake.fill(0);
  field.rogue.fill(0);
  field.retained.fill(0);
  if (!field.definition.enabled) {
    field.source.fill(0);
    field.stored.fill(0);
    field.radii.fill(0);
    field.origins = [];
    return;
  }
  if (activity <= 0) {
    field.source.fill(0);
    field.origins = [];
    field.radii.fill(0);
  }
  const strategy = magicPropagationStrategies[field.definition.propagation];
  if (activity > 0) strategy.propagate(state, field, seed, activity);
  const scalar = strategy.scaleResult ? activity : 1;
  for (let i = 0; i < field.intensity.length; i++) {
    field.intensity[i] = clamp(round(field.intensity[i] * scalar + field.stored[i]), 0, 1000);
    field.wake[i] *= Number(field.intensity[i] > 0);
  }
}
