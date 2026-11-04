import type { GenerationState } from "../../process";
import { carryWhereItLands, costNear, counterpartOf, movesTo } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiPlace } from "../poiContract";
import { holds, namingCultureNear, regionPlaces, within } from "../poiPlaces";
import {
  adjacent,
  fieldOf,
  isLake,
  landformAt,
  Landform,
  metres,
  wetlandCoverAt,
} from "../poiReads";
import { aloneAmong, attachment, drawnWhen, sized, standsOut } from "../poiVisibilityRules";
import {
  areaOf,
  holdAt,
  lastsWhile,
  meanOf,
  raisedAsCaptured,
  reliefOf,
  sameSpot,
  spans,
} from "./reliefShape";

/** Area and relief at which a moraine is half as great as they get: a world complex's. */
const typicalArea = 8e9,
  typicalRelief = 300;
/** A wet cell beside a moraine counts where this share of it is wetland. */
const wetShare = 0.2;

const isA = (state: GenerationState, cell: number) => landformAt(state, cell) === Landform.Moraine;
const tillAt = (state: GenerationState, cell: number) =>
  metres(fieldOf(state).CumulativeGlacialDeposition.get(cell));
const places = regionPlaces("moraine", isA, tillAt);
const counterpart = counterpartOf(isA, 1);
const lakeBehind = (state: GenerationState, place: PoiPlace) =>
  place.cells.some((cell) => [...adjacent(state, cell)].some((next) => isLake(state, next)));
const wetBeside = (state: GenerationState, place: PoiPlace) =>
  place.cells.some((cell) =>
    [...adjacent(state, cell)].some((next) => wetlandCoverAt(state, next) >= wetShare)
  );
const factors = {
  magnitude: meanOf(sized(areaOf, typicalArea), sized(reliefOf, typicalRelief)),
  localConditions: standsOut(tillAt, spans(8)),
  isolation: aloneAmong(places, spans(10)),
  cultural: attachment(spans(6)),
};

export const moraine: PoiEntry = {
  id: "moraine",
  group: "relief",
  name: "Moraine",
  recognition: {
    distinct:
      "A land cell the generator classes Landform.Moraine: under sustained grounded ice flux, with at least the profile's depth of glacial deposition. It is till, not shape: river and slope deposits do not count, an outwash plain is the flat washed out below it, a cirque or U-valley is where the ice cut rather than dropped. Terminal, lateral and ground till are one kind, differing only in how much was laid where.",
    isA,
  },
  existence: {
    statement:
      "Emerges at the places ice stood and dropped its load; it is left behind after the glacier retreats and needs no ice to go on being one.",
    way: "emerges",
    requires: notApplicable("The class exists only where glacial deposition passed its test."),
    suitability: notApplicable("Nothing chooses it; the ice's termini do."),
    places,
  },
  fields: {
    statement:
      "A moraine is a loose ridge that dams water behind it, a porous store under it, and the deep soil of the ground the ice left. Aurora's stock the ice dropped lies in it.",
    terrain: (state, place) => holdAt(state, "atLeast", "Elevation", place.cells),
    water(state, place) {
      const behind = place.cells.flatMap((cell) =>
        [...adjacent(state, cell)].filter((next) => isLake(state, next))
      );
      return holdAt(state, "atLeast", "WaterSurfaceElevations", behind);
    },
    climate: notApplicable("Its rise is far below what the air columns turn."),
    cover: (state, place) => holdAt(state, "atLeast", "SedimentThickness", place.cells),
    magic: notApplicable(
      "The charge the ice dropped sits in Aurora's own moraine stock and rides the crust by that system's rules."
    ),
  },
  acrossMaps: {
    statement:
      "A captured moraine keeps its class through the captured landform band and stands as high as the parent's ground did, keeping any lake behind it. If no moraine cell reads there, it takes the nearest.",
    carry: carryWhereItLands,
    realize: (state, carried) => raisedAsCaptured(state, carried, counterpart(state, carried)),
    counterpart,
    unrealized: movesTo(counterpart),
    settle: notApplicable("A round's water can back up a lake without moving the till."),
  },
  movement: {
    statement:
      "A moraine is firm, drained ground through wet country, so roads take it as a causeway. Water backs up against it and breaks through at its low points.",
    roads: costNear(0.9),
    boats: notApplicable("Till holds a lake in; it offers boats nothing of its own."),
    drainage: costNear(2),
    magic: notApplicable(
      "Aurora's dropped stock rides the crust; a till ridge does not change that."
    ),
    crosses: (state, place) => (wetBeside(state, place) ? ["wetland"] : []),
  },
  others: {
    statement:
      "A moraine lies below the cirques and U-valleys that fed it, and holds in the lakes and wetlands behind it; it shares no cell with a cirque.",
    needs: notApplicable("Its class already required the ice that left it."),
    excludes: [{ kind: "cirque", holds: sameSpot }],
    contains: notApplicable("It is a body of till; what is near it is recognized on its own."),
    pairsWith: [
      { kind: "cirque", holds: within(spans(8)) },
      { kind: "valley", holds },
      { kind: "lake", holds: within(spans(3)) },
      { kind: "wetland", holds: within(spans(3)) },
    ],
  },
  people: {
    statement:
      "A moraine gives gravel, a dry road and dry building ground over wet land. A lake it holds up can break through it all at once and scour the valley.",
    offers(state, place) {
      const great = factors.magnitude(state, place);
      return { materials: great, trade: wetBeside(state, place) ? great : great / 2 };
    },
    threatens: (state, place) =>
      lakeBehind(state, place)
        ? [
            {
              hazard: "moraine-dam outburst",
              reach: spans(6)(state),
              severity: factors.magnitude(state, place),
            },
          ]
        : [],
  },
  time: {
    statement:
      "Fresh till is sharp and is soon rounded, cut through and vegetated; the class is retained long after, and a moraine ends only when erosion has taken the deposit it reads.",
    fate: lastsWhile(isA),
  },
  visibility: {
    statement:
      "A moraine shows only at the scale of a whole complex, by its extent and relief; most are local. One holding a known lake or carrying a road through wet country is carried by people.",
    ...factors,
    visibleAt: drawnWhen(factors, { magnitude: 0.7, localConditions: 0.15, isolation: 0.15 }),
  },
  naming: {
    statement: "Named by farmers and road-builders nearby, usually for the lake or town beside it.",
    namedBy: namingCultureNear,
    takesNameFrom: [
      { kind: "lake", holds: within(spans(3)) },
      { kind: "settlement", holds: within(spans(4)) },
    ],
    lendsNameTo: notApplicable("A till ridge is too minor for anything to take its name."),
  },
};
