import {
  structureVocabulary,
  type MapDescriptor,
  type MapFeature,
  type MapRelation,
  type MapSpace,
} from "@atlas/map";

/** A level of a building's floors map: its number (0 the ground floor, below zero the
 * cellars), its located space and what a creator calls it. Rust owns the levels; this
 * reads them from the published descriptor for the view. */
export interface StructureLevel {
  number: number;
  spaceId: string;
  label: string;
}
const floorPrefix = "level:";

export const isStructureMap = (map: MapDescriptor) => map.realScale?.kind === "structure";
export const isGroundMap = (map: MapDescriptor) => map.realScale?.kind === "ground";

/** What a creator calls a level, from the Rust structure vocabulary. */
export function levelName(number: number) {
  const levels = structureVocabulary.levels;
  const named = (levels.names as Record<string, string>)[String(number)];
  if (named) return named;
  return (number < 0 ? levels.cellar : levels.floor).replace("{n}", String(Math.abs(number)));
}
function levelNumber(map: MapDescriptor, space: MapSpace) {
  if (space.id === map.primarySpaceId) return 0;
  const floor = space.frame.floor;
  return floor?.startsWith(floorPrefix) ? Number(floor.slice(floorPrefix.length)) : null;
}
/** The levels of a floors map, top floor first, as a building is read from the stair. */
export function structureLevels(map: MapDescriptor): StructureLevel[] {
  if (!isStructureMap(map)) return [];
  return map.spaces
    .flatMap((space) => {
      const number = levelNumber(map, space);
      return number === null || Number.isNaN(number)
        ? []
        : [{ number, spaceId: space.id, label: levelName(number) }];
    })
    .sort((a, b) => b.number - a.number);
}
export const levelOf = (map: MapDescriptor, spaceId: string) =>
  structureLevels(map).find((level) => level.spaceId === spaceId);

/** Kinds that carry people between levels or maps, from the Rust structure vocabulary. */
const connectionKinds: readonly string[] = structureVocabulary.connections.kinds;
export const isConnection = (feature: MapFeature) => connectionKinds.includes(feature.kind);

/** A connection a feature holds: to its landing on this map, or to a feature on another. */
export interface HeldConnection {
  relation: MapRelation;
  mapId?: string;
  featureId: string;
}
export function heldConnections(feature: MapFeature): HeldConnection[] {
  return feature.relations.flatMap((relation) => {
    if (relation.kind === "leadsTo") return [{ relation, featureId: relation.targetId }];
    if (relation.kind !== "connectsTo") return [];
    const cut = relation.targetId.indexOf("#");
    return cut > 0
      ? [
          {
            relation,
            mapId: relation.targetId.slice(0, cut),
            featureId: relation.targetId.slice(cut + 1),
          },
        ]
      : [];
  });
}

/** Where the view goes when a followed connection opens another map. */
export interface Arrival {
  featureId: string;
}
const arrivals = new Map<string, Arrival>();
export const arriveAt = (mapId: string, arrival: Arrival) => arrivals.set(mapId, arrival);
export function takeArrival(mapId: string) {
  const arrival = arrivals.get(mapId);
  arrivals.delete(mapId);
  return arrival;
}
