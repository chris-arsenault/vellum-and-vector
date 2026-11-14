import type { PhysicalField } from "./field";
import type { PhysicalProfile } from "./profile";
import { toUnits } from "./math";
import { smoothMetric } from "./metricSmoothing";
import { physicalGradients, physicalSampler } from "./physicalMetric";
import type { Band } from "@atlas/domain";
import { workingValues } from "./physicalNumerics";

const unit = (value: number) => Math.min(1, Math.max(0, value));

export interface WindTerrain {
  terrain: Band;
  gradientX: Band;
  gradientY: Band;
  height: Band;
  /** Unsmoothed height, so gaps narrower than the smoothing length keep their walls. */
  sample: (x: number, y: number) => number;
}
/** Land height above sea level in metres, its smoothed form and that form's slope. */
export function windTerrain(map: PhysicalField, p: PhysicalProfile): WindTerrain {
  const height = workingValues(map, "float64", "wind:height", (i) =>
    map.WaterKindCodes.get(i) === 1
      ? 0
      : Math.max(0, toUnits(map.Elevation.get(i) - map.EffectiveSeaLevel))
  );
  const terrain = smoothMetric(map, height, p.WindTerrainLength);
  const gradient = physicalGradients(map.mesh, (i) => terrain.get(i), map.coverage);
  return {
    terrain,
    gradientX: gradient.x,
    gradientY: gradient.y,
    height,
    sample: physicalSampler(map.mesh, height),
  };
}
/**
 * Remove the upslope part of the flow in proportion to barrier height and
 * steepness, so air low in the atmosphere turns along high ranges.
 */
export function deflectWind(
  t: WindTerrain,
  p: PhysicalProfile,
  i: number,
  x: number,
  y: number
): [number, number] {
  const gx = t.gradientX.get(i),
    gy = t.gradientY.get(i),
    slope = Math.hypot(gx, gy);
  if (slope === 0) return [x, y];
  const nx = gx / slope,
    ny = gy / slope,
    upslope = x * nx + y * ny;
  if (upslope <= 0) return [x, y];
  // Blocking is partial: some air always rises over the barrier and rains on it.
  const blocking =
    p.WindBlockingMaximum *
    unit(t.terrain.get(i) / p.WindBlockingHeight) *
    unit(slope / p.WindBlockingSlope);
  const dx = x - blocking * upslope * nx,
    dy = y - blocking * upslope * ny,
    length = Math.hypot(dx, dy);
  // A fully blocked head-on flow turns along the contour rather than stopping.
  return length < 1e-6 ? [-ny, nx] : [dx / length, dy / length];
}
/** Belt speed shaped by roughness, crest exposure, lee shelter and gap channelling. */
export function windSpeed(
  map: PhysicalField,
  t: WindTerrain,
  p: PhysicalProfile,
  i: number,
  belt: number,
  barrier: number
) {
  const x = map.WindX.get(i) / 1000,
    y = map.WindY.get(i) / 1000,
    reach = p.WindGapReach,
    height = t.height.get(i);
  const land = map.WaterKindCodes.get(i) !== 1;
  // Crests standing above their smoothed surroundings catch stronger wind.
  const exposure = unit((height - t.terrain.get(i)) / p.WindExposureRelief);
  const shelter = unit(barrier / p.WindShelterHeight);
  const cx = map.mesh.x(i),
    cy = map.mesh.y(i);
  const left = t.sample(cx - y * reach, cy + x * reach),
    right = t.sample(cx + y * reach, cy - x * reach);
  // A wall sample beyond the working extent counts as no wall.
  const walls = Math.min(left, right) - height;
  const gap =
    land && Number.isFinite(walls) ? unit((walls - p.WindGapRelief) / p.WindGapRelief) : 0;
  return (
    belt *
    (land ? p.WindLandRoughness : 1) *
    (1 + 0.5 * exposure) *
    (1 - 0.6 * shelter) *
    (1 + 0.5 * gap)
  );
}
