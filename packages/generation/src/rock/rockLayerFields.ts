import { rockCatalogue, rockKindOfCode } from "./rockCatalogue";
import type { Band, ReadBand } from "@atlas/domain";

export interface MaterialLayer {
  readonly kind: number;
  readonly depth: number;
  readonly secondaryKind: number;
  readonly secondaryShare: number;
  readonly strength: number;
  readonly damage: number;
  readonly grainX: number;
  readonly grainY: number;
  /** Bed elevation gradients, dz/dx and dz/dy; unlike axial fabric these distinguish opposite sides. */
  readonly bedSlopeX: number;
  readonly bedSlopeY: number;
  /** Epoch of this bed's deposition, separate from formation ages of its constituents. */
  readonly deposited: number;
  /** Loose aggregate (0), cemented sediment (between), intact or thermally welded rock (1). */
  readonly consolidation: number;
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

export type MaterialReader = (cell: number, layer: number, column?: Column) => MaterialLayer;
export type LayerBands<B extends ReadBand = ReadBand> = Record<MaterialProperty, B>;
/** Bind the fixed column schema once; only detached scalar snapshots leave the reader. */
export function bindMaterialReader(
  source: (name: (typeof allColumnFields)[number]) => ReadBand
): MaterialReader {
  const bound = bindColumnBands(source);
  return (cell, layer, column = "land") => materialSnapshot(bound[column][layer], cell);
}
export function bindColumnBands<B extends ReadBand>(
  source: (name: (typeof allColumnFields)[number]) => B
) {
  // hpc-exempt: fixed schema band references, not per-cell material objects or copied values.
  return Object.fromEntries(
    Object.entries(columnFields).map(([column, fields]) => [
      column,
      fields.kind.map((_, layer) =>
        Object.fromEntries(
          materialProperties.map((property) => [property, source(fields[property][layer])])
        )
      ),
    ])
  ) as Record<Column, LayerBands<B>[]>;
}
export function materialSnapshot(bands: LayerBands, cell: number): MaterialLayer {
  const kind = bands.kind.get(cell);
  return {
    kind,
    depth: bands.depth.get(cell),
    secondaryKind: bands.secondaryKind.get(cell),
    secondaryShare: bands.secondaryShare.get(cell),
    strength: bands.strength.get(cell) || rockKindOfCode(kind).resistance,
    damage: bands.damage.get(cell),
    grainX: bands.grainX.get(cell),
    grainY: bands.grainY.get(cell),
    bedSlopeX: bands.bedSlopeX.get(cell),
    bedSlopeY: bands.bedSlopeY.get(cell),
    deposited: bands.deposited.get(cell),
    consolidation: bands.consolidation.get(cell),
    formedMin: bands.formedMin.get(cell),
    formedMax: bands.formedMax.get(cell),
    altered: bands.altered.get(cell),
    mixed: bands.mixed.get(cell),
  };
}
/** Write an already normalized material through band capabilities supplied by its owner. */
export function writeMaterial(bands: LayerBands<Band>, cell: number, material: MaterialLayer) {
  bands.kind.set(cell, material.kind);
  bands.depth.set(cell, material.depth);
  bands.secondaryKind.set(cell, material.secondaryKind);
  bands.secondaryShare.set(cell, material.secondaryShare);
  bands.strength.set(cell, material.strength);
  bands.damage.set(cell, material.damage);
  bands.grainX.set(cell, material.grainX);
  bands.grainY.set(cell, material.grainY);
  bands.bedSlopeX.set(cell, material.bedSlopeX);
  bands.bedSlopeY.set(cell, material.bedSlopeY);
  bands.deposited.set(cell, material.deposited);
  bands.consolidation.set(cell, material.consolidation);
  bands.formedMin.set(cell, material.formedMin);
  bands.formedMax.set(cell, material.formedMax);
  bands.altered.set(cell, material.altered);
  bands.mixed.set(cell, material.mixed);
}

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
    bedSlopeX: 0,
    bedSlopeY: 0,
    deposited: epoch,
    consolidation: rockKindOfCode(kind).family === "loose" ? 0 : 1,
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
function components(a: MaterialLayer, b: MaterialLayer, aDepth: number, bDepth: number) {
  const codes = [a.kind, a.secondaryKind, b.kind, b.secondaryKind],
    weights = [
      aDepth * (1 - a.secondaryShare),
      aDepth * a.secondaryShare,
      bDepth * (1 - b.secondaryShare),
      bDepth * b.secondaryShare,
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
/** Explicit contribution depths avoid copying a material merely to change its mixing weight. */
export function blendLayers(
  a: MaterialLayer,
  b: MaterialLayer,
  aDepth = a.depth,
  bDepth = b.depth
): MaterialLayer {
  const depth = aDepth + bDepth,
    share = depth > 0 ? bDepth / depth : 0,
    constituents = components(a, b, aDepth, bDepth);
  return {
    kind: constituents.kind,
    secondaryKind: constituents.secondaryKind,
    secondaryShare: constituents.secondaryShare,
    depth,
    strength: a.strength + (b.strength - a.strength) * share,
    damage: a.damage + (b.damage - a.damage) * share,
    grainX: a.grainX + (b.grainX - a.grainX) * share,
    grainY: a.grainY + (b.grainY - a.grainY) * share,
    bedSlopeX: a.bedSlopeX + (b.bedSlopeX - a.bedSlopeX) * share,
    bedSlopeY: a.bedSlopeY + (b.bedSlopeY - a.bedSlopeY) * share,
    consolidation: a.consolidation + (b.consolidation - a.consolidation) * share,
    deposited: Math.max(a.deposited, b.deposited),
    formedMin: Math.min(a.formedMin, b.formedMin),
    formedMax: Math.max(a.formedMax, b.formedMax),
    altered: Math.max(a.altered, b.altered),
    mixed: 1,
  };
}
export const mergeMaterial = blendLayers;

/** Aggregate strength belongs to the bed; constituent strength survives disaggregation and transport. */
export function materialStrength(layer: MaterialLayer, loose = false) {
  const looseStrength = Math.min(layer.strength, rockCatalogue.alluvium.resistance);
  return loose
    ? looseStrength
    : looseStrength + (layer.strength - looseStrength) * layer.consolidation;
}
