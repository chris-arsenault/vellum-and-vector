import type { PhysicalField } from "./field";
import type { PhysicalProfile } from "./profile";

/** Latitude is linear in the world frame's northing, so regions share their parent's. */
export function latitudeAtY(profile: PhysicalProfile, worldY: number) {
  // A map without a world frame (an isolated numerical patch) sits at the mid latitude.
  const [south, north] = profile.WorldExtentY ?? [0, 0];
  const fraction =
    north > south ? Math.min(1, Math.max(0, (worldY - south) / (north - south))) : 0.5;
  return profile.LatitudeSouth + (profile.LatitudeNorth - profile.LatitudeSouth) * fraction;
}
export function latitudeAt(profile: PhysicalProfile, map: PhysicalField, i: number) {
  return latitudeAtY(profile, map.mesh.y[i] + map.mesh.origin[1]);
}
