import type { DomainSnapshot } from "./operations";
import type { World } from "./model";
import type { Geometry } from "geojson";
import { Spatial } from "./spatial";
import { composeFeature, composeFootprint } from "./composition";
import { sameValue } from "./values";
import { requireThat } from "./errors";

export function validateGeometryWriteScopes(
  source: DomainSnapshot,
  candidate: World,
  features: string[]
): void {
  const gis = new Spatial(source.world.reference.precision);
  for (const id of features) {
    const before = source.world.features[id],
      after = candidate.features[id];
    const oldGeometry = before ? composeFeature(source.world, before) : null,
      newGeometry = after ? composeFeature(candidate, after) : null;
    validateRoleScope(source, gis, oldGeometry, newGeometry);
    validateRoleScope(
      source,
      gis,
      before ? composeFootprint(source.world, before) : null,
      after ? composeFootprint(candidate, after) : null
    );
  }
}
function validateRoleScope(
  source: DomainSnapshot,
  gis: Spatial,
  before: Geometry | null,
  after: Geometry | null
) {
  if (sameValue(before, after)) return;
  for (const geometry of changedGeometry(gis, before, after))
    requireThat(
      // Clipping rounds new vertices to the precision grid. Use the same overlay
      // precision here, including where those vertices lie on a slanted edge.
      gis.covers(source.scope.footprint, geometry) ||
        gis.difference(geometry, source.scope.footprint) === null,
      "write_scope",
      "The declared edit extent must contain the geography it adds, removes or moves."
    );
}
function changedGeometry(
  gis: Spatial,
  before: Geometry | null,
  after: Geometry | null
): Geometry[] {
  if (!before) return after ? [after] : [];
  if (!after) return [before];
  const parts = [gis.difference(before, after), gis.difference(after, before)];
  return parts.filter((g): g is Geometry => g !== null);
}
