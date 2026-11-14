import { type PhysicalFieldName } from "./physicalFields";
/** Derived products and independent non-physical quantities, never aliases for physical bands. */
export declare const additionalFieldChannels: readonly [
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
];
export type FieldChannelName =
  | PhysicalFieldName
  | (typeof additionalFieldChannels)[number]
  | `magic:${string}`
  | `magicApplied:${string}`
  | `culture:${string}`
  | `language:${string}`
  | `languageUse:${string}`
  | `religion:${string}`;
export declare function isFieldChannelName(name: string): name is FieldChannelName;
/** Dynamic selections and resource metadata must name a declared current-format quantity. */
export declare function fieldChannelName(name: string): FieldChannelName;
