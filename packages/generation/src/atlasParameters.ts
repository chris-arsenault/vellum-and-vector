import { z } from "zod";

export interface AtlasParameterDefinition {
  label: string;
  unit: string;
  minimum?: number;
  maximum?: number;
  default: number;
  step: number;
  integer?: boolean;
  exclusiveMinimum?: boolean;
  /** Named values for a categorical setting, shown as a choice instead of a number. */
  choices?: readonly { value: number; label: string; disabled?: boolean }[];
  group: "geology" | "climate" | "water" | "ecology" | "human";
}

export const atlasParameterDefinitions = {
  mapBoundary: {
    label: "Map boundary",
    unit: "choice",
    minimum: 0,
    maximum: 2,
    default: 1,
    step: 1,
    integer: true,
    choices: [
      { value: 1, label: "Cylinder" },
      { value: 2, label: "Ocean surrounded (coming later)", disabled: true },
      { value: 0, label: "Nothing" },
    ],
    group: "geology",
  },
  continents: {
    label: "Continental assemblies",
    unit: "count",
    minimum: 1,
    default: 4,
    step: 1,
    integer: true,
    group: "geology",
  },
  oceanicPlates: {
    label: "Oceanic plates",
    unit: "count",
    minimum: 0,
    default: 1,
    step: 1,
    integer: true,
    group: "geology",
  },
  provinces: {
    label: "Tectonic provinces",
    unit: "count",
    minimum: 2,
    default: 42,
    step: 1,
    integer: true,
    group: "geology",
  },
  landFraction: {
    label: "Continental crust fraction",
    unit: "fraction",
    minimum: 0,
    maximum: 1,
    default: 0.45,
    step: 0.01,
    group: "geology",
  },
  temperature: {
    label: "Baseline temperature",
    unit: "°C",
    default: 15,
    step: 0.5,
    group: "climate",
  },
  rainfall: {
    label: "Profile rainfall",
    unit: "multiplier",
    minimum: 0,
    default: 1,
    step: 0.1,
    group: "climate",
  },
  erosion: {
    label: "River erosion",
    unit: "multiplier",
    minimum: 0,
    default: 1,
    step: 0.1,
    group: "water",
  },
  seaLevel: {
    label: "Sea level adjustment",
    unit: "map fraction",
    default: 0,
    step: 0.0000025,
    group: "climate",
  },
  southLatitude: {
    label: "South edge latitude",
    unit: "°",
    minimum: -90,
    maximum: 90,
    default: 10,
    step: 1,
    group: "climate",
  },
  northLatitude: {
    label: "North edge latitude",
    unit: "°",
    minimum: -90,
    maximum: 90,
    default: 70,
    step: 1,
    group: "climate",
  },
  latitudeProjection: {
    label: "Latitude projection",
    unit: "choice",
    minimum: 0,
    maximum: 1,
    default: 1,
    step: 1,
    integer: true,
    choices: [
      { value: 0, label: "Even degrees (equirectangular)" },
      { value: 1, label: "Equal area" },
    ],
    group: "climate",
  },
  impacts: {
    label: "Meteor impacts",
    unit: "history budget per 12 million km²",
    minimum: 0,
    default: 6,
    step: 1,
    integer: true,
    group: "geology",
  },
  impactSize: {
    label: "Crater radius",
    unit: "multiplier",
    minimum: 0,
    exclusiveMinimum: true,
    default: 1,
    step: 0.1,
    group: "geology",
  },
  landscapeLandmarks: {
    label: "Major landscape landmarks",
    unit: "count",
    minimum: 0,
    default: 4,
    step: 1,
    integer: true,
    group: "geology",
  },
  magicLandmarks: {
    label: "Major magic landmarks",
    unit: "count",
    minimum: 0,
    default: 3,
    step: 1,
    integer: true,
    group: "geology",
  },
  volcanism: {
    label: "Volcanic construction",
    unit: "multiplier",
    minimum: 0,
    default: 1,
    step: 0.1,
    group: "geology",
  },
  plateDrift: {
    label: "Plate drift",
    unit: "multiplier",
    minimum: 0,
    default: 1,
    step: 0.1,
    group: "geology",
  },
  glaciers: {
    label: "Glacial erosion and deposition",
    unit: "multiplier",
    minimum: 0,
    default: 1,
    step: 0.1,
    group: "water",
  },
  coastalErosion: {
    label: "Coastal erosion",
    unit: "multiplier",
    minimum: 0,
    default: 1,
    step: 0.1,
    group: "water",
  },
  vegetation: {
    label: "Vegetation productivity",
    unit: "multiplier",
    minimum: 0,
    default: 1,
    step: 0.1,
    group: "ecology",
  },
  grazing: {
    label: "Herbivore pressure",
    unit: "multiplier",
    minimum: 0,
    default: 1,
    step: 0.1,
    group: "ecology",
  },
  cultureCount: {
    label: "Starting cultures",
    unit: "count",
    minimum: 1,
    default: 3,
    step: 1,
    integer: true,
    group: "human",
  },
  polityCount: {
    label: "Starting polities",
    unit: "count",
    minimum: 1,
    default: 3,
    step: 1,
    integer: true,
    group: "human",
  },
  // Society coefficients an outcome choice moves. Each default is the value the society
  // code used as a constant before it became a setting, so an untouched recipe is unchanged.
  culturalMobility: {
    label: "Cultural mobility",
    unit: "multiplier",
    minimum: 0,
    default: 1,
    step: 0.1,
    group: "human",
  },
  politicalReach: {
    label: "Political reach",
    unit: "multiplier",
    minimum: 0,
    default: 1,
    step: 0.1,
    group: "human",
  },
  // A number input validates its value against min + n × step, so each minimum is a step.
  townThreshold: {
    label: "World town size",
    unit: "residents",
    minimum: 100,
    default: 5000,
    step: 100,
    integer: true,
    group: "human",
  },
  cityReach: {
    label: "City hinterland reach",
    unit: "map fraction",
    minimum: 0.0025,
    default: 0.05,
    step: 0.0025,
    group: "human",
  },
  roadTraffic: {
    label: "Travellers that make a road",
    unit: "per year",
    minimum: 50,
    default: 1000,
    step: 50,
    group: "human",
  },
  marketTravel: {
    label: "Market travel",
    unit: "multiplier",
    minimum: 0,
    default: 1,
    step: 0.1,
    group: "human",
  },
  highways: {
    label: "Highways per polity",
    unit: "count",
    minimum: 0,
    default: 2,
    step: 1,
    integer: true,
    group: "human",
  },
} satisfies Record<string, AtlasParameterDefinition>;

