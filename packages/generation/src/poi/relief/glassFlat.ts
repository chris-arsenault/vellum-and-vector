import type { GenerationState } from "../../process";
import { carryWhereItLands, costNear, counterpartOf, goes, movesTo } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiPlace } from "../poiContract";
import { namingCultureNear, rulePlaces, within } from "../poiPlaces";
import { ruleRecord } from "../poiRecords";
import { magicRule, magicValue, shareAround } from "../poiReads";
import { aloneAmong, attachment, sized, standsOut, weighed } from "../poiVisibilityRules";
import {
  areaOf,
  bareOf,
  holdGradient,
  lastsWhile,
  meanOf,
  spans,
  standsIn,
  strengthOf,
} from "./reliefShape";

/** Area at which a flat is half as great as flats get. */
const typicalArea = 2_000_000_000;

const isA = magicRule("salt", "flat");
const saltAt = (state: GenerationState, cell: number) =>
  magicValue(state, "salt", "intensity", cell);
const places = rulePlaces("glassFlat", "salt", "flat");
const counterpart = counterpartOf(isA, 1);
const saltOf = strengthOf("salt");
const rimmed = (state: GenerationState, place: PoiPlace) =>
  shareAround(state, place.anchor, (next) => isA(state, next));
const factors = {
  magnitude: meanOf(sized(areaOf, typicalArea), saltOf),
  localConditions: standsOut(saltAt, spans(8)),
  isolation: aloneAmong(places, spans(12)),
  cultural: attachment(spans(8)),
};

export const glassFlat: PoiEntry = {
  id: "glassFlat",
  group: "relief",
  name: "Glass flat",
  recognition: {
    distinct:
      "A land cell in Salt's flat rule: at least the rule's depth of bed, from a dead lake or the dead, deep enough to fuse the ground. It is the depth of bed that decides: a salt pan is salted ground without fused rock, a killing ground holds brine rather than bed, dust is wind-borne and thin, and a basalt flat is fire's rock with no salt in it. Which origin laid the bed is a property.",
    isA,
  },
  existence: {
    statement:
      "Emerges where Salt's bed has built past the depth that fuses the ground, and burns to glass where Fire reaches it; the great salt pan record seeds a bed that can grow one. It is not itself sited.",
    way: "emerges",
    requires: notApplicable("The rule reads Salt's own stock; nothing else is asked."),
    suitability: notApplicable("A bed grows where a lake died or the dead lay; nothing chooses."),
    places,
  },
  publication: {
    statement: "Each connected group of the rule's cells publishes as Salt's flat class.",
    moment: "magic",
    record: ruleRecord("salt", "flat"),
  },
  fields: {
    statement:
      "Fused ground is a hard mirror with no soil: Salt's own steps harden the rock, strip the soil where it burns and dry the ground, the ground stays level, nothing roots, and bed dust keeps blowing from its edges.",
    terrain: (state, place) => holdGradient(state, place.cells),
    water: notApplicable("Salt's desiccation dries the ground by its salting, field-wide."),
    climate: notApplicable("Mirages and glare have no band for the climate field to read."),
    cover: (_state, place) => bareOf(place.cells),
    magic: notApplicable("Salt's feedback writes the salting from its own intensity."),
  },
  acrossMaps: {
    statement:
      "A captured flat lands where Salt's class still reads on the refined map, since magic classes are captured, and its ground stays as level as the parent's. A cell that reads no flat within reach leaves it to the system: the flat goes.",
    carry: carryWhereItLands,
    realize(state, carried) {
      const cell = counterpart(state, carried);
      return cell < 0
        ? []
        : holdGradient(state, [cell], state.physical.profile.PlainSlopeThreshold);
    },
    counterpart,
    unrealized: (state, carried) =>
      counterpart(state, carried) >= 0 ? movesTo(counterpart)(state, carried) : goes(),
    settle: notApplicable("Its bed builds over epochs; a round's water does not move it."),
    schedule: notApplicable("A level top is all a flat asks of a refinement."),
  },
  movement: {
    statement:
      "Hard level glass is easy going with no water or shade; streams sheet off it rather than cut it, and wind and carters take Salt's bed from it to everywhere else.",
    roads: costNear(0.8),
    boats: notApplicable("A dry bed carries no boats, even where a shallow sheet stands on it."),
    drainage: costNear(2),
    magic: { wind: costNear(0.7), people: costNear(0.7) },
    links: notApplicable("A flat joins nothing."),
    crosses: notApplicable("It is a dry expanse; it is ground to cross, not a crossing."),
  },
  others: {
    statement:
      "A flat is the deep heart of Salt's ground: pans and killing grounds lie round it and dust blows off it. Nothing grows on it, so forest and wetland cannot share its ground.",
    needs: notApplicable("A deep bed is all it reads, and the bed is not a catalogue place."),
    excludes: [
      { kind: "forest", holds: standsIn },
      { kind: "wetland", holds: standsIn },
      { kind: "lake", holds: standsIn },
    ],
    contains: notApplicable("Pans and dust lie around it, recognized on their own stock."),
    pairsWith: [
      { kind: "saltPan", holds: within(spans(4)) },
      { kind: "saltDust", holds: within(spans(6)) },
      { kind: "killingGround", holds: within(spans(6)) },
    ],
  },
  people: {
    statement:
      "A flat gives salt and a road, and a fearful holiness to those who cross it. Cross it unprepared and it kills by thirst and glare.",
    offers: (state, place) => ({
      materials: saltOf(state, place),
      trade: rimmed(state, place) / 2,
      sanctity: factors.magnitude(state, place),
    }),
    threatens: (state, place) => [
      {
        hazard: "desiccation",
        reach: spans(2)(state),
        severity: saltOf(state, place),
      },
    ],
  },
  time: {
    statement:
      "Salt does not decay, so a flat lasts epochs; rain and wet ground dissolve its bed back to brine, and when the bed falls below the fusing depth it ends, leaving a pan.",
    fate: lastsWhile(isA, "saltPan"),
  },
  visibility: {
    statement:
      "A flat shows by its area and strength, and by being unlike all country around it; people travel a long way for its salt, and any town on its shore carries it.",
    ...factors,
    importance: weighed(factors, { magnitude: 0.5, localConditions: 0.4, isolation: 0.1 }),
  },
  naming: {
    statement: "Named by salt-carriers and those who fear it, often for the dead lake it replaced.",
    namedBy: namingCultureNear,
    takesNameFrom: notApplicable("A dead lake is gone before anyone names what it left."),
    lendsNameTo: [
      { kind: "saltPan", holds: within(spans(4)) },
      { kind: "settlement", holds: within(spans(6)) },
    ],
  },
};
