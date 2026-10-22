import type { Bounds } from "./spatial";
import { derivativeEnclosure, weightEnclosure } from "./smoothSampleBounds";
import { createSegmentReader } from "./sampleSegmentBounds";

/** Fixed numerical support in the world's metre frame, independent of display grids. */
export interface SampleSupport {
  x: Float64Array;
  y: Float64Array;
  origin: [number, number];
  spacing: number;
}
export interface ReconstructedField {
  support: SampleSupport;
  channels: Record<string, Float64Array>;
  biome?: BiomeSamples;
  categories?: Record<string, Float64Array>;
  water?: import("./waterField").WaterSamples;
}
export interface SampleEnclosure {
  range: [number, number];
  gradient: [[number, number], [number, number]];
}
type Station = { i: number; dx: number; dy: number; weight: number };
const indexes = new WeakMap<SampleSupport, ReturnType<typeof prepareIndex>>();
const queries = new WeakMap<SampleSupport, Map<boolean, (x: number, y: number) => Station[]>>();

function prepareIndex(support: SampleSupport) {
  const { x, y, spacing } = support;
  let west = Infinity,
    south = Infinity,
    east = -Infinity,
    north = -Infinity;
  for (let i = 0; i < x.length; i++) {
    west = Math.min(west, x[i]);
    south = Math.min(south, y[i]);
    east = Math.max(east, x[i]);
    north = Math.max(north, y[i]);
  }
  const width = Math.floor((east - west) / spacing) + 1;
  const height = Math.floor((north - south) / spacing) + 1;
  const bins: number[][] = Array.from({ length: width * height }, () => []);
  for (let i = 0; i < x.length; i++)
    bins[Math.floor((y[i] - south) / spacing) * width + Math.floor((x[i] - west) / spacing)].push(
      i
    );
  return { west, south, east, north, width, height, bins };
}

/** Compact cardinal weights and first-order Hermite jets give a C1 field. */
export function sampleStations(support: SampleSupport, cardinal = true) {
  const previous = queries.get(support)?.get(cardinal);
  if (previous) return previous;
  let index = indexes.get(support);
  if (!index) {
    index = prepareIndex(support);
    indexes.set(support, index);
  }
  const { west, south, east, north, width, height, bins } = index;
  const spacing = support.spacing,
    radius = 2.5 * spacing,
    radius2 = radius * radius;
  const query = (worldX: number, worldY: number): Station[] => {
    const x = Math.max(west, Math.min(east, worldX - support.origin[0]));
    const y = Math.max(south, Math.min(north, worldY - support.origin[1]));
    const left = Math.max(0, Math.floor((x - radius - west) / spacing));
    const right = Math.min(width - 1, Math.floor((x + radius - west) / spacing));
    const bottom = Math.max(0, Math.floor((y - radius - south) / spacing));
    const top = Math.min(height - 1, Math.floor((y + radius - south) / spacing));
    const result: Station[] = [];
    for (let row = bottom; row <= top; row++)
      for (let col = left; col <= right; col++)
        for (const i of bins[row * width + col]) {
          const dx = x - support.x[i],
            dy = y - support.y[i],
            r2 = dx * dx + dy * dy;
          if (cardinal && r2 < spacing * spacing * 1e-22) return [{ i, dx: 0, dy: 0, weight: 1 }];
          if (r2 < spacing * spacing * 1e-22) continue;
          if (r2 < radius2) result.push({ i, dx, dy, weight: (1 - r2 / radius2) ** 4 / r2 });
        }
    return result;
  };
  const cached = memoizeStation(query);
  const entries = queries.get(support) ?? new Map();
  entries.set(cardinal, cached);
  queries.set(support, entries);
  return cached;
}
function supportCandidates(support: SampleSupport, box: Bounds) {
  const index = indexes.get(support)!,
    radius = 2.5 * support.spacing,
    x0 = Math.max(index.west, Math.min(index.east, box[0] - support.origin[0])),
    x1 = Math.max(index.west, Math.min(index.east, box[2] - support.origin[0])),
    y0 = Math.max(index.south, Math.min(index.north, box[1] - support.origin[1])),
    y1 = Math.max(index.south, Math.min(index.north, box[3] - support.origin[1]));
  const left = Math.max(0, Math.floor((x0 - radius - index.west) / support.spacing)),
    right = Math.min(index.width - 1, Math.floor((x1 + radius - index.west) / support.spacing)),
    bottom = Math.max(0, Math.floor((y0 - radius - index.south) / support.spacing)),
    top = Math.min(index.height - 1, Math.floor((y1 + radius - index.south) / support.spacing));
  const result: number[] = [];
  for (let row = bottom; row <= top; row++)
    for (let col = left; col <= right; col++) result.push(...index.bins[row * index.width + col]);
  return result;
}
function memoizeStation(query: (x: number, y: number) => Station[]) {
  let x = NaN,
    y = NaN,
    result: Station[] = [];
  return (px: number, py: number) => {
    if (px !== x || py !== y) {
      result = query(px, py);
      x = px;
      y = py;
    }
    return result;
  };
}

