import {
  gridSampler,
  interpolateSample,
  fieldInterpolator,
  point,
  spatial,
  type Grid,
  type GridSurface,
  type Position,
  rectangle,
} from "@atlas/domain";
import type { GenerationState } from "../process";
import { authoredFields } from "../mapAuthored";
import { createField, reconcileWater, type PhysicalField } from "./field";
import { nearestTriangle } from "./mesh";
import { createWorldMesh } from "./worldMesh";
import { createAdaptiveWorldMesh } from "./adaptiveMesh";
import { atlasPhysicalProfile, atlasQuality } from "./atlasProfile";
import { atlasChannels, type ChannelBinding } from "./atlasChannels";
import type { PhysicalProfile } from "./profile";
import { units } from "./math";
import { inheritedNativeFacts } from "./inheritedFacts";
import type { AtlasParameters } from "../atlasParameters";
import { preparePhysicalChannels } from "./continuousState";
import { waterWrites } from "./physicalWrites";
import { continuousSurface } from "./continuousSurface";
import { projectEcologySupport } from "./ecologyPublication";
import { prepareRiverPaths } from "./riverChannelPaths";
import { prepareProvinceRegions } from "./provinceGeography";
import type { MotionChannel, MotionInput } from "./motionOwnership";

export interface AtlasPhysicalWorkspace {
  magic?: import("./magicState").MagicWorkspace;
  map: PhysicalField;
  profile: PhysicalProfile;
  samples: Int32Array;
  fixed: {
    binding: ChannelBinding;
    values: Float64Array;
    source?: GridSurface;
    footprint?: Grid["scope"]["footprint"];
  }[];
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
  if (!surface.channels.geothermal) map.Geothermal.fill(0);
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
  map.inheritedMotion = (["crustMotionX", "crustMotionY"] as const).flatMap((channel) => {
    const source = parent.get(channel) ?? surface;
    return source.channels[channel] ? [{ channel, source, footprint: source.scope.footprint }] : [];
  });
  map.provinces = structuredClone(
    (parent.get("province") ?? parent.get("crustMotionX") ?? surface).geography?.provinces?.province
      ?.partition ??
      (parent.get("crustMotionX") ?? surface).geography?.provinces?.crustMotionX?.partition ??
      null
  );
  if (map.provinces) prepareProvinceRegions(map);
  map.CrustSupportInitialized = true;
  initializeInheritedMaterial(map, surface);
  map.SedimentProducedTotal = map.CumulativeDeposition.reduce(
    (a, b, i) => a + (b / 1024) * map.mesh.areas[i],
    0
  );
  map.SedimentDepositedTotal = map.SedimentProducedTotal;
  for (const fact of inheritedNativeFacts([...Object.keys(surface.channels), ...parent.keys()]))
    map.AvailableFacts.add(fact);
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
    const valueAt = fieldInterpolator(grid, binding.name, binding.unit === "category");
    for (let i = 0; i < map.mesh.count; i++) {
      const value = valueAt(nativePosition(work, i));
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
      work.fixed.push({
        binding,
        values,
        source,
        footprint: authority.footprint ?? source.scope.footprint,
      });
    }
  }
}
export function createAtlasWorkspace(
  state: GenerationState,
  quality: keyof typeof atlasQuality,
  parameters: Partial<AtlasParameters> = {}
): AtlasPhysicalWorkspace {
  const profile = atlasPhysicalProfile(parameters);
  const frame = spatial.bounds(state.domain.world.reference.domain);
  profile.WorldExtentY = [frame[1], frame[3]];
  profile.WorldExtentX = [frame[0], frame[2]];
  const bounds = state.surface.bounds;
  const maximumSize =
    (Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1]) + 2 * profile.BoundaryPadding) /
    Math.sqrt(atlasQuality[quality].baseCells);
  const featureSamples = { draft: 2, standard: 4, fine: 8 }[quality];
  const sampling = { maximumSize, minimumSize: maximumSize / 16, featureSamples };
  const covers = spatial.pointCoverage(state.domain.scope.footprint),
    anchor = spatial.interiorPosition(state.domain.scope.footprint);
  const fixed = state.domain.world.areas[state.domain.scope.areaId].profile === "world";
  const mesh = fixed
    ? createWorldMesh(
        bounds,
        atlasQuality[quality].baseCells,
        profile.BoundaryPadding,
        (x, y) => covers({ x, y, z: 0 }),
        spatial.area(state.domain.scope.footprint),
        [anchor.x, anchor.y]
      )
    : createChildMesh(state, sampling, profile.BoundaryPadding);
  const map = createField(mesh);
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
  preparePhysicalChannels(work.map, []);
  return work;
}
function createChildMesh(
  state: GenerationState,
  sampling: AtlasPhysicalWorkspace["sampling"],
  padding: number
) {
  const support = protectedSampling(state, sampling.maximumSize, padding);
  sampling.minimumSize = support.reduce(
    (size, patch) => Math.min(size, patch.size),
    sampling.minimumSize
  );
  return createAdaptiveWorldMesh(
    state.surface.bounds,
    {
      ...sampling,
      refine: (box) =>
        support.some(
          (patch) =>
            Math.max(box[2] - box[0], box[3] - box[1]) > patch.size &&
            spatial.intersects(rectangle(box), patch.footprint)
        ),
    },
    padding,
    state.domain.scope.footprint
  );
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
export function refreshWorkspaceSamples(state: GenerationState, work: AtlasPhysicalWorkspace) {
  if (state.surface.mesh?.x === work.map.mesh.x) return;
  preparePhysicalChannels(work.map, []);
  work.samples = Int32Array.from({ length: work.map.mesh.count }, (_, i) => i);
  state.surface = continuousSurface(state.surface, work);
}
export function refreshWorkspaceProtection(state: GenerationState, work: AtlasPhysicalWorkspace) {
  work.fixed = [];
  fixedInheritedBoundary(state, work);
  fixedAuthoring(state, work);
  work.map.motionDetail = work.sampling.featureSamples;
  work.map.authoredMotion = work.fixed.flatMap(({ binding, source, footprint }): MotionInput[] =>
    source && footprint && ["crustMotionX", "crustMotionY"].includes(binding.name)
      ? [{ channel: binding.name as MotionChannel, source, footprint }]
      : []
  );
  if (state.surface.geography?.biome) {
    const lakes = state.surface.geography.biome.lakes;
    projectEcologySupport(work, state.surface);
    state.surface.geography.biome!.lakes = lakes;
  }
}
export function composeNativeAuthoring(work: AtlasPhysicalWorkspace) {
  const map = work.map;
  const hadPaths = Boolean(map.riverPaths);
  const changed = new Set<import("./continuousState").PhysicalArrayName>();
  for (const { binding, values } of work.fixed)
    for (let i = 0; i < values.length; i++) {
      if (!Number.isFinite(values[i])) continue;
      const value = values[i] + (binding.datum ? map.BaseSeaLevel : 0);
      if (map[binding.native][i] === value) continue;
      map[binding.native][i] = value;
      changed.add(binding.native);
      if (binding.native === "Elevation") {
        map.BedrockElevation[i] = value - map.SedimentThickness[i];
        map.Elevation[i] = map.BedrockElevation[i] + map.SedimentThickness[i];
        reconcileWater(map, i);
        for (const name of ["BedrockElevation", ...waterWrites] as const) changed.add(name);
      }
    }
  if (changed.size) preparePhysicalChannels(map, changed);
  if (hadPaths && !map.riverPaths) prepareRiverPaths(map);
}
export function sampleSurfaceAtNative(state: GenerationState, name: string, i: number): number {
  const work = state.physical!;
  return interpolateSample(state.surface, name, nativePosition(work, i));
}
export function nativeIndexAtSurface(state: GenerationState, x: number, y: number) {
  const work = state.physical!;
  return nearestTriangle(work.map.mesh, x - work.map.mesh.origin[0], y - work.map.mesh.origin[1]);
}
/** Prepare once per forcing pass; channel mutations are visible on the next pass. */
export function nativeSurfaceSampler(state: GenerationState, name: string) {
  const at = fieldInterpolator(state.surface, name);
  return (i: number) => at(nativePosition(state.physical!, i));
}
