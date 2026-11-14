import {
  gridPosition,
  putChannel,
  MapScale,
  type Band,
  type Grid,
  type MaterialCargoSamples,
  requireChannel,
  type FieldChannelName,
} from "@atlas/domain";
import type { GenerationState, MapProcessContext } from "../process";
import { defineCommand } from "../processOperation";
import { generationBindings } from "../generationBindings";
import { selectedAtlasChannels } from "./atlasPublications";
import { physicalChannels, type PhysicalChannel } from "./atlasChannels";
import { nativeIndexAtSurface } from "./atlasWorkspace";
import { projectPhysicalMaterial } from "./physicalMaterial";
import type { AtlasPhysicalWorkspace } from "./atlasWorkspace";
import { projectedValues, resamplePhysicalBand } from "./atlasSampling";
import { groundResourceChannels } from "../rock/groundResources";
import { surfaceMaterialCode } from "../rock/groundPresentation";
import { captureMaterialCargo } from "../rock/groundCargoResources";

// hpc-exempt: one output allocation owner per projection grid; no per-cell state.
const ownedCargo = new WeakMap<Grid, MaterialCargoSamples>();
const materialChannels = groundResourceChannels.map(({ name }) => name);
const forcingChannels = new Set([
  "Elevation",
  "BedrockElevation",
  "SedimentThickness",
  "FractureConductance",
  "RockResistance",
  "WaterKindCodes",
  "Temperature",
]);
function publishChannel(state: GenerationState, channel: PhysicalChannel) {
  const work = state.physical!,
    grid = state.surface;
  const values = resamplePhysicalBand(work, grid, work.map[channel.name], channel);
  putChannel(grid, channel.name, channel.unit, values, channel.quantity);
}
export interface NativeProjection {
  state: GenerationState;
  forcingOnly?: boolean;
  channels?: PhysicalChannel[];
  selectedChannels?: ReadonlySet<FieldChannelName>;
}
/** Projection publishes the supplied current state; callers explicitly settle its physical owners first. */
export const projectNative = defineCommand(
  "physical.project",
  "publish",
  ({
    state,
    forcingOnly = false,
    channels = physicalChannels,
    selectedChannels,
  }: NativeProjection) => {
    const grid = state.surface,
      selected = new Set(channels.map(({ name }) => name)),
      refreshCargo = !forcingOnly && materialChannels.every((name) => selected.has(name));
    publishPhysicalChannels(state, channels, forcingOnly);
    if (forcingOnly) {
      publishSeaLevels(state.physical!, derivedEmitter(grid));
      preserveNaturalForcing(grid);
      return;
    }
    const emit = derivedEmitter(grid, selectedChannels);
    publishSeaLevels(state.physical!, emit);
    publishDerived(state, emit, selectedChannels);
    if (refreshCargo) projectCargo(state);
  },
  []
);
/** The same selected publication policy serves final publication and society's working surface. */
export function selectedNativeProjection(
  state: GenerationState,
  context: MapProcessContext,
  forcingOnly = false
): NativeProjection {
  const bound = generationBindings(context);
  return {
    state,
    forcingOnly,
    channels: forcingOnly ? undefined : selectedAtlasChannels(bound.features),
    selectedChannels: new Set(
      (state.publications ?? []).flatMap((definition) =>
        definition.kind === "field" && definition.publish !== false ? [definition.channel] : []
      )
    ),
  };
}
function publishPhysicalChannels(
  state: GenerationState,
  channels: PhysicalChannel[],
  forcingOnly: boolean
) {
  for (const channel of channels) {
    if (forcingOnly && !forcingChannels.has(channel.name)) continue;
    publishChannel(state, channel);
  }
}
function preserveNaturalForcing(grid: Grid) {
  putChannel(
    grid,
    "NaturalTemperature",
    "native-temperature",
    grid.coverage.copyBand(requireChannel(grid, "Temperature"))
  );
  putChannel(
    grid,
    "NaturalRockResistance",
    "rock-strength",
    grid.coverage.copyBand(requireChannel(grid, "RockResistance"))
  );
}
function derivedEmitter(
  grid: Grid,
  selectedChannels?: ReadonlySet<FieldChannelName>
): DerivedEmitter {
  return (name, unit, values, quantity = "intensive") => {
    if (!selectedChannels || selectedChannels.has(name))
      putChannel(grid, name, unit, values(), quantity);
  };
}
function projectCargo(state: GenerationState) {
  const grid = state.surface,
    work = state.physical!,
    previous = ownedCargo.get(grid),
    cargo = captureMaterialCargo(work.map, grid.coverage, work.samples.length, (cell) =>
      work.samples.get(cell)
    );
  grid.materialCargo = cargo;
  ownedCargo.set(grid, cargo);
  if (previous) {
    grid.coverage.release(previous.offsets);
    grid.coverage.release(previous.records);
  }
}
type DerivedEmitter = (
  name: FieldChannelName,
  unit: string,
  values: () => Band,
  quantity?: "category" | "intensive"
) => void;

function publishDerived(
  state: GenerationState,
  emit: DerivedEmitter,
  selectedChannels?: ReadonlySet<FieldChannelName>
) {
  const work = state.physical!,
    map = work.map;
  emit("Precipitation", "millimetre/year", () =>
    projectedValues(work, (i) => map.Rainfall.get(i) + map.Snowfall.get(i))
  );
  emit(
    "SurfaceMaterial",
    "category",
    () => projectedValues(work, (i) => surfaceMaterialCode(map, i), true),
    "category"
  );
  emit("TotalErosion", "native-length", () =>
    projectedValues(
      work,
      (i) =>
        map.CumulativeFluvialErosion.get(i) +
        map.CumulativeGlacialErosion.get(i) +
        map.CumulativeCoastalErosion.get(i)
    )
  );
  if (!selectedChannels || selectedChannels.has("PhysicalMaterial")) projectPhysicalMaterial(state);
  emit("CarbonateFraction", "ratio", () =>
    projectedValues(
      work,
      (i) =>
        (map.CrustContinentalFraction.get(i) / 1000) *
        (1 -
          Math.min(
            1,
            MapScale.metres(map.VolcanicConstructionHistory.get(i), "native") /
              map.scale.length(0.000025)
          ))
    )
  );
}
function publishSeaLevels(work: AtlasPhysicalWorkspace, emit: DerivedEmitter) {
  for (const name of ["BaseSeaLevel", "EffectiveSeaLevel"] as const)
    emit(name, "native-length", () =>
      work.grid.scratch("float64", name, work.samples.length).fill(work.map[name])
    );
}
export function nativeAtSurfacePosition(state: GenerationState, i: number): number {
  const p = gridPosition(state.surface, i);
  return nativeIndexAtSurface(state, p.x, p.y);
}
