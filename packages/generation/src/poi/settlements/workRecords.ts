import {
  canonicalGeometry,
  canonicalPosition,
  isSocietyWork,
  point,
  societyWorkLayers,
  spatial,
  type AtlasFeature,
  type SocietyEvent,
  type SocietyRegion,
  type SocietyWork,
  type SocietyWorkKind,
  type RelativeMeasure,
} from "@atlas/domain";
import { namingVersion } from "../../atlasNaming";
import { mapScale } from "../../worldSignificance";
import { generationFeature, generationFeatures } from "../../generationFeatures";
import type { GenerationState } from "../../process";
import { regionalFeature, regionalId } from "../../regional/extraction/features";
import { positionOf } from "../../regional/lattice";
import { bridgeFlow, roadTravellers } from "../../regional/societyWays";
import type { RegionalState } from "../../regional/state";
import { isWorldSociety } from "../../societyMapScope";
import { societyWorkName } from "../../societyNaming";
import { eventFootprint, societyWorkGeometry } from "../../societyWorkGeometry";
import type { PoiPlace } from "../poiContract";
import type { PoiKindId } from "../poiKinds";
import { sitedPlaces } from "../poiPlaces";
import { fieldOf, gap, heldFor, isLand } from "../poiReads";
import { onMappedRiver } from "../water/waterReads";
import {
  cellOf,
  developed,
  isRefined,
  lazyPlace,
  localId,
  localRecord,
  onceWritten,
  settlementPlaces,
  societyRegionOf,
} from "./communityRecords";

type OnCell<T> = (state: GenerationState, cell: number) => T;

/**
 * Where works and events come from: the society simulation's own records, and for the kinds no
 * simulation sites, the ground that suits them. These build the record each place publishes as.
 */

/** A work's name once, as the simulation would have given it. */
export function nameUnrecordedWork(state: GenerationState, work: SocietyWork) {
  if (work.name) return;
  const community = societyRegionOf(state)?.communities.find((c) => c.id === work.communityId);
  if (!community) return;
  const named = societyWorkName(state.domain.world, community, work);
  work.name = named.name;
  work.naming = { language: named.namingLanguage, culture: named.namingCulture, era: work.built };
}
const existingNames = (state: GenerationState) =>
  heldFor(state, "society:workNames", () => {
    const existing = new Map<unknown, Pick<AtlasFeature, "name" | "attributes">>();
    for (const feature of generationFeatures(state))
      if (isSocietyWork(feature))
        existing.set(feature.attributes.workId, {
          name: feature.name,
          attributes: feature.attributes,
        });
    return existing;
  });
function workName(state: GenerationState, work: SocietyWork) {
  // A retained map name takes precedence over vocabulary revisions or a changed population.
  const previous = existingNames(state).get(work.id);
  if (previous) return { name: previous.name, attributes: previous.attributes };
  nameUnrecordedWork(state, work);
  return {
    name: work.name ?? "Unnamed work",
    attributes: {
      namingKind: "societyWork",
      namingVersion,
      namingSubkind: work.kind,
      namingCulture: work.naming?.culture ?? null,
      namingLanguage: work.naming?.language ?? null,
      namedInEra: work.naming?.era ?? null,
    },
  };
}
/** The record a located work of the simulation publishes as. */
export function workFeature(state: GenerationState, w: SocietyWork) {
  const named = workName(state, w),
    shape = societyWorkGeometry(state, w),
    feature = localRecord(
      state,
      `work:${w.id}`,
      named.name,
      w.kind,
      societyWorkLayers[w.kind],
      shape.geometry,
      {
        ...named.attributes,
        geometryMeaning: shape.meaning,
        site: w.position,
        workId: w.id,
        workKind: w.kind,
        communityId: w.communityId,
        radius: w.radius,
        magnitude: w.magnitude,
        condition: w.condition,
        maintained: w.maintained,
        built: w.built,
      }
    );
  feature.name = named.name;
  feature.causes = w.causes;
  return feature;
}
function recordedWork(state: GenerationState, kind: PoiKindId, w: SocietyWork): PoiPlace {
  const anchor = cellOf(state, w.position),
    authored = w.authored ? generationFeature(state, w.id) : undefined;
  return authored
    ? { id: authored.id, kind, cells: anchor >= 0 ? [anchor] : [], anchor, feature: authored }
    : lazyPlace(kind, localId(state, `work:${w.id}`), anchor, () => workFeature(state, w));
}
/** The simulation's located works of a kind in this frame; a demand is latent at every profile. */
function recordedWorks(state: GenerationState, kind: PoiKindId, workKind: SocietyWorkKind) {
  const region = societyRegionOf(state);
  if (!region) return [];
  const covered = isRefined(state) ? spatial.pointCoverage(state.surface.scope.footprint) : null,
    reference = state.domain.world.reference,
    bounds = spatial.bounds(reference.domain);
  return region.works
    .filter(
      (w) =>
        w.kind === workKind &&
        !w.demand &&
        (!covered || covered(canonicalPosition(reference, w.position, bounds)))
    )
    .map((w) => recordedWork(state, kind, w))
    .filter((place) => place.anchor >= 0 || !state.physical);
}

