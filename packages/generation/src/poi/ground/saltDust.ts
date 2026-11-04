import type { GenerationState } from "../../process";
import { carryWhereItLands, costNear, counterpartOf } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiPlace } from "../poiContract";
import { namingCultureNear, regionPlaces, settlementWithin, within } from "../poiPlaces";
import { aloneAmong, attachment, drawnWhen, sized, standsOut } from "../poiVisibilityRules";
import {
  areaOf,
  aroundOf,
  dustAt,
  movesOrGoes,
  parameterOf,
  reservoirPerArea,
  ruleFloor,
  saltHeld,
  saltThinned,
  saltedAir,
  saltingAt,
  standsOn,
} from "./groundReads";

/** An area at which a plume is half as great as plumes get, in square metres. */
const typicalArea = 2_000_000_000;
/** The salt on the air slows a day's walk; it is a nuisance, not a wall. */
const foulGoing = 1.15;
/** Wind that lifts dust passes over bare salted ground without losing what it carries. */
const openToWind = 0.8;
/** How far a plume's blight falls beyond its ground, in metres. */
const blightReach = 20_000;
/** Dust a rule reads as a place, when Salt is absent and no definition gives it. */
const lostFloor = 10;

const dustOf = (state: GenerationState, cell: number) =>
  reservoirPerArea(state, "salt", "dust", cell);
const places = regionPlaces("saltDust", dustAt, dustOf);
const counterpart = counterpartOf(dustAt, 1);
const factors = {
  magnitude: sized(areaOf, typicalArea),
  localConditions: standsOut(saltingAt, aroundOf),
  isolation: aloneAmong(places, (state) => 2 * aroundOf(state)),
  cultural: attachment(aroundOf),
};
const floorOfDust = (state: GenerationState) =>
  ruleFloor(state, "salt", "dust", "stock:death/dust") ?? lostFloor;
const severityAt = (state: GenerationState, place: PoiPlace) =>
  Math.min(1, saltingAt(state, place.anchor) + factors.magnitude(state, place) / 2);

export const saltDust: PoiEntry = {
  id: "saltDust",
  group: "ground",
  name: "Salt dust",
  recognition: {
    distinct:
      "A land cell in Salt's dust rule: Salt's dust stock, from either origin, per square metre at the rule's floor. It is the only one of Salt's places read from the dust reservoir: a salt pan reads Salt's intensity or a closed floor, a glass flat the bed reservoir, a killing ground the brine, so a plume over a pan is two things with two tests. There is no natural dust: nothing in the data records salt blown from a pan Salt did not make.",
    isA: dustAt,
  },
  existence: {
    statement:
      "Emerges as Salt's weathering runs: wind lifts dust from exposed bed on bare dry ground, and each epoch a share settles to bed while the rest blows one cell on, so a plume is where salt is in passage. It needs Salt enabled.",
    way: "emerges",
    requires: notApplicable("Its rule reads Salt's stock; no other thing has to stand there."),
    suitability: notApplicable("The wind chooses where it falls; nothing sites it."),
    places,
  },
  fields: {
    statement:
      "A plume salts the ground it falls on: the air over it dries, growth thins, and the salting stays where the dust lies however the field shifts. It builds no land: what settles is a thin bed that Salt keeps in its own stock.",
    terrain: notApplicable(
      "Settled dust is a stock, not height; even a bed deep enough to fuse changes rock, not elevation."
    ),
    water: notApplicable(
      "Salt in water is not a field band; dust that lands on wet ground dissolves in Salt's stock, not in the water bands."
    ),
    climate: saltedAir,
    cover: saltThinned,
    magic: saltHeld,
  },
  acrossMaps: {
    statement:
      "A captured plume lands on the refined map as whatever dust the child inherits. A plume is carried for its name only: the child's own wind decides its shape, so there is nothing for the finer ground to provide. It follows the nearest dust at each round and goes when none is near.",
    carry: carryWhereItLands,
    realize: notApplicable(
      "The child inherits the dust stock and its wind moves it; no shape is held."
    ),
    counterpart,
    unrealized: movesOrGoes(counterpart),
    settle: movesOrGoes(counterpart),
  },
  movement: {
    statement:
      "Salt on the air makes a day's walk harder and carries no barrier with it, and the same wind runs the stock on from bare salted ground.",
    roads: costNear(foulGoing),
    boats: notApplicable("The rule covers land only; dust blown out to sea leaves the budget."),
    drainage: notApplicable(
      "A thin fall of dust changes neither the ground nor the slope that water reads."
    ),
    magic: costNear(openToWind),
    crosses: notApplicable("Dust covers ground; it opens no way over anything."),
  },
  others: {
    statement:
      "A plume blows from a bed: a pan, a glass flat, a killing ground that has crusted. Dust that settles is on its way to being a pan. It has no water under it, and a settled plume never lies on a lake.",
    needs: notApplicable(
      "The bed it came from may have blown away or moved on with the crust; a plume is read from its own stock."
    ),
    excludes: [{ kind: "lake", holds: standsOn }],
    contains: notApplicable("A plume is salt in passage; nothing is sited in it for being one."),
    pairsWith: [
      { kind: "saltPan", holds: within((state) => 3 * aroundOf(state)) },
      { kind: "glassFlat", holds: within((state) => 3 * aroundOf(state)) },
      { kind: "killingGround", holds: within((state) => 3 * aroundOf(state)) },
    ],
  },
  people: {
    statement:
      "It offers nothing that could be gathered: salt this thin is taken from the bed it came from. It blights crops and fouls wells downwind.",
    offers: notApplicable(
      "Salt this thin cannot be gathered; people take it from the bed it blew from."
    ),
    threatens: (state, place) => [
      {
        hazard: "salt blight on fields and wells",
        reach: blightReach,
        severity: severityAt(state, place),
      },
    ],
  },
  time: {
    statement:
      "A plume is short-lived in its place: half of it settles each epoch and the rest blows on, so it lasts only where the bed upwind keeps feeding it. When the air's share falls under the rule's floor it ends and the bed it laid is a pan, if it laid enough.",
    fate(state, place) {
      const dust = dustOf(state, place.anchor),
        settling = parameterOf(state, "salt", "dustSettle") ?? 0.5,
        floor = floorOfDust(state);
      if (dust * (1 - settling) >= floor) return { fate: "persists" };
      return reservoirPerArea(state, "salt", "bed", place.anchor) >= floor
        ? { fate: "ends", leaves: "saltPan" }
        : { fate: "ends" };
    },
  },
  visibility: {
    statement:
      "A plume shows by its area and by how much saltier it lies than the country around it; a town fouled by it makes it known. It is a condition more than a landmark, so its isolation counts for little.",
    ...factors,
    visibleAt: drawnWhen(factors, { magnitude: 0.6, localConditions: 0.3, isolation: 0.1 }),
  },
  naming: {
    statement:
      "Only the people it falls on name it, and they call it after the pan it blows from; empty country leaves it unnamed.",
    namedBy: (state, place) =>
      settlementWithin(state, place.anchor, 3 * aroundOf(state))
        ? namingCultureNear(state, place)
        : null,
    takesNameFrom: [{ kind: "saltPan", holds: within((state) => 3 * aroundOf(state)) }],
    lendsNameTo: notApplicable(
      "A passing plume does not last long enough for anything to be named after it."
    ),
  },
};
