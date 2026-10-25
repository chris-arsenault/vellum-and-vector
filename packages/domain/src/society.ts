import type { Position } from "./model";
import type { Geometry } from "geojson";
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
export interface SocietySupport {
  farming: number;
  grazing: number;
  gathering: number;
  fishing: number;
  water: number;
  capacity: number;
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
/** Site classes in order of reliability; a community takes the best class its country offers. */
export const settlementSiteKinds = [
  "pass",
  "fire-seat",
  "river-node",
  "harbour",
  "melt-line",
  "fishery-coast",
  "halo-edge",
  "healing-well",
  "plain-node",
  "plain",
] as const;
export type SettlementSiteKind = (typeof settlementSiteKinds)[number];
export interface SocietyCommunity {
  id: string;
  name: string;
  position: Position;
  areaKm2: number;
  groups: PopulationGroup[];
  support: SocietySupport;
  founded: string;
  status: "inhabited" | "abandoned" | "ruined";
  protected: boolean;
  causes: string[];
  footprint?: Geometry;
  parentCommunity?: string;
  /** Concentrated residents are part of groups, never an additional population. */
  settlement?: { population: number; peak: number; recoveryYears: number };
  /**
   * The place inside the community's country that the geography offered for its
   * settlement, chosen by site class; a fortress is a seat on a defensible spur above a
   * route node, taken only when there is a reason to hold it.
   */
  site?: { kind: SettlementSiteKind; reason: string; fortress: boolean };
  isolationYears?: number;
  history?: SocietyOccupation[];
  naming?: { language: string | null; culture: string; era: string };
}
export interface SocietyOccupation {
  era: string;
  year: number;
  population: number;
  capacity: number;
  settlementPopulation: number;
  status: SocietyCommunity["status"];
  languageUse?: Record<string, number>;
}
export interface SocietyConnection {
  from: string;
  to: string;
  /** The way's base cost over the terrain it crosses, before any wear. */
  distance: number;
  /** What the way costs to travel now: the base, lowered as use wears it into a road. */
  travelCost: number;
  kind: "land" | "river" | "sea";
  /** Yearly travellers the way remembers; decides whether it publishes as a track or a road. */
  wear?: number;
  /** A grand highway a polity raised along this way: straight, fast, and outliving its builder. */
  highway?: { polity: string; built: string; name: string };
}
export interface SocietyEraRecord {
  id: string;
  years: number;
  before: number;
  births: number;
  deaths: number;
  migrated: number;
  after: number;
  causes: string[];
  cycles?: number;
}
export interface SocietyRegion {
  areaId: string;
  spaceId: string;
  communities: SocietyCommunity[];
  connections: SocietyConnection[];
  history: SocietyEraRecord[];
  works: SocietyWork[];
  events: SocietyEvent[];
  magic: SocietyMagicPractice[];
  politics?: SocietyPolitics;
}
export interface SocietyPolity {
  id: string;
  seat: string;
  support: number;
  status: "active" | "fragmented" | "collapsed";
  claims: string[];
  causes: string[];
}
export interface SocietyPolitics {
  polities: SocietyPolity[];
  sovereignty: Record<string, string>;
  control: Record<string, string>;
  contested: Record<string, string[]>;
  tenure?: Record<string, { polity: string; years: number }>;
  isolation?: Record<string, number>;
  history: { era: string; polity: string; status: string; communities: string[]; cause: string }[];
}
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
  // The cold-age set: works of a mobile round inside a glacial epoch.
  | "tapping"
  | "burning"
  | "quarrying"
  | "weir";
/**
 * How a work kind behaves at a profile whose mesh cannot hold it (ADR 0005). An intensive
 * work is a fraction per cell with meaning, so at World it spreads as field forcing over its
 * medium. A structural work is one thing or none, so at World it is a demand with an amount
 * and a unit and no physical consequence until a finer profile locates it. A practice is a
 * located record that forces one cell at its seat at every profile.
 */
export type SocietyWorkNature = "intensive" | "structural" | "practice";
/** One labelled declaration per work kind: its nature and the unit its demand carries. */
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
    carries: "flux diverted from the unit's channels",
  },
  tapping: { nature: "intensive", unit: "fraction", carries: "conductance rise along veins" },
  quarrying: { nature: "intensive", unit: "fraction", carries: "stored charge removed" },
  dam: { nature: "structural", unit: "cubic-metre/second", carries: "regulated discharge" },
  harbor: { nature: "structural", unit: "people", carries: "maritime traffic served" },
  pass: { nature: "structural", unit: "people", carries: "route traffic across steep ground" },
  weir: { nature: "structural", unit: "metre", carries: "shore worked" },
  "fire-forge": { nature: "practice", unit: "celsius", carries: "heat budget at the seat" },
  "aurora-archive": { nature: "practice", unit: "crystal", carries: "crystals and charge" },
  "pressure-diving": { nature: "practice", unit: "charge", carries: "carried charge" },
};
/**
 * A World unit's demand of its country: what the located work would amount to, in the
 * kind's unit. A child realizes it and records the part it could not site as unmet.
 */
export interface SocietyDemand {
  amount: number;
  unit: string;
  unmet?: number;
}
export interface SocietyWork {
  id: string;
  /** Assigned at construction; absent on unnamed authored input and older session fixtures. */
  name?: string;
  naming?: { language: string | null; culture: string; era: string };
  communityId: string;
  kind: SocietyWorkKind;
  position: Position;
  radius: number;
  magnitude: number;
  condition: number;
  maintained: boolean;
  authored: boolean;
  built: string;
  applied: number;
  /**
   * A World-profile work is a demand its unit makes of its country, not a located
   * earthwork. An intensive demand acts over the unit's cells of the kind's medium; a
   * structural demand has no effect until a finer profile realizes it at a site. Absent
   * for located works.
   */
  demand?: SocietyDemand;
  /**
   * The heirs of the unit that made an inherited demand: the demand's country, searched as
   * one for a site. Absent once realized, when `communityId` is the heir whose land holds it.
   */
  country?: string[];
  /** The area whose generation located this work from an inherited demand. */
  realizedAt?: string;
  previousShape?: { position: Position; radius: number; applied: number };
  causes: string[];
}
export interface SocietyEvent {
  id: string;
  era: string;
  kind: string;
  position: Position;
  radius: number;
  magnitude: number;
  casualties: number;
  displaced: number;
  communities: string[];
  causes: string[];
}
export interface SocietyMagicPractice {
  communityId: string;
  coreDeposit: number;
  coreSupply: number;
  coreUsed: number;
  heatApplied: number;
  crystals: number;
  charge: number;
  readers: number;
  memoryAccess: number;
  pressureCharge: number;
  pressureUsed: number;
  maritimeContact: number;
  divers: number;
  depthLimit: number;
  injuries: number;
  strain: number;
}
export function population(community: Pick<SocietyCommunity, "groups">) {
  return community.groups.reduce((sum, group) => sum + group.count, 0);
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
