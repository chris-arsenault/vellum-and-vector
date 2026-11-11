import type { AtlasFeature } from "@atlas/domain";
import type { Geometry } from "geojson";
import type { Must, PlaceRoles, PoiHostLink, PoiMoment, Slot } from "../poi/poiContract";
import type { GenerationState, MapProcessContext } from "../process";
import type { RegionalState } from "../regional/state";
import type { AreaKindId } from "./areaKinds";

/**
 * The area contract: the one definition of each kind of thing located by an extent rather than a
 * spot. An area shares the POI contract's roles and differs in how it is located, published,
 * carried across maps and stood on. Refinement answers where and how big an area is, never whether
 * it exists (ADR 0009), so no rule here can remove one.
 */

export type AreaForm = "region" | "course" | "network";
/** One stretch of a network. */
export interface AreaEdge {
  readonly id: string;
  readonly cells: readonly number[];
}
/** Where an area is. Cells are optional: a building interior has no lattice. */
export interface AreaExtent {
  readonly form: AreaForm;
  /** Its cells; ordered from head to end for a course. */
  readonly cells?: readonly number[];
  readonly edges?: readonly AreaEdge[];
  readonly outline?: Geometry;
}
/** An area on one map. Its identity lasts its whole life and does not come from its records. */
export interface AreaPlace {
  readonly id: string;
  readonly kind: AreaKindId;
  readonly extent: AreaExtent;
}

/** Recognition: what makes it this kind, in the data. */
export interface AreaRecognition {
  readonly distinct: Must<string>;
  /** Whether a cell lies in an area of this kind on this map. */
  readonly covers: Slot<(state: GenerationState, cell: number) => boolean>;
}
/** Coming to exist. */
export interface AreaExistence {
  readonly statement: Must<string>;
  readonly way: Must<"emerges" | "sited" | "both">;
  /** Every area of this kind on this map. */
  readonly areas: Must<(state: GenerationState) => readonly AreaPlace[]>;
}
/** Publication. One area may write several records, each saying which area it draws. */
export interface AreaPublication {
  readonly statement: Must<string>;
  readonly moment: Must<PoiMoment>;
  readonly publish: Must<(state: GenerationState, context: MapProcessContext) => void>;
}
/** How an area continues on a finer map. Nothing is matched afterwards. */
export interface AreaLineage {
  readonly statement: Must<string>;
  /** The area a parent's record draws. */
  readonly identity: Must<(record: AtlasFeature) => string>;
  /** That area on this map, as the kind forms it here; null only when it lies off this map. */
  readonly continues: Must<(state: RegionalState, parent: AtlasFeature) => AreaPlace | null>;
  /** This map's records of a continuing area take over its name and identity. */
  readonly adopt: Slot<(state: RegionalState) => void>;
}
/** How places stand on it. A place records the link when it is placed. */
export interface AreaHosting {
  readonly statement: Must<string>;
  /** The link a place standing at this cell records, if an area of this kind is there. */
  readonly linkAt: Slot<(state: GenerationState, cell: number) => PoiHostLink | null>;
  /** Where a place that recorded a link stands on this map, or -1 when that lies off this map. */
  readonly cellFor: Slot<(state: RegionalState, link: PoiHostLink) => number>;
}
/** One area entry: the POI contract's shared roles, and its own. */
export interface AreaEntry extends PlaceRoles<AreaPlace> {
  readonly id: AreaKindId;
  readonly form: AreaForm;
  readonly name: string;
  readonly recognition: AreaRecognition;
  readonly existence: AreaExistence;
  readonly publication: AreaPublication;
  readonly lineage: AreaLineage;
  readonly hosting: AreaHosting;
}
