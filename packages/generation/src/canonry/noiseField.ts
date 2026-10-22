import type { Bounds, SampleEnclosure } from "@atlas/domain";
import { hashUnit } from "./noise";
import type { CausalScalar } from "./causalRegions";

type Range = [number, number];
const blend = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (v: number) => v * v * (3 - 2 * v);
function derivative(low: number, high: number): Range {
  const at = (v: number) => 6 * v * (1 - v);
  return [
    Math.min(at(low), at(high)),
    low <= 0.5 && high >= 0.5 ? 1.5 : Math.max(at(low), at(high)),
  ];
}
function product(a: Range, b: Range, scale: number): Range {
  const values = [a[0] * b[0], a[0] * b[1], a[1] * b[0], a[1] * b[1]];
  return [Math.min(...values) / scale, Math.max(...values) / scale];
}
/** Exact single-octave value-noise bounds, including derivative signs inside each cell. */
export function unitNoiseField(origin: [number, number], salt: number, scale: number) {
  const corners = new Map<string, number[]>();
  const cell = (x: number, y: number) => {
    const key = `${x}:${y}`;
    if (!corners.has(key))
      corners.set(key, [
        hashUnit(salt, x, y),
        hashUnit(salt, x + 1, y),
        hashUnit(salt, x, y + 1),
        hashUnit(salt, x + 1, y + 1),
      ]);
    return corners.get(key)!;
  };
  const signed = (x: number, y: number) => {
    const px = (x - origin[0]) / scale,
      py = (y - origin[1]) / scale,
      ix = Math.floor(px),
      iy = Math.floor(py);
    const [a, b, c, d] = cell(ix, iy),
      tx = smooth(px - ix),
      ty = smooth(py - iy);
    return blend(blend(a * 2 - 1, b * 2 - 1, tx), blend(c * 2 - 1, d * 2 - 1, tx), ty);
  };
  const read: CausalScalar = (x, y) => (signed(x, y) + 1) * 0.5;
  read.enclose = (box: Bounds): SampleEnclosure => {
    const b = box.map((v, i) => (v - origin[i % 2]) / scale);
    const result: SampleEnclosure = {
      range: [Infinity, -Infinity],
      gradient: [
        [Infinity, -Infinity],
        [Infinity, -Infinity],
      ],
    };
    for (let y = Math.floor(b[1]); y <= Math.floor(b[3]); y++)
      for (let x = Math.floor(b[0]); x <= Math.floor(b[2]); x++) {
        const bounds: Bounds = [
          Math.max(0, b[0] - x),
          Math.max(0, b[1] - y),
          Math.min(1, b[2] - x),
          Math.min(1, b[3] - y),
        ];
        const e = cellBounds(cell(x, y), bounds, scale);
        for (const [target, range] of [
          [result.range, e.range],
          [result.gradient[0], e.gradient[0]],
          [result.gradient[1], e.gradient[1]],
        ]) {
          target[0] = Math.min(target[0], range[0]);
          target[1] = Math.max(target[1], range[1]);
        }
      }
    return result;
  };
  return Object.assign(read, { signed });
}
function cellBounds([a, b, c, d]: number[], box: Bounds, scale: number): SampleEnclosure {
  const [u0, v0, u1, v1] = box,
    sx = [smooth(u0), smooth(u1)],
    sy = [smooth(v0), smooth(v1)];
  const values = sx.flatMap((u) => sy.map((v) => blend(blend(a, b, u), blend(c, d, u), v)));
  const dx = sy.map((v) => blend(b - a, d - c, v)),
    dy = sx.map((u) => blend(c - a, d - b, u));
  return {
    range: [Math.min(...values), Math.max(...values)],
    gradient: [
      product([Math.min(...dx), Math.max(...dx)], derivative(u0, u1), scale),
      product([Math.min(...dy), Math.max(...dy)], derivative(v0, v1), scale),
    ],
  };
}

/** Bounds for the same rotated octaves used by the tectonic warp producer. */
export function fractalNoiseField(
  origin: [number, number],
  salt: number,
  scale: number,
  octaves: number
): CausalScalar {
  const rotation = 2.39996322972865332,
    terms: {
      cos: number;
      sin: number;
      amplitude: number;
      field: ReturnType<typeof unitNoiseField>;
    }[] = [];
  let cos = 1,
    sin = 0,
    amplitude = 1,
    total = 0,
    size = scale;
  for (let i = 0; i < octaves; i++) {
    terms.push({ cos, sin, amplitude, field: unitNoiseField([0, 0], (salt + i * 7919) | 0, size) });
    total += amplitude;
    amplitude *= 0.5;
    size *= 0.5;
    [cos, sin] = [
      cos * Math.cos(rotation) - sin * Math.sin(rotation),
      cos * Math.sin(rotation) + sin * Math.cos(rotation),
    ];
  }
  const read: CausalScalar = (x, y) => {
    const px = x - origin[0],
      py = y - origin[1];
    let value = 0;
    for (const t of terms)
      value += t.field.signed(px * t.cos - py * t.sin, px * t.sin + py * t.cos) * t.amplitude;
    return value / total;
  };
  const scaled = (range: Range, factor: number): Range => [
    Math.min(range[0] * factor, range[1] * factor),
    Math.max(range[0] * factor, range[1] * factor),
  ];
  read.enclose = (box) => {
    const result: SampleEnclosure = {
      range: [0, 0],
      gradient: [
        [0, 0],
        [0, 0],
      ],
    };
    for (const t of terms) {
      const points = [box[0], box[2]].flatMap((x) =>
        [box[1], box[3]].map((y) => {
          const px = x - origin[0],
            py = y - origin[1];
          return [px * t.cos - py * t.sin, px * t.sin + py * t.cos];
        })
      );
      const b: Bounds = [
        Math.min(...points.map((p) => p[0])),
        Math.min(...points.map((p) => p[1])),
        Math.max(...points.map((p) => p[0])),
        Math.max(...points.map((p) => p[1])),
      ];
      const e = t.field.enclose!(b),
        weight = t.amplitude / total;
      result.range[0] += (2 * e.range[0] - 1) * weight;
      result.range[1] += (2 * e.range[1] - 1) * weight;
      for (const [axis, c, s] of [
        [0, t.cos, t.sin],
        [1, -t.sin, t.cos],
      ]) {
        const a = scaled(e.gradient[0], c * 2 * weight),
          d = scaled(e.gradient[1], s * 2 * weight);
        result.gradient[axis][0] += a[0] + d[0];
        result.gradient[axis][1] += a[1] + d[1];
      }
    }
    return result;
  };
  return read;
}
