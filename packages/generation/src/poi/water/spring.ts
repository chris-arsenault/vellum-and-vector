// @needsResolution carry: follows its river; without one it may not resolve (ADR 0009).
import { components } from "../../canonry/geographicRegions";
import type { GenerationState } from "../../process";
import { frameEdge } from "../../regional/lattice";
import { carryWhereItLands, costNear, counterpartOf, movesTo } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiFieldChange, type PoiPlace } from "../poiContract";
import { namingCultureNear, within } from "../poiPlaces";
import { ruleRecord, siteRecord } from "../poiRecords";
import {
  celsiusAt,
  dischargeAt,
  fieldOf,
  fractureAt,
  heldFor,
  iceAt,
  isLand,
  magicRule,
  magicValue,
  rainfallAt,
  rockAt,
  slopeAt,
  toNative,
} from "../poiReads";
import { aloneAmong, attachment, sized, weighed } from "../poiVisibilityRules";
import { drynessAround, inflows, onMappedRiver, spans, standsIn } from "./waterReads";

/** Rock softer than this share of the hardest, or fractured past this share, lets water rise. */
const softRock = 0.5,
  openFracture = 0.32;
/** Ground this much gentler than the slope above it is a break where groundwater comes out. */
const slopeBreak = 0.5;
/** Discharge at which a spring is half as great as springs get, in cubic metres a second. */
const typicalDischarge = 5;
/** Metres a rising spring saps its head hollow below the ground above it. */
const sappedHollow = 2;
/** Metres of soil water a spring's flush holds; cover a flush holds, under a wetland's own. */
const flushWater = 0.3,
  flushCover = 0.15;

const hotRule = magicRule("fire", "spring"),
  greenwoodRule = magicRule("greenwood", "wellspring"),
  oasisRule = magicRule("greenwood", "oasis");

/** The steepest slope draining into a cell; zero where nothing does. */
function steepestAbove(state: GenerationState, cell: number) {
  let above = 0;
  for (const next of inflows(state, cell)) above = Math.max(above, slopeAt(state, next));
  return above;
}
/** A channel's first cell: a river no river runs into, and not one entering across the frame. */
function isChannelHead(state: GenerationState, cell: number) {
  if (!onMappedRiver(state, cell) || frameEdge(fieldOf(state).mesh, cell)) return false;
  for (const next of inflows(state, cell)) if (onMappedRiver(state, next)) return false;
  return true;
}
const unfrozen = (state: GenerationState, cell: number) =>
  iceAt(state, cell) <= 0 &&
  fieldOf(state).GlacialMeltwater.get(cell) <= 0 &&
  celsiusAt(state, cell) > 0;
const permeable = (state: GenerationState, cell: number) =>
  rockAt(state, cell) <= softRock || fractureAt(state, cell) >= openFracture;
/** Where the slope breaks, so that groundwater reaches the surface rather than a gully forming. */
const atSlopeBreak = (state: GenerationState, cell: number) => {
  const above = steepestAbove(state, cell);
  return above > 0 && slopeAt(state, cell) <= slopeBreak * above;
};
/** The natural form: groundwater at a channel head, where no magic system's water already rises. */
const naturalSpring = (state: GenerationState, cell: number) =>
  isLand(state, cell) &&
  !oasisRule(state, cell) &&
  !hotRule(state, cell) &&
  !greenwoodRule(state, cell) &&
  isChannelHead(state, cell) &&
  unfrozen(state, cell) &&
  permeable(state, cell) &&
  atSlopeBreak(state, cell);

/** Each form's rule is its definition: Fire's, Greenwood's, or the natural head above. */
const isA = (state: GenerationState, cell: number) =>
  hotRule(state, cell) || greenwoodRule(state, cell) || naturalSpring(state, cell);

/** What the spring is fed by, a property of one kind: hot and Greenwood water are read from magic. */
export const springWater = (state: GenerationState, cell: number) => {
  if (hotRule(state, cell)) return "hot";
  return greenwoodRule(state, cell) ? "greenwood" : "natural";
};
const strengthAt = (state: GenerationState, cell: number) =>
  magicValue(state, "fire", "intensity", cell) + magicValue(state, "greenwood", "source", cell);
type SpringForm = "hot" | "greenwood" | "natural";
/** Each connected group of one form's cells, anchored where it is strongest. */
function formPlaces(
  state: GenerationState,
  form: SpringForm,
  test: (state: GenerationState, cell: number) => boolean
) {
  const found: PoiPlace[] = [];
  components(
    state,
    (i) => test(state, i),
    (members) => {
      const cells = [...members],
        anchor = cells.reduce((a, b) => (strengthAt(state, b) > strengthAt(state, a) ? b : a));
      found.push({ id: `spring:${form}:${anchor}`, kind: "spring", cells, anchor });
    }
  );
  return found;
}
/** A spring of any form: each publishes with its own record kind. */
const places = (state: GenerationState): readonly PoiPlace[] =>
  heldFor(state, "places:spring", () => [
    ...formPlaces(state, "hot", hotRule),
    ...formPlaces(state, "greenwood", greenwoodRule),
    ...formPlaces(state, "natural", naturalSpring),
  ]);
