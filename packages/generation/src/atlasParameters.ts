import { z } from "zod";

export interface AtlasParameterDefinition {
  label: string;
  unit: string;
  minimum: number;
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
    maximum: 30,
    default: 4,
    step: 1,
    integer: true,
    group: "geology",
  },
  provinces: {
    label: "Tectonic provinces",
    unit: "count",
    minimum: 2,
    maximum: 200,
    default: 42,
    step: 1,
    integer: true,
    group: "geology",
  },
  landFraction: {
    label: "Continental crust fraction",
    unit: "fraction",
    minimum: 0.05,
    maximum: 0.95,
    default: 0.48,
    step: 0.01,
    group: "geology",
  },
  temperature: {
    label: "Baseline temperature",
    unit: "°C",
    minimum: -50,
    maximum: 60,
    default: 15,
    step: 0.5,
    group: "climate",
  },
  rainfall: {
    label: "Profile rainfall",
    unit: "multiplier",
    minimum: 0,
    maximum: 5,
    default: 1,
    step: 0.1,
    group: "climate",
  },
  erosion: {
    label: "River erosion",
    unit: "multiplier",
    minimum: 0,
    maximum: 5,
    default: 1,
    step: 0.1,
    group: "water",
  },
  seaLevel: {
    label: "Sea level adjustment",
    unit: "m",
    minimum: -5000,
    maximum: 5000,
    default: 0,
    step: 10,
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
  wrapLongitude: {
    label: "East–west wrap for climate",
    unit: "choice",
    minimum: 0,
    maximum: 1,
    default: 0,
    step: 1,
    integer: true,
    choices: [
      { value: 0, label: "Edges stay open" },
      { value: 1, label: "Air and ocean wrap" },
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
    maximum: 5,
    default: 1,
    step: 0.1,
    group: "ecology",
  },
  grazing: {
    label: "Herbivore pressure",
    unit: "multiplier",
    minimum: 0,
    maximum: 5,
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
  schema = definition.exclusiveMinimum
    ? schema.gt(definition.minimum)
    : schema.min(definition.minimum);
  if (definition.integer) schema = schema.int();
  if (definition.maximum !== undefined) schema = schema.max(definition.maximum);
  return schema.default(definition.default);
}
export const atlasParametersSchema = z.preprocess(
  legacyMapBoundary,
  z
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
    })
);
function legacyMapBoundary(value: unknown) {
  if (!value || typeof value !== "object" || !("wrapLongitude" in value) || "mapBoundary" in value)
    return value;
  return { ...value, mapBoundary: value.wrapLongitude };
}
export const defaultAtlasParameters: AtlasParameters = atlasParametersSchema.parse({});
const parameterProcesses: Partial<Record<keyof AtlasParameters, string>> = {
  impacts: "canonry.impact-cratering",
  impactSize: "canonry.impact-cratering",
  volcanism: "canonry.volcanic-construction",
  erosion: "canonry.ancestral-fluvial-erosion",
  glaciers: "canonry.glacial-erosion",
  coastalErosion: "canonry.coastal-erosion-and-deposition",
  vegetation: "atlas.ecology-evolve",
  grazing: "atlas.ecology-evolve",
};
export function parameterInactiveReason(
  key: keyof AtlasParameters,
  domains: string[],
  processes: Record<string, boolean>,
  inherited: boolean
) {
  const group = atlasParameterDefinitions[key].group;
  if (inherited && group === "geology")
    return "Geological construction is inherited from the parent.";
  const humanDomains: Partial<Record<keyof AtlasParameters, string>> = {
    cultureCount: "cultural",
    polityCount: "political",
  };
  const domain = humanDomains[key] ?? "physical";
  if (!domains.includes(domain)) return `Enable ${domain} generation to use this setting.`;
  const process = parameterProcesses[key];
  if (process && processes[process] === false) return "Its generation process is disabled.";
  return null;
}
export const atlasPresets: Record<string, { label: string; parameters: Partial<AtlasParameters> }> =
  {
    balanced: { label: "Mixed continents", parameters: {} },
    islands: { label: "Island world", parameters: { continents: 12, landFraction: 0.25 } },
    continental: { label: "Broad continents", parameters: { continents: 2, landFraction: 0.7 } },
    cold: { label: "Cold world", parameters: { temperature: -5 } },
    arid: { label: "Arid world", parameters: { rainfall: rainfallRegimes.dry.rainfall } },
    wet: { label: "Wet world", parameters: { rainfall: rainfallRegimes.wet.rainfall } },
    canonry: {
      label: "Ice Remembers · cold magical world",
      parameters: {
        continents: 5,
        provinces: 30,
        landFraction: 0.53,
        temperature: -17.5,
        impacts: 7,
      },
    },
  };
