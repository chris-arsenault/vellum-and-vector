import { environment } from "../../canonry/ecologyEnvironment";
import type { GenerationState } from "../../process";
import { carryWhereItLands, stays } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiFieldChange, type PoiPlace } from "../poiContract";
import { namingCultureNear, settlementWithin, within } from "../poiPlaces";
import {
  cellSpan,
  cellsWithin,
  celsiusAt,
  fieldOf,
  iceAt,
  isLand,
  slopeAt,
  treeCoverAt,
} from "../poiReads";
import { aloneAmong, attachment, drawnWhen, sized, standsOut } from "../poiVisibilityRules";
import {
  borders,
  ceilingsHeld,
  clearancePlaces,
  clearanceRadius,
  floorsHeld,
  isKind,
  meanOver,
  onPlace,
  rootCarriage,
  sharesNoGround,
  standsIn,
  withinOwn,
} from "./coverShared";

/** The tree cover the works planner asks for before proposing a clearance. */
const treesWorthClearing = 0.25;
/** The steepest ground regional fields are laid on, and the deepest ice. */
const steepestField = 0.12,
  iceOnField = 1;
/** Soil depth in metres at which farming reads full, and warmth over which it does. */
const fullSoil = 0.5,
  coldField = -2,
  warmSpan = 16,
  fullWater = 0.5;
/** Tree cohorts left standing on a field, and the grass that replaces them, as regional fields hold them. */
const standingShare = 0.2,
  fieldGrass = 0.2;
/** A worked clearance runs lanes that cut a road's cost; opened ground cuts channels sooner. */
const fieldLanes = 0.8,
  openChannel = 0.8;
/** Radius in metres at which a clearance is half as great as clearances get, and the works' cap on it. */
const typicalRadius = 2500,
  farthestWork = 5000;

const clamped = (value: number) => Math.max(0, Math.min(1, value));
const isA = isKind("clearance");
const places = clearancePlaces;
const farmable = (state: GenerationState, cell: number) =>
  isLand(state, cell) && slopeAt(state, cell) <= steepestField && iceAt(state, cell) < iceOnField;
/** Soil, water, warmth and gentle slope, as the regional fields' ranking reads them. */
function farming(state: GenerationState, cell: number) {
  return (
    clamped(fieldOf(state).SoilDepth.get(cell) / fullSoil) *
    clamped(environment(fieldOf(state), cell).moisture / fullWater) *
    clamped((celsiusAt(state, cell) - coldField) / warmSpan) *
    clamped(1 - slopeAt(state, cell) / steepestField)
  );
}
const radiusOf = (_state: GenerationState, place: PoiPlace) => clearanceRadius(place.feature);
const around = (state: GenerationState, place: PoiPlace) =>
  Math.max(2 * cellSpan(state), 2 * radiusOf(state, place));
const openness = (state: GenerationState, cell: number) => 1 - treeCoverAt(state, cell);
const factors = {
  magnitude: sized(radiusOf, typicalRadius),
  localConditions: standsOut(openness, around),
  isolation: aloneAmong(places, around),
  cultural: attachment(around),
};
const treeBands = [
  "BroadleafCover",
  "ConiferCover",
  "BroadleafSaplings",
  "ConiferSaplings",
] as const;
/** The trees it took and keeps down, against what `stood` says grew there, and the grass in their place. */
function opened(
  cells: readonly number[],
  stood: (band: (typeof treeBands)[number], cell: number) => number
): PoiFieldChange[] {
  return cells.flatMap((cell): PoiFieldChange[] => [
    ...treeBands.map((band): PoiFieldChange => ({
      change: "atMost",
      band,
      cell,
      value: stood(band, cell) * standingShare,
    })),
    { change: "atLeast", band: "GrassCover", cell, value: fieldGrass },
  ]);
}

