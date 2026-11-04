import type { AtlasFeature } from "@atlas/domain";
import type { PhysicalBufferName } from "../canonry/field";
import type { GenerationState } from "../process";
import type { RegionalState } from "../regional/state";
import type { PoiGroupId, PoiKindId } from "./poiKinds";

/**
 * The POI contract, agreed with the owner: a POI is a participant in generation, not a label
 * on a finished map. Every kind answers every field below, in this shape. This file changes
 * only when the owner asks; a field that seems wrong is raised with the owner, not worked
 * around. Rules are pure functions over the generator's own state and reuse its calculations.
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

/** A declared change to the physical field, applied through the regional `Contributions`. */
export type PoiFieldChange =
  | { readonly change: "add"; readonly band: PhysicalBufferName; cell: number; amount: number }
  | { readonly change: "atMost"; readonly band: PhysicalBufferName; cell: number; value: number }
  | { readonly change: "atLeast"; readonly band: PhysicalBufferName; cell: number; value: number }
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
  readonly cell: number;
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
}

/** A multiplier on a network's cost at a cell near a place: 1 changes nothing; Infinity bars it. */
type CostEffect = Slot<(state: GenerationState, place: PoiPlace, cell: number) => number>;
export type PoiBarrier = "river" | "ridge" | "strait" | "wetland" | "ice";

/** Movement: how it changes the cost or possibility of what moves across the map. */
export interface PoiMovement {
  readonly statement: Must<string>;
  /** Roads and tracks. */
  readonly roads: CostEffect;
  /** Boats on rivers, lakes and the sea. */
  readonly boats: CostEffect;
  /** The drainage network as it grows. */
  readonly drainage: CostEffect;
  /** Magic's carriers: crust, river, wind, current, ice, people. */
  readonly magic: CostEffect;
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
  /** Whether it is drawn on a view of this ground resolution. Deterministic. */
  readonly visibleAt: Must<
    (state: GenerationState, place: PoiPlace, metresPerPixel: number) => boolean
  >;
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
