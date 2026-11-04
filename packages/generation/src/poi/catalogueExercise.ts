import { placeDrawn } from "@atlas/domain";
import type { GenerationState } from "../process";
import type { RegionalState } from "../regional/state";
import { poiCatalogue } from "./catalogue";
import type { PoiEntry, PoiPlace, PoiRelation } from "./poiContract";
import { fieldOf, releaseHeld } from "./poiReads";
import { placesOf } from "./poiPublish";

/** Places of a kind each function is called on; enough to exercise it, not to measure it. */
const sampled = 50;

/** What one kind's rules did on a real state: what they found, what shows, what failed. */
export interface KindExercise {
  group: string;
  places: number;
  /** Of the places sampled, how many are drawn at the whole map, a quarter of it and close up. */
  drawn: { sampled: number; whole: number; quarter: number; close: number };
  milliseconds: number;
  /** Each failure as `role.field: message`. */
  failures: string[];
}

type Call = [string, unknown, (fn: never) => unknown];

const relationCalls = (name: string, relations: unknown, state: GenerationState, p: PoiPlace) =>
  Array.isArray(relations)
    ? (relations as PoiRelation[]).map((relation): Call => [
        name,
        relation,
        () => relation.holds(state, p, p),
      ])
    : [];

function movementCalls(entry: PoiEntry, state: GenerationState, p: PoiPlace): Call[] {
  const onPlace = (fn: never) => (fn as (s: GenerationState, q: PoiPlace) => unknown)(state, p),
    { roads, boats, magic, links, crosses } = entry.movement,
    carriers = "slot" in magic ? [] : Object.entries(magic);
  return [
    ["movement.roads", roads, onPlace],
    ["movement.boats", boats, onPlace],
    ["movement.links", links, onPlace],
    ["movement.crosses", crosses, onPlace],
    ...carriers.map(([carrier, list]): Call => [`movement.magic.${carrier}`, list, onPlace]),
  ];
}
function placeCalls(entry: PoiEntry, state: GenerationState, p: PoiPlace): Call[] {
  const onPlace = (fn: never) => (fn as (s: GenerationState, q: PoiPlace) => unknown)(state, p),
    onCell = (fn: never) => (fn as (s: GenerationState, c: number) => unknown)(state, p.anchor);
  const { fields, people, time, visibility, naming, others, existence, recognition } = entry;
  return [
    ["recognition.isA", recognition.isA, onCell],
    ["existence.requires", existence.requires, onCell],
    ["existence.suitability", existence.suitability, onCell],
    ["publication.record", entry.publication.record, onPlace],
    ["fields.terrain", fields.terrain, onPlace],
    ["fields.water", fields.water, onPlace],
    ["fields.climate", fields.climate, onPlace],
    ["fields.cover", fields.cover, onPlace],
    ["fields.magic", fields.magic, onPlace],
    ...movementCalls(entry, state, p),
    ["people.offers", people.offers, onPlace],
    ["people.threatens", people.threatens, onPlace],
    ["time.fate", time.fate, onPlace],
    ["visibility.magnitude", visibility.magnitude, onPlace],
    ["visibility.localConditions", visibility.localConditions, onPlace],
    ["visibility.isolation", visibility.isolation, onPlace],
    ["visibility.cultural", visibility.cultural, onPlace],
    ["visibility.importance", visibility.importance, onPlace],
    ["naming.namedBy", naming.namedBy, onPlace],
    ...relationCalls("others.needs", others.needs, state, p),
    ...relationCalls("others.excludes", others.excludes, state, p),
    ...relationCalls("others.contains", others.contains, state, p),
    ...relationCalls("others.pairsWith", others.pairsWith, state, p),
    ...relationCalls("naming.takesNameFrom", naming.takesNameFrom, state, p),
    ...relationCalls("naming.lendsNameTo", naming.lendsNameTo, state, p),
  ];
}
/** A refined map also answers what a captured place does on it. */
function refinedCalls(entry: PoiEntry, state: GenerationState, p: PoiPlace): Call[] {
  if (!("regional" in state) || !p.feature) return [];
  const region = state as RegionalState,
    carried = { feature: p.feature, cell: p.anchor, cells: p.cells },
    { carry, realize, counterpart, unrealized, settle } = entry.acrossMaps,
    withCarried = (fn: never) =>
      (fn as (s: RegionalState, c: typeof carried) => unknown)(region, carried);
  return [
    [
      "acrossMaps.carry",
      carry,
      (fn: never) => (fn as (s: RegionalState, f: typeof p.feature) => unknown)(region, p.feature),
    ],
    ["acrossMaps.realize", realize, withCarried],
    ["acrossMaps.counterpart", counterpart, withCarried],
    ["acrossMaps.unrealized", unrealized, withCarried],
    ["acrossMaps.settle", settle, withCarried],
    [
      "movement.drainage",
      entry.movement.drainage,
      (fn: never) => (fn as (s: GenerationState, q: PoiPlace) => unknown)(state, p),
    ],
  ];
}
function run(calls: Call[], failures: Set<string>) {
  for (const [name, fn, call] of calls) {
    if (typeof fn !== "function" && !name.startsWith("others") && !name.startsWith("naming."))
      continue;
    if (typeof fn === "object" && fn !== null && "slot" in fn) continue;
    try {
      call(fn as never);
    } catch (error) {
      failures.add(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
function drawnAt(entry: PoiEntry, state: GenerationState, places: readonly PoiPlace[]) {
  const weigh = entry.visibility.importance,
    mesh = fieldOf(state).mesh,
    width = mesh.bounds[2] - mesh.bounds[0],
    weights =
      typeof weigh === "function"
        ? places.map((place) =>
            (weigh as (s: GenerationState, q: PoiPlace) => number)(state, place)
          )
        : [],
    count = (metresPerPixel: number) =>
      weights.filter((weight) => placeDrawn(weight, width, metresPerPixel)).length;
  return {
    sampled: places.length,
    whole: count(width / 1600),
    quarter: count(width / 6400),
    close: count(width / 51200),
  };
}
function exerciseKind(entry: PoiEntry, state: GenerationState): KindExercise {
  const started = performance.now(),
    failures = new Set<string>(),
    empty = { sampled: 0, whole: 0, quarter: 0, close: 0 };
  let places: readonly PoiPlace[] = [],
    drawn = empty;
  try {
    places = placesOf(state, entry);
    // Spaced through the list, so a sample is not just one corner of the map.
    const step = Math.max(1, Math.floor(places.length / sampled)),
      sample = places.filter((_, k) => k % step === 0).slice(0, sampled);
    for (const place of sample) {
      run(placeCalls(entry, state, place), failures);
      run(refinedCalls(entry, state, place), failures);
    }
    drawn = drawnAt(entry, state, sample);
  } catch (error) {
    failures.add(`existence.places: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    group: entry.group,
    places: places.length,
    drawn,
    milliseconds: Math.round(performance.now() - started),
    failures: [...failures],
  };
}
/** Every rule of every kind run on a real state. It reports what happened and decides nothing. */
export function exerciseCatalogue(state: GenerationState): Record<string, KindExercise> {
  releaseHeld(state);
  const result: Record<string, KindExercise> = {};
  for (const entry of Object.values(poiCatalogue)) result[entry.id] = exerciseKind(entry, state);
  releaseHeld(state);
  return result;
}
