/** Tiles kept for the time summaries: the most recent ones describe the current view. */
const recentTiles = 300;

/** Milliseconds one terrain or field tile took: reading its sea and lakes, sampling it, and the whole round trip. */
export interface TileTiming {
  geography: number;
  sample: number;
  roundTrip: number;
}
interface Counts {
  requested: number;
  drawn: number;
  failed: number;
  cancelled: number;
  /** Times a source threw away its loaded tiles to load them again. */
  reloads: number;
  /** Raster inputs opened by the tile workers. */
  registrations: number;
}
export interface RenderingSnapshot extends Counts {
  waiting: number;
  workers: number;
  recent: number;
  geography: Summary;
  sample: Summary;
  roundTrip: Summary;
}
export interface Summary {
  median: number;
  slowest: number;
}

const counts: Counts = {
  requested: 0,
  drawn: 0,
  failed: 0,
  cancelled: 0,
  reloads: 0,
  registrations: 0,
};
const tiles: TileTiming[] = [];
const listeners = new Set<() => void>();
let waiting: () => number = () => 0,
  workers = 0,
  current: RenderingSnapshot | undefined;

function changed() {
  current = undefined;
  for (const listener of listeners) listener();
}
function summary(values: number[]): Summary {
  if (!values.length) return { median: 0, slowest: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  return { median: sorted[Math.floor(sorted.length / 2)], slowest: sorted.at(-1)! };
}

/**
 * Live counts of how the map's tiles are being drawn, kept by the tile workers' client and
 * the raster sources and read by the rendering readout. Nothing here changes rendering.
 */
export const renderingDiagnostics = {
  count(kind: keyof Counts) {
    counts[kind]++;
    changed();
  },
  drawn(timing: TileTiming) {
    counts.drawn++;
    tiles.push(timing);
    if (tiles.length > recentTiles) tiles.shift();
    changed();
  },
  /** The pool reports its workers and how many tiles are still outstanding. */
  pool(size: number, outstanding: () => number) {
    workers = size;
    waiting = outstanding;
    changed();
  },
  reset() {
    for (const key of Object.keys(counts) as (keyof Counts)[]) counts[key] = 0;
    tiles.length = 0;
    changed();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  snapshot(): RenderingSnapshot {
    current ??= {
      ...counts,
      waiting: waiting(),
      workers,
      recent: tiles.length,
      geography: summary(tiles.map((tile) => tile.geography)),
      sample: summary(tiles.map((tile) => tile.sample)),
      roundTrip: summary(tiles.map((tile) => tile.roundTrip)),
    };
    return current;
  },
};
