import type { GenerationState } from "../../process";
import { carryWhereItLands, costNear, counterpartOf } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiPlace } from "../poiContract";
import { holds, namingCultureNear, regionPlaces, within } from "../poiPlaces";
import {
  adjacent,
  cellSpan,
  celsiusAt,
  fieldOf,
  iceAt,
  isRiver,
  magicValue,
  shareAround,
} from "../poiReads";
import { aloneAmong, attachment, drawnWhen, sized, standsOut } from "../poiVisibilityRules";
import {
  aroundOf,
  effectOf,
  floorOf,
  lengthOf,
  movesOrGoes,
  ruleFloor,
  sealedAt,
  veinAt,
} from "./groundReads";

/** A course length at which a vein is half as great as veins get, the world's mark of a regional conduit. */
const typicalLength = 100_000;
/** How far a band walks to work a vein, as the cold-age works hold it. */
const dayReach = 25_000;
/** How far a burst of steam and gas reaches from the fracture, in metres. */
const burstReach = 2000;
/** Fire runs this much more cheaply along an open conduit than through the rock around it. */
const conduitCost = 0.5;
/** Water finds fractured rock an easier way down than sound rock. */
const fracturedDrainage = 0.8;
/** Going over ground kept thawed in frost country is easier than over the frost around it. */
const thawedGoing = 0.85;

const fireAt = (state: GenerationState, cell: number) =>
  magicValue(state, "fire", "intensity", cell);
const heatAt = (state: GenerationState, cell: number) =>
  Math.round(fireAt(state, cell) * effectOf(state, "fire", "heat"));
const strengthOf = (state: GenerationState, place: PoiPlace) =>
  Math.min(1, fireAt(state, place.anchor) / 1000);
const reachOf = (state: GenerationState) => Math.max(aroundOf(state), dayReach);
const places = regionPlaces("thermalVein", veinAt, fireAt);
const counterpart = counterpartOf(veinAt, 1);
const factors = {
  magnitude: (state: GenerationState, place: PoiPlace) =>
    (sized(lengthOf, typicalLength)(state, place) + strengthOf(state, place)) / 2,
  localConditions: standsOut(fireAt, aroundOf),
  isolation: aloneAmong(places, (state) => 2 * aroundOf(state)),
  cultural: attachment(reachOf),
};
/** Ground kept clear of ice with ice beside it: a thawed way through frozen country. */
const thawedThrough = (state: GenerationState, cell: number) =>
  iceAt(state, cell) <= 0 && shareAround(state, cell, (next) => iceAt(state, next) > 0) > 0;

