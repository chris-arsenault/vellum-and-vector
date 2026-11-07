import { desertMoisture, environment } from "../../world/ecologyEnvironment";
import type { GenerationState } from "../../process";
import type { RegionalState } from "../../regional/state";
import { carryWhereItLands, counterpartOf, goes, stays } from "../poiCarry";
import {
  notApplicable,
  type PoiAcrossMaps,
  type PoiCarried,
  type PoiCost,
  type PoiPlace,
  type PoiRelation,
  type PoiUnrealized,
} from "../poiContract";
import type { PoiKindId } from "../poiKinds";
import { holds } from "../poiPlaces";
import { adjacent, cellSpan, fieldOf, gap, heldFor, magicRule } from "../poiReads";
import { aloneAmong, attachment, sized, standsOut } from "../poiVisibilityRules";

/** What the Living cover entries share: the plain reads and rules they are written in. */

export const canopyAt = (state: GenerationState, cell: number) => {
  const map = fieldOf(state);
  return map.BroadleafCover.get(cell) + map.ConiferCover.get(cell);
};
/** Every living share of the ground, the sum the ecology's classes call cover. */
export const livingCoverAt = (state: GenerationState, cell: number) => {
  const map = fieldOf(state);
  return map.TreeCover.get(cell) + map.GrassCover.get(cell) + map.WetlandCover.get(cell);
};
/** Plant water at a cell: precipitation over evaporative demand. */
export const plantWaterAt = (state: GenerationState, cell: number) =>
  environment(fieldOf(state), cell).moisture;
export const oldStand = magicRule("greenwood", "stand");
export const quickeningAt = (state: GenerationState, cell: number) =>
  fieldOf(state).Quickening.get(cell);
export const stillnessAt = (state: GenerationState, cell: number) =>
  fieldOf(state).Stillness.get(cell);
export const verdureAt = (state: GenerationState, cell: number) => fieldOf(state).Verdure.get(cell);
export const fireAt = (state: GenerationState, cell: number) =>
  fieldOf(state).FireActivity.get(cell);

const membersOf = (state: GenerationState, place: PoiPlace) =>
  heldFor(state, `members:${place.id}`, () => new Set(place.cells));
export const areaOf = (state: GenerationState, place: PoiPlace) =>
  heldFor(state, `area:${place.id}`, () => {
    const mesh = fieldOf(state).mesh;
    return place.cells.reduce((sum, cell) => sum + mesh.area(cell), 0);
  });
/** The radius of a circle of a place's area, at least two cells. */
export const spanOf = (state: GenerationState, place: PoiPlace) =>
  Math.max(2 * cellSpan(state), Math.sqrt(areaOf(state, place) / Math.PI));
/** The country a place is judged against: its own span, kept to a local neighbourhood. */
const countryOf = (state: GenerationState, place: PoiPlace) =>
  Math.min(spanOf(state, place), 32 * cellSpan(state));
export const meanOver = (
  state: GenerationState,
  place: PoiPlace,
  read: (state: GenerationState, cell: number) => number
) => place.cells.reduce((sum, cell) => sum + read(state, cell), 0) / (place.cells.length || 1);
/** The reach of a hazard that runs through a place: its span, kept to a local neighbourhood. */
export const hazardReach = countryOf;

/** Visibility of a stretch of country, from its area and the reading that sets it apart. */
export const countryFactors = (
  places: (state: GenerationState) => readonly PoiPlace[],
  typicalArea: number,
  read: (state: GenerationState, cell: number) => number
) => ({
  magnitude: sized(areaOf, typicalArea),
  localConditions: standsOut(read, countryOf),
  isolation: aloneAmong(places, spanOf),
  cultural: attachment(spanOf),
});

/**
 * What a stretch of living country does to the fields: nothing of its own. Each of these is
 * written across the whole field by the process named, whatever places stand on it.
 */
