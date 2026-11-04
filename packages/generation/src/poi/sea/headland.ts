import type { GenerationState } from "../../process";
import { baselineRock } from "../../regional/material";
import type { RegionalState } from "../../regional/state";
import { carryWhereItLands, costNear, counterpartOf, movesTo, stays } from "../poiCarry";
import {
  notApplicable,
  type PoiCarried,
  type PoiEntry,
  type PoiFieldChange,
  type PoiPlace,
} from "../poiContract";
import { holds, namingCultureNear, regionPlaces, within } from "../poiPlaces";
import {
  cellSpan,
  cellsWithin,
  fieldOf,
  gap,
  isLand,
  isSea,
  toNative,
  waveExposureAt,
} from "../poiReads";
import { aloneAmong, attachment, drawnWhen, sized, standsOut } from "../poiVisibilityRules";
import { areaOf, exposureBeside, extentOf, seaFacing } from "./seaShared";
import { showsForm, wrapOf } from "./shoreForm";

/** Area at which a headland is half as great as headlands get: 500 square kilometres. */
const typicalArea = 5e8;
/** A headland stands at least this many metres out of the water. */
const emergence = 1;
/** The rock a refined headland holds, in multiples of the world's baseline. */
const heldRock = 2;
/** Extra cost of rounding it, at full wave exposure. */
const rounding = 2;
/** Extra cost of a road out along a neck that goes nowhere else. */
const neckRoad = 1.4;
/** Extra cost of a river running out along it: it sheds water both ways. */
const shedding = 1.5;

const isA = showsForm("headland");
const places = regionPlaces("headland", isA, wrapOf);
const around = (state: GenerationState) => 8 * cellSpan(state);
/** The worst waves on its shore; the world map writes exposure on the water beside it. */
const tipExposure = (state: GenerationState, place: PoiPlace) =>
  seaFacing(state, place.cells).reduce(
    (worst, cell) => Math.max(worst, exposureBeside(state, cell)),
    0
  );
/** The worst coastal forcing its cells have taken, in [0, 1]. */
const forcingOn = (state: GenerationState, place: PoiPlace) => {
  const history = fieldOf(state).ExternalCoastalForcingHistory;
  return place.cells.reduce((worst, cell) => Math.max(worst, history.get(cell)), 0) / 1000;
};
const counterpart = counterpartOf(isA, 2);

const factors = {
  magnitude: sized(areaOf, typicalArea),
  localConditions: standsOut(wrapOf, (state, place) =>
    Math.max(around(state), 2 * extentOf(state, place))
  ),
  isolation: aloneAmong(places, around),
  cultural: attachment(around),
};

/** The shore of a headland stays out of the water and keeps its rock against the cut. */
function standing(state: GenerationState, place: PoiPlace): readonly PoiFieldChange[] {
  const map = fieldOf(state),
    floor = map.EffectiveSeaLevel + toNative(emergence);
  return seaFacing(state, place.cells).flatMap((cell): PoiFieldChange[] => [
    { change: "atLeast", band: "Elevation", cell, value: floor },
    { change: "atLeast", band: "RockResistance", cell, value: map.RockResistance.get(cell) },
  ]);
}
/** Waves bend onto a point: each cell of its shore takes the worst of the sea beside it. */
const refracted = (state: GenerationState, place: PoiPlace): readonly PoiFieldChange[] =>
  seaFacing(state, place.cells).map((cell) => ({
    change: "atLeast",
    band: "WaveExposure",
    cell,
    value: Math.round(exposureBeside(state, cell) * 1000),
  }));
/** Wind and salt spray keep the sea-facing ground from carrying a full canopy. */
const pruned = (state: GenerationState, place: PoiPlace): readonly PoiFieldChange[] =>
  seaFacing(state, place.cells).map((cell) => ({
    change: "atMost",
    band: "TreeCover",
    cell,
    value: 1 - exposureBeside(state, cell),
  }));
/** On the finer ground: the sea's cut leaves resistant rock standing where the point must be. */
function holdRock(state: RegionalState, carried: PoiCarried): readonly PoiFieldChange[] {
  const map = fieldOf(state),
    value = heldRock * baselineRock,
    cells = cellsWithin(state, carried.cell, state.regional.parentSpan / 2).filter((cell) =>
      isLand(state, cell)
    );
  return [
    ...cells.map((cell): PoiFieldChange => ({
      change: "atLeast",
      band: "RockResistance",
      cell,
      value: Math.max(value, map.RockResistance.get(cell)),
    })),
    {
      change: "atLeast",
      band: "Elevation",
      cell: carried.cell,
      value: map.EffectiveSeaLevel + toNative(emergence),
    },
  ];
}

