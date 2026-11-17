import { createContext, useContext, useEffect } from "react";
import {
  collectPages,
  type Bounds,
  type MapDescriptor,
  type MapEditing,
  type MapFeature,
  type MapLibrary,
  type MapReader,
  type MapRef,
} from "@atlas/map";
import { arriveAt, takeArrival, type HeldConnection } from "./structureMaps";
import type { AuthoringSession } from "./useRealScaleAuthoring";

/** What the structure-map panels need from the open map: its reader, the authoring and
 * library facades, and the ways to show a level, centre the view or open another map. */
export interface StructureServices {
  map: MapDescriptor;
  reader: MapReader;
  editing: MapEditing;
  library: MapLibrary;
  open(reference: MapRef): void;
  showSpace(spaceId: string): void;
  focus(bounds: Bounds): void;
}
const Services = createContext<StructureServices | null>(null);
export const StructureProvider = Services.Provider;
export const useStructure = () => useContext(Services);

/** A feature by id in whichever located space of the map holds it. */
export async function findFeature(reader: MapReader, map: MapDescriptor, id: string) {
  for (const space of map.spaces) {
    const found = await collectPages((cursor) =>
      reader.features(map.reference, { spaceId: space.id, featureIds: [id], cursor })
    );
    if (found[0]) return found[0];
  }
  return undefined;
}
export function featureBounds(feature: MapFeature): Bounds {
  const points: number[][] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value) && typeof value[0] === "number") points.push(value as number[]);
    else if (Array.isArray(value)) value.forEach(visit);
  };
  if ("coordinates" in feature.geometry) visit(feature.geometry.coordinates);
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
/** Show a feature of the open map: its level, then the view centred on it. */
export async function showFeature(services: StructureServices, id: string) {
  const feature = await findFeature(services.reader, services.map, id);
  if (!feature) throw new Error("That feature is no longer on this map.");
  services.showSpace(feature.spaceId);
  services.focus(featureBounds(feature));
}
/** The current revision of another map: the parent, a child, or a saved map. */
async function mapNamed(services: StructureServices, mapId: string) {
  const { map, library } = services;
  if (map.parent?.mapId === mapId) return map.parent;
  const related = await library.related(map.reference);
  const child = related.children.find((entry) => entry.mapId === mapId);
  if (child) return child;
  if (related.parent?.mapId === mapId) return related.parent;
  const saved = await library.find(mapId);
  if (!saved) throw new Error("That map is not in this atlas.");
  return saved.reference;
}
/** Follow a connection: to its landing on this map, or open the other map at the feature. */
export async function follow(services: StructureServices, connection: HeldConnection) {
  if (!connection.mapId || connection.mapId === services.map.reference.mapId)
    return showFeature(services, connection.featureId);
  const reference = await mapNamed(services, connection.mapId);
  arriveAt(reference.mapId, { featureId: connection.featureId });
  services.open(reference);
}
interface Source {
  map: MapDescriptor;
  context: { maps: MapReader; editing: MapEditing; library: MapLibrary };
  open(reference: MapRef): void;
}
/** The open map's structure services, read through the authoring session's level and focus,
 * and the arrival of a followed connection on this map. */
export function useStructureServices(source: Source, session: AuthoringSession) {
  const services: StructureServices = {
    map: source.map,
    reader: source.context.maps,
    editing: source.context.editing,
    library: source.context.library,
    open: source.open,
    showSpace: session.showSpace,
    focus: (bounds) => session.set({ focus: { bounds, serial: Date.now() } }),
  };
  useArrival(services);
  return services;
}
/** On opening a map reached by a connection, show the level and the feature it reached. */
function useArrival(services: StructureServices) {
  const mapId = services.map.reference.mapId;
  useEffect(() => {
    const arrival = takeArrival(mapId);
    if (arrival) void showFeature(services, arrival.featureId).catch(() => {});
    // Arrival is read once per opened map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapId]);
}
