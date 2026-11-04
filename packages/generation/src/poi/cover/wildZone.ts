import { units } from "../../canonry/math";
import { hashUnit } from "../../canonry/noise";
import type { GenerationState } from "../../process";
import { carryWhereItLands } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiFieldChange, type PoiPlace } from "../poiContract";
import { namingCultureNear, regionPlaces, within } from "../poiPlaces";
import { cellSpan, fieldOf, isRiver } from "../poiReads";
import { drawnWhen } from "../poiVisibilityRules";
import {
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

/** Area at which a wild zone is half as great as they get: 1,000 square kilometres. */
const typicalArea = 1e9;
/** The per-cell hash the regional Veil writes use, so relief does not ratchet between rounds. */
const shiftHash = 0x7e11;
/** Verdure past which Greenwood has knit the ground and the strain has nothing to tear. */
const knitFrom = 0.5;
const isA = isKind("wildZone");
const veil = (state: GenerationState) =>
  state.physical?.magic?.fields.find((f) => f.definition.id === "veil");
const wildAt = (state: GenerationState, cell: number) => veil(state)?.wild.get(cell) ?? 0;
const places = regionPlaces("wildZone", isA, wildAt);
const factors = countryFactors(places, typicalArea, wildAt);
const counterpart = countryCounterpart(isA);
const unrealized = movesOrGoes(counterpart);
const shift = (cell: number) => hashUnit(shiftHash, cell, 0) - 0.5;

/** The bedrock it moves, by Veil's own bound and hash. */
function moved(state: GenerationState, place: PoiPlace): PoiFieldChange[] {
  const relief = veil(state)?.definition.parameters.wildRelief ?? 0;
  return place.cells.map((cell) => ({
    change: "add",
    band: "Elevation",
    cell,
    amount: units(relief * wildAt(state, cell) * 2 * shift(cell)),
  }));
}
/** The cover it exchanges: grass to broadleaf on one hash, trees to grass on the other. */
function exchanged(state: GenerationState, place: PoiPlace): PoiFieldChange[] {
  const map = fieldOf(state),
    shuffle = veil(state)?.definition.parameters.wildShuffle ?? 0;
  return place.cells.flatMap((cell): PoiFieldChange[] => {
    const share = shuffle * wildAt(state, cell);
    if (shift(cell) > 0) {
      const taken = map.GrassCover.get(cell) * share;
      return [
        { change: "add", band: "GrassCover", cell, amount: -taken },
        { change: "add", band: "BroadleafCover", cell, amount: taken },
      ];
    }
    const broadleaf = map.BroadleafCover.get(cell) * share,
      conifer = map.ConiferCover.get(cell) * share;
    return [
      { change: "add", band: "BroadleafCover", cell, amount: -broadleaf },
      { change: "add", band: "ConiferCover", cell, amount: -conifer },
      { change: "add", band: "GrassCover", cell, amount: broadleaf + conifer },
    ];
  });
}
const doorReach = (state: GenerationState) => 2 * cellSpan(state);
/** Ground that moved has no road on it worth trusting, in proportion to how far it moved. */
const unsteady = (state: GenerationState, cell: number) => 1 + wildAt(state, cell);

export const wildZone: PoiEntry = {
  id: "wildZone",
  group: "cover",
  name: "Wild zone",
  recognition: {
    distinct:
      "Land marked by Veil's wild rule: the wild share of a tear at least 0.3, at Veil intensity of at least 100. It is how much the tear has moved since the last epoch, not how strong it is: a tear is strength (intensity of 300) and may be perfectly still, and a door needs wild under 0.1, so a door can never stand here. Its cover is whatever it has shuffled to and does not decide it.",
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
  fields: {
    statement:
      "Wild ground moves: its bedrock rises and falls by a hashed share of Veil's relief, so streams change course, and it swaps trees and grass so a forest edge shifts with no fire or flood behind it. It keeps the tear open through its own Tearing. Water and air only answer the moved ground. These restate Veil's writes: wiring them replaces those writes and never adds to them.",
    terrain: moved,
    water: notApplicable(
      "It stores and takes no water: streams change course because the bedrock moved, and the drainage reads that."
    ),
    climate: notApplicable(
      "Veil's only heat change is the chill at a door's cell, which is the door's own; shifting ground carries none."
    ),
    cover: exchanged,
    magic: floorsHeld("Tearing"),
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
  },
  movement: {
    statement:
      "Roads and boats pay in proportion to how far the ground has moved, since a way laid across it may not be there next time. Streams find their own way across it, and other systems' carriers do not read wildness.",
    roads: onPlace(unsteady),
    boats: (state, place, cell) =>
      isRiver(state, cell) ? onPlace(unsteady)(state, place, cell) : 1,
    drainage: notApplicable(
      "The hashed relief sends streams new ways; the network finds them with no cost term of its own."
    ),
    magic: notApplicable(
      "Veil's tears propagate only locally and no other system's carrier reads wildness, so no carrier's cost changes here."
    ),
    crosses: notApplicable("Moving ground offers no reliable crossing of anything."),
  },
  others: {
    statement:
      "It shares no ground with ordinary cover or a halo, and a door cannot stand on or beside it. Most wild zones lie on tears, which are its source.",
    needs: notApplicable(
      "Its rule reads Veil's field itself: a named tear is the same strain, stronger, and need not be there."
    ),
    excludes: [
      ...sharesNoGround("forest", "grassland", "barren", "thawedHalo", "clearance", "lake"),
      { kind: "door", holds: within(doorReach) },
    ],
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
      "A wild zone shows by how much it moved against the ground around, then by its size: a small, violently shifting patch matters more than a broad, faint one. A town that lives beside one carries it.",
    ...factors,
    visibleAt: drawnWhen(factors, { magnitude: 0.3, localConditions: 0.5, isolation: 0.2 }),
  },
  naming: {
    statement: "Named by the people nearest, who usually name it as a warning.",
    namedBy: namingCultureNear,
    takesNameFrom: notApplicable("It moves too much to borrow a name from what stands beside it."),
    lendsNameTo: notApplicable("No one names a town after ground they cannot trust."),
  },
};
