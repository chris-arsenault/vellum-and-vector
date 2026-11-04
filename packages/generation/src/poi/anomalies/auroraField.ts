import type { GenerationState } from "../../process";
import { carryWhereItLands, costNear, counterpartOf, goes, movesTo } from "../poiCarry";
import { notApplicable, type PoiBarrier, type PoiEntry, type PoiPlace } from "../poiContract";
import { holds, namingCultureNear, rulePlaces, within } from "../poiPlaces";
import { ruleRecord } from "../poiRecords";
import { iceAt, isRiver, isSea, magicRule } from "../poiReads";
import { aloneAmong, attachment, sized, standsOut, weighed } from "../poiVisibilityRules";
import { auroraAt, chargeHeldAt, countryOf, weightedArea } from "./anomalyReads";

/** Fully charged ground at which a field is half as great as fields get, in square metres. */
const typicalArea = 1e10;
/** The share of a field under the melt rule at which its ice is going faster than it holds. */
const wastingShare = 0.5;
/** A field's country, and how far its cold shadow lies past it, in metres. */
const countryMetres = 30_000,
  shadowMetres = 10_000;

const isA = magicRule("aurora", "field");
const isMelting = magicRule("aurora", "melt");
const places = rulePlaces("auroraField", "aurora", "field");
const around = countryOf(countryMetres);
const chargedArea = (state: GenerationState, place: PoiPlace) =>
  weightedArea(state, place, (cell) => auroraAt(state, cell) / 1000);
const counterpart = counterpartOf(isA, 2);
const factors = {
  magnitude: sized(chargedArea, typicalArea),
  localConditions: standsOut(auroraAt, around),
  isolation: aloneAmong(places, (state) => 2 * around(state)),
  cultural: attachment(around),
};
/** Share of a place's cells a test holds on. */
const shareOf = (place: PoiPlace, test: (cell: number) => boolean) =>
  place.cells.filter(test).length / place.cells.length;
/** A network's cost across a field: dearer the more charge each cell's ice holds. */
const heldBack = (weight: number) => (state: GenerationState, place: PoiPlace) =>
  place.cells.map((cell) => ({ cell, factor: 1 + weight * chargeHeldAt(state, cell) }));

export const auroraField: PoiEntry = {
  id: "auroraField",
  group: "anomalies",
  name: "Aurora field",
  recognition: {
    distinct:
      "A cell of Aurora's field rule: its intensity and its ice thickness both past the rule's seed levels, or joined to such a cell above its retain levels. It is charge held in standing ice, a sheet. A light well has no ice test and needs a stronger intensity in a cirque or basin; a frost prism needs a peak or ridge; a melt line needs thin ice at a thawing temperature; ice with no Aurora intensity is only ice.",
    isA,
  },
  existence: {
    statement:
      "Emerges where charge falling on cold high ground drains coldward and is captured by thick ice; the ice carries it, and the field grows with the ice that holds it.",
    way: "emerges",
    requires: (state, cell) => iceAt(state, cell) > 0,
    suitability: notApplicable(
      "Cold drainage decides where charge gathers; nothing chooses a site."
    ),
    places,
  },
  publication: {
    statement: "Every connected field publishes as Aurora's field class, outlined by its coverage.",
    moment: "magic",
    record: ruleRecord("aurora", "field"),
  },
  fields: {
    statement:
      "A store of charge in ice. Aurora's field softens the rock beneath, keeps ice past its climate, cools the ground by a few degrees, and stills growth and decay until only rime forest and glow-lichen hold on; it does all this by intensity, whether the rule calls the ground a field or not.",
    terrain: notApplicable(
      "Aurora's rock writes by intensity (`declareRockWrites` on a refined map) soften the ground."
    ),
    water: notApplicable("`holdIce` writes IcePersistence from Aurora's held charge."),
    climate: notApplicable("`magicThermalFeedback` applies Aurora's cold by held charge."),
    cover: notApplicable("`magicLivingFeedback` writes Stillness from Aurora's held charge."),
    magic: notApplicable("Aurora's stocks in `magicStocks` write the IceCharge its ice holds."),
  },
  acrossMaps: {
    statement:
      "A field carries onto the refined map as captured intensity, and the regional magic re-derives it each round from the finer ice. A field whose ice does not develop there moves to the nearest charged ice or goes, and a round's melt can shift it.",
    carry: carryWhereItLands,
    realize: notApplicable(
      "`holdIce` and `magicThermalFeedback` keep the ice and the cold from the refined field each round."
    ),
    counterpart,
    unrealized: (state, carried) =>
      counterpart(state, carried) >= 0 ? movesTo(counterpart)(state, carried) : goes(),
    settle: movesTo(counterpart),
    schedule: notApplicable(
      "Aurora's field is re-derived each round; the place has no step of its own."
    ),
  },
  movement: {
    statement:
      "Charged ice does not soften or open, so boats are barred from it and walkers are slowed by its cold, but a frozen river or sea held by charge is a dependable crossing. Water runs poorly while the ice holds it. Ice carries Aurora's own charge along the field more easily than ground would.",
    roads: heldBack(0.5),
    boats: costNear(Infinity),
    drainage: heldBack(1),
    magic: { ice: costNear(0.7) },
    links: notApplicable("A field joins nothing at a distance."),
    crosses(state, place) {
      const held = place.cells.filter((cell) => chargeHeldAt(state, cell) > 0),
        barriers: PoiBarrier[] = [];
      if (held.some((cell) => isSea(state, cell))) barriers.push("strait");
      if (held.some((cell) => isRiver(state, cell))) barriers.push("river");
      return barriers;
    },
  },
  others: {
    statement:
      "A field may hold light wells and frost prisms, is edged by the melt line where it wastes, and closes any door within it. Readers' archives stand near one for the charge.",
    needs: notApplicable("Its own test already requires the ice it stands in."),
    excludes: [{ kind: "door", holds }],
    contains: [
      { kind: "lightWell", holds },
      { kind: "frostPrism", holds },
    ],
    pairsWith: [
      { kind: "meltLine", holds: within((state) => 2 * around(state)) },
      { kind: "archive", holds: within(around) },
    ],
  },
  people: {
    statement:
      "It gives readers their charge and keeps what falls in it uncorrupted, and it denies farmers their season: nothing ripens under the stillness.",
    offers(state, place) {
      const strength = factors.magnitude(state, place);
      return { sanctity: strength, materials: strength / 2, water: strength / 4 };
    },
    threatens: (state, place) => [
      {
        hazard: "stilled growth and cold shadow",
        reach: shadowMetres,
        severity: chargeHeldAt(state, place.anchor),
      },
    ],
  },
  time: {
    statement:
      "Charge accumulates across cold epochs and part of it outlasts the ice in the ground. When the field retreats the preserved matter thaws fast and the place becomes a fertile melt line.",
    fate: (state, place) =>
      shareOf(place, (cell) => isMelting(state, cell)) >= wastingShare
        ? { fate: "ends", leaves: "meltLine" }
        : { fate: "persists" },
  },
  visibility: {
    statement:
      "A field shows by how much charged ground it covers and how far it outshines its own cold country; one edging into settled land shows sooner than a greater one on an empty cap.",
    ...factors,
    importance: weighed(factors, { magnitude: 0.55, localConditions: 0.3, isolation: 0.15 }),
  },
  naming: {
    statement:
      "Named by the nearest people, usually the readers who work it, after the peak that rises out of it; an archive may take its name.",
    namedBy: namingCultureNear,
    takesNameFrom: [{ kind: "peak", holds }],
    lendsNameTo: [{ kind: "archive", holds: within(around) }],
  },
};
