import type { Position } from "./model";
import type { Geometry } from "geojson";

/** A joint demographic combination. Membership lists may overlap; people never do. */
export interface PopulationGroup {
  people: string;
  culture: string | null;
  languages: string[];
  religions: string[];
  practices: string[];
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
}
export interface SocietyConnection {
  from: string;
  to: string;
  distance: number;
  travelCost: number;
  kind: "land" | "river" | "sea";
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
  | "pressure-diving";
export interface SocietyWork {
  id: string;
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
export function populationKey(group: Omit<PopulationGroup, "count">) {
  return JSON.stringify([
    group.people,
    group.culture,
    [...group.languages].sort(),
    [...group.religions].sort(),
    [...group.practices].sort(),
  ]);
}
export function mergePopulation(groups: PopulationGroup[]): PopulationGroup[] {
  const combined = new Map<string, PopulationGroup>();
  for (const group of groups) {
    if (group.count <= 0) continue;
    const key = populationKey(group),
      previous = combined.get(key);
    if (previous) previous.count += group.count;
    else combined.set(key, { ...group, count: group.count });
  }
  return [...combined.values()];
}
