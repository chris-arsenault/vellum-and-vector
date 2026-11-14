/**
 * What people are on the land, held on every cell of the land's own mesh beside the ground.
 * Places, farm country, regions and territories are read from these afterwards; no record of
 * a place is the source of where people are. Every value is per area of ground, so a layer
 * means the same on a coarse cell and a fine one, and the crust carries it as it carries soil.
 */
export declare const humanLayers: {
  /** People living on the cell, per square kilometre of it. */
  readonly population: "Population";
  /** Shares of the cell's area under crops, under herds and under buildings. */
  readonly farmland: "Farmland";
  readonly pasture: "Pasture";
  readonly builtUp: "BuiltUp";
  /** The works and wealth built places have accumulated, in person-years per square kilometre. */
  readonly standing: "Standing";
};
export type HumanLayerId = keyof typeof humanLayers;
export declare const humanLayerIds: HumanLayerId[];
/**
 * What built places leave when they end: the share of the cell their remains cover, the works
 * still in them, the share of those remains now under ground or water, and the tongue of the
 * people who built them.
 */
export declare const humanRemains: {
  readonly builtUp: "RuinedBuiltUp";
  readonly standing: "RuinedStanding";
  readonly cover: "RuinCover";
  readonly tongue: "RuinTongue";
};
/** Layers a cell's identity column can hold, newest first. */
export declare const identitySlots = 4;
/** The traditions a layer of the column names, each a code of a named tradition; 0 is none. */
export declare const identityTraditions: readonly [
  "Tongue",
  "Faith",
  "Custom",
  "Allegiance",
  "Craft",
];
export type IdentityTradition = (typeof identityTraditions)[number];
type Slot = 0 | 1 | 2 | 3;
/**
 * The identity column riding in the population: per layer, the people per square kilometre
 * who hold it, how far it
 * resists being overlaid (0 to 1), its age in years, and the traditions it names.
 */
export declare const identityColumn: {
  readonly people: (
    "IdentityPeople0" | "IdentityPeople1" | "IdentityPeople2" | "IdentityPeople3"
  )[];
  readonly hardness: (
    "IdentityHardness0" | "IdentityHardness1" | "IdentityHardness2" | "IdentityHardness3"
  )[];
  readonly age: ("IdentityAge0" | "IdentityAge1" | "IdentityAge2" | "IdentityAge3")[];
  readonly traditions: { [T in IdentityTradition]: `Identity${T}${Slot}`[] };
};
export declare const humanIntegerFields: readonly [
  "RuinTongue",
  ...(
    | "IdentityTongue0"
    | "IdentityTongue1"
    | "IdentityTongue2"
    | "IdentityTongue3"
    | "IdentityFaith0"
    | "IdentityFaith1"
    | "IdentityFaith2"
    | "IdentityFaith3"
    | "IdentityCustom0"
    | "IdentityCustom1"
    | "IdentityCustom2"
    | "IdentityCustom3"
    | "IdentityAllegiance0"
    | "IdentityAllegiance1"
    | "IdentityAllegiance2"
    | "IdentityAllegiance3"
    | "IdentityCraft0"
    | "IdentityCraft1"
    | "IdentityCraft2"
    | "IdentityCraft3"
  )[],
];
export declare const humanScalarFields: readonly (
  | "RuinedBuiltUp"
  | "RuinedStanding"
  | "RuinCover"
  | "IdentityPeople0"
  | "IdentityPeople1"
  | "IdentityPeople2"
  | "IdentityPeople3"
  | "IdentityHardness0"
  | "IdentityHardness1"
  | "IdentityHardness2"
  | "IdentityHardness3"
  | "IdentityAge0"
  | "IdentityAge1"
  | "IdentityAge2"
  | "IdentityAge3"
  | "Population"
  | "Farmland"
  | "Pasture"
  | "BuiltUp"
  | "Standing"
)[];
/** A band that holds an amount or a share of people's layers or their remains. */
export type HumanScalarName = (typeof humanScalarFields)[number];
export type HumanBandName = HumanScalarName | (typeof humanIntegerFields)[number];
export declare const humanBandNames: readonly HumanBandName[];
export {};