export type AtlasParameters = Record<keyof typeof atlasParameterDefinitions, number>;
export const mapBoundaryName = (value: number) => (["none", "cylinder", "ocean"] as const)[value];
export const mapBoundaryValue = (value: "cylinder" | "ocean" | "none" = "none") =>
  ({ none: 0, cylinder: 1, ocean: 2 })[value];
/**
 * Named anchors of the continuous `rainfall` setting. Each is fitted to its
 * own outcome on the default worlds rather than scaled from Mixed: Dry keeps
 * deserts and steppe everywhere, Mixed is Earth-like and Wet is wetter than Earth.
 */
export const rainfallRegimes = {
  dry: { label: "Dry", rainfall: 0.07 },
  mixed: { label: "Mixed", rainfall: 1 },
  wet: { label: "Wet", rainfall: 2 },
} as const;
/** World-frame settings: chosen once for a world and inherited by its regions. */
export const latitudeFrameSettings = [
  "southLatitude",
  "northLatitude",
  "latitudeProjection",
] as const;
export function parameterSchema(definition: AtlasParameterDefinition) {
  let schema = z.number().finite();
  if (definition.minimum !== undefined)
    schema = definition.exclusiveMinimum
      ? schema.gt(definition.minimum)
      : schema.min(definition.minimum);
  if (definition.integer) schema = schema.int();
  if (definition.maximum !== undefined) schema = schema.max(definition.maximum);
  return schema.default(definition.default);
}
export const atlasParametersSchema = z
  .object(
    Object.fromEntries(
      Object.entries(atlasParameterDefinitions).map(([key, definition]) => [
        key,
        parameterSchema(definition),
      ])
    ) as Record<keyof AtlasParameters, z.ZodDefault<z.ZodNumber>>
  )
  .strict()
  .refine((parameters) => parameters.northLatitude >= parameters.southLatitude, {
    path: ["northLatitude"],
    message: "The north edge cannot lie south of the south edge.",
  });
export const defaultAtlasParameters: AtlasParameters = atlasParametersSchema.parse({});
