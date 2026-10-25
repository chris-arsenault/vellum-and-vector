import { meshDeltaX } from "./mesh";
import type { GenerationState } from "../process";
import type { MagicField } from "./magicState";
import { nearestTriangle } from "./mesh";
import { clamp, round } from "./math";
import { worldCandidates, separatedCandidates } from "./worldSources";
import { areaBudget, mediumArea, referenceLandArea, referenceOceanArea } from "./worldScale";
import type { PhysicalField } from "./field";
import { hashUnit } from "./noise";
import type { MagicOrigin, MagicSource, MagicSystem } from "@atlas/domain";
import { originStocks, stockKey, systemSeed, withOrigin } from "./magicState";
import { exposure, heldStock, releaseShare } from "./magicStocks";

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
      if (
        Math.hypot(meshDeltaX(mesh, mesh.x[j] - mesh.x[start]), mesh.y[j] - mesh.y[start]) <= radius
      )
        queue.push(j);
    }
  }
  return true;
}

function geothermalSources(
  state: GenerationState,
  field: MagicField,
  seed: number,
  context?: LocateContext
) {
  const map = state.physical!.map,
    p = field.definition.parameters;
  if (context) exhumedSpent(map, field, context.origin);
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
    if (
      selected.some(
        (j) => Math.hypot(meshDeltaX(map.mesh, source.x - j.x), source.y - j.y) < spacing
      )
    )
      continue;
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
    field.located.push({
      origin: "",
      id: `geothermal:${seed}:${source.id}`,
      x: source.x,
      y: source.y,
      radius: p.sourceSpacing,
      strength: field.source[i],
    });
  }
}
/**
 * Old mountains are Fire country: the spent ore of sealed conduits, carried with the crust
 * and buried, feeds the source again at reduced strength where erosion has exposed it.
 */
