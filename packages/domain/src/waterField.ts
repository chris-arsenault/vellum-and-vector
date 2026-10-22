import type { Geometry } from "geojson";
import { spatial } from "./spatial";
import { type SampleSupport } from "./smoothSamples";
import { nearestFieldSample } from "./sampledGrid";
import { preparedValue, type NumericValues, type PreparedChannelData } from "./preparedField";

export interface WaterSamples extends PreparedChannelData {
  elevation: NumericValues;
  bodyIds: NumericValues;
  seaLevel: number;
  lakes: { id: number; footprint: Geometry; level: number }[];
}
/** Body identities remain discrete; floors and physical stages determine depth. */
export function waterFieldInterpolator(
  support: SampleSupport,
  source: WaterSamples,
  ocean: Geometry | null | undefined,
  channel: string
) {
  const floor =
    channel === "waterDepth" ? preparedValue(support, source.elevation, source) : () => 0;
  const sea = ocean ? spatial.pointCoverage(ocean) : () => false;
  const lakes = source.lakes.map((body) => ({
    ...body,
    covers: spatial.pointCoverage(body.footprint),
  }));
  return (x: number, y: number) => {
    const point = { x, y, z: 0 },
      lake = lakes.find((body) => body.covers(point));
    const kind = lake ? 2 : Number(sea(point)),
      level = lake?.level ?? source.seaLevel;
    if (channel === "water") return kind;
    if (channel === "waterLevel") return level;
    if (channel === "waterDepth") return kind ? Math.max(0, level - floor(x, y)) : 0;
    if (lake) return lake.id;
    return kind ? source.bodyIds[nearestFieldSample(support, point)] : 0;
  };
}
