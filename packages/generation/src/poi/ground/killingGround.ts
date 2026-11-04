import type { GenerationState } from "../../process";
import { carryWhereItLands, costNear, counterpartOf, stays } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiPlace } from "../poiContract";
import { holds, namingCultureNear, within } from "../poiPlaces";
import { featureCell, featuresOf, gap, moistureAt } from "../poiReads";
import { siteRecord } from "../poiRecords";
import { aloneAmong, attachment, sized, standsOut, weighed } from "../poiVisibilityRules";
import {
  aroundOf,
  fullSaltOf,
  grownAndNaturalPlaces,
  grownOrNaturalRecord,
  killingAt,
  killingFloor,
  naturalKillingAt,
  recordedBrineAt,
  reservoirPerArea,
  saltingAt,
  standsOn,
  stockPerArea,
} from "./groundReads";

/** People go the long way round salted dead ground, and carry nothing from it. */
const shunned = 1.5;
/** A recorded killing on the ground attaches people to it this strongly, whatever lives near it now. */
const rememberedTie = 0.6;
/** How far its foulness reaches into water and fields, in metres. */
const blightReach = 5000;
/** Air wet enough that Salt's flushing, which grows with moisture, outruns what the dead left. */
const flushing = 0.6;

/** The salt the dead became and the salt those still on record will become, as one reading. */
const deadAt = (state: GenerationState, cell: number) =>
  stockPerArea(state, "salt", "death/brine", cell) + recordedBrineAt(state, cell);
const places = grownAndNaturalPlaces("killingGround", ["salt", "ground"], naturalKillingAt, deadAt);
const counterpart = counterpartOf(killingAt, 1);
const brineOf = (state: GenerationState, place: PoiPlace) => deadAt(state, place.anchor);
/** Half as great as they get at Salt's full level. */
const greatness = (state: GenerationState, place: PoiPlace) =>
  sized(brineOf, fullSaltOf(state))(state, place);
/** The strongest of what lives near it now and of what was recorded on the ground. */
const cultural = (state: GenerationState, place: PoiPlace) => {
  const living = attachment(aroundOf)(state, place);
  for (const event of featuresOf(state, "societyEvent"))
    if (gap(state, featureCell(state, event), place.anchor) <= aroundOf(state))
      return Math.max(living, rememberedTie);
  return living;
};
const factors = {
  magnitude: greatness,
  localConditions: standsOut(deadAt, aroundOf),
  isolation: aloneAmong(places, (state) => 2 * aroundOf(state)),
  cultural,
};

