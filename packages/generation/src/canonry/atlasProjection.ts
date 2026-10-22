import { gridPosition, replaceChannel, type NumericValues } from "@atlas/domain";
import type { GenerationState } from "../process";
import { atlasChannels, type ChannelBinding } from "./atlasChannels";
import { nativeIndexAtSurface } from "./atlasWorkspace";
import { projectPhysicalMaterial } from "./physicalMaterial";
import { ecologyBindings } from "./ecologyState";
import { projectEcologySupport } from "./ecologyPublication";
import { derivedBindings } from "./derivedFields";
import { provinceBinding, retainInheritedMotion } from "./motionPublication";

const forcingChannels = new Set([
  "elevation",
  "bedrock",
  "sediment",
  "fracture",
  "rock",
  "water",
  "temperature",
]);
const weatherAndEcologyChannels = new Set([
  "temperature",
  "moisture",
  "rainfall",
  "snowfall",
  "runoff",
  "ice",
  ...ecologyBindings.map(([name]) => name),
]);
function projectChannel(state: GenerationState, binding: ChannelBinding) {
  const map = state.physical!.map,
    field = map.continuous!,
    province = provinceBinding(map, binding.name),
    quantity = ["category", "cell-index"].includes(binding.unit) ? "category" : "intensive";
  if (
    quantity === "intensive" &&
    !province &&
    !field.coefficients[binding.native] &&
    !field.adaptive[binding.native]
  )
    throw new Error(`Prepare ${binding.native} before publishing ${binding.name}.`);
  replaceChannel(state.surface, binding.name, binding.unit, map[binding.native], quantity, {
    province,
    coefficients: field.coefficients[binding.native],
    adaptive: field.adaptive[binding.native],
    transform: {
      scale: binding.scale,
      offset: (binding.offset ?? 0) - (binding.datum ? map.BaseSeaLevel * binding.scale : 0),
    },
  });
  retainInheritedMotion(map, state.surface, binding.name);
}
/** Publish affine views of the process-owned coefficients, without a resampling map. */
export function projectNative(
  state: GenerationState,
  forcingOnly = false,
  preserveTerrain = false,
  bindings = atlasChannels,
  selectedChannels?: ReadonlySet<string>
) {
  const grid = state.surface,
    map = state.physical!.map;
  const owned = map.continuous?.geography;
  const geography = owned && { ...owned, categories: owned.categories && { ...owned.categories } };
  if (!map.continuous)
    throw new Error("Prepare physical fields in the producer before publication.");
  for (const binding of bindings) {
    if (forcingOnly && !forcingChannels.has(binding.name)) continue;
    if (
      preserveTerrain &&
      grid.channels[binding.name] &&
      !weatherAndEcologyChannels.has(binding.name)
    )
      continue;
    projectChannel(state, binding);
  }
  if (forcingOnly) {
    for (const [name, source] of [
      ["naturalTemperature", "temperature"],
      ["naturalRock", "rock"],
    ])
      replaceChannel(
        grid,
        name,
        grid.units[source],
        grid.channels[source].slice(),
        "intensive",
        structuredClone({
          coefficients: grid.prepared!.coefficients[source],
          adaptive: grid.prepared!.adaptive?.[source],
          transform: grid.prepared!.transforms[source],
        })
      );
    return;
  }
  const emit = (
    name: string,
    unit: string,
    values: () => NumericValues,
    quantity: "category" | "intensive" = "intensive"
  ) => {
    if (!selectedChannels || selectedChannels.has(name))
      replaceChannel(grid, name, unit, values(), quantity);
  };
  emit(
    "waterLevel",
    "metre",
    () =>
      Float64Array.from(
        map.WaterKindCodes,
        (kind, i) =>
          ((kind ? map.WaterSurfaceElevations[i] : map.EffectiveSeaLevel) - map.BaseSeaLevel) / 1024
      ),
    "category"
  );
  for (const binding of derivedBindings)
    if (!selectedChannels || selectedChannels.has(binding.name)) projectChannel(state, binding);
  if (!selectedChannels || selectedChannels.has("physicalMaterial")) projectPhysicalMaterial(state);
  projectEcologySupport(state.physical!, grid);
  if (geography) {
    replaceChannel(grid, "naturalSurface", "category", map.NaturalSurfaceCodes, "category");
    replaceChannel(grid, "finalSurface", "category", map.FinalSurfaceCodes, "category");
    grid.geography = { ...grid.geography, ...geography, provinces: grid.geography?.provinces };
    map.continuous!.geography = grid.geography;
    grid.ocean = map.continuous!.ocean;
  }
}
export function nativeAtSurfacePosition(state: GenerationState, i: number): number {
  if (state.surface.mesh) return i;
  const p = gridPosition(state.surface, i);
  return nativeIndexAtSurface(state, p.x, p.y);
}
