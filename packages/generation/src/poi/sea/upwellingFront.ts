import type { GenerationState } from "../../process";
import { carryWhereItLands, costNear, counterpartOf, goes, movesTo } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiFieldChange, type PoiPlace } from "../poiContract";
import { holds, namingCultureNear, regionPlaces, within } from "../poiPlaces";
import { cellSpan, fieldOf, isSea, magicRule, upwellingAt } from "../poiReads";
import { aloneAmong, attachment, drawnWhen, sized, standsOut } from "../poiVisibilityRules";
import { areaOf, faunaAt, pressureAt, pressureLength, shoreOf, stormAt } from "./seaShared";

/** The upwelling at which the society reads a shore as a fishery coast (0.3 of the native 1000). */
const fisheryLift = 0.3;
/** Area at which a front is half as great as fronts get: 2,000 square kilometres. */
const typicalArea = 2e9;
/** Pressure's front rule: a ray below this moves no water; fog grows to full over the span, up to Pressure's fog share. */
const movesWater = 160,
  fogSpan = 400,
  fogShare = 0.8;
/** Extra boat cost at full upwelling: fog and cold, heavy water. */
const fogDrag = 0.5;
/** A boundary between water masses holds back what the current carries. */
const heldCurrent = 1.3;
/** Fog drip is worth gathering on a coast this much of what a well gives. */
const fogWater = 0.3;

const pressureFront = magicRule("pressure", "front");
const isA = (state: GenerationState, cell: number) =>
  isSea(state, cell) && (upwellingAt(state, cell) >= fisheryLift || pressureFront(state, cell));
const places = regionPlaces("upwellingFront", isA, upwellingAt);
const around = (state: GenerationState) => 10 * cellSpan(state);
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

/** The cold band stays lifted while it stands. */
const lifted = (state: GenerationState, place: PoiPlace): readonly PoiFieldChange[] => {
  const map = fieldOf(state);
  return place.cells.map((cell) => ({
    change: "atLeast",
    band: "Upwelling",
    cell,
    value: map.Upwelling.get(cell),
  }));
};
/** Cold water under moist air: fog settles on the shore it touches, natural front or Pressure's. */
const fogged = (state: GenerationState, place: PoiPlace): readonly PoiFieldChange[] => {
  const native = fieldOf(state).Upwelling.get(place.anchor),
    value = Math.max(0, Math.min(1, (native - movesWater) / fogSpan)) * fogShare;
  return shoreOf(state, place).map((cell) => ({
    change: "atLeast",
    band: "FogForcing",
    cell,
    value,
  }));
};

export const upwellingFront: PoiEntry = {
  id: "upwellingFront",
  group: "sea",
  name: "Upwelling front",
  recognition: {
    distinct:
      "A sea cell with Upwelling at or above 0.3, the lift the society reads as a fishery coast, or a member of Pressure's front rule (a shoaling ray of at least 250 intensity lifting at least 250 of upwelling, retained to 160). Cold rising water decides it. A crush zone is intense Pressure with no lift needed; an ancient wake warms the surface and the moved-water rule makes a cell one or the other.",
    isA,
  },
  existence: {
    statement:
      "Emerges two ways with one result: gyre circulation raises deep water along eastern boundaries, and Pressure's rays lift it where they shoal. Both write the Upwelling band; a front is wherever that band stands high enough or the system's rule has grown.",
    way: "emerges",
    requires: notApplicable("Its test reads the water itself."),
    suitability: notApplicable("No process chooses a front; currents and rays make it."),
    places,
  },
  fields: {
    statement:
      "A front holds cold nutrient water at the surface and settles fog on the shore it touches, so a dry coast is wetted by fog drip. Productivity in the water rises with it.",
    terrain: notApplicable(
      "It reads the shoal that lifts it and makes none; only water moves here."
    ),
    water: lifted,
    climate: fogged,
    cover: notApplicable(
      "Ecology already multiplies aquatic productivity by the Upwelling band, and fog drip reaches land cover through precipitation."
    ),
    magic: notApplicable(
      "The ocean feedback lifts it from Pressure's intensity and replaces whatever an earlier pass applied, so a declared change would be overwritten. PoiFieldChange also has no band for a magic channel."
    ),
  },
  acrossMaps: {
    statement:
      "A captured front keeps the water cold where it lands, because Pressure's rays are not retraced on a refined map and the captured field stands. It moves to the nearest cold water, and if no cold water lies within reach the front goes: the finer sea does not hold it.",
    carry: carryWhereItLands,
    realize: (state, carried) =>
      isSea(state, carried.cell)
        ? [
            {
              change: "atLeast",
              band: "Upwelling",
              cell: carried.cell,
              value: Math.round(fisheryLift * 1000),
            },
          ]
        : [],
    counterpart,
    unrealized: (state, carried) =>
      counterpart(state, carried) >= 0 ? movesTo(counterpart)(state, carried) : goes(),
    settle: notApplicable("A round's river water does not move cold water offshore."),
  },
  movement: {
    statement:
      "Boats pay for its fog and cold in proportion to the lift, though fleets come for the fish. Current-borne magic is held back at the boundary of two water masses; Pressure's rays are traced by geometry and do not read this cost.",
    roads: notApplicable(
      "It lies wholly on the sea; a coast road feels it only as fog in the rain."
    ),
    boats: (state, place, cell) =>
      place.cells.includes(cell) ? 1 + fogDrag * upwellingAt(state, cell) : 1,
    drainage: notApplicable(
      "It moves no surface water to the land; fog drip enters drainage as rain through the climate process."
    ),
    magic: costNear(heldCurrent),
    crosses: notApplicable("It bars nothing and opens nothing; boats pass through it."),
  },
  others: {
    statement:
      "A front feeds the harbours and fishing towns near it. Where Pressure makes it, it lies in reach of a locus, and often borders a crush zone. The moved-water rule makes it and an ancient wake exclusive at a cell.",
    needs: notApplicable(
      "A natural front needs only the gyre; Pressure's rule states its own needs."
    ),
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
      "A natural front stands as long as its gyre, shifting with the basin. A front Pressure lifts lasts while its rays reach that shoal and ends when they no longer do, whether the coast closed or the system went quiet.",
    fate(state, place) {
      const map = fieldOf(state),
        natural =
          (map.Upwelling.get(place.anchor) - map.ExternalUpwelling.get(place.anchor)) / 1000,
        fed = pressureAt(state, place.anchor) >= movesWater / 1000;
      return natural >= fisheryLift || fed ? { fate: "persists" } : { fate: "ends" };
    },
  },
  visibility: {
    statement:
      "A front shows by its reach and lift, and by standing against warmer sea. A town that fishes it holds a modest one on the map, because a fishery matters to more people than its water suggests.",
    ...factors,
    visibleAt: drawnWhen(factors, { magnitude: 0.5, localConditions: 0.3, isolation: 0.2 }),
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
