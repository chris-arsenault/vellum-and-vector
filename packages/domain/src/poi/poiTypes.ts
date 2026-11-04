import type { PoiGroupId, PoiKindId } from "./poiKinds";

/** Physical channels a generated map samples at every cell. */
export type PhysicalChannel =
  | "elevation"
  | "slope"
  | "landform"
  | "water"
  | "waterDepth"
  | "waterLevel"
  | "seaLevel"
  | "waterBody"
  | "basin"
  | "flow"
  | "catchmentArea"
  | "riverOrder"
  | "riverChannel"
  | "riverWidth"
  | "riverDepth"
  | "floodplain"
  | "delta"
  | "ice"
  | "iceThickness"
  | "groundedIce"
  | "maximumIce"
  | "glacialErosion"
  | "glacialDeposition"
  | "fluvialErosion"
  | "coastalErosion"
  | "deposition"
  | "sediment"
  | "soilDepth"
  | "rock"
  | "bedrock"
  | "fracture"
  | "geothermal"
  | "volcanicConstruction"
  | "volcanicLastActiveEpoch"
  | "impactExcavation"
  | "impactRim"
  | "impactEjecta"
  | "tectonicStrain"
  | "temperature"
  | "rainfall"
  | "snowfall"
  | "moisture"
  | "windSpeed"
  | "upwelling"
  | "oceanCurrent"
  | "waveExposure"
  | "oceanDistance"
  | "bathymetry"
  | "treeCover"
  | "grassCover"
  | "wetlandCover"
  | "populationDensity";
/**
 * A magic system's channel, `magic:<system>:<channel>`, such as `magic:fire:intensity` or
 * `magic:fire:stock:fallen/held`. Magic is physical: its channels are read like any other.
 */
export type MagicChannel = `magic:${string}:${string}`;
export type PoiChannel = PhysicalChannel | MagicChannel;

/**
 * One generated map as POI rules read it: the cells of its lattice, the channels sampled at
 * each, and the places already on it. Every rule in the catalogue is a pure function of this.
 */
export interface PoiMap {
  /** Cells of the lattice, numbered from zero. */
  readonly cellCount: number;
  /** Mean ground distance between neighbouring cell centres, in metres. */
  readonly cellSpan: number;
  /** A cell's centre, in map metres. */
  position(cell: number): Readonly<{ x: number; y: number }>;
  /** A cell's ground area, in square metres. */
  area(cell: number): number;
  /** The cells sharing an edge with this one. */
  neighbours(cell: number): readonly number[];
  /** Whether the map samples a channel. */
  has(channel: PoiChannel): boolean;
  /** A channel's value at a cell; NaN where the map does not sample it. */
  read(channel: PoiChannel, cell: number): number;
  /** Places already on the map, settlements and earlier finds, for rules that weigh context. */
  readonly places: readonly PoiPlace[];
}

/** A place on the map as context for other rules: what it is, where, and what it is called. */
export interface PoiPlace {
  readonly id: string;
  readonly kind: PoiKindId;
  readonly cells: readonly number[];
  readonly anchor: number;
  readonly measures: Readonly<Record<string, number>>;
  /** Roles a place holds among its kind, such as `capital` for a settlement. */
  readonly roles: readonly string[];
  readonly name?: string;
  /** The place whose name this one takes, such as a town named for the summit above it. */
  readonly namedAfter?: string;
}

/** A place a kind's identity test found: its cells, the cell that locates it, its measures. */
export interface PoiFound<M extends string = string> {
  readonly kind: PoiKindId;
  /** Every cell the place occupies; one cell for a point. */
  readonly cells: readonly number[];
  /** The cell that locates the place: a summit's highest cell, a waterfall's lip. */
  readonly anchor: number;
  /** The place's own size and character, by the kind's measure names. */
  readonly measures: Readonly<Record<M, number>>;
}

/** A quantity recorded on every place of a kind. */
export interface PoiMeasure {
  readonly unit: string;
  /** What the number is, in one sentence. */
  readonly meaning: string;
}

/**
 * What makes a place this kind and no other. The statement says it in a sentence; `find`
 * is the same test over the map. Two kinds that `find` the same place are not distinct.
 */
export interface PoiIdentity<M extends string> {
  readonly statement: string;
  find(map: PoiMap): readonly PoiFound<M>[];
}

