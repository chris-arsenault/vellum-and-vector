import { point, type AtlasFeature, type RelativeMeasure } from "@atlas/domain";
import { mapScale } from "../../worldSignificance";
import { generationFeatures } from "../../generationFeatures";
import { knownEvents, lastEra, type KnownEvent } from "../../human/eventRegistry";
import { frontierWays } from "../../human/placeFrontiers";
import { knownPlaces, standingPlace } from "../../human/placeRegistry";
import { entityOf } from "../../human/traditions";
import type { GenerationState } from "../../process";
import { regionalFeature, regionalId } from "../../regional/extraction/features";
import { positionOf } from "../../regional/lattice";
import { bridgeFlow, roadTravellers } from "../../regional/societyWays";
import type { RegionalState } from "../../regional/state";
import type { PoiPlace } from "../poiContract";
import type { PoiKindId } from "../poiKinds";
import { sitedPlaces } from "../poiPlaces";
import { featureCell, fieldOf, gap, heldFor, isLand } from "../poiReads";
import { onMappedRiver } from "../water/waterReads";
import {
  developed,
  isRefined,
  lazyPlace,
  localId,
  localRecord,
  onceWritten,
  settlementPlaces,
} from "./communityRecords";

type OnCell<T> = (state: GenerationState, cell: number) => T;

/**
 * Where works and events come from: what the land's own memory holds of them on a map that
 * lived its people, what the parent left on a refined map, and for works, the ground that
 * suits them. These build the record each place publishes as.
 */

/** What a kind needs in order to be sited by the ground, and what its record says. */
export interface SitedWork {
  /** The record's kind and layer, its fallback name and its reach in metres. */
  record: string;
  layer: string;
  label: string;
  radius: RelativeMeasure;
  /** The least distance between two, in metres. */
  spacing: RelativeMeasure;
  requires: OnCell<boolean>;
  suitability: OnCell<number>;
}
/** A work the land remembers people raising: where it stands and what its record adds. */
export interface RememberedWork {
  key: string;
  cell: number;
  attributes: Record<string, unknown>;
  causes: string[];
}
function nearestTown(state: GenerationState, cell: number) {
  let best: PoiPlace | undefined,
    reach = Infinity;
  for (const town of settlementPlaces(state)) {
    const d = gap(state, cell, town.anchor);
    if (d < reach) [best, reach] = [town, d];
  }
  return best;
}
function workFeature(
  state: GenerationState,
  shape: SitedWork,
  work: Pick<RememberedWork, "key" | "cell"> & Partial<RememberedWork>
) {
  const at = positionOf(fieldOf(state).mesh, work.cell),
    feature = localRecord(state, work.key, shape.label, shape.record, shape.layer, point(at), {
      workKind: shape.record,
      sited: true,
      site: at,
      seat: nearestTown(state, work.cell)?.id,
      radius: mapScale(state).resolveMeasure(shape.radius),
      magnitude: 1,
      condition: 1,
      maintained: true,
      ...work.attributes,
    });
  if (work.causes) feature.causes = work.causes;
  return feature;
}
function groundPlaces(
  state: GenerationState,
  kind: PoiKindId,
  shape: SitedWork,
  remembered: readonly PoiPlace[]
) {
  if (!state.physical) return [];
  const spacing = mapScale(state).resolveMeasure(shape.spacing),
    found = sitedPlaces(kind, shape.requires, shape.suitability, () => spacing)(state);
  return found
    .filter(({ anchor }) =>
      remembered.every((other) => other.anchor < 0 || gap(state, anchor, other.anchor) >= spacing)
    )
    .map(({ anchor }) => {
      const key = `${kind}:${anchor}`;
      return lazyPlace(kind, localId(state, key), anchor, () =>
        workFeature(state, shape, { key, cell: anchor })
      );
    });
}
/** A kind's places: the works of it the land remembers, and those the ground sites. */
export const workPlaces =
  (
    kind: PoiKindId,
    shape: SitedWork,
    remembered: (state: GenerationState) => readonly RememberedWork[] = () => []
  ) =>
  (state: GenerationState): readonly PoiPlace[] =>
    heldFor(state, `places:${kind}`, () => {
      if (!developed(state)) return [];
      const raised = (isRefined(state) ? [] : remembered(state)).map((work) =>
        lazyPlace(kind, localId(state, work.key), work.cell, () => workFeature(state, shape, work))
      );
      return [...raised, ...groundPlaces(state, kind, shape, raised)];
    });
/** A work's record; an authored record stands as authored. */
export function workRecord(state: GenerationState, place: PoiPlace): AtlasFeature | null {
  return place.feature?.state === "generated" ? onceWritten(state, place) : null;
}

