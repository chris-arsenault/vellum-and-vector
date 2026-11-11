import type { GenerationState } from "../process";
import { runMemory } from "../runMemory";
import type { Hinterland } from "./hinterlands";
import type { DenseZone } from "./placeClassifier";

/**
 * The places people have made on a map, kept by name while the dense zones they are read
 * from grow, shrink and move. The layers say where people are; this says which of those
 * crowds is the same town it was an era ago. It is the run's memory, never the source of
 * where anyone lives.
 */
export interface KnownPlace {
  readonly id: string;
  /** The densest cell of its zone when it was last seen inhabited. */
  anchor: number;
  /** The cells of its zone when it was last seen inhabited. */
  cells: number[];
  /** The era it was first seen in, and the era it was last seen empty in, if it is empty. */
  readonly founded: string;
  abandoned?: string;
  /** The tongue most of its people spoke when it was first seen, by tradition code. */
  tongue?: number;
  /** The place whose zone grew over it, which it has been part of since. */
  absorbedBy?: string;
  /** Its townsfolk now, the most it ever held, and everyone on its zone's cells. */
  townPeople: number;
  peak: number;
  people: number;
  builtKm2: number;
  works: number;
  /** The country that reaches it most cheaply, as it was last read while the place lived. */
  hinterland?: Hinterland;
}
interface Places {
  next: number;
  known: KnownPlace[];
  /** The townsfolk that make a town on this map, as the places were last recorded. */
  least: number;
}
const places = (state: GenerationState) =>
  runMemory<Places>(state, "human.places", () => ({ next: 0, known: [], least: 0 }));
export const knownPlaces = (state: GenerationState): readonly KnownPlace[] => places(state).known;
export const townSize = (state: GenerationState) => places(state).least;

/** How many of a place's cells, its anchor among them, lie on the given ground. */
function shared(place: KnownPlace, ground: ReadonlySet<number>) {
  let count = ground.has(place.anchor) ? 1 : 0;
  for (const cell of place.cells) if (cell !== place.anchor && ground.has(cell)) count++;
  return count;
}
/** The known places standing on a zone's ground, the one that most continues it first. */
function standingOn(zone: DenseZone, known: readonly KnownPlace[], taken: Set<string>) {
  const ground = new Set(zone.cells);
  return known
    .filter((place) => !taken.has(place.id) && !place.absorbedBy && shared(place, ground) > 0)
    .sort(
      (a, b) =>
        // A living town outranks an empty one; then the more shared ground; then the greater.
        Number(!a.abandoned) - Number(!b.abandoned) ||
        shared(a, ground) - shared(b, ground) ||
        a.peak - b.peak
    )
    .reverse();
}
function seen(place: KnownPlace, zone: DenseZone) {
  place.anchor = zone.anchor;
  place.cells = [...zone.cells];
  place.townPeople = zone.townPeople;
  place.people = zone.people;
  place.builtKm2 = zone.builtKm2;
  place.works = zone.works;
  place.peak = Math.max(place.peak, zone.townPeople);
  delete place.abandoned;
}
function emptied(place: KnownPlace, era: string) {
  place.abandoned = era;
  place.townPeople = 0;
  place.people = 0;
  place.builtKm2 = 0;
  delete place.hinterland;
}
function founded(memory: Places, anchor: number, era: string): KnownPlace {
  const place = {
    id: `place:${memory.next++}`,
    anchor,
    cells: [anchor],
    founded: era,
    townPeople: 0,
    peak: 0,
    people: 0,
    builtKm2: 0,
    works: 0,
  };
  memory.known.push(place);
  return place;
}
/**
 * The map's dense zones as they stand at the end of an era, matched to the places already
 * known. A zone that shares ground with a known place is that place: a living one while half
 * a town's people remain, an empty one once a town's people have returned. Other places on
 * the same zone have grown into it and are part of it from then on. A zone of at least
 * `least` townsfolk on new ground founds a place; a known place no zone continues is empty.
 * Zones arrive greatest first, so the greater crowd keeps the older name.
 */
export function recordPlaces(
  state: GenerationState,
  zones: readonly DenseZone[],
  era: string,
  least: number
) {
  const memory = places(state),
    taken = new Set<string>();
  memory.least = least;
  /** The place a zone is: the one on its ground if it lives or is resettled, or a new one. */
  const placeOf = (zone: DenseZone, first: KnownPlace | undefined) => {
    const town = zone.townPeople >= least;
    if (!first) return town ? founded(memory, zone.anchor, era) : undefined;
    return !first.abandoned || town ? first : undefined;
  };
  for (const zone of zones) {
    const [first, ...others] = standingOn(zone, memory.known, taken),
      place = placeOf(zone, first);
    if (!place) continue;
    seen(place, zone);
    taken.add(place.id);
    for (const other of others)
      if (!other.abandoned) {
        other.absorbedBy = place.id;
        taken.add(other.id);
      }
  }
  for (const place of memory.known)
    if (!taken.has(place.id) && !place.abandoned && !place.absorbedBy) emptied(place, era);
}
/**
 * Remains of built places on ground no known place stands on are recorded as places emptied
 * before anyone's memory of them, so the map shows them as ruins.
 */
export function recordRemains(
  state: GenerationState,
  sites: readonly { anchor: number; cells: readonly number[]; works: number; tongue: number }[],
  era: string
) {
  const memory = places(state),
    stood = new Set(memory.known.flatMap((place) => [place.anchor, ...place.cells]));
  for (const site of sites) {
    if (site.cells.some((cell) => stood.has(cell))) continue;
    const place = founded(memory, site.anchor, "an earlier age");
    place.cells = [...site.cells];
    place.works = site.works;
    // Remains keep the tongue of whoever built them, where the ground still says.
    if (site.tongue) place.tongue = site.tongue;
    emptied(place, era);
  }
}
