import { MapScale } from "./mapScale";
import type { MagicSystem, MagicFeatureRule, MagicCondition } from "./magicSystems";
import type { MagicConfluence } from "./magicConfluences";

/** Dimensional exponents, including intensity stocks carried per unit area or volume. */
export const magicParameterDimensions = {
  sourceSpacing: 1,
  iceRetention: 1,
  coldRetentionDistance: 1,
  accumulationArea: 2,
  featureNoiseScale: 1,
  rayDistance: 1,
  coastalRayDistance: 1,
  wakeDistance: 1,
  beamWidth: 1,
  coastalSourceDistance: 1,
  fallenDensity: -1,
  iceCrackDepth: 1,
  buryDepth: 1,
  fanBarrenDepth: 1,
  iceChargeSaturation: -1,
  thawSubsidence: 1,
  sinkDepth: 1,
  springFlow: 3,
  saltPerDeath: 2,
  saltPerLakeMetre: -1,
  domeRise: 1,
  wardReach: 1,
  doorDistance: 1,
  wildRelief: 1,
  doorPool: 1,
  doorTravel: 1,
} as const;
const effectDimensions = { iceMelt: 1 };
const confluenceDimensions = { relief: 1, iceMelt: 1, debris: 1 };
/** These conditions read actual measured lengths, rather than encoded intensities. */
const conditionDimensions: Readonly<Record<string, number>> = { ice: 1, soilDepth: 1 };
type Convert = (value: number, dimension: number) => number;
function converted<T extends object>(
  value: T,
  dimensions: Readonly<Record<string, number>>,
  convert: Convert
): T {
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      typeof entry === "number" && dimensions[key] ? convert(entry, dimensions[key]) : entry,
    ])
  ) as T;
}
function conditions(groups: MagicCondition[][], convert: Convert) {
  return groups.map((group) =>
    Array.isArray(group)
      ? group.map((condition) => {
          if (!condition || typeof condition !== "object") return condition;
          const dimension = conditionDimensions[condition.field];
          if (!dimension) return condition;
          return {
            ...condition,
            ...(condition.min === undefined ? {} : { min: convert(condition.min, dimension) }),
            ...(condition.max === undefined ? {} : { max: convert(condition.max, dimension) }),
            ...(Array.isArray(condition.values)
              ? { values: condition.values.map((value) => convert(value, dimension)) }
              : {}),
          };
        })
      : group
  );
}
function rule<T extends Pick<MagicFeatureRule, "seeds" | "retains" | "coverage">>(
  value: T,
  convert: Convert
): T {
  const dimension = value.coverage && conditionDimensions[value.coverage.field];
  return {
    ...value,
    ...(Array.isArray(value.seeds) ? { seeds: conditions(value.seeds, convert) } : {}),
    ...(Array.isArray(value.retains) ? { retains: conditions(value.retains, convert) } : {}),
    ...(dimension && value.coverage
      ? {
          coverage: {
            ...value.coverage,
            floor: convert(value.coverage.floor, dimension),
            full: convert(value.coverage.full, dimension),
          },
        }
      : {}),
  };
}
export type ResolvedMagicSystem = Omit<MagicSystem, "lengthUnits"> & { lengthUnits: "resolved" };
export type ResolvedConfluence = Omit<MagicConfluence, "lengthUnits"> & { lengthUnits: "resolved" };
/** Configuration becomes measured quantities only when attached to its owning map. */
export function resolveMagicSystem(system: MagicSystem, scale: MapScale): ResolvedMagicSystem {
  const convert: Convert = (value, dimension) =>
    scale.resolveMeasure(MapScale.measure(value, dimension));
  return {
    ...system,
    lengthUnits: "resolved",
    parameters: converted(system.parameters, magicParameterDimensions, convert),
    origins: system.origins.map((origin) => ({
      ...origin,
      parameters: converted(origin.parameters, magicParameterDimensions, convert),
    })),
    effects: converted(system.effects, effectDimensions, convert),
    features: system.features.map((feature) => rule(feature, convert)),
  };
}
export function resolveConfluences(
  definitions: MagicConfluence[],
  scale: MapScale
): ResolvedConfluence[] {
  const convert: Convert = (value, dimension) =>
    scale.resolveMeasure(MapScale.measure(value, dimension));
  return definitions.map((definition) => ({
    ...rule(definition, convert),
    lengthUnits: "resolved",
    effects: converted(definition.effects, confluenceDimensions, convert),
    ...(definition.hazard
      ? { hazard: { ...definition.hazard, radius: scale.length(definition.hazard.radius) } }
      : {}),
  }));
}