/** What a kind no simulation sites needs in order to be sited, and what its record says. */
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
const sitedByGround = new WeakSet<PoiPlace>();
function nearestTown(state: GenerationState, cell: number) {
  let best: PoiPlace | undefined,
    reach = Infinity;
  for (const town of settlementPlaces(state)) {
    const d = gap(state, cell, town.anchor);
    if (d < reach) [best, reach] = [town, d];
  }
  return best;
}
function sitedFeature(state: GenerationState, kind: PoiKindId, shape: SitedWork, cell: number) {
  const at = positionOf(fieldOf(state).mesh, cell);
  return localRecord(state, `${kind}:${cell}`, shape.label, shape.record, shape.layer, point(at), {
    workKind: shape.record,
    sited: true,
    site: at,
    seat: nearestTown(state, cell)?.id,
    radius: mapScale(state).resolveMeasure(shape.radius),
    magnitude: 1,
    condition: 1,
    maintained: true,
  });
}
function groundPlaces(
  state: GenerationState,
  kind: PoiKindId,
  shape: SitedWork,
  recorded: readonly PoiPlace[]
) {
  if (!state.physical) return [];
  const spacing = mapScale(state).resolveMeasure(shape.spacing),
    found = sitedPlaces(kind, shape.requires, shape.suitability, () => spacing)(state);
  return found
    .filter(({ anchor }) =>
      recorded.every((other) => other.anchor < 0 || gap(state, anchor, other.anchor) >= spacing)
    )
    .map(({ anchor }) => {
      const place = lazyPlace(kind, localId(state, `${kind}:${anchor}`), anchor, () =>
        sitedFeature(state, kind, shape, anchor)
      );
      sitedByGround.add(place);
      return place;
    });
}
/** A kind's places: the simulation's works of it, where it has any, and those the ground sites. */
export const workPlaces =
  (kind: PoiKindId, workKind: SocietyWorkKind | null, shape: SitedWork) =>
  (state: GenerationState): readonly PoiPlace[] =>
    heldFor(state, `places:${kind}`, () => {
      if (!developed(state)) return [];
      const recorded = workKind ? recordedWorks(state, kind, workKind) : [];
      return [...recorded, ...groundPlaces(state, kind, shape, recorded)];
    });
/**
 * A work's record. An authored record stands as authored, and the World publishes no work the
 * simulation made (ADR 0005): such a work acts on the World's field without a record.
 */
export function workRecord(state: GenerationState, place: PoiPlace): AtlasFeature | null {
  if (!sitedByGround.has(place) && isWorldSociety(state)) return null;
  return place.feature?.state === "generated" ? onceWritten(state, place) : null;
}

