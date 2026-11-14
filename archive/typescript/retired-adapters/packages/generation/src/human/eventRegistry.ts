import type { GenerationState } from "../process";
import { runMemory } from "../runMemory";
import type { PhysicalField } from "../world/field";
import { humanLayersOf } from "./humanLayers";
import { leading } from "./identityReads";
import { knownPlaces, type KnownPlace } from "./placeRegistry";
import { entityOf } from "./traditions";

/**
 * What befell the places of a map, read from the land at the end of each era: a famine where
 * a town's worth of people died on a place's ground within the era, a disaster where one of the
 * land's hazards struck it, and a siege where a place passed from one realm's hold to
 * another's. The deaths and the allegiance are the layers';
 * this is the run's memory of when they turned, so the map can show where history happened.
 */
export interface KnownEvent {
  readonly id: string;
  /** `famine`, `siege`, or the kind of the hazard that struck. */
  readonly kind: string;
  readonly era: string;
  /** The place it befell and the cell that place then stood on. */
  readonly place: string;
  readonly cell: number;
  /** Those who died on the place's ground in the era, and its townsfolk when it happened. */
  readonly casualties: number;
  readonly townsfolk: number;
  /** Its weight among events of its kind, from nothing to one. */
  readonly magnitude: number;
  readonly causes: readonly string[];
}
interface Events {
  next: number;
  known: KnownEvent[];
  /** The dead the land counted on every cell when the events were last read. */
  deadBefore?: Float64Array;
  /** The realm that held each place when last read. */
  held: Record<string, number>;
  era?: string;
}
const events = (state: GenerationState) =>
  runMemory<Events>(state, "human.events", () => ({ next: 0, known: [], held: {} }));
export const knownEvents = (state: GenerationState): readonly KnownEvent[] => events(state).known;

function record(memory: Events, event: Omit<KnownEvent, "id">) {
  memory.known.push({ id: `event:${memory.next++}`, ...event });
}
/** Remember something that befell a place. */
export const recordEvent = (state: GenerationState, event: Omit<KnownEvent, "id">) =>
  record(events(state), event);
/** The era whose events were last read, if any has been. */
export const lastEra = (state: GenerationState) => events(state).era;
/** Everyone the land counts as having died on a place's ground. */
export function deadOn(map: PhysicalField, place: KnownPlace) {
  let dead = 0;
  for (const cell of place.cells) dead += map.MassDeath.get(cell);
  return dead;
}
/** A famine, where at least a town's people died on the place's ground since it was last read. */
function famine(memory: Events, map: PhysicalField, place: KnownPlace, era: string, town: number) {
  // The first reading of a map has no earlier count to measure against.
  const before = memory.deadBefore;
  if (!before) return;
  // Measured cell by cell on the ground the place now stands on, so ground a place grew over
  // does not bring its older dead with it.
  let died = 0;
  for (const cell of place.cells) died += Math.max(0, map.MassDeath.get(cell) - before[cell]);
  if (died < town) return;
  const casualties = Math.round(died),
    townsfolk = Math.round(Math.max(place.townPeople, place.peak));
  record(memory, {
    kind: "famine",
    era,
    place: place.id,
    cell: place.anchor,
    casualties,
    townsfolk,
    magnitude: casualties / (casualties + townsfolk),
    causes: [
      `${era}: the country around this place could not feed those who lived on it, and ${casualties} died here.`,
    ],
  });
}
/** A siege, where the realm most of a living place's people hold with has changed. */
function siege(state: GenerationState, map: PhysicalField, place: KnownPlace, era: string) {
  const memory = events(state),
    column = humanLayersOf(map).column(place.anchor),
    [realm, holding] = leading(column, "allegiance"),
    before = memory.held[place.id];
  if (realm) memory.held[place.id] = realm;
  if (!realm || !before || before === realm || place.abandoned) return;
  const name = (code: number) => entityOf(state, code)?.name ?? "another realm",
    everyone = column.reduce((sum, layer) => sum + layer.people, 0),
    share = everyone > 0 ? holding / everyone : 0;
  record(memory, {
    kind: "siege",
    era,
    place: place.id,
    cell: place.anchor,
    casualties: 0,
    townsfolk: Math.round(place.townPeople),
    magnitude: share,
    causes: [`${era}: this place passed from the hold of ${name(before)} to ${name(realm)}.`],
  });
}
/**
 * Read what befell each known place in the era just lived. The hunger of the era is read
 * first; then `strike` lets the land's hazards fall on the place, which records its own
 * events; the dead are counted again so the next era measures from here.
 */
export function recordEraEvents(
  state: GenerationState,
  setting: { map: PhysicalField; era: string; town: number },
  strike: (place: KnownPlace) => void
) {
  const memory = events(state),
    { map, era, town } = setting;
  memory.era = era;
  for (const place of knownPlaces(state)) {
    if (place.absorbedBy) continue;
    famine(memory, map, place, era, town);
    if (!place.abandoned) strike(place);
    siege(state, map, place, era);
  }
  const counted = new Float64Array(map.mesh.count);
  for (let cell = 0; cell < counted.length; cell++) counted[cell] = map.MassDeath.get(cell);
  memory.deadBefore = counted;
}
