import type { PhysicalField } from "./field";
import type { PhysicalProfile } from "./profile";

export const LatitudeProjection = { Equirectangular: 0, EqualArea: 1 } as const;
type Frame = Pick<
  PhysicalProfile,
  "LatitudeSouth" | "LatitudeNorth" | "LatitudeProjection" | "WorldExtentY"
>;
const radians = (degrees: number) => (degrees * Math.PI) / 180;
const degrees = (radians: number) => (radians * 180) / Math.PI;

/**
 * Latitude of a world northing. The edges are fixed by the frame settings, not
 * by the world's size; the projection decides how degrees spread between them.
 * Equal-area keeps sin(latitude) linear in northing, so high latitudes take
 * less map height. Regions share their parent's frame.
 */
export function latitudeAtY(frame: Frame, worldY: number) {
  // A map without a world frame (an isolated numerical patch) sits at the mid latitude.
  const [south, north] = frame.WorldExtentY ?? [0, 0];
  const fraction =
    north > south ? Math.min(1, Math.max(0, (worldY - south) / (north - south))) : 0.5;
  if (
    frame.LatitudeProjection !== LatitudeProjection.EqualArea ||
    frame.LatitudeSouth === frame.LatitudeNorth
  )
    return frame.LatitudeSouth + (frame.LatitudeNorth - frame.LatitudeSouth) * fraction;
  const low = Math.sin(radians(frame.LatitudeSouth)),
    high = Math.sin(radians(frame.LatitudeNorth));
  return degrees(Math.asin(Math.min(1, Math.max(-1, low + (high - low) * fraction))));
}
/** World northing of a latitude within the frame; the inverse of `latitudeAtY`. */
export function northingAtLatitude(frame: Frame, latitude: number) {
  const [south, north] = frame.WorldExtentY ?? [0, 0];
  const span = frame.LatitudeNorth - frame.LatitudeSouth;
  if (span === 0) return (south + north) / 2;
  const fraction =
    frame.LatitudeProjection === LatitudeProjection.EqualArea
      ? (Math.sin(radians(latitude)) - Math.sin(radians(frame.LatitudeSouth))) /
        (Math.sin(radians(frame.LatitudeNorth)) - Math.sin(radians(frame.LatitudeSouth)))
      : (latitude - frame.LatitudeSouth) / span;
  return south + (north - south) * fraction;
}
/** Mean north–south metres per degree of the frame; Infinity without a world frame. */
export function metresPerDegree(frame: Frame) {
  const [south, north] = frame.WorldExtentY ?? [0, 0],
    span = frame.LatitudeNorth - frame.LatitudeSouth;
  return north > south && span > 0 ? (north - south) / span : Infinity;
}
export function latitudeAt(profile: PhysicalProfile, map: PhysicalField, i: number) {
  return latitudeAtY(profile, map.mesh.y(i) + map.mesh.origin[1]);
}
