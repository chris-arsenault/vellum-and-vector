import { canonicalPhysicalFields, type PhysicalFieldName } from "./physicalFields";
import { requireThat } from "./errors";

/** Derived products and independent non-physical quantities, never aliases for physical bands. */
export const additionalFieldChannels = [
  "BaseSeaLevel",
  "EffectiveSeaLevel",
  "SurfaceMaterial",
  "PhysicalMaterial",
  "Precipitation",
  "TotalErosion",
  "CarbonateFraction",
  "NaturalTemperature",
  "NaturalRockResistance",
  "Heat",
  "StoredHeat",
  "CoastalPressure",
  "AtmosphericWaterRate",
  "IceMeltDepth",
  "populationDensity",
  "populationCapacity",
  "naturalSurface",
  "finalSurface",
  "secondSurface",
] as const;
export type FieldChannelName =
  | PhysicalFieldName
  | (typeof additionalFieldChannels)[number]
  | `magic:${string}`
  | `magicApplied:${string}`
  | `culture:${string}`
  | `language:${string}`
  | `languageUse:${string}`
  | `religion:${string}`;
const names = new Set<string>([
  ...canonicalPhysicalFields().map(({ name }) => name),
  ...additionalFieldChannels,
]);
export function isFieldChannelName(name: string): name is FieldChannelName {
  return (
    names.has(name) || /^(magic|magicApplied|culture|language|languageUse|religion):.+/.test(name)
  );
}
/** Dynamic selections and resource metadata must name a declared current-format quantity. */
export function fieldChannelName(name: string): FieldChannelName {
  requireThat(isFieldChannelName(name), "field_channel", `Unknown numerical field ${name}.`);
  return name;
}
