import {
  canonicalGeometry,
  geometryParts,
  rectangle,
  spatial,
  type DomainSnapshot,
  type Bounds,
} from "@atlas/domain";
import type { Geometry } from "geojson";

/** Use the pinned selection, so rerunning a map does not repeatedly expand its frame. */
export function refinementFootprint(source: DomainSnapshot, areaId: string, physical = true) {
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
  const bounds = spatial.bounds(footprint),
    reference = source.world.reference;
  if (reference.boundaryMode !== "cylinder") return bounds;
  const [west, , east] = spatial.bounds(reference.domain),
    width = east - west,
    intervals = geometryParts(footprint)
      .map((part) => spatial.bounds(part))
      .sort((a, b) => a[0] - b[0]);
  let end = intervals[0][2],
    gap = intervals[0][0] + width - intervals.at(-1)![2],
    start = intervals[0][0];
  for (const interval of intervals.slice(1)) {
    if (interval[0] - end > gap) {
      gap = interval[0] - end;
      start = interval[0];
    }
    end = Math.max(end, interval[2]);
  }
  return [start, bounds[1], start + width - Math.max(0, gap), bounds[3]];
}

export function refinementFrame(
  source: DomainSnapshot,
  areaId: string,
  span: number,
  parentSpan: number,
  physical: boolean
) {
  const bounds = compactBounds(source, refinementFootprint(source, areaId, physical));
  if (physical) {
    // Coastal context follows source scale without overwhelming a very small selected subject.
    const margin = Math.max(
      span * 2,
      Math.min(parentSpan / 2, Math.min(bounds[2] - bounds[0], bounds[3] - bounds[1]) / 4)
    );
    bounds[0] -= margin;
    bounds[1] -= margin;
    bounds[2] += margin;
    bounds[3] += margin;
  }
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
