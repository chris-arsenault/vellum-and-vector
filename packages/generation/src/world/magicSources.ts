import { nearestTriangle } from "./mesh";
import type { GenerationState } from "../process";
import type { MagicField } from "./magicState";
import { clamp, round } from "./math";
import { worldCandidates, separatedCandidates } from "./worldSources";
import { areaBudget, mediumArea } from "./worldScale";
import type { PhysicalField } from "./field";
import { MapScale, type MagicOrigin, type MagicSource, type MagicSystem } from "@atlas/domain";
import { systemSeed, withOrigin } from "./magicState";
import { geothermalSources, reopenConduits } from "./magicGeothermalSources";
import { impactSources, supplyFallenCores } from "./magicFallenSources";
import { aquiferSources, forgeSources, verdantSources, supplySap } from "./magicGreenwoodSources";
import { saltSources, supplyDeathSalt, supplyLakeSalt } from "./magicSaltSources";
import { keptLineSources, tenureSources } from "./magicHallowed";
import { pairingSources, strainSources } from "./magicVeil";
import { workingArray, releaseWorking } from "./physicalNumerics";

/** What a sea cell is worth as a deep locus: its depth, more for a steep drop around it. */
export function deepSiteScore(map: PhysicalField, i: number) {
  const here = map.WaterDepths.get(i),
    degree = map.mesh.degree(i);
  let depth = here;
  for (let edge = 0; edge < degree; edge++) {
    const j = map.mesh.neighbor(i, edge);
    if (j >= 0)
      depth +=
        ((Math.max(0, here - map.WaterDepths.get(j)) / map.mesh.edgeLength(i, edge)) *
          map.scale.length(0.0025)) /
        degree;
  }
  return depth;
}
function oceanSource(state: GenerationState, field: MagicField, seed: number) {
  const map = state.physical!.map;
  const budget = areaBudget(
    1,
    mediumArea(map, (i) => map.WaterKindCodes.get(i) === 1),
    map.scale.area(0.39)
  );
  const candidates = [];
  for (const source of worldCandidates(map.mesh, seed, Math.max(2048, budget * 64))) {
    const i = nearestTriangle(map.mesh, source.x, source.y);
    if (i < 0 || map.mesh.membership(i) !== 1 || map.WaterKindCodes.get(i) !== 1) continue;
    candidates.push({ ...source, i, score: deepSiteScore(map, i) });
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
    const i = nearestTriangle(map.mesh, source.x, source.y),
      strength = pressureAtDepth(
        MapScale.metres(map.WaterDepths.get(i), "native"),
        map.scale.length(0.0005)
      );
    field.source.set(i, strength);
    field.located.push({
      origin: "",
      id: `deep-ocean:${source.id}`,
      x: source.x,
      y: source.y,
      radius: field.definition.parameters.beamWidth,
      strength,
    });
  }
}
/** Greater water load gives a stronger locus, approaching full response without a depth cutoff. */
export const pressureAtDepth = (depth: number, referenceDepth: number) =>
  1000 * -Math.expm1(-Math.max(0, depth) / referenceDepth);
