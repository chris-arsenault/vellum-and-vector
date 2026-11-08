// @needsResolution carry: a carried place may not resolve on a finer map (ADR 0009).
import type { GenerationState } from "../../process";
import { notApplicable, type PoiEntry } from "../poiContract";
import { namingCultureNear } from "../poiPlaces";
import { fieldOf } from "../poiReads";
import { weighed } from "../poiVisibilityRules";
import { isFamily, landscapePlaces, landscapeRecord } from "./coverLandscape";
import {
  borders,
  countryFactors,
  coverCosts,
  coverWrites,
  developedCountry,
  hazardReach,
  meanOver,
  otherLandscapes,
} from "./coverShared";

/** Area at which a Barrow heath is half as great as they get: 500 square kilometres. */
// length-unit: fraction
const typicalArea = 0.00003125;
/** Salting below which ground is no longer read as salted, as the biome class reads it. */
const salted = 0.3;
const saltingAt = (state: GenerationState, cell: number) => fieldOf(state).Salting.get(cell);
const isA = isFamily("barrow");
const places = landscapePlaces("barrowHeath", "barrow", saltingAt);
const factors = countryFactors(places, typicalArea, saltingAt);

export const barrowHeath: PoiEntry = {
  id: "barrowHeath",
  group: "cover",
  name: "Barrow heath",
  recognition: {
    distinct:
      "Land whose biome class is Barrow heath: salted ground that still carries thin cover, where the dead lie under it. A salt pan is salted ground with no cover at all.",
    isA,
  },
  existence: {
    statement: "Emerges where Salt's brine lies under ground that keeps some growth on it.",
    way: "emerges",
    requires: notApplicable("Its class reads salting and cover; nothing else precedes it."),
    suitability: notApplicable("Where the dead fell sets it, and nothing chooses a site."),
    places,
  },
  publication: {
    statement:
      "Each region publishes as a Barrow heath on the ecology layer, outlined by the biome class margin; a region of under three cells publishes nothing.",
    moment: "geography",
    record: landscapeRecord("barrow", "barrow", places),
  },
  fields: {
    statement:
      "Its salt is Salt's own writes on every salted cell; the heath writes nothing of its own.",
    ...coverWrites,
  },
  acrossMaps: developedCountry(
    "Salting and cover capture onto the child, whose ecology finds the heath on finer ground. A captured heath's name goes to the nearest within two parent cells, or goes.",
    isA
  ),
  movement: {
    statement: "Thin cover is easy going, and roads pay nothing special to cross it.",
    ...coverCosts,
  },
  others: {
    statement:
      "It shares no ground with another landscape or with water, and lies around a killing ground and beside a salt pan.",
    needs: notApplicable("It reads a forcing directly, which more than one place may raise."),
    excludes: otherLandscapes("barrowHeath"),
    contains: notApplicable("A killing ground may lie in it but is no part of what it is."),
    pairsWith: borders("killingGround", "saltPan"),
  },
  people: {
    statement:
      "Little to eat and much to fear: people keep off it except to bury or remember the dead.",
    offers: (state, place) => ({ sanctity: meanOver(state, place, saltingAt) }),
    threatens: (state, place) => [
      {
        hazard: "salted water and ground",
        reach: hazardReach(state, place),
        severity: meanOver(state, place, saltingAt) / 2,
      },
    ],
  },
  time: {
    statement: "It lasts while the salt does, and greens back to its country as the salt leaches.",
    fate: (state, place) =>
      meanOver(state, place, saltingAt) < salted
        ? { fate: "becomes", kind: "grassland" }
        : { fate: "persists" },
  },
  visibility: {
    statement:
      "It weighs by how salted it stands over the country around and by its size; a town tied to it carries it.",
    ...factors,
    importance: weighed(factors, { magnitude: 0.4, localConditions: 0.4, isolation: 0.2 }),
  },
  naming: {
    statement: "Named by the people nearest, often after those who lie there.",
    namedBy: namingCultureNear,
    takesNameFrom: notApplicable("Its name comes from what it is, not from a place beside it."),
    lendsNameTo: notApplicable("Few take the name of a place they keep away from."),
  },
};
