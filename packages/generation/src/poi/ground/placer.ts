import type { GenerationState } from "../../process";
import { carryWhereItLands, costNear, counterpartOf } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiFieldChange, type PoiPlace } from "../poiContract";
import { namingCultureNear, regionPlaces, within } from "../poiPlaces";
import { dischargeAt, isRiver, sedimentAt, toNative } from "../poiReads";
import { aloneAmong, attachment, drawnWhen, sized, standsOut } from "../poiVisibilityRules";
import {
  aroundOf,
  barDepth,
  floorOf,
  flowGradient,
  lengthOf,
  movesOrGoes,
  parameterOf,
  placerAt,
  stockPerArea,
  standsOn,
} from "./groundReads";

/** Fallen metal per square metre at which a band is rich: the deepest the placer rule reads. */
const richStock = 1000;
/** Spent vein ore per square metre at which a band is rich. */
const richOre = 1000;
/** A course length and discharge at which a band is half as great as bands get. */
const typicalLength = 40_000,
  typicalDischarge = 250;
/** The discharge a gravel reach can still be waded at, in cubic metres a second. */
const wadeable = 50;
/** Sediment deeper than this buries a band out of reach, where Fire has no burial depth to give. */
const defaultBurial = 20;
/** A gravel bar shoals a boat's channel and turns the growing channel aside. */
const shoaling = 2,
  deflection = 1.25;
/** A slack reach holds what the river is carrying a while longer than a running one. */
const slackHold = 1.5;

/** Metal and ore a band holds, in [0, 1]; a bar of river gravel alone has neither. */
const metalAt = (state: GenerationState, cell: number) =>
  Math.min(
    1,
    stockPerArea(state, "fire", "fallen/held", cell) / richStock +
      stockPerArea(state, "fire", "vein/spent", cell) / richOre
  );
const rankAt = (state: GenerationState, cell: number) =>
  metalAt(state, cell) + sedimentAt(state, cell) / (sedimentAt(state, cell) + 1);
const places = regionPlaces("placer", placerAt, rankAt);
const counterpart = counterpartOf(placerAt, 1);
const richnessOf = (state: GenerationState, place: PoiPlace) =>
  place.cells.reduce((most, cell) => Math.max(most, metalAt(state, cell)), 0);
const dischargeOf = (state: GenerationState, place: PoiPlace) => dischargeAt(state, place.anchor);
const factors = {
  magnitude: (state: GenerationState, place: PoiPlace) =>
    (sized(lengthOf, typicalLength)(state, place) +
      sized(dischargeOf, typicalDischarge)(state, place) +
      richnessOf(state, place)) /
    3,
  localConditions: standsOut(sedimentAt, aroundOf),
  isolation: aloneAmong(places, (state) => 2 * aroundOf(state)),
  cultural: attachment(aroundOf),
};
/** The slack reach and its gravel, held: the shape that keeps sorting grains out of the river. */
const slackReach = (state: GenerationState, cell: number): readonly PoiFieldChange[] => [
  { change: "gradientAtMost", cell, gradient: flowGradient(state, cell) },
  floorOf(
    "SedimentThickness",
    cell,
    Math.max(toNative(barDepth), toNative(sedimentAt(state, cell)))
  ),
];

