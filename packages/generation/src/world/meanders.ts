/**
 * Meander migration (Howard and Knutson 1984): a channel on its floodplain erodes its outer
 * bank at a rate set by its own curvature and, more strongly, by the curvature upstream of
 * it, carried downstream over a few channel widths; the opposite bank builds out at the same
 * rate. Bends grow, translate downstream and tighten until a neck narrows to a channel's
 * width and the flood cuts through it, leaving the loop as an oxbow. The valley walls stop
 * the bank: a point the floor does not reach is not eroded. Bend size follows the channel's
 * width, so a larger river makes larger meanders; nothing here sets a wavelength.
 */
type Point = [number, number];

/** Weight of a station's own curvature and of the curvature upstream of it (Howard and Knutson). */
const localWeight = -1,
  upstreamWeight = 2.5;
/** Channel widths over which upstream curvature still drives a bank. */
const upstreamReach = 5;
/** Bank erosion of one step, in channel widths per unit of dimensionless curvature. */
const erosionPerStep = 0.05;
/** The most a bank moves in one step, in channel widths: keeps the explicit step stable. */
const largestShift = 0.05;
/** Passes of the three-station binomial filter over the curvature: the bank responds to the bend, not to station noise. */
const curvatureSmoothing = 4;
/** Station spacing in channel widths. */
const stationSpacing = 0.5;
/** Neck width, in channel widths, at which a flood cuts a loop off. */
const cutoffWidth = 1;
/** Room (channel widths) the floor must give on each side for the bank to move. */
const bendRoom = 2;
/** Widths across which a flood takes a chute over a bend, and how much longer the bend must be. */
const chuteReach = 3,
  chuteRatio = 6;
/** Migration steps between looks for necks and chutes a flood would cut. */
const cutoffInterval = 4;
/** Stations at either end held in place: the reach joins its confluences there. */
const heldEnds = 3;
/** Unevenness of the initial course (widths): what starts the bends; it decides nothing else. */
const initialUnevenness = 0.02;

export interface MeanderInput {
  /** The course down the valley, downstream order. */
  line: Point[];
  /** Channel width (m). */
  width: number;
  /** Steps of migration: the floodplain's working time. */
  steps: number;
  /** Whether the floor reaches a point: the bank cannot erode where it does not. */
  floor: (p: Point) => boolean;
  /** Deterministic draw in [0, 1) per station index. */
  draw: (k: number) => number;
}
export interface MeanderResult {
  line: Point[];
  /** Loops the flood cut off, as their closed courses. */
  oxbows: Point[][];
}

export function migrateMeanders(input: MeanderInput): MeanderResult {
  const { width, floor } = input,
    spacing = stationSpacing * width,
    oxbows: Point[][] = [];
  let line = resample(input.line, spacing);
  if (line.length < 2 * heldEnds + 3) return { line: input.line, oxbows };
  line = line.map((p, k) => {
    if (k < heldEnds || k >= line.length - heldEnds) return p;
    const n = normalAt(line, k),
      offset = (input.draw(k) * 2 - 1) * initialUnevenness * width;
    const moved: Point = [p[0] + n[0] * offset, p[1] + n[1] * offset];
    return floor(moved) ? moved : p;
  });
  for (let step = 0; step < input.steps; step++) {
    line = migrate(line, width, floor);
    // A neck closes by at most a step's bank movement; floods are looked for every few steps.
    if (step % cutoffInterval === cutoffInterval - 1) line = cutoffs(line, width, oxbows);
    line = resample(line, spacing);
  }
  return { line: resample(cutoffs(line, width, oxbows), spacing), oxbows };
}

/** One step of bank migration along the left normal, driven by local and upstream curvature. */
function migrate(line: Point[], width: number, floor: (p: Point) => boolean): Point[] {
  const curvature = smoothedCurvature(line, width),
    spacing = meanSpacing(line),
    fade = Math.exp(-spacing / (upstreamReach * width)),
    room = bendRoom * width,
    probe: Point = [0, 0],
    // The floor reaches a point offset from a station along its normal.
    reaches = (k: number, nx: number, ny: number, d: number) => {
      probe[0] = line[k][0] + nx * d;
      probe[1] = line[k][1] + ny * d;
      return floor(probe);
    },
    next = line.slice();
  let carried = 0,
    weight = 0;
  for (let k = 0; k < line.length; k++) {
    // The upstream curvature, an exponentially weighted memory of the course above.
    const rate = localWeight * curvature[k] + upstreamWeight * (weight ? carried / weight : 0);
    carried = carried * fade + curvature[k];
    weight = weight * fade + 1;
    if (k < heldEnds || k >= line.length - heldEnds) continue;
    // Along the left normal: with the upstream bend dominant the bank moves outward, so
    // bends grow and travel downstream; the local term damps the station-scale ones. A
    // bank moves only where the floor gives room for a bend on both sides: in a confined
    // reach the valley walls hold the channel to the valley's own line.
    const [nx, ny] = normalAt(line, k),
      shift = Math.max(-largestShift, Math.min(largestShift, erosionPerStep * rate)) * width;
    if (reaches(k, nx, ny, room) && reaches(k, nx, ny, -room))
      next[k] = [line[k][0] + nx * shift, line[k][1] + ny * shift];
  }
  return next;
}
/** Dimensionless curvature, filtered along the course in two reused buffers. */
function smoothedCurvature(line: Point[], width: number) {
  let out = new Float64Array(line.length),
    spare = new Float64Array(line.length);
  for (let k = 0; k < line.length; k++) out[k] = signedCurvature(line, k) * width;
  for (let pass = 0; pass < curvatureSmoothing; pass++) {
    spare[0] = out[0];
    spare[out.length - 1] = out[out.length - 1];
    for (let k = 1; k < out.length - 1; k++)
      spare[k] = 0.25 * out[k - 1] + 0.5 * out[k] + 0.25 * out[k + 1];
    [out, spare] = [spare, out];
  }
  return out;
}

