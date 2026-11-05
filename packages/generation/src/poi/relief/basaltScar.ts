// @needsResolution carry: a carried place may not resolve on a finer map (ADR 0009).
import { carryWhereItLands, costNear, counterpartOf, stays } from "../poiCarry";
import { notApplicable, type PoiEntry } from "../poiContract";
import { holds, namingCultureNear, rulePlaces, within } from "../poiPlaces";
import { ruleRecord } from "../poiRecords";
import { magicRule, rockAt } from "../poiReads";
import { aloneAmong, attachment, sized, standsOut, weighed } from "../poiVisibilityRules";
import { areaOf, holdGradient, lastsWhile, spans, standsIn, thinSoilOf } from "./reliefShape";

/** Area at which a scar is half as great as scars get: a long sealed conduit's. */
const typicalArea = 500_000_000;

const isA = magicRule("fire", "scar");
const places = rulePlaces("basaltScar", "fire", "scar");
const counterpart = counterpartOf(isA, 1);
const factors = {
  magnitude: sized(areaOf, typicalArea),
  localConditions: standsOut(rockAt, spans(8)),
  isolation: aloneAmong(places, spans(12)),
  cultural: attachment(spans(8)),
};

export const basaltScar: PoiEntry = {
  id: "basaltScar",
  group: "relief",
  name: "Basalt scar",
  recognition: {
    distinct:
      "A cell in Fire's scar rule: land on a conduit that carried its budget of Fire and sealed. The rule is the definition. A basalt flat is the same rock still burning on level ground, a thermal vein a conduit still open, and a sinkhole field the seal Greenwood's karst makes, on another system's field.",
    isA,
  },
  existence: {
    statement:
      "Emerges when a conduit of Fire spends its budget: sinter and basalt close it, and the vein beyond goes cold in the next epoch. Nothing sites one.",
    way: "emerges",
    requires: notApplicable("It reads Fire's own rule."),
    suitability: notApplicable("A conduit seals where its budget ran out; nothing chooses."),
    places,
  },
  publication: {
    statement: "Each connected group of the rule's cells publishes as Fire's scar class.",
    moment: "magic",
    record: ruleRecord("fire", "scar"),
  },
  fields: {
    statement:
      "A scar is cold hard rock with thin soil on it and its fractures shut down to the floor, so Fire no longer travels it.",
    terrain: (state, place) => holdGradient(state, place.cells),
    water: notApplicable("Sealed rock sheds water through the ordinary drainage."),
    climate: notApplicable("Cold rock changes no air the climate field resolves."),
    cover: (_state, place) => thinSoilOf(place.cells),
    magic: notApplicable(
      "Fire's rock feedback collapses the conductance at the seal; the conduit's cores stay as its spent stock."
    ),
  },
  acrossMaps: {
    statement:
      "A captured scar lands where Fire's class still reads it on the refined map, since magic classes are captured; where it does not, its record stays where it landed.",
    carry: carryWhereItLands,
    realize(state, carried) {
      const cell = counterpart(state, carried);
      return holdGradient(
        state,
        [cell >= 0 ? cell : carried.cell],
        state.physical.profile.PlainSlopeThreshold
      );
    },
    counterpart,
    unrealized: stays,
    settle: notApplicable("Sealed rock does not change with a round's water."),
    schedule: notApplicable("Holding its ground is all a scar asks of a refinement."),
  },
  movement: {
    statement:
      "A scar is firm cold going for a road, and streams work round its hard rock. Fire cannot cross it, since the seal shut the fractures it travels.",
    roads: costNear(0.8),
    boats: notApplicable("A sheet of cold rock has no water to carry boats."),
    drainage: costNear(1.3),
    magic: notApplicable("Crust-borne Fire reads the conductance the seal collapsed."),
    links: notApplicable("A scar joins nothing."),
    crosses: notApplicable("It is ground to cross, not a way across a barrier."),
  },
  others: {
    statement:
      "A scar follows the flats and veins of the conduit it closed and is a common site for ruins. It cannot lie under a lake or carry forest without first being buried.",
    needs: notApplicable("Fire's rule already says what made it."),
    excludes: [
      { kind: "lake", holds: standsIn },
      { kind: "forest", holds: standsIn },
    ],
    contains: [{ kind: "ruin", holds }],
    pairsWith: [
      { kind: "basaltFlat", holds: within(spans(4)) },
      { kind: "thermalVein", holds: within(spans(6)) },
    ],
  },
  people: {
    statement:
      "A scar gives good stone, ruined conduits with spent ore in them, and a kind of awe; it threatens no one, being cold.",
    offers: (state, place) => ({
      materials: rockAt(state, place.anchor),
      sanctity: 0.4,
    }),
    threatens: notApplicable("A sealed conduit is cold; its danger went with its Fire."),
  },
  time: {
    statement:
      "A scar lasts as long as the seal does. New strain across it can crack the seal, and then Fire runs again and it ends; sediment may bury it without changing what it is.",
    fate: lastsWhile(isA, "thermalVein"),
  },
  visibility: {
    statement:
      "A scar shows by its area and how much harder it stands than the country around it; a cold old scar is mostly drawn for the ruins and towns on it.",
    ...factors,
    importance: weighed(factors, { magnitude: 0.5, localConditions: 0.3, isolation: 0.2 }),
  },
  naming: {
    statement: "Named by the nearest people, usually for the fire that went out there.",
    namedBy: namingCultureNear,
    takesNameFrom: [{ kind: "basaltFlat", holds: within(spans(4)) }],
    lendsNameTo: [{ kind: "ruin", holds }],
  },
};
