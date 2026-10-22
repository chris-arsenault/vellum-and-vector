import { fieldInterpolator, provinceEntries, spatial, type GridSurface } from "@atlas/domain";
import type { Geometry } from "geojson";
import type { PhysicalField } from "./field";
import { prepareProvinceRegions } from "./provinceGeography";
import { clamp, round } from "./math";

export type MotionChannel = "crustMotionX" | "crustMotionY";
export interface MotionInput {
  channel: MotionChannel;
  source: GridSurface;
  footprint: Geometry;
}
export type MotionValue = number | { grid: GridSurface; channel: MotionChannel };
export interface MotionRegion {
  footprint: Geometry;
  x: MotionValue;
  y: MotionValue;
}
export function readMotion(value: MotionValue) {
  if (typeof value === "number") return () => value;
  const read = fieldInterpolator(value.grid, value.channel);
  return (x: number, y: number) => read({ x, y, z: 0 });
}
function replaceComponent(
  regions: MotionRegion[],
  footprint: Geometry,
  axis: "x" | "y",
  value: MotionValue
) {
  return regions.flatMap((region) => {
    if (region[axis] === value || !spatial.intersects(region.footprint, footprint)) return [region];
    const inside = spatial.intersection(region.footprint, footprint),
      outside = spatial.difference(region.footprint, footprint),
      result: MotionRegion[] = [];
    if (outside) result.push({ ...region, footprint: outside });
    if (inside && spatial.area(inside) > 0)
      result.push({ ...region, footprint: inside, [axis]: value });
    return result;
  });
}
function applyInput(regions: MotionRegion[], input: MotionInput): MotionRegion[] {
  const { source, channel } = input,
    footprint = spatial.intersection(input.footprint, source.scope.footprint);
  if (!footprint) return regions;
  const axis = channel === "crustMotionX" ? "x" : "y",
    entries = provinceEntries(source.geography?.provinces, channel);
  if (entries) {
    for (const entry of entries) {
      const part = spatial.intersection(footprint, entry.footprint);
      if (part) regions = replaceComponent(regions, part, axis, entry.value);
    }
  } else {
    regions = replaceComponent(regions, footprint, axis, baseMotion(source, channel));
  }
  for (const overlay of source.overlays ?? [])
    if (overlay.channels.includes(channel))
      regions = applyInput(regions, { channel, source: overlay.grid, footprint });
  return regions;
}

function baseMotion(source: GridSurface, channel: MotionChannel): MotionValue {
  const base = { ...source };
  delete base.overlays;
  const values = source.channels[channel],
    first = values[0],
    transform = source.prepared?.transforms[channel] ?? { scale: 1, offset: 0 };
  return values.every((v) => v === first)
    ? first * transform.scale + transform.offset
    : { grid: base, channel };
}

/** Compose actual geographic ownership before material integration. Native sample
 * masks cannot represent a supported patch lying between their sample centers. */
export function motionRegions(map: PhysicalField): MotionRegion[] {
  let regions: MotionRegion[] = prepareProvinceRegions(map).map((region) => {
    const site = map.provinces!.sites[region.province];
    return {
      footprint: region.footprint,
      x: round(clamp(site.motionX, -1, 1) * 1000) / 1000,
      y: round(clamp(site.motionY, -1, 1) * 1000) / 1000,
    };
  });
  for (const input of [...(map.inheritedMotion ?? []), ...(map.authoredMotion ?? [])])
    regions = applyInput(regions, input);
  return regions;
}
