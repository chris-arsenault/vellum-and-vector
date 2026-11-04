import { conditionReader } from "../../canonry/magicRegions";
import type { GenerationState } from "../../process";
import { carryWhereItLands, costNear, counterpartOf, goes, movesTo } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiPlace } from "../poiContract";
import { holds, namingCultureNear, regionPlaces, within } from "../poiPlaces";
import { cellSpan, isSea, magicRule, magicValue } from "../poiReads";
import { aloneAmong, attachment, drawnWhen, sized, standsOut } from "../poiVisibilityRules";
import { magicFieldOf, peakOf } from "./anomalyReads";

/** Fallen stock, as the rule reads it, at which a deviation is half as strong as they get. */
const typicalStock = 1000;
/** A needle swings this many cell spans beyond its deposit. */
const swingCells = 2;
/** The most a full deviation adds to the cost of an open-sea passage and of an unmarked land way. */
const seaLoss = 2,
  landLoss = 0.25;

const isA = magicRule("fire", "deviation");
/** The fallen stock per square metre, by the condition reader the rule itself uses. */
const stockAt = (state: GenerationState, cell: number) => {
  const fire = magicFieldOf(state, "fire");
  return fire ? conditionReader(state, fire, { field: "stock:fallen/held" }, 0)(cell) : 0;
};
const places = regionPlaces("compassDeviation", isA, stockAt);
const around = (state: GenerationState) => 6 * cellSpan(state);
const peakStock = (state: GenerationState, place: PoiPlace) => peakOf(state, place, stockAt);
const swing = sized(peakStock, typicalStock);
const counterpart = counterpartOf(isA, 1);
const swingNear = (state: GenerationState, place: PoiPlace, cell: number) =>
  costNear(1 + seaLoss * swing(state, place), swingCells * cellSpan(state))(state, place, cell);
const factors = {
  magnitude: swing,
  /** It matters where a needle is all there is: out of sight of land, it counts in full. */
  localConditions(state: GenerationState, place: PoiPlace) {
    const outstanding = standsOut(stockAt, around)(state, place);
    return isSea(state, place.anchor) ? Math.max(0.75, outstanding) : outstanding;
  },
  isolation: aloneAmong(places, (state) => 2 * around(state)),
  cultural: attachment(around),
};
const stockAmount = (state: GenerationState, cell: number) =>
  magicFieldOf(state, "fire")?.stocks["fallen/held"]?.get(cell) ?? 0;
const drawnAmount = (state: GenerationState, cell: number) =>
  magicFieldOf(state, "fire")?.drawn.get(cell) ?? 0;
const sumOver = (place: PoiPlace, read: (cell: number) => number) =>
  place.cells.reduce((sum, cell) => sum + read(cell), 0);

