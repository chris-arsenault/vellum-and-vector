import type { GenerationState } from "../process";
import type { MagicField } from "./magicState";
import { nearestTriangle } from "./mesh";
import { clamp, round } from "./math";
import { worldCandidates, separatedCandidates } from "./worldSources";
import { areaBudget, mediumArea, referenceLandArea, referenceOceanArea } from "./worldScale";
import type { PhysicalField } from "./field";
import { hashUnit } from "./noise";
import type { MagicSystem } from "@atlas/domain";

function isHeatMaximum(map: PhysicalField, start: number, radius: number) {
  const { mesh, HeatSourceDensity: density } = map;
  for (let edge = 0; edge < mesh.degree[start]; edge++) {
    const j = mesh.neighbors[start * mesh.stride + edge];
    if (j >= 0 && density[j] > density[start]) return false;
  }
  const queue = [start],
    visited = new Set(queue);
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    if (density[i] > density[start]) return false;
    for (let edge = 0; edge < mesh.degree[i]; edge++) {
      const j = mesh.neighbors[i * mesh.stride + edge];
      if (j < 0 || visited.has(j)) continue;
      visited.add(j);
      if (Math.hypot(mesh.x[j] - mesh.x[start], mesh.y[j] - mesh.y[start]) <= radius) queue.push(j);
    }
  }
  return true;
}

