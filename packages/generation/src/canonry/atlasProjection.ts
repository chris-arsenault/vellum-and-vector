import { gridPosition, putChannel } from "@atlas/domain";
import type { GenerationState } from "../process";
import { atlasChannels, type ChannelBinding } from "./atlasChannels";
import { nativeIndexAtSurface } from "./atlasWorkspace";
import { projectPhysicalMaterial } from "./physicalMaterial";
import type { AtlasPhysicalWorkspace } from "./atlasWorkspace";

const forcingChannels = new Set([
  "elevation",
  "bedrock",
  "sediment",
  "fracture",
  "rock",
  "water",
  "temperature",
]);
const weatherChannels = new Set([
  "temperature",
  "moisture",
  "rainfall",
  "snowfall",
  "runoff",
  "ice",
]);
function preserveChannel(state: GenerationState, name: string, preserveTerrain: boolean): boolean {
  return preserveTerrain && Boolean(state.surface.channels[name]) && !weatherChannels.has(name);
}
function projectChannel(state: GenerationState, binding: ChannelBinding) {
  const work = state.physical!,
    map = work.map,
    grid = state.surface;
  const values = new Float64Array(work.samples.length),
    datum = binding.datum ? map.BaseSeaLevel : 0;
  const scale = binding.scale,
    offset = binding.offset ?? 0;
  for (let i = 0; i < values.length; i++) {
    const value = map[binding.native][work.samples[i]];
    values[i] =
      binding.unit === "cell-index"
        ? value < 0
          ? -1
          : map.mesh.cellToLeaf[value]
        : (value - datum) * scale + offset;
  }
  putChannel(grid, binding.name, binding.unit, values);
}
function projectChannels(state: GenerationState, forcingOnly = false, preserveTerrain = false) {
  for (const binding of atlasChannels) {
    if (forcingOnly && !forcingChannels.has(binding.name)) continue;
    if (preserveChannel(state, binding.name, preserveTerrain)) continue;
    projectChannel(state, binding);
  }
}
export function projectNative(
  state: GenerationState,
  forcingOnly = false,
  preserveTerrain = false
) {
  const work = state.physical!,
    map = work.map,
    grid = state.surface;
  projectChannels(state, forcingOnly, preserveTerrain);
  if (forcingOnly) {
    putChannel(grid, "naturalTemperature", "celsius", grid.channels.temperature.slice());
    putChannel(grid, "naturalRock", "ratio", grid.channels.rock.slice());
    return;
  }
  projectWaterLevels(state, work);
  putChannel(
    grid,
    "seaDatum",
    "metre",
    new Float64Array(work.samples.length).fill(map.BaseSeaLevel / 1024)
  );
  putChannel(
    grid,
    "flow",
    "cubic-metre/second",
    Float64Array.from(work.samples, (i) => map.FlowAccumulation[i])
  );
  putChannel(
    grid,
    "drainageElevation",
    "metre",
    Float64Array.from(work.samples, (i) => (map.DrainageElevations[i] - map.BaseSeaLevel) / 1024)
  );
  putChannel(
    grid,
    "precipitation",
    "metre/year",
    Float64Array.from(work.samples, (i) => (map.Rainfall[i] + map.Snowfall[i]) / 1000)
  );
  putChannel(
    grid,
    "erosion",
    "metre",
    Float64Array.from(
      work.samples,
      (i) =>
        (map.CumulativeFluvialErosion[i] +
          map.CumulativeGlacialErosion[i] +
          map.CumulativeCoastalErosion[i]) /
        1024
    )
  );
  // Keep substrate useful to cave generation without inventing a second geology.
  projectPhysicalMaterial(state);
  putChannel(
    grid,
    "carbonate",
    "ratio",
    Float64Array.from(
      work.samples,
      (i) =>
        (map.CrustContinentalFraction[i] / 1000) *
        (1 - Math.min(1, map.VolcanicConstructionHistory[i] / (1024 * 100)))
    )
  );
}
function projectWaterLevels(state: GenerationState, work: AtlasPhysicalWorkspace) {
  const map = work.map;
  putChannel(
    state.surface,
    "waterLevel",
    "metre",
    Float64Array.from(
      work.samples,
      (i) =>
        ((map.WaterKindCodes[i] ? map.WaterSurfaceElevations[i] : map.EffectiveSeaLevel) -
          map.BaseSeaLevel) /
        1024
    ),
    "category"
  );
  putChannel(
    state.surface,
    "seaLevel",
    "metre",
    new Float64Array(work.samples.length).fill((map.EffectiveSeaLevel - map.BaseSeaLevel) / 1024)
  );
}
export function nativeAtSurfacePosition(state: GenerationState, i: number): number {
  const p = gridPosition(state.surface, i);
  return nativeIndexAtSurface(state, p.x, p.y);
}
