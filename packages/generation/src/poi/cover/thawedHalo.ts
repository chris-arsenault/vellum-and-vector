import type { GenerationState } from "../../process";
import { carryWhereItLands } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiFieldChange, type PoiPlace } from "../poiContract";
import { namingCultureNear, regionPlaces } from "../poiPlaces";
import {
  adjacent,
  celsiusAt,
  fieldOf,
  geothermalAt,
  heldFor,
  iceAt,
  isRiver,
  magicRule,
} from "../poiReads";
import { drawnWhen } from "../poiVisibilityRules";
import {
  borders,
  ceilingsHeld,
  countryCounterpart,
  countryFactors,
  floorsHeld,
  hazardReach,
  isKind,
  meanOver,
  movesOrGoes,
  onPlace,
  sharesNoGround,
  spanOf,
  standsIn,
  withinOwn,
} from "./coverShared";

/** Area at which a halo is half as great as halos get: 2,000 square kilometres. */
const typicalArea = 2e9;
/** A road's cost on thawed ground, and a boat's on an open reach, in frozen country. */
const thawedRoad = 0.7,
  openReach = 0.8;
/** The depth of ice, in metres, `environment` counts as frozen ground. */
const frozenFrom = 1;
const isA = isKind("thawedHalo");
const quickeningAt = (state: GenerationState, cell: number) => fieldOf(state).Quickening.get(cell);
const places = regionPlaces("thawedHalo", isA, quickeningAt);
const factors = countryFactors(places, typicalArea, celsiusAt);
const counterpart = countryCounterpart(isA);
const unrealized = movesOrGoes(counterpart);
const scar = magicRule("fire", "scar");

/** Whether ice lies at the rim of a place: only then is it a way through frozen country. */
const inFrozenCountry = (state: GenerationState, place: PoiPlace) =>
  heldFor(state, `halo-rim:${place.id}`, () =>
    place.cells.some((cell) =>
      [...adjacent(state, cell)].some((next) => iceAt(state, next) > frozenFrom)
    )
  );
/** The thawed ground takes on no new ice, and a river through it keeps its warmth downstream. */
function thawed(state: GenerationState, place: PoiPlace): PoiFieldChange[] {
  const warmth = fieldOf(state).RiverWarmth,
    reaches = place.cells.filter((cell) => isRiver(state, cell));
  return [
    ...ceilingsHeld("IceThickness")(state, place),
    ...reaches.map((cell): PoiFieldChange => ({
      change: "atLeast",
      band: "RiverWarmth",
      cell,
      value: warmth.get(cell),
    })),
  ];
}