function geothermalSources(state: GenerationState, field: MagicField, seed: number) {
  const map = state.physical!.map,
    p = field.definition.parameters;
  if (p.maximumSources === 0) return;
  const budget = areaBudget(
    p.maximumSources,
    mediumArea(map, (i) => map.WaterKindCodes[i] !== 1),
    referenceLandArea
  );
  if (budget === 0) return;
  const candidates = geothermalCandidates(state, field, seed);
  const selected: typeof candidates = [];
  for (const source of candidates) {
    const i = source.i;
    const spacing = p.sourceSpacing + ((1000 - map.HeatSourceDensity[i]) * 10_000) / 150;
    if (selected.some((j) => Math.hypot(source.x - j.x, source.y - j.y) < spacing)) continue;
    selected.push(source);
    if (selected.length >= budget) break;
  }
  if (!selected.length) {
    const i = strongestHeatSource(map.HeatSourceDensity, map.mesh.contentCount);
    selected.push({ i, id: -1, x: map.mesh.x[i], y: map.mesh.y[i], priority: 0 });
  }
  for (const source of selected) {
    const i = source.i;
    field.source[i] = clamp(720 + Math.trunc(map.HeatSourceDensity[i] / 3), 1, 1000);
    field.origins.push({
      id: `geothermal:${seed}:${source.id}`,
      x: source.x,
      y: source.y,
      radius: p.sourceSpacing,
      strength: field.source[i],
    });
  }
}
function geothermalCandidates(state: GenerationState, field: MagicField, seed: number) {
  const map = state.physical!.map,
    p = field.definition.parameters;
  const radius = p.sourceSpacing / 2;
  const maximum = map.HeatSourceDensity.reduce((peak, value) => Math.max(peak, value), 0);
  const candidates = [];
  for (let i = 0; i < map.mesh.contentCount; i++) {
    if (map.HeatSourceDensity[i] < p.sourceThreshold) continue;
    // Fire rises through fractures in the crust under land; the sea floor belongs to
    // Pressure, and its heat shows as vents through the geothermal field, not as cores.
    if (map.WaterKindCodes[i] === 1) continue;
    // A conduit that sealed after carrying its budget no longer feeds a core.
    if (field.sealed[i] > 0) continue;
    if (map.HeatSourceDensity[i] !== maximum && !isHeatMaximum(map, i, radius)) continue;
    const x = map.mesh.x[i],
      y = map.mesh.y[i];
    const priority = hashUnit(seed, Math.floor(x / radius), Math.floor(y / radius));
    candidates.push({ i, id: Math.round(priority * 2147483647), x, y, priority });
  }
  return candidates.sort(
    (a, b) => map.HeatSourceDensity[b.i] - map.HeatSourceDensity[a.i] || b.priority - a.priority
  );
}
function strongestHeatSource(values: Int32Array, count: number) {
  let strongest = 0;
  for (let i = 1; i < count; i++) if (values[i] > values[strongest]) strongest = i;
  return strongest;
}
function oceanSource(state: GenerationState, field: MagicField, seed: number) {
  const map = state.physical!.map;
  const budget = areaBudget(
    1,
    mediumArea(map, (i) => map.WaterKindCodes[i] === 1),
    referenceOceanArea
  );
  const candidates = [];
  for (const source of worldCandidates(map.mesh, seed, Math.max(2048, budget * 64))) {
    const i = nearestTriangle(map.mesh, source.x, source.y);
    if (i < 0 || i >= map.mesh.contentCount || map.WaterKindCodes[i] !== 1) continue;
    let depth = map.WaterDepths[i];
    for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
      const j = map.mesh.neighbors[i * map.mesh.stride + edge];
      if (j >= 0)
        depth +=
          ((Math.max(0, map.WaterDepths[i] - map.WaterDepths[j]) /
            map.mesh.edgeLength[i * map.mesh.stride + edge]) *
            10_000) /
          map.mesh.degree[i];
    }
    candidates.push({ ...source, i, score: depth });
  }
  candidates.sort((a, b) => b.score - a.score || b.priority - a.priority);
  const selected = separatedCandidates(
    candidates,
    budget,
    field.definition.parameters.rayDistance / 2
  );
  for (const source of selected) {
    const i = nearestTriangle(map.mesh, source.x, source.y);
    field.source[i] = 1000;
    field.origins.push({
      id: `deep-ocean:${source.id}`,
      x: source.x,
      y: source.y,
      radius: field.definition.parameters.beamWidth,
      strength: 1000,
    });
  }
}
function placedSources(state: GenerationState, field: MagicField, epochIndex: number) {
  const work = state.physical!;
  for (const source of state.domain.world.magic) {
    if (source.systemId !== field.definition.id) continue;
    if (source.spaceId && source.spaceId !== state.domain.scope.spaceId) continue;
    if (source.startsAtEpoch > epochIndex) continue;
    const i = nearestTriangle(
      work.map.mesh,
      source.source.x - work.map.mesh.origin[0],
      source.source.y - work.map.mesh.origin[1]
    );
    if (i >= 0) {
      field.source[i] = clamp(round(source.strength), 0, 1000);
      field.radii[i] = source.radius;
      field.origins.push({
        id: source.id,
        x: source.source.x - work.map.mesh.origin[0],
        y: source.source.y - work.map.mesh.origin[1],
        radius: source.radius,
        strength: source.strength,
      });
    }
  }
}
function coldSources(state: GenerationState, field: MagicField) {
  const map = state.physical!.map;
  for (let i = 0; i < map.mesh.count; i++)
    field.source[i] = Math.max(
      0,
      field.definition.parameters.baseInput -
        map.Temperature[i] +
        Math.max(0, map.Elevation[i] / 1024) / 10
    );
}
interface SourceStrategy {
  label: string;
  requires: string[];
  parameters: (keyof MagicSystem["parameters"])[];
  radiusParameter?: keyof MagicSystem["parameters"];
  locate(state: GenerationState, field: MagicField, seed: number): void;
}
/** The operation and its contract/applicability share one strategy declaration. */
export const magicSourceStrategies: Record<MagicSystem["source"], SourceStrategy> = {
  geothermal: {
    label: "Geothermal maxima & placed cores",
    requires: ["canonry:Geothermal"],
    parameters: ["maximumSources", "sourceThreshold", "sourceSpacing"],
    radiusParameter: "sourceSpacing",
    locate: geothermalSources,
  },
  cold: {
    label: "Cold terrain & high ground",
    requires: ["canonry:Temperature", "canonry:Elevation"],
    parameters: ["baseInput"],
    locate: coldSources,
  },
  "deep-ocean": {
    label: "Deep ocean locus",
    requires: ["canonry:Ocean", "canonry:Bathymetry"],
    parameters: [],
    radiusParameter: "beamWidth",
    locate: oceanSource,
  },
  placed: {
    label: "Only sources placed on the map",
    requires: [],
    parameters: [],
    locate: () => undefined,
  },
};
export function locateMagicSources(
  state: GenerationState,
  field: MagicField,
  seed: number,
  epochIndex = 0
) {
  field.source.fill(0);
  field.radii.fill(0);
  field.origins = [];
  if (!field.definition.enabled) return;
  magicSourceStrategies[field.definition.source].locate(state, field, seed);
  placedSources(state, field, epochIndex);
}
