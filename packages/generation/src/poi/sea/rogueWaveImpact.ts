// @needsResolution carry: a carried place may not resolve on a finer map (ADR 0009).
import type { GenerationState } from "../../process";
import type { RegionalState } from "../../regional/state";
import { carryWhereItLands, counterpartOf, stays } from "../poiCarry";
import {
  notApplicable,
  type PoiCarried,
  type PoiEntry,
  type PoiFieldChange,
  type PoiPlace,
} from "../poiContract";
import { namingCultureNear, rulePlaces, settlementWithin, within } from "../poiPlaces";
import { ruleRecord } from "../poiRecords";
import {
  adjacent,
  cellsWithin,
  fieldOf,
  gap,
  isLand,
  isSea,
  magicRule,
  heldFor,
  nearestWhere,
  waveExposureAt,
} from "../poiReads";
import { aloneAmong, attachment, sized, standsOut, weighed } from "../poiVisibilityRules";
import { near, pressureAt, pressureLength, seaFacing } from "./seaShared";

/** What the preset declares where the system's parameters are absent: its origin's distance from shore and its spokes' reach. */
const presetShoreDistance = 100_000,
  presetSpokes = 300_000;
/** Cut history at which an impact's shore is half as harmed as they get (native 0..1000). */
const typicalCut = 400;
/** The most canopy a shore keeps where the water is thrown onto it. */
const strippedCanopy = 0.5;
/** How far around the impact the water itself stands up: 50 km. */
const risenReach = near(50_000);
/** Extra boat cost at the impact; a road on the shore it strikes costs this many times more. */
const seasRisen = 2,
  brokenRoad = 1.2;

const isA = magicRule("pressure", "rogue");
const places = rulePlaces("rogueWaveImpact", "pressure", "rogue");
const shoreDistance = (state: GenerationState) =>
  pressureLength(state, "coastalSourceDistance", presetShoreDistance);
const spokes = (state: GenerationState) =>
  pressureLength(state, "coastalRayDistance", presetSpokes);
const struckFrom = (state: GenerationState, cell: number) =>
  heldFor(state, `rogue:struck:${cell}`, () =>
    seaFacing(
      state,
      cellsWithin(state, cell, shoreDistance(state)).filter((c) => isLand(state, c))
    )
  );
const counterpart = counterpartOf(isA, 2);

/** The worst cut the coast near an impact has taken. */
const cutOf = (state: GenerationState, place: PoiPlace) => {
  const map = fieldOf(state);
  return struckFrom(state, place.anchor).reduce(
    (most, cell) => Math.max(most, map.ExternalCoastalForcingHistory.get(cell)),
    0
  );
};
const factors = {
  magnitude: sized(cutOf, typicalCut),
  localConditions: standsOut(pressureAt, shoreDistance),
  isolation: aloneAmong(places, shoreDistance),
  cultural: attachment(shoreDistance),
};

/** The strongest Pressure in the sea beside a shore cell, as coastal forcing. */
function forcingOn(state: GenerationState, cell: number) {
  let most = 0;
  for (const next of adjacent(state, cell))
    if (isSea(state, next)) most = Math.max(most, pressureAt(state, next));
  return Math.round(most * 1000);
}
/** On a refined map, where rays are not retraced: the force on the finer shore it strikes. */
const struck = (state: RegionalState, carried: PoiCarried): readonly PoiFieldChange[] =>
  struckFrom(state, carried.cell).map((cell) => ({
    change: "atLeast",
    band: "ExternalCoastalForcing",
    cell,
    value: forcingOn(state, cell),
  }));
/** Thrown water strips the canopy of the shore it strikes. */
const flooded = (state: GenerationState, place: PoiPlace): readonly PoiFieldChange[] =>
  struckFrom(state, place.anchor).map((cell) => ({
    change: "atMost",
    band: "TreeCover",
    cell,
    value: strippedCanopy,
  }));