/** The dead a famine needs before a map that lived its own people shows it. */
const shownToll = 10000;
/** The ground an event reached: the place it befell, as a radius in the map's own lengths. */
function reachOf(state: GenerationState, event: KnownEvent) {
  const cells = knownPlaces(state).find((place) => place.id === event.place)?.cells.length ?? 1;
  return fieldOf(state).mesh.spacing * Math.sqrt(cells / Math.PI);
}
function eventFeature(state: GenerationState, event: KnownEvent) {
  const feature = localRecord(
    state,
    event.id,
    `${event.kind} — ${event.era}`,
    "societyEvent",
    "historicalEvents",
    point(positionOf(fieldOf(state).mesh, event.cell)),
    {
      eventId: event.id,
      atPlace: localId(state, standingPlace(state, event.place)),
      eventKind: event.kind,
      era: event.era,
      radius: reachOf(state, event),
      casualties: event.casualties,
      displaced: 0,
      townsfolk: event.townsfolk,
      magnitude: event.magnitude,
    }
  );
  feature.causes = [...event.causes];
  return feature;
}
/** The events the parent left on this refined map: they stand as they were recorded. */
function capturedEvents(state: RegionalState, kind: PoiKindId, matches: (kind: string) => boolean) {
  return [...generationFeatures(state, { areaId: state.regional.input.areaId })]
    .filter((f) => f.kind === "societyEvent" && matches(String(f.attributes.eventKind ?? "")))
    .map((feature): PoiPlace => {
      const anchor = featureCell(state, feature);
      return { id: feature.id, kind, cells: anchor >= 0 ? [anchor] : [], anchor, feature };
    });
}
function rememberedEvents(
  state: GenerationState,
  kind: PoiKindId,
  matches: (kind: string) => boolean
) {
  return knownEvents(state)
    .filter((event) => matches(event.kind))
    .filter((event) => event.kind !== "famine" || event.casualties >= shownToll)
    .map((event) =>
      lazyPlace(kind, localId(state, event.id), event.cell, () => eventFeature(state, event))
    );
}
/** The events a kind stands for on this map, by the kind each event's record names. */
export const eventPlaces =
  (kind: PoiKindId, matches: (eventKind: string) => boolean) =>
  (state: GenerationState): readonly PoiPlace[] =>
    heldFor(state, `places:${kind}`, () => {
      if (!developed(state)) return [];
      const places = isRefined(state)
        ? capturedEvents(state, kind, matches)
        : rememberedEvents(state, kind, matches);
      return places.filter((place) => place.anchor >= 0 || !state.physical);
    });

function frontierFeature(
  state: GenerationState,
  key: string,
  era: string,
  anchor: number,
  names: string
) {
  const feature = localRecord(
    state,
    `event:${key}`,
    `Field of ${names}`,
    "societyEvent",
    "historicalEvents",
    point(positionOf(fieldOf(state).mesh, anchor)),
    {
      eventKind: "battle",
      era,
      radius: 0,
      casualties: 0,
      displaced: 0,
      magnitude: 0.5,
      sited: true,
    }
  );
  feature.causes = [`Held frontier between ${names}: the way between them is the way armies take.`];
  return feature;
}
/**
 * Fields where realms meet, on land midway along the ways that cross between them, the most
 * travelled ways first and each `spacing` metres from the last.
 */
export function frontierPlaces(state: GenerationState, kind: PoiKindId, spacing: number) {
  if (!state.physical || isRefined(state)) return [];
  const era = lastEra(state) ?? "Settlement",
    taken: number[] = [],
    places: PoiPlace[] = [],
    name = (code: number) => entityOf(state, code)?.name ?? "a realm";
  const ways = frontierWays(state, fieldOf(state)).sort(
    (x, y) => y.way.travellers - x.way.travellers
  );
  for (const { way, held } of ways) {
    const cell = way.cells[Math.floor(way.cells.length / 2)] ?? -1;
    if (cell < 0 || !isLand(state, cell) || taken.some((t) => gap(state, t, cell) < spacing))
      continue;
    taken.push(cell);
    const key = `frontier:${way.from}:${way.to}`;
    places.push(
      lazyPlace(kind, localId(state, `event:${key}`), cell, () =>
        frontierFeature(state, key, era, cell, `${name(held[0])} and ${name(held[1])}`)
      )
    );
  }
  return places;
}

/** Whether a way's crossing of a channel earns a bridge. */
const earnsBridge = (travellers: number, flow: number, threshold: number) =>
  travellers >= roadTravellers && flow >= threshold;
function crossingFeature(state: RegionalState, cell: number, travellers: number, bridge: boolean) {
  const map = state.physical.map,
    p = positionOf(map.mesh, cell),
    kind = bridge ? "bridge" : "ford";
  return regionalFeature(
    state,
    `crossing:${cell}`,
    kind,
    "transportSites",
    { type: "Point", coordinates: [p.x, p.y] },
    { workKind: kind, flow: map.FlowAccumulation.get(cell), travellers },
    bridge ? "Bridge" : "Ford"
  );
}
/**
 * Where a refined map's traced ways ford channels: a ford, or a bridge where a road meets a
 * sizeable river. A seat's own channel cell is no crossing. Nothing is crossed before the ways
 * are traced, and the World traces none.
 */
/** A way over a stream this map does not draw crosses nothing it shows. */
const crossesRiver = (state: GenerationState, cell: number) =>
  isLand(state, cell) && onMappedRiver(state, cell);
export const crossingsOf = (state: GenerationState) =>
  heldFor(state, "places:crossings", () => {
    const found = { ford: [] as PoiPlace[], bridge: [] as PoiPlace[] };
    const crossings = isRefined(state) ? state.regional.crossings : undefined;
    if (!isRefined(state) || !crossings) return found;
    const map = state.physical.map;
    for (let i = 0; i < map.mesh.count; i++) {
      if (crossings.crossed[i] <= 0 || crossings.seatCells.has(i) || !crossesRiver(state, i))
        continue;
      const travellers = Math.max(crossings.traffic[i], crossings.crossed[i]),
        bridge = earnsBridge(
          travellers,
          map.FlowAccumulation.get(i),
          map.scale.resolveMeasure(bridgeFlow)
        );
      found[bridge ? "bridge" : "ford"].push(
        lazyPlace(bridge ? "bridge" : "ford", regionalId(state, `crossing:${i}`), i, () =>
          crossingFeature(state, i, travellers, bridge)
        )
      );
    }
    return found;
  });
export const fordPlaces = (state: GenerationState) => crossingsOf(state).ford;
export const bridgePlaces = (state: GenerationState) => crossingsOf(state).bridge;
/** Every crossing on the map, of either kind: what a crossing stands alone among. */
export const crossingPlaces = (state: GenerationState) => [
  ...fordPlaces(state),
  ...bridgePlaces(state),
];
