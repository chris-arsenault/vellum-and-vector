import type { GenerationState } from "../../process";
import { carryWhereItLands, counterpartOf, goes, movesTo } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiFieldChange, type PoiPlace } from "../poiContract";
import { holdsRecord, within } from "../poiPlaces";
import {
  cellSpan,
  dischargeAt,
  fieldOf,
  gap,
  isRiver,
  magicValue,
  moistureAt,
  sedimentAt,
  slopeAt,
} from "../poiReads";
import { aloneAmong, attachment, drawnWhen, sized } from "../poiVisibilityRules";
import {
  areaPlaces,
  attribute,
  cultureOfWork,
  isKept,
  isWork,
  keptLine,
  peopleWithin,
  strengthOf,
  workReach,
} from "./settlementRecords";

/** Share of a channel's flow a work may take and of it that reaches the soil, as societyWaterUse and societyWorks hold them. */
const greatestShare = 0.2,
  soilShare = 0.02;
/** The people who dig and keep a canal, as societyWorks holds them. */
const hands = 500;
/** Flow taken at which a work is half as great as irrigation gets. */
const typicalDiversion = 1;
/** Slope beyond which ditches cannot hold water level across fields. */
const levelGround = 0.02;
/** What a field of ditches costs a road, and what a canal saves water-borne stock. */
const ditched = 1.15,
  canalled = 0.8;

const places = areaPlaces("irrigation", isWork("irrigation"));
const isA = holdsRecord("irrigation", places);
const around = (state: GenerationState) => 6 * cellSpan(state);
const wantedFrom = (state: GenerationState) => 3 * around(state);
/** What it takes from the channel, as `irrigateChannels` limits it. */
const divertedBy = (state: GenerationState, place: PoiPlace) =>
  Math.min(dischargeAt(state, place.anchor) * greatestShare, strengthOf(place));
const onItsLand = (state: GenerationState, place: PoiPlace, cell: number) =>
  gap(state, place.anchor, cell) <= Math.max(attribute(place, "radius"), cellSpan(state));
/** The diversion runs down the whole channel below the intake, as `divertDownstream` walks it. */
function downstream(state: GenerationState, place: PoiPlace): readonly PoiFieldChange[] {
  const diverted = divertedBy(state, place),
    targets = fieldOf(state).FlowTargets,
    seen = new Set<number>(),
    changes: PoiFieldChange[] = [];
  if (diverted <= 0) return changes;
  for (let at = place.anchor; at >= 0 && !seen.has(at); at = targets.get(at)) {
    seen.add(at);
    changes.push({ change: "add", band: "FlowAccumulation", cell: at, amount: -diverted });
  }
  return changes;
}
const soaked = (state: GenerationState, place: PoiPlace): readonly PoiFieldChange[] => {
  const water = divertedBy(state, place) * soilShare;
  return workReach(state, place).map(({ cell, share }) => ({
    change: "add",
    band: "SoilWater",
    cell,
    amount: water * share,
  }));
};
const factors = {
  magnitude: sized(divertedBy, typicalDiversion),
  /** A green patch in dry country is what stands out; in a wet one no one would notice it. */
  localConditions: (state: GenerationState, place: PoiPlace) => 1 - moistureAt(state, place.anchor),
  isolation: aloneAmong(places, around),
  cultural: attachment(around),
};
const counterpart = counterpartOf(isRiver, 1);

