import { humanLayers } from "@atlas/domain";
import type { GenerationState } from "../process";
import { defineCommand, runOperation } from "../processOperation";
import { ask } from "../coupling/answers";
import type { PhysicalContext } from "../world/context";
import type { PhysicalField } from "../world/field";
import { meshDeltaX } from "../world/mesh";
import { reachedBy, travelFrom } from "./hinterlands";
import { humanLayersOf } from "./humanLayers";
import { leading, leadingOf } from "./identityReads";
import { overlayIdentity, renameTradition } from "./layerOperations";
import { knownPlaces, townSize, type KnownPlace } from "./placeRegistry";
import { foundTradition, knownTraditions, type Tradition } from "./traditions";

/**
 * Allegiance on the land. A realm is a tradition of allegiance with a seat at a known place.
 * Its hold spreads from the seat along the going, farther for a greater seat, and where it
 * reaches, people take the allegiance up over whatever they held, which stays beneath. A
 * town beyond every realm's reach founds its own. A seat that empties moves to the greatest
 * place still holding the allegiance. Territories are read from the column afterwards;
 * nothing here records who holds what.
 */
export interface RealmEra {
  state: GenerationState;
  map: PhysicalField;
  /** How the land is asked its shared questions in this era. */
  context: PhysicalContext;
  step: (from: number, to: number) => number;
  era: string;
  years: number;
  /** The travel over which a seat of ordinary size holds its country. */
  reach: number;
  /** How far this era's realms can hold what they reach, against an ordinary era's 1. */
  capacity: number;
  /** How many realms the map begins with. */
  realms: number;
}
/** Townsfolk, in towns' worth, above which a place beyond every realm founds its own. */
const seatSize = 4;
/** The share of a reached cell's people who take up the allegiance in a century. */
const submission = 0.5;
/** A challenger takes a cell another realm leads only by reaching it at under this share of the cost. */
const contest = 0.6;

const living = (state: GenerationState) =>
  knownPlaces(state)
    .filter((place) => !place.abandoned && !place.absorbedBy)
    .sort((a, b) => b.townPeople - a.townPeople || a.id.localeCompare(b.id));
/** The realms still standing. */
const realmsOf = (state: GenerationState) =>
  knownTraditions(state).filter((tradition) => tradition.kind === "allegiance" && !tradition.ended);
const position = (map: PhysicalField, cell: number) => ({
  x: map.mesh.origin[0] + map.mesh.x(cell),
  y: map.mesh.origin[1] + map.mesh.y(cell),
});
const apart = (map: PhysicalField, a: number, b: number) =>
  Math.hypot(meshDeltaX(map.mesh, map.mesh.x(a) - map.mesh.x(b)), map.mesh.y(a) - map.mesh.y(b));

function found({ state, map, era }: RealmEra, seat: KnownPlace, parent?: number) {
  const [tongue] = leading(humanLayersOf(map).column(seat.anchor), "tongue"),
    code = foundTradition(state, {
      kind: "allegiance",
      key: `seat:${seat.id}:${era}`,
      origin: position(map, seat.anchor),
      era,
      parent,
      tongue: tongue || undefined,
    });
  realmsOf(state).find((realm) => realm.code === code)!.seat = seat.id;
}
/** The realm a seat place already is the seat of. */
const seated = (state: GenerationState, place: KnownPlace) =>
  realmsOf(state).some((realm) => realm.seat === place.id);

/**
 * A realm whose seat emptied or grew into another place follows its people: to the place
 * that grew over its seat, or else to the greatest free town that still holds it. Where the
 * place that grew over its seat is another realm's seat, or no town holds it any longer, the
 * realm ends: its people hold the realm it joined, or what it broke from, or none.
 */
