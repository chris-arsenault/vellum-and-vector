import { z } from "zod";
import type { Geometry } from "geojson";
import type { World } from "./model";
import { geometrySchema } from "./schemas";
import { requireThat } from "./errors";
import { spatial } from "./spatial";

export const regionViewSchema = z.object({
  parentId: z.uuid().nullable(),
  footprint: geometrySchema,
});
export type RegionView = World["views"][number] & {
  region: z.infer<typeof regionViewSchema>;
};

/** A geographic map needs room for an area, rather than a narrow line or sliver. */
export const minimumRegionWidthMetres = 100;
export function usefulRegionSize(geometry: Geometry): boolean {
  return (2 * spatial.area(geometry)) / spatial.length(geometry) >= minimumRegionWidthMetres;
}
export function regionViews(world: World, areaId: string): RegionView[] {
  return world.views.filter((v): v is RegionView => v.areaId === areaId && !!v.region);
}
export function regionSourceAreaId(
  world: World,
  regionId: string | null,
  fallback: string
): string {
  return world.views.find((view) => view.id === regionId)?.areaId ?? fallback;
}
export function regionLineage(world: World, id: string | null): RegionView[] {
  const result: RegionView[] = [],
    seen = new Set<string>();
  while (id) {
    requireThat(!seen.has(id), "region_cycle", "Region parents must not form a cycle.");
    seen.add(id);
    const view = world.views.find((v): v is RegionView => v.id === id && !!v.region);
    requireThat(view, "missing_region", "Choose an existing parent region.");
    result.unshift(view);
    id = view.region.parentId;
  }
  return result;
}
export function regionFootprint(world: World, areaId: string, parentId: string | null): Geometry {
  if (!parentId) return world.areas[areaId].footprint;
  const parent = regionLineage(world, parentId).at(-1)!;
  requireThat(parent.areaId === areaId, "region_source", "A region retains its source map.");
  return parent.region.footprint;
}
/** Unselected parts remain available; existing sibling edges are reused exactly. */
export function availableRegionFootprint(
  world: World,
  areaId: string,
  parentId: string | null,
  excludeId: string | null = null
): Geometry | null {
  let shape: Geometry | null = regionFootprint(world, areaId, parentId);
  for (const view of regionViews(world, areaId)) {
    if (!shape) break;
    if (view.id !== excludeId && view.region.parentId === parentId)
      shape = spatial.difference(shape, view.region.footprint);
  }
  return shape;
}
function validateRefinedOutline(
  world: World,
  id: string,
  footprint: Geometry,
  parentId: string | null
) {
  const refined = Object.values(world.areas).find((area) => area.regionId === id);
  requireThat(
    !refined || previousRegionMatches(world, id, footprint),
    "region_refined_outline",
    "Keep a refined region's outline attached to its mapped geography. Choose a new region for a different extent."
  );
  const previous = world.views.find((view) => view.id === id)?.region;
  requireThat(
    !refined || !previous || previous.parentId === parentId,
    "region_refined_parent",
    "A refined region retains its geographic ancestry. Choose a new region to move it under another parent."
  );
}
function previousRegionMatches(world: World, id: string, footprint: Geometry) {
  const previous = world.views.find((view) => view.id === id)?.region?.footprint;
  return !!previous && spatial.covers(previous, footprint) && spatial.covers(footprint, previous);
}
export function validateRegionView(world: World, view: World["views"][number]) {
  if (view.regionId) {
    const subject = world.views.find((v) => v.id === view.regionId && v.region);
    requireThat(
      subject && subject.areaId === view.areaId && !view.region,
      "region_source",
      "Choose a region on this view's source map."
    );
  }
  const previous = world.views.find((v) => v.id === view.id);
  requireThat(
    !previous?.region || !!view.region,
    "region_identity",
    "A region retains its geographic scope."
  );
  if (!view.region) return view;
  const area = world.areas[view.areaId];
  requireThat(
    area.profile !== "interior" && area.context !== "cave" && area.frame.floor === null,
    "region_map_type",
    "Select regions on a geographic map."
  );
  requireThat(
    !previous || previous.areaId === view.areaId,
    "region_source",
    "A region retains its source map."
  );
  const footprint = spatial.canonical(view.region.footprint);
  validateRefinedOutline(world, view.id, footprint, view.region.parentId);
  requireThat(
    ["Polygon", "MultiPolygon"].includes(footprint.type),
    "region_polygon",
    "A region needs a closed polygonal outline."
  );
  requireThat(
    usefulRegionSize(footprint),
    "region_size",
    `Choose an area with a useful width of at least ${minimumRegionWidthMetres} metres.`
  );
  const candidate = { ...world, views: [...world.views.filter((v) => v.id !== view.id), view] };
  regionLineage(candidate, view.id);
  const parent = regionFootprint(world, view.areaId, view.region.parentId);
  requireThat(
    spatial.covers(parent, footprint),
    "region_parent",
    "Keep the outline inside its parent region."
  );
  requireThat(
    spatial.area(footprint) < spatial.area(parent),
    "region_smaller",
    "Choose a region smaller than its parent."
  );
  validateRegionNeighbors(world, { ...view, region: view.region }, footprint);
  return { ...view, region: { ...view.region, footprint } };
}
function validateRegionNeighbors(world: World, view: RegionView, footprint: Geometry) {
  for (const other of regionViews(world, view.areaId)) {
    if (other.id === view.id) continue;
    if (other.region.parentId === view.id)
      requireThat(
        spatial.covers(footprint, other.region.footprint),
        "region_children",
        "Keep existing child regions inside the adjusted outline."
      );
    if (other.region.parentId !== view.region.parentId) continue;
    const overlap = spatial.intersection(footprint, other.region.footprint);
    requireThat(
      !overlap || spatial.area(overlap) <= (world.reference.precision ?? 1e-6) ** 2,
      "region_overlap",
      "This part already belongs to a sibling region. Choose an unselected part."
    );
  }
}