/** Material release and emergent responses are already effective; other supply scales in propagation. */
export function sourcePropagationActivity(origin: MagicOrigin, activity: number) {
  return [
    "impact",
    "forge",
    "verdant",
    "aquifer",
    "death",
    "dead-lake",
    "geothermal",
    "strain",
    "pairing",
  ].includes(origin.source)
    ? 1
    : activity;
}
/** Placed supply follows the same scaling boundary as its owning origin, without scaling twice. */
export function placedSourceStrength(strength: number, origin: MagicOrigin, activity: number) {
  if (activity <= 0) return 0;
  const scale = sourcePropagationActivity(origin, activity) === 1 ? activity : 1;
  return clamp(round(strength * scale), 0, 1000);
}
function placedSources(
  state: GenerationState,
  field: MagicField,
  epochIndex: number,
  activity: number,
  origin: MagicOrigin
) {
  const work = state.physical!;
  for (const source of state.domain.world.magic) {
    if (source.systemId !== field.definition.id) continue;
    if (source.spaceId && source.spaceId !== state.domain.scope.spaceId) continue;
    if (source.startsAtEpoch > epochIndex) continue;
    const strength = placedSourceStrength(source.strength, origin, activity);
    if (strength <= 0) continue;
    const i = nearestTriangle(
      work.map.mesh,
      source.source.x - work.map.mesh.origin[0],
      source.source.y - work.map.mesh.origin[1]
    );
    if (i >= 0) {
      field.source.set(i, Math.max(field.source.get(i), strength));
      field.radii.set(i, source.radius);
      field.located.push({
        origin: "",
        id: source.id,
        x: source.source.x - work.map.mesh.origin[0],
        y: source.source.y - work.map.mesh.origin[1],
        radius: source.radius,
        strength,
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
          Math.max(0, MapScale.metres(map.Elevation.get(i), "native")) /
            map.scale.length(0.0000025, 0.5)
      )
    );
}
export interface LocateContext {
  origin: MagicOrigin;
  epochIndex: number;
  activity: number;
}
export type SupplyContext = LocateContext;
export interface SourceStrategy {
  label: string;
  requires: string[];
  parameters: (keyof MagicSystem["parameters"])[];
  radiusParameter?: keyof MagicSystem["parameters"];
  /** New material and renewal happen only in an elapsed epoch, never during location. */
  supply?(state: GenerationState, field: MagicField, seed: number, context: SupplyContext): void;
  locate(state: GenerationState, field: MagicField, seed: number, context: LocateContext): void;
}
/** The operation and its contract/applicability share one strategy declaration. */
export const magicSourceStrategies: Record<MagicSource, SourceStrategy> = {
  geothermal: {
    label: "Geothermal maxima & placed cores",
    requires: ["field:Geothermal"],
    parameters: ["sourceThreshold", "sourceSpacing"],
    radiusParameter: "sourceSpacing",
    locate: geothermalSources,
    supply: reopenConduits,
  },
  cold: {
    label: "Cold terrain & high ground",
    requires: ["field:Temperature", "field:Elevation"],
    parameters: ["baseInput"],
    // Its stocks are the charge in ice, ground, moraine and shelf, kept by the stock advance.
    locate: coldSources,
  },
  "deep-ocean": {
    label: "Deep ocean locus",
    requires: ["field:WaterKindCodes", "field:BathymetricZoneCodes"],
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
    parameters: [
      "standAge",
      "standCover",
      "peatDepth",
      "groveSap",
      "sapLoss",
      "organicChargeAffinity",
    ],
    // Its sap is refilled by stands and added to by herds and people; the advance decays it.
    locate: verdantSources,
    supply: supplySap,
  },
  aquifer: {
    label: "Springs on soft rock below a catchment",
    requires: ["field:FlowTargets", "field:Elevation"],
    parameters: [
      "springFlow",
      "springChargeSaturation",
      "springRock",
      "overdrawShare",
      "sinkDepth",
    ],
    locate: aquiferSources,
  },
  impact: {
    label: "Fallen cores around impact craters",
    // Reads the impact events and the wind the workspace already holds; a world without
    // impacts or an un-run wind simply seeds nothing, so Fire's pass needs no producer here.
    requires: [],
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
    supply: supplyFallenCores,
  },
  forge: {
    label: "Forges where people crack carried cores",
    requires: [],
    parameters: ["forgeStrength", "forgeCooling"],
    locate: forgeSources,
  },
  death: {
    label: "The dead the ground records",
    requires: [],
    parameters: ["saltPerDeath", "saltFull"],
    locate: saltSources,
    supply: supplyDeathSalt,
  },
  "dead-lake": {
    label: "Lakes that died in a closed basin",
    requires: ["field:LakeOutletTargets", "field:Elevation"],
    parameters: ["saltPerLakeMetre", "saltFull"],
    locate: saltSources,
    supply: supplyLakeSalt,
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
    parameters: ["doorStrain", "doorDistance", "doorMatch"],
    locate: pairingSources,
  },
};
/**
 * Locate every origin. Each runs its own strategy on a cleared source channel with its own
 * parameters and seed; the field's source is the maximum over origins and keeps the radius
 * of the origin that set it. Sources placed on the map join the first origin. A system with
 * one origin locates exactly as it did before origins existed.
 */
/** A host supplies its own strategy table when some world locators do not apply to its map. */
export function locateMagicSources(
  state: GenerationState,
  field: MagicField,
  seed: number,
  epochIndex = 0,
  strategies: Record<MagicSource, SourceStrategy> = magicSourceStrategies,
  activity = 1
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
      strategies[origin.source].locate(
        state,
        field,
        index === 0 ? seed : systemSeed(seed, origin.id),
        { origin, epochIndex, activity }
      );
      if (index === 0) placedSources(state, field, epochIndex, activity, origin);
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
}
/** Run birth/renewal once at the field's elapsed phase, including zero-supply event consumption. */
export function supplyMagicSources(
  state: GenerationState,
  field: MagicField,
  seed: number,
  epochIndex: number,
  activity: number,
  strategies: Record<MagicSource, SourceStrategy> = magicSourceStrategies
) {
  if (field.suppliedEpoch === epochIndex) return;
  field.suppliedEpoch = epochIndex;
  const local = systemSeed(seed, field.definition.id);
  for (const [index, origin] of field.definition.origins.entries()) {
    withOrigin(field, origin, () =>
      strategies[origin.source].supply?.(
        state,
        field,
        index === 0 ? local : systemSeed(local, origin.id),
        {
          origin,
          epochIndex,
          activity,
        }
      )
    );
  }
}
/** New society events may arrive after geological supply; consumed records make this event action idempotent. */
export function supplySocietyEvents(
  state: GenerationState,
  field: MagicField,
  seed: number,
  epochIndex: number,
  activity: number
) {
  for (const origin of field.definition.origins) {
    if (origin.source !== "death") continue;
    withOrigin(field, origin, () =>
      magicSourceStrategies.death.supply?.(state, field, seed, { origin, epochIndex, activity })
    );
  }
}