function sampleSlopes(support: SampleSupport, values: ArrayLike<number>) {
  const at = sampleStations(support, false),
    count = support.x.length;
  const gx = new Float64Array(count).fill(NaN),
    gy = new Float64Array(count);
  let affine: boolean | undefined;
  const prepare = (i: number) => {
    if (Number.isFinite(gx[i])) return;
    gx[i] = 0;
    const px = support.x[i] + support.origin[0],
      py = support.y[i] + support.origin[1];
    let xx = 0,
      xy = 0,
      yy = 0,
      vx = 0,
      vy = 0;
    for (const station of at(px, py)) {
      if (station.i === i) continue;
      const dx = support.x[station.i] - support.x[i],
        dy = support.y[station.i] - support.y[i];
      const delta = values[station.i] - values[i],
        w = station.weight;
      xx += w * dx * dx;
      xy += w * dx * dy;
      yy += w * dy * dy;
      vx += w * dx * delta;
      vy += w * dy * delta;
    }
    const determinant = xx * yy - xy * xy;
    if (determinant > 1e-20) {
      gx[i] = (vx * yy - vy * xy) / determinant;
      gy[i] = (vy * xx - vx * xy) / determinant;
    }
    // An affine patch within a curved field still needs limiting: its jet can
    // otherwise extend below zero into neighboring, flat cover samples.
    affine ??= affineSamples(support, values, gx[i], gy[i], i);
    if (!affine) limitSlope(support, values, gx, gy, at, i);
  };
  return { gx, gy, prepare, affine: () => affine === true };
}

function affineSamples(
  support: SampleSupport,
  values: ArrayLike<number>,
  gx: number,
  gy: number,
  origin: number
) {
  for (let i = 0; i < values.length; i++) {
    const predicted =
      values[origin] +
      gx * (support.x[i] - support.x[origin]) +
      gy * (support.y[i] - support.y[origin]);
    const scale = Math.max(Math.abs(values[i]), Math.abs(values[origin]), Math.abs(predicted));
    if (Math.abs(predicted - values[i]) > Number.EPSILON * 64 * scale) return false;
  }
  return true;
}

/** Bound each jet over its complete support, before blending with smooth weights. */
function limitSlope(
  support: SampleSupport,
  values: ArrayLike<number>,
  gx: Float64Array,
  gy: Float64Array,
  at: ReturnType<typeof sampleStations>,
  i: number
) {
  const stations = at(support.x[i] + support.origin[0], support.y[i] + support.origin[1]);
  let low = values[i],
    high = values[i];
  for (const { i: j } of stations) {
    low = Math.min(low, values[j]);
    high = Math.max(high, values[j]);
  }
  const reach = Math.hypot(gx[i], gy[i]) * support.spacing * 2.5;
  const scale = reach > 0 ? Math.min(1, Math.min(values[i] - low, high - values[i]) / reach) : 1;
  gx[i] *= scale;
  gy[i] *= scale;
}

/** Prepare per process/input revision; geometry is cached, mutable channel values are not. */
export function smoothSampleInterpolator(
  support: SampleSupport,
  values: ArrayLike<number>,
  slopes?: (i: number) => [number, number]
) {
  const at = sampleStations(support),
    { gx, gy, prepare, affine } = slopes
      ? suppliedSlopes(values.length, slopes)
      : sampleSlopes(support, values);
  const read = (x: number, y: number) => {
    let sum = 0,
      total = 0;
    for (const { i, dx, dy, weight } of at(x, y)) {
      prepare(i);
      sum += weight * (values[i] + gx[i] * dx + gy[i] * dy);
      total += weight;
    }
    return total > 0 ? sum / total : NaN;
  };
  const enclose = (box: Bounds, candidates = supportCandidates(support, box), level?: number) => {
    const x = (box[0] + box[2]) / 2,
      y = (box[1] + box[3]) / 2;
    prepare(0);
    if (affine()) {
      const i = at(x, y)[0].i,
        index = indexes.get(support)!,
        corners = [
          read(box[0], box[1]),
          read(box[2], box[1]),
          read(box[2], box[3]),
          read(box[0], box[3]),
        ];
      prepare(i);
      return {
        range: [Math.min(...corners), Math.max(...corners)],
        gradient: [
          box[0] >= index.west + support.origin[0] && box[2] <= index.east + support.origin[0]
            ? [gx[i], gx[i]]
            : [Math.min(0, gx[i]), Math.max(0, gx[i])],
          box[1] >= index.south + support.origin[1] && box[3] <= index.north + support.origin[1]
            ? [gy[i], gy[i]]
            : [Math.min(0, gy[i]), Math.max(0, gy[i])],
        ],
      } as SampleEnclosure;
    }
    return interpolationBounds(support, values, gx, gy, prepare, read, box, candidates, level);
  };
  const jet = (i: number): [number, number] => {
    prepare(i);
    return [gx[i], gy[i]];
  };
  return Object.assign(read, {
    sourceValues: values,
    jet,
    enclose,
    segment: createSegmentReader(
      support,
      values,
      jet,
      read,
      enclose,
      worldSupportBounds(support),
      (box) => supportCandidates(support, box)
    ),
    bounds: (box: Bounds, candidates?: number[]) => enclose(box, candidates).range,
  });
}
function worldSupportBounds(support: SampleSupport): Bounds {
  const index = indexes.get(support)!;
  return [
    index.west + support.origin[0],
    index.south + support.origin[1],
    index.east + support.origin[0],
    index.north + support.origin[1],
  ];
}
function suppliedSlopes(count: number, at: (i: number) => [number, number]) {
  const gx = new Float64Array(count).fill(NaN),
    gy = new Float64Array(count);
  return {
    gx,
    gy,
    affine: () => false,
    prepare: (i: number) => {
      if (!Number.isFinite(gx[i])) [gx[i], gy[i]] = at(i);
    },
  };
}

