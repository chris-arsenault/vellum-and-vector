// @needsResolution carry: a carried place may not resolve on a finer map (ADR 0009).
import type { GenerationState } from "../../process";
import { carryWhereItLands, costNear, counterpartOf, goes, movesTo } from "../poiCarry";
import { notApplicable, type PoiEntry } from "../poiContract";
import { aloneAmong, attachment, sized, standsOut, weighed } from "../poiVisibilityRules";
import { namingCultureNear, rulePlaces, within } from "../poiPlaces";
import { ruleRecord } from "../poiRecords";
import { magicRule, magicValue } from "../poiReads";
import { areaOf, lastsWhile, meanOf, spans, standsIn, strengthOf } from "./reliefShape";

/** Area at which a prism's ground is half as great as prisms get. */
const typicalArea = 400_000_000;

const isA = magicRule("aurora", "prism");
const chargeAt = (state: GenerationState, cell: number) =>
  magicValue(state, "aurora", "intensity", cell);
const places = rulePlaces("frostPrism", "aurora", "prism");
const counterpart = counterpartOf(isA, 1);
const chargeOf = strengthOf("aurora");
const factors = {
  magnitude: meanOf(chargeOf, sized(areaOf, typicalArea)),
  localConditions: standsOut(chargeAt, spans(6)),
  isolation: aloneAmong(places, spans(8)),
  cultural: attachment(spans(8)),
};

export const frostPrism: PoiEntry = {
  id: "frostPrism",
  group: "relief",
  name: "Frost prism",
  recognition: {
    distinct:
      "A cell in Aurora's prism rule: strong Aurora intensity on ground classed Peak or Ridge. The landform decides against the system's other classes on the same charge: an aurora field is general charge over ice, a light well sits in a hollow, a melt line lies at the thawing edge. An ordinary iced peak has no charge and is only a peak; a prism outlasts its ice for as long as stored charge holds.",
    isA,
  },
  existence: {
    statement:
      "Emerges where Aurora's charge, gathering with the cold, stands on a high crest or top; a lesser prism can grow by scatter at lower charge. It is not sited, though a great vault record feeds the charge around it.",
    way: "emerges",
    requires: notApplicable("The rule reads Aurora's own intensity and the ground's own class."),
    suitability: notApplicable(
      "A prism stands wherever the charge reaches a height; nothing chooses."
    ),
    places,
  },
  publication: {
    statement: "Each connected group of the rule's cells publishes as Aurora's prism class.",
    moment: "magic",
    record: ruleRecord("aurora", "prism"),
  },
  fields: {
    statement:
      "A prism is a store of charged cold on high rock: the rock is weakened, ice is kept against thaw, the air stays cold and still, nothing grows, and charge is held for the ice to carry away down its glaciers. Aurora writes all of this by its own intensity and charge wherever they stand, so the prism adds no write of its own.",
    terrain: notApplicable("Aurora's rock feedback weakens the rock by its intensity."),
    water: notApplicable("Aurora's stored charge holds the ice against thaw, field-wide."),
    climate: notApplicable("Aurora's cold drainage and the height write its air."),
    cover: notApplicable("Aurora's feedback writes the stillness from its intensity."),
    magic: notApplicable("Aurora's ice stock writes the charge the ice holds."),
  },
  acrossMaps: {
    statement:
      "A captured prism lands where Aurora's class still reads on the refined map, since magic classes are captured and each round re-derives crests; it takes the nearest such crest, and goes if none is charged.",
    carry: carryWhereItLands,
    realize: notApplicable(
      "The rule asks for a top that relief supplies; a prism adds no shape of its own at any scale."
    ),
    counterpart,
    unrealized: (state, carried) =>
      counterpart(state, carried) >= 0 ? movesTo(counterpart)(state, carried) : goes(),
    settle: notApplicable("Charge gathers over epochs; a round's water does not move it."),
    schedule: notApplicable("The rule re-reads the crest; a prism has no step of its own."),
  },
  movement: {
    statement:
      "A charged height is hard going and a place travellers avoid. Ice that slides off it carries charge down its glaciers, so it feeds that carrier more readily than ordinary ice does.",
    roads: costNear(2.5),
    boats: notApplicable("A prism stands on a height no boat reaches."),
    drainage: notApplicable("Water up there is ice; drainage begins below where it melts."),
    magic: { ice: costNear(0.7) },
    links: notApplicable("A prism joins nothing."),
    crosses: notApplicable("A height of charged ice is a barrier itself."),
  },
  others: {
    statement:
      "A prism stands on a peak's or ridge's ground inside an aurora field and looks down on light wells below; it cannot stand in a lake.",
    needs: notApplicable(
      "Its rule reads charge and a high class alone; a relict outlasts the aurora field that charged it."
    ),
    excludes: [{ kind: "lake", holds: standsIn }],
    contains: notApplicable("A prism is a small body of ice and rock with nothing inside it."),
    pairsWith: [
      { kind: "ridge", holds: standsIn },
      { kind: "peak", holds: within(spans(4)) },
      { kind: "lightWell", holds: within(spans(6)) },
      { kind: "auroraField", holds: standsIn },
    ],
  },
  people: {
    statement:
      "A prism draws pilgrims and those who gather charged ice, and stills what stays near it; anyone staying too long slows and freezes.",
    offers: (state, place) => ({
      sanctity: factors.magnitude(state, place),
      materials: chargeOf(state, place) / 2,
    }),
    threatens: (state, place) => [
      { hazard: "stillness", reach: spans(1)(state), severity: chargeOf(state, place) },
    ],
  },
  time: {
    statement:
      "A prism stands while charge does, and the system keeps a share of it through warm epochs, so a relict can outlast its ice. When charge falls below the rule, it ends, and the ground under it is simply the crest.",
    fate: lastsWhile(isA),
  },
  visibility: {
    statement:
      "A prism shows by its charge more than by its size and by how far it stands over the field around it; a pilgrim town carries a faint one.",
    ...factors,
    importance: weighed(factors, { magnitude: 0.5, localConditions: 0.3, isolation: 0.2 }),
  },
  naming: {
    statement:
      "Named by pilgrims and the people below, usually for the height it stands on or the light it throws.",
    namedBy: namingCultureNear,
    takesNameFrom: [
      { kind: "peak", holds: within(spans(4)) },
      { kind: "ridge", holds: standsIn },
    ],
    lendsNameTo: [{ kind: "shrine", holds: within(spans(6)) }],
  },
};
