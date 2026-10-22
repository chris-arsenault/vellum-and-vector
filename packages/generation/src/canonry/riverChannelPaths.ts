import type { PhysicalField } from "./field";
import { channelCorridor } from "./channelCorridor";
import { relaxRiverJunctions } from "./riverJunctions";

export type ChannelPoint = [number, number];
export type ChannelStation = {
  point: ChannelPoint;
  fraction: number;
  elevation: number;
};
export interface ChannelPaths {
  x: Float64Array;
  y: Float64Array;
  upstream: Int32Array;
  segments: Record<number, ChannelStation[]>;
}

/** Generation owns channel curves and the existing interpolated drainage profile. */
export function prepareRiverPaths(map: PhysicalField) {
  const mesh = map.mesh;
  const result: ChannelPaths = {
    x: Float64Array.from(mesh.x),
    y: Float64Array.from(mesh.y),
    upstream: new Int32Array(mesh.count).fill(-1),
    segments: {},
  };
  relaxRiverJunctions(map, result);
  for (let i = 0; i < mesh.count; i++) {
    const j = map.FlowTargets[i];
    if (j < 0) continue;
    result.segments[i] = channelCorridor(
      map,
      i,
      j,
      [result.x[i], result.y[i]],
      [result.x[j], result.y[j]]
    ).map((station) => ({
      ...station,
      elevation:
        map.DrainageElevations[i] * (1 - station.fraction) +
        map.DrainageElevations[j] * station.fraction,
    }));
  }
  map.riverPaths = result;
  return result;
}