function exhumedSpent(map: PhysicalField, field: MagicField, origin: MagicOrigin) {
  const spent = field.stocks[`${origin.id}/spent`],
    p = field.definition.parameters;
  if (!spent) return;
  for (let i = 0; i < map.mesh.count; i++) {
    if (spent[i] <= 0 || map.WaterKindCodes[i] === 1) continue;
    const strength =
      (exposure(map, i, p.buryDepth) * spent[i] * p.exhumedRelease) / map.mesh.areas[i];
    if (strength >= 1) field.source[i] = Math.max(field.source[i], clamp(round(strength), 1, 1000));
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
    // A conduit that sealed after carrying its budget no longer feeds a core, unless new
    // strain across it has cracked the seal: then it reopens with part of its budget left.
    if (field.sealed[i] > 0) {
      if (map.TectonicStrain[i] < p.reopenStrain) continue;
      field.sealed[i] = 0;
      field.history[i] = Math.min(field.history[i], p.conduitBudget * (1 - p.reopenShare));
    }
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
    field.definition.parameters.rayDistance / 2,
    map.mesh
  );
  for (const source of selected) {
    const i = nearestTriangle(map.mesh, source.x, source.y);
    field.source[i] = 1000;
    field.located.push({
      origin: "",
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
      field.located.push({
        origin: "",
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
interface LocateContext {
  origin: MagicOrigin;
  epochIndex: number;
}
interface SourceStrategy {
  label: string;
  requires: string[];
  parameters: (keyof MagicSystem["parameters"])[];
  radiusParameter?: keyof MagicSystem["parameters"];
  /** The strategy seeds and draws its own stock; the locate step must not mirror over it. */
  managesStock?: boolean;
  locate(state: GenerationState, field: MagicField, seed: number, context: LocateContext): void;
}
/**
 * Fallen cores. Each impact seeds a finite stock once, on the crater and its ejecta in
 * proportion to the ejecta's thickness and elongated downwind. Every evaluation the exposed
 * stock releases a share set by the cracking agents at work, and that release is the source;
 * the impact's own heat is a coreless source that fades with the epochs since the fall.
 */
function impactSources(
  state: GenerationState,
  field: MagicField,
  _seed: number,
  { origin, epochIndex }: LocateContext
) {
  const map = state.physical!.map,
    p = field.definition.parameters,
    held = heldStock(field, origin);
  for (const event of map.events) {
    if (event.kind !== "impact" || event.epoch > epochIndex) continue;
    field.located.push({
      origin: "",
      id: event.id,
      x: event.x,
      y: event.y,
      radius: event.radius,
      strength: 1000,
    });
    if (!field.seeded.has(event.id)) seedFallenStock(map, field, held, event, epochIndex);
  }
  for (let i = 0; i < map.mesh.count; i++) {
    field.releasing[i] = 0;
    let strength = 0;
    if (held[i] > 0) {
      field.releasing[i] = exposure(map, i, p.buryDepth) * releaseShare(map, field, i, epochIndex);
      strength = (held[i] * field.releasing[i]) / map.mesh.areas[i];
    }
    if (map.ImpactHeat[i] > 0) {
      const since = Math.max(0, epochIndex - Math.max(0, field.arrival[i]));
      strength = Math.max(strength, (map.ImpactHeat[i] * p.impactHeatShare) / (1 + since));
    }
    if (strength > 0) field.source[i] = clamp(round(strength), 1, 1000);
  }
}
function seedFallenStock(
  map: PhysicalField,
  field: MagicField,
  held: Float64Array,
  event: PhysicalField["events"][number],
  epochIndex: number
) {
  field.seeded.add(event.id);
  const centre = nearestTriangle(map.mesh, event.x, event.y);
  if (centre < 0) return;
  const p = field.definition.parameters,
    wx = map.WindX[centre] / 1000,
    wy = map.WindY[centre] / 1000;
  let total = 0;
  for (let i = 0; i < map.mesh.count; i++) {
    const dx = meshDeltaX(map.mesh, map.mesh.x[i] - event.x),
      dy = map.mesh.y[i] - event.y,
      distance = Math.hypot(dx, dy);
    if (distance > event.radius * 2.4) continue;
    const ejecta = map.ImpactEjectaThickness[i] / 1024,
      downwind = distance > 0 ? Math.max(0, (dx * wx + dy * wy) / distance) : 0,
      amount = ejecta * map.mesh.areas[i] * p.fallenDensity * (1 + 0.6 * downwind);
    if (amount <= 0) continue;
    held[i] += amount;
    total += amount;
    field.arrival[i] = Math.max(field.arrival[i], epochIndex);
  }
  // The body itself: a fifth again of the fan's stock lies in the crater.
  held[centre] += total * 0.2;
  field.arrival[centre] = Math.max(field.arrival[centre], epochIndex);
}
/** The operation and its contract/applicability share one strategy declaration. */
export const magicSourceStrategies: Record<MagicSource, SourceStrategy> = {
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
  impact: {
    label: "Fallen cores around impact craters",
    requires: ["canonry:Impacts", "canonry:Wind"],
    managesStock: true,
    parameters: [
      "fallenDensity",
      "fallenRelease",
      "strainCracking",
      "iceCracking",
      "iceCrackDepth",
      "frostCracking",
      "impactShock",
      "impactHeatShare",
      "placerMobility",
      "buryDepth",
      "fanBarrenEpochs",
      "fanBarrenDepth",
    ],
    locate: impactSources,
  },
};
/**
 * Locate every origin. Each runs its own strategy on a cleared source channel with its own
 * parameters and seed; the field's source is the maximum over origins and keeps the radius
 * of the origin that set it. Sources placed on the map join the first origin. A system with
 * one origin locates exactly as it did before origins existed.
 */
export function locateMagicSources(
  state: GenerationState,
  field: MagicField,
  seed: number,
  epochIndex = 0
) {
  const count = field.source.length;
  field.source.fill(0);
  field.radii.fill(0);
  field.located = [];
  for (const origin of field.definition.origins) field.originSources[origin.id].fill(0);
  if (!field.definition.enabled) return;
  const merged = new Float64Array(count),
    radii = new Float64Array(count);
  field.definition.origins.forEach((origin, index) => {
    field.source.fill(0);
    field.radii.fill(0);
    const before = field.located.length;
    withOrigin(field, origin, () => {
      magicSourceStrategies[origin.source].locate(
        state,
        field,
        index === 0 ? seed : systemSeed(seed, origin.id),
        { origin, epochIndex }
      );
      if (index === 0) placedSources(state, field, epochIndex);
    });
    for (let n = before; n < field.located.length; n++) field.located[n].origin = origin.id;
    field.originSources[origin.id].set(field.source);
    for (let i = 0; i < count; i++)
      if (field.source[i] > merged[i]) {
        merged[i] = field.source[i];
        radii[i] = field.radii[i];
      }
  });
  field.source.set(merged);
  field.radii.set(radii);
  // An origin whose strategy does not keep a stock of its own holds its located strength as
  // an amount in its first reservoir: strength times the cell's area, so the stock can be
  // carried and its budget closed. A finite origin's stock is the source, not the mirror.
  const areas = state.physical!.map.mesh.areas;
  for (const origin of field.definition.origins) {
    if (magicSourceStrategies[origin.source].managesStock) continue;
    const own = field.originSources[origin.id],
      held = field.stocks[stockKey(origin, originStocks(origin)[0])];
    for (let i = 0; i < count; i++) held[i] = own[i] * areas[i];
  }
}
