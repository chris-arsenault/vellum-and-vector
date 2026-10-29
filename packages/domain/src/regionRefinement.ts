import type { Area, World } from "./model";
import { regionLineage } from "./regionViews";
import { requireThat } from "./errors";
import { spatial } from "./spatial";

/** Refinement adds a representation to an existing subject, never a second region tree. */
export function refinedRegionArea(world: World, regionId: string): Area | undefined {
  return Object.values(world.areas).find((area) => area.regionId === regionId);
}
export function regionRefinementParent(world: World, regionId: string): Area {
  const lineage = regionLineage(world, regionId),
    region = lineage.at(-1)!;
  for (const ancestor of lineage.slice(0, -1).reverse()) {
    const area = refinedRegionArea(world, ancestor.id);
    if (area) return area;
  }
  return world.areas[region.areaId];
}
/** Leave room around the subject for coastlines and nearby context to develop on this map. */
export function regionMapFootprint(parent: Area, subject: Area["footprint"]) {
  const margin = spatial.area(subject) / spatial.length(subject) / 8;
  return spatial.intersection(spatial.buffer(subject, margin)!, parent.footprint)!;
}
export function regionRefinementInput(world: World, regionId: string) {
  const region = regionLineage(world, regionId).at(-1)!,
    parent = regionRefinementParent(world, regionId),
    footprint = regionMapFootprint(parent, region.region.footprint);
  return {
    regionId,
    parentId: parent.id,
    name: region.name,
    profile: "region" as const,
    footprint,
    frame: { ...parent.frame, origin: spatial.interiorPosition(footprint) },
    context: "landscape",
    approach: "procedural" as const,
    traits: [],
  };
}
export function validateRegionRefinement(world: World, area: Area) {
  if (!area.regionId) return;
  const region = regionLineage(world, area.regionId).at(-1)!;
  requireThat(
    !refinedRegionArea(world, region.id),
    "region_refined",
    "Open the region's existing refined map."
  );
  requireThat(
    area.parentId === regionRefinementParent(world, region.id).id &&
      spatial.covers(area.footprint, region.region.footprint) &&
      spatial.covers(
        regionMapFootprint(regionRefinementParent(world, region.id), region.region.footprint),
        area.footprint
      ),
    "region_refinement_scope",
    "Refine the selected region's outline using its nearest refined ancestor."
  );
  requireThat(
    area.profile === "region" && area.context === "landscape" && area.frame.floor === null,
    "region_map_type",
    "Regional refinement retains the geographic map type."
  );
}
