import type { GenerationState } from "../../process";
import { carryWhereItLands, costNear, counterpartOf, parentSpanOf, stays } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiPlace } from "../poiContract";
import { holds, namingCultureNear, regionPlaces, within } from "../poiPlaces";
import { cellsWithin, grassCoverAt, heightAt, isLand, slopeAt } from "../poiReads";
import { aloneAmong, attachment, drawnWhen, sized, standsOut } from "../poiVisibilityRules";
import {
  areaOf,
  holdAt,
  holdGradient,
  lastsWhile,
  meanOf,
  sectionAt,
  spans,
  standsIn,
} from "./reliefShape";

/** Area at which a plateau is half as great as plateaus get: a world relief complex. */
const typicalArea = 8e9;
/** Height above its base where a plateau is half as tall as plateaus get. */
const typicalHeight = 1500;

const isA = (state: GenerationState, cell: number) => {
  if (!isLand(state, cell)) return false;
  const profile = state.physical!.profile;
  return (
    slopeAt(state, cell) <= profile.PlainSlopeThreshold &&
    heightAt(state, cell) >= profile.HillElevation &&
    sectionAt(state, cell).trough <= 0
  );
};
const places = regionPlaces("plateau", isA, heightAt);
const heightOf = (state: GenerationState, place: PoiPlace) => heightAt(state, place.anchor);
const counterpart = counterpartOf(isA, 1);
const factors = {
  magnitude: meanOf(sized(areaOf, typicalArea), sized(heightOf, typicalHeight)),
  /** Its height against the country around it: an edge over lowland, not a shelf in a range. */
  localConditions: standsOut(heightAt, spans(12)),
  isolation: aloneAmong(places, spans(16)),
  cultural: attachment(spans(10)),
};

export const plateau: PoiEntry = {
  id: "plateau",
  group: "relief",
  name: "Plateau",
  recognition: {
    distinct:
      "A land cell as flat as a plain by the generator's own plain slope, standing at least its hill elevation above the sea, with no cross-section flanking it. A lowland plain fails on height, a high basin or valley floor on its flanks, and a range on flatness. A basalt or glass flat is recognized by what it is made of, whatever its height; one may lie on a plateau. A plateau is what the range test deliberately leaves out.",
    isA,
  },
  existence: {
    statement:
      "Emerges where a broad block was raised without being cut up: the orogenic shoulder behind a belt, a lava pile, a craton standing high; rivers then dissect it from its edges.",
    way: "emerges",
    requires: notApplicable("It is read from the slope and height the generator wrote."),
    suitability: notApplicable("Nothing chooses a plateau's ground."),
    places,
  },
  fields: {
    statement:
      "A plateau holds a shape: its top stays level, its gradient low, and rivers rise on it and leave off its edge. Height alone cools it, through the lapse the climate already applies.",
    terrain: (state, place) => holdGradient(state, place.cells),
    water: notApplicable(
      "It stores none of its own; water runs to the edge through the ordinary drainage, and a lake on it is its own entry."
    ),
    climate: notApplicable(
      "Its cold and dry come from the height the climate field already reads."
    ),
    cover: (state, place) => holdAt(state, "atLeast", "GrassCover", place.cells),
    magic: notApplicable(
      "It neither sources nor bars magic; a level height is plain ground to every carrier."
    ),
  },
  acrossMaps: {
    statement:
      "A captured plateau keeps a level top on the refined map: the gradient within a parent's cell span is held to what the parent's flat allowed, so finer relief cannot turn a tableland into hills. It keeps its place if no flat cell reads there yet.",
    carry: carryWhereItLands,
    realize(state, carried) {
      const cell = counterpart(state, carried);
      return cell < 0
        ? []
        : holdGradient(
            state,
            cellsWithin(state, cell, parentSpanOf(state)),
            state.physical.profile.PlainSlopeThreshold
          );
    },
    counterpart,
    unrealized: stays,
    settle: notApplicable("A tableland does not change with a round's water."),
  },
  movement: {
    statement:
      "Once a road is up, a plateau is easy going; the climb is its edge, an escarpment with a cost of its own. Water rises on it and runs for its edge.",
    roads: costNear(0.85),
    boats: notApplicable("Rivers on its top are headwaters too small to carry boats."),
    drainage: costNear(1.3),
    magic: notApplicable("No carrier reads a level height differently from level lowland."),
    crosses: notApplicable("It is ground to cross, not a crossing."),
  },
  others: {
    statement:
      "A plateau ends in scarps, is cut by gorges, and can carry lakes, flats and settlements; a ridge line and a valley floor cannot both be on it.",
    needs: notApplicable("Height and flatness are all it asks."),
    excludes: [
      { kind: "lake", holds: standsIn },
      { kind: "valley", holds: standsIn },
    ],
    contains: [
      { kind: "settlement", holds },
      { kind: "basaltFlat", holds },
      { kind: "glassFlat", holds },
    ],
    pairsWith: [
      { kind: "escarpment", holds: within(spans(4)) },
      { kind: "gorge", holds: within(spans(6)) },
    ],
  },
  people: {
    statement:
      "A plateau is high pasture and a fortress country with edges few can climb; it gives grazing more than crops, in proportion to the grass that grows on it.",
    offers: (state, place) => ({
      food: grassCoverAt(state, place.anchor),
      defence: factors.magnitude(state, place),
    }),
    threatens: notApplicable(
      "Its level ground endangers no one; the drop at its edge is the scarp."
    ),
  },
  time: {
    statement:
      "A plateau is lowered and eaten from its edges by the rivers leaving it; when it no longer reads as level high ground it has been dissected into hills.",
    fate: lastsWhile(isA),
  },
  visibility: {
    statement:
      "A plateau shows by its area and height and by the lower country round it; area counts because a plateau is a region, and a small tableland over plains can show before a broad high shelf in a range.",
    ...factors,
    visibleAt: drawnWhen(factors, { magnitude: 0.5, localConditions: 0.4, isolation: 0.1 }),
  },
  naming: {
    statement: "Named by those who live on it or look up at it; its towns may share its name.",
    namedBy: namingCultureNear,
    takesNameFrom: notApplicable("A plateau is too large to be named for what stands on it."),
    lendsNameTo: [{ kind: "settlement", holds }],
  },
};
