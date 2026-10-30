import {
  canonicalGeometry,
  compactGeometryBounds,
  regionMapFootprint,
  rectangle,
  spatial,
  type DomainSnapshot,
  type Bounds,
} from "@atlas/domain";
import type { Geometry } from "geojson";

/** Use the pinned selection, so rerunning a map does not repeatedly expand its frame. */
export function refinementFootprint(source: DomainSnapshot, areaId: string, physical = true) {
  if (physical && source.world.areas[areaId].map?.extent)
    return source.world.areas[areaId].map!.extent!;
  const fields = source.world.fields.filter(
    (f) => f.areaId === areaId && f.channels?.includes("elevation")
  );
  return (
    fields.find((f) => f.input === physical && f.footprint)?.footprint ??
    source.world.areas[areaId].footprint
  );
}

/** A region crossing the cylindrical seam uses one short, continuous local chart. */
export function compactBounds(source: DomainSnapshot, footprint: Geometry): Bounds {
  return compactGeometryBounds(source.world.reference, footprint);
}

export function refinementFrame(source: DomainSnapshot, areaId: string, physical: boolean) {
  const input = refinementFootprint(source, areaId, physical),
    frame =
      physical && !source.world.areas[areaId].map?.extent
        ? regionMapFootprint(source.world, input)
        : input,
    bounds = compactBounds(source, frame);
  const reference = source.world.reference,
    [w, s, e, n] = spatial.bounds(reference.domain);
  bounds[1] = Math.max(s, bounds[1]);
  bounds[3] = Math.min(n, bounds[3]);
  if (reference.boundaryMode !== "cylinder") {
    bounds[0] = Math.max(w, bounds[0]);
    bounds[2] = Math.min(e, bounds[2]);
  } else if (bounds[2] - bounds[0] >= e - w) {
    bounds[0] = w;
    bounds[2] = e;
  }
  return { bounds, footprint: canonicalGeometry(reference, rectangle(bounds)) };
}