export const killingGround: PoiEntry = {
  id: "killingGround",
  group: "ground",
  name: "Killing ground",
  recognition: {
    distinct:
      "A cell in Salt's killing-ground rule, whose death-origin brine stands at the rule's floor per square metre, or, outside the rule, a land cell whose recorded dead, the MassDeath band not yet read by Salt, would make that much brine. Only the dead's own material decides: a battlefield or disaster site is a published event that may have left none, and may stand where a killing ground does not; a salt pan reads Salt's intensity or a closed floor, not the brine of the dead. A town's ordinary die-offs under the floor make no such ground. With Salt enabled the rule decides it; the band covers the epoch before Salt reads it and worlds with no Salt.",
    isA: killingAt,
  },
  existence: {
    statement:
      "Emerges where people died in enough numbers: society records die-offs and event casualties on the ground, and Salt turns the record to brine where it lies. Nobody sites it; a battle sites itself, and the ground keeps the result.",
    way: "emerges",
    requires: notApplicable("Its test reads the dead themselves; nothing else has to stand there."),
    suitability: notApplicable(
      "Armies and plagues choose the ground for other reasons; nothing chooses it for this."
    ),
    places,
  },
  publication: {
    statement:
      "A ground Salt holds publishes as its rule's class; dead on record that Salt has not read publish as a site where they lie.",
    moment: "magic",
    record: grownOrNaturalRecord(
      "salt",
      "ground",
      siteRecord({
        kind: "killingGround",
        layer: "geology",
        name: "Killing ground",
        attributes: (state, place) => ({ recordedBrine: recordedBrineAt(state, place.anchor) }),
      })
    ),
  },
  fields: {
    statement:
      "The ground holds its dead as salt, and Salt's own writes by intensity do the rest wherever it stands: the air dries, growth thins to heath, and brine seeps down the drainage by Salt's own carrier and crusts at a pit. The place adds nothing of its own.",
    terrain: notApplicable(
      "The dead change no height; any ground that falls in is Salt's bounded dissolving of the bed, written by its stock advance."
    ),
    water: notApplicable(
      "The brine in seepage is a Salt stock, not a water band; rivers keep their discharge and no band records water's salt."
    ),
    climate: notApplicable(
      "Salt's writes dry the air by its intensity (saltWrites on the world, declareSaltWrites in refinement)."
    ),
    cover: notApplicable(
      "Ecology's growth reads the Salting band that magicLivingFeedback writes by Salt's intensity."
    ),
    magic: notApplicable(
      "magicLivingFeedback writes Salting by Salt's intensity, and Salt's stocks do not decay on their own."
    ),
  },
  acrossMaps: {
    statement:
      "A captured killing ground lands where the event struck; the child inherits the brine and re-reads it. Finer ground cannot refuse the dead, so a ground the child's cells read too thinly for the rule still keeps its place. It moves only to a nearer cell that the rule does read.",
    carry: carryWhereItLands,
    realize: notApplicable(
      "The inherited stock is all it brings; the ground need not be shaped to hold brine."
    ),
    counterpart,
    unrealized: stays,
    settle: notApplicable("A round's water moves brine only by the stock's own per-epoch seepage."),
    schedule: notApplicable("A killing ground does nothing at refinement's other points."),
  },
  movement: {
    statement:
      "People go around it and carry nothing from it, so roads and the salt that travels with people avoid it alike. Brine runs by the drainage the ground already has.",
    roads: costNear(shunned),
    boats: notApplicable(
      "The test covers land; the dead a lake takes crust on its floor as a pan's bed."
    ),
    drainage: notApplicable(
      "Brine follows the network without shaping it, and the ground's height is unchanged."
    ),
    magic: { people: costNear(shunned) },
    links: notApplicable("A killing ground joins no two cells for walkers."),
    crosses: notApplicable("Ground that people avoid opens no way across anything."),
  },
  others: {
    statement:
      "A killing ground holds the battle or disaster that made it and stands beside what was lost, and its brine crusts toward a pan. Shrines rise on it where memory holds. It can lie under any later town, but no lake stands on it, since the brine crusts to bed there and is a pan's business.",
    needs: notApplicable(
      "The event's record may be long gone from the map; the brine in the ground is the evidence."
    ),
    excludes: [{ kind: "lake", holds: standsOn }],
    contains: [
      { kind: "battlefield", holds },
      { kind: "disasterSite", holds },
    ],
    pairsWith: [
      { kind: "shrine", holds: within(aroundOf) },
      { kind: "ruin", holds: within(aroundOf) },
      { kind: "saltPan", holds: within(aroundOf) },
      { kind: "saltDust", holds: within((state) => 3 * aroundOf(state)) },
    ],
  },
  people: {
    statement:
      "It gives memory and the sanctity of the dead and, for those who dare it, the salt. It poisons what grows and what drinks there, and the Veil holds where salt lies, for good or ill.",
    offers(state, place) {
      const great = greatness(state, place);
      return { sanctity: great, materials: great / 3 };
    },
    threatens: (state, place) => [
      {
        hazard: "foul water and failed crops",
        reach: blightReach,
        severity: Math.min(1, saltingAt(state, place.anchor) + greatness(state, place) / 2),
      },
    ],
  },
  time: {
    statement:
      "Salt does not decay, so the ground stays unless water takes it. Brine seeps away where the air is wet, leaving nothing, or crusts where the drainage ends and leaves a pan. New dead renew it.",
    fate(state, place) {
      const floor = killingFloor(state);
      if (deadAt(state, place.anchor) >= floor && moistureAt(state, place.anchor) <= flushing)
        return { fate: "persists" };
      return reservoirPerArea(state, "salt", "bed", place.anchor) >= floor
        ? { fate: "becomes", kind: "saltPan" }
        : { fate: "ends" };
    },
  },
  visibility: {
    statement:
      "It shows by how many lie there, by standing out from the country round it, and by being alone in it; a great battle's ground stays on the map when no one lives within a day of it, since the event carries it, and ordinary ground with a few dead does not.",
    ...factors,
    importance: weighed(factors, { magnitude: 0.5, localConditions: 0.2, isolation: 0.3 }),
  },
  naming: {
    statement:
      "Named by those nearest it after the killing that made it or the place that fell, and the same name carries to whatever shrine stands on it.",
    namedBy: namingCultureNear,
    takesNameFrom: [
      { kind: "battlefield", holds },
      { kind: "disasterSite", holds },
      { kind: "settlement", holds: within(aroundOf) },
    ],
    lendsNameTo: [{ kind: "shrine", holds: within(aroundOf) }],
  },
};
