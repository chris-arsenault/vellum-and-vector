import type { Area, World } from "./model";
import { regionLineage } from "./regionViews";
import { requireThat } from "./errors";
import { spatial, rectangle } from "./spatial";
import { mapRefinementLevel } from "./regionalScale";
import { canonicalGeometry, compactGeometryBounds } from "./worldBoundary";

/** Surrounding geography is working map area, not a narrow shoreline halo. */
const regionalContextFraction = 0.25;

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
export function regionRefinementLevel(world: World, regionId: string) {
  const lineage = regionLineage(world, regionId);
  let level = mapRefinementLevel(world.areas, lineage[0].areaId);
  for (const region of lineage) {
    const mapped = region.id !== regionId && refinedRegionArea(world, region.id);
    level = mapped ? mapRefinementLevel(world.areas, mapped.id) : level + 1;
  }
  return level;
}
/** Leave room around the subject for coastlines and nearby context to develop on this map. */
export function regionMapFootprint(world: Pick<World, "reference">, subject: Area["footprint"]) {
  const bounds = compactGeometryBounds(world.reference, subject),
    margin = Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1]) * regionalContextFraction,
    [w, s, e, n] = spatial.bounds(world.reference.domain),
    cylinder = world.reference.boundaryMode === "cylinder";
  const frame = rectangle([
    cylinder ? bounds[0] - margin : Math.max(w, bounds[0] - margin),
    Math.max(s, bounds[1] - margin),
    cylinder ? bounds[2] + margin : Math.min(e, bounds[2] + margin),
    Math.min(n, bounds[3] + margin),
  ]);
  return canonicalGeometry(world.reference, frame);
}
export function regionRefinementInput(world: World, regionId: string) {
  const region = regionLineage(world, regionId).at(-1)!,
    parent = regionRefinementParent(world, regionId),
    footprint = regionMapFootprint(world, region.region.footprint);
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
      spatial.covers(regionMapFootprint(world, region.region.footprint), area.footprint),
    "region_refinement_scope",
    "Refine the selected region's outline using its nearest refined ancestor."
  );
  requireThat(
    area.profile === "region" && area.context === "landscape" && area.frame.floor === null,
    "region_map_type",
    "Regional refinement retains the geographic map type."
  );
}
