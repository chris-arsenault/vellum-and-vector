import { gridPosition, putChannel, allocateNumerical, type NumericalVector } from "@atlas/domain";
import type { GenerationState } from "../process";
import { atlasChannels, type ChannelBinding } from "./atlasChannels";
import { nativeIndexAtSurface } from "./atlasWorkspace";
import { projectPhysicalMaterial } from "./physicalMaterial";
import type { AtlasPhysicalWorkspace } from "./atlasWorkspace";
import { projectedValues } from "./atlasSampling";
import { ecologyBindings } from "./ecologyState";

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
      binding.unit === "category" || binding.unit === "cell-index",
      grid.channels[binding.name]
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
          : map.mesh.cellToLeaf(value)
        : (value - datum) * scale + offset;
  }
  putChannel(grid, binding.name, binding.unit, values);
}
function projectChannels(
  state: GenerationState,
  forcingOnly = false,
  preserveTerrain = false,
  bindings = atlasChannels
) {
  for (const binding of bindings) {
    if (forcingOnly && !forcingChannels.has(binding.name)) continue;
    if (preserveChannel(state, binding.name, preserveTerrain)) continue;
    projectChannel(state, binding);
  }
}
export function projectNative(
  state: GenerationState,
  forcingOnly = false,
  preserveTerrain = false,
  bindings = atlasChannels,
  selectedChannels?: ReadonlySet<string>
) {
  const grid = state.surface;
  projectChannels(state, forcingOnly, preserveTerrain, bindings);
  if (forcingOnly) {
    putChannel(grid, "naturalTemperature", "celsius", grid.channels.temperature.slice());
    putChannel(grid, "naturalRock", "ratio", grid.channels.rock.slice());
    return;
  }
  const emit = (
    name: string,
    unit: string,
    values: () => NumericalVector,
    quantity: "category" | "intensive" = "intensive"
  ) => {
    if (!selectedChannels || selectedChannels.has(name))
      putChannel(grid, name, unit, values(), quantity);
  };
  projectWaterLevels(state.physical!, emit);
  projectDerivedClimate(state, emit);
  projectDerivedMaterial(state, emit, selectedChannels);
}
type DerivedEmitter = (
  name: string,
  unit: string,
  values: () => NumericalVector,
  quantity?: "category" | "intensive"
) => void;

function projectDerivedClimate(state: GenerationState, emit: DerivedEmitter) {
  const work = state.physical!,
    map = work.map;
  emit("seaDatum", "metre", () =>
    allocateNumerical(
      { type: "float64", length: work.samples.length, lifetime: "run", name: "seaDatum" },
      work.numerical
    ).fill(map.BaseSeaLevel / 1024)
  );
  emit("flow", "cubic-metre/second", () => projectedValues(work, map.FlowAccumulation));
  emit("drainageElevation", "metre", () =>
    projectedValues(work, map.DrainageElevations).map((value) => (value - map.BaseSeaLevel) / 1024)
  );
  emit("precipitation", "metre/year", () =>
    projectedValues(work, (i) => (map.Rainfall.get(i) + map.Snowfall.get(i)) / 1000)
  );
}
function projectDerivedMaterial(
  state: GenerationState,
  emit: DerivedEmitter,
  selectedChannels?: ReadonlySet<string>
) {
  const work = state.physical!,
    map = work.map;
  emit("erosion", "metre", () =>
    projectedValues(
      work,
      (i) =>
        (map.CumulativeFluvialErosion.get(i) +
          map.CumulativeGlacialErosion.get(i) +
          map.CumulativeCoastalErosion.get(i)) /
        1024
    )
  );
  // Keep substrate useful to cave generation without inventing a second geology.
  if (!selectedChannels || selectedChannels.has("physicalMaterial")) projectPhysicalMaterial(state);
  emit("carbonate", "ratio", () =>
    projectedValues(
      work,
      (i) =>
        (map.CrustContinentalFraction.get(i) / 1000) *
        (1 - Math.min(1, map.VolcanicConstructionHistory.get(i) / (1024 * 100)))
    )
  );
}
function projectWaterLevels(work: AtlasPhysicalWorkspace, emit: DerivedEmitter) {
  const map = work.map;
  emit(
    "waterLevel",
    "metre",
    () =>
      projectedValues(
        work,
        (i) =>
          ((map.WaterKindCodes.get(i) ? map.WaterSurfaceElevations.get(i) : map.EffectiveSeaLevel) -
            map.BaseSeaLevel) /
          1024,
        true
      ),
    "category"
  );
  emit("seaLevel", "metre", () =>
    allocateNumerical(
      { type: "float64", length: work.samples.length, lifetime: "run", name: "seaLevel" },
      work.numerical
    ).fill((map.EffectiveSeaLevel - map.BaseSeaLevel) / 1024)
  );
}

export function nativeAtSurfacePosition(state: GenerationState, i: number): number {
  const p = gridPosition(state.surface, i);
  return nativeIndexAtSurface(state, p.x, p.y);
}