export const rogueWaveImpact: PoiEntry = {
  id: "rogueWaveImpact",
  group: "sea",
  name: "Rogue wave impact",
  recognition: {
    distinct:
      "A member of Pressure's rogue rule: the rogue channel is set, on one sea cell within the system's coastal distance of the shore, where the system fired a coastal impulse of 24 rays. It is a point the system marks. A crush zone is an area decided by intensity, a locus sits in deep water and fires continuously, and a wake's channel is a track.",
    isA,
  },
  existence: {
    statement:
      "Sited by the Pressure system: it takes coastal origins by seeded priority among sea cells near the shore, at a prevalence that scales with shoreline length, and fires each one. Where it fires, the shore beside it takes the force.",
    way: "sited",
    requires: (state, cell) =>
      isSea(state, cell) &&
      nearestWhere(state, cell, shoreDistance(state), (other) => !isSea(state, other)) >= 0,
    suitability: notApplicable(
      "The system takes the highest seeded priority among near-shore cells, with no preference among them."
    ),
    places,
  },
  publication: {
    statement: "Every impact publishes as the system's class, a site where it fired.",
    moment: "magic",
    record: ruleRecord("pressure", "rogue"),
  },
  fields: {
    statement:
      "An impact is what the sea does to the shore at once: its rays put force on the coast within reach so that erosion cuts it, and the water strips the canopy where it lands.",
    terrain: notApplicable(
      "The coastal feedback writes forcing on every shore beside Pressure's intensity, the impact's rays included."
    ),
    water: notApplicable(
      "The ocean current process writes wave exposure; the impulse's own force on the water is the intensity its rays leave."
    ),
    climate: notApplicable(
      "An impulse is too brief for the climate fields; any standing front it feeds is that front's entry."
    ),
    cover: flooded,
    magic: notApplicable("The system fires its rays and sets its channel directly."),
  },
  acrossMaps: {
    statement:
      "A refined map inherits the rogue channel and never replays the impulse, which would strike twice. The finer coast within reach takes the same force and is cut by it. If the channel holds nothing near, the impact stays where it lands, because the coast's damage still has to be told.",
    carry: carryWhereItLands,
    realize: struck,
    counterpart,
    unrealized: stays,
    settle: notApplicable(
      "An impact's force is declared once; a round's water does not change it."
    ),
    schedule: notApplicable("Its force on the finer shore is all an impact does to a refinement."),
  },
  movement: {
    statement:
      "Boats pay to pass the risen water, fading with distance; roads on the coast it strikes run on broken ground. Rivers and magic carriers do not read it.",
    roads: (state, place) =>
      struckFrom(state, place.anchor).map((cell) => ({ cell, factor: brokenRoad })),
    boats(state, place) {
      const reach = risenReach(state);
      return cellsWithin(state, place.anchor, reach)
        .filter((cell) => isSea(state, cell))
        .map((cell) => ({
          cell,
          factor: 1 + seasRisen * Math.max(0, 1 - gap(state, place.anchor, cell) / reach),
        }));
    },
    drainage: notApplicable(
      "A river finds the cut shore through the ordinary network once erosion has lowered it."
    ),
    magic: notApplicable("The impulse's spokes are traced by geometry and read no carrier's cost."),
    links: notApplicable("An impact joins no two cells."),
    crosses: notApplicable("An impact opens no way; it closes the shore it strikes."),
  },
  others: {
    statement:
      "An impact strikes a headland first if one stands in reach and spreads into the crush zone its spokes make. A harbour within reach is what makes it a disaster, and people who lived through it leave a disaster site.",
    needs: notApplicable("It needs only near-shore sea, which its requirement states."),
    excludes: notApplicable(
      "Any near-shore water can be struck; no place protects itself by standing there."
    ),
    contains: notApplicable("An impact is one cell."),
    pairsWith: [
      { kind: "headland", holds: within(shoreDistance) },
      { kind: "crushZone", holds: within(spokes) },
      { kind: "harbour", holds: within(shoreDistance) },
      { kind: "disasterSite", holds: within(shoreDistance) },
    ],
  },
  people: {
    statement:
      "An impact gives nothing, and it threatens everyone on the coast within its reach: towns are drowned, harbours wrecked, and the catch lost.",
    offers: notApplicable(
      "Nothing a people could plan on comes of it; what the water throws up is only a wreck."
    ),
    threatens: (state, place) => [
      {
        hazard: "rogue wave",
        reach: shoreDistance(state),
        severity: Math.max(pressureAt(state, place.anchor), waveExposureAt(state, place.anchor)),
      },
    ],
  },
  time: {
    statement:
      "An impact is an event of its epoch and does not last as water. It ends when the epoch closes. Where people stood within its reach it leaves a disaster site, and on the shore it leaves the cut recorded in the forcing history.",
    fate: (state, place) =>
      settlementWithin(state, place.anchor, shoreDistance(state))
        ? { fate: "ends", leaves: "disasterSite" }
        : { fate: "ends" },
  },
  visibility: {
    statement:
      "An impact shows by the cut it left on its coast, not by anything on the water, and alone along a coast it is remembered longer. Weight is shared because the wave is gone and the record is what remains. A town it struck carries it.",
    ...factors,
    importance: weighed(factors, { magnitude: 0.4, localConditions: 0.3, isolation: 0.3 }),
  },
  naming: {
    statement: "Named by the survivors on the nearest shore, and often after the town it struck.",
    namedBy: namingCultureNear,
    takesNameFrom: [{ kind: "settlement", holds: within(shoreDistance) }],
    lendsNameTo: [{ kind: "disasterSite", holds: within(shoreDistance) }],
  },
};
