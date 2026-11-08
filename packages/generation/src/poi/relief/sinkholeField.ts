// @needsResolution carry: a carried place may not resolve on a finer map (ADR 0009).
import { MapScale } from "@atlas/domain";
import type { GenerationState } from "../../process";
import { carryWhereItLands, costNear, counterpartOf, goes, movesTo } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiFate, type PoiPlace } from "../poiContract";
import { holds, namingCultureNear, rulePlaces, within } from "../poiPlaces";
import { ruleRecord } from "../poiRecords";
import { isLake, magicRule, moistureAt } from "../poiReads";
import { aloneAmong, attachment, sized, standsOut, weighed } from "../poiVisibilityRules";
import { areaOf, loweredAsCaptured, meanOf, sameSpot, spans } from "./reliefShape";

/** Area at which a field is half as great as fields get. */
const typicalArea = MapScale.area(0.000025);
/** Metres the system's own subsidence reaches before a field is half as sunk as they get. */
const typicalSubsidence = MapScale.length(0.00000125, 0.5);

const isA = magicRule("greenwood", "sinkhole");
const subsidedAt = (state: GenerationState, cell: number) =>
  state.physical?.magic?.fields.find((f) => f.definition.id === "greenwood")?.subsided?.get(cell) ??
  0;
const places = rulePlaces("sinkholeField", "greenwood", "sinkhole");
const subsidedOf = (state: GenerationState, place: PoiPlace) => subsidedAt(state, place.anchor);
const counterpart = counterpartOf(isA, 1);
const factors = {
  magnitude: meanOf(sized(subsidedOf, typicalSubsidence), sized(areaOf, typicalArea)),
  localConditions: standsOut(subsidedAt, spans(4)),
  isolation: aloneAmong(places, spans(8)),
  cultural: attachment(spans(6)),
};

export const sinkholeField: PoiEntry = {
  id: "sinkholeField",
  group: "relief",
  name: "Sinkhole field",
  recognition: {
    distinct:
      "A land cell in Greenwood's sinkhole rule: a spring sealed and no longer rising, because people drew it past its recharge and the karst beneath fell in. Nothing else writes that seal on Greenwood's field, so a Fire scar (a conduit sealed on Fire's), a natural basin and a crater all fail. A living spring, an oasis or a wellspring has a rising source, and that is what this has lost.",
    isA,
  },
  existence: {
    statement:
      "Emerges from overuse: people's draw on a Greenwood spring passes a share of its recharge in one epoch, the ground subsides by the system's own depth, and the spring rises no more. No one sites one; they make one by mistake.",
    way: "emerges",
    requires: notApplicable(
      "The seal is written only where a spring collapsed; there is nothing more to require."
    ),
    suitability: notApplicable("A collapse is an outcome of use, not a choice of site."),
    places,
  },
  publication: {
    statement: "Each connected group of the rule's cells publishes as Greenwood's sinkhole class.",
    moment: "magic",
    record: ruleRecord("greenwood", "sinkhole"),
  },
  fields: {
    statement:
      "A field is broken ground over drained rock: holes keep their depth, surface water runs down them and is lost to the runoff, the verdure the spring fed withers, and the aquifer stops rising here.",
    terrain: notApplicable("Greenwood's collapse step lowers the bedrock when the spring fails."),
    water: (_state, place) =>
      place.cells.map((cell) => ({
        change: "atMost" as const,
        band: "Runoff" as const,
        cell,
        value: 0,
      })),
    climate: notApplicable("Pits and failed springs are below what the climate field resolves."),
    cover: notApplicable("Soil water follows the lost runoff through ecology."),
    magic: notApplicable("A sealed spring stops feeding Greenwood, whose feedback writes verdure."),
  },
  acrossMaps: {
    statement:
      "A captured field lands where Greenwood's class still reads on the refined map, since magic classes are captured; its floors lie no higher than the parent's ground. Where the class does not read on finer ground it goes, because the collapse was a fact about that spring.",
    carry: carryWhereItLands,
    realize: (state, carried) => loweredAsCaptured(state, carried, counterpart(state, carried)),
    counterpart,
    unrealized: (state, carried) =>
      counterpart(state, carried) >= 0 ? movesTo(counterpart)(state, carried) : goes(),
    settle: notApplicable("The seal is written by people's draw over an epoch, not by a round."),
    schedule: notApplicable("Its floor is all a field asks of a refinement."),
  },
  movement: {
    statement:
      "Broken ground slows and endangers a road; streams are drawn into it and disappear; and Greenwood's groundwater no longer crosses it, since the aquifer that carried it has fallen in.",
    roads: costNear(1.8),
    boats: notApplicable("A field of pits has no navigable water."),
    drainage: costNear(0.6),
    magic: { crust: costNear(3) },
    links: notApplicable("A field of pits joins nothing."),
    crosses: notApplicable("It breaks routes; it takes none across anything."),
  },
  others: {
    statement:
      "A field stands where a spring and the settlement that overdrew it stood, which may now be a ruin; it does not lie under an oasis, whose spring must still rise. Water collecting in its holes makes small lakes.",
    needs: notApplicable("People's draw wrote the seal; the field outlasts those who drew it."),
    excludes: [
      { kind: "oasis", holds: sameSpot },
      { kind: "spring", holds: sameSpot },
    ],
    contains: [{ kind: "lake", holds }],
    pairsWith: [
      { kind: "settlement", holds: within(spans(8)) },
      { kind: "ruin", holds: within(spans(6)) },
    ],
  },
  people: {
    statement:
      "A field is a warning: only a little deep water is left in its holes, and the ground beneath anyone living there can go. Those who broke it often leave it.",
    offers: (state, place) => ({ water: moistureAt(state, place.anchor) / 2 }),
    threatens: (state, place) => [
      {
        hazard: "ground collapse",
        reach: spans(1)(state),
        severity: Math.max(0.3, factors.magnitude(state, place)),
      },
    ],
  },
  time: {
    statement:
      "The seal is permanent: a collapsed spring does not rise again, and the holes last until they fill. Where they meet the water table they drown, and the field is a lake.",
    fate(state, place): PoiFate {
      return isLake(state, place.anchor) ? { fate: "becomes", kind: "lake" } : { fate: "persists" };
    },
  },
  visibility: {
    statement:
      "A field shows by how far the ground has sunk more than by its area, since it is usually small; it matters to people who lost a spring to it, and a town beside it carries it.",
    ...factors,
    importance: weighed(factors, { magnitude: 0.5, localConditions: 0.2, isolation: 0.3 }),
  },
  naming: {
    statement: "Named by those who remember the spring, often after the place that drew it dry.",
    namedBy: namingCultureNear,
    takesNameFrom: [{ kind: "settlement", holds: within(spans(8)) }],
    lendsNameTo: notApplicable("A place of failure gives no name others would want."),
  },
};
