// @needsResolution carry: follows its river; without one it may not resolve (ADR 0009).
import { Landform } from "../../world/codes";
import { riverGradient } from "../../world/landforms";
import { groundOf } from "../../rock/ground";
import { surfaceResistance } from "../../rock/groundQueries";
import type { GenerationState } from "../../process";
import { worldFallsDischarge, worldFallsDrop } from "../../worldSignificance";
import { carryWhereItLands, costNear, counterpartOf, goes, movesTo } from "../poiCarry";
import {
  notApplicable,
  type PoiCarried,
  type PoiEntry,
  type PoiNameTerm,
  type PoiPlace,
} from "../poiContract";
import { claimsOf, placesFromOrigins } from "../poiOrigins";
import { namingCultureNear, holds, within } from "../poiPlaces";
import { siteRecord } from "../poiRecords";
import { hostedCell } from "../../area/areaHosting";
import { cellSpan, fieldOf } from "../poiReads";
import { attachment, aloneAmong, sized, standsOut, weighed } from "../poiVisibilityRules";
import type { FallForm } from "./waterfallForms";
import { waterfallOrigins } from "./waterfallOrigins";
import {
  dischargeOf,
  fallVariety,
  formIn,
  shapedFall,
  sizeOfFall,
  carriedStep,
  wetRock,
} from "./waterfallShape";
import type { RegionalState } from "../../regional/state";

/** The word people use for a fall of each form. */
const formTerms: Readonly<Record<FallForm, string>> = {
  plunge: "Falls",
  cataract: "Cataract",
  cascade: "Cascade",
  ribbon: "Veil",
  chute: "Chute",
};
/** The same word for a system of them. */
const systemTerms: Readonly<Record<FallForm, string>> = {
  plunge: "Falls",
  cataract: "Cataracts",
  cascade: "Cascades",
  ribbon: "Veils",
  chute: "Chutes",
};
const nameTerm = (state: GenerationState, place: PoiPlace): PoiNameTerm => ({
  kind: "landform",
  subkind: "waterfall",
  term: (sizeOfFall(state, place).members > 1 ? systemTerms : formTerms)[formIn(state, place)],
});
const heightOf = (state: GenerationState, place: PoiPlace) => sizeOfFall(state, place).height;
const gradient = (state: GenerationState, cell: number) => riverGradient(fieldOf(state), cell);
const isA = (state: GenerationState, cell: number) =>
  claimsOf(state, "waterfall", waterfallOrigins).has(cell);
const places = (state: GenerationState) => placesFromOrigins("waterfall", waterfallOrigins)(state);
/** Falls grow with both: a tall trickle and a low cataract are each lesser than a great fall. */
const greatness = (state: GenerationState, place: PoiPlace) =>
  (sized(heightOf, worldFallsDrop)(state, place) +
    sized(dischargeOf, worldFallsDischarge)(state, place)) /
  2;
const around = (state: GenerationState) => 6 * cellSpan(state);
const factors = {
  magnitude: greatness,
  localConditions: standsOut(gradient, around),
  isolation: aloneAmong(places, around),
  cultural: attachment(around),
};
const counterpart = counterpartOf(isA, 1);
/** The refined river must hold the step, at the fall's own place on it. */
function realizedStep(state: RegionalState, carried: PoiCarried) {
  const cell = hostedCell(state, carried.feature);
  return cell < 0 ? [] : carriedStep(state, cell, Number(carried.feature.attributes.drop ?? 0));
}

