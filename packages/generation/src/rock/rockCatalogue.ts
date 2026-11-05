/**
 * The one catalogue of rock. A cell's rock kind says what the ground is made of, and everything that
 * asks how rock behaves reads these properties, so no process or place keeps its own idea of what
 * hard means. Resistance is on the scale of the field's `RockResistance` band; the other properties
 * are in [0, 1].
 */
export interface RockKind {
  readonly id: RockKindId;
  /** What the field's rock kind band stores. */
  readonly code: number;
  readonly name: string;
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
export const rockKindIds = [
  "strata",
  "schist",
  "gneiss",
  "basalt",
  "quartzite",
  "impactite",
  "fusedSalt",
] as const;
export type RockKindId = (typeof rockKindIds)[number];

const kind = (
  id: RockKindId,
  name: string,
  resistance: number,
  properties: Pick<RockKind, "jointing" | "bedding" | "solubility" | "porosity">
): RockKind => ({ id, code: rockKindIds.indexOf(id), name, resistance, ...properties });

export const rockCatalogue: Readonly<Record<RockKindId, RockKind>> = {
  // The ordinary crust: layered sediments no process has reworked.
  strata: kind("strata", "Bedded strata", 1000, {
    jointing: 0.3,
    bedding: 0.8,
    solubility: 0.3,
    porosity: 0.5,
  }),
  // A range's flanks: strata squeezed and foliated.
  schist: kind("schist", "Schist", 1500, {
    jointing: 0.5,
    bedding: 0.2,
    solubility: 0.05,
    porosity: 0.15,
  }),
  // A range's core and old sutures: massive, deep-formed rock.
  gneiss: kind("gneiss", "Gneiss", 2200, {
    jointing: 0.2,
    bedding: 0.05,
    solubility: 0,
    porosity: 0.1,
  }),
  // What volcanoes build: flows that crack into columns.
  basalt: kind("basalt", "Basalt", 2600, {
    jointing: 0.6,
    bedding: 0.4,
    solubility: 0,
    porosity: 0.35,
  }),
  // Rock made to stand: what a resistant landmark or a fall's lip is cut from.
  quartzite: kind("quartzite", "Quartzite", 3500, {
    jointing: 0.35,
    bedding: 0.3,
    solubility: 0,
    porosity: 0.05,
  }),
  // Ground an impact melted and welded.
  impactite: kind("impactite", "Impactite", 2000, {
    jointing: 0.7,
    bedding: 0,
    solubility: 0,
    porosity: 0.2,
  }),
  // Salt that Fire burnt to glass.
  fusedSalt: kind("fusedSalt", "Fused salt", 3000, {
    jointing: 0.4,
    bedding: 0.1,
    solubility: 0.1,
    porosity: 0,
  }),
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
