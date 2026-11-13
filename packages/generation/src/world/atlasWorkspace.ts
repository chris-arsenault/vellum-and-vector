import { setRockStrength } from "../rock/rockField";
import { finishGroundImport, importGroundBand } from "../rock/groundResources";
import { looseTo, standGround } from "../rock/groundLedger";
import {
  gridSampler,
  requireChannel,
  type FieldChannelName,
  requireThat,
  fillBand,
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
  MapScale,
  defaultTerrainCells,
  fieldChartFootprint,
} from "@atlas/domain";
import type { GenerationState } from "../process";
import { authoredFields } from "../mapAuthored";
import {
  createField,
  isMutablePhysicalName,
  type PhysicalBufferName,
  type PhysicalField,
} from "./field";
import { nearestTriangle } from "./mesh";
import { createWorldMesh } from "./worldMesh";
import type { ProjectionInterpolation } from "./atlasSampling";
import { refreshWorkspaceSamples } from "./atlasSurfaceProjection";
export { refreshWorkspaceSamples } from "./atlasSurfaceProjection";
import { atlasPhysicalProfile, atlasQuality } from "./atlasProfile";
import { generationResolution } from "../resolution";
import type { PhysicalProfileOverrides } from "../physicalProfileConfiguration";
import { physicalChannels, type PhysicalChannel } from "./atlasChannels";
import type { PhysicalProfile } from "./profile";
import type { AtlasParameters } from "../atlasParameters";
import { mapBoundaryValue } from "../atlasParameters";
import { releaseWorking, retainedArray } from "./physicalNumerics";
import { groundResourceChannels } from "../rock/groundResources";
import { importMaterialCargo } from "../rock/groundCargoResources";
import { fieldSampleIndex } from "@atlas/domain";
import { captureSupportDatum } from "./support";
import { physicalContext } from "./context";
import { restoreRivers } from "../water/networkResources";
import { columnNames } from "../water/column";
import { inheritWaterColumn } from "../water/columnResources";

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
  fixed: { binding: PhysicalChannel; values: Band }[];
  inherited: boolean;
}
export function nativePosition(work: Pick<AtlasPhysicalWorkspace, "map">, i: number): Position {
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
 * independent map's own fields are its ancestors: its captured inputs, or the fields it
 * published when a saved map is reopened to continue from them.
 */
export function parentChannels(state: GenerationState) {
  const chosen = new Map<string, { grid: Grid; present: boolean }>(),
    owned = ownsMapGeography(state.domain.world, state.surface.scope.areaId);
  for (const field of state.domain.world.fields) {
    const source = state.domain.numerical[field.id];
    if (!source || source.scope.spaceId !== state.surface.scope.spaceId) continue;
    const grid = { ...source, periodicWidth: state.surface.periodicWidth };
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
    ? field.areaId === id && (!!field.input || reopensGeography(state))
    : field.areaId !== id && isDescendant(state.domain.world.areas, id, field.areaId);
}
/**
 * A saved map reopened to continue from its completed geography reads the fields it published
 * as its inputs. Generation never sets this fact: a run makes or refines its own terrain.
 */
function reopensGeography(state: GenerationState) {
  return state.facts.has("geography:reopened");
}
function inheritNumerical(state: GenerationState, work: AtlasPhysicalWorkspace) {
  // A map's own captured inputs are its parent channels: they carry the country beyond the
  // frame, so the exterior halo is the parent's ground and not the frame edge clamped outward.
  const map = work.map,
    parent = parentChannels(state),
    surface = state.surface;
  requireThat(
    surface.channels.BaseSeaLevel && surface.channels.EffectiveSeaLevel,
    "physical_datum",
    "Captured physical fields require their canonical sea levels."
  );
  map.OpenBoundary = true;
  map.BaseSeaLevel = surface.channels.BaseSeaLevel.get(0);
  map.EffectiveSeaLevel = surface.channels.EffectiveSeaLevel.get(0);
  map.SeaLevelInitialized = true;
  const imported = inheritChannels(surface, work, parent);
  map.CrustSupportInitialized = true;
  // The parent formed this crust; here it is only carried on.
  map.CrustFormed = true;
  finishGroundImport(map, imported);
  captureSupportDatum(map, physicalContext(0, 0, work.profile));
  const material = parent.get("RockLayerKind0") ?? surface;
  if (material.materialCargo)
    importMaterialCargo(map, material.materialCargo, (cell) =>
      fieldSampleIndex(material, nativePosition(work, cell))
    );
  map.SedimentProducedTotal = map.coverage.reduce(
    map.CumulativeDeposition,
    (sum, deposition, i) => sum + MapScale.metres(deposition, "native") * map.mesh.area(i),
    0
  );
  map.SedimentDepositedTotal = map.SedimentProducedTotal;
  const network = state.domain.world.drainage?.[state.domain.scope.areaId];
  if (network?.kept && !network.input) restoreRivers(map, network.kept);
}
function inheritChannels(surface: Grid, work: AtlasPhysicalWorkspace, parent: Map<string, Grid>) {
  const imported = new Set<PhysicalBufferName>(),
    material = parent.get("RockLayerKind0") ?? surface,
    materialNames = new Set(groundResourceChannels.map(({ name }) => name));
  for (const channel of physicalChannels) {
    if ((columnNames as readonly string[]).includes(channel.name)) continue;
    const grid = materialNames.has(channel.name) ? material : (parent.get(channel.name) ?? surface);
    if (!grid.channels[channel.name]) continue;
    imported.add(channel.name);
    inheritLocalChannel(work, grid, channel);
  }
  inheritWaterColumn(work.map, surface, parent);
  return imported;
}
/** Sample the same quantity into child-owned bands; only represented area can change an amount. */
export function inheritLocalChannel(
  work: AtlasPhysicalWorkspace,
  grid: Grid,
  channel: PhysicalChannel
) {
  const map = work.map,
    band = map[channel.name],
    values = requireChannel(grid, channel.name),
    extensive = channel.quantity === "extensive",
    density = extensive
      ? fillBand(grid.coverage.scratch("float64", "inherit:area-density", values.length), (cell) =>
          grid.measures.get(cell) > 0 ? values.get(cell) / grid.measures.get(cell) : 0
        )
      : undefined,
    source = density ? { ...grid, channels: { ...grid.channels, [channel.name]: density } } : grid,
    valueAt = fieldInterpolator(
      source,
      channel.name,
      channel.quantity === "category" || channel.discrete === true,
      undefined,
      sweepBudget(source)
    );
  const sample = (cell: number) => {
    const value = inheritedValue(
      valueAt(nativePosition(work, cell)) * (extensive ? map.mesh.area(cell) : 1),
      channel
    );
    return band.type === "int32" ? Math.round(value) : value;
  };
  if (isMutablePhysicalName(channel.name))
    for (let cell = 0; cell < map.mesh.count; cell++) map[channel.name].set(cell, sample(cell));
  else importGroundBand(map, channel.name, sample);
  if (density) grid.coverage.release(density);
}
/** Reconstructed field edges can overshoot; imported stocks/fractions retain their meaning. */
function inheritedValue(value: number, binding: PhysicalChannel) {
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
      values.set(i, work.map.Elevation.get(i));
  work.fixed.push({ binding: physicalChannels[0], values });
}
function fixedSamples(
  work: AtlasPhysicalWorkspace,
  source: Grid,
  footprint: Grid["scope"]["footprint"],
  binding: PhysicalChannel
) {
  const values = retainedArray(work.map, "float64", `authored:${binding.name}`).fill(NaN);
  const covers = spatial.pointCoverage(footprint),
    sourceCovers = spatial.pointCoverage(source.scope.footprint),
    valueAt = gridSampler(
      source,
      binding.name,
      binding.unit === "category" || binding.discrete === true
    ),
    integer = work.map[binding.name].type === "int32";
  for (let i = 0; i < values.length; i++) {
    const position = nativePosition(work, i);
    if (!covers(position) || !sourceCovers(position)) continue;
    const value = valueAt(position);
    values.set(i, integer ? Math.round(value) : value);
  }
  return values;
}
function fixedAuthoring(state: GenerationState, work: AtlasPhysicalWorkspace) {
  for (const authority of authoredFields(state.domain)) {
    if (authority.spaceId && authority.spaceId !== state.domain.scope.spaceId) continue;
    const source = authority.source;
    if (!source) throw new Error("Load authored numerical inputs before generation.");
    for (const binding of physicalChannels.filter((binding) =>
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
    footprint = fieldChartFootprint(state.surface),
    covers = spatial.pointCoverage(footprint),
    anchor = spatial.interiorPosition(footprint),
    world = state.domain.world.areas[state.domain.scope.areaId].profile === "world",
    wraps = world ? profile.MapBoundary === 1 : spansCylinder(state),
    padding = world ? profile.BoundaryPadding : childHaloCells * cellSpan;
  return createWorldMesh(
    bounds,
    ((bounds[2] - bounds[0] + 2 * padding) * (bounds[3] - bounds[1] + 2 * padding)) / cellSpan ** 2,
    padding,
    (x, y) => covers({ x, y, z: 0 }),
    spatial.area(footprint),
    [anchor.x, anchor.y],
    wraps,
    world && wraps && profile.LatitudeSouth === -90 && profile.LatitudeNorth === 90,
    state.surface.periodicWidth
  );
}
export function createAtlasWorkspace(
  state: GenerationState,
  quality: keyof typeof atlasQuality,
  parameters: Partial<AtlasParameters> = {},
  overrides: PhysicalProfileOverrides = {}
): AtlasPhysicalWorkspace {
  // A share of the map is a share of the world: a finer map of part of it works the same
  // geology and water, so its smaller working frame never shrinks a physical measure.
  const frame = spatial.bounds(state.domain.world.reference.domain),
    scale = MapScale.fromCells(frame, defaultTerrainCells);
  const profile = atlasPhysicalProfile(parameters, overrides, scale);
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
    lattice = mapLattice(state, profile, cellSpan),
    // The world's frame with this map's own cell spacing: shares resolve as the world's do,
    // and counts of cells are this map's.
    map = createField(lattice, state.cache, MapScale.fromBounds(frame, lattice.spacing));
  const work: AtlasPhysicalWorkspace = {
    map,
    profile,
    samples: state.surface.coverage.scratch("int32", "physical:samples", 0),
    grid: state.surface.coverage,
    fixed: [],
    inherited: Boolean(state.surface.channels.Elevation),
  };
  if (work.inherited) inheritNumerical(state, work);
  refreshWorkspaceSamples(state, work);
  refreshWorkspaceProtection(state, work);
  return work;
}
function spansCylinder(state: GenerationState) {
  if (state.domain.world.reference.boundaryMode !== "cylinder") return false;
  const [west, , east] = spatial.bounds(state.domain.world.reference.domain),
    [low, , high] = state.surface.bounds;
  return high - low >= east - west - 1e-6;
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
    for (let i = 0; i < values.length; i++) {
      const fixed = values.get(i);
      if (!Number.isFinite(fixed)) continue;
      const value = fixed;
      if (binding.name === "Elevation") standGround(map, i, value, "authored");
      else if (binding.name === "BedrockElevation")
        standGround(map, i, value + map.SedimentThickness.get(i), "authored");
      else if (binding.name === "RockResistance") setRockStrength(map, i, value);
      else if (binding.name === "SedimentThickness") looseTo(map, i, value, "authored");
      else if (isMutablePhysicalName(binding.name)) map[binding.name].set(i, value);
      else throw new Error(`Authored ground field ${binding.name} needs a material operation.`);
    }
  }
}
export function sampleSurfaceAtNative(
  state: GenerationState,
  name: FieldChannelName,
  i: number
): number {
  const work = state.physical!;
  return interpolateSample(state.surface, name, nativePosition(work, i));
}
export function nativeIndexAtSurface(state: GenerationState, x: number, y: number) {
  const work = state.physical!;
  return nearestTriangle(work.map.mesh, x - work.map.mesh.origin[0], y - work.map.mesh.origin[1]);
}
