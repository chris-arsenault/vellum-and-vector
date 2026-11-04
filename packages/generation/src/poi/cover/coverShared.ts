import { biomes } from "@atlas/domain";
import type { PhysicalBufferName } from "../../canonry/field";
import type { GenerationState } from "../../process";
import type { RegionalState } from "../../regional/state";
import { counterpartOf, goes, stays } from "../poiCarry";
import type {
  PoiCarried,
  PoiFieldChange,
  PoiPlace,
  PoiRelation,
  PoiUnrealized,
} from "../poiContract";
import type { PoiKindId } from "../poiKinds";
import { holds, recordPlaces } from "../poiPlaces";
import {
  adjacent,
  cellSpan,
  cellsWithin,
  fieldOf,
  gap,
  heldFor,
  isLand,
  magicRule,
} from "../poiReads";
import { aloneAmong, attachment, sized, standsOut } from "../poiVisibilityRules";

/**
 * What the Living cover entries share: which of them a land cell belongs to, and the plain
 * reads their rules are written in. The cover classes are the ecology's own `BiomeCodes`,
 * written by `classifyBiome` on world and refined maps alike, grouped as the published
 * landscapes group them; the biome's name at a cell is the place's property.
 */

/** Below this share of living cover the ground counts as bare, as `classifyBiome` holds it. */
export const bareBelow = 0.12;
/** The tree share `classifyBiome` calls forest. */
const forestFrom = 0.4;

const forestClasses = new Set([
  "Woodland",
  "Temperate forest",
  "Boreal forest",
  "Rainforest",
  "Deepwood",
  "Rime forest",
  "Moss forest",
  "Ember grove",
]);
const grassClasses = new Set(["Grassland", "Savanna", "Well meadow", "Fog heath", "Thaw meadow"]);
const bareClasses = new Set(["Barren", "Desert", "Glow-lichen barrens"]);

export type CoverKind = "clearance" | "wildZone" | "thawedHalo" | "forest" | "grassland" | "barren";
type Living = "forest" | "grassland" | "barren";

export const canopyAt = (state: GenerationState, cell: number) => {
  const map = fieldOf(state);
  return map.BroadleafCover.get(cell) + map.ConiferCover.get(cell);
};
/** Every living share of the ground, the sum `classifyBiome` calls cover. */
export const livingCoverAt = (state: GenerationState, cell: number) => {
  const map = fieldOf(state);
  return map.TreeCover.get(cell) + map.GrassCover.get(cell) + map.WetlandCover.get(cell);
};
/** The ecology's name for a cell's cover: a place's property. */
export const biomeNameAt = (state: GenerationState, cell: number) =>
  biomes[fieldOf(state).BiomeCodes.get(cell)]?.name ?? "";

/** `classifyBiome` calls all ground under 2 degrees Tundra; its cover says what it is. */
function coldGround(state: GenerationState, cell: number): Living {
  if (fieldOf(state).TreeCover.get(cell) >= forestFrom) return "forest";
  return livingCoverAt(state, cell) < bareBelow ? "barren" : "grassland";
}
/** What the biome class makes a cell; null for ice, water and wetland classes. */
function livingClass(state: GenerationState, cell: number): Living | null {
  const name = biomeNameAt(state, cell);
  if (name === "Tundra") return coldGround(state, cell);
  if (forestClasses.has(name)) return "forest";
  if (grassClasses.has(name)) return "grassland";
  return bareClasses.has(name) ? "barren" : null;
}
const oldStand = magicRule("greenwood", "stand"),
  verdantCountry = magicRule("greenwood", "verdant"),
  saltPanGround = magicRule("salt", "pan"),
  glassFlatGround = magicRule("salt", "flat"),
  killingGround = magicRule("salt", "ground"),
  wildGround = magicRule("veil", "wild"),
  thawedGround = magicRule("fire", "halo");

