/**
 * The one catalogue of rock. A cell's column says what the ground is made of, and everything that
 * asks how rock behaves reads these properties, so no process or place keeps its own idea of what
 * hard means. Resistance is on the scale of the field's `RockResistance` band; the other properties
 * are in [0, 1]. Nothing places a kind on the map: each exists because a process made it there.
 */
/**
 * How a rock came to be, whichever process made it: laid down in layers, cooled from melt, changed
 * where it lay, or shattered and rotted into rubble. Magic's rock belongs by how it behaves.
 */
export type RockFamily = "sedimentary" | "igneous" | "metamorphic" | "broken";
export interface RockKind {
  readonly id: RockKindId;
  /** What the field's rock bands store. */
  readonly code: number;
  readonly name: string;
  /** How it came to be what it is. */
  readonly family: RockFamily;
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
  /** What burial and heat turn it into, if anything. */
  readonly underHeat?: RockKindId;
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
] as const;
export type RockKindId = (typeof rockKindIds)[number];

type Properties = Pick<
  RockKind,
  "resistance" | "jointing" | "bedding" | "solubility" | "porosity" | "underHeat"
>;
const kind = (
  id: RockKindId,
  name: string,
  family: RockFamily,
  properties: Properties
): RockKind => ({
  id,
  code: rockKindIds.indexOf(id),
  name,
  family,
  ...properties,
});
const rock = (
  resistance: number,
  jointing: number,
  bedding: number,
  solubility: number,
  porosity: number,
  underHeat?: RockKindId
): Properties => ({ resistance, jointing, bedding, solubility, porosity, underHeat });

export const rockCatalogue: Readonly<Record<RockKindId, RockKind>> = {
  // What a map records when it knows no better: mixed sediments no process has told apart.
  strata: kind("strata", "Bedded strata", "sedimentary", rock(1000, 0.3, 0.8, 0.3, 0.5, "schist")),
  // What settles in deep or quiet water.
  shale: kind("shale", "Shale", "sedimentary", rock(600, 0.3, 0.9, 0.05, 0.2, "slate")),
  // What rivers and shores lay down on land.
  sandstone: kind(
    "sandstone",
    "Sandstone",
    "sedimentary",
    rock(1100, 0.4, 0.8, 0.05, 0.6, "quartzite")
  ),
  // What warm shallow seas build.
  limestone: kind(
    "limestone",
    "Limestone",
    "sedimentary",
    rock(1200, 0.5, 0.85, 0.9, 0.5, "marble")
  ),
  // What dry closed basins leave as their water goes.
  saltbed: kind("saltbed", "Salt bed", "sedimentary", rock(350, 0.1, 0.9, 1, 0.1)),
  // Shale under a range's first burial.
  slate: kind("slate", "Slate", "metamorphic", rock(1300, 0.45, 0.3, 0, 0.1, "schist")),
  // A range's flanks: rock squeezed and foliated.
  schist: kind("schist", "Schist", "metamorphic", rock(1500, 0.5, 0.2, 0.05, 0.15, "gneiss")),
  // Limestone a range has baked.
  marble: kind("marble", "Marble", "metamorphic", rock(1600, 0.35, 0.1, 0.6, 0.1)),
  // Sandstone a range has welded, and rock made to stand.
  quartzite: kind("quartzite", "Quartzite", "metamorphic", rock(3500, 0.35, 0.3, 0, 0.05)),
  // A range's core and old sutures: massive, deep-formed rock.
  gneiss: kind("gneiss", "Gneiss", "metamorphic", rock(2200, 0.2, 0.05, 0, 0.1)),
  // Melt that cooled below ground, uncovered only when what lay above it wears away.
  granite: kind("granite", "Granite", "igneous", rock(2400, 0.3, 0, 0, 0.05)),
  // What volcanoes build: flows that crack into columns.
  basalt: kind("basalt", "Basalt", "igneous", rock(2600, 0.6, 0.4, 0, 0.35)),
  // Volcanic ash, welded or not.
  tuff: kind("tuff", "Tuff", "igneous", rock(800, 0.5, 0.7, 0.05, 0.6, "schist")),
  // Ground an impact melted and welded.
  impactite: kind("impactite", "Impactite", "igneous", rock(2000, 0.7, 0, 0, 0.2)),
  // Fire: the rock a vein hardens as it runs through it.
  veinrock: kind("veinrock", "Veinrock", "metamorphic", rock(3200, 0.25, 0, 0, 0.05)),
  // Fire: what seals a conduit that has carried its budget.
  sinter: kind("sinter", "Sinter", "sedimentary", rock(2800, 0.15, 0.5, 0, 0)),
  // Fire: the fan of debris a fallen core throws out.
  corefall: kind("corefall", "Corefall", "broken", rock(700, 0.6, 0.1, 0, 0.7)),
  // Aurora: exposed rock it has weakened over long ages.
  rimerot: kind("rimerot", "Rimerot", "broken", rock(300, 0.9, 0, 0.2, 0.7)),
  // Aurora: charge grown into stone.
  auroraCrystal: kind("auroraCrystal", "Aurora crystal", "igneous", rock(3800, 0.1, 0, 0, 0)),
  // Pressure: rock its rays have crushed along shore and seabed.
  crushstone: kind("crushstone", "Crushstone", "broken", rock(450, 0.95, 0, 0.05, 0.6)),
  // Greenwood: rock roots have opened and bound.
  rootstone: kind("rootstone", "Rootstone", "broken", rock(800, 0.7, 0.1, 0.3, 0.8)),
  // Greenwood: what its springs leave as they come up.
  tufa: kind("tufa", "Spring tufa", "sedimentary", rock(700, 0.4, 0.6, 0.7, 0.8)),
  // Salt: bed burnt to glass at a basin's heart.
  saltGlass: kind("saltGlass", "Salt glass", "igneous", rock(3000, 0.4, 0.1, 0.1, 0)),
  // Hallowed: ground a ward has held unchanged.
  keptStone: kind("keptStone", "Kept stone", "metamorphic", rock(3000, 0.1, 0.1, 0, 0.05)),
  // Veil: ground a tear has shuffled.
  tornstone: kind("tornstone", "Tornstone", "broken", rock(900, 0.9, 0, 0.1, 0.5)),
};
const byCode = rockKindIds.map((id) => rockCatalogue[id]);
/** The kind a band's code stands for; ordinary strata where a map records none. */
export const rockKindOfCode = (code: number): RockKind => byCode[code] ?? rockCatalogue.strata;

