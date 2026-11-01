import {
  canonicalGeometry,
  compactGeometryBounds,
  rectangle,
  regionMapFootprint,
  regionalScale,
  mapRefinementLevel,
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

/**
 * The present channels a child map reads from its pinned inputs. Physical history channels
 * stay with the world; the regional processes read what the present is and how it is
 * organized (grain, strain, reworking, volcanic construction), never an execution state.
 */
const presentChannels = new Set([
  "elevation",
  "rock",
  "fracture",
  "geothermal",
  "margin",
  "oceanDistance",
  "glacialErosion",
  "continentalFraction",
  "tectonicStrain",
  "structuralGrainX",
  "structuralGrainY",
  "volcanicConstruction",
  "canopyAge",
  "peatCarbon",
  "iceThickness",
  "ice",
  "seaDatum",
  "seaLevel",
  "temperature",
  "moisture",
  "rainfall",
  "snowfall",
  "runoff",
  "windEast",
  "windNorth",
  "soilDepth",
  "soilWater",
  "floodplain",
  "delta",
  "populationDensity",
  "populationCapacity",
  "treeCover",
  "grassCover",
  "wetlandCover",
  "soilCarbon",
  "mineralNutrients",
  "heat",
  "storedHeat",
  "quickening",
  "stillness",
  "fog",
  "verdure",
  "salting",
  "warding",
  "tearing",
  "water",
  "waterDepth",
  "waterLevel",
  "flow",
  "catchmentArea",
  "riverOrder",
  "slope",
  "sediment",
  "erosion",
  "biome",
  "naturalSurface",
  "finalSurface",
  "secondSurface",
  "physicalMaterial",
  "landform",
  "waveExposure",
  "stormTrack",
  "upwelling",
  "aquaticFauna",
  "naturalTemperature",
]);
export function refinementChannel(name: string) {
  // Published magic includes fractional classes and origin-specific material context,
  // not just intensity. These are present inputs, never a historical execution state.
  return presentChannels.has(name) || name.startsWith("magic:");
}
export function isRegionalRefinement(source: DomainSnapshot, areaId: string) {
  return !!source.world.areas[areaId]?.map;
}
/** Only pinned inputs on this map; neither live ancestors nor sibling products are candidates. */
export function refinementInputFields(source: DomainSnapshot, areaId: string, physical = true) {
  return source.world.fields.filter((f) => f.areaId === areaId && (!physical || f.input));
}
export function refinementReads(source: DomainSnapshot, areaId: string, physical = true) {
  return refinementInputFields(source, areaId, physical)
    .map((field) => ({
      fieldId: field.id,
      names: (field.channels ?? []).filter(refinementChannel),
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
export function parentSampleSpan(source: DomainSnapshot, areaId: string, physical: boolean) {
  const grids = refinementInputFields(source, areaId, physical)
    .filter((f) => f.channels?.includes("elevation") && source.numerical[f.id])
    .map((f) => source.numerical[f.id])
    .sort((a, b) => sampleSpan(b) - sampleSpan(a));
  return grids.length ? sampleSpan(grids[0]) : (source.scope.resolution ?? 0) * 4;
}

/** Use the pinned selection, so rerunning a map does not repeatedly expand its frame. */
export function refinementFootprint(source: DomainSnapshot, areaId: string, physical = true) {
  if (physical && source.world.areas[areaId].map?.extent)
    return source.world.areas[areaId].map!.extent!;
  const fields = source.world.fields.filter(
    (f) => f.areaId === areaId && f.channels?.includes("elevation")
  );
  return (
    fields.find((f) => f.input === physical && f.footprint)?.footprint ??
    source.world.areas[areaId].footprint
  );
}
/** A region crossing the cylindrical seam uses one short, continuous local chart. */
export function compactBounds(source: DomainSnapshot, footprint: Geometry): Bounds {
  return compactGeometryBounds(source.world.reference, footprint);
}
export function refinementFrame(source: DomainSnapshot, areaId: string, physical: boolean) {
  const input = refinementFootprint(source, areaId, physical),
    frame =
      physical && !source.world.areas[areaId].map?.extent
        ? regionMapFootprint(source.world, input)
        : input,
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
  const base = regionalScale(
    Math.max(1, mapRefinementLevel(source.world.areas, input.areaId)),
    input.quality
  );
  const bounds = compactBounds(source, refinementFootprint(source, input.areaId));
  const cellSpan = Math.min(
    base.cellSpan,
    Math.min(bounds[2] - bounds[0], bounds[3] - bounds[1]) / 8
  );
  const cells =
    (Math.ceil((bounds[2] - bounds[0]) / cellSpan) + 1) *
    (Math.ceil((bounds[3] - bounds[1]) / cellSpan) + 1);
  return { cellSpan, cellArea: cellSpan ** 2, cellAreaKm2: cellSpan ** 2 / 1e6, cells };
}

/**
 * The initial generation state of a refinement: the generator's own child surface over this
 * map's frame at the refinement cell span, with the pinned present channels inherited onto
 * it. The physical field is built from it by `canonry.initialize`, like any other run.
 */
export function regionalInitialState(
  source: DomainSnapshot,
  input: AtlasGenerationInput,
  cache?: BlockCache
): GenerationState {
  const area = source.world.areas[input.areaId],
    physical = input.domains.includes("physical"),
    { cellSpan } = refinementResolution(source, input),
    { footprint } = refinementFrame(source, area.id, physical),
    framed: DomainSnapshot = {
      ...source,
      world: {
        ...source.world,
        areas: { ...source.world.areas, [area.id]: { ...area, footprint } },
      },
    };
  return atlasInitialState(framed, input, cache, {
    cellSpan,
    channels: refinementChannel,
    surfaceSpan: Math.max(cellSpan, parentSampleSpan(source, area.id, physical)),
  });
}
