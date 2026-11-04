import { Feature } from "../../canonry/codes";
import type { GenerationState } from "../../process";
import { carryWhereItLands, counterpartOf, stays, costNear } from "../poiCarry";
import { notApplicable, type PoiEntry } from "../poiContract";
import { holds, namingCultureNear, regionPlaces, within } from "../poiPlaces";
import { fieldOf, isLand, landformAt, Landform, magicRule, magicValue, rockAt } from "../poiReads";
import { aloneAmong, attachment, drawnWhen, sized, standsOut } from "../poiVisibilityRules";
import {
  areaOf,
  holdAt,
  holdGradient,
  lastsWhile,
  meanOf,
  spans,
  standsIn,
  strengthOf,
} from "./reliefShape";

/** Area at which a flat is half as great as flats get: a world landscape's least. */
const typicalArea = 2_000_000_000;

const liveBasalt = magicRule("fire", "basalt");
const scar = magicRule("fire", "scar");
/** The apron round a cone where it has settled level: the same rock laid by a plume. */
const lavaPlain = (state: GenerationState, cell: number) =>
  (fieldOf(state).FeatureFlags.get(cell) & Feature.LavaPlain) !== 0 &&
  landformAt(state, cell) === Landform.Plain;
const isA = (state: GenerationState, cell: number) =>
  isLand(state, cell) && (liveBasalt(state, cell) || scar(state, cell) || lavaPlain(state, cell));
const places = regionPlaces("basaltFlat", isA, (state, cell) =>
  magicValue(state, "fire", "intensity", cell)
);
const counterpart = counterpartOf(isA, 1);
const isScar = (state: GenerationState, cell: number) => scar(state, cell);
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
      "A land cell in Fire's basalt rule (strong intensity on nearly level ground), Fire's scar rule (a conduit that carried its budget and sealed), or a level plain flagged LavaPlain on a plume's apron. It is the rock's making that decides: a plateau is level ground of any rock, a glass flat fused salt, a volcano the flagged cone above the apron. Live and hot, or sealed and cold, and whether Fire or a plume laid it, are properties of one kind.",
    isA,
  },
  existence: {
    statement:
      "Emerges where heat floods level ground: Fire's strong conduits, a plume's apron settling. A conduit that spends its budget seals to a scar of sinter and basalt; nothing sites one.",
    way: "emerges",
    requires: notApplicable("It reads Fire's own classes and the plume's own flag."),
    suitability: notApplicable("It lies where heat and flatness met; nothing chooses."),
    places,
  },
  fields: {
    statement:
      "A flat is a hard level sheet with thin soil over it: rock resists, water sinks into the joints, and a live one heats its ground while a scar shuts its fracture down to the floor, so Fire no longer travels it.",
    terrain: (state, place) => [
      ...holdGradient(state, place.cells),
      ...holdAt(state, "atLeast", "RockResistance", place.cells),
    ],
    water: notApplicable(
      "Jointed rock drains through; the field shows that as runoff, without a store it could hold."
    ),
    climate: notApplicable("Hot rock's local air is below what the climate field resolves."),
    cover: (state, place) => holdAt(state, "atMost", "SoilDepth", place.cells),
    magic: (state, place) =>
      holdAt(
        state,
        "atMost",
        "FractureConductance",
        place.cells.filter((cell) => isScar(state, cell))
      ),
  },
  acrossMaps: {
    statement:
      "A captured flat lands where Fire's classes still read it on the refined map, since magic classes are captured; a plume's apron carries no flag below the world, so its record stays where it landed and keeps its ground as level as the plain allows.",
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
  },
  movement: {
    statement:
      "A flat is quick going for roads but a live one scorches them; a live sheet conducts Fire and a scar blocks it, the same rock opposite ways.",
    roads(state, place, cell) {
      if (!place.cells.includes(cell)) return 1;
      return magicValue(state, "fire", "intensity", cell) > 0 && !isScar(state, cell) ? 1.4 : 0.8;
    },
    boats: notApplicable("A level sheet of rock has no water to carry boats."),
    drainage: costNear(1.3),
    magic(state, place, cell) {
      if (!place.cells.includes(cell)) return 1;
      return isScar(state, cell) ? 3 : 0.7;
    },
    crosses: notApplicable("A hard flat is easy ground, not a way across a barrier."),
  },
  others: {
    statement:
      "A flat spreads round volcanoes and over veins that fed it, and a scar is a common site for ruins. It cannot lie under a lake or carry forest without first being buried.",
    needs: notApplicable("Fire's classes or the plume's flag already say what made it."),
    excludes: [
      { kind: "lake", holds: standsIn },
      { kind: "forest", holds: standsIn },
    ],
    contains: [
      { kind: "ruin", holds },
      { kind: "thermalVein", holds },
    ],
    pairsWith: [
      { kind: "volcano", holds: within(spans(8)) },
      { kind: "plateau", holds: standsIn },
    ],
  },
  people: {
    statement:
      "A flat gives good stone and a firm road. A live one burns what stands on it; a scar gives only ruined conduits, cold, and a kind of awe.",
    offers: (state, place) => ({
      materials: rockAt(state, place.anchor),
      trade: factors.magnitude(state, place) / 2,
      sanctity: isScar(state, place.anchor) ? 0.4 : 0,
    }),
    threatens(state, place) {
      const live = heat(state, place);
      return live > 0 && !isScar(state, place.anchor)
        ? [{ hazard: "burning ground", reach: spans(1)(state), severity: live }]
        : [];
    },
  },
  time: {
    statement:
      "A live flat seals to a scar when its conduit's budget is spent, and that is still this kind; once sediment buries it or new heat breaks the scar it no longer reads, and it ends.",
    fate: lastsWhile(isA),
  },
  visibility: {
    statement:
      "A flat shows by its area and heat and by standing hotter than the country around it; a cold old scar is mostly drawn for the ruins and towns on it.",
    ...factors,
    visibleAt: drawnWhen(factors, { magnitude: 0.5, localConditions: 0.35, isolation: 0.15 }),
  },
  naming: {
    statement: "Named by the nearest people, usually for its colour or for what burned there.",
    namedBy: namingCultureNear,
    takesNameFrom: [{ kind: "volcano", holds: within(spans(8)) }],
    lendsNameTo: [{ kind: "ruin", holds }],
  },
};
