/**
 * The one catalogue of what the ground is made of: facts about each material and nothing about what
 * acts on it. How facts answer an attack belongs to `modes`, how a process acts belongs to the
 * process, and `Ground` carries one through the other. Resistance is on the scale of the field's
 * `RockResistance` band; the other facts are in [0, 1]. Nothing places a kind on the map: each exists
 * because a process made it there. A new kind is one entry with a new code.
 */
/**
 * How a material came to be, whichever process made it: laid down in layers, cooled from melt, changed
 * where it lay, shattered and rotted into rubble, or still loose. Magic's rock belongs by how it behaves.
 */
export type RockFamily = "sedimentary" | "igneous" | "metamorphic" | "broken" | "loose" | "ice";
/** One way of attacking material, in the vocabulary processes and materials share. */
export type ModeId = "abrasion" | "plucking" | "shear" | "solution";
export interface RockFacts {
  /** What it resists being cut with, on the field's scale. */
  readonly resistance: number;
  /** How far joints and fractures open it. */
  readonly jointing: number;
  /** How far it lies in flat layers. */
  readonly bedding: number;
  /** How far water dissolves it. */
  readonly solubility: number;
  /** How far water moves through it. */
  readonly porosity: number;
}
export interface RockKind extends RockFacts {
  readonly id: RockKindId;
  /** What the field's rock bands store. Fixed, whatever the order of this file. */
  readonly code: number;
  readonly name: string;
  /** How it came to be what it is. */
  readonly family: RockFamily;
  /** What burial and heat turn it into, if anything. */
  readonly underHeat?: RockKindId;
  /** Where it gives up to an attack what its facts would not say, against ordinary rock's 1. */
  readonly gives?: Readonly<Partial<Record<ModeId, number>>>;
}
export const rockKindIds = [
  "strata",
  "shale",
  "sandstone",
  "limestone",
  "saltbed",
  "slate",
  "schist",
  "marble",
  "quartzite",
  "gneiss",
  "granite",
  "basalt",
  "tuff",
  "impactite",
  "veinrock",
  "sinter",
  "corefall",
  "rimerot",
  "auroraCrystal",
  "crushstone",
  "rootstone",
  "tufa",
  "saltGlass",
  "keptStone",
  "tornstone",
  "alluvium",
  "soil",
  "glacierIce",
] as const;
export type RockKindId = (typeof rockKindIds)[number];

