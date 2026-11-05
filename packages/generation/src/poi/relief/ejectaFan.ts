// @needsResolution carry: a carried place may not resolve on a finer map (ADR 0009).
import type { GenerationState } from "../../process";
import { carryWhereItLands, costNear, counterpartOf, goes, movesTo } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiFate, type PoiPlace } from "../poiContract";
import { holds, namingCultureNear, rulePlaces, within } from "../poiPlaces";
import { ruleRecord } from "../poiRecords";
import { fieldOf, magicRule, magicValue, metres } from "../poiReads";
import { aloneAmong, attachment, sized, standsOut, weighed } from "../poiVisibilityRules";
import { areaOf, meanOf, spans, standsIn } from "./reliefShape";

/** Thickness and area at which a fan is half as great as fans get. */
const typicalThickness = 10,
  typicalArea = 2_000_000_000;

const isA = magicRule("fire", "fan");
const thicknessAt = (state: GenerationState, cell: number) =>
  metres(fieldOf(state).ImpactEjectaThickness.get(cell));
const places = rulePlaces("ejectaFan", "fire", "fan");
const thicknessOf = (state: GenerationState, place: PoiPlace) => thicknessAt(state, place.anchor);
const counterpart = counterpartOf(isA, 1);
const burning = (state: GenerationState, place: PoiPlace) =>
  magicValue(state, "fire", "source", place.anchor) / 1000;
const factors = {
  magnitude: meanOf(sized(thicknessOf, typicalThickness), sized(areaOf, typicalArea)),
  localConditions: standsOut(thicknessAt, spans(8)),
  isolation: aloneAmong(places, spans(12)),
  cultural: attachment(spans(6)),
};

export const ejectaFan: PoiEntry = {
  id: "ejectaFan",
  group: "relief",
  name: "Ejecta fan",
  recognition: {
    distinct:
      "A cell in Fire's fan rule: land where fallen stock is releasing. The rule is the definition. Ordinary sediment does not count however thick it is, and a placer is the river's gravel below it, not the blanket. Ejecta that has gone quiet stays in the band as material, no longer a fan.",
    isA,
  },
  existence: {
    statement:
      "Emerges at the moment of an impact, thrown out to about twice the crater's radius and elongated downwind; a record's impact makes it the same way. It is never sited for its own sake.",
    way: "emerges",
    requires: notApplicable("A falling body wrote it; nothing had to be ready."),
    suitability: notApplicable("It lies where the fall threw it."),
    places,
  },
  publication: {
    statement: "Each connected group of the rule's cells publishes as Fire's fan class.",
    moment: "magic",
    record: ruleRecord("fire", "fan"),
  },
  fields: {
    statement:
      "A fan is a loose apron of broken rock and fallen metal that buries what was there and leaves a barren skin while it burns. Fire reads the metal in it as a finite source, which cracking agents release and rivers wash down.",
    terrain: notApplicable("The impact deposits the blanket when it falls."),
    water: notApplicable(
      "Broken rock drains through without holding or sourcing water the field would show."
    ),
    climate: notApplicable("A blanket metres thick is below anything the climate field reads."),
    cover: notApplicable("Fire's barren-fan step poisons the ground while the fall is fresh."),
    magic: notApplicable("The impact's shock writes the heat; Fire's stocks hold the metal."),
  },
  acrossMaps: {
    statement:
      "A captured fan lands where Fire's rule still reads it on the refined map, since magic classes are captured. Where the rule no longer reads, the quiet fan has nothing to stand on and goes.",
    carry: carryWhereItLands,
    realize: notApplicable("A blanket has no form for finer relief to develop."),
    counterpart,
    unrealized: (state, carried) =>
      counterpart(state, carried) >= 0 ? movesTo(counterpart)(state, carried) : goes(),
    settle: notApplicable(
      "It is carried with the crust over epochs, not moved by a round's water."
    ),
    schedule: notApplicable("A blanket has no step of its own in a refinement."),
  },
  movement: {
    statement:
      "Broken rock is slow going for a road, loose enough that streams rework it first, and a stock of metal that rivers wash onward as gravel.",
    roads: costNear(1.2),
    boats: notApplicable("A dry apron has no water for boats."),
    drainage: costNear(0.9),
    magic: notApplicable(
      "Its metal moves by Fire's own crust and river carriers; the blanket changes neither."
    ),
    links: notApplicable("A fan joins nothing."),
    crosses: notApplicable("It is rough ground to cross, not a way over a barrier."),
  },
  others: {
    statement:
      "A fan lies round the crater that threw it, gives its metal to the placers below and compass deviations over it, and may carry a killing ground from what the fall did.",
    needs: notApplicable(
      "Only a fall writes the blanket, and the blanket outlives a worn-out pit."
    ),
    excludes: [{ kind: "crater", holds: standsIn }],
    contains: [{ kind: "compassDeviation", holds }],
    pairsWith: [
      { kind: "crater", holds: within(spans(10)) },
      { kind: "placer", holds: within(spans(6)) },
      { kind: "killingGround", holds },
    ],
  },
  people: {
    statement:
      "A fan is metal for those who can reach it, thinning with distance from the pit; a young fan burns anyone on it and a cold one grows little.",
    offers: (state, place) => ({ materials: sized(thicknessOf, typicalThickness)(state, place) }),
    threatens: (state, place) => {
      const heat = burning(state, place);
      return heat > 0 ? [{ hazard: "burning ground", reach: spans(1)(state), severity: heat }] : [];
    },
  },
  time: {
    statement:
      "A fan thins as rivers wash its metal to placers and panning draws it down; when no blanket or fire is left, the gravels below are all that remains of it.",
    fate(state, place): PoiFate {
      return isA(state, place.anchor) ? { fate: "persists" } : { fate: "ends", leaves: "placer" };
    },
  },
  visibility: {
    statement:
      "A fan shows by its thickness and spread, and stands out by how much more it holds than the country round; a fan is usually seen with its crater, and a mining town can carry it alone.",
    ...factors,
    importance: weighed(factors, { magnitude: 0.55, localConditions: 0.35, isolation: 0.1 }),
  },
  naming: {
    statement: "Goes under its crater's name, and takes a name of its own only where metal is dug.",
    namedBy: namingCultureNear,
    takesNameFrom: [{ kind: "crater", holds: within(spans(8)) }],
    lendsNameTo: [{ kind: "mine", holds }],
  },
};
