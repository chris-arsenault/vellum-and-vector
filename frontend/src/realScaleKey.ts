import type { MapDescriptor, MapFeature } from "@atlas/map";

/** One numbered entry of a real-scale map's key, as the map published it. */
export interface MapKeyEntry {
  id: string;
  number: number;
  name: string;
  account: string;
}
/** The vector layers whose places carry key numbers; the hex layer holds none. */
export const keyLayerIds = (map: MapDescriptor) =>
  map.layers
    .map((layer) => layer.id)
    .filter((id) => id.startsWith("vector:") && id !== "vector:hexes");
/** Published places with a key number, in key order; each place appears once. */
export function mapKey(features: MapFeature[]): MapKeyEntry[] {
  const entries = new Map<string, MapKeyEntry>();
  for (const feature of features) {
    const number = feature.attributes.keyNumber;
    if (typeof number !== "number" || entries.has(feature.id)) continue;
    const account = feature.attributes.account;
    entries.set(feature.id, {
      id: feature.id,
      number,
      name: feature.name ?? feature.kind,
      account: typeof account === "string" ? account : "",
    });
  }
  return [...entries.values()].sort((a, b) => a.number - b.number);
}
