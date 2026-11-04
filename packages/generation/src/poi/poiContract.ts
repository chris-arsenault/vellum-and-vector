import type { AtlasFeature } from "@atlas/domain";
import type { PhysicalBufferName } from "../canonry/field";
import type { GenerationState } from "../process";
import type { FeatureCause } from "../regional/causes/registry";
import type { RegionalState } from "../regional/state";
import type { PoiGroupId, PoiKindId } from "./poiKinds";

/**
 * The POI contract: a POI is a participant in generation, not a label on a finished map. An
 * entry is the generator's one definition of its kind: generation finds, publishes and applies
 * places through it, and no second test or publisher of the kind exists elsewhere. Every kind
 * answers every field below. Rules are pure functions over the generator's own state and reuse
 * its calculations. A field-wide process keeps its own writes; an entry declares only what the
 * place itself does, so each effect has one writer.
 */

/** A field not yet specified. Open work stays visible and can be listed. */
export const unwritten = { slot: "unwritten" } as const;
export type Unwritten = typeof unwritten;
/** A field that does not apply to this kind, and why: a pass stores no water. */
export interface NotApplicable {
  readonly slot: "notApplicable";
  readonly why: string;
}
export const notApplicable = (why: string): NotApplicable => ({ slot: "notApplicable", why });
/** A field every kind must answer. */
export type Must<T> = T | Unwritten;
/** A field a kind answers, or states does not apply. */
export type Slot<T> = T | Unwritten | NotApplicable;

/** A place of a kind on one map. Cells are the physical lattice's. */
export interface PoiPlace {
  readonly id: string;
  readonly kind: PoiKindId;
  /** Every cell it occupies; one for a point. */
  readonly cells: readonly number[];
  /** The cell that locates it. */
  readonly anchor: number;
  /** Its published feature, once it has one. */
  readonly feature?: AtlasFeature;
}
type OnCell<T> = (state: GenerationState, cell: number) => T;
type OnPlace<T> = (state: GenerationState, place: PoiPlace) => T;

/** Recognition: what makes it this kind and no other, in the data. */
export interface PoiRecognition {
  /** The test in a sentence. */
  readonly distinct: Must<string>;
  /** The same test over the state: whether this cell belongs to a place of this kind. */
  readonly isA: Must<OnCell<boolean>>;
}

/** Coming to exist: whether it emerges from the fields or is sited, and how. */
export interface PoiExistence {
  readonly statement: Must<string>;
  readonly way: Must<"emerges" | "sited" | "both">;
  /** What must already be at a cell for one to stand there. */
  readonly requires: Slot<OnCell<boolean>>;
  /** How well a cell suits one, in [0, 1], where a process chooses the site. */
  readonly suitability: Slot<OnCell<number>>;
  /** Every place of this kind on this map. */
  readonly places: Must<(state: GenerationState) => readonly PoiPlace[]>;
}

/** When in a run a kind's places are published: what they read must exist by then. */
export type PoiMoment = "geography" | "magic" | "society";

/** Publication: the record a place writes on its map; generation writes nothing else for it. */
export interface PoiPublication {
  readonly statement: Must<string>;
  readonly moment: Must<PoiMoment>;
  /** The feature a place publishes as, or null when it has no record at this size. */
  readonly record: Must<OnPlace<AtlasFeature | null>>;
}

/** A magic system's own channel or stock, which the field's named bands do not hold. */
export type PoiMagicBand =
  | {
      readonly system: string;
      readonly channel: "intensity" | "source" | "history" | "wild" | "stored";
    }
  | { readonly system: string; readonly stock: string };
/**
 * A declared change, applied as a total each evaluation so that it never compounds. Changes
 * to one cell of one band combine: additions sum, then the bounds hold.
 */
