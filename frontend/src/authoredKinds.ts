import type { GeometryType, MapDescriptor } from "@atlas/map";
import { vectorFamily } from "./publishedAppearance";
import type { AuthoredTool } from "./authoredState";
import type { DrawChoice } from "./useRealScaleAuthoring";

export type KindGeometry = "Point" | "LineString" | "Polygon";
/** One placeable kind of the map's catalogue, with the layer that holds it. */
export interface KindEntry {
  key: string;
  layerId: string;
  layerName: string;
  kind: string;
  label: string;
  /** The category the browser files it under: the first step of the catalogue path. */
  group: string;
  /** The rest of the catalogue path, for a small caption. */
  trail: string;
  geometry: KindGeometry;
}
const hexFamilies = new Set(["hexes", "caveHexes"]);

/** The shape a kind is suggested to take; the first geometry the catalogue lists. */
export function kindGeometry(geometries: GeometryType[]): KindGeometry {
  const first = geometries[0];
  if (first === "Point" || first === "MultiPoint") return "Point";
  if (first === "LineString" || first === "MultiLineString") return "LineString";
  return "Polygon";
}
export const kindKey = (layerId: string, kind: string) => `${layerId}#${kind}`;
/** Every kind of every vector layer, read from the map's catalogue and nowhere else. */
export function kindEntries(map: MapDescriptor): KindEntry[] {
  return map.layers.flatMap((layer) =>
    layer.source.kind !== "vector" || hexFamilies.has(vectorFamily(layer.id))
      ? []
      : layer.catalog.featureTypes.map((type) => ({
          key: kindKey(layer.id, type.kind),
          layerId: layer.id,
          layerName: layer.name,
          kind: type.kind,
          label: type.label,
          group: type.path[0] ?? layer.name,
          trail: type.path.slice(1).join(" / "),
          geometry: kindGeometry(type.geometries),
        }))
  );
}
const haystack = (entry: KindEntry) =>
  `${entry.label} ${entry.kind} ${entry.group} ${entry.trail} ${entry.layerName}`.toLowerCase();
/** Entries matching every word of the query; label matches rank before path matches. */
export function searchKinds(entries: KindEntry[], query: string): KindEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return entries;
  const rank = (entry: KindEntry) => {
    const label = entry.label.toLowerCase();
    if (label.startsWith(words[0])) return 0;
    return label.includes(words[0]) ? 1 : 2;
  };
  return entries
    .filter((entry) => words.every((word) => haystack(entry).includes(word)))
    .sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
}
export interface KindGroup {
  name: string;
  entries: KindEntry[];
}
/** Entries filed under their category, categories and entries in alphabetical order. */
export function groupKinds(entries: KindEntry[]): KindGroup[] {
  const groups = new Map<string, KindEntry[]>();
  for (const entry of entries) groups.set(entry.group, [...(groups.get(entry.group) ?? []), entry]);
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, list]) => ({
      name,
      entries: [...list].sort((a, b) => a.label.localeCompare(b.label)),
    }));
}
/** Most recent first, no repeats, at most `limit`. */
export function pushRecent(list: string[], key: string, limit = 8): string[] {
  return [key, ...list.filter((held) => held !== key)].slice(0, limit);
}
export const toggleFavourite = (list: string[], key: string): string[] =>
  list.includes(key) ? list.filter((held) => held !== key) : [...list, key];
/** The entries a list of keys names, in list order; keys the map no longer has drop out. */
export function resolveKeys(keys: string[], entries: KindEntry[]): KindEntry[] {
  const byKey = new Map(entries.map((entry) => [entry.key, entry]));
  return keys.flatMap((key) => byKey.get(key) ?? []);
}
/** Where to find the kind a tool draws by default: the landmass and river kinds. */
export const findKind = (entries: KindEntry[], layerFamily: string, kind: string) =>
  entries.find((entry) => vectorFamily(entry.layerId) === layerFamily && entry.kind === kind);
/** A draw choice for a kind, drawn in the geometry the catalogue suggests. */
export const drawChoiceFor = (entry: KindEntry, name = ""): DrawChoice => ({
  layerId: entry.layerId,
  kind: entry.kind,
  name,
  width: 1,
  geometry: entry.geometry,
});
/** The kind a tool draws: Landmass and River have their own, Place the armed kind; any
 * other tool leaves the draw choice as it was. */
export function drawChoiceForTool(
  tool: AuthoredTool,
  entries: KindEntry[],
  armed: string | null,
  held: DrawChoice | null
): DrawChoice | null {
  const name = held?.name ?? "";
  const fixed = ownKinds[tool];
  if (!fixed && tool !== "place") return held;
  const entry = fixed
    ? (findKind(entries, fixed[0], fixed[1]) ??
      entries.find((candidate) => vectorFamily(candidate.layerId) === fixed[0]))
    : entries.find((candidate) => candidate.key === armed);
  return entry ? drawChoiceFor(entry, name) : null;
}
/** The layer family and kind of the tools that draw one thing: coasts, rivers, parcels. */
const ownKinds: Partial<Record<AuthoredTool, [string, string]>> = {
  landmass: ["landmasses", "landmass"],
  river: ["rivers", "river"],
  plot: ["plots", "plot"],
};
