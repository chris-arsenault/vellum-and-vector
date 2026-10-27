import { areaSpace } from "./composition";
import { describeFeature, type FeatureType } from "./featureCatalogue";
import { readAtlasFeatures } from "./featureReads";
import { spatial } from "./spatial";
import { societyWorkNatures } from "./society";
import type { AtlasFeature, World } from "./model";
import type { Bounds } from "./spatial";
import type { Geometry } from "geojson";

export type Cell = string | number | boolean | null;
export interface RegistryRow {
  feature: AtlasFeature;
  type: FeatureType;
  values: Record<string, Cell>;
}
export interface RegistryColumn {
  key: string;
  label: string;
  numeric: boolean;
}
export interface AttributeFilter {
  key: string;
  text: string;
  min: string;
  max: string;
}
export interface RegistryQuery {
  search: string;
  type: string;
  status: string;
  state: string;
  profile: string;
  space: string;
  named: boolean;
  protectedOnly: boolean;
  attributes: AttributeFilter[];
}
export interface RegistryRequest {
  worldId: string;
  areaId?: string;
  extent?: Bounds;
  query: RegistryQuery;
  sort: { key: string; descending: boolean };
  page: number;
  limit: number;
}
export interface RegistryFacets {
  types: FeatureType[];
  categories: Record<"status" | "state" | "profile" | "space", string[]>;
}
export interface RegistryPage {
  rows: RegistryRow[];
  total: number;
  matching: number;
  page: number;
  columns: RegistryColumn[];
  facets: RegistryFacets;
}
const labels: Record<string, string> = {
  population: "Settlement residents",
  communityPopulation: "Community population",
  ruralPopulation: "Rural residents",
  settlementRole: "Settlement role",
  polity: "Polity",
  lengthKm: "Length (km)",
  areaKm2: "Footprint area (km²)",
  elevation: "Elevation (m)",
  prominence: "Prominence (m)",
  prominenceTarget: "Target prominence (m)",
  summit: "Summit elevation (m)",
  summitTarget: "Target summit (m)",
  depth: "Depth (m)",
  depthTarget: "Target depth (m)",
  throw: "Throw (m)",
  throwTarget: "Target throw (m)",
  ringRelief: "Ring relief (m)",
  ringReliefTarget: "Target ring relief (m)",
  floorDepth: "Floor depth (m)",
  floorDepthTarget: "Target floor depth (m)",
  rimHeight: "Rim height (m)",
  rimHeightTarget: "Target rim height (m)",
  drop: "Drop (m)",
  dropTarget: "Target drop (m)",
  maintenance: "Maintenance (m)",
  intensity: "Intensity at the source (/1000)",
  intensityTarget: "Target intensity (/1000)",
  reach: "Source reach (km)",
  sourceStrength: "Source strength (/1000)",
  captureAccumulation: "Captured river flow",
  signature: "Signature",
  landmarkKind: "Landmark kind",
  emplacedAtEpoch: "Forms in epoch",
  discharge: "Source discharge (m³/s)",
  width: "Width (m)",
  radius: "Modeled reach (m)",
  order: "River order",
  founded: "Founded",
  maximumIntensity: "Maximum intensity",
  accumulatedActivity: "Accumulated activity",
  travelCost: "Travel cost",
  from: "From",
  to: "To",
  system: "Magic system",
  rule: "Magic rule",
  condition: "Condition",
  maintained: "Maintained",
  built: "Built",
  magnitude: "Magnitude",
  eventKind: "Event type",
  casualties: "Casualties",
  displaced: "Displaced",
  era: "Era",
};
export const coreColumns: RegistryColumn[] = [
  { key: "name", label: "Name", numeric: false },
  { key: "type", label: "Feature type", numeric: false },
  { key: "map", label: "Mapped context", numeric: false },
  { key: "profile", label: "Profile", numeric: false },
  { key: "status", label: "Status", numeric: false },
  { key: "state", label: "Authorship", numeric: false },
  { key: "space", label: "Located space", numeric: false },
  { key: "floor", label: "Floor", numeric: false },
  { key: "protected", label: "Protected", numeric: false },
  { key: "layer", label: "Logical layer", numeric: false },
];
export function registryRows(world: World, areaId?: string, extent?: Geometry): RegistryRow[] {
  const communities = new Map(
    Object.values(world.societies ?? {}).flatMap((s) =>
      s.communities.map((c) => [c.id, c.name] as const)
    )
  );
  return readAtlasFeatures(world, areaId, extent).map((feature) =>
    registryRow(world, feature, communities)
  );
}
/** Project one presented feature; adapters supply native geometry measurements when available. */
export function registryRow(
  world: World,
  feature: AtlasFeature,
  communities = new Map<string, string>(),
  measurements?: { areaKm2?: number; lengthKm?: number }
): RegistryRow {
  const type = describeFeature(world, feature),
    area = world.areas[feature.areaId];
  const values: Record<string, Cell> = scalarAttributes(feature.attributes);
  if (measurements) Object.assign(values, measurements);
  else addMeasurements(values, feature);
  addSociety(values, feature, world, communities);
  Object.assign(values, {
    name: feature.name,
    type: type.path.slice(1).join(" / "),
    map: area.name,
    profile: area.profile,
    space: areaSpace(world, area.id),
    spaceLabel: world.areas[areaSpace(world, area.id)]?.name ?? "World surface",
    floor: area.frame.floor,
    state: feature.state,
    protected: feature.protected,
    status: feature.attributes.status ?? "",
    layer: world.layers[feature.layerId]?.name ?? feature.layerId,
  });
  return { feature, type, values };
}
function scalarAttributes(attributes: Record<string, unknown>) {
  const result: Record<string, Cell> = {};
  for (const [key, value] of Object.entries(attributes))
    if (["string", "boolean", "number"].includes(typeof value)) result[key] = value as Cell;
  return result;
}
function addMeasurements(values: Record<string, Cell>, f: AtlasFeature) {
  const extent = f.footprint ?? f.geometry;
  if (extent.type.includes("Polygon")) values.areaKm2 = spatial.area(extent) / 1e6;
  if (f.geometry.type.includes("Line")) values.lengthKm = spatial.length(f.geometry) / 1000;
}
function addSociety(
  values: Record<string, Cell>,
  f: AtlasFeature,
  world: World,
  communities: Map<string, string>
) {
  if (f.kind === "settlement") values.population = settlementResidents(f);
  const polityId =
    f.attributes.polityId ??
    f.relations.find((r) =>
      ["sovereign", "claimedBy", "controlledBy", "administeredBy"].includes(r.kind)
    )?.targetId;
  if (typeof polityId === "string") values.polity = world.entities[polityId]?.name ?? polityId;
  for (const [key, attr] of [
    ["from", "fromCommunity"],
    ["to", "toCommunity"],
  ]) {
    const id = f.attributes[attr];
    if (typeof id === "string") values[key] = communities.get(id) ?? id;
  }
  addAffectedPlaces(values, f, communities);
  addAffiliations(values, f, world);
}
function addAffectedPlaces(
  values: Record<string, Cell>,
  f: AtlasFeature,
  communities: Map<string, string>
) {
  if (Array.isArray(f.attributes.communities))
    values.affectedPlaces = f.attributes.communities
      .map((id) => communities.get(String(id)) ?? String(id))
      .join(", ");
}
function settlementResidents(f: AtlasFeature): Cell {
  return (f.attributes.settlementPopulation ?? f.attributes.population ?? null) as Cell;
}
function addAffiliations(values: Record<string, Cell>, f: AtlasFeature, world: World) {
  if (!Array.isArray(f.attributes.groups)) return;
  for (const key of ["culture", "languages", "religions"]) {
    const ids = f.attributes.groups.flatMap((g: Record<string, unknown>) =>
      Array.isArray(g[key])
        ? (g[key] as string[])
        : typeof g[key] === "string"
          ? [g[key] as string]
          : []
    );
    values[key] = [...new Set(ids)].map((id) => world.entities[id]?.name ?? id).join(", ");
  }
}
export function registryColumns(rows: RegistryRow[], world: World) {
  const keys = new Map<string, boolean>();
  for (const row of rows)
    for (const [key, value] of Object.entries(row.values))
      keys.set(key, keys.get(key) === true || typeof value === "number");
  return registryColumnDefinitions(keys, world);
}
export function registryColumnDefinitions(keys: Map<string, boolean>, world: World) {
  const hidden =
    /^(naming|namedIn|nameStatus|sourceAlgorithm|spaceLabel|.*Id$|representative|center)/;
  const core = new Set(coreColumns.map((c) => c.key).concat("space", "protected", "layer"));
  const custom = Object.assign({}, ...Object.values(world.layers).map((l) => l.schema));
  const extras = [...keys.keys()]
    .filter((key) => !core.has(key) && !hidden.test(key))
    .sort()
    .map((key) => ({
      key,
      label: labels[key] ?? key.replace(/([a-z])([A-Z])/g, "$1 $2"),
      numeric: keys.get(key) === true || custom[key]?.type === "number",
    }));
  return [...coreColumns, ...extras];
}
export function matchesRegistry(row: RegistryRow, query: RegistryQuery) {
  const v = row.values;
  if (query.named && row.feature.attributes.nameStatus === "label") return false;
  if (query.type && row.type.id !== query.type) return false;
  if (query.protectedOnly && !row.feature.protected) return false;
  if (
    query.search &&
    ![row.feature.name, row.type.path.join(" ")]
      .join(" ")
      .toLowerCase()
      .includes(query.search.toLowerCase())
  )
    return false;
  return (
    matchesCategories(v, query) &&
    query.attributes.every((filter) => matchesAttribute(v[filter.key], filter))
  );
}
function matchesCategories(v: Record<string, Cell>, query: RegistryQuery) {
  return ["status", "state", "profile", "space"].every(
    (key) => !query[key as keyof RegistryQuery] || v[key] === query[key as keyof RegistryQuery]
  );
}
function matchesAttribute(value: Cell | undefined, filter: AttributeFilter) {
  if (value === undefined || value === null) return false;
  if (filter.text && !String(value).toLowerCase().includes(filter.text.toLowerCase())) return false;
  return matchesRange(value, filter);
}
function matchesRange(value: Cell, filter: AttributeFilter) {
  if (filter.min !== "" && (typeof value !== "number" || value < Number(filter.min))) return false;
  return filter.max === "" || (typeof value === "number" && value <= Number(filter.max));
}
export function sortRegistry(rows: RegistryRow[], key: string, descending: boolean) {
  return [...rows].sort((a, b) => {
    const x = a.values[key],
      y = b.values[key];
    if (missing(x)) return missing(y) ? a.feature.id.localeCompare(b.feature.id) : 1;
    if (missing(y)) return -1;
    const delta =
      typeof x === "number" && typeof y === "number"
        ? x - y
        : String(x).localeCompare(String(y), undefined, { numeric: true });
    return (descending ? -delta : delta) || a.feature.id.localeCompare(b.feature.id);
  });
}
function missing(value: Cell | undefined) {
  return value == null || value === "";
}
export function registryCell(row: RegistryRow, column: RegistryColumn) {
  if (column.key === "space") return String(row.values.spaceLabel);
  const value = row.values[column.key];
  if (value == null || value === "") return "Unknown";
  const display =
    typeof value === "number"
      ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
      : String(value);
  const kind = row.feature.attributes.workKind as keyof typeof societyWorkNatures;
  return column.key === "magnitude" && societyWorkNatures[kind]
    ? `${display} ${societyWorkNatures[kind].unit}`
    : display;
}