/** The resistance ordinary rock has, which relative resistance is read against. */
export const baselineRock = rockCatalogue.strata.resistance;
/** The limits of the field's resistance. */
export const softestRock = 250,
  hardestRock = 4000;
/** Where the scale of how hard rock feels starts and tops out. */
const softFeel = 700,
  hardFeel = 1500;
/** How hard a resistance is, in [0, 1], for anything judging rock's character. */
export const hardnessOf = (resistance: number) =>
  Math.max(0, Math.min(1, (resistance - softFeel) / (hardFeel - softFeel)));
/** The porosity from which water comes up through rock. */
export const permeableFrom = 0.3;
/** What loose sediment resists being cut with, on the same scale as rock. */
export const sedimentResistance = 300;

const within = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const relative = (resistance: number) => resistance / baselineRock;
/** The relative hardness below which rock gives ice no more to cut: it crushes to a bed ice rides on. */
const weakestBed = 0.6;
/** How strongly rock's relative hardness carries into the material water and Fire cut through. */
const materialContrast = 0.9;
/**
 * How rock answers each thing that works on it or reads it, from its properties and its resistance
 * as altered where it lies. This is the one place those answers are decided; a process asks
 * `Ground`, which reads the map and answers from here.
 */
export const rockResponse = {
  /** How much of what ice could move this rock gives up. */
  iceTakes: (moved: number, resistance: number) =>
    moved / Math.max(weakestBed, relative(resistance)),
  /** How far its strength steepens the slope it holds. */
  slopeFirmness: (resistance: number) => within(0.55 + relative(resistance) * 0.45, 0.55, 1.45),
  /** How far open joints lower the slope it holds: broken rock stands gentler than tight rock. */
  slopeJoints: (rock: RockKind) => 1.2 - 0.5 * rock.jointing,
  /** How far its strength holds back what a failing slope sheds. */
  slopeShedding: (resistance: number) => within(relative(resistance), 0.6, 2.5),
  /** How far its stiffness spaces a belt's thrust sheets. */
  sheetStiffness: (resistance: number) => within(relative(resistance), 0.6, 1.6),
  /** How far its strength sharpens the fine relief it carries. */
  reliefDetail: (resistance: number) => within(relative(resistance), 0.6, 1.4),
  /** How far channel banks in it hold a river narrow and deep. */
  channelBank: (resistance: number) => within(relative(resistance), 0.5, 2),
  /** How far it holds back water leaking through it. */
  seepageHold: (resistance: number) => within(relative(resistance), 0.3, 3),
  /** Its share of what water and Fire must cut through. */
  material: (resistance: number) => relative(resistance) ** materialContrast,
};