export const thermalVein: PoiEntry = {
  id: "thermalVein",
  group: "ground",
  name: "Thermal vein",
  recognition: {
    distinct:
      "A cell of Fire's vein rule: strong Fire intensity held in rock whose fracture conductance is high, grown as a course along the conduit. Fracture is what separates it: a thawed halo has the warmth with little fracture, a hot spring has the heat with wet ground or standing water and needs no fracture, a Fire core is a located source and not its course, and a mine is a published work on a vein, not the ore. Only the system's rule decides; no size enters.",
    isA: veinAt,
  },
  existence: {
    statement:
      "Emerges as Fire propagates: conduits open along fractures from heat maxima under land, and a vein is where the ore stands in the rock while the conduit is fed. With Fire disabled there are none, since nothing else in the data records ore in rock.",
    way: "emerges",
    requires: notApplicable(
      "The vein rule tests Fire's own intensity and the fracture it runs in; nothing has to be there first."
    ),
    suitability: notApplicable(
      "Fire's propagation grows veins; no process chooses a cell for one."
    ),
    places,
  },
  fields: {
    statement:
      "A vein is a source and a conduit. It holds the hardened rock and opened fractures Fire gave it so erosion cannot undo them while it stands, warms the ground and any river crossing it, thaws the ice over it, and quickens what grows on it. Each is a floor on what Fire's own terms give, so it never adds a second dose.",
    terrain: (state, place) =>
      place.cells.map((cell) =>
        floorOf("RockResistance", cell, fieldOf(state).RockResistance.get(cell))
      ),
    water: (state, place) =>
      place.cells
        .filter((cell) => isRiver(state, cell))
        .map((cell) => floorOf("RiverWarmth", cell, heatAt(state, cell))),
    climate: (state, place) =>
      place.cells.map((cell) => floorOf("ExternalHeatForcing", cell, heatAt(state, cell))),
    cover: (state, place) =>
      place.cells.map((cell) =>
        floorOf(
          "Quickening",
          cell,
          Math.min(1, (fireAt(state, cell) / 1000) * effectOf(state, "fire", "quickening"))
        )
      ),
    magic: (state, place) =>
      place.cells.map((cell) =>
        floorOf("FractureConductance", cell, fieldOf(state).FractureConductance.get(cell))
      ),
  },
  acrossMaps: {
    statement:
      "A captured vein lands on the refined map as a course of open fracture. The child must hold fracture at the level the rule retains or Fire will not stay in it; if no vein develops within a parent span of where it lands, the vein goes, because the ore's reach on finer ground is Fire's to decide. Only the course's first coordinate is carried.",
    carry: carryWhereItLands,
    realize(state, carried) {
      const opened = ruleFloor(state, "fire", "vein", "fracture");
      return opened === undefined
        ? []
        : [carried.cell, ...adjacent(state, carried.cell)].map((cell) =>
            floorOf("FractureConductance", cell, opened)
          );
    },
    counterpart,
    unrealized: movesOrGoes(counterpart),
    settle: notApplicable("Rock does not move with a round's water; Fire re-grows the course."),
  },
  movement: {
    statement:
      "Fire runs far along the open conduit and water follows the same fractures down. In frost country the thawed strip is easier going than the ice beside it, and gives a route across a glacier's edge.",
    roads: (state, place, cell) =>
      place.cells.includes(cell) && celsiusAt(state, cell) <= 0 && iceAt(state, cell) <= 0
        ? thawedGoing
        : 1,
    boats: notApplicable("A vein is in rock; a river crossing it carries boats as before."),
    drainage: costNear(fracturedDrainage),
    magic: costNear(conduitCost),
    crosses: (state, place) => (place.cells.some((c) => thawedThrough(state, c)) ? ["ice"] : []),
  },
  others: {
    statement:
      "A vein runs from a Fire core and feeds what lies along it: hot springs where it meets wet ground, mines cut into it, forges that crack its cores. It is the rock a vent would be if the sea covered it, so the two never share a cell. Sealed, it is a basalt flat.",
    needs: notApplicable(
      "Its rule already reads the Fire that feeds it, and no other kind of place has to stand first."
    ),
    excludes: [{ kind: "vent", holds: (_state, a, b) => b.cells.includes(a.anchor) }],
    contains: [{ kind: "mine", holds }],
    pairsWith: [
      { kind: "spring", holds: within(aroundOf) },
      { kind: "forge", holds: within(reachOf) },
      { kind: "thawedHalo", holds: within(aroundOf) },
    ],
  },
  people: {
    statement:
      "A vein offers ore and fire cores to those who can reach it, and warmth a cold-age band can live on; opened further, it bursts steam and gas along the fracture.",
    offers(state, place) {
      const strength = strengthOf(state, place);
      return { materials: strength, power: strength / 2 };
    },
    threatens: (state, place) => [
      {
        hazard: "steam and gas burst",
        reach: burstReach,
        severity: strengthOf(state, place),
      },
    ],
  },
  time: {
    statement:
      "A vein lasts while its conduit is fed. When the conduit has carried its budget it seals and goes cold, leaving a scar of sinter and basalt over spent ore that the crust carries and erosion may exhume; new strain can reopen it, and the same fracture is a vein again.",
    fate: (state, place) =>
      sealedAt(state, "fire", place.anchor)
        ? { fate: "ends", leaves: "basaltFlat" }
        : { fate: "persists" },
  },
  visibility: {
    statement:
      "A vein shows by its course's length and strength together, and by standing hotter than the country around it. A short vein a town depends on shows for that town.",
    ...factors,
    visibleAt: drawnWhen(factors, { magnitude: 0.5, localConditions: 0.3, isolation: 0.2 }),
  },
  naming: {
    statement:
      "Named by the people who live within reach of it, for the mine or town that works it; a vein with no one near it goes unnamed.",
    namedBy: namingCultureNear,
    takesNameFrom: notApplicable(
      "A vein is found and named on its own account; others name after it."
    ),
    lendsNameTo: [
      { kind: "mine", holds: within((state) => cellSpan(state)) },
      { kind: "settlement", holds: within(reachOf) },
    ],
  },
};
