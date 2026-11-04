import type { GenerationState } from "../process";
import type { PoiPlace, PoiVisibility } from "./poiContract";
import { cellSpan, cellsWithin, fieldOf, gap, settlementsOf, featureCell } from "./poiReads";
import { nearestPlace } from "./poiPlaces";

type Factor = (state: GenerationState, place: PoiPlace) => number;
const unit = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0);

/**
 * A size in [0, 1]: half at the size typical of the kind, approaching one for the greatest.
 * The reference is that kind's own: nothing here counts places or fits them to a target.
 */
export const sized =
  (size: Factor, typical: number): Factor =>
  (state, place) => {
    const s = size(state, place);
    return s > 0 ? s / (s + typical) : 0;
  };

/**
 * How far a place stands out of its local conditions: the anchor's reading over the mean of
 * the country within `radius` metres, against that country's whole range. Near one for a
 * summit over plains; near nothing for the same summit among higher ones.
 */
export const standsOut =
  (read: (state: GenerationState, cell: number) => number, radius: Factor): Factor =>
  (state, place) => {
    const around = cellsWithin(state, place.anchor, radius(state, place)),
      values = around.map((cell) => read(state, cell)),
      value = read(state, place.anchor),
      mean = values.reduce((sum, v) => sum + v, 0) / values.length,
      range = Math.max(...values) - Math.min(...values);
    return range > 0 ? unit((value - mean) / range) : 0;
  };

/**
 * How alone a place stands among others of its kind that outrank it: half when the nearest
 * lies at `reach` metres. A kind whose places do not rank passes all of them.
 */
export const aloneAmong =
  (others: (state: GenerationState) => readonly PoiPlace[], reach: Factor): Factor =>
  (state, place) => {
    const d = nearestPlace(state, place, others(state));
    return d === Infinity ? 1 : d / (d + reach(state, place));
  };

/** A screen's width in pixels, and how many times closer than the whole map the bar reaches nothing. */
const screenPixels = 1600,
  closestShare = 32;
/** The width of a thumbnail of the whole map, where the bar reaches one. */
const thumbnailPixels = 512;

/** How strongly a settlement's role ties it to a place beside it. */
const roleTies: Record<string, number> = { capital: 1, regionalCapital: 0.7, marketTown: 0.45 };
/** People at which a settlement with no role ties half as strongly as a market town. */
const tiedPopulation = 2000;

/**
 * People's attachment to a place: anything named after it counts in full; otherwise the
 * strongest tie of a settlement within `reach` metres, by its role or its people, fading with
 * distance. A capital at the foot of a modest summit carries it.
 */
export const attachment =
  (reach: Factor): Factor =>
  (state, place) => {
    const span = reach(state, place);
    let tie = 0;
    for (const town of settlementsOf(state)) {
      const named = town.attributes.namedAfter;
      if (named !== undefined && named === place.id) return 1;
      const d = gap(state, featureCell(state, town), place.anchor);
      if (d > span) continue;
      const role = roleTies[String(town.attributes.settlementRole)] ?? 0,
        people = Number(town.attributes.population) || 0,
        size = (roleTies.marketTown * people) / (people + tiedPopulation);
      tie = Math.max(tie, Math.max(role, size) * (1 - d / span));
    }
    return tie;
  };

/**
 * The bar a view sets, from how much of its map the view holds: nothing when a screen holds a
 * thirty-second of the map's width, one at a thumbnail of the whole map, on a logarithmic scale
 * between. It reads the map's width, never its cell size, so a coarse map and a fine one set
 * the same bar over the same share of themselves. The view only sets the bar; what clears it
 * is the place's importance.
 */
export function viewBar(state: GenerationState, metresPerPixel: number) {
  const mesh = fieldOf(state).mesh,
    width = mesh.bounds[2] - mesh.bounds[0],
    close = width / (screenPixels * closestShare),
    thumbnail = width / thumbnailPixels;
  return unit(Math.log(metresPerPixel / close) / Math.log(thumbnail / close));
}

export interface Weights {
  magnitude: number;
  localConditions: number;
  isolation: number;
}
/**
 * The rule of visibility every kind shares: its importance clears the bar the view sets.
 * Importance is the weighted mean of what the place physically is among its country, or its
 * cultural attachment where that is greater, so a tie to people can carry a place alone.
 */
export const drawnWhen =
  (
    factors: Pick<PoiVisibility, "magnitude" | "localConditions" | "isolation" | "cultural">,
    weights: Weights
  ) =>
  (state: GenerationState, place: PoiPlace, metresPerPixel: number) =>
    importance(factors, weights, state, place) >= viewBar(state, metresPerPixel);

const applied = (factor: unknown, state: GenerationState, place: PoiPlace) =>
  typeof factor === "function" ? (factor as Factor)(state, place) : 0;
function importance(
  factors: Pick<PoiVisibility, "magnitude" | "localConditions" | "isolation" | "cultural">,
  weights: Weights,
  state: GenerationState,
  place: PoiPlace
) {
  const total = weights.magnitude + weights.localConditions + weights.isolation,
    physical =
      (weights.magnitude * applied(factors.magnitude, state, place) +
        weights.localConditions * applied(factors.localConditions, state, place) +
        weights.isolation * applied(factors.isolation, state, place)) /
      (total || 1);
  return Math.max(physical, applied(factors.cultural, state, place));
}