const hotRecord = ruleRecord("fire", "spring"),
  greenwoodRecord = ruleRecord("greenwood", "wellspring"),
  naturalRecord = siteRecord({ kind: "spring", layer: "geology", name: "Spring" });
/** The record of a place by the form that found it. */
function springRecord(state: GenerationState, place: PoiPlace) {
  const form = place.id.split(":")[1];
  if (form === "hot") return hotRecord(state, place);
  return form === "greenwood" ? greenwoodRecord(state, place) : naturalRecord(state, place);
}
const watersOf = (state: GenerationState, place: PoiPlace) => springWater(state, place.anchor);
const flowOf = (state: GenerationState, place: PoiPlace) => dischargeAt(state, place.anchor);
const around = spans(6);
const counterpart = counterpartOf(isA, 1);
/** A magic spring is as great as its charge; any spring as great as its flow. */
const greatness = (state: GenerationState, place: PoiPlace) =>
  Math.max(
    sized(flowOf, typicalDischarge)(state, place),
    Math.min(1, strengthAt(state, place.anchor) / 1000)
  );
const factors = {
  magnitude: greatness,
  localConditions: drynessAround(around),
  isolation: aloneAmong(places, around),
  cultural: attachment(around),
};

/** A cold spring on land saps a hollow under the ground above it. */
function headShape(state: GenerationState, place: PoiPlace): readonly PoiFieldChange[] {
  const anchor = place.anchor;
  if (watersOf(state, place) === "hot" || !isLand(state, anchor)) return [];
  const map = fieldOf(state);
  let ground = -Infinity;
  for (const next of inflows(state, anchor)) ground = Math.max(ground, map.Elevation.get(next));
  return ground === -Infinity
    ? []
    : [
        {
          change: "atMost",
          band: "Elevation",
          cell: anchor,
          value: ground - toNative(sappedHollow),
        },
      ];
}
const landOf = (state: GenerationState, cells: readonly number[]) =>
  cells.filter((cell) => isLand(state, cell));
/** The spring holds its ground wet, whatever the climate takes above it. */
const headWater = (state: GenerationState, place: PoiPlace): readonly PoiFieldChange[] =>
  landOf(state, place.cells).map((cell) => ({
    change: "atLeast",
    band: "SoilWater",
    cell,
    value: flushWater,
  }));
/** A cold flush holds wet sedge; water near boiling holds bare ground. */
const flush = (state: GenerationState, place: PoiPlace): readonly PoiFieldChange[] =>
  landOf(state, place.cells).map((cell) =>
    watersOf(state, place) === "hot"
      ? { change: "atMost", band: "TreeCover", cell, value: flushCover }
      : { change: "atLeast", band: "WetlandCover", cell, value: flushCover }
  );
/** A spring saves most where water is scarce: a track bends to it in dry country, hardly in wet. */
const drawsTracks = (state: GenerationState, place: PoiPlace) =>
  costNear(1 - 0.3 * Math.max(0, 1 - rainfallAt(state, place.anchor)), spans(2))(state, place);
/** Magic's carrier runs easily through the rock of the form it rises by; other waters change nothing. */
const easedFor = (form: SpringForm) => (state: GenerationState, place: PoiPlace) =>
  watersOf(state, place) === form ? costNear(0.7)(state, place) : [];

