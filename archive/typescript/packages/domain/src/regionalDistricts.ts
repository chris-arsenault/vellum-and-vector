import type { Geometry } from "geojson";
import type { Position } from "./model";
import { Spatial, spatial, rectangle } from "./spatial";
import { polygonGeometry } from "./regionGeometry";

const oversizedRegionRatio = 1.8;
const settlementAttraction = 0.25;

/** Roughly spaced geographic centres, clipped to the shore; no equal-area solve. */
export function regionalDistricts(
  shape: Geometry,
  targetArea: number,
  anchors: Position[] = [],
  precision = spatial.precision
): Geometry[] {
  const gis = new Spatial(precision),
    bounds = gis.bounds(shape),
    width = bounds[2] - bounds[0],
    height = bounds[3] - bounds[1];
  if (
    width * height < targetArea * oversizedRegionRatio &&
    Math.max(width, height) < Math.sqrt(targetArea) * oversizedRegionRatio
  )
    return [];
  const inside = gis.pointCoverage(shape),
    seeds = districtCentres(shape, bounds, targetArea, anchors.filter(inside), inside, gis);
  if (!seeds.length) seeds.push(gis.interiorPosition(shape));
  const clip = gis.intersectionWith(shape);
  return gis.voronoiCells(seeds, bounds).flatMap((cell) => {
    const geometry = cell && polygonGeometry(clip(cell));
    return geometry ? [geometry] : [];
  });
}

function districtCentres(
  shape: Geometry,
  [w, s, e, n]: ReturnType<Spatial["bounds"]>,
  targetArea: number,
  anchors: Position[],
  inside: (p: Position) => boolean,
  gis: Spatial
) {
  const spacing = Math.sqrt(targetArea),
    columns = Math.max(1, Math.round((e - w) / spacing)),
    rows = Math.max(1, Math.round((n - s) / spacing)),
    seeds: Position[] = [],
    clip = gis.intersectionWith(shape);
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < columns; x++) {
      let centre = {
        x: w + ((x + 0.5) * (e - w)) / columns,
        y: s + ((y + 0.5) * (n - s)) / rows,
        z: 0,
      };
      if (!inside(centre)) {
        const patch = polygonGeometry(
          clip(
            rectangle([
              w + (x * (e - w)) / columns,
              s + (y * (n - s)) / rows,
              w + ((x + 1) * (e - w)) / columns,
              s + ((y + 1) * (n - s)) / rows,
            ])
          )
        );
        if (!patch || gis.area(patch) === 0) continue;
        centre = gis.interiorPosition(patch);
      }
      let nearest = centre,
        distance = (spacing * settlementAttraction) ** 2;
      for (const anchor of anchors) {
        const d = (anchor.x - centre.x) ** 2 + (anchor.y - centre.y) ** 2;
        if (d < distance) {
          nearest = anchor;
          distance = d;
        }
      }
      seeds.push(nearest);
    }
  return seeds;
}
