import type { AtlasFeature } from "@atlas/domain";
import type { AreaKindId } from "../area/areaKinds";
import type { PhysicalBufferName } from "../world/field";
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

/** The area a place stands on and how far along it, on its record: it moves when the area does. */
export interface PoiHostLink {
  readonly host: AreaKindId;
  readonly hostId: string;
  /** 0 at a course's head, 1 at its end. */
  readonly along: number;
}
/** A place of a kind on one map. Cells are the physical lattice's. */
export interface PoiPlace {
  /** The area it was placed on, recorded at that moment and never worked out afterwards. */
  hostedBy?: PoiHostLink;
  readonly id: string;
  readonly kind: PoiKindId;
  /** Every cell it occupies; one for a point. */
  readonly cells: readonly number[];
  /** The cell that locates it. */
  readonly anchor: number;
  /** Its published feature, once it has one. */
  readonly feature?: AtlasFeature;
  /** Which of its kind's origins made it, where the kind declares origins. */
  readonly origin?: string;
}
type OnCell<T> = (state: GenerationState, cell: number) => T;
/** A rule over one place; an area's roles read an area here. */
type OnPlace<T, P = PoiPlace> = (state: GenerationState, place: P) => T;

/** The terrain code a kind's places stamp on their anchors, and the codes it leaves standing. */
export interface PoiLandformMark {
  readonly code: number;
  readonly yieldsTo?: readonly number[];
}

/** Recognition: what makes it this kind and no other, in the data. */
export interface PoiRecognition {
  /** The test in a sentence. */
  readonly distinct: Must<string>;
  /** The same test over the state: whether this cell belongs to a place of this kind. */
  readonly isA: Must<OnCell<boolean>>;
  /** Filled as `unwritten` by the catalogue where a kind has not reached this work. */
  readonly landform?: Slot<PoiLandformMark>;
}

/** Where an origin says a place stands. */
export interface PoiFound {
  readonly anchor: number;
  /** Every cell it occupies; its anchor alone when omitted. */
  readonly cells?: readonly number[];
  /** The area an origin found it on, where it found it by walking one. */
  readonly hostedBy?: PoiHostLink;
}
/** A place an earlier origin of the kind already claimed, by its anchor. */
export interface PoiClaim extends PoiFound {
  readonly origin: string;
}
/**
 * One reason places of a kind come to exist. An origin runs once the kinds it reads exist on
 * this map. Earlier origins in a kind's list claim first, and a cell belongs to one origin.
 */
export interface PoiOrigin {
  readonly id: string;
  readonly statement: string;
  /** Other kinds it reads. */
  readonly reads: readonly PoiKindId[];
  /** The places it claims, given those already claimed. */
  readonly finds: (
    state: GenerationState,
    claimed: ReadonlyMap<number, PoiClaim>
  ) => readonly PoiFound[];
}

