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
  type NumericalAllocator,
} from "@atlas/domain";
import type { AtlasGenerationInput } from "./atlasWorkflow";
import type { GenerationState } from "./process";
import { atlasQuality } from "./canonry/atlasProfile";
import { regionalInputFields, regionalInputChannels, regionalResolution } from "./regionalInputs";
import { atlasGenerationModules } from "./atlasModules";

export function atlasInitialState(
  source: DomainSnapshot,
  input: AtlasGenerationInput,
  numerical?: NumericalAllocator
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
    { cellSpan } = regionalResolution(source, area.id, input.quality);
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
          initialTopology(scope, cellSpan, numerical),
          numerical
        )
      : createGrid(
          id,
          { ...scope, footprint: interior },
          Math.max(2, Math.ceil((extent[2] - extent[0]) / cellSpan) + 1),
          Math.max(2, Math.ceil((extent[3] - extent[1]) / cellSpan) + 1),
          undefined,
          numerical
        );
  inheritSurface(source, surface, input, numerical);
  return {
    numerical,
    domain,
    surface,
    facts: initialFacts(surface),
    history: [],
    causes: [],
    publications: atlasGenerationModules.publications(input, domain.world),
  };
}
function initialTopology(scope: SpatialScope, cellSpan: number, numerical?: NumericalAllocator) {
  const extent = spatial.bounds(scope.footprint);
  return createAdaptiveTopology(
    extent,
    {
      maximumSize: Math.max(cellSpan, Math.max(extent[2] - extent[0], extent[3] - extent[1]) / 8),
      minimumSize: cellSpan,
      refine: (box) => spatial.intersects(rectangle(box), scope.footprint),
    },
    numerical
  );
}
function inheritSurface(
  source: DomainSnapshot,
  target: Grid,
  input: AtlasGenerationInput,
  numerical?: NumericalAllocator
) {
  const world = source.world;
  const channels = regionalInputChannels(
    regionalInputFields(source, input.areaId, input.domains.includes("physical"))
  );
  for (const [name, grid] of channels) resampleChannels(grid, target, [name], numerical);
  requireThat(
    input.domains.includes("physical") ||
      target.channels.elevation ||
      world.areas[input.areaId].profile === "interior",
    "generation_prerequisite",
    "Generate physical geography first, or include it in this request."
  );
}
function initialFacts(surface: Grid) {
  const facts = new Set(Object.keys(surface.channels));
  if (surface.channels.bedrock) facts.add("geology");
  if (surface.channels.receiver) facts.add("drainage");
  return facts;
}
