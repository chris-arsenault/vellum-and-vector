import type { Geometry } from "geojson";
import type { AdaptiveField } from "./adaptiveField";
import { adaptiveCell, type AdaptiveTopology } from "./adaptiveTopology";
import { preparedAdaptiveInterpolator, type PreparedAdaptiveCoefficients } from "./adaptivePoint";
import type { PreparedAdaptiveCell } from "./adaptiveHermite";
import { bernsteinPatchInterval } from "./bernsteinPatch";
import { visitAdaptiveOverlap } from "./adaptiveTransfer";
import { geometryParts } from "./composition";
import { rectangle, spatial, type Bounds } from "./spatial";

type Piece = { box: Bounds; region: Geometry; i: number };
export function adaptiveInterval(
  topology: AdaptiveTopology,
  cell: PreparedAdaptiveCell,
  piece: Pick<Piece, "box" | "i">,
  positiveSupport = false
): [number, number] {
  if (cell.low === cell.high) return [cell.low, cell.high];
  const bounds = polynomialInterval(topology, cell, piece);
  if (positiveSupport && cell.low === 0) return bounds;
  const clamp = (value: number) => Math.max(cell.low, Math.min(cell.high, value));
  return [clamp(bounds[0]), clamp(bounds[1])];
}
export function adaptiveGradientInterval(
  topology: AdaptiveTopology,
  cell: PreparedAdaptiveCell,
  piece: Pick<Piece, "box" | "i">,
  axis: 0 | 1,
  positiveSupport = false
): [number, number] {
  if (cell.low === cell.high) return [0, 0];
  if (positiveSupport && cell.low === 0) return polynomialInterval(topology, cell, piece, axis);
  const value = polynomialInterval(topology, cell, piece);
  if (value[1] <= cell.low || value[0] >= cell.high || cell.low === cell.high) return [0, 0];
  const bounds = polynomialInterval(topology, cell, piece, axis);
  return value[0] < cell.low || value[1] > cell.high
    ? [Math.min(0, bounds[0]), Math.max(0, bounds[1])]
    : bounds;
}
function polynomialInterval(
  topology: AdaptiveTopology,
  cell: PreparedAdaptiveCell,
  piece: Pick<Piece, "box" | "i">,
  derivative?: 0 | 1
): [number, number] {
  const b = adaptiveCell(topology, piece.i),
    p = piece.box;
  const interval = bernsteinPatchInterval(
    cell.bernstein,
    [
      (p[0] - b[0]) / (b[2] - b[0]),
      (p[1] - b[1]) / (b[3] - b[1]),
      (p[2] - b[0]) / (b[2] - b[0]),
      (p[3] - b[1]) / (b[3] - b[1]),
    ],
    derivative
  );
  const scale = derivative === undefined ? 1 : b[derivative + 2] - b[derivative];
  return [interval[0] / scale, interval[1] / scale];
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
function discreteChannel(field: AdaptiveField, channel: string) {
  return (
    ["category", "cell-index"].includes(field.units[channel]) ||
    ["category", "extensive"].includes(field.quantities?.[channel] ?? "")
  );
}
/** Bound the same reconstructed polynomial, including extrema inside clipped cells. */
export function adaptiveExtrema(
  field: AdaptiveField,
  channel: string,
  region: Geometry
): [number, number] | null {
  const values = field.channels[channel];
  if (!discreteChannel(field, channel)) {
    const prepared = field.prepared?.adaptive?.[channel];
    if (!prepared) throw new Error(`Prepare ${channel} before reading its extrema.`);
    return preparedAdaptiveExtrema(prepared, region);
  }
  let low = Infinity,
    high = -Infinity;
  visitAdaptiveOverlap(field.topology, spatial.bounds(region), (i) => {
    const box = adaptiveCell(field.topology, i),
      shape = rectangle(box);
    if (!spatial.intersects(region, shape)) return;
    low = Math.min(low, values[i]);
    high = Math.max(high, values[i]);
  });
  return low === Infinity ? null : [low, high];
}

/** Extrema of delivered patches; no fitting or copied numerical field. */
export function preparedAdaptiveExtrema(field: PreparedAdaptiveCoefficients, region: Geometry) {
  const at = preparedAdaptiveInterpolator(field),
    pending: Piece[] = [];
  visitAdaptiveOverlap(field.topology, spatial.bounds(region), (i) => {
    const box = adaptiveCell(field.topology, i),
      clipped = spatial.intersection(region, rectangle(box));
    if (clipped) pending.push({ i, box, region: clipped });
  });
  let low = Infinity,
    high = -Infinity;
  while (pending.length) {
    const piece = pending.pop()!,
      box = piece.box;
    const points = positions(piece.region),
      center = { x: (box[0] + box[2]) / 2, y: (box[1] + box[3]) / 2, z: 0 };
    if (spatial.pointCoverage(piece.region)(center)) points.push([center.x, center.y]);
    for (const [x, y] of points) {
      const value = at(x, y);
      low = Math.min(low, value);
      high = Math.max(high, value);
    }
    const [minimum, maximum] = adaptiveInterval(field.topology, field.cells[piece.i], piece);
    if (minimum >= low - spatial.precision && maximum <= high + spatial.precision) continue;
    if (Math.max(box[2] - box[0], box[3] - box[1]) <= spatial.precision) {
      low = Math.min(low, minimum);
      high = Math.max(high, maximum);
    } else pending.push(...split(piece));
  }
  return low === Infinity ? null : ([low, high] as [number, number]);
}
