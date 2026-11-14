// @needsResolution carry: a carried place may not resolve on a finer map (ADR 0009).
import { MapScale } from "@atlas/domain";
import type { GenerationState } from "../../process";
import { carryWhereItLands, costNear, counterpartOf, movesTo } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiPlace } from "../poiContract";
import { holds, namingCultureNear, regionPlaces, within } from "../poiPlaces";
import { areaRecord } from "../poiRecords";
import { fieldOf, iceAt, landformAt, Landform, slopeAt } from "../poiReads";
import { aloneAmong, attachment, sized, standsOut, weighed } from "../poiVisibilityRules";
import { areaOf, lastsWhile, meanOf, reliefOf, sameSpot, spans } from "./reliefShape";

/** Area and relief at which a cirque is half as great as they get: part of a world complex. */
const typicalArea = MapScale.area(0.00005),
  typicalRelief = MapScale.length(0.000075, 0.5);
/** The gradient of a head wall steep enough to shed its snow. */
const sheddingGrade = 0.15;

const isA = (state: GenerationState, cell: number) => landformAt(state, cell) === Landform.Cirque;
const maxIceAt = (state: GenerationState, cell: number) =>
  fieldOf(state).MaximumIceThickness.get(cell);
const places = regionPlaces("cirque", isA, maxIceAt);
const counterpart = counterpartOf(isA, 1);
const iced = (state: GenerationState, place: PoiPlace) => iceAt(state, place.anchor) > 0;
const factors = {
  magnitude: meanOf(sized(areaOf, typicalArea), sized(reliefOf, typicalRelief)),
  localConditions: standsOut(maxIceAt, spans(6)),
  isolation: aloneAmong(places, spans(8)),
  cultural: attachment(spans(6)),
};

export const cirque: PoiEntry = {
  id: "cirque",
  group: "relief",
  name: "Cirque",
  recognition: {
    distinct:
      "A land cell the generator classes Landform.Cirque: on mountain ground under sustained ice flux, where the deepest ice ever held there stood strictly thicker than on every side. That strict maximum is what makes it an ice-cut head: a level ice sheet has none, a U-valley is the trough ice flowed down from one, and a moraine is what the ice dropped lower. The test keeps reading after the ice has gone; whether ice remains is a property.",
    isA,
  },
  existence: {
    statement:
      "Emerges where a valley glacier's head sat long enough to quarry a bowl into a mountain; only ice makes one, and it outlives its ice.",
    way: "emerges",
    requires: notApplicable(
      "The class exists only where the ice test passed; nothing else is asked."
    ),
    suitability: notApplicable("Nothing chooses a cirque's ground; the ice flux does."),
    places,
  },
  publication: {
    statement: "Each connected group of the class's cells publishes as its outline.",
    moment: "geography",
    record: areaRecord({ kind: "cirque", layer: "geology", name: "Cirque" }),
  },
  fields: {
    statement:
      "A cirque is a hollow and, while iced, a source of glacier and melt: it stores what falls on it, gives it down the valley over the year, and pools cold air.",
    terrain: notApplicable("Glacial erosion quarries the hollow."),
    water: notApplicable("The land-ice process writes its ice and melt."),
    climate: notApplicable(
      "Its cold pool is a regional shared medium; the field holds no band for it."
    ),
    cover: notApplicable("Bare rock and thin soil there already follow height and ice."),
    magic: notApplicable(
      "It sources nothing itself; Aurora's light well admits its class by its own rule and is its own entry."
    ),
  },
  acrossMaps: {
    statement:
      "Captured ground and glacial evidence let the child recognize a cirque after the ice retreats. Its name resolves on the local counterpart while the bowl develops independently.",
    carry: carryWhereItLands,
    realize: notApplicable(
      "Captured cirque ground develops locally without repeating glacial excavation."
    ),
    counterpart,
    unrealized: movesTo(counterpart),
    settle: notApplicable("A bowl is cut over epochs; a round's water does not shift it."),
    schedule: notApplicable("Its floor and drainage cost are all a cirque asks of a refinement."),
  },
  movement: {
    statement:
      "A head wall ends a valley road; water and ice both start here, so the network is drawn from it, and the ice carries what charge it holds down from here.",
    roads: notApplicable("The ruling-grade cost already reads its head wall."),
    boats: notApplicable("A tarn in a bowl is too high and closed for boats to matter."),
    drainage: costNear(0.6),
    magic: { ice: costNear(0.8) },
    links: notApplicable("A cirque joins nothing."),
    crosses: notApplicable("A bowl ends a route; it takes none across the ice or anything else."),
  },
  others: {
    statement:
      "A cirque heads a valley, stands below peaks and pairs with moraines lower down. A tarn or a light well may lie in it; a moraine does not stand at the same spot.",
    needs: notApplicable("Its class already required the ice and mountain it stands in."),
    excludes: [{ kind: "moraine", holds: sameSpot }],
    contains: [
      { kind: "lake", holds },
      { kind: "lightWell", holds },
    ],
    pairsWith: [
      { kind: "valley", holds: within(spans(4)) },
      { kind: "moraine", holds: within(spans(8)) },
      { kind: "peak", holds: within(spans(4)) },
    ],
  },
  people: {
    statement:
      "A cirque feeds the valley below with melt in dry months and is a holy high place for those who climb to it; its walls shed snow and rock on anyone inside.",
    offers: (state, place) => ({
      water: iced(state, place) ? factors.magnitude(state, place) : 0,
      sanctity: factors.magnitude(state, place) / 2,
    }),
    threatens: (state, place) =>
      iced(state, place) && slopeAt(state, place.anchor) >= sheddingGrade
        ? [{ hazard: "avalanche", reach: spans(2)(state), severity: 0.5 }]
        : [],
  },
  time: {
    statement:
      "A cirque deepens while ice sits in it and stands empty when the ice is gone, often with a tarn; it outlasts its glacier by many epochs and ends only when its class is no longer retained.",
    fate: lastsWhile(isA),
  },
  visibility: {
    statement:
      "A cirque shows by its width and depth and by how its deepest ice stood over the country around; ordinary cirques are local and only a complex of them, or one above a town, reaches a broad view.",
    ...factors,
    importance: weighed(factors, { magnitude: 0.6, localConditions: 0.2, isolation: 0.2 }),
  },
  naming: {
    statement: "Named by the valley below, if anyone climbs high enough to name it.",
    namedBy: namingCultureNear,
    takesNameFrom: [{ kind: "peak", holds: within(spans(4)) }],
    lendsNameTo: [{ kind: "lake", holds }],
  },
};
