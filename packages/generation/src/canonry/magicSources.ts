import { nearestTriangle } from "./mesh";
import type { GenerationState } from "../process";
import type { MagicField } from "./magicState";
import { clamp, round } from "./math";
import { worldCandidates, separatedCandidates } from "./worldSources";
import { areaBudget, mediumArea, referenceOceanArea } from "./worldScale";
import type { PhysicalField } from "./field";
import { type Band, type MagicOrigin, type MagicSource, type MagicSystem } from "@atlas/domain";
import { originStocks, stockKey, systemSeed, withOrigin } from "./magicState";
import { geothermalSources } from "./magicGeothermalSources";
import { impactSources } from "./magicFallenSources";
import { aquiferSources, forgeSources, verdantSources } from "./magicGreenwoodSources";
import { deadLakeSources, deathSources } from "./magicSaltSources";
import { keptLineSources, tenureSources } from "./magicHallowed";
import { pairingSources, strainSources } from "./magicVeil";
import { workingArray, releaseWorking } from "./physicalNumerics";

function oceanSource(state: GenerationState, field: MagicField, seed: number) {
  const map = state.physical!.map;
  const budget = areaBudget(
    1,
    mediumArea(map, (i) => map.WaterKindCodes.get(i) === 1),
    referenceOceanArea
  );
  const candidates = [];
  for (const source of worldCandidates(map.mesh, seed, Math.max(2048, budget * 64))) {
    const i = nearestTriangle(map.mesh, source.x, source.y);
    if (i < 0 || map.mesh.membership(i) !== 1 || map.WaterKindCodes.get(i) !== 1) continue;
    let depth = map.WaterDepths.get(i);
    const here = map.WaterDepths.get(i),
      degree = map.mesh.degree(i);
    for (let edge = 0; edge < degree; edge++) {
      const j = map.mesh.neighbor(i, edge);
      if (j >= 0)
        depth +=
          ((Math.max(0, here - map.WaterDepths.get(j)) / map.mesh.edgeLength(i, edge)) * 10_000) /
          degree;
    }
    candidates.push({ ...source, i, score: depth });
  }
  // hpc-exempt: seeded candidate objects that separatedCandidates consumes as records.
  candidates.sort((a, b) => b.score - a.score || b.priority - a.priority);
  const selected = separatedCandidates(
    candidates,
    budget,
    field.definition.parameters.rayDistance / 2,
    map.mesh
  );
  for (const source of selected) {
    const i = nearestTriangle(map.mesh, source.x, source.y);
    field.source.set(i, 1000);
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
      field.source.set(i, clamp(round(source.strength), 0, 1000));
      field.radii.set(i, source.radius);
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
    field.source.set(
      i,
      Math.max(
        0,
        field.definition.parameters.baseInput -
          map.Temperature.get(i) +
          Math.max(0, map.Elevation.get(i) / 1024) / 10
      )
    );
}
export interface LocateContext {
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
    // Its stocks are the charge in ice, ground, moraine and shelf, kept by the stock advance.
    managesStock: true,
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
  verdant: {
    label: "Old stands, deep peat and planted sap",
    requires: ["ecology"],
    parameters: ["standAge", "standCover", "peatDepth", "groveSap", "sapLoss"],
    // Its sap is refilled by stands and added to by herds and people; the advance decays it.
    managesStock: true,
    locate: verdantSources,
  },
  aquifer: {
    label: "Springs on soft rock below a catchment",
    requires: ["canonry:FlowRouting", "canonry:Elevation"],
    parameters: ["springFlow", "springRock", "overdrawShare", "sinkDepth"],
    locate: aquiferSources,
  },
  impact: {
    label: "Fallen cores around impact craters",
    // Reads the impact events and the wind the workspace already holds; a world without
    // impacts or an un-run wind simply seeds nothing, so Fire's pass needs no producer here.
    requires: [],
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
  forge: {
    label: "Forges where people crack carried cores",
    requires: [],
    parameters: ["forgeStrength", "forgeCooling"],
    managesStock: true,
    locate: forgeSources,
  },
  death: {
    label: "The dead the ground records",
    requires: [],
    parameters: ["saltPerDeath", "saltFull"],
    managesStock: true,
    locate: deathSources,
  },
  "dead-lake": {
    label: "Lakes that died in a closed basin",
    requires: ["canonry:Lakes", "canonry:Elevation"],
    parameters: ["saltPerLakeMetre", "saltFull"],
    managesStock: true,
    locate: deadLakeSources,
  },
  tenure: {
    label: "Seats people have kept, by their tenure",
    requires: [],
    parameters: ["tenureFull", "pilgrimageBonus"],
    locate: tenureSources,
  },
  "kept-line": {
    label: "Lines people keep and roads pilgrims wear",
    requires: [],
    parameters: ["lineFull", "roadFull"],
    locate: keptLineSources,
  },
  strain: {
    label: "Strain between every other system",
    requires: [],
    parameters: ["tearFloor", "tearFull", "wildShift", "knitVerdure", "holdSalting"],
    locate: strainSources,
  },
  pairing: {
    label: "Stable tears paired into doors",
    requires: [],
    parameters: ["doorStrain", "doorDistance", "doorMatch", "doorCount"],
    locate: pairingSources,
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
  const map = state.physical!.map,
    merged = workingArray(map, "float64", "magic:merged-source", count),
    radii = workingArray(map, "float64", "magic:merged-radii", count);
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
    field.originSources[origin.id].copyFrom(field.source);
    for (let i = 0; i < count; i++) {
      const strength = field.source.get(i);
      if (strength > merged.get(i)) {
        merged.set(i, strength);
        radii.set(i, field.radii.get(i));
      }
    }
  });
  field.source.copyFrom(merged);
  field.radii.copyFrom(radii);
  releaseWorking(map, merged, radii);
  // An origin whose strategy does not keep a stock of its own holds its located strength as
  // an amount in its first reservoir: strength times the cell's area, so the stock can be
  // carried and its budget closed. A finite origin's stock is the source, not the mirror.
  mirrorHeldStocks(map, field, count);
}
function mirrorHeldStocks(map: PhysicalField, field: MagicField, count: number) {
  for (const origin of field.definition.origins) {
    if (magicSourceStrategies[origin.source].managesStock) continue;
    const own: Band = field.originSources[origin.id],
      held = field.stocks[stockKey(origin, originStocks(origin)[0])];
    for (let i = 0; i < count; i++) held.set(i, own.get(i) * map.mesh.area(i));
  }
}
