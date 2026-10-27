import {
  gridSampler,
  interpolateSample,
  fieldInterpolator,
  point,
  spatial,
  type Grid,
  type Position,
  rectangle,
  isDescendant,
  numericalSampleType,
  allocateNumerical,
  type NumericalVector,
} from "@atlas/domain";
import type { GenerationState } from "../process";
import { authoredFields } from "../mapAuthored";
import { createField, type PhysicalField } from "./field";
import { nearestTriangle } from "./mesh";
import { createWorldMesh } from "./worldMesh";
import { createAdaptiveWorldMesh } from "./adaptiveMesh";
import type { ProjectionInterpolation } from "./atlasSampling";
import { refreshWorkspaceSamples } from "./atlasSurfaceProjection";
export { refreshWorkspaceSamples } from "./atlasSurfaceProjection";
import { atlasPhysicalProfile, atlasQuality } from "./atlasProfile";
import { generationResolution } from "../resolution";
import { continentalWorldProfile } from "./worldScale";
import type { PhysicalProfileOverrides } from "../physicalProfileConfiguration";
import { atlasChannels, type ChannelBinding } from "./atlasChannels";
import type { PhysicalProfile } from "./profile";
import { units } from "./math";
import { inheritedNativeFacts } from "./inheritedFacts";
import type { AtlasParameters } from "../atlasParameters";
import { mapBoundaryValue } from "../atlasParameters";