export const headland: PoiEntry = {
  id: "headland",
  group: "sea",
  name: "Headland",
  recognition: {
    distinct:
      "A cell of ground that, on the smallest circle of radius 3, 6, 12, 24 or 48 cells showing any coastal form, has one unbroken arc of sea of at least 210 degrees, with ground running unbroken from the cell for five times that radius along the largest other arc. A straight shore shows about 180 degrees. A bay and a strait are the same reading on a sea cell, one arc of shore or two facing shores. The rim of a round island also shows the wrap, but its ground runs out across the island, so it is not a headland; the end of a long island is one.",
    isA,
  },
  existence: {
    statement:
      "Emerges from the shore the generator already builds: coastal detail displaces the bedrock near sea level (the Shoreline choice 'Inlets and headlands' raises its strength), coastal erosion wears the weak ground, and on a refined map the sea's cut leaves resistant bands standing. Nothing places one.",
    way: "emerges",
    requires: notApplicable("Its test reads the water mask; nothing must stand there first."),
    suitability: notApplicable("No process chooses where the sea leaves a point."),
    places,
  },
  fields: {
    statement:
      "A headland holds out: its shore stays above water with the rock it has, takes the worst of the waves on its tip, and carries a pruned canopy on its seaward cells. Lee water is sheltered through the bay beside it.",
    terrain: standing,
    water: refracted,
    climate: notApplicable(
      "Its mild air comes from warmth reading OceanDistance, which its cells already carry as small values; fog from a facing front is settled on it by the ocean feedback."
    ),
    cover: pruned,
    magic: notApplicable(
      "It adds nothing to the field: Pressure's rays reflect off any land, and the forcing on its shore comes from the coastal feedback reading the sea beside it."
    ),
  },
  acrossMaps: {
    statement:
      "A captured headland keeps its place: the refined ground holds resistant rock there, so the shore process leaves a point standing. It stands at the nearest point the finer coast develops, and if the sea cuts its cell away it moves to that point.",
    carry: carryWhereItLands,
    realize: holdRock,
    counterpart,
    unrealized: movesTo(counterpart),
    settle: (state, carried) =>
      isSea(state, carried.cell) ? movesTo(counterpart)(state, carried) : stays(),
  },
  movement: {
    statement:
      "Boats pay to round it, in proportion to the waves on its water, and roads pay to go out on a neck that ends at the sea. Rivers avoid running along it, because it sheds water to both shores.",
    roads: costNear(neckRoad),
    boats(state, place, cell) {
      if (!isSea(state, cell)) return 1;
      const reach = Math.max(2 * cellSpan(state), extentOf(state, place));
      return gap(state, place.anchor, cell) <= reach
        ? 1 + rounding * waveExposureAt(state, cell)
        : 1;
    },
    drainage: costNear(shedding),
    magic: notApplicable(
      "Land stops a ray or a current whatever its outline; a point changes neither beyond the land itself."
    ),
    crosses: notApplicable("A headland is a thing to go around; it opens no way across anything."),
  },
  others: {
    statement:
      "A headland bounds the bay beside it and takes the rogue waves that come ashore. A harbour stands in its lee, not on its tip, and a shrine or beacon, a summit or a ruin may stand on it.",
    needs: notApplicable("Its test already requires the sea around it and the ground behind it."),
    excludes: [{ kind: "harbour", holds: (_state, a, b) => a.anchor === b.anchor }],
    contains: [
      { kind: "summit", holds },
      { kind: "shrine", holds },
      { kind: "ruin", holds },
    ],
    pairsWith: [
      { kind: "bay", holds: within(around) },
      { kind: "harbour", holds: within(around) },
      { kind: "rogueWaveImpact", holds: within((state) => 2 * around(state)) },
    ],
  },
  people: {
    statement:
      "A point is easy to hold on few sides and a landmark for those at sea. Boats are wrecked on it in proportion to the waves it takes.",
    offers: (state, place) => ({
      defence: wrapOf(state, place.anchor),
      sanctity: factors.magnitude(state, place) / 2,
    }),
    threatens: (state, place) => [
      {
        hazard: "shipwreck",
        reach: Math.max(2 * cellSpan(state), extentOf(state, place)),
        severity: tipExposure(state, place),
      },
    ],
  },
  time: {
    statement:
      "The sea cuts a headland back at the rate its waves and forcing exceed its rock. Hard rock stands for epochs; a soft or heavily forced point is lost, and any stack left is an island the test does not count.",
    fate(state, place) {
      const rock = fieldOf(state).RockResistance.get(place.anchor) / baselineRock;
      return tipExposure(state, place) * (1 + forcingOn(state, place)) > rock
        ? { fate: "ends" }
        : { fate: "persists" };
    },
  },
  visibility: {
    statement:
      "A headland shows by its size and by how far it breaks the outline of its own coast. A sharp cape on a smooth shore outranks the same cape in an indented one, and a town named after it carries a small one.",
    ...factors,
    visibleAt: drawnWhen(factors, { magnitude: 0.4, localConditions: 0.4, isolation: 0.2 }),
  },
  naming: {
    statement:
      "Named by the people of the nearest shore, who steer by it; a harbour may take its name.",
    namedBy: namingCultureNear,
    takesNameFrom: notApplicable("A point is named first, because it is what sailors see first."),
    lendsNameTo: [
      { kind: "harbour", holds: within(around) },
      { kind: "settlement", holds: within(around) },
    ],
  },
};
