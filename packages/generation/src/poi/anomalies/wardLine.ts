// @needsResolution carry: a carried place may not resolve on a finer map (ADR 0009).
import type { GenerationState } from "../../process";
import { carryWhereItLands, counterpartOf, stays } from "../poiCarry";
import { notApplicable, type PoiCost, type PoiEntry, type PoiPlace } from "../poiContract";
import { holds, namingCultureNear, rulePlaces, within } from "../poiPlaces";
import { ruleRecord } from "../poiRecords";
import { fieldOf, magicRule } from "../poiReads";
import { aloneAmong, attachment, sized, standsOut, weighed } from "../poiVisibilityRules";
import { countryOf, magicFieldOf, peakOf } from "./anomalyReads";
import { hallowedAt, peakWard, wardArea, wardedCarriers } from "./wardReads";

/** A kept line this long, in metres, is half as great as lines get. */
const typicalLength = 50_000;
/** A line's country, and how far from it a crossing party is turned back, in metres. */
const countryMetres = 10_000,
  watchMetres = 2000;
/** What it costs a road to cross a kept line where no way is worn through it. */
const watchedCrossing = 2;

const isA = magicRule("hallowed", "line");
const places = rulePlaces("wardLine", "hallowed", "line");
const around = countryOf(countryMetres);
const counterpart = counterpartOf(isA, 1);
const hallowed = (state: GenerationState) => magicFieldOf(state, "hallowed");
const lineSourceAt = (state: GenerationState, cell: number) =>
  hallowed(state)?.originSources.line?.get(cell) ?? 0;
/** A line's length along the ground: the width of a cell for every cell it holds. */
const lengthOf = (state: GenerationState, place: PoiPlace) =>
  Math.sqrt(wardArea(state, place) * place.cells.length);
/** Whether pilgrims have worn a road here: it is the gate in the line, not a crossing of it. */
const wornThrough = (state: GenerationState, cell: number) => {
  const full = hallowed(state)?.definition.parameters.roadFull;
  return full !== undefined && fieldOf(state).WalkedRoute.get(cell) / full >= 0.1;
};
const factors = {
  magnitude: sized(lengthOf, typicalLength),
  localConditions: standsOut(hallowedAt, around),
  isolation: aloneAmong(places, (state) => 2 * around(state)),
  cultural: attachment(around),
};

export const wardLine: PoiEntry = {
  id: "wardLine",
  group: "anomalies",
  name: "Ward line",
  recognition: {
    distinct:
      "A cell of Hallowed's line rule: on land or a lake, carrying Hallowed's line origin as a source and past the rule's intensity. It is a line people keep: a held frontier, a maintained work or a road pilgrims wear. A sanctuary ring is an area around a seat and has no line source; a walked road below the system's floor is only a road.",
    isA,
  },
  existence: {
    statement:
      "Emerges where people keep a frontier or a work over years, or wear a road with pilgrims; past a tenth of a full line it wards the ground it runs along.",
    way: "emerges",
    requires: (state, cell) => lineSourceAt(state, cell) > 0,
    suitability: notApplicable("People's keeping places a line; nothing chooses a site."),
    places,
  },
  publication: {
    statement: "Every connected line publishes as Hallowed's line class, outlined by its coverage.",
    moment: "magic",
    record: ruleRecord("hallowed", "line"),
  },
  fields: {
    statement:
      "A kept line holds its beds and turns aside what would cross it, and what it holds back lands beside it. All of it follows from Hallowed's Warding band wherever that stands.",
    terrain: notApplicable(
      "Hallowed's rock writes by intensity and `hallowedWrites`' spill below the ward shape the ground."
    ),
    water: notApplicable(
      "`hallowedWrites` and `wardCoasts` move the cutting and the coastal forcing past the ward."
    ),
    climate: notApplicable("`hallowedWrites` lays the storm energy it holds back on the rim."),
    cover: notApplicable("A ward changes no cover directly; what it keeps out is what would."),
    magic: notApplicable(
      "`magicLivingFeedback` writes Warding and `applyWarding` scales the other systems by it."
    ),
  },
  acrossMaps: {
    statement:
      "A captured line's source and ward stand on the refined map, so it has a counterpart where it lands. Water does not move it.",
    carry: carryWhereItLands,
    realize: notApplicable("The regional evaluation keeps the captured ward as a floor."),
    counterpart,
    unrealized: stays,
    settle: notApplicable("A round's water moves no ward."),
    schedule: notApplicable("The captured ward is all a line brings to a refinement."),
  },
  movement: {
    statement:
      "A road pays to cross a kept line except where a way is worn through it, and that worn way is how a route crosses the ward. What magic's carriers bear is kept out, in the share the ward holds and wholly where it seals the cell. Water's own course changes only by the harder banks, which the material's resistance already reads.",
    roads: (state, place) =>
      place.cells
        .filter((cell) => !wornThrough(state, cell))
        .map((cell): PoiCost => ({ cell, factor: watchedCrossing })),
    boats: notApplicable("A ward bars no boat; nothing it carries is harmed."),
    drainage: notApplicable("`materialResistance` reads Warding where water cuts its way."),
    magic: wardedCarriers,
    links: notApplicable("A line joins nothing at a distance."),
    crosses: (state, place) =>
      place.cells.some((cell) => wornThrough(state, cell)) ? ["ward"] : [],
  },
  others: {
    statement:
      "A line runs out of a sanctuary or along a held frontier, past shrines and fords, and seals any door on it. An open Fire core breaks the ward at its cell.",
    needs: notApplicable("A frontier can be kept with no sanctuary anywhere near."),
    excludes: [
      { kind: "door", holds },
      { kind: "fireCore", holds },
    ],
    contains: notApplicable("A line is too narrow to hold a place of its own."),
    pairsWith: [
      { kind: "wardRing", holds: within(around) },
      { kind: "shrine", holds: within(around) },
      { kind: "ford", holds: within(around) },
    ],
  },
  people: {
    statement:
      "A kept line is a frontier that holds and a road on which pilgrims are safe. What it turns back gathers at its edge, and crossing it away from the worn way invites the watch.",
    offers(state, place) {
      const strength = peakWard(state, place);
      return { defence: strength, sanctity: strength / 2, trade: strength / 4 };
    },
    threatens: (state, place) => [
      {
        hazard: "what the ward turns back, at its edge",
        reach: watchMetres,
        severity: peakOf(state, place, hallowedAt) / 2000,
      },
    ],
  },
  time: {
    statement:
      "A line holds while people keep it. Unkept, it lapses to its stored charge, loses three tenths an epoch and goes, leaving nothing.",
    fate: (state, place) =>
      place.cells.some((cell) => lineSourceAt(state, cell) > 0)
        ? { fate: "persists" }
        : { fate: "ends" },
  },
  visibility: {
    statement:
      "A line shows by how far it runs and how far its ward stands out of its country; a town on it carries a short one.",
    ...factors,
    importance: weighed(factors, { magnitude: 0.5, localConditions: 0.3, isolation: 0.2 }),
  },
  naming: {
    statement:
      "Named by those who keep it, after the settlement that keeps it; a shrine or ford on it may take its name.",
    namedBy: namingCultureNear,
    takesNameFrom: [{ kind: "settlement", holds: within(around) }],
    lendsNameTo: [
      { kind: "shrine", holds: within(around) },
      { kind: "ford", holds: within(around) },
    ],
  },
};
