import type { Band, Landmark } from "@atlas/domain";
import type { GenerationState } from "../process";
import type { AtlasPhysicalWorkspace } from "../canonry/atlasWorkspace";
import type { PhysicalBufferName, PhysicalField } from "../canonry/field";
import type { Placed } from "../canonry/landmarkGeometry";
import type { RegionalCharacter } from "./character";
import type { CapturedCourse } from "./courses";
import type { Contributions } from "./media";
import type { SharedMedia } from "./sharedMedia";

export interface RegionalInput {
  areaId: string;
  quality: string;
  seed: number;
  domains: string[];
}

/** A settlement's broad situation, read from the captured geography at its position. */
export type Situation = "coast" | "river" | "lake" | "inland";

/**
 * An established place that takes part in the processes: its footprint caps hillslope
 * relief so a usable site develops around it, and a river seat draws a channel to itself.
 * The cell follows the seat when the developed ground moves it.
 */
export interface Seat {
  featureId: string;
  cell: number;
  situation: Situation;
  /** Footprint radius in cells and the hillslope gradient its ground is held to. */
  radius: number;
  gradient: number;
  /** An established seat has substantial influence; a proposed village only a local one. */
  strength: "established" | "proposed";
}

/** A village proposed in round two, supported or rejected in round three. */
export interface ProposedPlace {
  cell: number;
  population: number;
  siteKind: string;
  siteReason: string;
  accepted: boolean;
}

/**
 * The established geography this map develops from: evidence with identity and situation,
 * whose coordinates and surroundings develop (spec 5.3).
 */
export interface Evidence {
  courses: CapturedCourse[];
  /** Captured standing water: its cells and surface level (metres above the datum). */
  lakes: { cells: Int32Array; level: number }[];
  /**
   * Inherited significant summits, read from their captured positions (`captured`, map
   * coordinates) with their captured prominence; the identity step writes both back onto the
   * feature, whatever the world's extraction left on it.
   */
  summits: { featureId: string; cell: number; prominence: number; captured: [number, number] }[];
  seats: Seat[];
  /** Captured rivers entering across the frame edge, with the discharge they bring (m³/s). */
  entries: { cell: number; discharge: number }[];
  /** Captured landmark records standing in the frame, placed on this lattice. */
  landmarks: { landmark: Landmark; placed: Placed }[];
}

/**
 * The drainage network grown once in round one: a tree over the land cells rooted at the
 * established waters. Every later structure (relief, ice, places, ways) is derived from it.
 * Arrays are indexed by mesh cell; heights are metres above the datum.
 */
export interface NetworkWork {
  /** Downstream cell per land cell, -1 at a root or in the sea. */
  receiver: Int32Array;
  /** Cells in order of increasing travel cost from the roots: roots first, heads last. */
  order: Int32Array;
  count: number;
  /** The eroded surface (m above the datum) the network was routed down. */
  cost: Float64Array;
  /** Upstream area (m²) including the country an entering river drains beyond the frame. */
  area: Float64Array;
  /** Reference discharge (m³/s) gathered down the tree, for channel qualification. */
  flow: Float64Array;
  /** Discharge entering across the frame edge at this cell (m³/s). */
  inflow: Float64Array;
  /** Whether the cell carries a channel at this map's scale. */
  channel: Uint8Array;
  /** Water surface level each cell's tributaries rise from (datum, edge base, lake level). */
  level: Float64Array;
  /** Connected sea on the captured base. */
  sea: Uint8Array;
  /** The smoothed captured base: the macro character the developed relief is calibrated to. */
  base: Float64Array;
  /** Captured lake index per cell, or -1. */
  lake: Int32Array;
  /** Closed depressions the parent holds (desert basins, pans) kept as sinks. */
  sink: Uint8Array;
  /** Every cell of those depressions: ground the relief may leave below its spill. */
  bowl: Uint8Array;
}

/** Relief derived from the network in the latest round, with the fields the derivation produced. */
export interface ReliefWork {
  /** Local amplification of the network's increments that fits the captured macro relief. */
  amplification: Float64Array;
  /** Cells allowed to lie below their receiver: lakes, sinks, ice-carved hollows. */
  basin: Uint8Array;
  /** Ice flux (reference units) that carved the surface, present or relict. */
  iceFlux: Float64Array;
}

/** The drainage graph of the present surface: a working structure other processes read. */
export interface DrainageWork {
  receiver: Int32Array;
  order: Int32Array;
  count: number;
}

/**
 * The working structures of the coupled rounds, kept beside the generator's own state. The
 * geography itself is the physical field on the child lattice; nothing here duplicates it.
 */
export interface RegionalWork {
  input: RegionalInput;
  /** Sample span of the pinned parent (m): the scale the captured macro character has. */
  parentSpan: number;
  /** The captured elevation (native units) before this map's own development. */
  inheritedHeight: Band;
  /** Captured present media the processes derive each round from the same place. */
  natural: Partial<Record<PhysicalBufferName, Band>>;
  /** Tracked changes the processes apply to shared media. */
  contributions: Contributions;
  /** Media the field has no band for (insolation, cold pooling, wetness), derived after each round's water. */
  media?: SharedMedia;
  /** This round's sediment reaching the sea at each root cell (m³), for the coast. */
  sediment?: { mouthLoad: Float64Array };
  /** The settled places' land: per cell the owning place's cell (-1 none) and 1 field, 2 pasture. */
  fields?: { place: Int32Array; kind: Uint8Array };
  /** The round being evaluated: 0 before the schedule, 1..3 inside it, 4 at the final refresh. */
  round: number;
  character?: RegionalCharacter;
  evidence?: Evidence;
  courses?: CapturedCourse[];
  network?: NetworkWork;
  relief?: ReliefWork;
  drainage?: DrainageWork;
  proposed: ProposedPlace[];
  /** Site classes of the developed terrain, read in round two and kept for round three. */
  sites?: (import("../societySites").SiteOpportunity | null)[];
  /** Products of an earlier refinement of this map, removed before the schedule. */
  removedProducts?: Set<string>;
  /** Captured occupation per mesh cell (people per km²), where the parent published any. */
  populationDensity?: Float64Array;
}

/** A generation state in the regional schedule: the physical workspace and the regional work. */
export type RegionalState = GenerationState & {
  physical: AtlasPhysicalWorkspace;
  regional: RegionalWork;
};

export function regionalMap(state: RegionalState): PhysicalField {
  return state.physical.map;
}

/**
 * The captured value of a band, copied the first time it is asked for, so a process that
 * derives the shared band can start from the same place every round.
 */
export function naturalBand(state: RegionalState, name: PhysicalBufferName): Band {
  const kept = state.regional.natural[name];
  if (kept) return kept;
  const map = state.physical.map,
    copy = map.coverage.copyBand(map[name]);
  copy.retain();
  state.regional.natural[name] = copy;
  return copy;
}

export const clamp = (value: number, low = 0, high = 1) => Math.max(low, Math.min(high, value));
