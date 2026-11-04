import type { GenerationState } from "../../process";
import { carryWhereItLands, costNear, counterpartOf, movesTo, stays } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiFieldChange, type PoiPlace } from "../poiContract";
import { holds, namingCultureNear, regionPlaces, within } from "../poiPlaces";
import { areaRecord } from "../poiRecords";
import { cellSpan, cellsWithin, celsiusAt, heightAt, isLand, isSea, slopeAt } from "../poiReads";
import { aloneAmong, attachment, sized, standsOut, weighed } from "../poiVisibilityRules";
import { areaOf, depthAt, extentOf, faunaAt, heldUnder, near, shoreOf, stormAt } from "./seaShared";
import { showsForm, wrapOf } from "./shoreForm";

/** Area at which a bay is half as great as bays get: 1,000 square kilometres. */
const typicalArea = 1e9;
/** The sea bed a bay holds under its water, and the depth at which it counts as silted up. */
const heldDepth = 1,
  siltedDepth = 2;
/** The low, flat head where salt marsh forms, and the marsh's share of that ground. */
const marshHeight = 2,
  marshSlope = 0.01,
  marshCover = 0.3;
/** Warm water and shallows shallower than this are worth raking for salt. */
const saltWarmth = 15,
  saltDepth = 10;
/** Boats' cost on sheltered water. */
const shelteredWater = 0.8;
/** Rivers converge on a bay's head; current-borne magic slackens in its water. */
const drawnDrainage = 0.85,
  slackCurrent = 1.3;

const isA = showsForm("bay");
const places = regionPlaces("bay", isA, wrapOf);
/** The country around a bay that bears on it: 40 km. */
const around = near(40_000);
const reachOf = (state: GenerationState, place: PoiPlace) =>
  Math.max(2 * cellSpan(state), extentOf(state, place));
const counterpart = counterpartOf(isA, 2);

const factors = {
  magnitude: sized(areaOf, typicalArea),
  localConditions: standsOut(wrapOf, (state, place) =>
    Math.max(around(state), 2 * extentOf(state, place))
  ),
  isolation: aloneAmong(places, around),
  cultural: attachment(around),
};

/** Salt marsh on the low, flat ground of its shore. */
const marsh = (state: GenerationState, place: PoiPlace): readonly PoiFieldChange[] =>
  shoreOf(state, place)
    .filter((cell) => heightAt(state, cell) <= marshHeight && slopeAt(state, cell) <= marshSlope)
    .map((cell) => ({ change: "atLeast", band: "WetlandCover", cell, value: marshCover }));

