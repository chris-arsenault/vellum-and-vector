import { rockCatalogue } from "../rock/rockCatalogue";
import { setRockStrength } from "../rock/rockField";
import {
  gridSampler,
  interpolateSample,
  fieldInterpolator,
  sweepBudget,
  point,
  spatial,
  type Band,
  type Coverage,
  type Grid,
  type Position,
  isDescendant,
  ownsMapGeography,
} from "@atlas/domain";
import type { GenerationState } from "../process";
import { authoredFields } from "../mapAuthored";
import { createField, type PhysicalField } from "./field";
import { nearestTriangle } from "./mesh";
import { createWorldMesh } from "./worldMesh";
import type { ProjectionInterpolation } from "./atlasSampling";
import { refreshWorkspaceSamples } from "./atlasSurfaceProjection";
export { refreshWorkspaceSamples } from "./atlasSurfaceProjection";
import { atlasPhysicalProfile, atlasQuality } from "./atlasProfile";
import { generationResolution } from "../resolution";
import { isWorldGeography } from "../worldSignificance";
import { continentalWorldProfile } from "./worldScale";
import type { PhysicalProfileOverrides } from "../physicalProfileConfiguration";
import { atlasChannels, type ChannelBinding } from "./atlasChannels";
import type { PhysicalProfile } from "./profile";
import { units } from "./math";
import { inheritedNativeFacts } from "./inheritedFacts";
import type { AtlasParameters } from "../atlasParameters";
import { mapBoundaryValue } from "../atlasParameters";
import { releaseWorking, retainedArray } from "./physicalNumerics";

export interface AtlasPhysicalWorkspace {
  /** Physical lake shores used while tracing mouths, independent of named publication. */
  lakeOutlines?: Map<number, import("geojson").Geometry>;
  magic?: import("./magicState").MagicWorkspace;
  /** Landmarks emplaced in this run, with their measured signatures. */
  landmarks?: import("./landmarks").LandmarkLedger;
  /** The landmarks this run still has to site, with the epoch each forms in. */
  landmarkRoster?: import("./landmarkSiting").RosterEntry[];
  map: PhysicalField;
  profile: PhysicalProfile;
  /** The physical cell under each surface grid sample. */
  samples: Band;
  /** The surface grid's coverage, which holds grid-side tables: samples, projection weights. */
  grid: Coverage;
  interpolation?: ProjectionInterpolation;
  interpolationKey?: string;
  fixed: { binding: ChannelBinding; values: Band }[];
  inherited: boolean;
  /** This map's cell span over a World cell's at the same quality: 1 (or absent) on the World map. */
  scale?: number;
}
export function nativePosition(work: AtlasPhysicalWorkspace, i: number): Position {
  return {
    x: work.map.mesh.origin[0] + work.map.mesh.x(i),
    y: work.map.mesh.origin[1] + work.map.mesh.y(i),
    z: 0,
  };
}
function preferInput(candidate: Grid, previous: Grid | undefined): boolean {
  return (
    !previous || (candidate.scope.resolution ?? Infinity) < (previous.scope.resolution ?? Infinity)
  );
}
/**
 * Ancestor grids that cover this surface, keyed by channel, finest resolution preferred. An
 * independent map's own fields are its ancestors: its captured inputs when this run makes
 * the physical geography, otherwise its present fields (the terrain already made) first.
 */
