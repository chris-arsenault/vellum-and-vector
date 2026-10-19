import type { Geometry } from "geojson";
import type { AdaptiveField } from "./adaptiveField";
import { adaptiveCell } from "./adaptiveTopology";
import { reconstructAdaptive, sampleAdaptive } from "./adaptiveReconstruction";
import { adaptivePolynomial } from "./adaptiveHermite";
import { visitAdaptiveOverlap } from "./adaptiveTransfer";
import { geometryParts } from "./composition";
import { rectangle, spatial, type Bounds } from "./spatial";

type Piece = { box: Bounds; region: Geometry; i: number };
function bernstein(v: number[]) {
  const a = 256 * v[1] - 81 * v[0] - v[4],
    b = 16 * v[2] - v[0] - v[4],
    c = 256 * v[3] - v[0] - 81 * v[4];
  const sum = (a + c - 18 * b) / 48,
    difference = (a - c) / 96;
  return [v[0], (sum + difference) / 2, (b - 4 * sum) / 6, (sum - difference) / 2, v[4]];
}
function interval(
  field: AdaptiveField,
  patches: Float64Array,
  values: Float64Array,
  piece: Piece
): [number, number] {
  const c = patches.subarray(piece.i * 16, piece.i * 16 + 16),
    center = values[piece.i];
  const b = adaptiveCell(field.topology, piece.i),
    p = piece.box;
  const controls = Array.from({ length: 5 }, (_, y) =>
    bernstein(
      Array.from({ length: 5 }, (_, x) =>
        adaptivePolynomial(
          c,
          center,
          (p[0] + ((p[2] - p[0]) * x) / 4 - b[0]) / (b[2] - b[0]),
          (p[1] + ((p[3] - p[1]) * y) / 4 - b[1]) / (b[3] - b[1])
        )
      )
    )
  );
  for (let x = 0; x < 5; x++) {
    const column = bernstein(controls.map((row) => row[x]));
    for (let y = 0; y < 5; y++) controls[y][x] = column[y];
  }
  const valuesAtCorners = [c[0], c[4], c[8], c[12]];
  return [
    Math.max(Math.min(center, ...valuesAtCorners), Math.min(...controls.flat())),
    Math.min(Math.max(center, ...valuesAtCorners), Math.max(...controls.flat())),
  ];
}
function positions(geometry: Geometry): number[][] {
  return geometryParts(geometry).flatMap((g) => {
    if (g.type === "Polygon") return g.coordinates.flat();
    if (g.type === "LineString") return g.coordinates;
    if (g.type === "Point") return [g.coordinates];
    return [];
  });
}
function split(piece: Piece): Piece[] {
  const [x0, y0, x1, y1] = piece.box,
    x = (x0 + x1) / 2,
    y = (y0 + y1) / 2;
  return [
    [x0, y0, x, y],
    [x, y0, x1, y],
    [x0, y, x, y1],
    [x, y, x1, y1],
  ].flatMap((box) => {
    const region = spatial.intersection(piece.region, rectangle(box as Bounds));
    return region ? [{ i: piece.i, box: box as Bounds, region }] : [];
  });
}
/** Bound the same reconstructed polynomial, including extrema inside clipped cells. */
export function adaptiveExtrema(
  field: AdaptiveField,
  channel: string,
  region: Geometry
): [number, number] | null {
  const values = field.channels[channel],
    surface = reconstructAdaptive(field.topology, values);
  const discrete =
    ["category", "cell-index"].includes(field.units[channel]) ||
    ["category", "extensive"].includes(field.quantities?.[channel] ?? "");
  let low = Infinity,
    high = -Infinity;
  const pending: Piece[] = [];
  visitAdaptiveOverlap(field.topology, spatial.bounds(region), (i) => {
    const box = adaptiveCell(field.topology, i),
      shape = rectangle(box);
    if (!spatial.intersects(region, shape)) return;
    if (discrete) {
      low = Math.min(low, values[i]);
      high = Math.max(high, values[i]);
      return;
    }
    if (spatial.covers(region, shape)) {
      const c = surface.corners.subarray(i * 4, i * 4 + 4);
      low = Math.min(low, values[i], ...c);
      high = Math.max(high, values[i], ...c);
    } else {
      const clipped = spatial.intersection(region, shape);
      if (clipped) pending.push({ i, box, region: clipped });
    }
  });
  while (pending.length) {
    const piece = pending.pop()!,
      b = piece.box;
    const points = positions(piece.region),
      middle = { x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2, z: 0 };
    if (spatial.pointCoverage(piece.region)(middle)) points.push([middle.x, middle.y]);
    for (const [x, y] of points) {
      const value = sampleAdaptive(surface, x, y);
      low = Math.min(low, value);
      high = Math.max(high, value);
    }
    const [minimum, maximum] = interval(field, surface.patches, values, piece);
    if (minimum >= low - spatial.precision && maximum <= high + spatial.precision) continue;
    if (Math.max(b[2] - b[0], b[3] - b[1]) <= spatial.precision) {
      low = Math.min(low, minimum);
      high = Math.max(high, maximum);
    } else pending.push(...split(piece));
  }
  return low === Infinity ? null : [low, high];
}
