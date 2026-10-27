import { spatial, type NumericalVector } from "@atlas/domain";
import type { Geometry, Polygon } from "geojson";
import type { GenerationState } from "../process";
import { generatedFeature, putGenerated } from "../mapFeatures";
import { combinedContour, areaGeometry } from "./geographicContours";
import { marineRegions, type MarineRegion } from "./marineRegions";
import { metricSearch } from "./metricSearch";
import { units } from "./math";
import { NumericalList } from "./numericalList";
import { workingValues, releaseWorking } from "./physicalNumerics";

function polygons(shape: Geometry): Polygon[] {
  if (shape.type === "Polygon") return [shape];
  if (shape.type === "MultiPolygon")
    return shape.coordinates.map((coordinates) => ({ type: "Polygon", coordinates }));
  if (shape.type === "GeometryCollection") return shape.geometries.flatMap(polygons);
  return [];
}
/** Extend labels onto land for interpolation; the authoritative sea clips every named extent. */
function extendedLabels(state: GenerationState, labels: NumericalVector) {
  const map = state.physical!.map,
    mesh = map.mesh,
    extended = labels.slice(),
    distance = workingValues(map, "float64", "marine-extension-distance", (i) =>
      labels[i] < 0 ? Infinity : 0
    );
  function* seeds() {
    for (let i = 0; i < labels.length; i++) if (labels[i] >= 0) yield i;
  }
  metricSearch(
    mesh,
    seeds(),
    distance,
    Infinity,
    (target, source) => {
      extended[target] = extended[source];
    },
    map.numerical
  );
  releaseWorking(map, distance);
  return extended;
}

function regionOutline(
  state: GenerationState,
  labels: NumericalVector,
  region: MarineRegion,
  ocean: Geometry
) {
  const mesh = state.physical!.map.mesh,
    members = new NumericalList("int32", "marine-outline-members", state.numerical),
    neighbours = new Set<number>();
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] !== region.id) continue;
    members.push(i);
    for (let edge = 0; edge < mesh.degree[i]; edge++) {
      const j = mesh.neighbors[i * mesh.stride + edge];
      if (j >= 0 && labels[j] !== region.id) neighbours.add(labels[j]);
    }
  }
  const terms = [region.id, ...neighbours].map((id) => (i: number) => Number(labels[i] === id));
  const cells = members.finish();
  const contour = combinedContour(
    state,
    cells,
    terms,
    ([own, ...other]) => own - Math.max(0, ...other)
  );
  releaseWorking(state.physical!.map, cells);
  return areaGeometry(contour && spatial.intersection(contour, ocean));
}

function publishOcean(state: GenerationState, shape: Geometry, type: "ocean" | "sea") {
  const key = spatial
    .bounds(shape)
    .map((v) => v.toFixed(3))
    .join(":");
  putGenerated(
    state,
    generatedFeature(state, `ocean:${key}`, "Ocean", "ocean", "oceans", shape, {
      sourceAlgorithm: "canonry-0f62584c",
      marineType: type,
      area: spatial.area(shape),
    })
  );
}

/** Name geographic seas within connected water while retaining its existing shoreline. */
export function extractOceans(state: GenerationState) {
  const ocean = state.surface.ocean;
  if (!ocean) return;
  const work = state.physical;
  if (!work) {
    for (const shape of polygons(ocean)) publishOcean(state, shape, "ocean");
    return;
  }
  const { labels, regions } = marineRegions(work.map, units(work.profile.ShelfBreakDepth));
  for (const region of regions) releaseWorking(work.map, region.members);
  if (regions.length === 1) {
    releaseWorking(work.map, labels);
    return publishOcean(state, ocean, regions[0].type);
  }
  const extended = extendedLabels(state, labels);
  releaseWorking(work.map, labels);
  // Cut smaller seas out of the existing outline; its remainder belongs to the broadest.
  // Independent contour approximations must not leave gaps or overlapping water geography.
  regions.sort((a, b) => a.area - b.area || a.id - b.id);
  let remaining: Geometry | null = ocean;
  for (const [index, region] of regions.entries()) {
    if (!remaining) break;
    const shape =
      index === regions.length - 1 ? remaining : regionOutline(state, extended, region, remaining);
    if (!shape) continue;
    publishOcean(state, shape, region.type);
    remaining = areaGeometry(spatial.difference(remaining, shape));
  }
  releaseWorking(work.map, extended);
}
