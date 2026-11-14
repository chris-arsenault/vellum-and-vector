/** One lattice cell has an intact and an incised share, each with rock and loose cover. */
export type Column = "land" | "cut" | "loose" | "cutLoose";
const rockSlots = [0, 1, 2, 3, 4, 5, 6, 7] as const;
const looseSlots = [0, 1, 2, 3] as const;
type Slot = (typeof rockSlots)[number];
export const rockLayers = rockSlots.length;

export const materialProperties = [
  "kind",
  "depth",
  "secondaryKind",
  "secondaryShare",
  "strength",
  "damage",
  "grainX",
  "grainY",
  "bedSlopeX",
  "bedSlopeY",
  "deposited",
  "consolidation",
  "formedMin",
  "formedMax",
  "altered",
  "mixed",
] as const;
export type MaterialProperty = (typeof materialProperties)[number];
const suffixes = {
  kind: "Kind",
  depth: "Depth",
  secondaryKind: "SecondaryKind",
  secondaryShare: "SecondaryShare",
  strength: "Strength",
  damage: "Damage",
  grainX: "GrainX",
  grainY: "GrainY",
  bedSlopeX: "BedSlopeX",
  bedSlopeY: "BedSlopeY",
  deposited: "Deposited",
  consolidation: "Consolidation",
  formedMin: "FormedMin",
  formedMax: "FormedMax",
  altered: "Altered",
  mixed: "Mixed",
} as const;
const prefixes = {
  land: "RockLayer",
  cut: "RockCutLayer",
  loose: "LooseLayer",
  cutLoose: "LooseCutLayer",
} as const;
type LayerBand<
  C extends Column,
  P extends MaterialProperty,
> = `${(typeof prefixes)[C]}${(typeof suffixes)[P]}${Slot}`;
type ColumnFields<C extends Column> = {
  readonly [P in MaterialProperty]: readonly LayerBand<C, P>[];
};
function fields<C extends Column>(column: C): ColumnFields<C> {
  const slots = column === "land" || column === "cut" ? rockSlots : looseSlots;
  const names = <P extends MaterialProperty>(property: P) =>
    slots.map((slot) => `${prefixes[column]}${suffixes[property]}${slot}` as LayerBand<C, P>);
  return {
    kind: names("kind"),
    depth: names("depth"),
    secondaryKind: names("secondaryKind"),
    secondaryShare: names("secondaryShare"),
    strength: names("strength"),
    damage: names("damage"),
    grainX: names("grainX"),
    grainY: names("grainY"),
    bedSlopeX: names("bedSlopeX"),
    bedSlopeY: names("bedSlopeY"),
    deposited: names("deposited"),
    consolidation: names("consolidation"),
    formedMin: names("formedMin"),
    formedMax: names("formedMax"),
    altered: names("altered"),
    mixed: names("mixed"),
  };
}
export const columnFields = {
  land: fields("land"),
  cut: fields("cut"),
  loose: fields("loose"),
  cutLoose: fields("cutLoose"),
};
export const columns = Object.keys(columnFields) as Column[];
export const rockLayerKinds = columnFields.land.kind;
export const rockLayerDepths = columnFields.land.depth;
export const allColumnIntegerFields = columns.flatMap((column) => [
  ...columnFields[column].kind,
  ...columnFields[column].secondaryKind,
  ...columnFields[column].mixed,
]);
const scalarProperties = materialProperties.filter(
  (property) => property !== "kind" && property !== "secondaryKind" && property !== "mixed"
);
export const allColumnScalarFields = columns.flatMap((column) =>
  scalarProperties.flatMap((property) => columnFields[column][property])
);
export const allColumnFields = [...allColumnIntegerFields, ...allColumnScalarFields];
