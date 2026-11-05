// @needsResolution carry: a carried place may not resolve on a finer map (ADR 0009).
import { carryWhereItLands, counterpartOf, stays, costNear } from "../poiCarry";
import { notApplicable, type PoiEntry } from "../poiContract";
import { holds, namingCultureNear, rulePlaces, within } from "../poiPlaces";
import { ruleRecord } from "../poiRecords";
import { magicRule, magicValue, rockAt } from "../poiReads";
import { aloneAmong, attachment, sized, standsOut, weighed } from "../poiVisibilityRules";
import {
  areaOf,
  holdGradient,
  lastsWhile,
  meanOf,
  spans,
  standsIn,
  strengthOf,
  thinSoilOf,
} from "./reliefShape";

/** Area at which a flat is half as great as flats get: a world landscape's least. */
const typicalArea = 2_000_000_000;

const isA = magicRule("fire", "basalt");
const sealed = magicRule("fire", "scar");
const places = rulePlaces("basaltFlat", "fire", "basalt");
const counterpart = counterpartOf(isA, 1);
const heat = strengthOf("fire");
const factors = {
  magnitude: meanOf(sized(areaOf, typicalArea), heat),
  localConditions: standsOut(
    (state, cell) => magicValue(state, "fire", "intensity", cell),
    spans(8)
  ),
  isolation: aloneAmong(places, spans(12)),
  cultural: attachment(spans(8)),
};

export const basaltFlat: PoiEntry = {
  id: "basaltFlat",
  group: "relief",
  name: "Basalt flat",
  recognition: {
    distinct:
      "A cell in Fire's basalt rule: strong intensity on nearly level land. The rule is the definition. A plateau is level ground of any rock, a glass flat fused salt, a volcano a recorded cone, and a conduit that carried its budget and sealed is a basalt scar.",
    isA,
  },
  existence: {
    statement:
      "Emerges where Fire's strong conduits flood level ground. When its conduit spends its budget it seals to a basalt scar; nothing sites one.",
    way: "emerges",
    requires: notApplicable("It reads Fire's own rule."),
    suitability: notApplicable("It lies where heat and flatness met; nothing chooses."),
    places,
  },
  publication: {
    statement: "Each connected group of the rule's cells publishes as Fire's basalt class.",
    moment: "magic",
    record: ruleRecord("fire", "basalt"),
  },
  fields: {
    statement:
      "A flat is a hard level sheet with thin soil over it: rock resists, water sinks into the joints, and it heats its ground while it lives.",
    terrain: (state, place) => holdGradient(state, place.cells),
    water: notApplicable(
      "Jointed rock drains through; the field shows that as runoff, without a store it could hold."
    ),
    climate: notApplicable("Hot rock's local air is below what the climate field resolves."),
    cover: (_state, place) => thinSoilOf(place.cells),
    magic: notApplicable(
      "Fire's rock feedback hardens the rock and opens its conduits by intensity."
    ),
  },
  acrossMaps: {
    statement:
      "A captured flat lands where Fire's class still reads it on the refined map, since magic classes are captured; where it does not, its record stays where it landed and keeps its ground as level as the plain allows.",
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
    settle: notApplicable("A sheet of rock does not change with a round's water."),
    schedule: notApplicable("A level top is all a flat asks of a refinement."),
  },
  movement: {
    statement:
      "A flat is level going for roads, but while it burns it scorches them; a live sheet conducts Fire through the fractures its conduit keeps open.",
    roads: costNear(1.4),
    boats: notApplicable("A level sheet of rock has no water to carry boats."),
    drainage: costNear(1.3),
    magic: notApplicable("Crust-borne Fire spreads by the conductance its conduits keep open."),
    links: notApplicable("A flat joins nothing."),
    crosses: notApplicable("A hard flat is easy ground, not a way across a barrier."),
  },
  others: {
    statement:
      "A flat spreads round volcanoes and over veins that fed it, and seals to a scar. It cannot lie under a lake or carry forest without first being buried.",
    needs: notApplicable("Fire's rule already says what made it."),
    excludes: [
      { kind: "lake", holds: standsIn },
      { kind: "forest", holds: standsIn },
    ],
    contains: [{ kind: "thermalVein", holds }],
    pairsWith: [
      { kind: "volcano", holds: within(spans(8)) },
      { kind: "plateau", holds: standsIn },
      { kind: "basaltScar", holds: within(spans(4)) },
    ],
  },
  people: {
    statement: "A flat gives good stone and a firm road, and burns what stands on it.",
    offers: (state, place) => ({
      materials: rockAt(state, place.anchor),
      trade: factors.magnitude(state, place) / 2,
    }),
    threatens(state, place) {
      const live = heat(state, place);
      return live > 0 ? [{ hazard: "burning ground", reach: spans(1)(state), severity: live }] : [];
    },
  },
  time: {
    statement:
      "A live flat seals to a scar when its conduit's budget is spent; once its heat falls below the rule without sealing, or sediment takes its level, it ends.",
    fate(state, place) {
      if (sealed(state, place.anchor)) return { fate: "becomes", kind: "basaltScar" };
      return lastsWhile(isA)(state, place);
    },
  },
  visibility: {
    statement:
      "A flat shows by its area and heat and by standing hotter than the country around it.",
    ...factors,
    importance: weighed(factors, { magnitude: 0.5, localConditions: 0.35, isolation: 0.15 }),
  },
  naming: {
    statement: "Named by the nearest people, usually for its colour or for what burned there.",
    namedBy: namingCultureNear,
    takesNameFrom: [{ kind: "volcano", holds: within(spans(8)) }],
    lendsNameTo: [{ kind: "basaltScar", holds: within(spans(4)) }],
  },
};
