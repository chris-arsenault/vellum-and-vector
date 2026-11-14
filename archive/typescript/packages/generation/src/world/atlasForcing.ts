// External forcing read from the authored surface onto the physical coverage each epoch.
import type { GenerationState } from "../process";
import { sampleSurfaceAtNative } from "./atlasWorkspace";
import { round } from "./math";
import { defineCommand } from "../processOperation";

/** Standalone source contribution, in the native temperature units shared with physical forcing. */
export function standaloneHeat(state: GenerationState, cell: number) {
  return state.surface.channels.Heat ? round(sampleSurfaceAtNative(state, "Heat", cell) * 10) : 0;
}

/** Heat is current forcing; coastal pressure resolves its receiving shore when waves ask. */
export const contributeForcing = defineCommand(
  "atlas.external-forcing",
  "event",
  ({ state, includeStandalone = true }: { state: GenerationState; includeStandalone?: boolean }) =>
    replaceForcing(state, includeStandalone),
  []
);
function replaceForcing(state: GenerationState, includeStandalone: boolean) {
  const map = state.physical!.map,
    magic = state.physical!.magic;
  for (let i = 0; i < map.mesh.count; i++) {
    map.ExternalHeatForcing.set(
      i,
      (includeStandalone ? standaloneHeat(state, i) : 0) + (magic?.heat.get(i) ?? 0)
    );
  }
}
export function sampleCoastalPressure(state: GenerationState, i: number) {
  if (!state.surface.channels.CoastalPressure) return 0;
  const map = state.physical!.map;
  let pressure = 0;
  for (let edge = 0; edge < map.mesh.degree(i); edge++) {
    const j = map.mesh.neighbor(i, edge);
    if (j >= 0 && map.WaterKindCodes.get(j) === 1)
      pressure = Math.max(pressure, sampleSurfaceAtNative(state, "CoastalPressure", j));
  }
  return pressure;
}
