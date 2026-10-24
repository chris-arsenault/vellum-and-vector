import {
  population,
  type AtlasFeature,
  type DomainSnapshot,
  type SocietyRegion,
} from "@atlas/domain";
import { settlementHierarchy, type SettlementHierarchy } from "./societyHierarchy";

/** Quantiles at 0, 0.25, 0.5, 0.75, 0.9 and 1 of a measure over the inhabited communities. */
export type Quantiles = [number, number, number, number, number, number];
export interface SettlementRow {
  name: string;
  role: SettlementHierarchy["settlementRole"];
  site: string;
  areaKm2: number;
  capacity: number;
  people: number;
  fill: number;
  urban: number;
  urbanShare: number;
  roads: number;
}
export interface SocietyInventory {
  communities: number;
  inhabited: number;
  capacity: number;
  people: number;
  urban: number;
  /** Urban residents over all people: the world's urbanization. */
  urbanization: number;
  eras: { id: string; years: number; cycles: number; before: number; after: number }[];
  quantiles: Record<"areaKm2" | "capPerKm2" | "fill" | "urban" | "urbanShare", Quantiles>;
  /** Published settlement sizes by hierarchy role, largest first. */
  sizesByRole: Record<SettlementHierarchy["settlementRole"], number[]>;
  largest: SettlementRow[];
  routes: {
    connections: number;
    landConnections: number;
    seaConnections: number;
    published: Record<string, number>;
    majorSettlements: number;
    majorWithoutRoad: number;
    /** Connected components among major settlements over the published roads and lanes. */
    majorComponents: number;
  };
}
const quantiles = (values: number[]): Quantiles => {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => (sorted.length ? sorted[Math.floor(p * (sorted.length - 1))] : 0);
  return [at(0), at(0.25), at(0.5), at(0.75), at(0.9), at(1)];
};
const round = (value: number, digits = 0) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};
function routeKey(f: AtlasFeature) {
  const cls = f.attributes.roadClass;
  return `${f.kind}${typeof cls === "string" ? `:${cls}` : ""}`;
}
function routeEndpoints(routes: AtlasFeature[]) {
  const counts = new Map<string, number>();
  for (const f of routes)
    for (const key of ["fromCommunity", "toCommunity"] as const) {
      const id = String(f.attributes[key] ?? "");
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  return counts;
}
function settlementRows(
  region: SocietyRegion,
  roles: Map<string, SettlementHierarchy>,
  roadsAt: Map<string, number>
): SettlementRow[] {
  return region.communities.map((c) => {
    const people = population(c),
      urban = Math.min(people, c.settlement?.population ?? 0);
    return {
      name: c.name,
      role: roles.get(c.id)!.settlementRole,
      site: c.site?.kind ?? "plain",
      areaKm2: round(c.areaKm2),
      capacity: round(c.support.capacity),
      people: round(people),
      fill: round(people / Math.max(1, c.support.capacity), 2),
      urban: round(urban),
      urbanShare: round(urban / Math.max(1, people), 3),
      roads: roadsAt.get(c.id) ?? 0,
    };
  });
}
function publishedSizes(major: AtlasFeature[], roles: Map<string, SettlementHierarchy>) {
  const sizesByRole: SocietyInventory["sizesByRole"] = {
    capital: [],
    regionalCapital: [],
    marketTown: [],
    settlement: [],
  };
  for (const f of major)
    sizesByRole[roles.get(String(f.attributes.communityId))!.settlementRole].push(
      round(Number(f.attributes.population ?? 0))
    );
  for (const sizes of Object.values(sizesByRole)) sizes.sort((a, b) => b - a);
  return sizesByRole;
}
/** The demographic and route measures the classic-age plan judges a world by. */
export function societyInventory(snapshot: DomainSnapshot, areaId: string): SocietyInventory {
  const region = snapshot.world.societies?.[areaId];
  if (!region) throw new Error(`No society for area ${areaId}.`);
  const roles = settlementHierarchy(region);
  const features = Object.values(snapshot.world.features).filter((f) => f.areaId === areaId);
  const routes = features.filter((f) => f.layerId === "roads");
  const roadsAt = routeEndpoints(routes);
  const rows = settlementRows(region, roles, roadsAt);
  const inhabited = region.communities
    .map((c, i) => ({ c, row: rows[i] }))
    .filter(({ c }) => c.status === "inhabited");
  const people = rows.reduce((sum, r) => sum + r.people, 0),
    urban = rows.reduce((sum, r) => sum + r.urban, 0);
  const major = features.filter((f) => f.kind === "settlement" && f.layerId === "settlements");
  const majorIds = new Set(major.map((f) => String(f.attributes.communityId)));
  return {
    communities: region.communities.length,
    inhabited: inhabited.length,
    capacity: round(rows.reduce((sum, r) => sum + r.capacity, 0)),
    people: round(people),
    urban: round(urban),
    urbanization: round(urban / Math.max(1, people), 3),
    eras: region.history.map((h) => ({
      id: h.id,
      years: h.years,
      cycles: h.cycles ?? 1,
      before: round(h.before),
      after: round(h.after),
    })),
    quantiles: {
      areaKm2: quantiles(inhabited.map(({ row }) => row.areaKm2)),
      capPerKm2: quantiles(
        inhabited.map(({ row }) => round(row.capacity / Math.max(1, row.areaKm2), 1))
      ),
      fill: quantiles(inhabited.map(({ row }) => row.fill)),
      urban: quantiles(inhabited.map(({ row }) => row.urban)),
      urbanShare: quantiles(inhabited.map(({ row }) => row.urbanShare)),
    },
    sizesByRole: publishedSizes(major, roles),
    largest: [...rows].sort((a, b) => b.urban - a.urban).slice(0, 15),
    routes: {
      connections: region.connections.length,
      landConnections: region.connections.filter((l) => l.kind !== "sea").length,
      seaConnections: region.connections.filter((l) => l.kind === "sea").length,
      published: routes.reduce<Record<string, number>>((counts, f) => {
        counts[routeKey(f)] = (counts[routeKey(f)] ?? 0) + 1;
        return counts;
      }, {}),
      majorSettlements: majorIds.size,
      majorWithoutRoad: [...majorIds].filter((id) => !roadsAt.has(id)).length,
      majorComponents: components(majorIds, routes),
    },
  };
}
/** Connected components the major settlements fall into over every published route. */
function components(majorIds: Set<string>, routes: AtlasFeature[]) {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const p = parent.get(id) ?? id;
    if (p === id) return id;
    const root = find(p);
    parent.set(id, root);
    return root;
  };
  for (const f of routes) {
    const a = String(f.attributes.fromCommunity ?? ""),
      b = String(f.attributes.toCommunity ?? "");
    if (a && b) parent.set(find(a), find(b));
  }
  return new Set([...majorIds].map(find)).size;
}
