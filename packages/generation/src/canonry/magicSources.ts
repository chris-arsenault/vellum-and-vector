import type { GenerationState } from "../process";
import type { MagicField } from "./magicState";
import { hashUnit } from "./noise";
import { triangleIdentity, nearestTriangle } from "./mesh";
import { clamp, round } from "./math";
import { BoundedCandidates } from "./priorityQueue";
import { triangleDistanceSquared } from "./radial";

function geothermalSources(state: GenerationState, field: MagicField, seed: number) {
  const map = state.physical!.map,
    p = field.definition.parameters;
  if (p.maximumSources === 0) return;
  const candidates = geothermalCandidates(state, field, seed);
  const selected: number[] = [];
  for (const i of candidates) {
    const spacing = p.sourceSpacing + (1000 - map.HeatSourceDensity[i]) / 150;
    if (selected.some((j) => triangleDistanceSquared(map.mesh, i, j) < spacing ** 2)) continue;
    selected.push(i);
    if (selected.length >= p.maximumSources) break;
  }
  if (!selected.length)
    selected.push(strongestHeatSource(map.HeatSourceDensity, map.mesh.contentCount));
  for (const i of selected)
    field.source[i] = clamp(720 + Math.trunc(map.HeatSourceDensity[i] / 3), 1, 1000);
}
function geothermalCandidates(state: GenerationState, field: MagicField, seed: number) {
  const map = state.physical!.map,
    p = field.definition.parameters;
  const candidates = new BoundedCandidates(map.mesh.contentCount);
  for (let i = 0; i < map.mesh.contentCount; i++) {
    const density = map.HeatSourceDensity[i];
    if (density < p.sourceThreshold || !isMaximum(map.HeatSourceDensity, map.mesh.neighbors, i))
      continue;
    candidates.consider(i, density * 1000 + hashUnit(seed, triangleIdentity(map.mesh, i), 0) * 999);
  }
  return candidates.bestIndexes();
}
function strongestHeatSource(values: Int32Array, count: number) {
  let strongest = 0;
  for (let i = 1; i < count; i++) if (values[i] > values[strongest]) strongest = i;
  return strongest;
}
function isMaximum(values: Int32Array, neighbors: Int32Array, i: number) {
  for (let edge = 0; edge < 3; edge++) {
    const j = neighbors[i * 3 + edge];
    if (j >= 0 && values[j] > values[i]) return false;
  }
  return true;
}
function oceanSource(state: GenerationState, field: MagicField) {
  const map = state.physical!.map;
  let best = -1,
    score = -Infinity;
  for (let i = 0; i < map.mesh.contentCount; i++) {
    if (map.WaterKindCodes[i] !== 1) continue;
    let depth = map.WaterDepths[i];
    for (let edge = 0; edge < 3; edge++) {
      const j = map.mesh.neighbors[i * 3 + edge];
      if (j >= 0) depth += Math.max(0, map.WaterDepths[i] - map.WaterDepths[j]);
    }
    if (depth > score) {
      best = i;
      score = depth;
    }
  }
  if (best >= 0) field.source[best] = 1000;
}
function placedSources(state: GenerationState, field: MagicField, epochIndex: number) {
  const work = state.physical!;
  for (const source of state.domain.world.magic) {
    if (source.systemId !== field.definition.id) continue;
    if (source.spaceId && source.spaceId !== state.domain.scope.spaceId) continue;
    if (source.startsAtEpoch > epochIndex) continue;
    const i = nearestTriangle(
      work.map.mesh,
      (source.source.x - work.center[0]) / work.metresPerStep,
      (source.source.y - work.center[1]) / work.metresPerStep
    );
    if (i >= 0) {
      field.source[i] = clamp(round(source.strength), 0, 1000);
      field.radii[i] = source.radius / work.metresPerStep;
    }
  }
}
export function locateMagicSources(
  state: GenerationState,
  field: MagicField,
  seed: number,
  epochIndex = 0
) {
  field.source.fill(0);
  field.radii.fill(0);
  const map = state.physical!.map,
    definition = field.definition;
  if (definition.source === "geothermal") geothermalSources(state, field, seed);
  if (definition.source === "deep-ocean") oceanSource(state, field);
  if (definition.source === "cold")
    for (let i = 0; i < map.mesh.count; i++)
      field.source[i] = Math.max(
        0,
        definition.parameters.baseInput -
          map.Temperature[i] +
          Math.max(0, map.Elevation[i] / 1024) / 10
      );
  placedSources(state, field, epochIndex);
}
