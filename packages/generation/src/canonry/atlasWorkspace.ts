import {
  gridSampler,
  interpolateSample,
  point,
  spatial,
  type Grid,
  type Position,
  createAdaptiveField,
  prepareAdaptiveTransfer,
  resampleChannels,
  rectangle,
} from "@atlas/domain";
import type { GenerationState } from "../process";
import { authoredFields } from "../mapAuthored";
import { createField, type PhysicalField } from "./field";
import { nearestTriangle } from "./mesh";
import { createAdaptiveWorldMesh } from "./adaptiveMesh";
import { atlasPhysicalProfile, atlasQuality } from "./atlasProfile";
import { atlasChannels, type ChannelBinding } from "./atlasChannels";
import type { PhysicalProfile } from "./profile";
import { units } from "./math";
import { nativeContracts } from "./contracts";
import type { AtlasParameters } from "../atlasParameters";

export interface AtlasPhysicalWorkspace {
  magic?: import("./magicState").MagicWorkspace;
  map: PhysicalField;
  profile: PhysicalProfile;
  samples: Int32Array;
  fixed: { binding: ChannelBinding; values: Float64Array }[];
  inherited: boolean;
  sampling: { maximumSize: number; minimumSize: number; featureSamples: number };
}
export function nativePosition(work: AtlasPhysicalWorkspace, i: number): Position {
  return {
    x: work.map.mesh.origin[0] + work.map.mesh.x[i],
    y: work.map.mesh.origin[1] + work.map.mesh.y[i],
    z: 0,
  };
}
function preferInput(candidate: Grid, previous: Grid | undefined): boolean {
  return (
    !previous || (candidate.scope.resolution ?? Infinity) < (previous.scope.resolution ?? Infinity)
  );
}
function parentChannels(state: GenerationState) {
  const inputs = new Map<string, Grid>();
  for (const field of state.domain.world.fields) {
    const grid = state.domain.numerical[field.id];
    if (
      !grid ||
      grid.scope.spaceId !== state.surface.scope.spaceId ||
      field.areaId === state.surface.scope.areaId
    )
      continue;
    if (!spatial.covers(grid.scope.footprint, state.surface.scope.footprint)) continue;
    for (const name of Object.keys(grid.channels)) {
      const previous = inputs.get(name);
      if (preferInput(grid, previous)) inputs.set(name, grid);
    }
  }
  return inputs;
}
function initializeInheritedMaterial(map: PhysicalField, surface: Grid) {
  for (let i = 0; i < map.mesh.count; i++) {
    if (!surface.channels.bedrock)
      map.BedrockElevation[i] = map.Elevation[i] - map.SedimentThickness[i];
    if (!surface.channels.crustSupport) map.CrustSupportElevation[i] = map.Elevation[i];
    if (!surface.channels.continentalFraction)
      map.CrustContinentalFraction[i] = map.Elevation[i] >= map.BaseSeaLevel ? 1000 : 0;
    if (!surface.channels.rock) map.RockResistance[i] = 1000;
    if (map.CrustThickness[i] <= 0)
      map.CrustThickness[i] = units(1000 + 3 * map.CrustContinentalFraction[i]);
    map.Elevation[i] = map.BedrockElevation[i] + map.SedimentThickness[i];
  }
  map.CrustTypeCodes.set(
    Int32Array.from(map.CrustContinentalFraction, (value) => (value >= 500 ? 2 : 1))
  );
}
function inheritNumerical(state: GenerationState, work: AtlasPhysicalWorkspace) {
  const map = work.map,
    parent = parentChannels(state),
    surface = state.surface;
  const datum = surface.channels.seaDatum?.[0] ?? 0;
  map.OpenBoundary = true;
  map.BaseSeaLevel = units(datum);
  map.EffectiveSeaLevel = map.BaseSeaLevel;
  map.SeaLevelInitialized = true;
  inheritChannels(surface, work, parent, datum);
  map.CrustSupportInitialized = true;
  initializeInheritedMaterial(map, surface);
  map.SedimentProducedTotal = map.CumulativeDeposition.reduce(
    (a, b, i) => a + (b / 1024) * map.mesh.areas[i],
    0
  );
  map.SedimentDepositedTotal = map.SedimentProducedTotal;
  for (const contract of Object.values(nativeContracts))
    for (const fact of contract.produces) map.AvailableFacts.add(fact);
  map.AvailableFacts.delete("Validated");
}
function inheritChannels(
  surface: Grid,
  work: AtlasPhysicalWorkspace,
  parent: Map<string, Grid>,
  datum: number
) {
  const map = work.map;
  for (const binding of atlasChannels) {
    const grid = parent.get(binding.name) ?? surface;
    if (!grid.channels[binding.name]) continue;
    for (let i = 0; i < map.mesh.count; i++) {
      const value = interpolateSample(
        grid,
        binding.name,
        nativePosition(work, i),
        binding.unit === "category"
      );
      const native = (value - (binding.offset ?? 0) + (binding.datum ? datum : 0)) / binding.scale;
      map[binding.native][i] =
        map[binding.native] instanceof Int32Array ? Math.round(native) : native;
    }
  }
}
function fixedInheritedBoundary(state: GenerationState, work: AtlasPhysicalWorkspace) {
  if (!work.inherited) return;
  const values = new Float64Array(work.map.mesh.count).fill(NaN);
  const footprint = state.surface.scope.footprint,
    margin = work.map.mesh.spacing * 2;
  const interior = spatial.buffer(footprint, -margin);
  for (let i = 0; i < values.length; i++)
    if (!interior || !spatial.covers(interior, point(nativePosition(work, i))))
      values[i] = work.map.Elevation[i] - work.map.BaseSeaLevel;
  work.fixed.push({ binding: atlasChannels[0], values });
}
function fixedSamples(
  work: AtlasPhysicalWorkspace,
  source: Grid,
  footprint: Grid["scope"]["footprint"],
  binding: ChannelBinding
) {
  const values = new Float64Array(work.map.mesh.count).fill(NaN);
  const covers = spatial.pointCoverage(footprint),
    sourceCovers = spatial.pointCoverage(source.scope.footprint),
    valueAt = gridSampler(source, binding.name, binding.unit === "category");
  for (let i = 0; i < values.length; i++) {
    const position = nativePosition(work, i);
    if (!covers(position) || !sourceCovers(position)) continue;
    const value = (valueAt(position) - (binding.offset ?? 0)) / binding.scale;
    values[i] = work.map[binding.native] instanceof Int32Array ? Math.round(value) : value;
  }
  return values;
}
function fixedAuthoring(state: GenerationState, work: AtlasPhysicalWorkspace) {
  for (const authority of authoredFields(state.domain)) {
    if (authority.spaceId && authority.spaceId !== state.domain.scope.spaceId) continue;
    const source = authority.source;
    if (!source) throw new Error("Load authored numerical inputs before generation.");
    for (const binding of atlasChannels.filter((binding) =>
      authority.channels?.includes(binding.name)
    )) {
      if (!source.channels[binding.name]) continue;
      const values = fixedSamples(
        work,
        source,
        authority.footprint ?? source.scope.footprint,
        binding
      );
      work.fixed.push({ binding, values });
    }
  }
}
export function createAtlasWorkspace(
  state: GenerationState,
  quality: keyof typeof atlasQuality,
  parameters: Partial<AtlasParameters> = {}
): AtlasPhysicalWorkspace {
  const profile = atlasPhysicalProfile(parameters);
  const bounds = state.surface.bounds;
  // Quadtree splits both axes together. Use the work extent, including its halo,
  // so a rectangular world does not silently quadruple the requested base density.
  const maximumSize =
    (Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1]) + 2 * profile.BoundaryPadding) /
    Math.sqrt(atlasQuality[quality].baseCells);
  const featureSamples = { draft: 2, standard: 4, fine: 8 }[quality];
  const sampling = { maximumSize, minimumSize: maximumSize / 16, featureSamples };
  const support = protectedSampling(state, maximumSize, profile.BoundaryPadding);
  sampling.minimumSize = support.reduce(
    (size, patch) => Math.min(size, patch.size),
    sampling.minimumSize
  );
  const map = createField(
    createAdaptiveWorldMesh(
      bounds,
      {
        ...sampling,
        refine: (box) =>
          support.some(
            (patch) =>
              Math.max(box[2] - box[0], box[3] - box[1]) > patch.size &&
              spatial.intersects(rectangle(box), patch.footprint)
          ),
      },
      profile.BoundaryPadding,
      state.domain.scope.footprint
    )
  );
  const work: AtlasPhysicalWorkspace = {
    map,
    profile,
    samples: new Int32Array(state.surface.active.length),
    fixed: [],
    inherited: Boolean(state.surface.channels.elevation),
    sampling,
  };
  if (work.inherited) inheritNumerical(state, work);
  refreshWorkspaceSamples(state, work);
  refreshWorkspaceProtection(state, work);
  return work;
}
function protectedSampling(state: GenerationState, size: number, padding: number) {
  const bounds = state.surface.bounds,
    span = Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1]);
  const supports = authoredFields(state.domain)
    .filter(
      (field) =>
        field.source &&
        field.resolution &&
        (!field.spaceId || field.spaceId === state.domain.scope.spaceId) &&
        spatial.intersects(
          field.footprint ?? field.source!.scope.footprint,
          state.domain.scope.footprint
        )
    )
    .map((field) => ({
      footprint: field.footprint ?? field.source!.scope.footprint,
      size: field.resolution!,
    }));
  if (span < 2 * padding)
    supports.push({
      footprint: state.surface.scope.footprint,
      size: (size * span) / (2 * padding),
    });
  return supports;
}
export function refreshWorkspaceSamples(
  state: GenerationState,
  work: AtlasPhysicalWorkspace,
  prepared?: ReturnType<typeof prepareAdaptiveTransfer>
) {
  const previous = state.surface,
    topology = work.map.mesh.topology!;
  work.samples = work.map.mesh.leafToCell;
  if (previous.topology === topology) return;
  const next = createAdaptiveField(previous.id, previous.scope, topology);
  if (!Object.keys(previous.channels).length) {
    state.surface = next;
    return;
  }
  if (previous.topology?.bounds.every((value, i) => value === topology.bounds[i])) {
    const transfer = prepared ?? prepareAdaptiveTransfer(previous.topology, topology);
    for (const [name, values] of Object.entries(previous.channels)) {
      next.channels[name] = transfer(values, channelQuantity(previous, name));
      next.units[name] = previous.units[name];
      (next.quantities ??= {})[name] = channelQuantity(previous, name);
    }
  } else resampleChannels(previous, next);
  state.surface = next;
}
function channelQuantity(grid: Grid, name: string) {
  return (
    grid.quantities?.[name] ??
    (["category", "cell-index"].includes(grid.units[name]) ? "category" : "intensive")
  );
}
export function refreshWorkspaceProtection(state: GenerationState, work: AtlasPhysicalWorkspace) {
  work.fixed = [];
  fixedInheritedBoundary(state, work);
  fixedAuthoring(state, work);
}
export function composeNativeAuthoring(work: AtlasPhysicalWorkspace) {
  const map = work.map;
  for (const { binding, values } of work.fixed)
    for (let i = 0; i < values.length; i++) {
      if (!Number.isFinite(values[i])) continue;
      const value = values[i] + (binding.datum ? map.BaseSeaLevel : 0);
      map[binding.native][i] = value;
      if (binding.native === "Elevation") {
        map.BedrockElevation[i] = value - map.SedimentThickness[i];
        map.Elevation[i] = map.BedrockElevation[i] + map.SedimentThickness[i];
      }
    }
}
export function sampleSurfaceAtNative(state: GenerationState, name: string, i: number): number {
  const work = state.physical!;
  // Publication and physical feedback share these exact cell centres. Reading
  // their stored samples avoids rebuilding a Hermite evaluator for every cell.
  if (state.surface.topology === work.map.mesh.topology && state.surface.topology)
    return state.surface.channels[name][work.map.mesh.cellToLeaf[i]];
  return interpolateSample(state.surface, name, nativePosition(work, i));
}
export function nativeIndexAtSurface(state: GenerationState, x: number, y: number) {
  const work = state.physical!;
  return nearestTriangle(work.map.mesh, x - work.map.mesh.origin[0], y - work.map.mesh.origin[1]);
}
