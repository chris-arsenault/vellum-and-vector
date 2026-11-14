import { type LanguageShares } from "./societyLanguages";
import { type PracticeShares } from "./societyPractices";
/** A demographic group. Language and practice shares are marginals, not enumerated combinations. */
export interface PopulationGroup {
  people: string;
  culture: string | null;
  languages: string[];
  /** Primary language used for names; omitted authoring input defaults to the first known language. */
  namingLanguage?: string | null;
  /** When present, authoritative language proportions; lists above summarize these shares. */
  languageShares?: LanguageShares;
  religions: string[];
  practices: string[];
  /** When present, authoritative practice weights; the list above summarizes these shares. */
  practiceShares?: PracticeShares;
  count: number;
}
/**
 * A human era binds to a physical epoch by id, or structurally to the epoch before the
 * present with this value, so the round follows the schedule whatever the epochs are named.
 */
export declare const beforePresentEpoch = "before-present";
/** The epoch an era runs in: null is the present; a name that no longer exists is the present too. */
export declare function boundEpoch(
  physicalEpoch: string | null | undefined,
  epochs: readonly {
    id: string;
  }[]
): string | null;
export type SocietyWorkKind =
  | "dam"
  | "irrigation"
  | "pass"
  | "harbor"
  | "clearance"
  | "hunting"
  | "conservation"
  | "fire-forge"
  | "aurora-archive"
  | "pressure-diving"
  | "tapping"
  | "burning"
  | "quarrying"
  | "weir"
  | "ford"
  | "bridge"
  | "mill";
/**
 * How a work kind behaves at a profile whose mesh cannot hold it (ADR 0005). An intensive
 * work is a fraction per cell with meaning, so at World it spreads as field forcing over its
 * medium. A structural work is one thing or none, so at World it stands only where the mesh
 * resolves it. A practice is a located record that forces one cell at its seat at every
 * profile.
 */
export type SocietyWorkNature = "intensive" | "structural" | "practice";
/** One labelled declaration per work kind: its nature and the unit its amount carries. */
export declare const societyWorkNatures: Record<
  SocietyWorkKind,
  {
    nature: SocietyWorkNature;
    unit: string;
    carries: string;
  }
>;
/** Everyone the groups of a described place count. */
export declare function population(described: { groups: readonly PopulationGroup[] }): number;
/** People, culture and faith distinguish groups; languages and practices are shares within one. */
export declare function populationKey(group: Omit<PopulationGroup, "count">): string;
export declare function mergePopulation(groups: PopulationGroup[]): PopulationGroup[];
