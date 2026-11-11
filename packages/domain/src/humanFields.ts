/**
 * What people are on the land, held on every cell of the land's own mesh beside the ground.
 * Places, farm country, regions and territories are read from these afterwards; no record of
 * a place is the source of where people are. Every value is per area of ground, so a layer
 * means the same on a coarse cell and a fine one, and the crust carries it as it carries soil.
 */
export const humanLayers = {
  /** People living on the cell, per square kilometre of it. */
  population: "Population",
  /** Shares of the cell's area under crops, under herds and under buildings. */
  farmland: "Farmland",
  pasture: "Pasture",
  builtUp: "BuiltUp",
  /** The works and wealth built places have accumulated, in person-years per square kilometre. */
  standing: "Standing",
} as const;
export type HumanLayerId = keyof typeof humanLayers;
export const humanLayerIds = Object.keys(humanLayers) as HumanLayerId[];

/**
 * What built places leave when they end: the share of the cell their remains cover, the works
 * still in them, the share of those remains now under ground or water, and the tongue of the
 * people who built them.
 */
export const humanRemains = {
  builtUp: "RuinedBuiltUp",
  standing: "RuinedStanding",
  cover: "RuinCover",
  tongue: "RuinTongue",
} as const;

/** Layers a cell's identity column can hold, newest first. */
export const identitySlots = 4;
/** The traditions a layer of the column names, each a code of a named tradition; 0 is none. */
export const identityTraditions = ["Tongue", "Faith", "Custom", "Allegiance"] as const;
export type IdentityTradition = (typeof identityTraditions)[number];
type Slot = 0 | 1 | 2 | 3;
const slots = Array.from({ length: identitySlots }, (_, slot) => slot as Slot);
const stack = <Name extends string>(name: Name) =>
  slots.map((slot) => `Identity${name}${slot}` as `Identity${Name}${Slot}`);
/**
 * The identity column riding in the population: per layer, the people per square kilometre
 * who hold it, how far it
 * resists being overlaid (0 to 1), its age in years, and the traditions it names.
 */
export const identityColumn = {
  people: stack("People"),
  hardness: stack("Hardness"),
  age: stack("Age"),
  traditions: Object.fromEntries(
    identityTraditions.map((tradition) => [tradition, stack(tradition)])
  ) as { [T in IdentityTradition]: `Identity${T}${Slot}`[] },
} as const;

export const humanIntegerFields = [
  humanRemains.tongue,
  ...identityTraditions.flatMap((tradition) => identityColumn.traditions[tradition]),
] as const;
export const humanScalarFields = [
  ...humanLayerIds.map((id) => humanLayers[id]),
  humanRemains.builtUp,
  humanRemains.standing,
  humanRemains.cover,
  ...identityColumn.people,
  ...identityColumn.hardness,
  ...identityColumn.age,
] as const;
/** A band that holds an amount or a share of people's layers or their remains. */
export type HumanScalarName = (typeof humanScalarFields)[number];
export type HumanBandName = HumanScalarName | (typeof humanIntegerFields)[number];
export const humanBandNames: readonly HumanBandName[] = [
  ...humanScalarFields,
  ...humanIntegerFields,
];