export function parentChannels(state: GenerationState) {
  const chosen = new Map<string, { grid: Grid; present: boolean }>(),
    owned = ownsMapGeography(state.domain.world, state.surface.scope.areaId);
  for (const field of state.domain.world.fields) {
    const grid = state.domain.numerical[field.id];
    if (!grid || grid.scope.spaceId !== state.surface.scope.spaceId) continue;
    if (!inputOwner(state, field)) continue;
    if (!spatial.covers(grid.scope.footprint, state.surface.scope.footprint)) continue;
    const candidate = { grid, present: owned && !field.input };
    for (const name of Object.keys(grid.channels))
      if (preferCandidate(candidate, chosen.get(name))) chosen.set(name, candidate);
  }
  return new Map([...chosen].map(([name, choice]) => [name, choice.grid]));
}
/** A present field beats a captured input; among the same kind the finer grid wins. */
function preferCandidate(
  candidate: { grid: Grid; present: boolean },
  previous: { grid: Grid; present: boolean } | undefined
) {
  if (!previous) return true;
  if (candidate.present !== previous.present) return candidate.present;
  return preferInput(candidate.grid, previous.grid);
}
function inputOwner(
  state: GenerationState,
  field: GenerationState["domain"]["world"]["fields"][number]
) {
  const id = state.surface.scope.areaId;
  return ownsMapGeography(state.domain.world, id)
    ? field.areaId === id && (!!field.input || !makesTerrain(state))
    : field.areaId !== id && isDescendant(state.domain.world.areas, id, field.areaId);
}
/** The physical geography is being made in this run, not read from the terrain already made. */
function makesTerrain(state: GenerationState) {
  return !state.facts.has("terrain:present");
}
function initializeInheritedMaterial(map: PhysicalField, surface: Grid) {
  for (let i = 0; i < map.mesh.count; i++) {
    if (!surface.channels.bedrock)
      map.BedrockElevation.set(i, map.Elevation.get(i) - map.SedimentThickness.get(i));
    if (!surface.channels.crustSupport) map.CrustSupportElevation.set(i, map.Elevation.get(i));
    if (!surface.channels.continentalFraction)
      map.CrustContinentalFraction.set(i, map.Elevation.get(i) >= map.BaseSeaLevel ? 1000 : 0);
    if (!surface.channels.rock) setRockStrength(map, i, rockCatalogue.strata.resistance);
    if (map.CrustThickness.get(i) <= 0)
      map.CrustThickness.set(i, units(1000 + 3 * map.CrustContinentalFraction.get(i)));
    map.Elevation.set(i, map.BedrockElevation.get(i) + map.SedimentThickness.get(i));
    map.CrustTypeCodes.set(i, map.CrustContinentalFraction.get(i) >= 500 ? 2 : 1);
  }
  if (!surface.channels.geothermal) map.Geothermal.fill(0);
}
function inheritNumerical(state: GenerationState, work: AtlasPhysicalWorkspace) {
  // A map's own captured inputs are its parent channels: they carry the country beyond the
  // frame, so the exterior halo is the parent's ground and not the frame edge clamped outward.
  const map = work.map,
    parent = parentChannels(state),
    surface = state.surface;
  const datum = surface.channels.seaDatum?.get(0) ?? 0;
  map.OpenBoundary = true;
  map.BaseSeaLevel = units(datum);
  map.EffectiveSeaLevel = map.BaseSeaLevel;
  map.SeaLevelInitialized = true;
  inheritChannels(surface, work, parent, datum);
  map.CrustSupportInitialized = true;
  initializeInheritedMaterial(map, surface);
  map.SedimentProducedTotal = map.coverage.reduce(
    map.CumulativeDeposition,
    (sum, deposition, i) => sum + (deposition / 1024) * map.mesh.area(i),
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
    const valueAt = fieldInterpolator(
        grid,
        binding.name,
        binding.unit === "category",
        undefined,
        sweepBudget(grid)
      ),
      band = map[binding.native],
      integer = band.type === "int32";
    for (let i = 0; i < map.mesh.count; i++) {
      const value = inheritedValue(valueAt(nativePosition(work, i)), binding);
      const native = (value - (binding.offset ?? 0) + (binding.datum ? datum : 0)) / binding.scale;
      band.set(i, integer ? Math.round(native) : native);
    }
  }
}
/** Reconstructed field edges can overshoot; imported stocks/fractions retain their meaning. */
function inheritedValue(value: number, binding: ChannelBinding) {
  return Math.max(binding.minimum ?? -Infinity, Math.min(binding.maximum ?? Infinity, value));
}
function fixedInheritedBoundary(state: GenerationState, work: AtlasPhysicalWorkspace) {
  if (!work.inherited) return;
  if (state.domain.world.areas[state.domain.scope.areaId].profile === "region") return;
  const values = retainedArray(work.map, "float64", "inherited:boundary").fill(NaN);
  const footprint = state.surface.scope.footprint,
    margin = state.domain.scope.resolution ?? work.map.mesh.spacing;
  const interior = spatial.buffer(footprint, -margin);
  for (let i = 0; i < values.length; i++)
    if (!interior || !spatial.covers(interior, point(nativePosition(work, i))))
      values.set(i, work.map.Elevation.get(i) - work.map.BaseSeaLevel);
  work.fixed.push({ binding: atlasChannels[0], values });
}
function fixedSamples(
  work: AtlasPhysicalWorkspace,
  source: Grid,
  footprint: Grid["scope"]["footprint"],
  binding: ChannelBinding
) {
  const values = retainedArray(work.map, "float64", `authored:${binding.name}`).fill(NaN);
  const covers = spatial.pointCoverage(footprint),
    sourceCovers = spatial.pointCoverage(source.scope.footprint),
    valueAt = gridSampler(source, binding.name, binding.unit === "category"),
    integer = work.map[binding.native].type === "int32";
  for (let i = 0; i < values.length; i++) {
    const position = nativePosition(work, i);
    if (!covers(position) || !sourceCovers(position)) continue;
    const value = (valueAt(position) - (binding.offset ?? 0)) / binding.scale;
    values.set(i, integer ? Math.round(value) : value);
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
/** Width of a child map's halo in its own cells: two stencil rings and the projection's support. */
const childHaloCells = 4;
/**
 * Every map, world or region, is the same triangular lattice at its own cell span: a child
 * wraps only when its frame spans the cylinder, and only a whole world closes its poles. A
 * child's context land and sea are already inside its frame; its halo only carries the
 * stencils and interpolation support past the frame edge, a few of its own cells wide.
 */
function mapLattice(state: GenerationState, profile: PhysicalProfile, cellSpan: number) {
  const bounds = state.surface.bounds,
    footprint = state.domain.scope.footprint,
    covers = spatial.pointCoverage(footprint),
    anchor = spatial.interiorPosition(footprint),
    world = state.domain.world.areas[state.domain.scope.areaId].profile === "world",
    wraps = world ? profile.MapBoundary === 1 : crossesChartSeam(state),
    padding = world ? profile.BoundaryPadding : childHaloCells * cellSpan;
  return createWorldMesh(
    bounds,
    ((bounds[2] - bounds[0] + 2 * padding) * (bounds[3] - bounds[1] + 2 * padding)) / cellSpan ** 2,
    padding,
    (x, y) => covers({ x, y, z: 0 }),
    spatial.area(footprint),
    [anchor.x, anchor.y],
    wraps,
    world && wraps && profile.LatitudeSouth === -90 && profile.LatitudeNorth === 90
  );
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
  const resolution = generationResolution(
    quality,
    state.domain.world.areas[state.domain.scope.areaId].profile
  );
  const cellSpan = state.domain.world.areas[state.domain.scope.areaId].parentId
      ? (state.domain.scope.resolution ?? resolution.cellSpan)
      : resolution.cellSpan,
    map = createField(mapLattice(state, profile, cellSpan), state.cache);
  const work: AtlasPhysicalWorkspace = {
    map,
    profile,
    samples: state.surface.coverage.scratch("int32", "physical:samples", 0),
    grid: state.surface.coverage,
    fixed: [],
    inherited: Boolean(state.surface.channels.elevation),
    scale: isWorldGeography(state)
      ? 1
      : Math.min(1, cellSpan / generationResolution(quality, "world").cellSpan),
  };
  if (work.inherited) inheritNumerical(state, work);
  refreshWorkspaceSamples(state, work);
  refreshWorkspaceProtection(state, work);
  return work;
}
function crossesChartSeam(state: GenerationState) {
  if (state.domain.world.reference.boundaryMode !== "cylinder") return false;
  const [west, , east] = spatial.bounds(state.domain.world.reference.domain),
    [low, , high] = spatial.bounds(state.domain.scope.footprint);
  return Math.abs(low - west) < 1e-6 && Math.abs(high - east) < 1e-6;
}
export function refreshWorkspaceProtection(state: GenerationState, work: AtlasPhysicalWorkspace) {
  for (const fixed of work.fixed) releaseWorking(work.map, fixed.values);
  work.fixed = [];
  fixedInheritedBoundary(state, work);
  fixedAuthoring(state, work);
}
export function composeNativeAuthoring(work: AtlasPhysicalWorkspace) {
  const map = work.map;
  for (const { binding, values } of work.fixed) {
    const band = map[binding.native];
    for (let i = 0; i < values.length; i++) {
      const fixed = values.get(i);
      if (!Number.isFinite(fixed)) continue;
      const value = fixed + (binding.datum ? map.BaseSeaLevel : 0);
      band.set(i, value);
      if (binding.native === "Elevation") {
        map.BedrockElevation.set(i, value - map.SedimentThickness.get(i));
        map.Elevation.set(i, map.BedrockElevation.get(i) + map.SedimentThickness.get(i));
      }
    }
  }
}
export function sampleSurfaceAtNative(state: GenerationState, name: string, i: number): number {
  const work = state.physical!;
  return interpolateSample(state.surface, name, nativePosition(work, i));
}
export function nativeIndexAtSurface(state: GenerationState, x: number, y: number) {
  const work = state.physical!;
  return nearestTriangle(work.map.mesh, x - work.map.mesh.origin[0], y - work.map.mesh.origin[1]);
}
