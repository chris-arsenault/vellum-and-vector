import { mergeLanguageShares, withLanguageShares, type LanguageShares } from "./societyLanguages";
import { mergePracticeShares, withPracticeShares, type PracticeShares } from "./societyPractices";

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
export const beforePresentEpoch = "before-present";
/** The epoch an era runs in: null is the present; a name that no longer exists is the present too. */
export function boundEpoch(
  physicalEpoch: string | null | undefined,
  epochs: readonly { id: string }[]
): string | null {
  if (!physicalEpoch) return null;
  if (physicalEpoch === beforePresentEpoch) return epochs.at(-2)?.id ?? null;
  return epochs.some((epoch) => epoch.id === physicalEpoch) ? physicalEpoch : null;
}
/** Site classes in order of reliability; a place takes the best class its ground offers. */
export const settlementSiteKinds = [
  "pass",
  "fire-seat",
  "river-node",
  "harbour",
  "door-house",
  "sanctuary",
  "melt-line",
  "fishery-coast",
  "halo-edge",
  "healing-well",
  "necropolis",
  "plain-node",
  "plain",
] as const;
export type SettlementSiteKind = (typeof settlementSiteKinds)[number];
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
  // Works of people who move with the wild inside a glacial epoch.
  | "tapping"
  | "burning"
  | "quarrying"
  | "weir"
  // Regional refinement's works at the crossings and falls its ways and channels make.
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
export const societyWorkNatures: Record<
  SocietyWorkKind,
  { nature: SocietyWorkNature; unit: string; carries: string }
> = {
  clearance: { nature: "intensive", unit: "fraction", carries: "cleared share of farmable land" },
  burning: { nature: "intensive", unit: "fraction", carries: "burnt share of wooded land" },
  hunting: { nature: "intensive", unit: "fraction", carries: "harvest pressure on herds" },
  conservation: { nature: "intensive", unit: "fraction", carries: "restoration pressure" },
  irrigation: {
    nature: "intensive",
    unit: "cubic-metre/second",
    carries: "flux diverted from the place's channels",
  },
  tapping: { nature: "intensive", unit: "fraction", carries: "conductance rise along veins" },
  quarrying: { nature: "intensive", unit: "fraction", carries: "stored charge removed" },
  dam: { nature: "structural", unit: "cubic-metre/second", carries: "regulated discharge" },
  harbor: { nature: "structural", unit: "people", carries: "maritime traffic served" },
  pass: { nature: "structural", unit: "people", carries: "route traffic across steep ground" },
  weir: { nature: "structural", unit: "metre", carries: "shore worked" },
  ford: { nature: "structural", unit: "people", carries: "crossing traffic at a channel" },
  bridge: { nature: "structural", unit: "people", carries: "crossing traffic over a river" },
  mill: { nature: "structural", unit: "cubic-metre/second", carries: "flow turned at a fall" },
  "fire-forge": { nature: "practice", unit: "celsius", carries: "heat budget at the seat" },
  "aurora-archive": { nature: "practice", unit: "crystal", carries: "crystals and charge" },
  "pressure-diving": { nature: "practice", unit: "charge", carries: "carried charge" },
};
/** Everyone the groups of a described place count. */
export function population(described: { groups: readonly PopulationGroup[] }) {
  return described.groups.reduce((sum, group) => sum + group.count, 0);
}
/** People, culture and faith distinguish groups; languages and practices are shares within one. */
export function populationKey(group: Omit<PopulationGroup, "count">) {
  return JSON.stringify([group.people, group.culture, [...group.religions].sort()]);
}
export function mergePopulation(groups: PopulationGroup[]): PopulationGroup[] {
  const combined = new Map<string, PopulationGroup>();
  for (const group of groups) {
    if (group.count <= 0) continue;
    const key = populationKey(group),
      previous = combined.get(key);
    if (previous) {
      const merged = withPracticeShares(
        withLanguageShares(previous, mergeLanguageShares(previous, group)),
        mergePracticeShares(previous, group)
      );
      merged.count += group.count;
      combined.set(key, merged);
    } else combined.set(key, { ...group, count: group.count });
  }
  return [...combined.values()];
}
