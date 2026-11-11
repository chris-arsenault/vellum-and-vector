import {
  MapScale,
  canonicalGeometry,
  combineGeometry,
  unwrapCoordinates,
  point,
  spatial,
} from "@atlas/domain";
import type { GenerationState } from "../process";
import { generatedFeature, putGenerated } from "../mapFeatures";
import { physicalSampler } from "./physicalMetric";
import { mapScale } from "../worldSignificance";
import { intersectAreas } from "./geographicContours";

type Event = NonNullable<GenerationState["physical"]>["map"]["events"][number];
/** Fault systems need a long retained trace; individual local fractures remain physical. */
// length-unit: fraction
const worldFaultLength = 0.0375;

export function volcanicRelief(state: GenerationState, event: Event) {
  const map = state.physical!.map,
    height = physicalSampler(map.mesh, map.Elevation);
  let surrounding = 0;
  for (let i = 0; i < 16; i++) {
    const angle = (i * Math.PI) / 8;
    surrounding += height(
      event.x + Math.cos(angle) * event.radius * 2,
      event.y + Math.sin(angle) * event.radius * 2
    );
  }
  return MapScale.metres(height(event.x, event.y) - surrounding / 16, "native");
}

export function eventDisk(
  state: GenerationState,
  center: import("@atlas/domain").Position,
  radius: number
) {
  const disk = spatial.buffer(point(center), radius);
  return (
    disk &&
    intersectAreas(
      canonicalGeometry(state.domain.world.reference, disk),
      state.domain.scope.footprint
    )
  );
}

/**
 * Metres the rim stands above both the floor and the surrounding plain, from the current
 * surface: later erosion, deposition and uplift can erase a crater's form.
 */
export function craterRelief(state: GenerationState, event: Event) {
  const { map } = state.physical!,
    height = physicalSampler(map.mesh, map.Elevation),
    ring = (distance: number) => {
      let sum = 0,
        count = 0;
      for (let direction = 0; direction < 16; direction++) {
        const angle = (direction * Math.PI) / 8,
          value = height(
            event.x + Math.cos(angle) * distance,
            event.y + Math.sin(angle) * distance
          );
        if (!Number.isFinite(value)) continue;
        sum += value;
        count++;
      }
      return count ? sum / count : NaN;
    };
  const floor = (height(event.x, event.y) + ring(event.radius * 0.4)) / 2,
    rim = ring(event.radius),
    plain = ring(event.radius * 2);
  const relief = MapScale.metres(Math.min(rim - floor, rim - plain), "native");
  return Number.isFinite(relief) ? relief : 0;
}
/** Long fault traces. Volcanoes, calderas and craters are the catalogue's, read from these events. */
export function extractFaults(state: GenerationState) {
  const { map } = state.physical!,
    [x0, y0] = map.mesh.origin;
  for (const fault of map.faults) {
    // A landmark's own fault trace publishes as the landmark, not as a second fault row.
    if (fault.coordinates.length < 2 || fault.id.startsWith("landmark:")) continue;
    const line = {
      type: "LineString" as const,
      coordinates: unwrapCoordinates(
        fault.coordinates.map(([x, y]) => [x + x0, y + y0]),
        map.mesh.periodic?.width
      ),
    };
    // A chart seam is not a long physical segment of the fault.
    const length = line.coordinates
      .slice(1)
      .reduce(
        (sum, p, i) =>
          sum + Math.hypot(p[0] - line.coordinates[i][0], p[1] - line.coordinates[i][1]),
        0
      );
    if (length < mapScale(state).length(worldFaultLength)) continue;
    const canonical = canonicalGeometry(state.domain.world.reference, line),
      clipped =
        canonical.type === "LineString" || canonical.type === "MultiLineString"
          ? spatial.clipTrace(canonical, state.domain.scope.footprint)
          : spatial.intersection(canonical, state.domain.scope.footprint),
      // A boundary tangency is not a fault reach; keep every surviving line part.
      shape = clipped && combineGeometry([clipped], 1);
    if (shape)
      putGenerated(
        state,
        generatedFeature(
          state,
          fault.id,
          `Fault ${fault.id.split(":").at(-1)}`,
          "fault",
          "faults",
          shape,
          { width: fault.width, causeId: fault.id, sourceAlgorithm: "atlas-1" }
        )
      );
  }
}
