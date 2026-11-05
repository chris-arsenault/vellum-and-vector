import type { GenerationState } from "../process";
import type { RegionalState } from "../regional/state";
import type { AreaEntry, AreaPlace } from "../area/areaContract";
import { areaCatalogue } from "../area/catalogue";
import { poiCatalogue } from "./catalogue";
import type { PoiEntry, PoiPlace, PoiRelation } from "./poiContract";
import { releaseHeld } from "./poiReads";
import { placesOf } from "./poiPublish";

/** Places of a kind each function is called on; enough to exercise it, not to measure it. */
const sampled = 50;

/** What one kind's rules did on a real state: what they found, what shows, what failed. */
export interface KindExercise {
  group: string;
  places: number;
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
    ["variety.of", entry.variety && "of" in entry.variety ? entry.variety.of : null, onPlace],
    ["appearance", entry.appearance, onPlace],
    ["account", entry.account, onPlace],
    ["naming.term", naming.term, onPlace],
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
function exerciseKind(entry: PoiEntry, state: GenerationState): KindExercise {
  const started = performance.now(),
    failures = new Set<string>();
  let places: readonly PoiPlace[] = [];
  try {
    places = placesOf(state, entry);
    // Spaced through the list, so a sample is not just one corner of the map.
    const step = Math.max(1, Math.floor(places.length / sampled)),
      sample = places.filter((_, k) => k % step === 0).slice(0, sampled);
    for (const place of sample) {
      run(placeCalls(entry, state, place), failures);
      run(refinedCalls(entry, state, place), failures);
    }
  } catch (error) {
    failures.add(`existence.places: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    group: entry.group,
    places: places.length,
    milliseconds: Math.round(performance.now() - started),
    failures: [...failures],
  };
}
/** Every rule of an area entry that answers one, run on each of its areas here. */
function exerciseArea(entry: AreaEntry, state: GenerationState): KindExercise {
  const started = performance.now(),
    failures = new Set<string>(),
    { areas } = entry.existence;
  const attempt = (name: string, call: () => unknown) => {
    try {
      return call();
    } catch (error) {
      failures.add(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  };
  const found =
    typeof areas === "function"
      ? ((attempt("existence.areas", () => areas(state)) as readonly AreaPlace[] | undefined) ?? [])
      : [];
  const { people, visibility, time } = entry;
  const onArea: [string, unknown][] = [
    ["people.offers", people.offers],
    ["visibility.importance", visibility.importance],
    ["time.fate", time.fate],
  ];
  for (const place of found)
    for (const [name, rule] of onArea)
      if (typeof rule === "function") attempt(name, () => rule(state, place));
  return {
    group: entry.form,
    places: found.length,
    milliseconds: Math.round(performance.now() - started),
    failures: [...failures],
  };
}
/** Every rule of every kind run on a real state. It reports what happened and decides nothing. */
export function exerciseCatalogue(state: GenerationState): Record<string, KindExercise> {
  releaseHeld(state);
  const result: Record<string, KindExercise> = {};
  for (const entry of Object.values(poiCatalogue)) result[entry.id] = exerciseKind(entry, state);
  for (const entry of Object.values(areaCatalogue))
    result[`area:${entry.id}`] = exerciseArea(entry, state);
  releaseHeld(state);
  return result;
}
