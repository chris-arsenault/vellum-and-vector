import type { GenerationState } from "../process";
import type { PhysicalField } from "../world/field";
import { humanLayersOf } from "./humanLayers";
import { leading } from "./identityReads";
import { knownWays, type KnownWay } from "./placeCountry";
import { knownPlaces, type KnownPlace } from "./placeRegistry";

/**
 * Where realms meet. A frontier is a way whose two ends different realms hold: the places at
 * its ends keep that line, and fighting between the realms would fall along it.
 */
export interface FrontierWay {
  way: KnownWay;
  /** The places at its ends and the realm most people hold with at each, by tradition code. */
  ends: [KnownPlace, KnownPlace];
  held: [number, number];
}
const realmAt = (map: PhysicalField, cell: number) =>
  leading(humanLayersOf(map).column(cell), "allegiance")[0];

export function frontierWays(state: GenerationState, map: PhysicalField): FrontierWay[] {
  const places = new Map(knownPlaces(state).map((place) => [place.id, place]));
  return knownWays(state).flatMap((way): FrontierWay[] => {
    const a = places.get(way.from),
      b = places.get(way.to);
    if (!a || !b) return [];
    const held: [number, number] = [realmAt(map, a.anchor), realmAt(map, b.anchor)];
    return held[0] && held[1] && held[0] !== held[1] ? [{ way, ends: [a, b], held }] : [];
  });
}