export const thawedHalo: PoiEntry = {
  id: "thawedHalo",
  group: "cover",
  name: "Thawed halo",
  recognition: {
    distinct:
      "Land marked by Fire's halo rule: Fire intensity of at least 210 per mille at no colder than -5 degrees, growing outward at 140 with fractured ground. It is unlike a thermal vein, which needs fracture of 430 and may run under it, or a hot spring, which needs wet ground at 560 or geothermal heat of 720. Against forest or grassland it is the Fire rule that decides, not the cover: trees or meadow on it are its properties. Wild ground over it takes the cell.",
    isA,
  },
  existence: {
    statement:
      "Emerges as Fire's propagated heat holds country open around a conduit, crater or forge. What grows on it is a property: an Ember grove where quickening raised canopy of 0.3 and a Thaw meadow on open cover, read from the biome name. Bare halo ground has neither. Quickened growth outside the rule is plain forest or grassland.",
    way: "emerges",
    requires: notApplicable(
      "Its requirement is the rule itself: Fire's intensity at a temperature it can hold open."
    ),
    suitability: notApplicable("Fire's propagation decides its reach; nothing chooses a site."),
    places,
  },
  fields: {
    statement:
      "Fire's heat keeps ice off this ground, so meltwater runs and rivers leave it warm; the air over it stays warmer than the country around, and life runs faster and burns more readily through its own quickening.",
    terrain: notApplicable(
      "It lifts and cuts nothing itself: Fire's rock hardening is the system's own effect, and the ice it thaws is declared under water."
    ),
    water: thawed,
    climate: floorsHeld("Temperature"),
    cover: notApplicable(
      "Quickening already is cover's own forcing: turnover and fire run up to four times faster in the ecology, and a declared change would count them twice."
    ),
    magic: floorsHeld("Quickening"),
  },
  acrossMaps: {
    statement:
      "Fire's bands carry to the child, whose rule then finds the halo on finer ground, with its edge following the rock's fractures. The captured halo's name goes to the nearest halo ground within two parent cells; if the finer field has none there, it goes.",
    carry: carryWhereItLands,
    realize: notApplicable(
      "Fire's own field and feedback write the warmth on the child: the place is what those produce, not a cause of them."
    ),
    counterpart,
    unrealized,
    settle: unrealized,
  },
  movement: {
    statement:
      "In frozen country a halo is the way through: roads run cheaper on ground with no ice, boats find rivers open, and a route can cross ice country by way of it. On country that was never frozen it changes nothing.",
    roads: (state, place, cell) =>
      inFrozenCountry(state, place) ? onPlace(() => thawedRoad)(state, place, cell) : 1,
    boats: (state, place, cell) =>
      inFrozenCountry(state, place) && isRiver(state, cell)
        ? onPlace(() => openReach)(state, place, cell)
        : 1,
    drainage: notApplicable(
      "Fire melts the ice before the network runs on the ground, so what it finds is ordinary ground at no special cost."
    ),
    magic: notApplicable(
      "Fire travels by fracture and crust, whose costs the halo does not change: a halo is what that carriage has already reached."
    ),
    crosses: (state, place) => (inFrozenCountry(state, place) ? ["ice"] : []),
  },
  others: {
    statement:
      "It shares no ground with ordinary cover or wild ground. A vein or hot spring may lie in it; its rim pairs with the melt line, where ice gives out, and bands camp at its edge.",
    needs: notApplicable(
      "Its rule reads Fire's intensity directly, which a vein, a crater or a forge may each raise."
    ),
    excludes: sharesNoGround("forest", "grassland", "barren", "wildZone", "clearance", "lake"),
    contains: standsIn("thermalVein", "spring"),
    pairsWith: [...borders("meltLine"), { kind: "settlement", holds: withinOwn(spanOf) }],
  },
  people: {
    statement:
      "Warmth to farm in, with quickening raising what grows; meltwater and heat from the ground. People camp at its edge in cold country and fear it from above: fire runs faster here, and the society reads it as a volatile place below a route.",
    offers(state, place) {
      const quickening = meanOver(state, place, quickeningAt);
      return {
        food: quickening,
        water: inFrozenCountry(state, place) ? 1 : 0.2,
        power: meanOver(state, place, geothermalAt),
        sanctity: quickening / 2,
      };
    },
    threatens(state, place) {
      const quickening = meanOver(state, place, quickeningAt);
      return [{ hazard: "fast fire", reach: hazardReach(state, place), severity: quickening }];
    },
  },
  time: {
    statement:
      "A halo lasts as long as its conduit stays open. When Fire seals, the warmth goes in an epoch and the ice can come back, leaving the basalt and sinter of a scar.",
    fate: (state, place) =>
      place.cells.some((cell) => scar(state, cell))
        ? { fate: "ends", leaves: "basaltFlat" }
        : { fate: "persists" },
  },
  visibility: {
    statement:
      "A halo is mostly a matter of contrast: a thawed country in polar ice is one of the great sights of a map, and the same warmth in the tropics is nothing to see. Local warmth outweighs size, and a town at its edge carries it.",
    ...factors,
    visibleAt: drawnWhen(factors, { magnitude: 0.25, localConditions: 0.55, isolation: 0.2 }),
  },
  naming: {
    statement: "Named by the people who camp at its edge, and the towns there may take the name.",
    namedBy: namingCultureNear,
    takesNameFrom: notApplicable(
      "It is older than the people it draws; names run outward from it."
    ),
    lendsNameTo: [{ kind: "settlement", holds: withinOwn(spanOf) }],
  },
};
