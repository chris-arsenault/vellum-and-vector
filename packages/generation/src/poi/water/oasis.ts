// @needsResolution carry: a carried place may not resolve on a finer map (ADR 0009).
import type { GenerationState } from "../../process";
import { carryWhereItLands, costNear, counterpartOf, movesTo } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiFieldChange, type PoiPlace } from "../poiContract";
import { namingCultureNear, rulePlaces, within } from "../poiPlaces";
import { ruleRecord } from "../poiRecords";
import { isLand, magicRule, magicValue } from "../poiReads";
import { aloneAmong, attachment, weighed } from "../poiVisibilityRules";
import { areaOf, drynessAround, spans } from "./waterReads";

/** Metres of soil water it holds out to its edge. */
const heldWater = 0.4;
/** How far a caravan bends to it, in cell spans, and how much cheaper the going gets there. */
const caravanReach = 4,
  caravanSaving = 0.6;

const isA = magicRule("greenwood", "oasis");
const sourceAt = (state: GenerationState, cell: number) =>
  magicValue(state, "greenwood", "source", cell);
const places = rulePlaces("oasis", "greenwood", "oasis");
const around = spans(8);
const counterpart = counterpartOf(isA, 1);
const strengthOf = (state: GenerationState, place: PoiPlace) =>
  Math.min(1, sourceAt(state, place.anchor) / 1000);
const factors = {
  /** Half its weight is its spring's strength; the rest grows with the ground it holds. */
  magnitude: (state: GenerationState, place: PoiPlace) =>
    (strengthOf(state, place) + areaOf(state, place) / (areaOf(state, place) + 1e7)) / 2,
  localConditions: drynessAround(around),
  isolation: aloneAmong(places, around),
  cultural: attachment(around),
};

const wateredCells = (
  state: GenerationState,
  cells: readonly number[]
): readonly PoiFieldChange[] =>
  cells
    .filter((cell) => isLand(state, cell))
    .map((cell) => ({ change: "atLeast", band: "SoilWater", cell, value: heldWater }));
const wateredGround = (state: GenerationState, place: PoiPlace) => wateredCells(state, place.cells);
/** Trees over it end the rule that made it: the system no longer holds it as bare-ground water. */
const groveWithin = (state: GenerationState, place: PoiPlace) => !isA(state, place.anchor);

