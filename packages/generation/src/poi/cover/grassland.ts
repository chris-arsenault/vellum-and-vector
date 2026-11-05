// @needsResolution carry: a carried place may not resolve on a finer map (ADR 0009).
import { bareCover, woodlandTrees } from "../../canonry/ecologyEnvironment";
import type { GenerationState } from "../../process";
import { carryWhereItLands } from "../poiCarry";
import { notApplicable, type PoiEntry } from "../poiContract";
import { namingCultureNear, within } from "../poiPlaces";
import { cellSpan, celsiusAt, fieldOf, grassCoverAt } from "../poiReads";
import { weighed } from "../poiVisibilityRules";
import { isFamily, landscapePlaces, landscapeRecord } from "./coverLandscape";
import {
  borders,
  countryCounterpart,
  countryFactors,
  coverCosts,
  coverWrites,
  fireAt,
  hazardReach,
  livingCoverAt,
  meanOver,
  movesOrGoes,
  otherLandscapes,
  spanOf,
  standsIn,
  withinOwn,
} from "./coverShared";

/** Area at which a grassland is half as great as grasslands get: 100,000 square kilometres. */
const typicalArea = 1e11;
const isA = isFamily("grassland");
const places = landscapePlaces("grassland", "grassland", grassCoverAt);
const factors = countryFactors(places, typicalArea, grassCoverAt);
const counterpart = countryCounterpart(isA);
const unrealized = movesOrGoes(counterpart);
const nearby = (state: GenerationState) => 3 * cellSpan(state);

/** Grazing's own shape: grass through a growing season centred on 18 degrees. */
const grazingAt = (state: GenerationState, cell: number) =>
  grassCoverAt(state, cell) * Math.exp(-(((celsiusAt(state, cell) - 18) / 20) ** 2));
const saplingsAt = (state: GenerationState, cell: number) => {
  const map = fieldOf(state);
  return map.BroadleafSaplings.get(cell) + map.ConiferSaplings.get(cell);
};

export const grassland: PoiEntry = {
  id: "grassland",
  group: "cover",
  name: "Grassland",
  recognition: {
    distinct:
      "Land whose biome class is in the grassland family, as the biome layer shows it: Grassland, Savanna or Tundra. Forest is the family above their tree line, barren the family under their cover line; a thaw meadow, well meadow or fog heath is grass too, but a system's forcing puts it in a family of its own.",
    isA,
  },
  existence: {
    statement:
      "Emerges where rain, cold, fire or grazers keep trees from closing. Prairie, steppe, savanna and tundra are its properties, read from its temperature and moisture and published as its biome.",
    way: "emerges",
    requires: notApplicable(
      "Its class reads cover directly; grass seed reaches open ground without any place prepared for it."
    ),
    suitability: notApplicable("No process picks a grassland's site."),
    places,
  },
  publication: {
    statement:
      "Each region publishes as a grassland on the ecology layer, outlined by the biome class margin and named for its biome; a region of under three cells publishes nothing.",
    moment: "geography",
    record: landscapeRecord("grassland", "grassland", places),
  },
  fields: {
    statement:
      "Grass binds soil and builds it, takes in rain on deep roots, and through grazers and ground fire holds young trees back, which is how open country stays open. All of that is the soil, grazing and fire processes reading its cover over the whole field.",
    ...coverWrites,
  },
  acrossMaps: {
    statement:
      "Its cover bands capture onto the child and the regional ecology develops them: wooded valleys and bare rises appear within what the world saw as one grassland, writing the child only. A captured grassland's name goes to the nearest grassland within two parent cells, and goes if none is there.",
    carry: carryWhereItLands,
    realize: notApplicable(
      "Captured grass needs no forcing: the regional ecology grows it from the capture and the fine ground's water."
    ),
    counterpart,
    unrealized,
    settle: unrealized,
    schedule: notApplicable("A grassland does nothing at refinement's other points."),
  },
  movement: {
    statement:
      "Open grass is what the road router's costs are written against, and the country highways run straight across. Grass roots slow a channel less than trees do, and Greenwood's roots cross grass more slowly than canopy but keep going; each is a generator cost reading every cell's cover.",
    ...coverCosts,
  },
  others: {
    statement:
      "It shares no ground with another landscape or with water. Armies and towns find it; its edges run into forest and barren ground, and people water it to farm it.",
    needs: notApplicable("Grass needs no other place, only ground and climate."),
    excludes: otherLandscapes("grassland"),
    contains: standsIn("battlefield", "irrigation"),
    pairsWith: [...borders("forest", "barren"), { kind: "settlement", holds: within(nearby) }],
  },
  people: {
    statement:
      "Pasture first, by the same shape the society reads for grazing; easy going for trade; little timber. The same grass carries fire fast when it dries.",
    offers(state, place) {
      const grass = meanOver(state, place, grassCoverAt);
      return {
        food: meanOver(state, place, grazingAt),
        trade: 0.3 * grass,
        materials: 0.2 * grass,
      };
    },
    threatens(state, place) {
      const fire = meanOver(state, place, fireAt);
      return fire > 0
        ? [{ hazard: "grass fire", reach: hazardReach(state, place), severity: Math.min(1, fire) }]
        : [];
    },
  },
  time: {
    statement:
      "Grass holds while something keeps trees out. If saplings get past what grazers and fire take, it becomes forest; if cover falls under what the ground keeps, it becomes barren.",
    fate(state, place) {
      if (meanOver(state, place, livingCoverAt) < bareCover)
        return { fate: "becomes", kind: "barren" };
      return meanOver(state, place, saplingsAt) >= woodlandTrees
        ? { fate: "becomes", kind: "forest" }
        : { fate: "persists" };
    },
  },
  visibility: {
    statement:
      "A grassland weighs by breadth above everything: its interest is how far it runs. A green strip in dry country stands out sooner than the same strip beside its own kind.",
    ...factors,
    importance: weighed(factors, { magnitude: 0.7, localConditions: 0.2, isolation: 0.1 }),
  },
  naming: {
    statement: "Named by the people nearest; herders' towns on it may take its name.",
    namedBy: namingCultureNear,
    takesNameFrom: notApplicable("Open country is named for itself; its towns come after it."),
    lendsNameTo: [{ kind: "settlement", holds: withinOwn(spanOf) }],
  },
};
