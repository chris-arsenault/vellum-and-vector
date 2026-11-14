import { adaptiveCell, rectangle, spatial, type Bounds } from "@atlas/domain";
import type { Geometry } from "geojson";
import { generationFeatures } from "./generationFeatures";
import type { GenerationState } from "./process";
import { clipGeographicArea } from "./world/geographicContours";

/**
 * Shapes of land read from the map's samples: the samples that belong are dissolved into one
 * shape, and the map's own water stays the authority on where land ends.
 */
const oceanMasks = new WeakMap<Geometry, (geometry: Geometry) => Geometry | null>();
function excludeOcean(shape: Geometry, ocean: Geometry) {
  let mask = oceanMasks.get(ocean);
  if (!mask) {
    mask = spatial.differenceFrom(ocean);
    oceanMasks.set(ocean, mask);
  }
  return mask(shape);
}
/** The box of ground one sample stands for. */
function sampleBox(state: GenerationState, i: number): Bounds {
  const grid = state.surface;
  if (grid.topology) return adaptiveCell(grid.topology, i);
  const [w, s, e, n] = grid.bounds,
    x = i % grid.width,
    y = Math.floor(i / grid.width);
  const dx = (e - w) / (grid.width - 1),
    dy = (n - s) / (grid.height - 1);
  return [
    Math.max(w, w + (x - 0.5) * dx),
    Math.max(s, s + (y - 0.5) * dy),
    Math.min(e, w + (x + 0.5) * dx),
    Math.min(n, s + (y + 0.5) * dy),
  ];
}
function clipWater(state: GenerationState, strips: Geometry[]) {
  if (!strips.length) return null;
  const grid = state.surface;
  let shape = clipGeographicArea(state, spatial.unionAll(strips));
  if (shape && grid.ocean) shape = excludeOcean(shape, grid.ocean);
  for (const lake of generationFeatures(state, { kind: "lake", areaId: grid.scope.areaId }))
    if (shape && spatial.intersects(shape, lake.geometry))
      shape = spatial.difference(shape, lake.geometry);
  return shape;
}
/** The land of the map's samples that belong, dissolved into one shape with water cut out. */
export function shapeOfSamples(
  state: GenerationState,
  belongs: (sample: number) => boolean
): Geometry | null {
  const rows = new Map<string, Bounds[]>();
  for (let i = 0; i < state.surface.active.length; i++) {
    if (!belongs(i)) continue;
    const bounds = sampleBox(state, i);
    const key = `${bounds[1]}:${bounds[3]}`;
    const row = rows.get(key) ?? [];
    row.push(bounds);
    rows.set(key, row);
  }
  const strips: Geometry[] = [];
  for (const row of rows.values()) {
    row.sort((a, b) => a[0] - b[0]);
    let box = [...row[0]] as Bounds;
    for (const next of row.slice(1)) {
      if (Math.abs(box[2] - next[0]) < 1e-6) box[2] = next[2];
      else {
        strips.push(rectangle(box));
        box = [...next];
      }
    }
    strips.push(rectangle(box));
  }
  return clipWater(state, strips);
}
