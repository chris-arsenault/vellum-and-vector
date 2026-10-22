import type { Geometry } from "geojson";
import { spatial } from "./spatial";
import { smoothSampleInterpolator, sampleStations, type SampleSupport } from "./smoothSamples";

export interface WaterSamples {
  elevation: Float64Array;
  bodyIds: Float64Array;
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
  const floor = smoothSampleInterpolator(support, source.elevation),
    stations = sampleStations(support);
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
    const nearest = stations(x, y).reduce((a, b) =>
      a.dx * a.dx + a.dy * a.dy <= b.dx * b.dx + b.dy * b.dy ? a : b
    );
    return kind ? source.bodyIds[nearest.i] : 0;
  };
}
