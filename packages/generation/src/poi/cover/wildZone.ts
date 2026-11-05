// @needsResolution carry: a carried place may not resolve on a finer map (ADR 0009).
import type { GenerationState } from "../../process";
import { carryWhereItLands } from "../poiCarry";
import { notApplicable, type PoiEntry } from "../poiContract";
import { namingCultureNear, rulePlaces, within } from "../poiPlaces";
import { ruleRecord } from "../poiRecords";
import { cellSpan, fieldOf, hasChannel, magicRule } from "../poiReads";
import { weighed } from "../poiVisibilityRules";
import {
  countryCounterpart,
  countryFactors,
  hazardReach,
  meanOver,
  movesOrGoes,
  sharesNoGround,
  spanOf,
  standsIn,
  withinOwn,
} from "./coverShared";

/** Area at which a wild zone is half as great as they get: 1,000 square kilometres. */
const typicalArea = 1e9;
/** Verdure past which Greenwood has knit the ground and the strain has nothing to tear. */
const knitFrom = 0.5;
const isA = magicRule("veil", "wild");
const veil = (state: GenerationState) =>
  state.physical?.magic?.fields.find((f) => f.definition.id === "veil");
const wildAt = (state: GenerationState, cell: number) => veil(state)?.wild.get(cell) ?? 0;
const places = rulePlaces("wildZone", "veil", "wild");
const factors = countryFactors(places, typicalArea, wildAt);
const counterpart = countryCounterpart(isA);
const unrealized = movesOrGoes(counterpart);
const doorReach = (state: GenerationState) => 2 * cellSpan(state);
/** Ground that moved has no road on it worth trusting, in proportion to how far it moved. */
const unsteady = (state: GenerationState, cell: number) => 1 + wildAt(state, cell);

export const wildZone: PoiEntry = {
  id: "wildZone",
  group: "cover",
  name: "Wild zone",
  recognition: {
    distinct:
      "Land marked by Veil's wild rule, and nothing else: the rule is the definition. It reads how much a tear has moved since the last epoch, not how strong it is: a tear is strength and may be perfectly still, and a door needs ground that hardly moved, so a door can never stand here. Its cover is whatever it has shuffled to and does not decide it.",
    isA,
  },
  existence: {
    statement:
      "Emerges where the strain between other magic systems shifts from one epoch to the next and Veil's tear moves with it. It keeps no history of its own: Veil stores nothing, so it is wherever the strain moved last.",
    way: "emerges",
    requires: notApplicable(
      "Its requirement is its rule: strain moving across land, with no other condition."
    ),
    suitability: notApplicable("The strain between systems sets it, and nothing chooses a site."),
    places,
  },
  publication: {
    statement:
      "Published as Veil's wild ground on the magic layer, outlined by the rule's coverage.",
    moment: "magic",
    record: ruleRecord("veil", "wild"),
  },
  fields: {
    statement:
      "Wild ground moves: its bedrock rises and falls by a hashed share of Veil's relief, so streams change course, and it swaps trees and grass so a forest edge shifts with no fire or flood behind it. Veil writes all of that on every land cell with any wild share, a wider ground than the rule marks, so the place writes none of it.",
    terrain: notApplicable(
      "Veil's writes move the bedrock on every land cell with a wild share, on world and refined maps alike."
    ),
    water: notApplicable(
      "It stores and takes no water: streams change course because the bedrock moved, and the drainage reads that."
    ),
    climate: notApplicable(
      "Veil's only heat change is the chill at a door's cell, which is the door's own; shifting ground carries none."
    ),
    cover: notApplicable(
      "Veil's writes exchange trees and grass on every land cell with a wild share."
    ),
    magic: notApplicable("Magic's feedback writes Tearing over the whole field by intensity."),
  },
  acrossMaps: {
    statement:
      "Veil's field and its wild share carry to the child, and regional Veil writes declare the same bounded relief each round on a fixed hash, so the zone moves with the field and does not ratchet. A carried zone takes the nearest wild ground as rounds change it, and goes if the finer ground holds none within two parent cells.",
    carry: carryWhereItLands,
    realize: notApplicable(
      "`declareVeilWrites` already declares the relief on wild cells each round; forcing it again would double it."
    ),
    counterpart,
    unrealized,
    settle: unrealized,
    schedule: notApplicable("A wild zone does nothing at refinement's other points."),
  },
  movement: {
    statement:
      "Roads and boats pay in proportion to how far the ground has moved, since a way laid across it may not be there next time. Streams find their own way across it, and other systems' carriers do not read wildness.",
    roads: (state, place) => place.cells.map((cell) => ({ cell, factor: unsteady(state, cell) })),
    boats: (state, place) =>
      place.cells
        .filter((cell) => hasChannel(state, cell))
        .map((cell) => ({ cell, factor: unsteady(state, cell) })),
    drainage: notApplicable(
      "The hashed relief sends streams new ways; the network finds them with no cost term of its own."
    ),
    magic: notApplicable(
      "Veil's tears propagate only locally and no other system's carrier reads wildness, so no carrier's cost changes here."
    ),
    links: notApplicable("Moving ground joins no two cells; a door does that."),
    crosses: notApplicable("Moving ground offers no reliable crossing of anything."),
  },
  others: {
    statement:
      "It shares no ground with a lake or a halo, and a door cannot stand on or beside it. Most wild zones lie on tears, which are its source.",
    needs: notApplicable(
      "Its rule reads Veil's field itself: a named tear is the same strain, stronger, and need not be there."
    ),
    excludes: [...sharesNoGround("thawedHalo", "lake"), { kind: "door", holds: within(doorReach) }],
    contains: standsIn("tear"),
    pairsWith: [{ kind: "tear", holds: withinOwn(spanOf) }],
  },
  people: {
    statement:
      "It offers only awe, to those drawn to it, and threatens everyone else with ground that will not be what it was: lost roads, drowned fields and moved landmarks.",
    offers: (state, place) => ({ sanctity: meanOver(state, place, wildAt) / 2 }),
    threatens: (state, place) => [
      {
        hazard: "shifting ground",
        reach: hazardReach(state, place),
        severity: meanOver(state, place, wildAt),
      },
    ],
  },
  time: {
    statement:
      "Nothing of it is stored, so it lasts only while strain keeps moving. Greenwood's verdure knits it shut and it ends; salted ground holds the tear at its last strength, so the movement stops and it becomes a still tear.",
    fate(state, place) {
      const map = fieldOf(state),
        salted = meanOver(state, place, (_s, cell) => map.Salting.get(cell)),
        knit = meanOver(state, place, (_s, cell) => map.Verdure.get(cell));
      if (salted > 0) return { fate: "becomes", kind: "tear" };
      return knit > knitFrom ? { fate: "ends" } : { fate: "persists" };
    },
  },
  visibility: {
    statement:
      "A wild zone weighs by how much it moved against the ground around, then by its size: a small, violently shifting patch matters more than a broad, faint one. A town that lives beside one carries it.",
    ...factors,
    importance: weighed(factors, { magnitude: 0.3, localConditions: 0.5, isolation: 0.2 }),
  },
  naming: {
    statement: "Named by the people nearest, who usually name it as a warning.",
    namedBy: namingCultureNear,
    takesNameFrom: notApplicable("It moves too much to borrow a name from what stands beside it."),
    lendsNameTo: notApplicable("No one names a town after ground they cannot trust."),
  },
};