export type PoiFieldChange =
  | { readonly change: "add"; readonly band: PhysicalBufferName; cell: number; amount: number }
  | { readonly change: "atMost"; readonly band: PhysicalBufferName; cell: number; value: number }
  | { readonly change: "atLeast"; readonly band: PhysicalBufferName; cell: number; value: number }
  | { readonly change: "add"; readonly magic: PoiMagicBand; cell: number; amount: number }
  | { readonly change: "atMost"; readonly magic: PoiMagicBand; cell: number; value: number }
  | { readonly change: "atLeast"; readonly magic: PoiMagicBand; cell: number; value: number }
  | { readonly change: "gradientAtMost"; cell: number; gradient: number };
type FieldEffect = Slot<OnPlace<readonly PoiFieldChange[]>>;

/** Effect on fields: what it does to each medium while it exists: source, sink, store, barrier, a shape held. */
export interface PoiFieldEffects {
  readonly statement: Must<string>;
  readonly terrain: FieldEffect;
  readonly water: FieldEffect;
  readonly climate: FieldEffect;
  readonly cover: FieldEffect;
  readonly magic: FieldEffect;
}

/** A place carried onto a refined map: where it lands on the child's lattice. */
export interface PoiCarried {
  readonly feature: AtlasFeature;
  /** The cell that locates it. */
  readonly cell: number;
  /** Every cell its parent's record covers on this map; one for a point. */
  readonly cells: readonly number[];
}
/** What a carried place does when the finer ground cannot provide it. */
export type PoiUnrealized =
  | { readonly outcome: "keep" }
  | { readonly outcome: "move"; readonly cell: number }
  | { readonly outcome: "drop" };

/** Across maps: what a parent map's place means when a region is refined. Writes the child only. */
export interface PoiAcrossMaps {
  readonly statement: Must<string>;
  /** What carries down from the parent's feature, or null when it does not reach this map. */
  readonly carry: Slot<(state: RegionalState, feature: AtlasFeature) => PoiCarried | null>;
  /** What the finer ground must provide: a graded city seat, a waterfall's step. */
  readonly realize: Slot<(state: RegionalState, carried: PoiCarried) => readonly PoiFieldChange[]>;
  /** The cell of its counterpart on the developed child, or -1 when the ground holds none. */
  readonly counterpart: Slot<(state: RegionalState, carried: PoiCarried) => number>;
  /** What happens when the ground holds no counterpart. */
  readonly unrealized: Slot<(state: RegionalState, carried: PoiCarried) => PoiUnrealized>;
  /** Its own change on the developed ground after a round's water: a seat settling. */
  readonly settle: Slot<(state: RegionalState, carried: PoiCarried) => PoiUnrealized>;
  /** What it does at the points of refinement's schedule that are not field changes. */
  readonly schedule: Slot<FeatureCause>;
}

/** A network's cost at a cell, multiplied: 1 changes nothing; Infinity bars it. */
export interface PoiCost {
  readonly cell: number;
  readonly factor: number;
}
/** The cells a place changes a network's cost on, and by how much; others are untouched. */
export type PoiCostList = OnPlace<readonly PoiCost[]>;
type CostEffect = Slot<PoiCostList>;
export type PoiMagicCarrier = "crust" | "roots" | "river" | "wind" | "current" | "ice" | "people";
/** Two cells a route passes between directly, whatever lies between. */
export interface PoiLink {
  readonly a: number;
  readonly b: number;
}
export type PoiBarrier = "river" | "ridge" | "strait" | "wetland" | "ice" | "ward";

/** Movement: how it changes the cost or possibility of what moves across the map. */
export interface PoiMovement {
  readonly statement: Must<string>;
  /** Roads and tracks. */
  readonly roads: CostEffect;
  /** Boats on rivers, lakes and the sea. */
  readonly boats: CostEffect;
  /** The drainage network as it grows. */
  readonly drainage: CostEffect;
  /** Each of magic's carriers it changes: the crust, a river and the wind differ. */
  readonly magic: Slot<Readonly<Partial<Record<PoiMagicCarrier, PoiCostList>>>>;
  /** Cells it joins for walkers: a door's two ends. */
  readonly links: Slot<OnPlace<readonly PoiLink[]>>;
  /** Barriers it lets a route across. */
  readonly crosses: Slot<OnPlace<readonly PoiBarrier[]>>;
}

