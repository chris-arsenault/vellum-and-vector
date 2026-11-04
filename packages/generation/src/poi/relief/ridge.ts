import type { GenerationState } from "../../process";
import { carryWhereItLands, costNear, counterpartOf, movesTo } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiPlace } from "../poiContract";
import { holds, namingCultureNear, regionPlaces, within } from "../poiPlaces";
import { areaRecord } from "../poiRecords";
import { heightAt, isLand, isRiver } from "../poiReads";
import { aloneAmong, attachment, sized, standsOut, weighed } from "../poiVisibilityRules";
import {
  lastsWhile,
  lengthOf,
  meanOf,
  raisedAsCaptured,
  reliefOf,
  sectionAt,
  sectionRadius,
  spans,
  standsIn,
} from "./reliefShape";

/** Along the crest the ground falls at most this share of what it falls across it. */
const crestShare = 0.5;
/** Crest length and relief at which a ridge is half as great as ridges get: a world range's. */
const typicalLength = 100_000,
  typicalRelief = 600;

const isA = (state: GenerationState, cell: number) => {
  if (!isLand(state, cell) || isRiver(state, cell)) return false;
  const { crest, along } = sectionAt(state, cell),
    plain = state.physical!.profile.PlainSlopeThreshold;
  return crest / sectionRadius(state) > plain && along < crestShare * crest;
};
const places = regionPlaces("ridge", isA, heightAt);
const counterpart = counterpartOf(isA, 1);
const crestFall = (state: GenerationState, place: PoiPlace) => sectionAt(state, place.anchor).crest;
const factors = {
  magnitude: meanOf(sized(lengthOf, typicalLength), sized(reliefOf, typicalRelief)),
  localConditions: standsOut(heightAt, spans(6)),
  isolation: aloneAmong(places, spans(12)),
  cultural: attachment(spans(8)),
};

export const ridge: PoiEntry = {
  id: "ridge",
  group: "relief",
  name: "Ridge",
  recognition: {
    distinct:
      "A dry land cell off any river where the ground falls away on both sides of a cross-section, faster than a plain slopes, while along the square section it falls less than half as much: the crest line. A summit falls every way and is a point on it, a pass rises along it, a valley is the inverse section, and an escarpment falls on one side only. Landform.Ridge is not the test: it marks steep ground under tectonic influence above 1000 m, which is mostly mountain flank rather than crest.",
    isA,
  },
  existence: {
    statement:
      "Emerges wherever two drainages cut toward each other or a belt of uplift stands proud, at every size; the regional relief writes branching divides into the same crest shape.",
    way: "emerges",
    requires: notApplicable("A crest is read from the terrain; nothing has to be there first."),
    suitability: notApplicable("Nothing chooses a crest's line; rivers and uplift leave it."),
    places,
  },
  publication: {
    statement: "Each connected crest publishes as its outline.",
    moment: "geography",
    record: areaRecord({ kind: "ridge", layer: "geology", name: "Ridge" }),
  },
  fields: {
    statement:
      "A ridge is a crest and a drainage divide: the water on each side belongs to a different river.",
    terrain: notApplicable("Uplift and erosion leave the crest; regional relief writes its spurs."),
    water: notApplicable(
      "It parts water without storing or sourcing any; the divide is its drainage cost below."
    ),
    climate: notApplicable(
      "Its rain shadow comes from the air columns reading its height along the wind."
    ),
    cover: notApplicable("Cover on a crest follows the thin soil and cold of its height."),
    magic: notApplicable(
      "A crest sources no magic; Aurora's prisms stand on high ground by their own rule."
    ),
  },
  acrossMaps: {
    statement:
      "A captured ridge stays a divide of the refined network: the crest cell nearest its top stands as high as the parent's did, and the finer relief branches its own spurs from there. If no crest reads there it takes the nearest one.",
    carry: carryWhereItLands,
    realize: (state, carried) => raisedAsCaptured(state, carried, counterpart(state, carried)),
    counterpart,
    unrealized: movesTo(counterpart),
    settle: notApplicable("The regional relief re-derives crests from the network each round."),
    schedule: notApplicable("Its top and drainage cost are all a ridge asks of a refinement."),
  },
  movement: {
    statement:
      "A ridge is the barrier other routes must cross: a road pays for its slopes except at a pass, water cannot run over it, and wind-borne dust and moisture lose reach against it.",
    roads: notApplicable("The ruling-grade cost already reads its slopes."),
    boats: notApplicable("No water runs along a crest to carry a boat."),
    drainage: costNear(3),
    magic: { wind: costNear(1.5) },
    links: notApplicable("A ridge joins nothing."),
    crosses: notApplicable("It is the barrier; a pass is what crosses it."),
  },
  others: {
    statement:
      "A ridge contains the summits and cols along it and runs between valleys; a frost prism may stand on it. It cannot run through a lake.",
    needs: notApplicable("Its section test needs nothing else in place."),
    excludes: [{ kind: "lake", holds: standsIn }],
    contains: [
      { kind: "summit", holds },
      { kind: "pass", holds },
    ],
    pairsWith: [
      { kind: "valley", holds: within(spans(4)) },
      { kind: "frostPrism", holds },
    ],
  },
  people: {
    statement:
      "A ridge is a frontier people can hold and a dry way for those walking along it; a steeper crest defends better.",
    offers: (state, place) => ({
      defence: sized(crestFall, 150)(state, place),
      sanctity: factors.magnitude(state, place) / 3,
    }),
    threatens: notApplicable(
      "Its slides and avalanches are those of its summits and steep slopes."
    ),
  },
  time: {
    statement:
      "A crest wears down and migrates as its rivers cut; when the ground no longer falls both ways it has ended and nothing marks where it stood.",
    fate: lastsWhile(isA),
  },
  visibility: {
    statement:
      "A ridge shows by its length and relief, and by standing over plain country rather than among more of the same; the wall behind a capital shows sooner than a greater one in empty ranges.",
    ...factors,
    importance: weighed(factors, { magnitude: 0.5, localConditions: 0.35, isolation: 0.15 }),
  },
  naming: {
    statement:
      "Named by the people on either side, often differently; long crests carry one name, and a town beneath may be named for it.",
    namedBy: namingCultureNear,
    takesNameFrom: notApplicable(
      "Ridges take names from nothing in the catalogue; people give them."
    ),
    lendsNameTo: [
      { kind: "settlement", holds: within(spans(8)) },
      { kind: "pass", holds },
    ],
  },
};
