import { environment, windStrength } from "../../canonry/ecologyEnvironment";
import type { GenerationState } from "../../process";
import { carryWhereItLands, stays } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiHazard, type PoiPlace } from "../poiContract";
import { namingCultureNear, regionPlaces, within } from "../poiPlaces";
import { cellSpan, fieldOf, rockAt } from "../poiReads";
import { drawnWhen } from "../poiVisibilityRules";
import {
  borders,
  ceilingsHeld,
  countryCounterpart,
  countryFactors,
  floorsHeld,
  hazardReach,
  isKind,
  livingCoverAt,
  meanOver,
  onPlace,
  rootCarriage,
  sharesNoGround,
  standsIn,
} from "./coverShared";

/** Area at which barren ground is half as great as it gets: 100,000 square kilometres. */
const typicalArea = 1e11;
/** The water supply `classifyBiome` draws under the desert classes. */
const desertBelow = 0.25;
/** What a road pays for ground with no water or fodder on it. */
const waterlessRoad = 1.5;
/** The soil depth, in metres, from which returning rain can start cover: Greenwood's own line for it. */
const startingSoil = 0.3;
const isA = isKind("barren");
const bareness = (state: GenerationState, cell: number) => 1 - livingCoverAt(state, cell);
const places = regionPlaces("barren", isA, bareness);
const factors = countryFactors(places, typicalArea, bareness);
const counterpart = countryCounterpart(isA);
const nearby = (state: GenerationState) => 4 * cellSpan(state);
const waterAt = (state: GenerationState, cell: number) =>
  environment(fieldOf(state), cell).moisture;

function dangers(state: GenerationState, place: PoiPlace): PoiHazard[] {
  const reach = hazardReach(state, place),
    dry = meanOver(state, place, (s, cell) => 1 - waterAt(s, cell)),
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
      "Land the ecology classes as Barren, Desert or Glow-lichen barrens, or cold ground, with TreeCover, GrassCover and WetlandCover summing under 0.12. It is an absence of cover, so grassland starts where the sum reaches 0.12 and any ice-covered cell is excluded. Salt's pan and glass-flat rule cells are bare too but read Salt's rules and belong to those entries; ground with a Greenwood rule goes to forest or grassland.",
    isA,
  },
  existence: {
    statement:
      "Emerges where nothing grows: too dry, too cold, too steep, too new or too harmed. Hot and cold desert, polar desert, rock barrens and Aurora's glow-lichen ground are its properties, read from the biome name and the region's temperature, slope and height. Lichen under stillness adds no cover, so it stays here.",
    way: "emerges",
    requires: notApplicable(
      "It requires only that cover be absent, which is its own test; no place has to precede it."
    ),
    suitability: notApplicable("No process picks barren ground; it is what is left."),
    places,
  },
  fields: {
    statement:
      "Bare ground sheds its water and its soil: no roots to take rain in or keep wind and creep off, so runoff comes fast and no moisture is returned to the air. Bare sediment moves as dunes through the wind's own process, the unbound slope gives way, and salt dust lifts.",
    terrain: ceilingsHeld("SoilDepth"),
    water(state, place) {
      return [...ceilingsHeld("Infiltration")(state, place), ...floorsHeld("Runoff")(state, place)];
    },
    climate: ceilingsHeld("Evapotranspiration"),
    cover: notApplicable("It is the absence of cover; there is nothing here for it to change."),
    magic: notApplicable(
      "Bareness adds no magic field of its own: the wind's lift of Salt's dust reads bare ground in Salt's own stock process, and Greenwood's limit is the carrier cost below."
    ),
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
  },
  movement: {
    statement:
      "Roads pay for waterless ground under the desert's own moisture line; rock barrens already pay for their grade. Greenwood's roots cannot enter bare ground on thin soil.",
    roads: onPlace((state, cell) => (waterAt(state, cell) < desertBelow ? waterlessRoad : 1)),
    boats: notApplicable("A river through a desert carries boats as any other reach."),
    drainage: notApplicable(
      "Bare ground is the baseline: only roots add to a channel's cost, and it has none."
    ),
    magic: onPlace(rootCarriage),
    crosses: notApplicable("Bare ground bridges nothing."),
  },
  others: {
    statement:
      "It shares no ground with other cover, a lake or Salt's pans and flats, though these often border it. Oases, mines and well-kept ruins stand in it and ejecta fans lie across it.",
    needs: notApplicable("Barren ground needs no other place."),
    excludes: sharesNoGround(
      "forest",
      "grassland",
      "thawedHalo",
      "wildZone",
      "clearance",
      "saltPan",
      "glassFlat",
      "lake"
    ),
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
      const watered = meanOver(state, place, waterAt) >= desertBelow,
        soil = meanOver(state, place, (_s, cell) => fieldOf(state).SoilDepth.get(cell));
      return watered && soil >= startingSoil
        ? { fate: "becomes", kind: "grassland" }
        : { fate: "persists" };
    },
  },
  visibility: {
    statement:
      "Barren country shows by its breadth and how sharply it breaks from green land; a bare patch among forest draws the eye before the same patch inside a desert. A small one has little else to earn it a place unless people are tied to it.",
    ...factors,
    visibleAt: drawnWhen(factors, { magnitude: 0.55, localConditions: 0.3, isolation: 0.15 }),
  },
  naming: {
    statement: "Named by the people on its edges, if any; it may go unnamed.",
    namedBy: namingCultureNear,
    takesNameFrom: notApplicable("Its name comes from what it is, not from a place beside it."),
    lendsNameTo: notApplicable("Few take the name of an empty place on purpose."),
  },
};
