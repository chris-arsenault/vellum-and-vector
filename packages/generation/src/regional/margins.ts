import { distance, isContent, neighborsOf, regionalSpan } from "./lattice";
import { clamp, type RegionalState } from "./state";

/** Floodplain half-width per square root of mean discharge, in metres. */
const floodWidth = 80;
/** Only low-gradient channel margins retain floodwater. */
const floodplainGradient = 0.012;

/** Resolve local channel margins rather than painting an inherited coarse floodplain everywhere. */
export function channelMargins(state: RegionalState) {
  const map = state.physical.map,
    mesh = map.mesh,
    span = regionalSpan(state),
    floodplain = new Float64Array(mesh.count),
    delta = new Float64Array(mesh.count),
    around = new Int32Array(mesh.stride),
    land = (i: number) => isContent(mesh, i) && map.WaterKindCodes.get(i) === 0;
  const margin = (i: number) => {
    const width = Math.sqrt(map.FlowAccumulation.get(i)) * floodWidth,
      m = neighborsOf(mesh, i, around),
      ring = [i, ...around.subarray(0, m)],
      coast = ring.some((j) => map.WaterKindCodes.get(j) === 1);
    for (const j of ring) {
      if (!land(j)) continue;
      const flat = clamp(1 - map.Slope.get(j) / floodplainGradient),
        covered = clamp((width - distance(mesh, i, j)) / span) * flat;
      floodplain[j] = Math.max(floodplain[j], covered);
      if (coast) delta[j] = Math.max(delta[j], covered);
    }
  };
  for (let i = 0; i < mesh.count; i++) if (map.RiverOrders.get(i) > 0 && land(i)) margin(i);
  for (let i = 0; i < mesh.count; i++) {
    if (!isContent(mesh, i)) continue;
    map.FloodplainIntensity.set(i, Math.round(floodplain[i] * 1000));
    map.DeltaIntensity.set(i, Math.round(delta[i] * 1000));
  }
}
