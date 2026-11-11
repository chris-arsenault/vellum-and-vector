import {
  humanLayerIds,
  humanLayers,
  humanRemains,
  type HumanLayerId,
  type HumanScalarName,
} from "@atlas/domain";

/**
 * The vocabulary between what acts on people's layers and the layers themselves: each mode is
 * one way a layer is lost. Whatever acts states its action as a mix of modes and a layer kind
 * answers from its facts, so neither names the other. Add a mode only when something real
 * cannot act without it.
 */
export const layerModes = [
  /** Standing water or the sea over the ground. */
  "drown",
  /** Water, ice or debris moving across the surface. */
  "scour",
  /** Shock passing through the ground. */
  "shake",
  /** Heat and fire. */
  "burn",
  /** Nobody keeping it up. */
  "neglect",
] as const;
export type LayerModeId = (typeof layerModes)[number];
/** How something acts on the layers: each mode's share of what it does. */
export type LayerModeMix = Readonly<Partial<Record<LayerModeId, number>>>;

export interface LayerFacts {
  /** The band that holds it. */
  readonly band: HumanScalarName;
  /** A share of the cell's area, competing with the other shares, or a density on the cell. */
  readonly measure: "area" | "density";
  /** The share a full attack of each mode takes. */
  readonly yields: Readonly<Record<LayerModeId, number>>;
  /** Where what is taken stays on the ground as remains, and how much of it each mode leaves. */
  readonly remains?: {
    readonly band: HumanScalarName;
    readonly left: Readonly<Record<LayerModeId, number>>;
  };
  /** How far a place's full standing holds this layer against every attack. */
  readonly standingHolds: number;
  /** Whether the identity column rides in it. */
  readonly carriesIdentity?: boolean;
  /**
   * What the layer leaves in the ground's own records, which magic is made of: the years it
   * has been lived on, the ways its movement wears, and the count of what it has lost.
   */
  readonly ground?: {
    readonly tenure: "Tenure";
    readonly ways: "WalkedRoute";
    readonly losses: "MassDeath";
  };
}
const ruin = { drown: 1, scour: 0.2, shake: 0.9, burn: 0.7, neglect: 1 };
/** Every kind of human layer and the facts everything else reads it by. */
export const layerCatalogue: Readonly<Record<HumanLayerId, LayerFacts>> = {
  // People drown, are swept off and burn; a shock kills fewer than it unhouses.
  population: {
    band: humanLayers.population,
    measure: "density",
    yields: { drown: 1, scour: 1, shake: 0.3, burn: 0.6, neglect: 0 },
    standingHolds: 0.5,
    carriesIdentity: true,
    ground: { tenure: "Tenure", ways: "WalkedRoute", losses: "MassDeath" },
  },
  // Untended fields go back to the wild within a lifetime.
  farmland: {
    band: humanLayers.farmland,
    measure: "area",
    yields: { drown: 1, scour: 0.8, shake: 0, burn: 0.5, neglect: 0.6 },
    standingHolds: 0,
  },
  pasture: {
    band: humanLayers.pasture,
    measure: "area",
    yields: { drown: 1, scour: 0.5, shake: 0, burn: 0.3, neglect: 0.3 },
    standingHolds: 0,
  },
  // Buildings outlast their people, and what brings them down mostly leaves them where they stood.
  builtUp: {
    band: humanLayers.builtUp,
    measure: "area",
    yields: { drown: 0.6, scour: 0.8, shake: 0.7, burn: 0.6, neglect: 0.25 },
    remains: { band: humanRemains.builtUp, left: ruin },
    standingHolds: 1,
  },
  standing: {
    band: humanLayers.standing,
    measure: "density",
    yields: { drown: 0.6, scour: 0.8, shake: 0.5, burn: 0.5, neglect: 0.25 },
    remains: { band: humanRemains.standing, left: ruin },
    standingHolds: 1,
  },
};
/** The kinds the owner must tell apart by what they are for, named here and nowhere else. */
export const layerRoles = {
  /** The layer the identity column rides in. */
  people: "population",
  /** The built ground a place's standing is measured over, and the works that make it. */
  built: "builtUp",
  works: "standing",
} as const satisfies Record<string, HumanLayerId>;
/** The kinds that share a cell's area between them. */
export const areaLayers = humanLayerIds.filter((id) => layerCatalogue[id].measure === "area");
/** Years over which a way nobody walks and a line nobody keeps are forgotten. */
export const wayMemoryYears = 150;
/** The ground records that fade unless renewed. */
export const forgottenGround = ["WalkedRoute", "KeptLine"] as const;
/** The person-years of works a square kilometre of buildings holds at a place's fullest. */
export const fullStandingPerBuiltKm2 = 2_000_000;

/** A mix resolved against every kind at load: a cell reads numbers and no rule runs per cell. */
export interface CompiledLayerMix {
  /** By kind, in `humanLayerIds` order: the share a full attack takes. */
  readonly yields: Float64Array;
  /** By kind: the share of what is taken that stays as remains. */
  readonly left: Float64Array;
}
export function compileLayerMix(mix: LayerModeMix): CompiledLayerMix {
  const yields = new Float64Array(humanLayerIds.length),
    left = new Float64Array(humanLayerIds.length);
  for (const [index, id] of humanLayerIds.entries()) {
    const facts = layerCatalogue[id];
    let stays = 0;
    for (const mode of layerModes) {
      const taken = (mix[mode] ?? 0) * facts.yields[mode];
      yields[index] += taken;
      stays += taken * (facts.remains?.left[mode] ?? 0);
    }
    left[index] = yields[index] > 0 ? stays / yields[index] : 0;
  }
  return { yields, left };
}