/** Interval enclosure of the same weighted jets, tightened by subdividing the query box. */
function interpolationBounds(
  support: SampleSupport,
  values: ArrayLike<number>,
  gx: Float64Array,
  gy: Float64Array,
  prepare: (i: number) => void,
  read: (x: number, y: number) => number,
  box: Bounds,
  candidates: number[],
  level?: number
): SampleEnclosure {
  const index = indexes.get(support)!,
    clampX = (x: number) => Math.max(index.west, Math.min(index.east, x - support.origin[0])),
    clampY = (y: number) => Math.max(index.south, Math.min(index.north, y - support.origin[1])),
    x0 = clampX(box[0]),
    y0 = clampY(box[1]),
    x1 = clampX(box[2]),
    y1 = clampY(box[3]),
    radius2 = (support.spacing * 2.5) ** 2;
  const weight = (r2: number) =>
    r2 >= radius2 ? 0 : r2 === 0 ? Infinity : (1 - r2 / radius2) ** 4 / r2;
  const terms = candidates.flatMap((i) => {
    const dx0 = x0 - support.x[i],
      dx1 = x1 - support.x[i],
      dy0 = y0 - support.y[i],
      dy1 = y1 - support.y[i];
    const near = Math.max(0, dx0, -dx1) ** 2 + Math.max(0, dy0, -dy1) ** 2;
    if (near >= radius2) return [];
    prepare(i);
    const far = Math.max(dx0 * dx0, dx1 * dx1) + Math.max(dy0 * dy0, dy1 * dy1);
    const xs = [gx[i] * dx0, gx[i] * dx1],
      ys = [gy[i] * dy0, gy[i] * dy1];
    return [
      {
        low: values[i] + Math.min(...xs) + Math.min(...ys),
        high: values[i] + Math.max(...xs) + Math.max(...ys),
        weightLow: weight(far),
        weightHigh: weight(near),
        dx: [dx0, dx1] as [number, number],
        dy: [dy0, dy1] as [number, number],
        gx: gx[i],
        gy: gy[i],
        near,
        far,
      },
    ];
  });
  if (!terms.length) return unboundedEnclosure([NaN, NaN]);
  const hull: [number, number] = terms.reduce(
    ([low, high], term) => [Math.min(low, term.low), Math.max(high, term.high)],
    [Infinity, -Infinity]
  );
  if (level !== undefined && (hull[0] > level || hull[1] <= level)) return unboundedEnclosure(hull);
  const center = read((x0 + x1) / 2 + support.origin[0], (y0 + y1) / 2 + support.origin[1]),
    range = weightEnclosure(terms, center),
    result = derivativeEnclosure(terms, range, radius2, center, [(x1 - x0) / 2, (y1 - y0) / 2]);
  if (box[0] < index.west + support.origin[0] || box[2] > index.east + support.origin[0])
    result.gradient[0] = [Math.min(0, result.gradient[0][0]), Math.max(0, result.gradient[0][1])];
  if (box[1] < index.south + support.origin[1] || box[3] > index.north + support.origin[1])
    result.gradient[1] = [Math.min(0, result.gradient[1][0]), Math.max(0, result.gradient[1][1])];
  return result;
}
function unboundedEnclosure(range: [number, number]): SampleEnclosure {
  return {
    range,
    gradient: [
      [-Infinity, Infinity],
      [-Infinity, Infinity],
    ],
  };
}
/** Labels compete through smooth membership weights; numeric IDs are never interpolated. */
export function smoothCategoryInterpolator(support: SampleSupport, codes: ArrayLike<number>) {
  const at = sampleStations(support);
  return (x: number, y: number) => {
    const weights = new Map<number, number>();
    for (const { i, weight } of at(x, y))
      weights.set(codes[i], (weights.get(codes[i]) ?? 0) + weight);
    let code = 0,
      maximum = -Infinity;
    for (const [candidate, weight] of weights)
      if (weight > maximum || (weight === maximum && candidate < code)) {
        code = candidate;
        maximum = weight;
      }
    return code;
  };
}
import type { BiomeSamples } from "./biomeField";
