import type { DomainSnapshot } from "./operations";
import type { World } from "./model";
import type { Geometry } from "geojson";
import { Spatial } from "./spatial";
import { composeFeature } from "./composition";
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
    if (sameValue(oldGeometry, newGeometry)) continue;
    for (const geometry of changedGeometry(gis, oldGeometry, newGeometry))
      requireThat(
        gis.covers(source.scope.footprint, geometry),
        "write_scope",
        "The declared edit extent must contain the geography it adds, removes or moves."
      );
  }
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
