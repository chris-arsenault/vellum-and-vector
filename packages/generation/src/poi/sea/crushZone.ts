// @needsResolution carry: a carried place may not resolve on a finer map (ADR 0009).
import type { GenerationState } from "../../process";
import { carryWhereItLands, counterpartOf, goes, movesTo } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiFieldChange, type PoiPlace } from "../poiContract";
import { holds, rulePlaces, within } from "../poiPlaces";
import { ruleRecord } from "../poiRecords";
import { isSea, magicRule, toNative } from "../poiReads";
import { aloneAmong, attachment, sized, standsOut, weighed } from "../poiVisibilityRules";
import { areaOf, extentOf, namedFromShore, near, pressureAt, pressureLength } from "./seaShared";

/** Area at which a crush zone is half as great as they get: 10,000 square kilometres. */
const typicalArea = 1e10;
/** The sediment, in metres, a bed under no pressure at all could keep beneath a crush. */
const unpressedBed = 200;
/** Extra boat cost at full intensity: a surface crossing is possible but ruinous. */
const crushDrag = 6;

const isA = magicRule("pressure", "crush");
const places = rulePlaces("crushZone", "pressure", "crush");
/** The sea around a zone that bears on it: 100 km. */
const around = near(100_000);
const counterpart = counterpartOf(isA, 2);

const factors = {
  magnitude: sized(areaOf, typicalArea),
  localConditions: standsOut(pressureAt, around),
  isolation: aloneAmong(places, around),
  /** Divers' towns and pressure-practising countries know their zone from far off. */
  cultural: attachment((state) => 3 * around(state)),
};

/** Pressure limits what can lie on the bed, the less the stronger it is. */
const scoured = (state: GenerationState, place: PoiPlace): readonly PoiFieldChange[] =>
  place.cells
    .filter((cell) => isSea(state, cell))
    .map((cell) => ({
      change: "atMost",
      band: "SedimentThickness",
      cell,
      value: toNative(unpressedBed * (1 - pressureAt(state, cell))),
    }));

export const crushZone: PoiEntry = {
  id: "crushZone",
  group: "sea",
  name: "Crush zone",
  recognition: {
    distinct:
      "A member of Pressure's crush rule: intensity of at least 360, retained down to 270, with no other condition. An upwelling front also needs a shoal's lift, an interference lattice is weaker and broken by noise, and a wake or rogue impact is marked by its own channel at any intensity. Crush is simply where the rays pile highest.",
    isA,
  },
  existence: {
    statement:
      "Emerges where Pressure's rays overlap: around a locus, in basins whose coasts reflect them, and along rogue impacts' spokes. The system's own rule grows it; nothing chooses it.",
    way: "emerges",
    requires: notApplicable("Its test reads the intensity the rays leave."),
    suitability: notApplicable("No process chooses it; rays that reflect in a basin make it."),
    places,
  },
  publication: {
    statement: "Every zone publishes as the system's class, its outline by coverage.",
    moment: "magic",
    record: ruleRecord("pressure", "crush"),
  },
  fields: {
    statement:
      "A crush zone strips sediment from the bed. The surge that shuts harbours, its poison to sea life and its cut on the shore all come from the system's own intensity, read where each applies.",
    terrain: scoured,
    water: notApplicable(
      "The ocean current process writes wave exposure, and the society closes harbours and cuts catch by reading Pressure's intensity directly."
    ),
    climate: notApplicable(
      "Water moves only where a ray shoals, which is the front's work; over deep water the crush leaves the air alone."
    ),
    cover: notApplicable(
      "Open water has no cover; Pressure's animal toxicity reaches its fauna through ecology, and the fishery rule cuts a shore's catch beside it."
    ),
    magic: notApplicable("The rays make it; the intensity stands in the system's own field."),
  },
  acrossMaps: {
    statement:
      "A refined map does not retrace rays: the captured field stands and the crush rule is re-read on it, so the zone lands where the parent's intensity lies. If nothing there reaches the rule, it goes.",
    carry: carryWhereItLands,
    realize: notApplicable(
      "The captured intensity is the zone; the finer ground need not provide it."
    ),
    counterpart,
    unrealized: (state, carried) =>
      counterpart(state, carried) >= 0 ? movesTo(counterpart)(state, carried) : goes(),
    settle: notApplicable("A round's water does not change a captured ray field."),
    schedule: notApplicable("A captured crush zone does nothing to a refinement's schedule."),
  },
  movement: {
    statement:
      "Boats pay heavily in proportion to intensity, so routes bend around it; the society's harbours close beside it. Magic of other systems meets it through confluences, by share, and not by a carrier's cost.",
    roads: notApplicable("Rays paint only ocean cells; no crush lies on land for a road to pay."),
    boats: (state, place) =>
      place.cells.map((cell) => ({ cell, factor: 1 + crushDrag * pressureAt(state, cell) })),
    drainage: notApplicable("It lies in the sea, beyond where the drainage network ends."),
    magic: notApplicable(
      "Pressure's own rays are traced by geometry, and other systems meet it as confluences by share."
    ),
    links: notApplicable("A crush zone joins no two cells."),
    crosses: notApplicable(
      "It bars rather than opens; a boat crosses at a cost, not by its leave."
    ),
  },
  others: {
    statement:
      "A crush zone lies in reach of a locus or a rogue impact's spokes, may hold either, and borders the fronts where rays shoal. No harbour stands in one, because the surge closes it.",
    needs: notApplicable(
      "A locus's rays or a rogue impact's can raise it, so neither is required; its rule reads only intensity."
    ),
    excludes: [{ kind: "harbour", holds }],
    contains: [
      { kind: "pressureLocus", holds },
      { kind: "rogueWaveImpact", holds },
    ],
    pairsWith: [
      { kind: "upwellingFront", holds: within(around) },
      {
        kind: "pressureLocus",
        holds: within((state) => pressureLength(state, "rayDistance", 0)),
      },
      {
        kind: "rogueWaveImpact",
        holds: within((state) => pressureLength(state, "coastalRayDistance", 0)),
      },
    ],
  },
  people: {
    statement:
      "A crush zone gives divers charge, the raw material of Pressure's practice, and nothing else. It sinks hulls, cuts a shore's catch to three tenths and closes harbours beside it.",
    offers: (state, place) => ({ power: pressureAt(state, place.anchor) }),
    threatens: (state, place) => [
      {
        hazard: "crushing sea",
        reach: Math.max(around(state), extentOf(state, place)),
        severity: pressureAt(state, place.anchor),
      },
    ],
  },
  time: {
    statement:
      "A crush zone is renewed each evaluation from its locus and shifts as coasts change the rays' paths. When the system's rule no longer holds there it dissolves and leaves nothing lasting in the water.",
    fate: (state, place) => (isA(state, place.anchor) ? { fate: "persists" } : { fate: "ends" }),
  },
  visibility: {
    statement:
      "A crush zone shows by its extent and by how far it stands above the sea around it. The one a diving town works carries a small one, and an isolated zone counts less than these because it is seen by its danger, not its rarity.",
    ...factors,
    importance: weighed(factors, { magnitude: 0.5, localConditions: 0.35, isolation: 0.15 }),
  },
  naming: {
    statement: "Named only by people who sail or dive near it; the far ocean's zones go unnamed.",
    namedBy: namedFromShore((state) => 2 * around(state)),
    takesNameFrom: notApplicable("A crush zone is named for its danger, not for another place."),
    lendsNameTo: notApplicable("People do not name what they build after a place that sinks them."),
  },
};
