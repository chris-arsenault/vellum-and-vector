import { Feature } from "../../canonry/codes";
import type { GenerationState } from "../../process";
import { carryWhereItLands, costNear, stays } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiFate, type PoiPlace } from "../poiContract";
import { holds, namingCultureNear, regionPlaces, within } from "../poiPlaces";
import { fieldOf, geothermalAt, isLake } from "../poiReads";
import { aloneAmong, attachment, drawnWhen, sized, standsOut } from "../poiVisibilityRules";
import {
  areaOf,
  holdAt,
  loweredAsCaptured,
  nearestOrFloor,
  sameSpot,
  spans,
  standsIn,
} from "./reliefShape";

/** Area at which a caldera is half as great as calderas get: the generator's cut at full radius. */
const typicalArea = 16_000_000;

const flags = (state: GenerationState, cell: number) => fieldOf(state).FeatureFlags.get(cell);
const isA = (state: GenerationState, cell: number) =>
  (flags(state, cell) & Feature.VolcanicCaldera) !== 0;
const lowness = (state: GenerationState, cell: number) => -fieldOf(state).Elevation.get(cell);
const places = regionPlaces("caldera", isA, lowness);
const liveAt = (state: GenerationState, place: PoiPlace) =>
  fieldOf(state).VolcanicActivity.get(place.anchor) / 1000;
const counterpart = nearestOrFloor(isA);
const factors = {
  magnitude: sized(areaOf, typicalArea),
  localConditions: standsOut(lowness, spans(4)),
  isolation: aloneAmong(places, spans(10)),
  cultural: attachment(spans(8)),
};

export const caldera: PoiEntry = {
  id: "caldera",
  group: "relief",
  name: "Caldera",
  recognition: {
    distinct:
      "A cell the generator flagged Feature.VolcanicCaldera: inside the cut made at the top of a collapsing cone. Every caldera cell is a volcano cell, and the flag is what separates it from the cone around it. An impact crater is excavated by a falling body and flagged differently; a cirque is cut by ice. Holding a lake is a property of a caldera, not a different kind.",
    isA,
  },
  existence: {
    statement:
      "Emerges when a plume-fed cone collapses in the epoch it forms, by the generator's own chance per cone; it is never sited. Volcanic-mountain records do not make one.",
    way: "emerges",
    requires: notApplicable(
      "The flag exists only where a cone collapsed; there is nothing else to require."
    ),
    suitability: notApplicable("A cone's collapse is chance per epoch, not a choice of ground."),
    places,
  },
  fields: {
    statement:
      "A caldera is a closed hollow over live or fossil heat: the floor stays down, water gathers in it and cannot leave except over the rim, and heat keeps coming through the fractured floor.",
    terrain: (state, place) => holdAt(state, "atMost", "Elevation", place.cells),
    water: (state, place) =>
      holdAt(
        state,
        "atLeast",
        "WaterSurfaceElevations",
        place.cells.filter((cell) => isLake(state, cell))
      ),
    climate: notApplicable(
      "A hollow a few kilometres wide is below what the climate field resolves."
    ),
    cover: notApplicable("Cover on its floor follows the heat and water ecology already reads."),
    magic: (state, place) => holdAt(state, "atLeast", "Geothermal", place.cells),
  },
  acrossMaps: {
    statement:
      "A captured caldera is realized as a floor no higher than the parent's. Maps below the world do not carry the flag, so its counterpart is the lowest ground near the record when no flagged cell reads, and the record stays.",
    carry: carryWhereItLands,
    realize: (state, carried) => loweredAsCaptured(state, carried, counterpart(state, carried)),
    counterpart,
    unrealized: stays,
    settle: notApplicable("A round's water fills its lake without moving the hollow."),
  },
  movement: {
    statement:
      "The rim is the climb, the floor a dead end for a road; water drains inward and heat and crust-borne magic rise through the fractures.",
    roads: costNear(2),
    boats: notApplicable("A caldera lake has no way out to any network boats travel."),
    drainage: costNear(0.5),
    magic: costNear(0.6),
    crosses: notApplicable("A closed hollow leads nowhere across anything."),
  },
  others: {
    statement:
      "A caldera stands in a volcano, commonly holds a lake and vents, and is never on the same spot as an impact crater.",
    needs: [{ kind: "volcano", holds: standsIn }],
    excludes: [{ kind: "crater", holds: sameSpot }],
    contains: [
      { kind: "lake", holds },
      { kind: "vent", holds },
      { kind: "spring", holds },
    ],
    pairsWith: [{ kind: "thermalVein", holds: within(spans(4)) }],
  },
  people: {
    statement:
      "A caldera is a walled basin with hot water and sulphur, sacred or shunned; on a live cone the ground itself can go, and that reaches the whole mountain.",
    offers(state, place) {
      return {
        water: isLake(state, place.anchor) ? 1 : 0,
        materials: geothermalAt(state, place.anchor),
        sanctity: factors.magnitude(state, place),
      };
    },
    threatens(state, place) {
      const live = liveAt(state, place);
      return live > 0
        ? [{ hazard: "renewed collapse", reach: spans(4)(state), severity: live }]
        : [];
    },
  },
  time: {
    statement:
      "A caldera fills with lake and sediment, and a dead one's rim wears away. It lasts while it reads as flagged ground; a lake that outlives the rim is just a lake.",
    fate(state, place): PoiFate {
      if (isA(state, place.anchor)) return { fate: "persists" };
      return isLake(state, place.anchor) ? { fate: "becomes", kind: "lake" } : { fate: "ends" };
    },
  },
  visibility: {
    statement:
      "A caldera shows by its width and depth inside its own cone; it is drawn within its volcano, and a sacred lake in one earns more from people than its size does.",
    ...factors,
    visibleAt: drawnWhen(factors, { magnitude: 0.6, localConditions: 0.3, isolation: 0.1 }),
  },
  naming: {
    statement: "Takes the name of its volcano, or of the lake in it where the lake is known first.",
    namedBy: namingCultureNear,
    takesNameFrom: [{ kind: "volcano", holds: standsIn }],
    lendsNameTo: [{ kind: "lake", holds }],
  },
};
