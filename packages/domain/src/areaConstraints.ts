import type { Area, World } from "./model";
import { Spatial, point } from "./spatial";
import { profiles } from "./model";
import { requireThat } from "./errors";
import { effectiveTraits, validateBoundaryTraits } from "./traits";

export function validateAreaPlacement(
  world: Pick<World, "id" | "areas" | "reference">,
  area: Area
): void {
  const gis = new Spatial(world.reference.precision),
    shape = gis.canonical(area.footprint);
  requireThat(
    shape.type === "Polygon" || shape.type === "MultiPolygon",
    "area_footprint",
    "Mapped areas use valid polygonal footprints."
  );
  requireThat(
    gis.covers(shape, point(area.frame.origin)),
    "area_anchor",
    "The local origin must lie in its mapped footprint."
  );
  if (area.parentId === null) {
    requireThat(
      area.profile === "world" &&
        !Object.values(world.areas).some((a) => a.id !== area.id && a.parentId === null),
      "world_root",
      "One world root owns the geographic hierarchy."
    );
    return;
  }
  const parent = world.areas[area.parentId];
  requireThat(parent, "missing_parent", "Choose a geographic parent for this area.");
  requireThat(
    profiles.indexOf(area.profile) > profiles.indexOf(parent.profile),
    "refinement_profile",
    "Choose a finer creation profile; intermediate profiles may be skipped."
  );
  requireThat(
    gis.covers(parent.footprint, shape),
    "outside_parent",
    "A mapped area stays within its geographic parent."
  );
  const candidate = { ...world, areas: { ...world.areas, [area.id]: area } };
  const effective = effectiveTraits(candidate.areas, area.id);
  validateBoundaryTraits({ ...area, traits: effective });
}
