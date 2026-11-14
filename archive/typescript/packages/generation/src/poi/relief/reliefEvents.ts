import { canonicalPosition, point, spatial, type AtlasFeature } from "@atlas/domain";
import type { PhysicalField } from "../../world/field";
import { eventDisk } from "../../world/geologicalFeatures";
import { nearestTriangle } from "../../world/mesh";
import { generatedFeature } from "../../mapFeatures";
import type { GenerationState } from "../../process";
import type { PoiPlace } from "../poiContract";
import type { PoiKindId } from "../poiKinds";
import { cellsWithin, fieldOf, heldFor } from "../poiReads";

/** A volcano or impact the generator recorded as it happened. */
export type MapEvent = PhysicalField["events"][number];
type Places = (state: GenerationState) => readonly PoiPlace[];

/**
 * Places of a kind read from the generator's recorded events: each event that still stands
 * covers the cells within its reach. Nothing here re-derives where an event happened.
 */
export const eventPlaces =
  (
    kind: PoiKindId,
    stands: (state: GenerationState, event: MapEvent) => boolean,
    reach: (event: MapEvent) => number,
    suffix = ""
  ): Places =>
  (state) =>
    heldFor(state, `relief:events:${kind}`, () => {
      const map = fieldOf(state),
        mesh = map.mesh,
        found = new Map<string, PoiPlace>();
      for (const event of map.events) {
        if (found.has(event.id) || !stands(state, event)) continue;
        const anchor = nearestTriangle(mesh, event.x, event.y),
          cells = cellsWithin(state, anchor, reach(event)).filter(
            (cell) => mesh.membership(cell) === 1
          );
        if (cells.length) found.set(event.id, { id: `${event.id}${suffix}`, kind, cells, anchor });
      }
      return [...found.values()];
    });

/** Whether a cell lies on a place from these lists. */
export const onPlaces =
  (key: string, places: Places) =>
  (state: GenerationState, cell: number): boolean =>
    heldFor(
      state,
      `relief:on:${key}`,
      () => new Set(places(state).flatMap((place) => [...place.cells]))
    ).has(cell);

/** The recorded event a place was read from, if it was. */
export const eventOf = (state: GenerationState, place: PoiPlace) =>
  fieldOf(state).events.find(
    (event) => place.id === event.id || place.id.startsWith(`${event.id}:`)
  );

interface EventRecord {
  kind: string;
  name: (event: MapEvent) => string;
  /** The record's radius, as a share of the event's. */
  share?: number;
  /** Whether it is located at its centre, with its disk as its footprint. */
  located?: boolean;
  attributes?: (state: GenerationState, event: MapEvent) => Record<string, unknown>;
}
/** The record of a place read from an event: its disk on the map, identified by the event. */
export const eventRecord =
  ({ kind, name, share = 1, located = false, attributes }: EventRecord) =>
  (state: GenerationState, place: PoiPlace): AtlasFeature | null => {
    const event = eventOf(state, place);
    if (!event) return null;
    const [x0, y0] = fieldOf(state).mesh.origin,
      center = canonicalPosition(state.domain.world.reference, {
        x: x0 + event.x,
        y: y0 + event.y,
        z: 0,
      }),
      radius = event.radius * share,
      shape = eventDisk(state, center, radius);
    if (!shape) return null;
    const feature = generatedFeature(state, place.id, name(event), kind, "geology", shape, {
      sourceAlgorithm: "atlas-1",
      causeId: event.id,
      radius,
      center,
      epoch: event.epoch,
      strength: event.strength,
      ...attributes?.(state, event),
    });
    if (located && spatial.intersects(point(center), state.domain.scope.footprint)) {
      feature.footprint = feature.geometry;
      feature.geometry = point(center);
    }
    return feature;
  };