/**
 * Floods shorten the course: across a neck narrower than a channel (neck cutoff), and
 * across the inside of a bend whose course is many times longer than the flood's short way
 * over it (chute cutoff), which on a narrow floor happens before a bend can grow. The course
 * takes the short way and the loop is left as an oxbow.
 */
function cutoffs(line: Point[], width: number, oxbows: Point[][]): Point[] {
  const spacing = meanSpacing(line),
    reach = chuteReach * width,
    grid = new Map<number, number[]>(); // hpc-exempt: the stations of one river
  line.forEach((p, k) => {
    const at = gridKey(Math.floor(p[0] / reach), Math.floor(p[1] / reach)),
      cell = grid.get(at);
    if (cell) cell.push(k);
    else grid.set(at, [k]);
  });
  for (let a = 0; a < line.length; a++) {
    const b = shortWay(line, a, grid, reach, width, spacing);
    if (b < 0) continue;
    oxbows.push(line.slice(a, b + 1));
    return cutoffs([...line.slice(0, a + 1), ...line.slice(b)], width, oxbows);
  }
  return line;
}
/** The farthest station downstream of `a` the flood reaches across a neck or a chute, or -1. */
function shortWay(
  line: Point[],
  a: number,
  grid: Map<number, number[]>,
  reach: number,
  width: number,
  spacing: number
) {
  const [x, y] = line[a],
    cx = Math.floor(x / reach),
    cy = Math.floor(y / reach);
  const floods = (b: number) => {
    const across = Math.hypot(line[b][0] - x, line[b][1] - y),
      along = (b - a) * spacing;
    const neck = across < cutoffWidth * width && along > Math.PI * cutoffWidth * width;
    return neck || (across < reach && along > chuteRatio * across);
  };
  let found = -1;
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++)
      for (const b of grid.get(gridKey(cx + dx, cy + dy)) ?? [])
        if (b > found && b > a + 2 && floods(b)) found = b;
  return found;
}
/** One number per grid square: columns and rows offset to stay positive. */
const gridKey = (column: number, row: number) => (column + 2 ** 20) * 2 ** 21 + (row + 2 ** 20);

function signedCurvature(line: Point[], k: number) {
  if (k === 0 || k === line.length - 1) return 0;
  const [ax, ay] = line[k - 1],
    [bx, by] = line[k],
    [cx, cy] = line[k + 1],
    ux = bx - ax,
    uy = by - ay,
    vx = cx - bx,
    vy = cy - by,
    turn = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy),
    length = (Math.hypot(ux, uy) + Math.hypot(vx, vy)) / 2;
  return length > 0 ? turn / length : 0;
}
function normalAt(line: Point[], k: number): Point {
  const a = line[Math.max(0, k - 1)],
    b = line[Math.min(line.length - 1, k + 1)],
    dx = b[0] - a[0],
    dy = b[1] - a[1],
    length = Math.hypot(dx, dy) || 1;
  return [-dy / length, dx / length];
}
function meanSpacing(line: Point[]) {
  let total = 0;
  for (let k = 1; k < line.length; k++)
    total += Math.hypot(line[k][0] - line[k - 1][0], line[k][1] - line[k - 1][1]);
  return total / Math.max(1, line.length - 1);
}
/** Stations at an even spacing along the course, keeping both ends. */
export function resample(line: Point[], spacing: number): Point[] {
  const out: Point[] = [line[0]];
  let carry = 0;
  for (let k = 1; k < line.length; k++) {
    const [ax, ay] = line[k - 1],
      [bx, by] = line[k],
      length = Math.hypot(bx - ax, by - ay);
    let at = spacing - carry;
    while (at <= length) {
      const t = at / length;
      out.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
      at += spacing;
    }
    carry = length - (at - spacing);
  }
  const last = line.at(-1)!;
  if (Math.hypot(last[0] - out.at(-1)![0], last[1] - out.at(-1)![1]) > spacing * 0.25)
    out.push(last);
  else out[out.length - 1] = last;
  return out;
}
