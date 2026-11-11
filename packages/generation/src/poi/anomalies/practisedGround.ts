// @needsResolution carry: a carried place may not resolve on a finer map (ADR 0009).
import { placeMinimumCells } from "@atlas/domain";
import { craftOf, practised, seaHeldOff, type Craft } from "../../human/craftCatalogue";
import type { GenerationState } from "../../process";
import type { PhysicalField } from "../../world/field";
import { carryWhereItLands } from "../poiCarry";
import {
  notApplicable,
  type PoiBenefit,
  type PoiEntry,
  type PoiHazard,
  type PoiPlace,
} from "../poiContract";
import type { PoiKindId } from "../poiKinds";
import { namingCultureNear, regionPlaces, within } from "../poiPlaces";
import { areaRecord, siteRecord } from "../poiRecords";
import { cellSpan, fieldOf } from "../poiReads";
import { aloneAmong, attachment, sized, standsOut, weighed } from "../poiVisibilityRules";
import { areaOf } from "../cover/coverShared";

/**
 * Ground on which a people's craft has set a rule of the land aside. Each kind is one craft's:
 * the cells where enough of the people hold it, on enough of the system's medium, that the
 * rule no longer holds over a quarter of the ground. The place is the break made visible; the
 * break itself is the craft's answer to a shared question, and nothing here causes it.
 */
/** The share of a cell on which a craft must be practised for the cell to be its ground. */
const worked = 0.25;
/** Area at which practised ground is half as great as it gets, as a share of the map scale. */
// length-unit: fraction
const typicalArea = 0.000125;

interface PractisedGround {
  id: PoiKindId;
  name: string;
  system: string;
  /** The rule set aside, in a sentence a reader of the map would recognise. */
  breaks: string;
  /** What stands there that could not stand without the craft. */
  shows: string;
  /** What its practitioners pay, from the lore of their system. */
  price: string;
  offers: Partial<Record<PoiBenefit, number>>;
  /** What happens beside it because the rule is set aside inside it. */
  threat?: Pick<PoiHazard, "hazard" | "severity">;
  /**
   * The share of a cell on which the rule is set aside, where that is not simply how far the
   * craft is practised there, and the share from which the cell is this kind's ground.
   */
  ground?: (map: PhysicalField, craft: Craft, cell: number) => number;
  floor?: number;
}
const around = (state: GenerationState) => 6 * cellSpan(state);

/** The roles in which practised ground does nothing of its own: the craft's answer does it. */
function standing(
  spec: PractisedGround
): Pick<PoiEntry, "fields" | "acrossMaps" | "movement" | "others"> {
  const answered = "The craft's break is an answer to a question, not a write.";
  return {
    fields: {
      statement: `It writes nothing: ${spec.breaks} That is an answer every process asking the rule receives, not a change the place makes to a field.`,
      terrain: notApplicable(answered),
      water: notApplicable(answered),
      climate: notApplicable(answered),
      cover: notApplicable(answered),
      magic: notApplicable("The medium is the system's own; the craft adds none."),
    },
    acrossMaps: {
      statement:
        "A refined map keeps the record its parent made. It grows its own once regions live their own people on their own lattice.",
      carry: carryWhereItLands,
      realize: notApplicable("The record names ground; it asks nothing of the finer terrain."),
      counterpart: notApplicable("A refined map does not yet hold the craft to find it by."),
      unrealized: notApplicable("With no counterpart sought, the parent's record simply stands."),
      settle: notApplicable("With no counterpart sought, the parent's record simply stands."),
      schedule: notApplicable("It does nothing at refinement's other points."),
    },
    movement: {
      statement:
        "What it does to the going is the craft's own answer to what crossing the ground costs; the place adds no cost of its own.",
      roads: notApplicable("The craft answers the cost of the ground directly."),
      boats: notApplicable("The craft answers the cost of the ground directly."),
      drainage: notApplicable("Water runs on the ground as it finds it."),
      magic: notApplicable("The craft moves none of its system's material."),
      links: notApplicable("It joins no two cells; a kept door is its own place."),
      crosses: notApplicable("It opens no barrier as a place."),
    },
    others: {
      statement:
        "It lies on its system's ground and has a settlement of its practitioners in or beside it.",
      needs: [{ kind: "settlement", holds: within(around) }],
      excludes: notApplicable(
        "Two crafts can be practised on one ground; their meeting decides it."
      ),
      contains: notApplicable("It contains whatever stands on its ground."),
      pairsWith: notApplicable("Its pairs are its own system's places, which their entries name."),
    },
  };
}
function entry(spec: PractisedGround): PoiEntry {
  const craft: Craft = craftOf(spec.system),
    strength = (state: GenerationState, cell: number) =>
      (spec.ground ?? practised)(fieldOf(state), craft, cell),
    isA = (state: GenerationState, cell: number) => strength(state, cell) >= (spec.floor ?? worked),
    places = regionPlaces(spec.id, isA, strength),
    shape = { kind: spec.id, layer: "magicPractices", name: spec.name },
    attributes = (state: GenerationState, place: PoiPlace) => ({
      craft: craft.name,
      system: craft.system,
      breaks: spec.breaks,
      practised: Math.round(strength(state, place.anchor) * 100) / 100,
    }),
    area = areaRecord({ ...shape, attributes }, strength),
    site = siteRecord({ ...shape, attributes }),
    factors = {
      magnitude: sized(areaOf, typicalArea),
      localConditions: standsOut(strength, around),
      isolation: aloneAmong(places, around),
      cultural: attachment(around),
    };
  return {
    id: spec.id,
    group: "anomalies",
    name: spec.name,
    recognition: {
      distinct: `Ground where ${craft.name} is practised on at least a quarter of each cell: ${spec.breaks} ${spec.shows}`,
      isA,
    },
    existence: {
      statement: `Emerges where a people who hold ${craft.name} live on ground ${craft.system}'s medium reaches. Nobody sites it: the craft is learned where the medium lies and practised only there.`,
      way: "emerges",
      requires: (state, cell) => strength(state, cell) > 0,
      suitability: notApplicable("The people and the medium decide it; nothing chooses a site."),
      places,
    },
    publication: {
      statement:
        "Published with people's places, as its outline where it covers ground enough and as a mark where it does not.",
      moment: "society",
      record: (state, place) =>
        place.cells.length >= placeMinimumCells.area ? area(state, place) : site(state, place),
    },
    ...standing(spec),
    people: {
      statement: `${spec.shows} ${spec.price}`,
      offers: () => spec.offers,
      threatens: (state, place) =>
        spec.threat
          ? [{ ...spec.threat, reach: around(state) + Math.sqrt(areaOf(state, place)) }]
          : [],
    },
    time: {
      statement:
        "It lasts while the people who hold the craft live on the medium. When they go, or the medium does, the rule holds again from that day, and what stood only because it was set aside does not stand.",
      fate: (state, place) =>
        strength(state, place.anchor) >= worked ? { fate: "persists" } : { fate: "ends" },
    },
    visibility: {
      statement:
        "It shows by its extent and by how sharply it stands out of the country around it; a capital inside one carries it.",
      ...factors,
      importance: weighed(factors, { magnitude: 0.5, localConditions: 0.3, isolation: 0.2 }),
    },
    naming: {
      statement: "Named by the people who practise there.",
      namedBy: namingCultureNear,
      takesNameFrom: [{ kind: "settlement", holds: within(around) }],
      lendsNameTo: notApplicable("Nothing is named after it yet."),
    },
  };
}