export const placer: PoiEntry = {
  id: "placer",
  group: "ground",
  name: "Placer band",
  recognition: {
    distinct:
      "A land river cell that is either in Fire's placer rule (river plus fallen metal in the gravel) or a bar of river sediment at least a metre deep where the river's gradient falls to half or less of the reach above it, that reach being steep enough to carry heavy grains. The slackening is what separates it: a waterfall is where the gradient jumps up, a delta has delta intensity and fine silt, a floodplain has sediment with no break in the profile, and a moraine's material came by ice. Fire's rule and the plain bar are the same kind; metal is a property of the band, not a second kind.",
    isA: placerAt,
  },
  existence: {
    statement:
      "Emerges where a river drops what it can no longer carry. Fallen metal washes down from a crater's fan, spent ore from an old vein is exhumed and washed the same way, and a river with neither still sorts its heaviest gravel into the same bars. Nothing but the river places one.",
    way: "emerges",
    requires: notApplicable(
      "Its test reads the river and its sediment; nothing has to be there first."
    ),
    suitability: notApplicable(
      "The river's profile chooses where it slackens; no process sites a band."
    ),
    places,
  },
  fields: {
    statement:
      "A band holds the slack reach that makes it: a gentle bed with gravel on it, which traps what the river is carrying. Fire's metal in it stays in Fire's own stock.",
    terrain: (state, place) => place.cells.flatMap((cell) => slackReach(state, cell)),
    water: notApplicable(
      "A bar stores no water and passes the river's whole discharge; the bed's gradient, held under terrain, is all it changes."
    ),
    climate: notApplicable("A gravel bar is far too small and low to change the air over it."),
    cover: notApplicable(
      "Scour keeps bare gravel bare, and the bank's cover follows the channel's own moisture."
    ),
    magic: notApplicable(
      "Its metal is a Fire stock, moved by the system's own river carrier; stocks are not field bands, so a band can declare nothing on them, and the Fire it releases is already in the field."
    ),
  },
  acrossMaps: {
    statement:
      "A captured band lands on the refined river, whose finer profile must hold its slack and its gravel, so the refined reach keeps sorting; Fire's inherited stock comes with the child's field. After a round's water a band follows the channel to the nearest slack reach, and goes if the river no longer has one within a parent span. Plain bars are not published, so they appear on the child by the same test rather than being carried.",
    carry: carryWhereItLands,
    realize(state, carried) {
      const cell = counterpart(state, carried);
      return cell < 0 ? [] : slackReach(state, cell);
    },
    counterpart,
    unrealized: movesOrGoes(counterpart),
    settle: (state, carried) =>
      placerAt(state, carried.cell)
        ? { outcome: "keep" }
        : movesOrGoes(counterpart)(state, carried),
  },
  movement: {
    statement:
      "A band shoals boats and turns the growing channel aside; a slack reach holds what the river carries of magic a while longer; and where the flow is small enough its gravel is a place to wade across.",
    roads: notApplicable(
      "Road crossing costs read the river; the band's shallow crossing is declared under what it crosses."
    ),
    boats: costNear(shoaling),
    drainage: costNear(deflection),
    magic: costNear(slackHold),
    crosses: (state, place) => (dischargeAt(state, place.anchor) <= wadeable ? ["river"] : []),
  },
  others: {
    statement:
      "A band lies below whatever fed it: a crater's fan, a worn vein. It never shares a cell with a fall, since one is where the gradient drops away and the other where it eases. A mine or a panning town may stand on it.",
    needs: notApplicable(
      "Its test already requires the river it lies in, and a plain bar needs no source."
    ),
    excludes: [
      { kind: "waterfall", holds: (_state, a, b) => a.cells.includes(b.anchor) },
      { kind: "lake", holds: standsOn },
    ],
    contains: [{ kind: "mine", holds: (_state, a, b) => a.cells.includes(b.anchor) }],
    pairsWith: [
      { kind: "ejectaFan", holds: within((state) => 4 * aroundOf(state)) },
      { kind: "crater", holds: within((state) => 4 * aroundOf(state)) },
      { kind: "thermalVein", holds: within((state) => 4 * aroundOf(state)) },
      { kind: "waterfall", holds: within(aroundOf) },
      { kind: "settlement", holds: within(aroundOf) },
    ],
  },
  people: {
    statement:
      "A band gives gravel to anyone and metal in proportion to what it holds, and panning needs no shaft. Its gravel shifts: people who work it stand in a channel that floods.",
    offers(state, place) {
      const rich = richnessOf(state, place);
      return { materials: 0.25 + 0.75 * rich, trade: rich / 2 };
    },
    threatens: (state, place) => [
      {
        hazard: "flash flood in the working channel",
        reach: lengthOf(state, place) / 2,
        severity: sized(dischargeOf, typicalDischarge)(state, place),
      },
    ],
  },
  time: {
    statement:
      "A band renews itself while the river keeps slackening there, though panning draws down its metal and a thinning fan feeds it less. Deep burial under later sediment ends it, since the bed then runs over it out of reach; a river leaving ends it too.",
    fate(state, place) {
      const buried =
        sedimentAt(state, place.anchor) >=
        (parameterOf(state, "fire", "buryDepth") ?? defaultBurial);
      return buried || !isRiver(state, place.anchor) ? { fate: "ends" } : { fate: "persists" };
    },
  },
  visibility: {
    statement:
      "A band shows by its length, its river and the metal in it, and by the gravel standing deep against the country around it. A rush town or capital beside it carries a thin one.",
    ...factors,
    visibleAt: drawnWhen(factors, { magnitude: 0.5, localConditions: 0.2, isolation: 0.3 }),
  },
  naming: {
    statement:
      "Named by those who pan it, nearest first; a town that grew up on the gravel may take its name.",
    namedBy: namingCultureNear,
    takesNameFrom: notApplicable(
      "Rivers carry their own names outside this catalogue; a band gets its own."
    ),
    lendsNameTo: [
      { kind: "settlement", holds: within(aroundOf) },
      { kind: "mine", holds: within(aroundOf) },
    ],
  },
};
