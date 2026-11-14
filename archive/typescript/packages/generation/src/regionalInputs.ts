import {
  areaSpace,
  isDescendant,
  spatial,
  type DomainSnapshot,
  type Grid,
  ownsMapGeography,
  regionalScale,
  mapRefinementLevel,
} from "@atlas/domain";
import { generationResolution } from "./resolution";

/** Ancestors only: a neighboring or descendant map cannot become its own procedural input. */
export function regionalInputFields(source: DomainSnapshot, areaId: string) {
  const area = source.world.areas[areaId],
    space = areaSpace(source.world, areaId);
  return source.world.fields
    .filter((field) => {
      const grid = source.numerical[field.id];
      return (
        grid &&
        grid.scope.spaceId === space &&
        (ownsMapGeography(source.world, areaId)
          ? field.areaId === areaId && !!field.input
          : field.areaId !== areaId && isDescendant(source.world.areas, areaId, field.areaId)) &&
        spatial.covers(grid.scope.footprint, area.footprint)
      );
    })
    .map((field) => source.numerical[field.id])
    .sort((a, b) => (b.scope.resolution ?? Infinity) - (a.scope.resolution ?? Infinity));
}
/** Each channel has one finest applicable input; do not let field insertion order pick it. */
export function regionalInputChannels(fields: Grid[]) {
  const result = new Map<string, Grid>();
  for (const grid of fields) for (const name of Object.keys(grid.channels)) result.set(name, grid);
  return result;
}
/** A refined map takes its level's rung of the fixed ladder; any other map its profile's. */
export function regionalResolution(source: DomainSnapshot, areaId: string, quality: string) {
  const area = source.world.areas[areaId];
  return area.parentId && area.map
    ? regionalScale(Math.max(1, mapRefinementLevel(source.world.areas, areaId)), quality)
    : generationResolution(quality, area.profile);
}