export const compassDeviation: PoiEntry = {
  id: "compassDeviation",
  group: "anomalies",
  name: "Compass deviation",
  recognition: {
    distinct:
      "A cell of Fire's deviation rule: its fallen-core stock per square metre past the rule's level, on land or under water. It is the only kind here read from a buried stock and it asks for no heat or intensity. A placer reads the same stock but must lie on a river; an ejecta fan reads the fallen source, not what remains; a crater lake reads it too but needs standing water.",
    isA,
  },
  existence: {
    statement:
      "Emerges wherever an impact left its alien metal thick enough to swing a needle: around the crater, downwind in the fan, down the river gravels and, after plate drift, wherever the crust has carried it.",
    way: "emerges",
    requires: (state, cell) => stockAt(state, cell) > 0,
    suitability: notApplicable(
      "The impact and the rivers place the metal; nothing chooses a site."
    ),
    places,
  },
  fields: {
    statement:
      "The deposit acts on instruments, not on media: the metal changes no height, water, air or growth by being there. The crater and fan that carry it do those things in their own entries.",
    terrain: notApplicable("Ejecta thickness is the impact's own; the swing adds no relief."),
    water: notApplicable("Metal in gravel neither stores nor diverts water."),
    climate: notApplicable("A fallen core releases heat as Fire's source, not as a deviation."),
    cover: notApplicable(
      "The fan's barrenness is the ejecta fan's; a deviation alone bares nothing."
    ),
    magic: notApplicable(
      "It marks Fire's fallen stock, which holds and releases through Fire's own stocks; a declared band change cannot reach a stock."
    ),
  },
  acrossMaps: {
    statement:
      "The stock is inherited as an amount, so finer cells may hold more or less per square metre and the rule grows anew over them. The place moves to the nearest cell over the level, or goes when no cell is rich enough; a coarse deviation may break into several or none. A round's water moves no stock through this rule.",
    carry: carryWhereItLands,
    realize: notApplicable(
      "Nothing need be shaped: the inherited stock is the deviation, and finer ground provides no more of it."
    ),
    counterpart,
    unrealized: (state, carried) =>
      counterpart(state, carried) >= 0 ? movesTo(counterpart)(state, carried) : goes(),
    settle: notApplicable("A round's water moves no fallen stock in the regional rounds."),
  },
  movement: {
    statement:
      "A needle lies here. Open-sea passages, steered by compass out of sight of land, pay the most and swing wide of it; river and coast boats pilot by sight and pay nothing; a land way pays a little until it is worn and marked. Metal in the ground does not change how water runs or what carries magic.",
    roads: (state, place, cell) =>
      costNear(1 + landLoss * swing(state, place), swingCells * cellSpan(state))(
        state,
        place,
        cell
      ),
    boats: (state, place, cell) => (isSea(state, cell) ? swingNear(state, place, cell) : 1),
    drainage: notApplicable(
      "Water does not steer by a needle, and metal in gravel bars no channel."
    ),
    magic: notApplicable(
      "The deposit rides the crust and rivers and changes neither carrier's cost."
    ),
    crosses: notApplicable("A false bearing opens no way across anything."),
  },
  others: {
    statement:
      "A deviation holds the crater lake and the richest placer of the same fall; it lies around a fan, invites a mine, and where the fallen stock is releasing Fire it ruptures a door.",
    needs: notApplicable(
      "The stock can outlive its crater and ride the crust far from it, so no place is required."
    ),
    excludes: [
      {
        kind: "door",
        holds: (state, a, b) =>
          a.cells.includes(b.anchor) && magicValue(state, "fire", "source", b.anchor) > 0,
      },
    ],
    contains: [
      { kind: "crater", holds },
      { kind: "placer", holds },
    ],
    pairsWith: [
      { kind: "ejectaFan", holds: within(around) },
      { kind: "mine", holds: within(around) },
    ],
  },
  people: {
    statement:
      "To a prospector a swinging needle is a map to core-bearing ground; to a pilot it is a wreck waiting; a fort behind one sits where attackers lose their bearings.",
    offers(state, place) {
      const strength = swing(state, place);
      return { materials: strength, defence: strength / 4 };
    },
    threatens: (state, place) => [
      {
        hazard: "false bearing",
        reach: swingCells * cellSpan(state),
        severity: swing(state, place),
      },
    ],
  },
  time: {
    statement:
      "It lasts as long as the metal does. Rivers wash it, frost and ice crack it into Fire, plate drift carries it, and mining draws it down; a deposit dug out past its stock ends and leaves the mine.",
    fate(state, place) {
      const held = sumOver(place, (cell) => stockAmount(state, cell)),
        drawn = sumOver(place, (cell) => drawnAmount(state, cell));
      return drawn > 0 && drawn >= held ? { fate: "ends", leaves: "mine" } : { fate: "persists" };
    },
  },
  visibility: {
    statement:
      "A deviation shows by how hard it pulls and whether anything else can give a bearing: one out at sea outranks a stronger one in hill country full of landmarks, and a mining town beside it carries a small one.",
    ...factors,
    visibleAt: drawnWhen(factors, { magnitude: 0.4, localConditions: 0.4, isolation: 0.2 }),
  },
  naming: {
    statement:
      "Named by the nearest people, miners on land and pilots at sea, after the crater that made it; the mine beside it takes its name.",
    namedBy: namingCultureNear,
    takesNameFrom: [{ kind: "crater", holds }],
    lendsNameTo: [{ kind: "mine", holds: within(around) }],
  },
};
