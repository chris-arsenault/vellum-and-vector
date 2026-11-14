import {
  gridCellBounds,
  gridPosition,
  rectangle,
  spatial,
  polygonGeometry,
  chartFootprint,
  canonicalGeometry,
  canonicalPosition,
  type GridSurface,
} from "@atlas/domain";
import type { MapLayer, MapSample, SampleAttribute } from "@atlas/map";
import type { World } from "./types";
import { mapInspectionSections } from "./mapInspectionSections";

export interface SampleBinding {
  channel: string;
  layer: MapLayer;
  bandId: string;
}

/** Stored cell facts are published once; the viewer does not reconstruct generation columns. */
export function* mapSampleRecords(
  world: World,
  grid: GridSurface<string>,
  bindings: SampleBinding[]
): Generator<MapSample> {
  const clip = spatial.intersectionWith(
    chartFootprint(grid.scope.footprint, grid.bounds, grid.periodicWidth)
  );
  const channels = new Set(bindings.map((binding) => binding.channel));
  for (let index = 0; index < grid.active.length; index++) {
    const bounds = gridCellBounds(grid, index);
    const footprint = polygonGeometry(clip(rectangle(bounds)));
    if (!footprint) continue;
    const position = gridPosition(grid, index);
    const global = grid.scope.spaceId === world.id;
    const center = global ? canonicalPosition(world.reference, position) : position;
    const read = (channel: string) => grid.channels[channel]?.get(index) ?? 0;
    const measure = grid.measures.get(index);
    yield {
      id: `cell:${index}`,
      spaceId: grid.scope.spaceId,
      footprint: (global
        ? canonicalGeometry(world.reference, footprint)
        : footprint) as MapSample["footprint"],
      window: {
        bounds,
        closedEast: bounds[2] === grid.bounds[2],
        closedNorth: bounds[3] === grid.bounds[3],
      },
      cellSpan: Math.min(bounds[2] - bounds[0], bounds[3] - bounds[1]),
      center: [center.x, center.y, center.z],
      measure,
      active: Boolean(grid.active.get(index)),
      attributes: bindings.map((binding) => sampleAttribute(grid, index, binding)),
      sections: mapInspectionSections(world, read, channels, measure).map((section) => ({
        ...section,
        id: `cell:${index}:${section.id}`,
      })),
    };
  }
}
function sampleAttribute(
  grid: GridSurface<string>,
  index: number,
  binding: SampleBinding
): SampleAttribute {
  const { channel, layer, bandId } = binding;
  const source = layer.source;
  if (source.kind === "vector") throw new Error("A sample cannot bind to vector geometry.");
  const band = source.data.bands.find((band) => band.id === bandId);
  const values = grid.channels[channel];
  if (!band || !values || grid.units[channel] !== band.unit)
    throw new Error(`Published sample ${channel} requires its matching band and unit.`);
  const value = values.get(index);
  return {
    layerId: layer.id,
    bandId,
    value: Number.isFinite(value) ? value : null,
    unit: band.unit,
    label: band.name,
    display: band.display,
    category: band.categories.find((entry) => entry.value === value)?.label ?? null,
  };
}
