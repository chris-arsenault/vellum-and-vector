import {
  canonicalGeometry,
  compactGeometryBounds,
  rectangle,
  regionMapFootprint,
  regionalScale,
  mapRefinementLevel,
  MapScale,
  defaultTerrainCells,
  spatial,
  type DomainSnapshot,
  type BlockCache,
  type Bounds,
  type Grid,
} from "@atlas/domain";
import type { Geometry } from "geojson";
import type { AtlasGenerationInput } from "../atlasWorkflow";
import { atlasInitialState } from "../atlasInitialState";
import type { GenerationState } from "../process";

export function isRegionalRefinement(source: DomainSnapshot, areaId: string) {
  return !!source.world.areas[areaId]?.map;
}
/** Only pinned inputs on this map; neither live ancestors nor sibling products are candidates. */
export function refinementInputFields(source: DomainSnapshot, areaId: string) {
  return source.world.fields.filter((f) => f.areaId === areaId && f.input);
}
/** Material written at the captured present follows that run's completed epochs. */
export function capturedEpochCount(source: DomainSnapshot, areaId: string) {
  const field = refinementInputFields(source, areaId).find((f) =>
    f.channels?.includes("Elevation")
  );
  return (
    source.world.generations.find((run) => run.id === field?.source.id)?.physicalEpochs?.length ?? 0
  );
}
export function refinementReads(source: DomainSnapshot, areaId: string) {
  // Publication owners already selected these durable facts. Capture their resource mapping
  // as a whole; a second channel list would silently drop newly supported retained inputs.
  return refinementInputFields(source, areaId)
    .map((field) => ({
      fieldId: field.id,
      names: [...(field.channels ?? [])],
    }))
    .filter((field) => field.names.length);
}
/** A grid's actual sample spacing from its geometry; the declared resolution only where it has none. */
export function sampleSpan(grid: Grid) {
  const [w, s, e, n] = grid.bounds;
  if (grid.topology) return Math.sqrt(((e - w) * (n - s)) / grid.active.length);
  if (grid.width > 1 && grid.height > 1)
    return Math.max((e - w) / (grid.width - 1), (n - s) / (grid.height - 1));
  return grid.scope.resolution ?? 0;
}
/** The pinned parent's sample span: the scale of the captured macro character. */
export function parentSampleSpan(source: DomainSnapshot, areaId: string) {
  const grids = refinementInputFields(source, areaId)
    .filter((f) => f.channels?.includes("Elevation") && source.numerical[f.id])
    .map((f) => source.numerical[f.id])
    .sort((a, b) => sampleSpan(b) - sampleSpan(a));
  return grids.length ? sampleSpan(grids[0]) : (source.scope.resolution ?? 0) * 4;
}

/** Use the pinned selection, so rerunning a map does not repeatedly expand its frame. */
export function refinementFootprint(source: DomainSnapshot, areaId: string) {
  if (source.world.areas[areaId].map?.extent) return source.world.areas[areaId].map!.extent!;
  const fields = source.world.fields.filter(
    (f) => f.areaId === areaId && f.channels?.includes("Elevation")
  );
  return (
    fields.find((f) => f.input && f.footprint)?.footprint ?? source.world.areas[areaId].footprint
  );
}
/** A region crossing the cylindrical seam uses one short, continuous local chart. */
export function compactBounds(source: DomainSnapshot, footprint: Geometry): Bounds {
  return compactGeometryBounds(source.world.reference, footprint);
}
export function refinementFrame(source: DomainSnapshot, areaId: string) {
  const input = refinementFootprint(source, areaId),
    frame = source.world.areas[areaId].map?.extent
      ? input
      : regionMapFootprint(source.world, input),
    bounds = compactBounds(source, frame);
  const reference = source.world.reference,
    [w, s, e, n] = spatial.bounds(reference.domain);
  bounds[1] = Math.max(s, bounds[1]);
  bounds[3] = Math.min(n, bounds[3]);
  if (reference.boundaryMode !== "cylinder") {
    bounds[0] = Math.max(w, bounds[0]);
    bounds[2] = Math.min(e, bounds[2]);
  } else if (bounds[2] - bounds[0] >= e - w) {
    bounds[0] = w;
    bounds[2] = e;
  }
  return { bounds, footprint: canonicalGeometry(reference, rectangle(bounds)) };
}

export function refinementResolution(
  source: DomainSnapshot,
  input: Pick<AtlasGenerationInput, "areaId" | "quality">
) {
  const bounds = compactBounds(source, refinementFootprint(source, input.areaId)),
    scale = MapScale.fromCells(bounds, defaultTerrainCells),
    base = regionalScale(
      Math.max(1, mapRefinementLevel(source.world.areas, input.areaId)),
      input.quality,
      scale
    );
  const { cellSpan } = base;
  const cells =
    (Math.ceil((bounds[2] - bounds[0]) / cellSpan) + 1) *
    (Math.ceil((bounds[3] - bounds[1]) / cellSpan) + 1);
  return { ...base, cells };
}

/**
 * The initial generation state of a refinement: the generator's own child surface over this
 * map's frame at the refinement cell span, with the pinned present channels inherited onto
 * it. The physical field is built from it by `atlas.initialize`, like any other run.
 */
export function regionalInitialState(
  source: DomainSnapshot,
  input: AtlasGenerationInput,
  cache?: BlockCache
): GenerationState {
  const area = source.world.areas[input.areaId],
    { cellSpan } = refinementResolution(source, input),
    { footprint } = refinementFrame(source, area.id),
    framed: DomainSnapshot = {
      ...source,
      world: {
        ...source.world,
        areas: { ...source.world.areas, [area.id]: { ...area, footprint } },
      },
    };
  return atlasInitialState(framed, input, cache, {
    cellSpan,
    // The display surface is sampled at this map's own cell span, the lattice's span.
    surfaceSpan: cellSpan,
  });
}