export const clearance: PoiEntry = {
  id: "clearance",
  group: "cover",
  name: "Clearance",
  recognition: {
    distinct:
      "A published work of kind clearance and the ground its recorded radius covers: it is decided by the record, never by low tree cover, since grassland is low tree cover nobody cut. A burning is a different work on the same channels, and a village's regional fields are not records. On its ground the record comes before every reading of cover.",
    isA,
  },
  existence: {
    statement:
      "Sited by people: the society's works planner proposes one where a community of at least 500 finds tree cover over 0.25 and farming would support it better than gathering does. Today it does not reach a map: world works are demands and are never published, and refined maps make fields without a clearance record, so this kind has no places on either.",
    way: "sited",
    requires: (state, cell) =>
      farmable(state, cell) &&
      treeCoverAt(state, cell) > treesWorthClearing &&
      settlementWithin(state, cell, Math.max(farthestWork, 2 * cellSpan(state))),
    suitability: farming,
    places,
  },
  fields: {
    statement:
      "People take the trees and keep them down, and grass stands in their place. The soil, no longer bound, wastes away on slopes; rain runs off faster; less goes back into the air; and any Greenwood sap in the wood burns with it. The cover stays cleared only while people work it.",
    terrain: ceilingsHeld("SoilDepth"),
    water: floorsHeld("Runoff"),
    climate: ceilingsHeld("Evapotranspiration"),
    cover: (state, place) => opened(place.cells, (band, cell) => fieldOf(state)[band].get(cell)),
    magic: ceilingsHeld("Verdure"),
  },
  acrossMaps: {
    statement:
      "A captured clearance keeps where it landed, and the child's cover is held open over the ground its radius reaches, each round, because refinement's own ecology would regrow it. It stays where it landed: no fine ground undoes a record. There is nothing to carry today, because the world publishes none.",
    carry: carryWhereItLands,
    /** Against the captured cohorts where the round holds them, so clearing each round does not ratchet. */
    realize: (state, carried) =>
      opened(cellsWithin(state, carried.cell, clearanceRadius(carried.feature)), (band, cell) =>
        (state.regional.natural[band] ?? fieldOf(state)[band]).get(cell)
      ),
    counterpart: (_state, carried) => carried.cell,
    unrealized: stays,
    settle: notApplicable(
      "A field does not move with a round's water; a flooded one stays recorded, and its people leave."
    ),
  },
  movement: {
    statement:
      "Lanes run across worked land, so roads pay less; opened ground takes channels sooner than wooded ground; and Greenwood's roots find less cover to travel through.",
    roads: onPlace(() => fieldLanes),
    boats: notApplicable("A clearing has no water of its own to carry a boat."),
    drainage: onPlace(() => openChannel),
    magic: onPlace(rootCarriage),
    crosses: notApplicable("Open fields cross no barrier a road would otherwise meet."),
  },
  others: {
    statement:
      "It needs the people who keep it and is cut out of forest, with whose edge it runs. It shares no other cover's ground. Irrigation and mills belong to the same people's land.",
    needs: [
      { kind: "settlement", holds: within((state) => Math.max(farthestWork, 2 * cellSpan(state))) },
    ],
    excludes: sharesNoGround("forest", "grassland", "barren", "thawedHalo", "wildZone", "wetland"),
    contains: standsIn("irrigation"),
    pairsWith: [...borders("forest"), { kind: "mill", holds: withinOwn(around) }],
  },
  people: {
    statement:
      "It gives food from the ground's own farming value, and timber while the trees are coming down. On slopes, wasting soil silts the valley below it.",
    offers: (state, place) => ({
      food: meanOver(state, place, farming),
      materials: 0.3 * meanOver(state, place, treeCoverAt),
    }),
    threatens(state, place) {
      const steep = meanOver(state, place, slopeAt) / steepestField;
      return steep > 0
        ? [{ hazard: "soil wash", reach: around(state, place), severity: clamped(steep) }]
        : [];
    },
  },
  time: {
    statement:
      "It lasts as long as the work is maintained. When a community goes or stops keeping it up, the ground regrows and it becomes forest.",
    fate: (_state, place) =>
      place.feature?.attributes.maintained === false
        ? { fate: "becomes", kind: "forest" }
        : { fate: "persists" },
  },
  visibility: {
    statement:
      "A clearance is small, so it earns its place by contrast and by people: a cut-out in deep forest beside a city shows before a far larger one on half-open ground. Its people outweigh its size.",
    ...factors,
    visibleAt: drawnWhen(factors, { magnitude: 0.25, localConditions: 0.55, isolation: 0.2 }),
  },
  naming: {
    statement:
      "Named by the community that made it, as the work records, from the plain words for a clearing or fields; failing a record, by the people nearest.",
    namedBy(state, place) {
      const culture = place.feature?.attributes.namingCulture;
      return typeof culture === "string" ? culture : namingCultureNear(state, place);
    },
    takesNameFrom: [{ kind: "settlement", holds: withinOwn(around) }],
    lendsNameTo: notApplicable("It takes the community's name and gives none back."),
  },
};