export const waterfall: PoiEntry = {
  id: "waterfall",
  group: "water",
  name: "Waterfall",
  recognition: {
    distinct:
      "A step in the long profile of a river this map draws that is known as a fall: a cell dropping at least 10 m to the next, at five times the river's gradient above and below it, for a reason. A steadily steep river is a gorge, a step without a reason is steep water, and a step on a stream this map does not draw stays latent with its stream.",
    isA,
    landform: { code: Landform.Waterfall },
  },
  existence: {
    origins: waterfallOrigins,
    statement:
      "Emerges from the river's own profile, and is made a fall by what made the step: hard rock over softer, a fault, a tributary left hanging above a deeper valley, a cliff over standing water, or a drop too tall to need a reason. People make others: a town that carries boats round a step names it. A fall the coarser map named stays one, and falls stand apart, so a steep reach is one fall and not a row of them.",
    way: "emerges",
    requires: notApplicable("Its test reads the river itself; it needs nothing else first."),
    suitability: notApplicable("Nothing chooses where a fall stands."),
    places,
  },
  publication: {
    statement:
      "Every fall publishes where it stands, with its true size and the water going over it. A fall a town names on the World comes later than the rest, once there are towns, and leaves the settled ground as it is.",
    moment: "geography",
    record: siteRecord({
      kind: "waterfall",
      layer: "geology",
      name: "Waterfall",
      attributes: (state, place) => ({
        drop: heightOf(state, place),
        discharge: dischargeOf(state, place),
      }),
    }),
  },
  fields: {
    statement:
      "A fall holds a step in the river's profile, so erosion cannot smooth it away while it stands, and works the ground around it by its form: a plunge or chute leaves the river in a cut below it, a cataract's lip is a broad ledge, a cascade's bed is heaped with fallen rock, a ribbon stands against a cliff. The wet rock beside the lip grows nothing.",
    terrain: shapedFall,
    water: notApplicable("It keeps the discharge it receives; only the height of the bed changes."),
    climate: notApplicable("Its spray is below what the climate field resolves."),
    cover: wetRock,
    magic: notApplicable(
      "Falls neither carry nor generate magic; the river's own carriage passes it."
    ),
  },
  acrossMaps: {
    standsOn: "river",
    statement:
      "A captured fall recorded the river it stands on and how far along it, and it stands at that place on the refined river, however the river has bent. The finer ground is made to hold its step there.",
    carry: carryWhereItLands,
    realize: realizedStep,
    counterpart,
    unrealized: (state, carried) =>
      counterpart(state, carried) >= 0 ? movesTo(counterpart)(state, carried) : goes(),
    settle: notApplicable(
      "A fall does not change with a round's water; only with erosion over epochs."
    ),
    schedule: notApplicable(
      "A fall has no step in refinement's schedule; its step is a realized change."
    ),
  },
  movement: {
    statement:
      "Boats cannot pass a fall and must portage; roads treat it as the river it stands on.",
    roads: notApplicable("Road crossing costs read the river; the fall adds nothing to them."),
    boats: costNear(Infinity),
    drainage: notApplicable("The network already runs through it; it only steps the bed."),
    magic: notApplicable("A river's carried magic passes over a fall."),
    links: notApplicable("A fall joins no two cells; a portage is a road's own way round it."),
    crosses: notApplicable("A fall is no crossing; fords and bridges are."),
  },
  others: {
    statement:
      "A fall stands on a river, often inside a gorge; a mill near one has the head it needs, and an upstream dam reduces it to a trickle.",
    needs: notApplicable("Its recognition already requires the river cell it stands on."),
    excludes: [{ kind: "lake", holds: (_state, a, b) => b.cells.includes(a.anchor) }],
    contains: notApplicable("A fall is one point of a river."),
    pairsWith: [
      { kind: "gorge", holds: (state, a, b) => holds(state, b, a) },
      { kind: "mill", holds: within(around) },
    ],
  },
  people: {
    statement:
      "A fall offers water power and awe, and blocks river traffic at a place where towns grow up at the portage.",
    offers: (state, place) => ({
      power: sized(heightOf, worldFallsDrop)(state, place),
      sanctity: greatness(state, place) / 2,
      trade: sized(dischargeOf, worldFallsDischarge)(state, place) / 2,
    }),
    threatens: notApplicable("A fall endangers only those on the river above it."),
  },
  time: {
    statement:
      "A fall cuts back upstream and lowers as it does; once the bed is graded the step is gone and the river runs on, leaving a gorge below where it stood.",
    fate(state, place) {
      const resistant = groundOf(fieldOf(state)).fold(place.anchor, surfaceResistance);
      return resistant <= 0 ? { fate: "ends", leaves: "gorge" } : { fate: "persists" };
    },
  },
  visibility: {
    statement:
      "A fall shows by its drop and discharge together and by how sharply it breaks an otherwise gentle river; a town at its portage carries a small one.",
    ...factors,
    importance: weighed(factors, { magnitude: 0.5, localConditions: 0.3, isolation: 0.2 }),
  },
  naming: {
    statement:
      "Named by the people nearest it, in words for its form; a portage town may take its name.",
    namedBy: namingCultureNear,
    takesNameFrom: notApplicable("Falls give names; they do not take them."),
    lendsNameTo: [{ kind: "settlement", holds: within(around) }],
    term: nameTerm,
  },
  variety: fallVariety,
  trueSize: {
    statement:
      "Roughly the world's falls with a much longer tail. A record on a coarse map says the fall or falls exist in that stretch of river, and a stretch losing far more than one fall's height on broken rock is one named system of many.",
    size: (state, place) => {
      const { height, width, length } = sizeOfFall(state, place);
      return { height, width, length };
    },
    represents: (state, place) => ({ members: sizeOfFall(state, place).members }),
  },
};