/**
 * Considerations that raise or lower a place's claim to be drawn, each a number in [0, 1].
 * - `magnitude`: its own size, against the largest of its kind the map holds.
 * - `contrast`: how far it stands out from its surroundings, the local conditions: a 1500 m
 *   summit over plains against the same summit among higher ones.
 * - `isolation`: distance to the nearest place of its kind that outranks it.
 * - `cultural`: people's attachment to it: a settlement at it or named after it, a route over
 *   it, a sacred site, a capital at its foot.
 * - `orientation`: whether travellers would steer by it: seen from far, on a route, at a
 *   boundary between kinds of country.
 */
export type VisibilityFactor = "magnitude" | "contrast" | "isolation" | "cultural" | "orientation";

/**
 * Whether a place earns a place on a map at a given view. Visibility is not size or field
 * resolution alone: the factors weigh what the place is to its country and to its people.
 */
export interface PoiVisibility<M extends string> {
  /** What earns this kind a place on a map, in a sentence or two. */
  readonly statement: string;
  /** The factors this kind weighs, each a pure function of the place and the map. */
  readonly factors: Readonly<
    Partial<Record<VisibilityFactor, (place: PoiFound<M>, map: PoiMap) => number>>
  >;
  /** Importance in [0, 1]: a deterministic combination of the factors. */
  importance(place: PoiFound<M>, map: PoiMap): number;
  /** The ground extent, in metres, a reader needs to see to read the place as itself. */
  extent(place: PoiFound<M>, map: PoiMap): number;
}

/** A kind easily mistaken for this one, and what in the data separates them. */
export interface PoiDistinction {
  readonly kind: PoiKindId;
  /** The field or measure that tells them apart, in a sentence. */
  readonly separatedBy: string;
  /** Whether the two may never claim the same cell; false where one can sit within the other. */
  readonly exclusive: boolean;
}

export type PoiOrigin = "natural" | "magic" | "human";
export type PoiGeometry = "point" | "line" | "area";

/** A complete catalogue entry: every field is required, so nothing can be passed over. */
export interface PoiEntry<M extends string = string> {
  readonly status: "drafted" | "implemented";
  readonly id: PoiKindId;
  readonly group: PoiGroupId;
  /** Singular display name. */
  readonly name: string;
  /** Every origin that can make one: a spring may be natural, Fire-heated or Greenwood-fed. */
  readonly origins: readonly PoiOrigin[];
  readonly geometry: PoiGeometry;
  /** What it physically is: its form, its material and the process that makes it. */
  readonly description: string;
  /** Which generation processes make it, in a sentence. */
  readonly formedBy: string;
  /** Every channel its rules read. */
  readonly reads: readonly PoiChannel[];
  readonly measures: Readonly<Record<M, PoiMeasure>>;
  readonly identity: PoiIdentity<M>;
  readonly distinctFrom: readonly PoiDistinction[];
  readonly visibility: PoiVisibility<M>;
  /** How the place shapes the terrain or other fields, or "nothing" when it is only read. */
  readonly shapes: string;
  /** What its name draws on. */
  readonly naming: string;
}

/** An entry not yet specified: identity only, so open work stays visible. */
export interface PoiShell {
  readonly status: "shell";
  readonly id: PoiKindId;
  readonly group: PoiGroupId;
  readonly name: string;
  readonly origins: readonly PoiOrigin[];
}
export type PoiCatalogueEntry = PoiShell | PoiEntry;

/** A group page: the physical nature its members share and what it leaves out. */
export interface PoiGroupPage {
  readonly status: "drafted";
  readonly id: PoiGroupId;
  readonly name: string;
  /** What every member physically is, in a sentence. */
  readonly belongs: string;
  /** What looks like a member but belongs elsewhere, and where. */
  readonly excludes: string;
}
/** A group page not yet written: identity only. */
export interface PoiGroupShell {
  readonly status: "shell";
  readonly id: PoiGroupId;
  readonly name: string;
}

/** Catalogue-wide rules over every complete entry. */
export interface PoiCatalogueRules {
  /** Places two kinds both claim where the catalogue says they are exclusive: must be empty. */
  conflicts(map: PoiMap): readonly { kinds: [PoiKindId, PoiKindId]; anchor: number }[];
  /** Whether a place is drawn on a view of the given ground resolution (metres per pixel). */
  visibleAt(entry: PoiEntry, place: PoiFound, map: PoiMap, metresPerPixel: number): boolean;
}