type Entry = RockFacts & Pick<RockKind, "code" | "name" | "family" | "underHeat" | "gives">;
const entries: Readonly<Record<RockKindId, Entry>> = {
  // What a map records when it knows no better: mixed sediments no process has told apart.
  strata: {
    code: 0,
    name: "Bedded strata",
    family: "sedimentary",
    resistance: 1000,
    jointing: 0.3,
    bedding: 0.8,
    solubility: 0.3,
    porosity: 0.5,
    underHeat: "schist",
  },
  // What settles in deep or quiet water.
  shale: {
    code: 1,
    name: "Shale",
    family: "sedimentary",
    resistance: 600,
    jointing: 0.3,
    bedding: 0.9,
    solubility: 0.05,
    porosity: 0.2,
    underHeat: "slate",
  },
  // What rivers and shores lay down on land.
  sandstone: {
    code: 2,
    name: "Sandstone",
    family: "sedimentary",
    resistance: 1100,
    jointing: 0.4,
    bedding: 0.8,
    solubility: 0.05,
    porosity: 0.6,
    underHeat: "quartzite",
  },
  // What warm shallow seas build.
  limestone: {
    code: 3,
    name: "Limestone",
    family: "sedimentary",
    resistance: 1200,
    jointing: 0.5,
    bedding: 0.85,
    solubility: 0.9,
    porosity: 0.5,
    underHeat: "marble",
  },
  // What dry closed basins leave as their water goes.
  saltbed: {
    code: 4,
    name: "Salt bed",
    family: "sedimentary",
    resistance: 350,
    jointing: 0.1,
    bedding: 0.9,
    solubility: 1,
    porosity: 0.1,
  },
  // Shale under a range's first burial.
  slate: {
    code: 5,
    name: "Slate",
    family: "metamorphic",
    resistance: 1300,
    jointing: 0.45,
    bedding: 0.3,
    solubility: 0,
    porosity: 0.1,
    underHeat: "schist",
  },
  // A range's flanks: rock squeezed and foliated.
  schist: {
    code: 6,
    name: "Schist",
    family: "metamorphic",
    resistance: 1500,
    jointing: 0.5,
    bedding: 0.2,
    solubility: 0.05,
    porosity: 0.15,
    underHeat: "gneiss",
  },
  // Limestone a range has baked.
  marble: {
    code: 7,
    name: "Marble",
    family: "metamorphic",
    resistance: 1600,
    jointing: 0.35,
    bedding: 0.1,
    solubility: 0.6,
    porosity: 0.1,
  },
  // Sandstone a range has welded, and rock made to stand.
  quartzite: {
    code: 8,
    name: "Quartzite",
    family: "metamorphic",
    resistance: 3500,
    jointing: 0.35,
    bedding: 0.3,
    solubility: 0,
    porosity: 0.05,
  },
  // A range's core and old sutures: massive, deep-formed rock.
  gneiss: {
    code: 9,
    name: "Gneiss",
    family: "metamorphic",
    resistance: 2200,
    jointing: 0.2,
    bedding: 0.05,
    solubility: 0,
    porosity: 0.1,
  },
  // Melt that cooled below ground, uncovered only when what lay above it wears away.
  granite: {
    code: 10,
    name: "Granite",
    family: "igneous",
    resistance: 2400,
    jointing: 0.3,
    bedding: 0,
    solubility: 0,
    porosity: 0.05,
  },
  // What volcanoes build: flows that crack into columns.
  basalt: {
    code: 11,
    name: "Basalt",
    family: "igneous",
    resistance: 2600,
    jointing: 0.6,
    bedding: 0.4,
    solubility: 0,
    porosity: 0.35,
  },
  // Volcanic ash, welded or not.
  tuff: {
    code: 12,
    name: "Tuff",
    family: "igneous",
    resistance: 800,
    jointing: 0.5,
    bedding: 0.7,
    solubility: 0.05,
    porosity: 0.6,
    underHeat: "schist",
  },
  // Ground an impact melted and welded.
  impactite: {
    code: 13,
    name: "Impactite",
    family: "igneous",
    resistance: 2000,
    jointing: 0.7,
    bedding: 0,
    solubility: 0,
    porosity: 0.2,
  },
  // Fire: the rock a vein hardens as it runs through it.
  veinrock: {
    code: 14,
    name: "Veinrock",
    family: "metamorphic",
    resistance: 3200,
    jointing: 0.25,
    bedding: 0,
    solubility: 0,
    porosity: 0.05,
  },
  // Fire: what seals a conduit that has carried its budget.
  sinter: {
    code: 15,
    name: "Sinter",
    family: "sedimentary",
    resistance: 2800,
    jointing: 0.15,
    bedding: 0.5,
    solubility: 0,
    porosity: 0,
  },
  // Fire: the fan of debris a fallen core throws out.
  corefall: {
    code: 16,
    name: "Corefall",
    family: "broken",
    resistance: 700,
    jointing: 0.6,
    bedding: 0.1,
    solubility: 0,
    porosity: 0.7,
  },
  // Aurora: exposed rock it has weakened over long ages.
  rimerot: {
    code: 17,
    name: "Rimerot",
    family: "broken",
    resistance: 300,
    jointing: 0.9,
    bedding: 0,
    solubility: 0.2,
    porosity: 0.7,
  },
  // Aurora: charge grown into stone.
  auroraCrystal: {
    code: 18,
    name: "Aurora crystal",
    family: "igneous",
    resistance: 3800,
    jointing: 0.1,
    bedding: 0,
    solubility: 0,
    porosity: 0,
  },
  // Pressure: rock its rays have crushed along shore and seabed.
  crushstone: {
    code: 19,
    name: "Crushstone",
    family: "broken",
    resistance: 450,
    jointing: 0.95,
    bedding: 0,
    solubility: 0.05,
    porosity: 0.6,
  },
  // Greenwood: rock roots have opened and bound.
  rootstone: {
    code: 20,
    name: "Rootstone",
    family: "broken",
    resistance: 800,
    jointing: 0.7,
    bedding: 0.1,
    solubility: 0.3,
    porosity: 0.8,
  },
  // Greenwood: what its springs leave as they come up.
  tufa: {
    code: 21,
    name: "Spring tufa",
    family: "sedimentary",
    resistance: 700,
    jointing: 0.4,
    bedding: 0.6,
    solubility: 0.7,
    porosity: 0.8,
  },
  // Salt: bed burnt to glass at a basin's heart.
  saltGlass: {
    code: 22,
    name: "Salt glass",
    family: "igneous",
    resistance: 3000,
    jointing: 0.4,
    bedding: 0.1,
    solubility: 0.1,
    porosity: 0,
  },
  // Hallowed: ground a ward has held unchanged. It refuses wear its strength alone would give up.
  keptStone: {
    code: 23,
    name: "Kept stone",
    family: "metamorphic",
    resistance: 3000,
    jointing: 0.1,
    bedding: 0.1,
    solubility: 0,
    porosity: 0.05,
    gives: { abrasion: 0.1, plucking: 0.1, shear: 0.1, solution: 0 },
  },
  // Veil: ground a tear has shuffled.
  tornstone: {
    code: 24,
    name: "Tornstone",
    family: "broken",
    resistance: 900,
    jointing: 0.9,
    bedding: 0,
    solubility: 0.1,
    porosity: 0.5,
  },
  // What rivers, ice and slopes leave lying loose: the sediment on a cell, over its rock.
  alluvium: {
    code: 25,
    name: "Alluvium",
    family: "loose",
    resistance: 300,
    jointing: 0.3,
    bedding: 0.3,
    solubility: 0,
    porosity: 0.5,
  },
  // The living skin of the ground that climate and plants make of whatever lies on top: fine, open,
  // and held together only by what grows in it.
  soil: {
    code: 26,
    name: "Soil",
    family: "loose",
    resistance: 250,
    jointing: 0.2,
    bedding: 0,
    solubility: 0.1,
    porosity: 0.6,
  },
  // Ice lying on the ground. It moves as ice and melts as ice; what acts on the ground passes beneath.
  glacierIce: {
    code: 27,
    name: "Glacier ice",
    family: "ice",
    resistance: 250,
    jointing: 0.5,
    bedding: 0.5,
    solubility: 0,
    porosity: 0,
    gives: { abrasion: 0, plucking: 0, shear: 0, solution: 0 },
  },
};
export const rockCatalogue = Object.fromEntries(
  rockKindIds.map((id): [RockKindId, RockKind] => [id, { id, ...entries[id] }])
) as Readonly<Record<RockKindId, RockKind>>;
const byCode: RockKind[] = [];
for (const id of rockKindIds) byCode[rockCatalogue[id].code] = rockCatalogue[id];
/** How many codes a table over the kinds needs. */
export const rockCodeCount = byCode.length;
/** The kind a band's code stands for; ordinary strata where a map records none. */
export const rockKindOfCode = (code: number): RockKind => byCode[code] ?? rockCatalogue.strata;

/** The resistance ordinary rock has, which relative resistance is read against. */
export const baselineRock = rockCatalogue.strata.resistance;
/** The limits of the field's resistance. */
export const softestRock = 250,
  hardestRock = 4000;
/** Where the scale of how hard rock feels starts and tops out. */
const softFeel = 600,
  hardFeel = 2600;
/** How hard a resistance is, in [0, 1], for anything judging rock's character. */
export const hardnessOf = (resistance: number) =>
  Math.max(0, Math.min(1, (resistance - softFeel) / (hardFeel - softFeel)));
/** The porosity from which water comes up through rock. */
export const permeableFrom = 0.3;
