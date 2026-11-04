import type { GenerationState } from "../../process";
import { carryWhereItLands } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiFieldChange, type PoiPlace } from "../poiContract";
import { namingCultureNear, regionPlaces, within } from "../poiPlaces";
import { cellSpan, celsiusAt, fieldOf, grassCoverAt } from "../poiReads";
import { drawnWhen } from "../poiVisibilityRules";
import {
  bareBelow,
  borders,
  countryCounterpart,
  countryFactors,
  floorsHeld,
  hazardReach,
  isKind,
  livingCoverAt,
  meanOver,
  movesOrGoes,
  onPlace,
  rootCarriage,
  sharesNoGround,
  spanOf,
  standsIn,
  verdantCountry,
  verdureHeld,
  withinOwn,
} from "./coverShared";

/** Area at which a grassland is half as great as grasslands get: 100,000 square kilometres. */
const typicalArea = 1e11;
/** The binding grass adds to the resistance a channel cuts through, as `surfaceResistance` holds it. */
const channelPerGrass = 0.45;
/** Sapling share at which the ground turns to woodland, the `classifyBiome` line for trees. */
const woodlandFrom = 0.15;
/** Mean fire activity at which fire holds saplings down. */
const fireKept = 0.1;
const isA = isKind("grassland");
const places = regionPlaces("grassland", isA, grassCoverAt);
const factors = countryFactors(places, typicalArea, grassCoverAt);
const counterpart = countryCounterpart(isA);
const unrealized = movesOrGoes(counterpart);
const nearby = (state: GenerationState) => 3 * cellSpan(state);

/** Grazers and ground fire keep the country open: young trees get no further than they are. */
function kept(state: GenerationState, place: PoiPlace) {
  const map = fieldOf(state),
    changes: PoiFieldChange[] = [];
  for (const cell of place.cells)
    if (map.Grazers.get(cell) > 0 || map.FireActivity.get(cell) >= fireKept) {
      const broadleaf = map.BroadleafSaplings.get(cell),
        conifer = map.ConiferSaplings.get(cell);
      changes.push(
        { change: "atMost", band: "BroadleafSaplings", cell, value: broadleaf },
        { change: "atMost", band: "ConiferSaplings", cell, value: conifer }
      );
    }
  return changes;
}
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
      "Land the ecology classes as Grassland (TreeCover under 0.15), Savanna (under 0.4, over 18 degrees), Well meadow, Fog heath or Thaw meadow, cold ground with living cover of at least 0.12 and TreeCover under 0.4, or a Greenwood verdant rule cell on ground not classed forest, wetland, ice or water. Forest is the tree share above those lines, barren the total cover under 0.12; heath on Salt's killing ground and a Greenwood stand go to those entries.",
    isA,
  },
  existence: {
    statement:
      "Emerges where rain, cold, fire or grazers keep trees from closing. Greenwood's verdant country is this kind, along with fog heath and Tundra; prairie, steppe, savanna, tundra, heath and meadow are its properties, read from the biome name and the region's temperature and moisture.",
    way: "emerges",
    requires: notApplicable(
      "Its test reads cover directly; grass seed reaches open ground without any place prepared for it."
    ),
    suitability: notApplicable("No process picks a grassland's site."),
    places,
  },
  fields: {
    statement:
      "Grass binds soil and builds it, takes in rain on deep roots, and through grazers and ground fire holds young trees back, which is how open country stays open. Verdant country also keeps Greenwood's verdure.",
    terrain: floorsHeld("SoilDepth"),
    water: floorsHeld("Infiltration"),
    climate: floorsHeld("Evapotranspiration"),
    cover: kept,
    magic: verdureHeld(verdantCountry),
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
  },
  movement: {
    statement:
      "Open grass is what the road router's costs are written against, and the country highways run straight across. Grass roots slow a channel less than trees do, and Greenwood's roots cross grass more slowly than canopy but keep going.",
    roads: notApplicable(
      "Open ground has a factor of one in the road router: there is no charge to change."
    ),
    boats: notApplicable("A river through grassland carries boats as any other reach."),
    drainage: onPlace((state, cell) => 1 + channelPerGrass * grassCoverAt(state, cell)),
    magic: onPlace(rootCarriage),
    crosses: notApplicable("Open grass lets a route across no barrier by being there."),
  },
  others: {
    statement:
      "It shares no ground with other cover, wetland or a killing ground. Armies and towns find it; its edges run into forest and barren ground, and people water it to farm it.",
    needs: notApplicable("Grass needs no other place, only ground and climate."),
    excludes: sharesNoGround(
      "forest",
      "barren",
      "thawedHalo",
      "wildZone",
      "clearance",
      "wetland",
      "killingGround",
      "lake"
    ),
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
      const fire = meanOver(state, place, (_s, cell) => fieldOf(state).FireActivity.get(cell));
      return fire > 0
        ? [{ hazard: "grass fire", reach: hazardReach(state, place), severity: Math.min(1, fire) }]
        : [];
    },
  },
  time: {
    statement:
      "Grass holds while something keeps trees out. If saplings get past what grazers and fire take, it becomes forest; if cover falls under what the ground keeps, it becomes barren.",
    fate(state, place) {
      if (meanOver(state, place, livingCoverAt) < bareBelow)
        return { fate: "becomes", kind: "barren" };
      return meanOver(state, place, saplingsAt) >= woodlandFrom
        ? { fate: "becomes", kind: "forest" }
        : { fate: "persists" };
    },
  },
  visibility: {
    statement:
      "A grassland shows by breadth above everything: its interest is how far it runs. A green strip in dry country stands out sooner than the same strip beside its own kind.",
    ...factors,
    visibleAt: drawnWhen(factors, { magnitude: 0.7, localConditions: 0.2, isolation: 0.1 }),
  },
  naming: {
    statement: "Named by the people nearest; herders' towns on it may take its name.",
    namedBy: namingCultureNear,
    takesNameFrom: notApplicable("Open country is named for itself; its towns come after it."),
    lendsNameTo: [{ kind: "settlement", holds: withinOwn(spanOf) }],
  },
};
