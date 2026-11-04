import type { GenerationState } from "../../process";
import { carryWhereItLands, costNear, counterpartOf, goes, movesTo } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiPlace } from "../poiContract";
import { holds, namingCultureNear, rulePlaces, within } from "../poiPlaces";
import { ruleRecord } from "../poiRecords";
import { fieldOf, iceAt, Landform, landformAt, magicRule } from "../poiReads";
import { aloneAmong, attachment, sized, standsOut, weighed } from "../poiVisibilityRules";
import { auroraAt, chargeHeldAt, countryOf, standsIn } from "./anomalyReads";

/** Ice thickness in metres at which a well's reservoir is half as great as wells get. */
const typicalIce = 500;
/** How much a cell's softened rock cheapens a channel cut through it, at full intensity. */
const cutThrough = 0.3;
/** A well's country, in metres. */
const countryMetres = 5000;

const hollows: readonly number[] = [Landform.Cirque, Landform.Basin, Landform.Valley];
const isA = magicRule("aurora", "well");
const places = rulePlaces("lightWell", "aurora", "well");
const around = countryOf(countryMetres);
const iceOf = (state: GenerationState, place: PoiPlace) => iceAt(state, place.anchor);
const chargeOf = (state: GenerationState, place: PoiPlace) =>
  fieldOf(state).IceCharge.get(place.anchor);
const counterpart = counterpartOf(isA, 1);
const factors = {
  /** A deep reservoir and a full concentration together; either alone is a lesser well. */
  magnitude: (state: GenerationState, place: PoiPlace) =>
    (sized(iceOf, typicalIce)(state, place) + chargeOf(state, place)) / 2,
  localConditions: standsOut(auroraAt, (state) => 2 * around(state)),
  isolation: aloneAmong(places, (state) => 4 * around(state)),
  cultural: attachment((state) => 2 * around(state)),
};

export const lightWell: PoiEntry = {
  id: "lightWell",
  group: "anomalies",
  name: "Light well",
  recognition: {
    distinct:
      "A cell of Aurora's well rule: intensity past the system's highest seed level in a cirque or basin, or joined to such a cell through a valley above the retain level. Landform and intensity decide it, and ice does not: an aurora field needs ice at a lower intensity and a well may stand on bare ground. A frost prism is Aurora on a peak or ridge, the opposite of a hollow.",
    isA,
  },
  existence: {
    statement:
      "Emerges where cold drainage runs out of ground to run to: charge following colder air gathers in a closed hollow and stays. Relict wells outlast the ice that fed them.",
    way: "emerges",
    requires: (state, cell) => hollows.includes(landformAt(state, cell)),
    suitability: notApplicable("Charge finds the hollow; no process picks among hollows."),
    places,
  },
  publication: {
    statement:
      "Every connected well publishes as Aurora's well class: a site at its strongest cell.",
    moment: "magic",
    record: ruleRecord("aurora", "well"),
  },
  fields: {
    statement:
      "A sink of charge in a hollow. Aurora's field softens the rock of its walls, holds any ice there, keeps the hollow colder than its country and stills the ground to glow-lichen; it does all this by intensity, wherever the rule names a well.",
    terrain: notApplicable(
      "Aurora's rock writes by intensity (`declareRockWrites` on a refined map) soften the walls."
    ),
    water: notApplicable("`holdIce` writes IcePersistence from Aurora's held charge."),
    climate: notApplicable("`magicThermalFeedback` applies Aurora's cold by held charge."),
    cover: notApplicable("`magicLivingFeedback` writes Stillness from Aurora's held charge."),
    magic: notApplicable("Aurora's stocks in `magicStocks` write the IceCharge its ice holds."),
  },
  acrossMaps: {
    statement:
      "A captured well lands in the refined relief; its name moves to the nearest cell that passes the rule once the finer landforms exist. With no such hollow in reach, the well goes, and its charge remains only as intensity. A round's water that fills or drains the hollow can move it.",
    carry: carryWhereItLands,
    realize: notApplicable(
      "Aurora's refined field softens and chills the finer hollow each round; relief makes the hollow."
    ),
    counterpart,
    unrealized: (state, carried) =>
      counterpart(state, carried) >= 0 ? movesTo(counterpart)(state, carried) : goes(),
    settle: movesTo(counterpart),
    schedule: notApplicable(
      "Aurora's field is re-derived each round; the well has no step of its own."
    ),
  },
  movement: {
    statement:
      "Cold pools in a well and ways skirt it, though a track to the well itself still ends here. A lake in a well is frozen against boats where ice stands. Its softened rock lets a stream cut an outlet more cheaply. Charge runs into it from the country around.",
    roads: costNear(1.5),
    boats: (state, place) =>
      place.cells
        .filter((cell) => iceAt(state, cell) > 0)
        .map((cell) => ({ cell, factor: Infinity })),
    drainage: (state, place) =>
      place.cells.map((cell) => ({
        cell,
        factor: 1 - (cutThrough * auroraAt(state, cell)) / 1000,
      })),
    magic: { wind: costNear(0.5, around) },
    links: notApplicable("A well joins nothing at a distance."),
    crosses: notApplicable("A cold hollow is an end of a road, not a way over any barrier."),
  },
  others: {
    statement:
      "A well may lie inside an aurora field or stand alone as a relict in a cirque. A door cannot hold where its charge is stored, and readers keep archives and shrines at its rim.",
    needs: notApplicable("Its own test reads the hollow it stands in; a cirque is not required."),
    excludes: [{ kind: "door", holds }],
    contains: notApplicable("A well is one gathered site with nothing inside it."),
    pairsWith: [
      { kind: "auroraField", holds: standsIn },
      { kind: "cirque", holds: standsIn },
      { kind: "archive", holds: within((state) => 2 * around(state)) },
      { kind: "shrine", holds: within(around) },
    ],
  },
  people: {
    statement:
      "The strongest charge people can reach: pilgrims and readers come to it, and crystals are gathered at its rim. It is cold, still and bad for anyone who stays: reading it too long costs the reader their own memories.",
    offers(state, place) {
      const strength = factors.magnitude(state, place);
      return { sanctity: Math.max(0.5, strength), materials: strength };
    },
    threatens: (state, place) => [
      {
        hazard: "cold pool and stilled air",
        reach: around(state),
        severity: chargeHeldAt(state, place.anchor),
      },
    ],
  },
  time: {
    statement:
      "A well fills while cold drainage feeds it and lasts as a relict on stored charge after the ice goes. Once its charge no longer acts, it is spent and what it preserved thaws along a melt line.",
    fate: (state, place) =>
      chargeHeldAt(state, place.anchor) > 0
        ? { fate: "persists" }
        : { fate: "ends", leaves: "meltLine" },
  },
  visibility: {
    statement:
      "A well shows by the depth and concentration of what it holds and by how sharply it outshines the field or country around it; wells are few and a pilgrim road carries a small one.",
    ...factors,
    importance: weighed(factors, { magnitude: 0.5, localConditions: 0.3, isolation: 0.2 }),
  },
  naming: {
    statement:
      "Named by the readers nearest it, after the cirque it fills; an archive at its rim may take its name.",
    namedBy: namingCultureNear,
    takesNameFrom: [{ kind: "cirque", holds: standsIn }],
    lendsNameTo: [
      { kind: "archive", holds: within((state) => 2 * around(state)) },
      { kind: "shrine", holds: within(around) },
    ],
  },
};
