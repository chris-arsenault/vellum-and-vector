import type { PoiMap, PoiPlace } from "./poiTypes";

/** Ground distance between two cells' centres, in metres. */
export function distance(map: PoiMap, a: number, b: number) {
  const p = map.position(a),
    q = map.position(b);
  return Math.hypot(p.x - q.x, p.y - q.y);
}
/** Whether a cell is land: neither sea nor lake. */
export const isLand = (map: PoiMap, cell: number) => map.read("water", cell) === 0;

/**
 * Every cell whose centre lies within `radius` of the anchor's, reached across neighbours:
 * the country around a place. The anchor is included.
 */
export function cellsWithin(map: PoiMap, anchor: number, radius: number): number[] {
  const seen = new Set([anchor]),
    queue = [anchor];
  for (let at = 0; at < queue.length; at++)
    for (const next of map.neighbours(queue[at]))
      if (!seen.has(next) && distance(map, anchor, next) <= radius) {
        seen.add(next);
        queue.push(next);
      }
  return queue;
}

/**
 * The nearest cell, outward across neighbours, whose value of `channel` exceeds `above`, and
 * its distance; Infinity when no cell does.
 */
export function nearestAbove(map: PoiMap, anchor: number, channel: "elevation", above: number) {
  const seen = new Set([anchor]),
    queue = [anchor];
  let best = Infinity;
  for (let at = 0; at < queue.length; at++) {
    const cell = queue[at],
      reach = distance(map, anchor, cell);
    if (reach > best) continue;
    if (map.read(channel, cell) > above) best = Math.min(best, reach);
    for (const next of map.neighbours(cell))
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
  }
  return best;
}

/** Places of a kind or kinds on the map. */
export const placesOf = (map: PoiMap, kinds: readonly string[]): PoiPlace[] =>
  map.places.filter((place) => kinds.includes(place.kind));

/** A number squeezed into [0, 1]. */
export const unit = (value: number) =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