/** Greenwood's merged names, then Salt's ground that belongs to other entries. */
function livingKind(state: GenerationState, cell: number): Living | null {
  const living = livingClass(state, cell);
  if (living === null) return null;
  if (living === "forest" || oldStand(state, cell)) return "forest";
  if (saltPanGround(state, cell) || glassFlatGround(state, cell)) return null;
  if (verdantCountry(state, cell)) return "grassland";
  return living === "grassland" && killingGround(state, cell) ? null : living;
}
/** Which Living cover kind a cell belongs to, or null. At most one holds. */
export function coverKindAt(state: GenerationState, cell: number): CoverKind | null {
  if (!isLand(state, cell)) return null;
  if (clearedCells(state).has(cell)) return "clearance";
  if (wildGround(state, cell)) return "wildZone";
  if (thawedGround(state, cell)) return "thawedHalo";
  return livingKind(state, cell);
}
export const isKind = (kind: CoverKind) => (state: GenerationState, cell: number) =>
  coverKindAt(state, cell) === kind;

const clearanceRecords = recordPlaces("clearance", (f) => f.kind === "clearance");
export const clearanceRadius = (feature: PoiPlace["feature"]) =>
  Number(feature?.attributes.radius) || 0;
/** Published clearance works, each covering the ground its radius reaches. */
export const clearancePlaces = (state: GenerationState): readonly PoiPlace[] =>
  heldFor(state, "footprints:clearance", () =>
    clearanceRecords(state).map((place) => ({
      ...place,
      cells: cellsWithin(state, place.anchor, clearanceRadius(place.feature)),
    }))
  );
const clearedCells = (state: GenerationState) =>
  heldFor(state, "cells:clearance", () => new Set(clearancePlaces(state).flatMap((p) => p.cells)));

const membersOf = (state: GenerationState, place: PoiPlace) =>
  heldFor(state, `members:${place.id}`, () => new Set(place.cells));
/** A network's cost from a reading of the cell, on a place's cells; one elsewhere. */
export const onPlace =
  (factor: (state: GenerationState, cell: number) => number) =>
  (state: GenerationState, place: PoiPlace, cell: number) =>
    membersOf(state, place).has(cell) ? factor(state, cell) : 1;
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

/** Holds each band on every cell of a place at no less than it stands now. */
export const floorsHeld =
  (...bands: PhysicalBufferName[]) =>
  (state: GenerationState, place: PoiPlace) =>
    heldBands(state, place, bands, "atLeast");
/** Holds each band on every cell of a place at no more than it stands now. */
export const ceilingsHeld =
  (...bands: PhysicalBufferName[]) =>
  (state: GenerationState, place: PoiPlace) =>
    heldBands(state, place, bands, "atMost");
function heldBands(
  state: GenerationState,
  place: PoiPlace,
  bands: PhysicalBufferName[],
  change: "atLeast" | "atMost"
) {
  const map = fieldOf(state),
    changes: PoiFieldChange[] = [];
  for (const cell of place.cells)
    for (const band of bands) changes.push({ change, band, cell, value: map[band].get(cell) });
  return changes;
}
/** Greenwood's place rule on a place's cells keeps the verdure it has while it stands. */
export const verdureHeld =
  (rule: (state: GenerationState, cell: number) => boolean) =>
  (state: GenerationState, place: PoiPlace) =>
    floorsHeld("Verdure")(state, {
      ...place,
      cells: place.cells.filter((cell) => rule(state, cell)),
    });
export { oldStand, verdantCountry };

/**
 * Greenwood's root carriage as a multiplier: its edge cost falls as 1 / (0.1 + cover), written
 * against ground at its own cover floor, and it cannot enter its own barrier cells. The
 * contract's magic cost names no carrier: this is the living carrier only.
 */
export function rootCarriage(state: GenerationState, cell: number) {
  const greenwood = state.physical?.magic?.fields.find((f) => f.definition.id === "greenwood");
  if (!greenwood?.definition.enabled) return 1;
  const floor = greenwood.definition.parameters.rootFloor,
    cover = livingCoverAt(state, cell),
    map = fieldOf(state),
    barred =
      map.WaterKindCodes.get(cell) !== 0 ||
      map.IceThickness.get(cell) > 0 ||
      (cover < floor && map.SoilDepth.get(cell) < 0.3);
  return barred ? Infinity : (0.1 + floor) / (0.1 + cover);
}

/** The same ground is never two of these: the relation that names it. */
export const sharesNoGround = (...kinds: PoiKindId[]): PoiRelation[] =>
  kinds.map((kind) => ({ kind, holds }));
/** A place's cells hold the other's anchor: the same test, read as containing it. */
export const standsIn = sharesNoGround;
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