export const coverWrites = {
  terrain: notApplicable("The soil process writes soil depth over the whole field from its cover."),
  water: notApplicable(
    "The soil process writes infiltration and the climate process writes runoff over the whole field from its cover."
  ),
  climate: notApplicable("The soil process writes evapotranspiration over the whole field."),
  cover: notApplicable(
    "The ecology's cohorts, grazers and fire write cover over the whole field; a landscape is a reading of them."
  ),
  magic: notApplicable(
    "Magic's feedback writes the living forcings over the whole field by intensity."
  ),
};
/** How a stretch of living country moves things: through generator costs that read the field. */
export const coverCosts = {
  roads: notApplicable("The map router's ground factor already charges every cell for its trees."),
  boats: notApplicable("A river through it carries boats as any other reach."),
  drainage: notApplicable(
    "Surface resistance and relief's cover softening already read every cell's cover as a channel cuts it."
  ),
  magic: notApplicable(
    "Greenwood's root propagation reads every cell's living cover itself, and no other carrier reads cover."
  ),
  links: notApplicable("Country joins no two cells."),
  crosses: notApplicable("Country lets no route across a barrier by being there."),
};

/** What a road pays for ground with no water or fodder on it. */
const waterlessRoad = 1.5;
/** Roads pay on a place's cells under the desert's moisture line. No router reads that. */
export const waterlessRoads = (state: GenerationState, place: PoiPlace): readonly PoiCost[] =>
  place.cells
    .filter((cell) => plantWaterAt(state, cell) < desertMoisture)
    .map((cell) => ({ cell, factor: waterlessRoad }));

/** The same ground is never two of these: the relation that names it. */
export const sharesNoGround = (...kinds: PoiKindId[]): PoiRelation[] =>
  kinds.map((kind) => ({ kind, holds }));
/** A place's cells hold the other's anchor: the same test, read as containing it. */
export const standsIn = sharesNoGround;
const landscapes: PoiKindId[] = [
  "forest",
  "grassland",
  "barren",
  "emberGrove",
  "thawMeadow",
  "rimeForest",
  "glowBarrens",
  "fogHeath",
  "wetland",
  "lake",
];
/** Biome families partition the land: a landscape shares ground with no other, nor with water. */
export const otherLandscapes = (kind: PoiKindId) =>
  sharesNoGround(...landscapes.filter((other) => other !== kind));
/** Whether the other's anchor lies within a reach this place sets by its own size. */
export const withinOwn =
  (reach: (state: GenerationState, place: PoiPlace) => number) =>
  (state: GenerationState, a: PoiPlace, b: PoiPlace) =>
    gap(state, a.anchor, b.anchor) <= reach(state, a);
/** Whether two places share or touch ground. */
export function touching(state: GenerationState, a: PoiPlace, b: PoiPlace) {
  const other = membersOf(state, b);
  return a.cells.some(
    (cell) => other.has(cell) || [...adjacent(state, cell)].some((next) => other.has(next))
  );
}
export const borders = (...kinds: PoiKindId[]): PoiRelation[] =>
  kinds.map((kind) => ({ kind, holds: touching }));

/** A carried stretch of country finds the same kind within two of the parent's cells. */
export const countryCounterpart = (isA: (state: GenerationState, cell: number) => boolean) =>
  counterpartOf(isA, 2);
/** What a stretch of country does if the developed ground no longer holds it where it lands. */
export const movesOrGoes =
  (counterpart: (state: RegionalState, carried: PoiCarried) => number) =>
  (state: RegionalState, carried: PoiCarried): PoiUnrealized => {
    const cell = counterpart(state, carried);
    if (cell === carried.cell) return stays();
    return cell >= 0 ? { outcome: "move", cell } : goes();
  };
/** Country the child's own processes develop: its name moves to the nearest of its kind, or goes. */
export function developedCountry(
  statement: string,
  isA: (state: GenerationState, cell: number) => boolean
): PoiAcrossMaps {
  const counterpart = countryCounterpart(isA),
    unrealized = movesOrGoes(counterpart);
  return {
    statement,
    carry: carryWhereItLands,
    realize: notApplicable("The child's own ecology and magic develop it from the capture."),
    counterpart,
    unrealized,
    settle: unrealized,
    schedule: notApplicable("A stretch of country does nothing at refinement's other points."),
  };
}
