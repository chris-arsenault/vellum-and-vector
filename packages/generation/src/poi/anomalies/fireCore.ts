import type { GenerationState } from "../../process";
import { carryWhereItLands, costNear, counterpartOf, goes, movesTo } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiPlace } from "../poiContract";
import { namingCultureNear, rulePlaces, within } from "../poiPlaces";
import { ruleRecord } from "../poiRecords";
import { magicRule, magicValue } from "../poiReads";
import { aloneAmong, attachment, sized, standsOut, weighed } from "../poiVisibilityRules";
import { countryOf, intensityOf, magicFieldOf, peakOf, standsIn } from "./anomalyReads";

/** Source strength, per mille, at which a core is half as great as cores get. */
const typicalSource = 500;
/** A core's country, how far its hot ground reaches, and the cost of a road across it. */
const countryMetres = 30_000,
  hotMetres = 5000,
  hotRoad = 1.5;

const isA = magicRule("fire", "core");
const places = rulePlaces("fireCore", "fire", "core");
const fireAt = intensityOf("fire");
const sourceAt = (state: GenerationState, cell: number) =>
  magicValue(state, "fire", "source", cell);
const around = countryOf(countryMetres);
const counterpart = counterpartOf(isA, 1);
const strengthOf = (state: GenerationState, place: PoiPlace) => peakOf(state, place, sourceAt);
const factors = {
  magnitude: sized(strengthOf, typicalSource),
  localConditions: standsOut(fireAt, around),
  isolation: aloneAmong(places, (state) => 2 * around(state)),
  cultural: attachment(around),
};
const peakFire = (state: GenerationState, place: PoiPlace) => peakOf(state, place, fireAt) / 1000;
/** Whether a place's conduit has sealed: its cores stay in the rock as hardened ore. */
const sealedAt = (state: GenerationState, place: PoiPlace) =>
  (magicFieldOf(state, "fire")?.sealed.get(place.anchor) ?? 0) > 0;

export const fireCore: PoiEntry = {
  id: "fireCore",
  group: "anomalies",
  name: "Fire core",
  recognition: {
    distinct:
      "A cell of Fire's core rule: a located source of real strength with Fire's intensity standing on it. A thermal vein is the conduit the core feeds, read from intensity and fracture with no source test; a vent is heat at the sea floor; a fainter source shows only as intensity.",
    isA,
  },
  existence: {
    statement:
      "Emerges where Fire's sources run strong: a vein on a heat maximum, a forge cracking cores in quantity, a crater field in its burning epochs, or rich exhumed ore.",
    way: "emerges",
    requires: (state, cell) => sourceAt(state, cell) > 0,
    suitability: notApplicable(
      "Heat maxima, impacts and forges locate it; nothing chooses a site."
    ),
    places,
  },
  publication: {
    statement: "Every core publishes as Fire's core class: a site at its source.",
    moment: "magic",
    record: ruleRecord("fire", "core"),
  },
  fields: {
    statement:
      "A core is the source of Fire's field, and everything Fire does it does by intensity across that field: heat, melt, quickening and hardened rock. The core as a place adds nothing to them.",
    terrain: notApplicable(
      "Fire's rock writes by intensity (`declareRockWrites` on a refined map)."
    ),
    water: notApplicable("`magicThermalFeedback` melts ice by Fire's intensity."),
    climate: notApplicable("`magicThermalFeedback` applies Fire's heat by intensity."),
    cover: notApplicable("`magicLivingFeedback` writes Quickening from Fire's intensity."),
    magic: notApplicable("Fire's own locators write its source."),
  },
  acrossMaps: {
    statement:
      "A captured core's source stands on the refined map, and its name moves to the nearest cell that passes the rule. With none in reach it goes, and its heat remains only as intensity.",
    carry: carryWhereItLands,
    realize: notApplicable("The regional evaluation keeps Fire's captured source."),
    counterpart,
    unrealized: (state, carried) =>
      counterpart(state, carried) >= 0 ? movesTo(counterpart)(state, carried) : goes(),
    settle: notApplicable("A round's water moves no source."),
    schedule: notApplicable("The captured source is all a core brings to a refinement."),
  },
  movement: {
    statement:
      "Ways skirt its hot ground. A river or a boat meets only what the heat has already done, and Fire's conduits and carried cores already cost what their own propagation reads.",
    roads: costNear(hotRoad, hotMetres),
    boats: notApplicable("A core stands in rock; the water above it costs a boat nothing."),
    drainage: notApplicable("Heat does not steer water; the rock's resistance already counts."),
    magic: notApplicable("Fracture propagation reads the crust's conductance for itself."),
    links: notApplicable("A core joins nothing at a distance."),
    crosses: notApplicable("Hot ground opens no way across anything."),
  },
  others: {
    statement:
      "A core feeds its thermal vein and stands by craters, vents and forges; a mine reaches for it. Its release ruptures a door and breaks a ward at its cell.",
    needs: notApplicable("Any of a vein, a fall or a forge can make one; none is required."),
    excludes: [
      { kind: "door", holds: standsIn },
      { kind: "wardRing", holds: standsIn },
      { kind: "wardLine", holds: standsIn },
    ],
    contains: notApplicable("A core is one point of source."),
    pairsWith: [
      { kind: "thermalVein", holds: within(around) },
      { kind: "crater", holds: within(around) },
      { kind: "vent", holds: within(around) },
      { kind: "forge", holds: within(around) },
      { kind: "mine", holds: within(around) },
    ],
  },
  people: {
    statement:
      "Heat and ore: smiths and miners come for what a core gives, and what it gives is dangerous to stand beside.",
    offers(state, place) {
      const strength = factors.magnitude(state, place);
      return { power: strength, materials: strength };
    },
    threatens: (state, place) => [
      { hazard: "burning ground", reach: hotMetres, severity: peakFire(state, place) },
    ],
  },
  time: {
    statement:
      "A core lasts while its source does. A conduit that seals leaves its cores in the rock as hardened ore, which erosion exhumes and rivers wash down into placers.",
    fate: (state, place) =>
      sealedAt(state, place) ? { fate: "ends", leaves: "placer" } : { fate: "persists" },
  },
  visibility: {
    statement:
      "A core shows by the strength of its source and how far it outburns its country; a forge town beside it carries a small one.",
    ...factors,
    importance: weighed(factors, { magnitude: 0.45, localConditions: 0.35, isolation: 0.2 }),
  },
  naming: {
    statement:
      "Named by the nearest people, miners and smiths, after the crater or peak that marks it; the forge beside it may take its name.",
    namedBy: namingCultureNear,
    takesNameFrom: [{ kind: "crater", holds: within(around) }],
    lendsNameTo: [
      { kind: "forge", holds: within(around) },
      { kind: "mine", holds: within(around) },
    ],
  },
};