export const hearthRing = entry({
  id: "hearthRing",
  name: "Hearth ring",
  system: "fire",
  breaks:
    "Within a kept hearth the season is the hearth's, not the climate's, and the ground holds nothing against a way.",
  shows:
    "Fields stand green in a ring inside ice or cold waste, and ways run straight through rock.",
  price: "Every use burns the keeper's hands.",
  offers: { food: 0.8, trade: 0.5 },
});
export const readIce = entry({
  id: "readIce",
  name: "Read ice",
  system: "aurora",
  breaks:
    "Where readers work nothing is forgotten: ways, kept lines and what a people holds do not fade.",
  shows: "Old names, old claims and old roads stand as if their makers had not gone.",
  price: "Readers lose track of which memories are their own.",
  offers: { sanctity: 0.5, defence: 0.3 },
});
export const heldShore = entry({
  id: "heldShore",
  name: "Held shore",
  system: "pressure",
  breaks:
    "Where divers hold it the sea does not stand at its level: it is held off the shallows beside their shore.",
  shows: "Sea floor lies dry and lived on below the level of the sea beside it.",
  price: "Those who carry the charge are slow to answer and partly absent.",
  offers: { food: 0.4, trade: 0.6 },
  threat: { hazard: "the sea returning", severity: 0.9 },
  // Its ground is the bed the sea is held off, which is dry from half a cell held.
  ground: (map, _craft, cell) => seaHeldOff(map, cell),
  floor: 0.5,
});
export const boundWood = entry({
  id: "boundWood",
  name: "Bound wood",
  system: "greenwood",
  breaks:
    "Those who tend are bound to what they tend: they do not leave it and raise nothing on it, and hunger and hurt take no one there.",
  shows: "A wood holds a town's people and no houses, more than its land could feed.",
  price: "Tenders sicken when their ground is cut and cannot leave it.",
  offers: { food: 0.6, sanctity: 0.4 },
});
export const swornGround = entry({
  id: "swornGround",
  name: "Sworn ground",
  system: "salt",
  breaks:
    "An oath sworn on raked ground does not give way, and the remembered dead are present on it.",
  shows:
    "A realm keeps ground no living people hold for it, and a city stands where only its dead are.",
  price: "Rakers cannot forget.",
  offers: { defence: 0.6, sanctity: 0.5 },
});
export const vowedGround = entry({
  id: "vowedGround",
  name: "Vowed ground",
  system: "hallowed",
  breaks: "Inside the vow nothing is harmed: hunger, hazard and attack take no one.",
  shows:
    "No one has died there of anything that strikes, while the country at its rim takes what was turned away.",
  price:
    "The vowed cannot dig, kindle, dam or cut, and must walk their boundary for as long as it is to hold.",
  offers: { defence: 1, sanctity: 1 },
  threat: { hazard: "harm turned away to the rim", severity: 0.6 },
});
