import type { Position } from "./model";

/** Final nodal values on narrow quadrilateral elements, in the field's CRS. */
export interface SampledDetail {
  positions: Float64Array;
  elements: Uint32Array;
  channels: Record<string, Float64Array>;
}
export function selectSampledDetail(detail: SampledDetail | undefined, channels: string[]) {
  if (!detail) return;
  const names = channels.filter((name) => detail.channels[name]);
  if (channels.includes("slope") && detail.channels.elevation) names.push("elevation");
  if (!names.length) return;
  return {
    positions: detail.positions,
    elements: detail.elements,
    channels: Object.fromEntries(names.map((name) => [name, detail.channels[name]])),
  };
}
type Element = { at: number; bounds: number[] };
type Index = Map<number, Map<string, Element[]>>;
const indexes = new WeakMap<Float64Array, Index>();
type Located = { at: number; corners: number[]; weights: number[] };
const locations = new WeakMap<Float64Array, { x: number; y: number; found: Located | null }>();
const key = (x: number, y: number) => `${x}:${y}`;

function detailIndex(detail: SampledDetail) {
  const previous = indexes.get(detail.positions);
  if (previous) return previous;
  const levels: Index = new Map();
  for (let at = 0; at < detail.elements.length; at += 4) {
    const p = detail.positions,
      a = detail.elements[at] * 2,
      b = detail.elements[at + 1] * 2,
      c = detail.elements[at + 2] * 2,
      d = detail.elements[at + 3] * 2,
      bounds = [
        Math.min(p[a], p[b], p[c], p[d]),
        Math.min(p[a + 1], p[b + 1], p[c + 1], p[d + 1]),
        Math.max(p[a], p[b], p[c], p[d]),
        Math.max(p[a + 1], p[b + 1], p[c + 1], p[d + 1]),
      ],
      size = 2 ** Math.ceil(Math.log2(Math.max(1, bounds[2] - bounds[0], bounds[3] - bounds[1]))),
      bins = levels.get(size) ?? new Map<string, Element[]>();
    levels.set(size, bins);
    for (let x = Math.floor(bounds[0] / size); x <= Math.floor(bounds[2] / size); x++)
      for (let y = Math.floor(bounds[1] / size); y <= Math.floor(bounds[3] / size); y++) {
        const id = key(x, y),
          entries = bins.get(id) ?? [];
        entries.push({ at, bounds });
        bins.set(id, entries);
      }
  }
  indexes.set(detail.positions, levels);
  return levels;
}
function triangle(detail: SampledDetail, at: number, corners: number[], p: Position) {
  const position = (i: number, axis: number) =>
      detail.positions[detail.elements[at + corners[i]] * 2 + axis],
    ax = position(0, 0),
    ay = position(0, 1),
    bx = position(1, 0) - ax,
    by = position(1, 1) - ay,
    cx = position(2, 0) - ax,
    cy = position(2, 1) - ay,
    determinant = bx * cy - by * cx;
  if (!determinant) return null;
  const x = p.x - ax,
    y = p.y - ay,
    b = (x * cy - y * cx) / determinant,
    c = (bx * y - by * x) / determinant,
    a = 1 - b - c;
  return Math.min(a, b, c) >= -1e-9 ? [a, b, c] : null;
}

/** One element lookup and interpolation; no shaping operations or old terrain. */
export function sampledDetailReader(detail: SampledDetail, channel: string, discrete = false) {
  detailIndex(detail);
  return (p: Position): number | null => {
    const previous = locations.get(detail.positions);
    const found = previous?.x === p.x && previous.y === p.y ? previous.found : locate(detail, p);
    locations.set(detail.positions, { x: p.x, y: p.y, found });
    if (!found) return null;
    return readElement(detail, channel, found, discrete);
  };
}
function locate(detail: SampledDetail, p: Position) {
  let result: Located | null = null,
    smallest = Infinity;
  for (const [size, bins] of detailIndex(detail))
    for (const { at, bounds: b } of bins.get(key(Math.floor(p.x / size), Math.floor(p.y / size))) ??
      []) {
      if (!inside(b, p)) continue;
      for (const corners of [
        [0, 1, 2],
        [0, 2, 3],
      ]) {
        const weights = triangle(detail, at, corners, p);
        if (!weights) continue;
        const area = elementArea(detail, at, corners);
        if (area >= smallest) continue;
        smallest = area;
        result = { at, corners, weights };
      }
    }
  return result;
}
function inside(b: number[], p: Position) {
  return p.x >= b[0] && p.y >= b[1] && p.x <= b[2] && p.y <= b[3];
}
function readElement(detail: SampledDetail, channel: string, found: Located, discrete: boolean) {
  const { at, corners, weights } = found;
  if (channel === "slope" && !detail.channels.slope) return elementSlope(detail, found);
  const values = detail.channels[channel];
  if (discrete) return values[detail.elements[at + corners[weights.indexOf(Math.max(...weights))]]];
  return weights.reduce(
    (sum, weight, i) => sum + weight * values[detail.elements[at + corners[i]]],
    0
  );
}
function elementSlope(detail: SampledDetail, { at, corners }: Located) {
  const x = (i: number) => detail.positions[detail.elements[at + corners[i]] * 2],
    y = (i: number) => detail.positions[detail.elements[at + corners[i]] * 2 + 1],
    h = (i: number) => detail.channels.elevation[detail.elements[at + corners[i]]],
    bx = x(1) - x(0),
    by = y(1) - y(0),
    cx = x(2) - x(0),
    cy = y(2) - y(0),
    dh1 = h(1) - h(0),
    dh2 = h(2) - h(0),
    determinant = bx * cy - by * cx;
  return Math.hypot((dh1 * cy - dh2 * by) / determinant, (dh2 * bx - dh1 * cx) / determinant);
}
function elementArea(detail: SampledDetail, at: number, corners: number[]) {
  const x = (i: number) => detail.positions[detail.elements[at + corners[i]] * 2],
    y = (i: number) => detail.positions[detail.elements[at + corners[i]] * 2 + 1];
  return Math.abs((x(1) - x(0)) * (y(2) - y(0)) - (y(1) - y(0)) * (x(2) - x(0)));
}
