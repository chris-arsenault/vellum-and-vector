import type { GenerationState } from "../../process";
import { carryWhereItLands, costNear, counterpartOf, goes, movesTo } from "../poiCarry";
import { notApplicable, type PoiBarrier, type PoiEntry, type PoiPlace } from "../poiContract";
import { holds, namingCultureNear, regionPlaces, within } from "../poiPlaces";
import { cellSpan, iceAt, isRiver, isSea, magicRule } from "../poiReads";
import { aloneAmong, attachment, drawnWhen, sized, standsOut } from "../poiVisibilityRules";
import {
  auroraAt,
  chargeHeldAt,
  cooling,
  holdingIce,
  softening,
  stilling,
  storingCharge,
  weightedArea,
} from "./anomalyReads";

/** Fully charged ground at which a field is half as great as fields get, in square metres. */
const typicalArea = 1e10;
/** The share of a field under the melt rule at which its ice is going faster than it holds. */
const wastingShare = 0.5;

const isA = magicRule("aurora", "field");
const isMelting = magicRule("aurora", "melt");
const places = regionPlaces("auroraField", isA, auroraAt);
const around = (state: GenerationState) => 6 * cellSpan(state);
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
const heldHere = (state: GenerationState, place: PoiPlace, cell: number) =>
  place.cells.includes(cell) ? chargeHeldAt(state, cell) : 0;

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
  fields: {
    statement:
      "A store of charge in ice. It softens the rock beneath, so its charged glaciers cut faster, keeps ice past its climate, cools the ground by a few degrees, and stills growth and decay until only rime forest and glow-lichen hold on. Its still air pins storm fronts at its edge.",
    terrain: softening,
    water: holdingIce,
    climate: cooling,
    cover: stilling,
    magic: storingCharge,
  },
  acrossMaps: {
    statement:
      "A field carries onto the refined map as captured intensity, and the regional magic re-derives it each round from the finer ice. The finer ground must keep the cold and the ice; a field whose ice does not develop there moves to the nearest charged ice or goes, and a round's melt can shift it.",
    carry: carryWhereItLands,
    realize(state, carried) {
      const cell = counterpart(state, carried);
      if (cell < 0) return [];
      const place: PoiPlace = {
        id: carried.feature.id,
        kind: "auroraField",
        cells: [cell],
        anchor: cell,
      };
      return [...holdingIce(state, place), ...cooling(state, place)];
    },
    counterpart,
    unrealized: (state, carried) =>
      counterpart(state, carried) >= 0 ? movesTo(counterpart)(state, carried) : goes(),
    settle: movesTo(counterpart),
  },
  movement: {
    statement:
      "Charged ice does not soften or open, so boats are barred from it and walkers are slowed by its cold, but a frozen river or sea held by charge is a dependable crossing. Water runs poorly while the ice holds it. Ice carries Aurora's own charge along the field more easily than ground would.",
    roads: (state, place, cell) => 1 + 0.5 * heldHere(state, place, cell),
    boats: costNear(Infinity),
    drainage: (state, place, cell) => 1 + heldHere(state, place, cell),
    magic: (state, place, cell) => (place.cells.includes(cell) ? 0.7 : 1),
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
        reach: 2 * cellSpan(state),
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
    visibleAt: drawnWhen(factors, { magnitude: 0.55, localConditions: 0.3, isolation: 0.15 }),
  },
  naming: {
    statement:
      "Named by the nearest people, usually the readers who work it, after the summit that rises out of it; an archive may take its name.",
    namedBy: namingCultureNear,
    takesNameFrom: [{ kind: "summit", holds }],
    lendsNameTo: [{ kind: "archive", holds: within(around) }],
  },
};
