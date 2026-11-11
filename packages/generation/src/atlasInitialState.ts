import {
  areaSpace,
  createGrid,
  createAdaptiveField,
  createAdaptiveTopology,
  resampleChannels,
  spatial,
  semanticId,
  requireThat,
  cloneSnapshot,
  rectangle,
  type DomainSnapshot,
  type Grid,
  type SpatialScope,
  type BlockCache,
} from "@atlas/domain";
import type { AtlasGenerationInput } from "./atlasWorkflow";
import type { GenerationState } from "./process";
import { atlasQuality } from "./world/atlasProfile";
import { regionalInputFields, regionalInputChannels, regionalResolution } from "./regionalInputs";
import { atlasGenerationModules } from "./atlasModules";

/**
 * A refinement supplies its own cell span and the
 * span of the surface that carries the inherited channels until the physical lattice exists
 * (the parent's own sample span: finer carries nothing the parent does not have).
 */
export interface InitialStateOptions {
  cellSpan?: number;
  surfaceSpan?: number;
}
export function atlasInitialState(
  source: DomainSnapshot,
  input: AtlasGenerationInput,
  cache?: BlockCache,
  options: InitialStateOptions = {}
): GenerationState {
  const domain = cloneSnapshot(source),
    area = domain.world.areas[input.areaId];
  requireThat(area, "generation_area", "Choose an existing mapped area.");
  requireThat(
    atlasQuality[input.quality as keyof typeof atlasQuality],
    "generation_quality",
    "Choose draft, standard or fine detail."
  );
  const scope: SpatialScope = {
    worldId: domain.world.id,
    areaId: area.id,
    spaceId: areaSpace(domain.world, area.id),
    footprint: area.footprint,
    crsId: domain.world.reference.id,
    revision: domain.world.version,
    time: "present",
    resolution: null,
  };
  domain.scope = scope;
  const extent = spatial.bounds(area.footprint),
    cellSpan = options.cellSpan ?? regionalResolution(source, area.id, input.quality).cellSpan;
  scope.resolution = cellSpan;
  // A child keeps the parent's boundary band; interior samples refine inside that interface.
  const band = Math.min(cellSpan, (extent[2] - extent[0]) / 4, (extent[3] - extent[1]) / 4);
  const interior =
    area.boundary && !["region", "local"].includes(area.profile)
      ? spatial.buffer(area.footprint, -band)
      : area.footprint;
  requireThat(
    interior && spatial.area(interior) > 0,
    "generation_extent",
    "Choose an extent with room for interior field samples."
  );
  const id = semanticId(domain.world.id, "surface", `${area.id}:${input.seed}`);
  const surface =
    area.profile !== "world" && area.profile !== "interior"
      ? createAdaptiveField(
          id,
          { ...scope, footprint: interior },
          initialTopology(scope, options.surfaceSpan ?? cellSpan, cache),
          cache
        )
      : createGrid(
          id,
          { ...scope, footprint: interior },
          Math.max(2, Math.ceil((extent[2] - extent[0]) / cellSpan) + 1),
          Math.max(2, Math.ceil((extent[3] - extent[1]) / cellSpan) + 1),
          undefined,
          cache
        );
  inheritSurface(source, surface, input);
  return {
    domain,
    surface,
    facts: initialFacts(surface, input),
    history: [],
    causes: [],
    publications: atlasGenerationModules.publications(input, domain.world),
  };
}
/**
 * Cells near the map's cell span. The cells halve from the extent, so they come only in
 * the extent's width over a power of two; halving until a cell is no wider than the span
 * stops anywhere down to half of it, up to four times the intended cells. The depth whose
 * cells lie nearest the span, by ratio, keeps the count within a factor of two of it.
 */
export function halvedCellWidth(widest: number, cellSpan: number) {
  return widest / 2 ** Math.max(0, Math.round(Math.log2(widest / cellSpan)));
}
function initialTopology(scope: SpatialScope, cellSpan: number, cache?: BlockCache) {
  const extent = spatial.bounds(scope.footprint),
    widest = Math.max(extent[2] - extent[0], extent[3] - extent[1]),
    // Repeated halving carries rounding; a cell within it of the chosen width is at it.
    minimumSize = halvedCellWidth(widest, cellSpan) * (1 + 1e-9);
  return createAdaptiveTopology(
    extent,
    {
      maximumSize: Math.max(minimumSize, widest / 8),
      minimumSize,
      refine: (box) => spatial.intersects(rectangle(box), scope.footprint),
    },
    cache
  );
}
function inheritSurface(source: DomainSnapshot, target: Grid, input: AtlasGenerationInput) {
  const world = source.world;
  const channels = regionalInputChannels(
    regionalInputFields(source, input.areaId, input.domains.includes("physical"))
  );
  for (const [name, grid] of channels) resampleChannels(grid, target, [name]);
  requireThat(
    input.domains.includes("physical") ||
      target.channels.Elevation ||
      world.areas[input.areaId].profile === "interior",
    "generation_prerequisite",
    "Generate physical geography first, or include it in this request."
  );
}
function initialFacts(surface: Grid, input: AtlasGenerationInput) {
  const facts = new Set(Object.keys(surface.channels));
  if (surface.channels.BedrockElevation) facts.add("geology");
  if (surface.channels.FlowTargets) facts.add("drainage");
  // A run without the physical domain reads the terrain already made instead of making it.
  if (!input.domains.includes("physical")) facts.add("terrain:present");
  return facts;
}