export const spring: PoiEntry = {
  id: "spring",
  group: "water",
  name: "Spring",
  recognition: {
    distinct:
      "Where water comes out of the ground, by any of three tests over one kind: Fire's spring rule (hot), Greenwood's wellspring rule, or a natural head: an unfrozen land cell with RiverOrders above zero that no river cell drains into, not on the frame edge, on soft or fractured rock (RockResistance, FractureConductance), whose Slope is at most half the steepest slope draining into it. A channel head without the break or the permeable rock is only runoff gathering; a head fed by GlacialMeltwater or IceThickness is a melt source; a wellspring on bare ground is an oasis; a seep through the sea floor is a vent.",
    isA,
  },
  existence: {
    statement:
      "Emerges where the drainage and the rock bring groundwater out, or where Fire's conduit or Greenwood's aquifer does; a seep, a hot pool and a holy wellspring are one kind with their water recorded as a property.",
    way: "emerges",
    requires: notApplicable(
      "Its test reads the river, rock and magic at the cell; nothing has to stand there first."
    ),
    suitability: notApplicable(
      "Water comes out where the rock lets it; no process chooses the cell."
    ),
    places,
  },
  publication: {
    statement:
      "A hot spring publishes as Fire's spring, a Greenwood spring as Greenwood's wellspring, and a natural spring as a spring on the ground: one kind, each with its own record.",
    moment: "magic",
    record: springRecord,
  },
  fields: {
    statement:
      "A spring is a source: it wets the ground at its head and a cold one saps a hollow there. The routing keeps its channel; Fire's rock effect hardens a hot spring's ground, Fire's heat runs down the river warmth, and Greenwood's intensity is its verdure.",
    terrain: headShape,
    water: headWater,
    climate: notApplicable(
      "Its water is too little to move the air, and a hot spring's heat is Fire's own heat effect, already in Temperature."
    ),
    cover: flush,
    magic: notApplicable(
      "`riverWarmth` carries Fire's heat forcing down the flow, and `magicLivingFeedback` writes Greenwood's verdure by intensity."
    ),
  },
  acrossMaps: {
    standsOn: "river",
    statement:
      "A spring lands on the finer ground, which must hold a wet channel head there; each round it moves to the nearest head the developed water shows, and with none it keeps its realized head, because the parent's water still has to come out somewhere.",
    carry: carryWhereItLands,
    realize: (state, carried) =>
      landOf(state, [carried.cell]).map((cell) => ({
        change: "atLeast",
        band: "SoilWater",
        cell,
        value: flushWater,
      })),
    counterpart,
    unrealized: movesTo(counterpart),
    settle: movesTo(counterpart),
    schedule: notApplicable(
      "Its drainage cost draws the network to it; it has no other step in the schedule."
    ),
  },
  movement: {
    statement:
      "Tracks bend to a spring in proportion to how dry the country is; the drainage grows from it; magic's underground carriers run easily through the fractured or soluble rock of a hot or Greenwood spring.",
    roads: drawsTracks,
    boats: notApplicable("A spring is the top of a channel, above anything a boat can reach."),
    drainage: costNear(0.7),
    magic: { crust: easedFor("hot"), roots: easedFor("greenwood") },
    links: notApplicable("A spring joins no two cells."),
    crosses: notApplicable("A route rounds a river's head at a spring; nothing there is crossed."),
  },
  others: {
    statement:
      "A wellspring on bare ground is an oasis and not a spring. Shrines and settlements gather at springs; a Greenwood spring that failed leaves sinkholes and a hot one lies along a thermal vein.",
    needs: notApplicable("Its own test holds everything it depends on."),
    excludes: [
      { kind: "oasis", holds: (_state, a, b) => a.cells.includes(b.anchor) },
      { kind: "riverMouth", holds: (_state, a, b) => a.anchor === b.anchor },
    ],
    contains: notApplicable("A spring is a single rising; a field of them is one spring."),
    pairsWith: [
      { kind: "shrine", holds: within(spans(2)) },
      { kind: "settlement", holds: within(around) },
      { kind: "thermalVein", holds: within(around) },
      { kind: "sinkholeField", holds: within(around) },
      { kind: "lake", holds: standsIn },
    ],
  },
  people: {
    statement:
      "A spring gives water that does not fail, and is often held sacred; hot springs add minerals and can scald, and the rest threaten no one.",
    offers(state, place) {
      const great = greatness(state, place),
        waters = watersOf(state, place);
      return {
        water: sized(flowOf, typicalDischarge)(state, place),
        sanctity: waters === "natural" ? great / 2 : great,
        materials: waters === "hot" ? great / 2 : 0,
      };
    },
    threatens: (state, place) =>
      watersOf(state, place) === "hot"
        ? [{ hazard: "scalding water", reach: spans(1)(state), severity: greatness(state, place) }]
        : [],
  },
  time: {
    statement:
      "A natural spring lasts while the rock and the catchment do. A hot spring whose conduit is spent leaves a basalt scar; a Greenwood spring drawn past its recharge falls in and leaves a sinkhole field; one whose cover is lost stands on as an oasis.",
    fate(state, place) {
      if (magicRule("fire", "scar")(state, place.anchor))
        return { fate: "ends", leaves: "basaltFlat" };
      if (magicRule("greenwood", "sinkhole")(state, place.anchor))
        return { fate: "ends", leaves: "sinkholeField" };
      return oasisRule(state, place.anchor)
        ? { fate: "becomes", kind: "oasis" }
        : { fate: "persists" };
    },
  },
  visibility: {
    statement:
      "A spring earns its mark mostly by the dryness of its country and how far the next water lies; its flow or charge counts less, and a town that drinks from one carries it.",
    ...factors,
    importance: weighed(factors, { magnitude: 0.25, localConditions: 0.45, isolation: 0.3 }),
  },
  naming: {
    statement:
      "Named by those who drink from it; a town or shrine at its water often takes its name.",
    namedBy: namingCultureNear,
    takesNameFrom: notApplicable("A spring is older than what gathers at it and gives the name."),
    lendsNameTo: [
      { kind: "settlement", holds: within(around) },
      { kind: "shrine", holds: within(spans(2)) },
    ],
  },
};