/** A relation to another kind of place, and whether it holds between two places. */
export interface PoiRelation {
  readonly kind: PoiKindId;
  holds(state: GenerationState, place: PoiPlace, other: PoiPlace): boolean;
}
type Relations = Slot<readonly PoiRelation[]>;

/** Other POIs: what it needs, excludes, contains and pairs with. */
export interface PoiOthers {
  readonly statement: Must<string>;
  readonly needs: Relations;
  readonly excludes: Relations;
  readonly contains: Relations;
  readonly pairsWith: Relations;
}

export type PoiBenefit =
  "water" | "food" | "power" | "defence" | "trade" | "materials" | "sanctity";
export interface PoiHazard {
  readonly hazard: string;
  /** Ground distance it reaches, in metres. */
  readonly reach: number;
  /** In [0, 1]. */
  readonly severity: number;
}

/** People: what it gives them and what it threatens; feeds siting, events and cultural importance. */
export interface PoiPeople {
  readonly statement: Must<string>;
  /** Each benefit's strength, in [0, 1]. */
  readonly offers: Slot<OnPlace<Readonly<Partial<Record<PoiBenefit, number>>>>>;
  readonly threatens: Slot<OnPlace<readonly PoiHazard[]>>;
}

/** What becomes of a place as an epoch closes. */
export type PoiFate =
  | { readonly fate: "persists" }
  | { readonly fate: "becomes"; readonly kind: PoiKindId }
  | { readonly fate: "ends"; readonly leaves?: PoiKindId };

/** Through time: how it forms, changes or ends across epochs, and what it leaves behind. */
export interface PoiThroughTime {
  readonly statement: Must<string>;
  readonly fate: Slot<OnPlace<PoiFate>>;
}

/** Each consideration in [0, 1]. */
type VisibilityFactor = Slot<OnPlace<number>>;

/** Visibility: what earns it a place at a given scale; not size or resolution alone. */
export interface PoiVisibility {
  readonly statement: Must<string>;
  /** Its own size against others of its kind. */
  readonly magnitude: VisibilityFactor;
  /** How far it stands out from local conditions: a summit over plains against one among peaks. */
  readonly localConditions: VisibilityFactor;
  /** How far it stands from others of its kind that outrank it. */
  readonly isolation: VisibilityFactor;
  /** People's attachment: a capital at its foot, a town named after it, a route over it. */
  readonly cultural: VisibilityFactor;
  /**
   * What the place weighs, in [0, 1], stored on its record. Whether it is drawn at a view is
   * `placeDrawn` over this and the view, the one rule the map applies to every kind.
   */
  readonly importance: Must<OnPlace<number>>;
}

/** Naming: who names it and what takes its name. */
export interface PoiNaming {
  readonly statement: Must<string>;
  /** The naming culture that names it, or null when it goes unnamed. */
  readonly namedBy: Slot<OnPlace<string | null>>;
  /** Places it takes its name from. */
  readonly takesNameFrom: Relations;
  /** Places that take their name from it. */
  readonly lendsNameTo: Relations;
}

/** One catalogue entry: every role, every field, written out. */
export interface PoiEntry {
  readonly id: PoiKindId;
  readonly group: PoiGroupId;
  readonly name: string;
  readonly recognition: PoiRecognition;
  readonly existence: PoiExistence;
  readonly publication: PoiPublication;
  readonly fields: PoiFieldEffects;
  readonly acrossMaps: PoiAcrossMaps;
  readonly movement: PoiMovement;
  readonly others: PoiOthers;
  readonly people: PoiPeople;
  readonly time: PoiThroughTime;
  readonly visibility: PoiVisibility;
  readonly naming: PoiNaming;
}

/** A group page: what its members physically share and what it leaves out. */
export interface PoiGroupPage {
  readonly id: PoiGroupId;
  readonly name: string;
  readonly belongs: Must<string>;
  readonly excludes: Must<string>;
}