export const bay: PoiEntry = {
  id: "bay",
  group: "sea",
  name: "Bay",
  recognition: {
    distinct:
      "A sea cell that, on the smallest circle, of radius 1.5 to 800 km, that the map resolves and that shows any coastal form, has one unbroken arc of shore of at least 210 degrees and sea in what remains: water with a single opening. A strait shows two shores facing each other with water at both ends; a headland is the same reading on ground; a fjord is excluded by its landform, because ice cut it.",
    isA,
  },
  existence: {
    statement:
      "Emerges where the shore curves around water: drowned low ground, soft rock cut back between harder points, or a coast bent by coastal detail and the Shoreline choice. Nothing places one, and it can be of any size the map resolves.",
    way: "emerges",
    requires: notApplicable("Its test reads the water mask; nothing must stand there first."),
    suitability: notApplicable("No process chooses where the coast curves."),
    places,
  },
  publication: {
    statement: "Every bay publishes as its outline, drawn by how closely its shore wraps it.",
    moment: "geography",
    record: areaRecord(
      {
        kind: "bay",
        layer: "geology",
        name: "Bay",
        attributes: (state, place) => ({ wrap: wrapOf(state, place.anchor) }),
      },
      wrapOf
    ),
  },
  fields: {
    statement:
      "A bay is a sink for what its rivers carry, kept open until it has silted to its last two metres, and its flat low shore grows salt marsh. The shelter on its water is the short fetch the wave process already reads there.",
    terrain: (state, place) => heldUnder(state, place.cells, heldDepth),
    water: notApplicable(
      "The ocean current process writes wave exposure from fetch, and refinement's shore development from the present coast; a bay's enclosure already shortens both."
    ),
    climate: notApplicable(
      "Sea ice reads wave exposure, so a sheltered bay freezes first through its water rule; its air is the ordinary coastal air."
    ),
    cover: marsh,
    magic: notApplicable(
      "Rays entering a bay already bounce and pile up in the beam tracer; a bay holds no magic beyond that, and Salt reads only what it leaves on the ground."
    ),
  },
  acrossMaps: {
    statement:
      "A captured bay keeps its water on the refined map: the bed under its anchor stays under the sea so shelter filling cannot close it. Its counterpart is the nearest cell the finer coast wraps; a broad bay whose finer shore is locally straight keeps its place, because the bay is still there at the parent's scale.",
    carry: carryWhereItLands,
    realize: (state, carried) =>
      heldUnder(
        state,
        carried.cells.filter((cell) => isSea(state, cell)),
        heldDepth
      ),
    counterpart,
    unrealized: movesTo(counterpart),
    settle: (state, carried) =>
      isSea(state, carried.cell) ? stays() : movesTo(counterpart)(state, carried),
    schedule: notApplicable("Holding its bed under the sea is all a bay does to a refinement."),
  },
  movement: {
    statement:
      "Boats pay less on a bay's calm water, and rivers gather towards its head. Roads pay nothing different on its shore. Current-borne magic slackens in it; Pressure's rays are traced by geometry and do not read this cost.",
    roads: notApplicable("A shore road follows the ordinary grade; the bay only lengthens it."),
    boats: costNear(shelteredWater),
    drainage: (state, place) =>
      cellsWithin(state, place.anchor, reachOf(state, place))
        .filter((cell) => isLand(state, cell))
        .map((cell) => ({ cell, factor: drawnDrainage })),
    magic: { current: costNear(slackCurrent) },
    links: notApplicable("A bay joins no two cells."),
    crosses: notApplicable("A bay is open water with one mouth; it joins nothing it divides."),
  },
  others: {
    statement:
      "A bay is where a harbour wants to be, and headlands commonly bound it. A river mouth or a wetland often lies at its head. A strait and a bay cannot share a cell, because the circle shows only one.",
    needs: notApplicable("Its test already requires the shore that wraps it."),
    excludes: [
      { kind: "strait", holds: (_state, a, b) => b.cells.includes(a.anchor) },
      { kind: "fjord", holds: (_state, a, b) => b.cells.includes(a.anchor) },
    ],
    contains: [
      { kind: "rogueWaveImpact", holds },
      { kind: "upwellingFront", holds },
    ],
    pairsWith: [
      { kind: "harbour", holds: within(around) },
      { kind: "headland", holds: within(around) },
      { kind: "riverMouth", holds: within(around) },
      { kind: "wetland", holds: within(around) },
    ],
  },
  people: {
    statement:
      "A bay gives safe anchorage, sheltered fishing, and salt raked from warm shallows. A storm track funnels surge up it, so the shelter that serves people on calm days endangers them on the worst.",
    offers(state, place) {
      const shallowWarm =
        celsiusAt(state, place.anchor) >= saltWarmth && depthAt(state, place.anchor) <= saltDepth;
      return {
        trade: wrapOf(state, place.anchor),
        food: faunaAt(state, place.anchor),
        materials: shallowWarm ? 0.5 : 0,
      };
    },
    threatens(state, place) {
      const storm = stormAt(state, place.anchor);
      return storm > 0
        ? [{ hazard: "storm surge", reach: reachOf(state, place), severity: storm }]
        : [];
    },
  },
  time: {
    statement:
      "A bay fills with what its rivers and the sheltered drift bring. Once its heart has silted to two metres it ends as tidal flat and marsh, and a fall of sea level ends it sooner by the same test. Tectonics can reopen one as a new place.",
    fate: (state, place) =>
      depthAt(state, place.anchor) <= siltedDepth
        ? { fate: "ends", leaves: "wetland" }
        : { fate: "persists" },
  },
  visibility: {
    statement:
      "A bay shows by the water it encloses and by how sharply it breaks its coast; size weighs most because it is what a chart is read for. A harbour town on a small bay carries it.",
    ...factors,
    importance: weighed(factors, { magnitude: 0.5, localConditions: 0.3, isolation: 0.2 }),
  },
  naming: {
    statement: "Named by those who live around it, and often after the town at its head.",
    namedBy: namingCultureNear,
    takesNameFrom: [{ kind: "settlement", holds: within(around) }],
    lendsNameTo: [{ kind: "harbour", holds: within(around) }],
  },
};