/** Coming to exist: whether it emerges from the fields or is sited, and how. */
export interface PoiExistence {
  /** Why places of this kind exist, where the reasons differ; `places` then reads their claims. */
  readonly origins?: Slot<readonly PoiOrigin[]>;
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
  | {
      readonly change: "waterPassage";
      readonly cell: number;
      /** Requested withdrawal from the current flow, in cubic metres per second. */
      readonly withdrawal: number;
      /** Fraction of the remaining flow that passes this place. */
      readonly transmission: number;
    }
  | { readonly change: "add"; readonly band: PhysicalBufferName; cell: number; amount: number }
  | { readonly change: "atMost"; readonly band: PhysicalBufferName; cell: number; value: number }
  | { readonly change: "atLeast"; readonly band: PhysicalBufferName; cell: number; value: number }
  | { readonly change: "add"; readonly magic: PoiMagicBand; cell: number; amount: number }
  | { readonly change: "atMost"; readonly magic: PoiMagicBand; cell: number; value: number }
  | { readonly change: "atLeast"; readonly magic: PoiMagicBand; cell: number; value: number }
  | { readonly change: "gradeGround"; cell: number; gradient: number };
type FieldEffect<P> = Slot<OnPlace<readonly PoiFieldChange[], P>>;

/** Initialization Command strategy. The event owner invokes it only when an event occurs. */
export interface PoiEventCommand<State = GenerationState> {
  readonly accepts: (event: PoiStruck) => boolean;
  readonly changes: (state: State, event: PoiStruck) => readonly PoiPhysicalChange[];
}
/** Something that has just struck a cell: its kind, and how hard it fell from nothing to one. */
export interface PoiStruck {
  readonly kind: string;
  readonly magnitude: number;
  readonly cell: number;
}
export type PoiPhysicalChange = Extract<PoiFieldChange, { readonly band: PhysicalBufferName }>;

/** Maintained Query declarations: current influences, never initialization of a historical event. */
export interface PoiFieldEffects<P = PoiPlace> {
  readonly statement: Must<string>;
  readonly terrain: FieldEffect<P>;
  readonly water: FieldEffect<P>;
  readonly climate: FieldEffect<P>;
  readonly cover: FieldEffect<P>;
  readonly magic: FieldEffect<P>;
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
  /** The kind of area its places stand on. Each records its area as it is placed. */
  readonly standsOn?: Slot<AreaKindId>;
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
export type PoiCostList<P = PoiPlace> = OnPlace<readonly PoiCost[], P>;
type CostEffect<P> = Slot<PoiCostList<P>>;
export type PoiMagicCarrier = "crust" | "roots" | "river" | "wind" | "current" | "ice" | "people";
/** Two cells a route passes between directly, whatever lies between. */
export interface PoiLink {
  readonly a: number;
  readonly b: number;
}
export type PoiBarrier = "river" | "ridge" | "strait" | "wetland" | "ice" | "ward";

/** Movement: how it changes the cost or possibility of what moves across the map. */
export interface PoiMovement<P = PoiPlace> {
  readonly statement: Must<string>;
  /** Roads and tracks. */
  readonly roads: CostEffect<P>;
  /** Boats on rivers, lakes and the sea. */
  readonly boats: CostEffect<P>;
  /** The drainage network as it grows. */
  readonly drainage: CostEffect<P>;
  /** Each of magic's carriers it changes: the crust, a river and the wind differ. */
  readonly magic: Slot<Readonly<Partial<Record<PoiMagicCarrier, PoiCostList<P>>>>>;
  /** Cells it joins for walkers: a door's two ends. */
  readonly links: Slot<OnPlace<readonly PoiLink[], P>>;
  /** Barriers it lets a route across. */
  readonly crosses: Slot<OnPlace<readonly PoiBarrier[], P>>;
}

/** A relation to another kind of place, and whether it holds between two places. */
export interface PoiRelation<P = PoiPlace> {
  readonly kind: PoiKindId;
  holds(state: GenerationState, place: P, other: PoiPlace): boolean;
}
type Relations<P> = Slot<readonly PoiRelation<P>[]>;

/**
 * Other POIs: what it needs, excludes, contains and pairs with. These relations are declared
 * and not enforced yet: generation does not read them. A kind's turn turns its own on.
 */
export interface PoiOthers<P = PoiPlace> {
  readonly statement: Must<string>;
  readonly needs: Relations<P>;
  readonly excludes: Relations<P>;
  readonly contains: Relations<P>;
  readonly pairsWith: Relations<P>;
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
export interface PoiPeople<P = PoiPlace> {
  readonly statement: Must<string>;
  /** Each benefit's strength, in [0, 1]. */
  readonly offers: Slot<OnPlace<Readonly<Partial<Record<PoiBenefit, number>>>, P>>;
  readonly threatens: Slot<OnPlace<readonly PoiHazard[], P>>;
}

/** What becomes of a place as an epoch closes. */
export type PoiFate =
  | { readonly fate: "persists" }
  | { readonly fate: "becomes"; readonly kind: PoiKindId }
  | { readonly fate: "ends"; readonly leaves?: PoiKindId };

/** Through time: how it forms, changes or ends across epochs, and what it leaves behind. */
export interface PoiThroughTime<P = PoiPlace> {
  readonly statement: Must<string>;
  readonly fate: Slot<OnPlace<PoiFate, P>>;
}

/** Each consideration in [0, 1]. */
type VisibilityFactor<P> = Slot<OnPlace<number, P>>;

/** Visibility: what earns it a place at a given scale; not size or resolution alone. */
export interface PoiVisibility<P = PoiPlace> {
  readonly statement: Must<string>;
  /** Its own size against others of its kind. */
  readonly magnitude: VisibilityFactor<P>;
  /** How far it stands out from local conditions: a peak over plains against one among peaks. */
  readonly localConditions: VisibilityFactor<P>;
  /** How far it stands from others of its kind that outrank it. */
  readonly isolation: VisibilityFactor<P>;
  /** People's attachment: a capital at its foot, a town named after it, a route over it. */
  readonly cultural: VisibilityFactor<P>;
  /**
   * What the place weighs among its kind, in [0, 1]. Nothing reads it yet: the map draws what
   * exists, and a layer's own scale setting is the one control over when it shows.
   */
  readonly importance: Must<OnPlace<number, P>>;
}

/** The words a place's name is made with. */
export interface PoiNameTerm {
  readonly kind: "landform";
  readonly subkind?: string;
  readonly term?: string;
}
/** A place another may take its name from: the shared naming step acts on those with a chance. */
export interface PoiNameRelation<P = PoiPlace> extends PoiRelation<P> {
  /** How likely a place is to take the name, in [0, 1]. Without one the relation is not read. */
  readonly chance?: number;
}

/** Naming: who names it and what takes its name. */
export interface PoiNaming<P = PoiPlace> {
  readonly statement: Must<string>;
  /** The naming culture that names it, or null when it goes unnamed. */
  readonly namedBy: Slot<OnPlace<string | null, P>>;
  /** Places it takes its name from. */
  readonly takesNameFrom: Slot<readonly PoiNameRelation<P>[]>;
  /** Places that take their name from it. */
  readonly lendsNameTo: Relations<P>;
  /** The words of its name, where a place's own character chooses them. */
  readonly term?: Slot<OnPlace<PoiNameTerm, P>>;
}

/** Which type of its kind a place is, chosen once per place and kept: a peak's form, a lake's. */
export interface PoiVariety<P = PoiPlace> {
  readonly statement: string;
  /** Chooses from the place's readings and chance. */
  readonly of: OnPlace<string, P>;
}
/**
 * What one place of this kind really is, whatever map it is on: roughly real sizes with a long
 * tail. A record can stand for one thing or a system of many, and it carries down unchanged. The
 * map's symbol for it makes no claim about its size.
 */
export interface PoiTrueSize<P = PoiPlace> {
  readonly statement: string;
  /** Real measurements in metres. */
  readonly size: OnPlace<{ height?: number; width?: number; length?: number }, P>;
  /** One thing, or a system of this many members. */
  readonly represents: OnPlace<{ members: number }, P>;
}
/** How a place shows on the map. Open work: every kind answers it when symbols reach it. */
export type PoiAppearance = Record<string, unknown>;

/**
 * The roles every mapped thing answers, whether a POI or an area. The slots marked optional are
 * open work: a kind leaves them out until its turn, and the catalogue fills them as `unwritten`,
 * so they stay listed.
 */
export interface PlaceRoles<P> {
  readonly trueSize?: Slot<PoiTrueSize<P>>;
  readonly variety?: Slot<PoiVariety<P>>;
  readonly appearance?: Slot<OnPlace<PoiAppearance, P>>;
  /** A sentence on why this place is here. */
  readonly account?: Slot<OnPlace<string, P>>;
  readonly fields: PoiFieldEffects<P>;
  readonly movement: PoiMovement<P>;
  readonly others: PoiOthers<P>;
  readonly people: PoiPeople<P>;
  readonly time: PoiThroughTime<P>;
  readonly visibility: PoiVisibility<P>;
  readonly naming: PoiNaming<P>;
}
/** One catalogue entry: the shared roles, and how a spot is found, published and carried. */
export interface PoiEntry extends PlaceRoles<PoiPlace> {
  readonly id: PoiKindId;
  readonly group: PoiGroupId;
  readonly name: string;
  readonly recognition: PoiRecognition;
  readonly existence: PoiExistence;
  readonly publication: PoiPublication;
  readonly acrossMaps: PoiAcrossMaps;
  /** A new event can change actual material once; retained records never invoke this command. */
  readonly event?: PoiEventCommand;
}

/** A group page: what its members physically share and what it leaves out. */
export interface PoiGroupPage {
  readonly id: PoiGroupId;
  readonly name: string;
  readonly belongs: Must<string>;
  readonly excludes: Must<string>;
}
