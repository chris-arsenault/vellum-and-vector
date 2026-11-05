// @needsResolution carry: a carried place may not resolve on a finer map (ADR 0009).
import type { GenerationState } from "../../process";
import { carryWhereItLands, costNear, counterpartOf, goes, movesTo } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiPlace } from "../poiContract";
import { holds, namingCultureNear, rulePlaces, within } from "../poiPlaces";
import { ruleRecord } from "../poiRecords";
import { magicRule, upwellingAt } from "../poiReads";
import { aloneAmong, attachment, sized, standsOut, weighed } from "../poiVisibilityRules";
import { areaOf, faunaAt, near, pressureLength, stormAt } from "./seaShared";

/** Area at which a front is half as great as fronts get: 2,000 square kilometres. */
const typicalArea = 2e9;
/** Extra boat cost at full upwelling: fog and cold, heavy water. */
const fogDrag = 0.5;
/** A boundary between water masses holds back what the current carries. */
const heldCurrent = 1.3;
/** Fog drip is worth gathering on a coast this much of what a well gives. */
const fogWater = 0.3;

const isA = magicRule("pressure", "front");
const places = rulePlaces("upwellingFront", "pressure", "front");
/** The sea around a front that bears on it: 100 km. */
const around = near(100_000);
const counterpart = counterpartOf(isA, 2);

const factors = {
  /** Its reach and its strength together: a broad weak band and a small strong one are lesser. */
  magnitude: (state: GenerationState, place: PoiPlace) =>
    (sized(areaOf, typicalArea)(state, place) + upwellingAt(state, place.anchor)) / 2,
  localConditions: standsOut(upwellingAt, around),
  isolation: aloneAmong(places, around),
  /** A fishing coast's people are tied to it from further than most water. */
  cultural: attachment((state) => 2 * around(state)),
};

export const upwellingFront: PoiEntry = {
  id: "upwellingFront",
  group: "sea",
  name: "Upwelling front",
  recognition: {
    distinct:
      "A member of Pressure's front rule: a shoaling ray of at least 250 intensity lifting at least 250 of upwelling, retained to 160. Cold water the rays raise decides it. A crush zone is intense Pressure with no lift needed; an ancient wake warms the surface and the moved-water rule makes a cell one or the other.",
    isA,
  },
  existence: {
    statement:
      "Emerges where Pressure's rays shoal and lift deep water, as the system's rule grows it. A gyre's upwelling along an eastern boundary stays in the Upwelling band, where the society still fishes it; it is not a place of this kind.",
    way: "emerges",
    requires: notApplicable("Its test reads the water itself."),
    suitability: notApplicable("No process chooses a front; rays make it."),
    places,
  },
  publication: {
    statement: "Every front publishes as the system's class, its outline by coverage.",
    moment: "magic",
    record: ruleRecord("pressure", "front"),
  },
  fields: {
    statement:
      "The cold water at the surface, and the fog on the shore it touches, are the ocean feedback's writes from the same rays; the front is where they stand. It changes no field beyond them.",
    terrain: notApplicable(
      "It reads the shoal that lifts it and makes none; only water moves here."
    ),
    water: notApplicable(
      "The ocean feedback lifts Upwelling from Pressure's intensity, over the gyre's own."
    ),
    climate: notApplicable(
      "The ocean feedback settles fog on the coasts facing moved water, wherever the rays shoal."
    ),
    cover: notApplicable(
      "Ecology already multiplies aquatic productivity by the Upwelling band, and fog drip reaches land cover through precipitation."
    ),
    magic: notApplicable(
      "The rays write Pressure's intensity, and the ocean feedback replaces whatever an earlier pass applied."
    ),
  },
  acrossMaps: {
    statement:
      "Pressure's rays are not retraced on a refined map: the captured field stands and the ocean feedback re-derives the cold water from it, so a captured front lands where the parent's lies. It moves to the nearest cell of the rule, and if none lies within reach the front goes: the finer sea does not hold it.",
    carry: carryWhereItLands,
    realize: notApplicable(
      "The ocean feedback runs on the refined map too, over the captured intensity."
    ),
    counterpart,
    unrealized: (state, carried) =>
      counterpart(state, carried) >= 0 ? movesTo(counterpart)(state, carried) : goes(),
    settle: notApplicable("A round's river water does not move cold water offshore."),
    schedule: notApplicable("A captured front does nothing to a refinement's schedule."),
  },
  movement: {
    statement:
      "Boats pay for its fog and cold in proportion to the lift, though fleets come for the fish. Current-borne magic is held back at the boundary of two water masses; Pressure's rays are traced by geometry and do not read this cost.",
    roads: notApplicable(
      "It lies wholly on the sea; a coast road feels it only as fog in the rain."
    ),
    boats: (state, place) =>
      place.cells.map((cell) => ({ cell, factor: 1 + fogDrag * upwellingAt(state, cell) })),
    drainage: notApplicable(
      "It moves no surface water to the land; fog drip enters drainage as rain through the climate process."
    ),
    magic: { current: costNear(heldCurrent) },
    links: notApplicable("A front joins no two cells."),
    crosses: notApplicable("It bars nothing and opens nothing; boats pass through it."),
  },
  others: {
    statement:
      "A front feeds the harbours and fishing towns near it. It lies in reach of a locus or a rogue impact's spokes, and often borders a crush zone. The moved-water rule makes it and an ancient wake exclusive at a cell.",
    needs: notApplicable("Pressure's rule states its own needs."),
    excludes: [{ kind: "ancientWake", holds: (_state, a, b) => b.cells.includes(a.anchor) }],
    contains: [{ kind: "rogueWaveImpact", holds }],
    pairsWith: [
      { kind: "harbour", holds: within(around) },
      { kind: "settlement", holds: within(around) },
      { kind: "crushZone", holds: within(around) },
      {
        kind: "pressureLocus",
        holds: within((state) => pressureLength(state, "rayDistance", 0)),
      },
    ],
  },
  people: {
    statement:
      "A front is the best fishing there is, doubling a shore's catch, and its fog is water on a dry coast. It hides shoals from pilots, and on Pressure's fronts storms are born.",
    offers: (state, place) => ({
      food: Math.max(upwellingAt(state, place.anchor), faunaAt(state, place.anchor)),
      water: fogWater * upwellingAt(state, place.anchor),
    }),
    threatens(state, place) {
      const storm = stormAt(state, place.anchor),
        hazards = [
          {
            hazard: "fog on the shoals",
            reach: around(state),
            severity: upwellingAt(state, place.anchor) / 2,
          },
        ];
      return storm > 0
        ? [...hazards, { hazard: "storm", reach: 2 * around(state), severity: storm }]
        : hazards;
    },
  },
  time: {
    statement:
      "A front lasts while Pressure's rays reach that shoal and ends when they no longer do, whether the coast closed or the system went quiet.",
    fate: (state, place) => (isA(state, place.anchor) ? { fate: "persists" } : { fate: "ends" }),
  },
  visibility: {
    statement:
      "A front shows by its reach and lift, and by standing against warmer sea. A town that fishes it holds a modest one on the map, because a fishery matters to more people than its water suggests.",
    ...factors,
    importance: weighed(factors, { magnitude: 0.5, localConditions: 0.3, isolation: 0.2 }),
  },
  naming: {
    statement: "Named by the fishing people nearest it; a harbour may take its name.",
    namedBy: namingCultureNear,
    takesNameFrom: notApplicable(
      "A front's name is its fishery's; it has no older place to take one from."
    ),
    lendsNameTo: [{ kind: "harbour", holds: within(around) }],
  },
};
