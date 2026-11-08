// External forcing read from the authored surface onto the physical coverage each epoch.
import type { GenerationState } from "../process";
import { sampleSurfaceAtNative } from "./atlasWorkspace";
import { clamp, round } from "./math";

/** Heat and coastal pressure are current forcing; inherited rock is material, not a reset. */
export function contributeForcing(state: GenerationState) {
  const map = state.physical!.map,
    magic = state.physical!.magic;
  for (let i = 0; i < map.mesh.count; i++) {
    map.ExternalHeatForcing.set(
      i,
      (state.surface.channels.heat ? round(sampleSurfaceAtNative(state, "heat", i) * 10) : 0) +
        (magic?.heat.get(i) ?? 0)
    );
    const pressure = sampleCoastalPressure(state, i);
    map.ExternalCoastalForcing.set(
      i,
      map.WaterKindCodes.get(i) === 0 ? round(clamp(pressure, 0, 1000)) : 0
    );
  }
}
function sampleCoastalPressure(state: GenerationState, i: number) {
  if (!state.surface.channels.coastalPressure) return 0;
  const map = state.physical!.map;
  let pressure = 0;
  for (let edge = 0; edge < map.mesh.degree(i); edge++) {
    const j = map.mesh.neighbor(i, edge);
    if (j >= 0 && map.WaterKindCodes.get(j) === 1)
      pressure = Math.max(pressure, sampleSurfaceAtNative(state, "coastalPressure", j));
  }
  return pressure;
}