export interface AtlasPhysicalWorkspace {
  magic?: import("./magicState").MagicWorkspace;
  /** Landmarks emplaced in this run, with their measured signatures. */
  landmarks?: import("./landmarks").LandmarkLedger;
  /** The landmarks this run still has to site, with the epoch each forms in. */
  landmarkRoster?: import("./landmarkSiting").RosterEntry[];
  map: PhysicalField;
  profile: PhysicalProfile;
  samples: NumericalVector;
  interpolation?: ProjectionInterpolation;
  interpolationKey?: string;
  fixed: { binding: ChannelBinding; values: NumericalVector }[];
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
/** Ancestor grids that cover this surface, keyed by channel, finest resolution preferred. */
export function parentChannels(state: GenerationState) {
  const inputs = new Map<string, Grid>();
  for (const field of state.domain.world.fields) {
    const grid = state.domain.numerical[field.id];
    if (
      !grid ||
      grid.scope.spaceId !== state.surface.scope.spaceId ||
      field.areaId === state.surface.scope.areaId
    )
      continue;
    if (!isDescendant(state.domain.world.areas, state.surface.scope.areaId, field.areaId)) continue;
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
    map.CrustTypeCodes[i] = map.CrustContinentalFraction[i] >= 500 ? 2 : 1;
  }
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
        numericalSampleType(map[binding.native]) === "int32" ? Math.round(native) : native;
    }
  }
}
function fixedInheritedBoundary(state: GenerationState, work: AtlasPhysicalWorkspace) {
  if (!work.inherited) return;
  const values = allocateNumerical(
    { type: "float64", length: work.map.mesh.count, lifetime: "run", name: "inherited:boundary" },
    work.map.numerical
  ).fill(NaN);
  const footprint = state.surface.scope.footprint,
    margin = state.domain.scope.resolution ?? work.map.mesh.spacing;
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
  const values = allocateNumerical(
    {
      type: "float64",
      length: work.map.mesh.count,
      lifetime: "run",
      name: `authored:${binding.name}`,
    },
    work.map.numerical
  ).fill(NaN);
  const covers = spatial.pointCoverage(footprint),
    sourceCovers = spatial.pointCoverage(source.scope.footprint),
    valueAt = gridSampler(source, binding.name, binding.unit === "category");
  for (let i = 0; i < values.length; i++) {
    const position = nativePosition(work, i);
    if (!covers(position) || !sourceCovers(position)) continue;
    const value = (valueAt(position) - (binding.offset ?? 0)) / binding.scale;
    values[i] =
      numericalSampleType(work.map[binding.native]) === "int32" ? Math.round(value) : value;
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
  parameters: Partial<AtlasParameters> = {},
  overrides: PhysicalProfileOverrides = {}
): AtlasPhysicalWorkspace {
  const frame = spatial.bounds(state.domain.world.reference.domain);
  const profile = continentalWorldProfile(atlasPhysicalProfile(parameters, overrides), frame);
  profile.WorldExtentY = [frame[1], frame[3]];
  profile.WorldExtentX = [frame[0], frame[2]];
  profile.MapBoundary = mapBoundaryValue(state.domain.world.reference.boundaryMode);
  profile.WrapLongitude = Number(profile.MapBoundary === 1);
  const bounds = state.surface.bounds;
  const resolution = generationResolution(
    quality,
    state.domain.world.areas[state.domain.scope.areaId].profile
  );
  const cellSpan = state.domain.world.areas[state.domain.scope.areaId].parentId
      ? (state.domain.scope.resolution ?? resolution.cellSpan)
      : resolution.cellSpan,
    cellArea = cellSpan ** 2;
  const maximumSize = cellSpan;
  const featureSamples = { draft: 2, standard: 4, fine: 8 }[quality];
  const sampling = { maximumSize, minimumSize: maximumSize / 16, featureSamples };
  const covers = spatial.pointCoverage(state.domain.scope.footprint),
    anchor = spatial.interiorPosition(state.domain.scope.footprint);
  const fixed = state.domain.world.areas[state.domain.scope.areaId].profile === "world";
  const mesh = fixed
    ? createWorldMesh(
        bounds,
        ((bounds[2] - bounds[0] + 2 * profile.BoundaryPadding) *
          (bounds[3] - bounds[1] + 2 * profile.BoundaryPadding)) /
          cellArea,
        profile.BoundaryPadding,
        (x, y) => covers({ x, y, z: 0 }),
        spatial.area(state.domain.scope.footprint),
        [anchor.x, anchor.y],
        profile.MapBoundary === 1,
        profile.MapBoundary === 1 && profile.LatitudeSouth === -90 && profile.LatitudeNorth === 90,
        state.numerical
      )
    : createChildMesh(state, sampling, profile.BoundaryPadding);
  const map = createField(mesh, state.numerical);
  const work: AtlasPhysicalWorkspace = {
    map,
    profile,
    samples: new Int32Array(0),
    fixed: [],
    inherited: Boolean(state.surface.channels.elevation),
    sampling,
  };
  if (work.inherited) inheritNumerical(state, work);
  refreshWorkspaceSamples(state, work);
  refreshWorkspaceProtection(state, work);
  return work;
}
function createChildMesh(
  state: GenerationState,
  sampling: AtlasPhysicalWorkspace["sampling"],
  padding: number
) {
  const targetSize = sampling.maximumSize;
  // The inherited exterior is context; only the requested interior needs the finer samples.
  sampling.maximumSize = Math.max(targetSize, padding / 2);
  const support = [
    { footprint: state.surface.scope.footprint, size: targetSize },
    ...protectedSampling(state, targetSize),
  ];
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
    state.domain.scope.footprint,
    crossesChartSeam(state),
    state.numerical
  );
}
function crossesChartSeam(state: GenerationState) {
  if (state.domain.world.reference.boundaryMode !== "cylinder") return false;
  const [west, , east] = spatial.bounds(state.domain.world.reference.domain),
    [low, , high] = spatial.bounds(state.domain.scope.footprint);
  return Math.abs(low - west) < 1e-6 && Math.abs(high - east) < 1e-6;
}
function protectedSampling(state: GenerationState, size: number) {
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
  if (span < 2 * size)
    supports.push({
      footprint: state.surface.scope.footprint,
      size: span / 4,
    });
  return supports;
}
export function refreshWorkspaceProtection(state: GenerationState, work: AtlasPhysicalWorkspace) {
  if (state.numerical) for (const fixed of work.fixed) state.numerical.release(fixed.values);
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
