import type { Area, State, World } from "./model";
import { profiles } from "./model";
import { areaSpace, isDescendant } from "./composition";
import { Spatial } from "./spatial";
import { requireThat } from "./errors";
import { ownsMapGeography } from "./mapOwnership";

export interface MaterializedCoverage {
  id: string;
  areaId: string;
  spaceId: string;
  layerId: string;
  detailRank: number;
  resolution: number | null;
  time: string;
  footprint: Area["footprint"];
  state: State;
  resourceId: string | null;
  generationId: string | null;
}
function competing(a: MaterializedCoverage, b: MaterializedCoverage): boolean {
  return (
    a.id !== b.id &&
    a.areaId !== b.areaId &&
    b.state !== "unmaterialized" &&
    a.spaceId === b.spaceId &&
    a.layerId === b.layerId &&
    a.detailRank === b.detailRank &&
    a.time === b.time
  );
}
export function validateCoverage(
  world: Pick<World, "id" | "areas" | "reference">,
  coverage: MaterializedCoverage,
  existing: MaterializedCoverage[]
): void {
  const area = world.areas[coverage.areaId],
    gis = new Spatial(world.reference.precision);
  requireThat(
    area &&
      coverage.spaceId === areaSpace(world, area.id) &&
      coverage.detailRank === profiles.indexOf(area.profile),
    "coverage_reference",
    "Materialization ownership must match its located area and detail level."
  );
  requireThat(
    ownsMapGeography(world, area.id) || gis.covers(area.footprint, coverage.footprint),
    "coverage_extent",
    "Materialization stays within its mapped area."
  );
  if (coverage.state === "unmaterialized") return;
  const sharedAuthority = existing.filter((other) => !area.map && !world.areas[other.areaId]?.map);
  for (const other of sharedAuthority) {
    if (!competing(coverage, other)) continue;
    if (
      isDescendant(world.areas, coverage.areaId, other.areaId) ||
      isDescendant(world.areas, other.areaId, coverage.areaId)
    )
      continue;
    const overlap = gis.intersection(coverage.footprint, other.footprint);
    requireThat(
      overlap === null || gis.area(overlap) === 0,
      "overlapping_authority",
      "Same-detail materialization has one owner for each layer, time and location."
    );
  }
}
