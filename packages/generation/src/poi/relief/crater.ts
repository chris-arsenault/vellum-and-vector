import { Feature } from "../../canonry/codes";
import type { GenerationState } from "../../process";
import { carryWhereItLands, costNear, stays } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiFate, type PoiPlace } from "../poiContract";
import { holds, namingCultureNear, regionPlaces, within } from "../poiPlaces";
import { fieldOf, isLake, landformAt, Landform, magicRule, magicValue, metres } from "../poiReads";
import { aloneAmong, attachment, drawnWhen, sized, standsOut } from "../poiVisibilityRules";
import {
  areaOf,
  holdAt,
  landmarkGround,
  loweredAsCaptured,
  meanOf,
  nearestOrFloor,
  reliefOf,
  sameSpot,
  sitingAdmits,
  sitingSuits,
  spans,
} from "./reliefShape";

/** Relief and area at which a crater is half as great as craters get: a world crater's. */
const typicalRelief = 150,
  typicalArea = 700_000_000;
/** The rim's dear ground to the network, as the regional landmark cause has it. */
const rimCost = 4;

const craterLake = magicRule("fire", "crater");
const inRing = (state: GenerationState, cell: number) =>
  landmarkGround(state, "impact-ring", (placed) => (placed.parameters.diameter * 1000) / 2).has(
    cell
  );
const classed = (state: GenerationState, cell: number) => {
  const code = landformAt(state, cell);
  return code === Landform.ImpactBasin || code === Landform.ImpactRim;
};
const isCentre = (state: GenerationState, cell: number) =>
  (fieldOf(state).FeatureFlags.get(cell) & Feature.ImpactCenter) !== 0;
const isA = (state: GenerationState, cell: number) =>
  classed(state, cell) || isCentre(state, cell) || craterLake(state, cell) || inRing(state, cell);
const excavationAt = (state: GenerationState, cell: number) =>
  metres(fieldOf(state).ImpactExcavation.get(cell));
const places = regionPlaces("crater", isA, excavationAt);
const counterpart = nearestOrFloor(isA);
const fallenSource = (state: GenerationState, place: PoiPlace) =>
  magicValue(state, "fire", "source", place.anchor) / 1000;
const factors = {
  magnitude: meanOf(sized(reliefOf, typicalRelief), sized(areaOf, typicalArea)),
  localConditions: standsOut(excavationAt, spans(6)),
  isolation: aloneAmong(places, spans(12)),
  cultural: attachment(spans(8)),
};

