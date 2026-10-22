import type { Geometry } from "geojson";

/** Producer-owned tectonic predicates and their prepared geographic partition.
 * Coordinates of sites are relative to origin; region geometry uses world metres. */
export interface ProvincePartition {
  origin: [number, number];
  sites: {
    x: number;
    y: number;
    priority: number;
    assembly: number;
    motionX: number;
    motionY: number;
  }[];
  seed: number;
  scale: number;
  strength: number;
  regions?: { province: number; footprint: Geometry }[];
  fields?: Record<string, number[]>;
}
export interface ProvinceField {
  partition: Omit<ProvincePartition, "fields">;
  values: number[];
}
export function provinceEntries(
  fields: Record<string, ProvinceField> | undefined,
  channel: string
) {
  const binding = fields?.[channel];
  if (!binding) return null;
  const { partition, values } = binding;
  if (!partition.regions) throw new Error("Prepare province geography before publication.");
  return partition.regions.map((region) => ({
    value: values[region.province],
    footprint: region.footprint,
  }));
}
