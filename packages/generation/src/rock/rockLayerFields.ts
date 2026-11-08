import { rockKindOfCode } from "./rockCatalogue";

export interface MaterialLayer {
  readonly kind: number;
  readonly depth: number;
  readonly secondaryKind: number;
  readonly secondaryShare: number;
  readonly strength: number;
  readonly damage: number;
  readonly grainX: number;
  readonly grainY: number;
  readonly formedMin: number;
  readonly formedMax: number;
  readonly altered: number;
  /** Coarsening has combined contacts; constituent identities below the largest two are lost. */
  readonly mixed: number;
}
export type MaterialState = Partial<Omit<MaterialLayer, "kind" | "depth">>;
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

export function materialLayer(
  kind: number,
  depth: number,
  state: MaterialState = {},
  epoch = 0
): MaterialLayer {
  return {
    secondaryKind: kind,
    secondaryShare: 0,
    strength: rockKindOfCode(kind).resistance,
    damage: 0,
    grainX: 0,
    grainY: 0,
    formedMin: epoch,
    formedMax: epoch,
    altered: epoch,
    mixed: 0,
    ...state,
    kind,
    depth,
  };
}
function combineRepeated(codes: readonly number[], weights: number[]) {
  for (let i = 0; i < 4; i++)
    for (let j = i + 1; j < 4; j++)
      if (codes[i] === codes[j]) {
        weights[i] += weights[j];
        weights[j] = 0;
      }
}
/** Largest two constituents; smaller identities are explicitly lost when a buried contact coarsens. */
function components(a: MaterialLayer, b: MaterialLayer) {
  const codes = [a.kind, a.secondaryKind, b.kind, b.secondaryKind],
    weights = [
      a.depth * (1 - a.secondaryShare),
      a.depth * a.secondaryShare,
      b.depth * (1 - b.secondaryShare),
      b.depth * b.secondaryShare,
    ];
  combineRepeated(codes, weights);
  let first = 0,
    second = 0;
  for (let i = 1; i < 4; i++) if (weights[i] > weights[first]) first = i;
  for (let i = 0; i < 4; i++)
    if (i !== first && (second === first || weights[i] > weights[second])) second = i;
  const kept = weights[first] + weights[second];
  return {
    kind: codes[first],
    secondaryKind: codes[second],
    secondaryShare: kept > 0 ? weights[second] / kept : 0,
  };
}
export function blendLayers(a: MaterialLayer, b: MaterialLayer): MaterialLayer {
  const depth = a.depth + b.depth,
    share = depth > 0 ? b.depth / depth : 0,
    mean = (property: "strength" | "damage" | "grainX" | "grainY") =>
      a[property] + (b[property] - a[property]) * share;
  return {
    ...components(a, b),
    depth,
    strength: mean("strength"),
    damage: mean("damage"),
    grainX: mean("grainX"),
    grainY: mean("grainY"),
    formedMin: Math.min(a.formedMin, b.formedMin),
    formedMax: Math.max(a.formedMax, b.formedMax),
    altered: Math.max(a.altered, b.altered),
    mixed: 1,
  };
}
export const mergeMaterial = blendLayers;