export const crater: PoiEntry = {
  id: "crater",
  group: "relief",
  name: "Crater",
  recognition: {
    distinct:
      "A cell the classifier marks ImpactBasin or ImpactRim from the excavation and rim uplift bands, the cell flagged ImpactCenter, a cell of Fire's crater-lake rule, or one inside an impact-ring record's radius. Only a falling body writes those bands, so a caldera (a flagged collapse) and a basin (no excavation) cannot pass. Ejecta lies outside the rim and is its own kind. Fire's crater lake is the same pit with water and metal in it, kept as a property.",
    isA,
  },
  existence: {
    statement:
      "Both: falling bodies strike at epochs the generator chooses for any ground, and an impact-ring record emplaces one of a chosen size and maintains its rim and floor. Water, sediment and uplift then work on what was left.",
    way: "both",
    requires: sitingAdmits("impact-ring"),
    suitability: sitingSuits("impact-ring"),
    places,
  },
  fields: {
    statement:
      "A crater is a pit with a raised rim in shocked, fractured rock, a closed basin that holds water, and a store of fallen metal Fire reads as a finite source. Its heat fades after the fall, with a burning epoch at first.",
    terrain(state, place) {
      const map = fieldOf(state),
        rim = place.cells.filter((cell) => map.ImpactRimUplift.get(cell) > 0),
        floor = place.cells.filter((cell) => map.ImpactExcavation.get(cell) > 0);
      return [
        ...holdAt(state, "atLeast", "Elevation", rim),
        ...holdAt(state, "atMost", "Elevation", floor),
        ...holdAt(state, "atLeast", "RockResistance", place.cells),
      ];
    },
    water: (state, place) =>
      holdAt(
        state,
        "atLeast",
        "WaterSurfaceElevations",
        place.cells.filter((cell) => isLake(state, cell))
      ),
    climate: notApplicable(
      "A fall's darkened years have no band; the map sees the pit, not the winter after it."
    ),
    cover: notApplicable(
      "The fan around it is barren by its own entry; life returns to the pit through ecology."
    ),
    magic: (state, place) => [
      ...holdAt(state, "atLeast", "FractureConductance", place.cells),
      ...holdAt(state, "atLeast", "ImpactHeat", place.cells),
    ],
  },
  acrossMaps: {
    statement:
      "A captured crater is realized as a floor no higher than the parent's, with a dear rim the network runs around. An impact-ring record is re-placed and maintained by its own cause; maps below the world carry no impact bands, so an emergent crater's counterpart is the lowest ground near it, and the record stays.",
    carry: carryWhereItLands,
    realize: (state, carried) => loweredAsCaptured(state, carried, counterpart(state, carried)),
    counterpart,
    unrealized: stays,
    settle: notApplicable("A round's water may fill its lake without moving the pit."),
  },
  movement: {
    statement:
      "A rim is a ring of dear ground that turns water and roads around it; the fractured rock beneath conducts Fire and anything else the crust carries.",
    roads: costNear(1.5),
    boats: notApplicable("A crater lake is closed; it joins no network boats travel."),
    drainage: costNear(rimCost),
    magic: costNear(0.7),
    crosses: notApplicable("A ring bars routes; it takes none across anything."),
  },
  others: {
    statement:
      "A crater has its ejecta around it, a lake and a compass deviation in it, and placers in the gravels below; it is never on the spot of a volcano's caldera or a dome.",
    needs: notApplicable("A falling body needs no ground prepared."),
    excludes: [
      { kind: "caldera", holds: sameSpot },
      { kind: "dome", holds: sameSpot },
    ],
    contains: [
      { kind: "lake", holds },
      { kind: "compassDeviation", holds },
    ],
    pairsWith: [
      { kind: "ejectaFan", holds: within(spans(8)) },
      { kind: "placer", holds: within(spans(10)) },
      { kind: "killingGround", holds: within(spans(4)) },
    ],
  },
  people: {
    statement:
      "A crater holds fallen metal people dig for, in proportion to what still releases Fire, and it is a marked place for those who remember the fall. While its heat lasts the floor is a burning field.",
    offers: (state, place) => ({
      materials: fallenSource(state, place),
      sanctity: factors.magnitude(state, place) / 2,
    }),
    threatens: (state, place) =>
      fieldOf(state).ImpactHeat.get(place.anchor) > 0
        ? [
            {
              hazard: "burning ground",
              reach: spans(2)(state),
              severity: fieldOf(state).ImpactHeat.get(place.anchor) / 1000,
            },
          ]
        : [],
  },
  time: {
    statement:
      "A crater is at its sharpest the epoch it falls; rims wear, floors fill, lakes come and go, and the rock stays hard. When it no longer reads as a pit, only its fan and gravels remain.",
    fate(state, place): PoiFate {
      return isA(state, place.anchor)
        ? { fate: "persists" }
        : { fate: "ends", leaves: "ejectaFan" };
    },
  },
  visibility: {
    statement:
      "A crater shows while its form survives, by surviving relief and width; a young sharp pit in plains shows long before a worn one in hills, and a town on its rim carries it.",
    ...factors,
    visibleAt: drawnWhen(factors, { magnitude: 0.6, localConditions: 0.3, isolation: 0.1 }),
  },
  naming: {
    statement: "Named by those who live near it, often for the fall itself where it is remembered.",
    namedBy: namingCultureNear,
    takesNameFrom: notApplicable("A crater is older than anything nearby that could lend a name."),
    lendsNameTo: [
      { kind: "lake", holds },
      { kind: "ejectaFan", holds: within(spans(8)) },
    ],
  },
};
