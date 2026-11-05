// @needsResolution carry: a carried place may not resolve on a finer map (ADR 0009).
import { frozenIce } from "../../canonry/ecologyEnvironment";
import type { GenerationState } from "../../process";
import { carryWhereItLands } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiPlace } from "../poiContract";
import { namingCultureNear, rulePlaces } from "../poiPlaces";
import { ruleRecord } from "../poiRecords";
import { adjacent, celsiusAt, geothermalAt, heldFor, iceAt, hasChannel, magicRule } from "../poiReads";
import { weighed } from "../poiVisibilityRules";
import {
  borders,
  countryCounterpart,
  countryFactors,
  hazardReach,
  meanOver,
  movesOrGoes,
  quickeningAt,
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
const isA = magicRule("fire", "halo");
const places = rulePlaces("thawedHalo", "fire", "halo");
const factors = countryFactors(places, typicalArea, celsiusAt);
const counterpart = countryCounterpart(isA);
const unrealized = movesOrGoes(counterpart);
const scar = magicRule("fire", "scar");

/** Whether ice lies at the rim of a place: only then is it a way through frozen country. */
const inFrozenCountry = (state: GenerationState, place: PoiPlace) =>
  heldFor(state, `halo-rim:${place.id}`, () =>
    place.cells.some((cell) =>
      [...adjacent(state, cell)].some((next) => iceAt(state, next) > frozenIce)
    )
  );

export const thawedHalo: PoiEntry = {
  id: "thawedHalo",
  group: "cover",
  name: "Thawed halo",
  recognition: {
    distinct:
      "Land marked by Fire's halo rule, and nothing else: the rule is the definition. Fire's intensity holds the country open at a temperature it can keep thawed, growing outward along fractured ground. It is unlike a thermal vein, which needs far more fracture and may run under it, or a hot spring, which needs wet ground or geothermal heat. Trees or meadow on it are a landscape beneath it, not part of its test.",
    isA,
  },
  existence: {
    statement:
      "Emerges as Fire's propagated heat holds country open around a conduit, crater or forge. What grows on it is its own landscape: an ember grove, a thaw meadow, or bare ground.",
    way: "emerges",
    requires: notApplicable(
      "Its requirement is the rule itself: Fire's intensity at a temperature it can hold open."
    ),
    suitability: notApplicable("Fire's propagation decides its reach; nothing chooses a site."),
    places,
  },
  publication: {
    statement: "Published as Fire's halo on the magic layer, outlined by the rule's coverage.",
    moment: "magic",
    record: ruleRecord("fire", "halo"),
  },
  fields: {
    statement:
      "Fire's heat keeps ice off this ground, so meltwater runs and rivers leave it warm; the air over it stays warmer than the country around, and life runs faster and burns more readily through quickening. Every one of those is written by Fire's intensity wherever it reaches, halo or not, so the place writes none.",
    terrain: notApplicable(
      "It lifts and cuts nothing; Fire's rock hardening is written by intensity."
    ),
    water: notApplicable(
      "Magic's feedback melts the ice by intensity and river warmth carries the heat forcing downstream, each over the whole field."
    ),
    climate: notApplicable("Magic's feedback writes the heat forcing over the whole field."),
    cover: notApplicable(
      "Quickening already is cover's own forcing: turnover and fire run faster in the ecology."
    ),
    magic: notApplicable("Magic's feedback writes quickening over the whole field by intensity."),
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
    schedule: notApplicable("A halo does nothing at refinement's other points."),
  },
  movement: {
    statement:
      "In frozen country a halo is the way through: roads run cheaper on ground with no ice, boats find rivers open, and a route can cross ice country by way of it. On country that was never frozen it changes nothing.",
    roads: (state, place) =>
      inFrozenCountry(state, place)
        ? place.cells.map((cell) => ({ cell, factor: thawedRoad }))
        : [],
    boats: (state, place) =>
      inFrozenCountry(state, place)
        ? place.cells
            .filter((cell) => hasChannel(state, cell))
            .map((cell) => ({ cell, factor: openReach }))
        : [],
    drainage: notApplicable(
      "Fire melts the ice before the network runs on the ground, so what it finds is ordinary ground at no special cost."
    ),
    magic: notApplicable(
      "Fire travels by fracture and crust, whose costs the halo does not change: a halo is what that carriage has already reached."
    ),
    links: notApplicable("A halo joins no two cells."),
    crosses: (state, place) => (inFrozenCountry(state, place) ? ["ice"] : []),
  },
  others: {
    statement:
      "It shares no ground with a lake or with wild ground. A vein or hot spring may lie in it, and an ember grove or thaw meadow grows on it; its rim pairs with the melt line, where ice gives out, and bands camp at its edge.",
    needs: notApplicable(
      "Its rule reads Fire's intensity directly, which a vein, a crater or a forge may each raise."
    ),
    excludes: sharesNoGround("wildZone", "lake"),
    contains: standsIn("thermalVein", "spring", "emberGrove", "thawMeadow"),
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
      "A halo is mostly a matter of contrast: a thawed country in polar ice is one of the great sights of a map, and the same warmth in the tropics weighs little. Local warmth outweighs size, and a town at its edge carries it.",
    ...factors,
    importance: weighed(factors, { magnitude: 0.25, localConditions: 0.55, isolation: 0.2 }),
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
