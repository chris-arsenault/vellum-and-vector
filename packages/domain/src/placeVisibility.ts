/** A screen's width in pixels, and how many times closer than the whole map the bar reaches nothing. */
const screenPixels = 1600,
  closestShare = 32;
/** The width of a thumbnail of the whole map, where the bar reaches one. */
const thumbnailPixels = 512;

/**
 * The bar a view sets, from how much of its map the view holds: nothing when a screen holds a
 * thirty-second of the map's width, one at a thumbnail of the whole map, on a logarithmic scale
 * between. It reads the map's width, never its cell size, so a coarse map and a fine one set
 * the same bar over the same share of themselves.
 */
export function viewBar(mapWidth: number, metresPerPixel: number) {
  const close = mapWidth / (screenPixels * closestShare),
    thumbnail = mapWidth / thumbnailPixels,
    bar = Math.log(metresPerPixel / close) / Math.log(thumbnail / close);
  return Number.isFinite(bar) ? Math.max(0, Math.min(1, bar)) : 0;
}
/** The one rule of visibility every kind shares: what a place weighs clears the bar of the view. */
export const placeDrawn = (importance: number, mapWidth: number, metresPerPixel: number) =>
  importance >= viewBar(mapWidth, metresPerPixel);