export const oasis: PoiEntry = {
  id: "oasis",
  group: "water",
  name: "Oasis",
  recognition: {
    distinct:
      "A cell in Greenwood's oasis rule: a spring origin (source:spring) on land with TreeCover at most 0.12. It is a wellspring on bare ground, so it differs from a Greenwood spring by the cover alone and from a natural spring by the aquifer origin; from a lake by having no water body; from a forest because it is the water, not yet the trees.",
    isA,
  },
  existence: {
    statement:
      "Emerges where Greenwood's aquifer rises on open, soluble rock with nothing yet growing there. Only that rule grows one today; the generator has no non-magical desert oasis, and ground water in a dry land without the aquifer origin is a natural spring.",
    way: "emerges",
    requires: notApplicable("Greenwood's own rule reads the aquifer and the cover."),
    suitability: notApplicable("The aquifer rises where the rock allows; no process chooses."),
    places,
  },
  publication: {
    statement: "Every oasis publishes as Greenwood's oasis rule, the class the map's magic reads.",
    moment: "magic",
    record: ruleRecord("greenwood", "oasis"),
  },
  fields: {
    statement:
      "An oasis is water in dry country and the seed of cover: it keeps its soil wet on ground that would otherwise be bare. Greenwood's intensity writes the verdure that establishes plants there, and its source is a magic source in its own right.",
    terrain: notApplicable(
      "Its water comes up without cutting; the karst only changes when the spring fails, which is the sinkhole rule."
    ),
    water: wateredGround,
    climate: notApplicable(
      "A grove's shade is below what the climate resolves over a desert's air."
    ),
    cover: notApplicable("`magicLivingFeedback` writes Greenwood's verdure by intensity."),
    magic: notApplicable("Greenwood's own spring origin writes its source."),
  },
  acrossMaps: {
    statement:
      "A captured oasis lands on finer ground that must keep the water there. On the developed ground it stands at the nearest oasis cell; when it finds none it keeps its place, since water that rose on the parent still rises.",
    carry: carryWhereItLands,
    realize: (state, carried) => wateredCells(state, carried.cells),
    counterpart,
    unrealized: movesTo(counterpart),
    settle: movesTo(counterpart),
    schedule: notApplicable(
      "An oasis has no step in refinement's schedule; Greenwood's rule reads it."
    ),
  },
  movement: {
    statement:
      "Caravans bend across a desert to an oasis, which is the only cheap going in its country; Greenwood's groundwater and roots run out from it across otherwise impassable bare ground. It has no channel worth a boat.",
    roads: costNear(caravanSaving, spans(caravanReach)),
    boats: notApplicable("Its water seeps into the ground around it and floats nothing."),
    drainage: costNear(0.8),
    magic: { roots: costNear(0.7, (state) => around(state) / 2) },
    links: notApplicable("An oasis joins no two cells; a caravan's way to it is a road."),
    crosses: notApplicable(
      "Its effect on a dry crossing is its road cost; no listed barrier is what it opens."
    ),
  },
  others: {
    statement:
      "An oasis is the bare-ground form of a Greenwood spring and never both at once. Towns and shrines gather at it; roots spreading from it turn it into a spring in a grove; if overdrawn it falls in as a sinkhole field.",
    needs: notApplicable("Its rule holds the aquifer and bare ground it needs."),
    excludes: [
      { kind: "spring", holds: (_state, a, b) => a.cells.includes(b.anchor) },
      { kind: "forest", holds: (_state, a, b) => b.cells.includes(a.anchor) },
    ],
    contains: notApplicable(
      "An oasis is one water; what grows and stands there are nearby places."
    ),
    pairsWith: [
      { kind: "settlement", holds: within(around) },
      { kind: "shrine", holds: within(spans(2)) },
      { kind: "sinkholeField", holds: within(around) },
    ],
  },
  people: {
    statement:
      "An oasis is life in a desert: water and food that decide who can cross and who holds the country, and a holy place to those who come to it. The danger is overdrawing it, which ends it for all.",
    offers(state, place) {
      const dry = factors.localConditions(state, place),
        strong = strengthOf(state, place);
      return { water: dry, food: (dry + strong) / 2, trade: dry / 2, sanctity: strong / 2 };
    },
    threatens: (state, place) => [
      {
        hazard: "collapse of an overdrawn spring",
        reach: spans(2)(state),
        severity: strengthOf(state, place) / 2,
      },
    ],
  },
  time: {
    statement:
      "An oasis is the start of cover: what it plants carries on next epoch, and with trees over it, it is a Greenwood spring. Drawn past its recharge it falls in and leaves a sinkhole field.",
    fate(state, place) {
      if (magicRule("greenwood", "sinkhole")(state, place.anchor))
        return { fate: "ends", leaves: "sinkholeField" };
      return groveWithin(state, place) ? { fate: "becomes", kind: "spring" } : { fate: "persists" };
    },
  },
  visibility: {
    statement:
      "An oasis earns its mark from the emptiness around it: the drier its country and the further the next water the more it matters, whatever its size. Those who depend on it carry it further still.",
    ...factors,
    importance: weighed(factors, { magnitude: 0.15, localConditions: 0.5, isolation: 0.35 }),
  },
  naming: {
    statement: "Named by those who cross to it; a caravan town at its water takes its name.",
    namedBy: namingCultureNear,
    takesNameFrom: notApplicable("Nothing older stands in its country to name it after."),
    lendsNameTo: [
      { kind: "settlement", holds: within(around) },
      { kind: "shrine", holds: within(spans(2)) },
    ],
  },
};