/** Dead and displaced an event needs before the World shows it. */
const worldEventToll = 10000;
function worldEvent(state: GenerationState, event: SocietyEvent) {
  const feature = localRecord(
    state,
    `event:${event.id}`,
    `${event.kind} — ${event.era}`,
    "societyEvent",
    "historicalEvents",
    { type: "Point", coordinates: [event.position.x, event.position.y] },
    {
      eventId: event.id,
      communities: event.communities,
      eventKind: event.kind,
      era: event.era,
      radius: event.radius,
      casualties: event.casualties,
      displaced: event.displaced,
      magnitude: event.magnitude,
    }
  );
  feature.causes = event.causes;
  const footprint = eventFootprint(state, event);
  if (footprint) {
    feature.footprint = footprint;
    feature.attributes.geometryMeaning = "event location with known affected community extents";
  }
  return feature;
}
/** The record of an event no catalogue kind stands for, as any other on this map. */
export const unkindedEvent = worldEvent;
/** The record of an event this refined map retains: its whole affected area. */
const retainedEvent = (
  state: RegionalState,
  event: SocietyEvent,
  geometry: AtlasFeature["geometry"]
) =>
  regionalFeature(
    state,
    `event:${event.id}`,
    "societyEvent",
    "historicalEvents",
    geometry,
    {
      era: event.era,
      eventKind: event.kind,
      casualties: event.casualties,
      displaced: event.displaced,
    },
    event.kind
  );
function retainedEvents(state: RegionalState, kind: PoiKindId, events: readonly SocietyEvent[]) {
  const intersects = spatial.intersectionPredicate(state.surface.scope.footprint);
  return events.flatMap((event) => {
    const geometry = spatial.buffer(point(event.position), event.radius);
    if (!geometry || !intersects(canonicalGeometry(state.domain.world.reference, geometry)))
      return [];
    const at = cellOf(state, event.position),
      anchor = at >= 0 ? at : cellOf(state, spatial.interiorPosition(geometry));
    return [
      lazyPlace(kind, regionalId(state, `event:${event.id}`), anchor, () =>
        retainedEvent(state, event, geometry)
      ),
    ];
  });
}
function worldEvents(state: GenerationState, kind: PoiKindId, events: readonly SocietyEvent[]) {
  return events
    .filter(
      (event) => !isWorldSociety(state) || event.casualties + event.displaced >= worldEventToll
    )
    .map((event) =>
      lazyPlace(kind, localId(state, `event:${event.id}`), cellOf(state, event.position), () =>
        worldEvent(state, event)
      )
    );
}
/** Events a kind stands for, on this map, from the society's own record of them. */
export const eventPlaces =
  (kind: PoiKindId, matches: (event: SocietyEvent) => boolean) =>
  (state: GenerationState): readonly PoiPlace[] =>
    heldFor(state, `places:${kind}`, () => {
      const events = developed(state) ? (societyRegionOf(state)?.events.filter(matches) ?? []) : [];
      const places = isRefined(state)
        ? retainedEvents(state, kind, events)
        : worldEvents(state, kind, events);
      return places.filter((place) => place.anchor >= 0 || !state.physical);
    });

/** A way whose two ends different polities hold: where fighting between them would fall. */
function frontierWays(region: SocietyRegion) {
  const control = region.politics?.control ?? {},
    seats = new Map(region.communities.map((c) => [c.id, c]));
  return region.connections.flatMap((link) => {
    const a = seats.get(link.from),
      b = seats.get(link.to),
      held = [control[link.from], control[link.to]];
    return a && b && held[0] && held[1] && held[0] !== held[1]
      ? [{ a, b, wear: link.wear ?? 0 }]
      : [];
  });
}
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
 * Fields where held territories meet, on land between the seats whose ways cross the frontier,
 * the most used ways first and each `spacing` metres from the last.
 */
export function frontierPlaces(state: GenerationState, kind: PoiKindId, spacing: number) {
  const region = societyRegionOf(state);
  if (!region || !state.physical) return [];
  const era = region.history.at(-1)?.id ?? "Settlement",
    taken: number[] = [],
    places: PoiPlace[] = [];
  for (const { a, b } of frontierWays(region).sort((x, y) => y.wear - x.wear)) {
    const cell = cellOf(state, {
      x: (a.position.x + b.position.x) / 2,
      y: (a.position.y + b.position.y) / 2,
    });
    if (cell < 0 || !isLand(state, cell) || taken.some((t) => gap(state, t, cell) < spacing))
      continue;
    taken.push(cell);
    const key = `frontier:${a.id}:${b.id}`;
    places.push(
      lazyPlace(kind, localId(state, `event:${key}`), cell, () =>
        frontierFeature(state, key, era, cell, `${a.name} and ${b.name}`)
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
