/**
 * Pure shaping for the inspection surface: shares into bar segments, histories into
 * chart series, numbers into short labels. Components render what these return.
 */

/** One segment of a share bar: a stable id for its colour, a label, and its weight. */
export interface Segment {
  id: string;
  label: string;
  value: number;
}
/** A segment placed on a 0..100 axis. */
export interface PlacedSegment extends Segment {
  start: number;
  width: number;
}

/**
 * Lay out segments left to right as percentages of `total`. The default total is the sum,
 * which gives a full bar; a larger total leaves the remainder empty, which is how a bar
 * shows headroom (people against capacity, used against supply).
 */
export function placeSegments(segments: Segment[], total?: number): PlacedSegment[] {
  const sum = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  const base = total && total > 0 ? total : sum;
  if (base <= 0) return [];
  let start = 0;
  return segments
    .filter((x) => x.value > 0)
    .map((x) => {
      const width = Math.min(100 - start, (100 * x.value) / base);
      const placed = { ...x, start, width };
      start += width;
      return placed;
    });
}
/** Segments from a record of shares, heaviest first, with an optional label lookup. */
export function shareSegments(
  shares: Record<string, number>,
  label: (id: string) => string = (id) => id
): Segment[] {
  return Object.entries(shares)
    .filter(([, value]) => value > 0)
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .map(([id, value]) => ({ id, label: label(id), value }));
}

/** A series of points for the trend chart; `x` is the common axis across series. */
export interface Series {
  id: string;
  label: string;
  points: { x: number; y: number }[];
}
export interface ChartFrame {
  width: number;
  height: number;
  xMin: number;
  xMax: number;
  yMax: number;
}
/** The frame every series shares: x spans all points, y starts at zero and ends at the maximum. */
export function chartFrame(series: Series[], width: number, height: number): ChartFrame | null {
  const points = series.flatMap((s) => s.points);
  if (!points.length) return null;
  const xs = points.map((p) => p.x),
    yMax = Math.max(...points.map((p) => p.y), 0);
  return {
    width,
    height,
    xMin: Math.min(...xs),
    xMax: Math.max(...xs),
    yMax: yMax > 0 ? yMax : 1,
  };
}
/** Project a point into frame pixels, with a single point centred so it still draws. */
export function project(frame: ChartFrame, p: { x: number; y: number }) {
  const span = frame.xMax - frame.xMin;
  const x = span > 0 ? ((p.x - frame.xMin) / span) * frame.width : frame.width / 2;
  const y = frame.height - (Math.min(p.y, frame.yMax) / frame.yMax) * frame.height;
  return { x, y };
}
/** An SVG path through the series' points in frame space. */
export function linePath(frame: ChartFrame, series: Series) {
  return series.points
    .map((p, i) => {
      const { x, y } = project(frame, p);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}
/** The line path closed down to the baseline, for a filled area under a series. */
export function areaPath(frame: ChartFrame, series: Series) {
  if (!series.points.length) return "";
  const first = project(frame, series.points[0]),
    last = project(frame, series.points[series.points.length - 1]);
  return `${linePath(frame, series)} L${last.x.toFixed(1)} ${frame.height} L${first.x.toFixed(1)} ${frame.height} Z`;
}

/** Short number labels for stats: 1.2k, 34k, 2.1M. Whole numbers below a thousand. */
export function compact(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1e6) return `${(value / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}k`;
  return Math.round(value).toLocaleString();
}
/** A percent label; a share too small to show at the given digits reads as less than one unit. */
export function percent(share: number, digits = 0) {
  const text = (100 * share).toFixed(digits);
  if (share > 0 && Number(text) === 0) return `<${(1 / 10 ** digits).toFixed(digits)}%`;
  return `${text}%`;
}

/**
 * The fixed colour classes of the channels every chart shares, so farming is the same
 * colour in a support bar, a practice bar and a polity's character. Anything else takes
 * an ordinal class by its position among the segments.
 */
const channelClasses: Record<string, string> = {
  farming: "ch-farming",
  grazing: "ch-grazing",
  gathering: "ch-gathering",
  fishing: "ch-fishing",
  water: "ch-water",
  "fire-forge": "ch-fire",
  "aurora-archive": "ch-aurora",
  "pressure-diving": "ch-pressure",
  land: "ch-land",
  river: "ch-river",
  sea: "ch-sea",
};
export function channelClass(id: string, ordinal: number) {
  return channelClasses[id] ?? `ch-${ordinal % 8}`;
}
