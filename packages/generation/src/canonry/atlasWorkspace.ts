import {
  gridPosition,
  gridSampler,
  interpolateSample,
  point,
  spatial,
  type Grid,
  type Position,
} from "@atlas/domain";
import type { GenerationState } from "../process";
import { authoredFields } from "../mapAuthored";
import { createField, type PhysicalField } from "./field";
import { createMesh, nearestTriangle } from "./mesh";
import { atlasPhysicalProfile, atlasQuality } from "./atlasProfile";
import { atlasChannels, type ChannelBinding } from "./atlasChannels";
import type { PhysicalProfile } from "./profile";
import { clamp, units } from "./math";
import { nativeContracts } from "./contracts";
import type { AtlasParameters } from "../atlasParameters";

export interface AtlasPhysicalWorkspace {
  map: PhysicalField;
  profile: PhysicalProfile;
  center: [number, number];
  metresPerStep: number;
  samples: Int32Array;
  fixed: { binding: ChannelBinding; values: Float64Array }[];
  inherited: boolean;
}
export function nativePosition(work: AtlasPhysicalWorkspace, i: number): Position {
  return {
    x: work.center[0] + work.map.mesh.x[i] * work.metresPerStep,
    y: work.center[1] + work.map.mesh.y[i] * work.metresPerStep,
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
  map.SedimentProducedTotal = map.CumulativeDeposition.reduce((a, b) => a + b, 0);
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
      const scale = binding.name === "oceanDistance" ? work.metresPerStep : binding.scale;
      map[binding.native][i] = Math.round(
        (value - (binding.offset ?? 0) + (binding.datum ? datum : 0)) / scale
      );
    }
  }
}
function fixedInheritedBoundary(state: GenerationState, work: AtlasPhysicalWorkspace) {
  if (!work.inherited) return;
  const values = new Float64Array(work.map.mesh.count).fill(NaN);
  const footprint = state.surface.scope.footprint,
    margin = work.metresPerStep * 2;
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
    values[i] = Math.round((valueAt(position) - (binding.offset ?? 0)) / binding.scale);
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
  const { triangles } = atlasQuality[quality],
    profile = atlasPhysicalProfile(triangles, parameters);
  const map = createField(createMesh(triangles, profile.BoundaryPaddingSteps)),
    bounds = state.surface.bounds;
  const center: [number, number] = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
  const metresPerStep =
    Math.hypot(bounds[2] - bounds[0], bounds[3] - bounds[1]) / (map.mesh.contentRadius * 1.96);
  const work: AtlasPhysicalWorkspace = {
    map,
    profile,
    center,
    metresPerStep,
    samples: new Int32Array(state.surface.active.length),
    fixed: [],
    inherited: Boolean(state.surface.channels.elevation),
  };
  for (let i = 0; i < work.samples.length; i++) {
    const p = gridPosition(state.surface, i);
    work.samples[i] = nearestTriangle(
      map.mesh,
      (p.x - center[0]) / metresPerStep,
      (p.y - center[1]) / metresPerStep
    );
  }
  if (work.inherited) inheritNumerical(state, work);
  fixedInheritedBoundary(state, work);
  fixedAuthoring(state, work);
  return work;
}
export function composeNativeAuthoring(work: AtlasPhysicalWorkspace) {
  const map = work.map;
  for (const { binding, values } of work.fixed)
    for (let i = 0; i < values.length; i++) {
      if (!Number.isFinite(values[i])) continue;
      const value = values[i] + (binding.datum ? map.BaseSeaLevel : 0);
      map[binding.native][i] = value;
      if (binding.native === "Elevation")
        map.BedrockElevation[i] = value - map.SedimentThickness[i];
    }
}
export function sampleSurfaceAtNative(state: GenerationState, name: string, i: number): number {
  const work = state.physical!;
  return interpolateSample(state.surface, name, nativePosition(work, i));
}
export function nativeIndexAtSurface(state: GenerationState, x: number, y: number) {
  const work = state.physical!;
  return nearestTriangle(
    work.map.mesh,
    clamp(
      (x - work.center[0]) / work.metresPerStep,
      -work.map.mesh.workRadius,
      work.map.mesh.workRadius
    ),
    clamp(
      (y - work.center[1]) / work.metresPerStep,
      -work.map.mesh.workRadius,
      work.map.mesh.workRadius
    )
  );
}
