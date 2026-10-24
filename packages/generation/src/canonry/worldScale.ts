import type { PhysicalField } from "./field";
import type { PhysicalProfile } from "./profile";
import type { Bounds } from "@atlas/domain";
import { referenceWorldArea } from "../resolution";

export const referenceLandArea = referenceWorldArea * 0.48;
export const referenceOceanArea = referenceWorldArea * 0.52;
/** Coastal impulse prevalence is expressed per 20,000 km of shoreline. */
export const referenceCoastLength = 20_000_000;

/** Prevalence budgets are stated per reference World area, never per mesh cell. */
export function areaBudget(budget: number, area: number, referenceArea = referenceWorldArea) {
  return budget <= 0 || area <= 0 ? 0 : Math.max(1, Math.round((budget * area) / referenceArea));
}
export function mediumArea(map: PhysicalField, includes: (i: number) => boolean = () => true) {
  let area = 0;
  for (let i = 0; i < map.mesh.contentCount; i++) if (includes(i)) area += map.mesh.contentAreas[i];
  return area;
}

/** Broad continental shape follows province scale; physical landform widths retain metres. */
export function continentalWorldProfile(profile: PhysicalProfile, bounds: Bounds): PhysicalProfile {
  const area = (bounds[2] - bounds[0]) * (bounds[3] - bounds[1]);
  const scale = Math.sqrt(area / profile.TectonicProvinceCount / (referenceWorldArea / 42));
  return {
    ...profile,
    ContinentalWarpScale: profile.ContinentalWarpScale * scale,
    ContinentalWarpStrength: profile.ContinentalWarpStrength * scale,
    ContinentalTransitionWidth: profile.ContinentalTransitionWidth * scale,
  };
}