function reseat({ state, map, era }: RealmEra, realm: Tradition) {
  const places = knownPlaces(state),
    seat = places.find((place) => place.id === realm.seat);
  if (seat && !seat.abandoned && !seat.absorbedBy) return;
  const absorbing = seat?.absorbedBy
      ? places.find((place) => place.id === seat.absorbedBy)
      : undefined,
    joined = absorbing && realmsOf(state).find((other) => other.seat === absorbing.id),
    allegiance = leadingOf(map, "allegiance"),
    heir =
      absorbing ??
      living(state).find(
        (place) => allegiance.code[place.anchor] === realm.code && !seated(state, place)
      );
  if (heir && !joined) {
    realm.seat = heir.id;
    return;
  }
  const parent = realmsOf(state).find((other) => other.code === realm.parent);
  realm.seat = undefined;
  realm.ended = era;
  runOperation(map, renameTradition, {
    map,
    tradition: "allegiance",
    from: realm.code,
    to: { get: () => (joined ?? parent)?.code ?? 0 },
  });
}
/** The realms with a living seat, where each seat stands and how strongly it holds. */
function seats(state: GenerationState, capacity: number) {
  const places = new Map(knownPlaces(state).map((place) => [place.id, place])),
    least = Math.max(1, townSize(state));
  return realmsOf(state).flatMap((realm) => {
    const seat = realm.seat ? places.get(realm.seat) : undefined;
    return seat
      ? [{ realm, anchor: seat.anchor, strength: capacity * Math.sqrt(seat.townPeople / least) }]
      : [];
  });
}
/** The first realms: the greatest places that stand at least half a reach apart. */
function first(era: RealmEra, towns: readonly KnownPlace[]) {
  const chosen: KnownPlace[] = [];
  for (const town of towns) {
    if (chosen.length >= era.realms) break;
    if (chosen.every((other) => apart(era.map, town.anchor, other.anchor) >= era.reach / 2))
      chosen.push(town);
  }
  for (const seat of chosen) found(era, seat);
}
/** The first realms, at the greatest places that stand apart; later, towns beyond every reach. */
export const foundRealms = defineCommand(
  "human.realms.found",
  "event",
  (era: RealmEra) => {
    const { state, map, step, reach, capacity } = era,
      towns = living(state);
    if (!realmsOf(state).length) return first(era, towns);
    const held = seats(state, capacity),
      reached = reachedBy(
        map,
        held.map((seat) => seat.anchor),
        step,
        reach,
        held.map((seat) => seat.strength)
      ),
      allegiance = leadingOf(map, "allegiance"),
      great = seatSize * townSize(state);
    // An era raises no more new realms than the map began with, the greatest free towns first.
    let raised = 0;
    for (const town of towns) {
      if (raised >= era.realms) break;
      if (town.townPeople < great || reached[town.anchor] >= 0 || seated(state, town)) continue;
      // What its people held before, if anything, is what the new realm broke from.
      found(era, town, allegiance.code[town.anchor] || undefined);
      raised++;
    }
  },
  []
);
/**
 * The realm each cell falls to, as its code, or 0 where it keeps what it holds. A realm
 * keeps a cell it already leads unless another reaches the cell at well under the cost.
 */
function falling(map: PhysicalField, { step, reach }: RealmEra, held: ReturnType<typeof seats>) {
  const costs = held.map((seat) => travelFrom(map, seat.anchor, step, reach * seat.strength)),
    index = new Map(held.map((seat, at) => [seat.realm.code, at])),
    leading = leadingOf(map, "allegiance"),
    code = new Int32Array(map.mesh.count);
  for (let cell = 0; cell < map.mesh.count; cell++) {
    let best = -1;
    // A stronger seat's travel counts for less, as its reach is longer.
    const cost = (at: number) => costs[at][cell] / held[at].strength;
    for (let at = 0; at < held.length; at++)
      if (Number.isFinite(costs[at][cell]) && (best < 0 || cost(at) < cost(best))) best = at;
    if (best < 0) continue;
    const incumbent = index.get(leading.code[cell]),
      keeps =
        incumbent !== undefined &&
        Number.isFinite(costs[incumbent][cell]) &&
        cost(best) > contest * cost(incumbent);
    // Whoever holds the cell goes on drawing its people in: the incumbent consolidates.
    code[cell] = held[keeps ? incumbent : best].realm.code;
  }
  return code;
}
/** Each realm's hold spreads from its seat, and people within it take its allegiance up. */
export const spreadRealms = defineCommand(
  "human.realms.spread",
  "elapsed",
  (era: RealmEra) => {
    const { state, map, years, capacity } = era;
    for (const realm of realmsOf(state)) reseat(era, realm);
    const held = seats(state, capacity);
    if (!held.length) return;
    const code = falling(map, era, held),
      people = map[humanLayers.population],
      yielding = ask(map, "yielding", era.context),
      share = Math.min(1, submission * capacity * (years / 100));
    runOperation(map, overlayIdentity, {
      map,
      traditions: { allegiance: { get: (cell) => code[cell] } },
      people: {
        get: (cell) => (code[cell] ? people.get(cell) * share * yielding.get(cell) : 0),
      },
      hardness: 0,
    });
  },
  []
);
/** One era of allegiance: realms are founded where towns stand free, then each holds its reach. */
export const liveRealms = defineCommand(
  "human.realms.era",
  "elapsed",
  (era: RealmEra) => {
    runOperation(era.map, foundRealms, era);
    runOperation(era.map, spreadRealms, era);
  },
  []
);