export const irrigation: PoiEntry = {
  id: "irrigation",
  group: "settlements",
  name: "Irrigation",
  recognition: {
    distinct:
      "A published work of `kind` irrigation (`workKind` irrigation) whose `site` is its intake on a channel: it takes water out of a river and puts it on land, the one work that reduces the flow below it. A dam (`kind` dam) holds water and passes it on; a mill (`kind` mill) returns it; a clearance changes cover and takes no water.",
    isA,
  },
  existence: {
    statement:
      "Sited by a community of at least 500 short of water with a river beside it, which anchors the work's intake to the channel. Today it publishes only as an authored work: the world map holds irrigation as a latent demand on a unit's rivers, and refined maps make only mills, fords and bridges.",
    way: "sited",
    requires: (state, cell) =>
      isRiver(state, cell) && peopleWithin(state, cell, wantedFrom(state), hands),
    /** Dry country with soil to water, level enough to carry it, on a river with flow to spare. */
    suitability(state, cell) {
      const flow = dischargeAt(state, cell),
        dry = 1 - moistureAt(state, cell),
        level = 1 - Math.min(1, slopeAt(state, cell) / levelGround),
        soil = Math.min(1, sedimentAt(state, cell)),
        water = flow / (flow + typicalDiversion / greatestShare);
      return (dry + level + soil + water) / 4;
    },
    places,
  },
  fields: {
    statement:
      "Irrigation moves water from channel to soil: every cell below the intake runs lower by what it takes, and the land around the intake holds more water. A kept work keeps the ground it stands on as a line Hallowed reads.",
    terrain: notApplicable(
      "Field ditches are far narrower than a cell and move no ground it holds."
    ),
    water(state, place) {
      return [...downstream(state, place), ...soaked(state, place)];
    },
    climate: notApplicable(
      "Evaporation off watered fields is below what the climate field resolves."
    ),
    cover: notApplicable(
      "Ecology reads the soil water the work raises; the crops themselves are the clearance entry's."
    ),
    magic: (_state, place) => keptLine(place),
  },
  acrossMaps: {
    statement:
      "A refined map does not yet realize irrigation. An authored work captured from a coarser map moves its intake to the nearest channel and goes if the finer ground has no river near it.",
    carry: carryWhereItLands,
    realize: notApplicable(
      "Its water effect above applies at the intake; a refined map has no further shape to give it."
    ),
    counterpart,
    unrealized: (state, carried) =>
      counterpart(state, carried) >= 0 ? movesTo(counterpart)(state, carried) : goes(),
    settle: notApplicable("A diversion reads each round's water; its intake does not move itself."),
  },
  movement: {
    statement:
      "Ditches cut across a road's way, so roads pay to cross irrigated land. Canals carry what the river carries out over the fields, so river-borne stock reaches further there.",
    roads: (state, place, cell) => (onItsLand(state, place, cell) ? ditched : 1),
    boats: notApplicable(
      "A field ditch floats no boat, and the river below keeps four-fifths of its flow at worst."
    ),
    drainage: notApplicable(
      "The diversion is deducted from the existing channels; the tree itself does not reroute."
    ),
    magic: (state, place, cell) => (onItsLand(state, place, cell) ? canalled : 1),
    crosses: notApplicable("A ditch is an obstacle to a route, not a way over a barrier."),
  },
  others: {
    statement:
      "Irrigation needs people to keep it and a river to draw on, and often a dam above it. It feeds the cleared land around it and fails on a salt pan, whose brine rises with the water table.",
    needs: [{ kind: "settlement", holds: within(wantedFrom) }],
    excludes: [{ kind: "saltPan", holds: (_state, a, b) => b.cells.includes(a.anchor) }],
    contains: notApplicable("Its record is one work; its fields are the clearance entry's."),
    pairsWith: [
      { kind: "dam", holds: within(wantedFrom) },
      { kind: "clearance", holds: within(around) },
      { kind: "mill", holds: within(around) },
    ],
  },
  people: {
    statement:
      "Irrigation gives water and harvest in dry country, in proportion to what it takes. Watering salted ground raises the brine into the fields, the risk all irrigators run.",
    offers(state, place) {
      const size = factors.magnitude(state, place);
      return { water: size, food: size * (1 - moistureAt(state, place.anchor)) };
    },
    threatens(state, place) {
      const salt = magicValue(state, "salt", "intensity", place.anchor) / 1000;
      return salt > 0
        ? [
            {
              hazard: "salted fields",
              reach: Math.max(attribute(place, "radius"), cellSpan(state)),
              severity: Math.min(1, salt),
            },
          ]
        : [];
    },
  },
  time: {
    statement:
      "A work falls out of condition within a lifetime or two of its keepers leaving; the ditches silt, the river takes back its flow and the cleared land remains.",
    fate: (_state, place) =>
      isKept(place) ? { fate: "persists" } : { fate: "ends", leaves: "clearance" },
  },
  visibility: {
    statement:
      "Irrigation shows by how much water it moves and how dry the country it greens; a town that lives by it carries a small one.",
    ...factors,
    visibleAt: drawnWhen(factors, { magnitude: 0.4, localConditions: 0.4, isolation: 0.2 }),
  },
  naming: {
    statement:
      "Named by the community that dug it, in its record, and often after that settlement.",
    namedBy: cultureOfWork,
    takesNameFrom: [{ kind: "settlement", holds: within(wantedFrom) }],
    lendsNameTo: notApplicable("A canal's name stays on the canal; nothing around it takes it."),
  },
};
