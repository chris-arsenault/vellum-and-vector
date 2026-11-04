import { desertMoisture, windStrength } from "../../canonry/ecologyEnvironment";
import type { GenerationState } from "../../process";
import { carryWhereItLands, stays } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiHazard, type PoiPlace } from "../poiContract";
import { namingCultureNear, within } from "../poiPlaces";
import { cellSpan, fieldOf, rockAt } from "../poiReads";
import { weighed } from "../poiVisibilityRules";
import { isFamily, landscapePlaces, landscapeRecord } from "./coverLandscape";
import {
  borders,
  countryCounterpart,
  countryFactors,
  coverCosts,
  coverWrites,
  hazardReach,
  livingCoverAt,
  meanOver,
  otherLandscapes,
  plantWaterAt,
  sharesNoGround,
  standsIn,
  waterlessRoads,
} from "./coverShared";

/** Area at which barren ground is half as great as it gets: 100,000 square kilometres. */
const typicalArea = 1e11;
/** The soil depth, in metres, from which returning rain can start cover. */
const startingSoil = 0.3;
const isA = isFamily("barren");
const bareness = (state: GenerationState, cell: number) => 1 - livingCoverAt(state, cell);
const places = landscapePlaces("barren", "barren", bareness);
const factors = countryFactors(places, typicalArea, bareness);
const counterpart = countryCounterpart(isA);
const nearby = (state: GenerationState) => 4 * cellSpan(state);

function dangers(state: GenerationState, place: PoiPlace): PoiHazard[] {
  const reach = hazardReach(state, place),
    dry = meanOver(state, place, (s, cell) => 1 - plantWaterAt(s, cell)),
    wind = meanOver(state, place, (s, cell) => windStrength(fieldOf(s), cell));
  return [
    { hazard: "thirst", reach, severity: dry },
    { hazard: "dust and moving sand", reach, severity: Math.min(1, (dry * wind) / 2) },
  ];
}

export const barren: PoiEntry = {
  id: "barren",
  group: "cover",
  name: "Barren",
  recognition: {
    distinct:
      "Land whose biome class is in the barren family, as the biome layer shows it: Barren or Desert. It is an absence of cover, so grassland starts where living cover reaches the class line, and ice is no class of it. Aurora's glow-lichen ground and Salt's pans and glass flats are bare too, but belong to families of their own.",
    isA,
  },
  existence: {
    statement:
      "Emerges where nothing grows: too dry, too steep, too new or too harmed. Hot and cold desert, polar desert and rock barrens are its properties, read from its temperature, slope and height and published as its biome.",
    way: "emerges",
    requires: notApplicable(
      "It requires only that cover be absent, which is its own class; no place has to precede it."
    ),
    suitability: notApplicable("No process picks barren ground; it is what is left."),
    places,
  },
  publication: {
    statement:
      "Each region publishes as barren land on the ecology layer, outlined by the biome class margin and named for its biome; a region of under three cells publishes nothing.",
    moment: "geography",
    record: landscapeRecord("barren", "barren", places),
  },
  fields: {
    statement:
      "Bare ground sheds its water and its soil: no roots to take rain in or keep wind and creep off, so runoff comes fast and no moisture is returned to the air. The soil and climate processes read that absence over the whole field; bare sediment moves as dunes through the wind's own process.",
    ...coverWrites,
  },
  acrossMaps: {
    statement:
      "Cover bands capture onto the child and develop there, so wadis and oases appear inside a desert the world held as one thing. A carried barren name moves to the nearest bare ground, and stays where it landed if the fine ground greened there, because one green valley does not stop a desert being one.",
    carry: carryWhereItLands,
    realize: notApplicable(
      "A place defined by no cover has nothing to force: the ecology decides it on the finer ground."
    ),
    counterpart,
    unrealized: stays,
    settle: stays,
    schedule: notApplicable("Barren ground does nothing at refinement's other points."),
  },
  movement: {
    statement:
      "Roads pay for waterless ground under the desert's own moisture line, which no router reads; rock barrens already pay for their grade. Greenwood's roots cannot enter bare ground on thin soil, by their own propagation's read of every cell.",
    ...coverCosts,
    roads: waterlessRoads,
  },
  others: {
    statement:
      "It shares no ground with another landscape or with water, though a salt pan or flat often borders it. Oases, mines and well-kept ruins stand in it and ejecta fans lie across it.",
    needs: notApplicable("Barren ground needs no other place."),
    excludes: [...otherLandscapes("barren"), ...sharesNoGround("saltPan", "glassFlat")],
    contains: standsIn("oasis", "mine", "ruin", "ejectaFan"),
    pairsWith: [
      ...borders("grassland", "saltPan", "saltDust", "glassFlat"),
      { kind: "settlement", holds: within(nearby) },
    ],
  },
  people: {
    statement:
      "It offers stone and whatever else is exposed, with nothing to feed anyone. Crossing it kills by thirst, and it blows onto those beside it.",
    offers: (state, place) => ({ materials: meanOver(state, place, rockAt) }),
    threatens: dangers,
  },
  time: {
    statement:
      "Bare ground lasts as long as what bares it. Rain on enough soil lets grass in and it becomes grassland; ground left by ice or lava starts its cover this way.",
    fate(state, place) {
      const watered = meanOver(state, place, plantWaterAt) >= desertMoisture,
        soil = meanOver(state, place, (_s, cell) => fieldOf(state).SoilDepth.get(cell));
      return watered && soil >= startingSoil
        ? { fate: "becomes", kind: "grassland" }
        : { fate: "persists" };
    },
  },
  visibility: {
    statement:
      "Barren country weighs by its breadth and how sharply it breaks from green land; a bare patch among forest draws the eye before the same patch inside a desert. A small one has little else to earn it weight unless people are tied to it.",
    ...factors,
    importance: weighed(factors, { magnitude: 0.55, localConditions: 0.3, isolation: 0.15 }),
  },
  naming: {
    statement: "Named by the people on its edges, if any; it may go unnamed.",
    namedBy: namingCultureNear,
    takesNameFrom: notApplicable("Its name comes from what it is, not from a place beside it."),
    lendsNameTo: notApplicable("Few take the name of an empty place on purpose."),
  },
};
