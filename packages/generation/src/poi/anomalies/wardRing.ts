// @needsResolution carry: a carried place may not resolve on a finer map (ADR 0009).
import type { GenerationState } from "../../process";
import { carryWhereItLands, costNear, counterpartOf, stays } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiPlace } from "../poiContract";
import { holds, namingCultureNear, rulePlaces, within } from "../poiPlaces";
import { ruleRecord } from "../poiRecords";
import { magicRule, magicValue } from "../poiReads";
import { aloneAmong, attachment, sized, standsOut, weighed } from "../poiVisibilityRules";
import { countryOf, peakOf } from "./anomalyReads";
import { hallowedAt, peakWard, wardArea, wardedCarriers } from "./wardReads";

/** A ring of 20 km radius is half as great as rings get, in square metres. */
const typicalArea = Math.PI * 20_000 ** 2;
/** A ring's country, and how wide the dangerous rim outside it lies, in metres. */
const countryMetres = 20_000,
  rimMetres = 5000;
/** How much the ground on which nothing is harmed draws a road to it. */
const safeRoad = 0.8;

const isA = magicRule("hallowed", "ring");
const places = rulePlaces("wardRing", "hallowed", "ring");
const around = countryOf(countryMetres);
const counterpart = counterpartOf(isA, 1);
const factors = {
  magnitude: sized(wardArea, typicalArea),
  localConditions: standsOut(hallowedAt, around),
  isolation: aloneAmong(places, (state) => 2 * around(state)),
  cultural: attachment(around),
};
const hasSeat = (state: GenerationState, place: PoiPlace) =>
  peakOf(state, place, (s, cell) => magicValue(s, "hallowed", "source", cell)) > 0;

export const wardRing: PoiEntry = {
  id: "wardRing",
  group: "anomalies",
  name: "Sanctuary ring",
  recognition: {
    distinct:
      "A cell of Hallowed's ring rule: on land or a lake, with Hallowed's intensity past the rule's level, held out to its retain level. It is an area of ward around a seat. A ward line is the same system along a kept line or a worn road, a shrine is one built work, and warded ground below the rule's level is only faint warding.",
    isA,
  },
  existence: {
    statement:
      "Emerges where people have lived long on one seat: person-years past the system's floor make a source, ways converging on it strengthen it, and the ward falls away to nothing at a reach set by its strength.",
    way: "emerges",
    requires: (state, cell) => hallowedAt(state, cell) > 0,
    suitability: notApplicable("Tenure and converging ways place a seat; nothing chooses a site."),
    places,
  },
  publication: {
    statement: "Every connected ring publishes as Hallowed's ring class, outlined by its coverage.",
    moment: "magic",
    record: ruleRecord("hallowed", "ring"),
  },
  fields: {
    statement:
      "Nothing is harmed inside: beds and banks hold, other systems fall away, and what the ward holds back lands on its rim. All of it follows from Hallowed's Warding band wherever that stands, whether or not the rule calls the ground a ring.",
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
      "A ward the parent established stays on the refined map as a floor under Hallowed's field, so a captured ring has a counterpart wherever it lands. Water does not move it.",
    carry: carryWhereItLands,
    realize: notApplicable("The regional evaluation keeps the captured ward as a floor."),
    counterpart,
    unrealized: stays,
    settle: notApplicable("A round's water moves no ward."),
    schedule: notApplicable("The captured ward is all a ring brings to a refinement."),
  },
  movement: {
    statement:
      "Roads run to a sanctuary and through it: the ground is safe and pilgrims wear it, so a ring draws ways. What magic's carriers bear is kept out, in the share the ward holds and wholly where it seals the cell. Water's own course changes only by the harder banks, which the material's resistance already reads.",
    roads: costNear(safeRoad),
    boats: notApplicable("A ward bars no boat; nothing it carries is harmed."),
    drainage: notApplicable("`materialResistance` reads Warding where water cuts its way."),
    magic: wardedCarriers,
    links: notApplicable("A ring joins nothing at a distance."),
    crosses: notApplicable("A ring bars no walker, so no route needs a way across it."),
  },
  others: {
    statement:
      "A ring holds the settlement and shrine at its seat and seals any door within it, and an open Fire core breaks the ward at its cell. Kept lines and pilgrim roads run out of it.",
    needs: notApplicable(
      "A seat made it, but an abandoned ring fades on stored charge long after the seat is gone."
    ),
    excludes: [
      { kind: "door", holds },
      { kind: "fireCore", holds },
    ],
    contains: [
      { kind: "settlement", holds },
      { kind: "shrine", holds },
    ],
    pairsWith: [
      { kind: "wardLine", holds: within(around) },
      { kind: "shrine", holds: within(around) },
    ],
  },
  people: {
    statement:
      "The ground on which nothing is harmed: pilgrims come, towns shelter under it and magic falls away. What it holds back lands on the rim, so the ground just outside a sanctuary is the most dangerous in the world.",
    offers(state, place) {
      const strength = peakWard(state, place);
      return { sanctity: strength, defence: strength / 2 };
    },
    threatens: (state, place) => [
      {
        hazard: "what the ward holds back, on its rim",
        reach: Math.sqrt(wardArea(state, place) / Math.PI) + rimMetres,
        severity: peakWard(state, place),
      },
    ],
  },
  time: {
    statement:
      "A kept ring holds while its seat is inhabited. Once nobody keeps it, it lapses to its stored charge and loses three tenths an epoch, thinning in coverage until it is gone and leaving nothing behind.",
    fate: (state, place) => (hasSeat(state, place) ? { fate: "persists" } : { fate: "ends" }),
  },
  visibility: {
    statement:
      "A ring shows by the ground it covers and how far its ward stands out of its country; the town at its seat carries a small one.",
    ...factors,
    importance: weighed(factors, { magnitude: 0.4, localConditions: 0.4, isolation: 0.2 }),
  },
  naming: {
    statement:
      "Named by the people who keep it, after the settlement at its seat; a shrine inside it takes the same name.",
    namedBy: namingCultureNear,
    takesNameFrom: [{ kind: "settlement", holds }],
    lendsNameTo: [{ kind: "shrine", holds }],
  },
};
