import type { Geometry } from "geojson";
import type { Position } from "./model";
import { Spatial, spatial } from "./spatial";
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
    area = gis.area(shape);
  if (area < targetArea * oversizedRegionRatio) return [];
  const bounds = gis.bounds(shape),
    inside = gis.pointCoverage(shape),
    seeds = districtCentres(bounds, targetArea, anchors.filter(inside), inside);
  if (!seeds.length) seeds.push(gis.interiorPosition(shape));
  const clip = gis.intersectionWith(shape);
  return gis.voronoiCells(seeds, bounds).flatMap((cell) => {
    const geometry = cell && polygonGeometry(clip(cell));
    return geometry ? [geometry] : [];
  });
}

function districtCentres(
  [w, s, e, n]: ReturnType<Spatial["bounds"]>,
  targetArea: number,
  anchors: Position[],
  inside: (p: Position) => boolean
) {
  const spacing = Math.sqrt(targetArea),
    columns = Math.max(1, Math.round((e - w) / spacing)),
    rows = Math.max(1, Math.round((n - s) / spacing)),
    seeds: Position[] = [];
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < columns; x++) {
      const centre = {
        x: w + ((x + 0.5) * (e - w)) / columns,
        y: s + ((y + 0.5) * (n - s)) / rows,
        z: 0,
      };
      if (!inside(centre)) continue;
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
