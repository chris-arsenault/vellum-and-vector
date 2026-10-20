import { fieldInterpolator, gridPosition, putChannel } from "@atlas/domain";
import type { GenerationState } from "../process";
import { atlasChannels, type ChannelBinding } from "./atlasChannels";
import { nativeIndexAtSurface } from "./atlasWorkspace";
import { projectPhysicalMaterial } from "./physicalMaterial";
import type { AtlasPhysicalWorkspace } from "./atlasWorkspace";
import { projectedValues } from "./atlasSampling";
import { ecologyBindings } from "./ecologyState";
import { finalWaterBodies } from "./macroWater";
import { sampleFinishedLandscape, reconcileSampledWater } from "./macroSampling";
import { finishedElevation } from "./macroTerrain";
import { spatial } from "@atlas/domain";
import { authoredFields } from "../mapAuthored";

const forcingChannels = new Set([
  "elevation",
  "bedrock",
  "sediment",
  "fracture",
  "rock",
  "water",
  "temperature",
]);
// Present weather and life can change without re-evolving the terrain.
const weatherAndEcologyChannels = new Set([
  "temperature",
  "moisture",
  "rainfall",
  "snowfall",
  "runoff",
  "ice",
  ...ecologyBindings.map(([name]) => name),
]);
function preserveChannel(state: GenerationState, name: string, preserveTerrain: boolean): boolean {
  return (
    preserveTerrain && Boolean(state.surface.channels[name]) && !weatherAndEcologyChannels.has(name)
  );
}
function projectChannel(state: GenerationState, binding: ChannelBinding) {
  const work = state.physical!,
    map = work.map,
    grid = state.surface;
  const values = projectedValues(
      work,
      map[binding.native],
      binding.unit === "category" || binding.unit === "cell-index"
    ),
    datum = binding.datum ? map.BaseSeaLevel : 0;
  const scale = binding.scale,
    offset = binding.offset ?? 0;
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
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
function projectFinishedSamples(state: GenerationState) {
  const work = state.physical!,
    finishing = work.finishing;
  if (!finishing) return;
  const grid = state.surface;
  grid.ocean = finishing.ocean;
  grid.waterBodies = finalWaterBodies(work);
  if (!finishing.field) {
    const protects = (finishing.exclusions?.elevation ?? []).map((g) => spatial.pointCoverage(g));
    finishing.field = sampleFinishedLandscape(
      finishing.baseSurface!,
      finishing.profiles,
      grid,
      (p) => protects.some((covered) => covered(p))
    );
  }
  const field = finishing.field;
  const authored = authoredFields(state.domain)
    .filter(
      (authority) =>
        authority.source && (!authority.spaceId || authority.spaceId === grid.scope.spaceId)
    )
    .map((authority) => ({
      grid: {
        ...authority.source!,
        scope: {
          ...authority.source!.scope,
          footprint: authority.footprint ?? authority.source!.scope.footprint,
        },
      },
      channels: authority.channels ?? Object.keys(authority.source!.channels),
    }));
  if (authored.length) {
    field.overlays = authored;
    reconcileSampledWater(field, grid);
  }
  grid.overlays = [{ grid: field, channels: Object.keys(field.channels) }];
  // Current human algorithms consume these exact working nodes. Publication
  // omits these coarse channel copies once those consumers finish.
  for (const name of Object.keys(field.channels)) {
    const at = fieldInterpolator(field, name);
    putChannel(
      grid,
      name,
      field.units[name],
      Float64Array.from(grid.active, (_, i) => at(gridPosition(grid, i))),
      field.quantities?.[name]
    );
  }
  if (finishing.rivers) finishing.rivers.elevationAt = finishedElevation(work);
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
  putChannel(grid, "flow", "cubic-metre/second", projectedValues(work, map.FlowAccumulation));
  putChannel(
    grid,
    "drainageElevation",
    "metre",
    projectedValues(work, map.DrainageElevations).map((value) => (value - map.BaseSeaLevel) / 1024)
  );
  putChannel(
    grid,
    "precipitation",
    "metre/year",
    projectedValues(
      work,
      Float64Array.from(map.Rainfall, (value, i) => (value + map.Snowfall[i]) / 1000)
    )
  );
  putChannel(
    grid,
    "erosion",
    "metre",
    projectedValues(
      work,
      Float64Array.from(
        map.CumulativeFluvialErosion,
        (value, i) =>
          (value + map.CumulativeGlacialErosion[i] + map.CumulativeCoastalErosion[i]) / 1024
      )
    )
  );
  // Keep substrate useful to cave generation without inventing a second geology.
  projectPhysicalMaterial(state);
  putChannel(
    grid,
    "carbonate",
    "ratio",
    projectedValues(
      work,
      Float64Array.from(
        map.CrustContinentalFraction,
        (value, i) =>
          (value / 1000) * (1 - Math.min(1, map.VolcanicConstructionHistory[i] / (1024 * 100)))
      )
    )
  );
  projectFinishedSamples(state);
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
