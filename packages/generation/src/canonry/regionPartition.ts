import type { GenerationState } from "../process";
import type { RegionMembers } from "./regionMembers";
import { catchmentUnits } from "./catchmentUnits";
import { unitGroups, mergeGroups, groupPieces } from "./regionGroups";
import { workingArray, releaseWorking } from "./physicalNumerics";
import { isNumericalVector } from "@atlas/domain";

/** A named region may reach this multiple of its least named size before it splits. */
export const largestRegionFactor = 4;
/** Landform regions split above this share of the map's land, as forests do. */
export const largestRegionShare = 0.016;

/** Dry land area of the generated map, in square metres. */
export function landArea(state: GenerationState) {
  const map = state.physical!.map;
  let area = 0;
  for (let i = 0; i < map.mesh.contentCount; i++)
    if (map.WaterKindCodes[i] === 0) area += map.mesh.contentAreas[i];
  return area;
}
/** Split large regions along connected catchments, preserving drainage divides. */
export function partitionRegion(state: GenerationState, members: RegionMembers, maximum: number) {
  const map = state.physical!.map,
    areas = map.mesh.contentAreas;
  if (members.reduce((sum, i) => sum + areas[i], 0) <= maximum) {
    if (isNumericalVector(members)) return [members];
    const cells = workingArray(map, "int32", "region:members", members.length);
    cells.set(members);
    return [cells];
  }
  const units = catchmentUnits(map, maximum / 4),
    groups = unitGroups(map, members, units);
  releaseWorking(map, units);
  const { parent, next } = mergeGroups(map, groups, maximum);
  return groupPieces(map, groups, parent, next);
}
