import { resolutionCells, type MapScale } from "@atlas/domain";
import type { PhysicalProfile } from "../world/profile";

/** Metres of glacial erosion a refined map reads as a fjord's trough. */
export const regionalFjordErosion = (scale: MapScale) => scale.length(0.0000075);

/**
 * The regional reading of the world's extraction thresholds. The mechanisms (prominence,
 * relief rings, range area, landform radius) are the generator's; a region reads them at its
 * own scale: a range is mountain country at a few hundred metres of relief, and a published
 * region must span the physical footprint minimum at this map's cell span.
 */
export function regionalProfile(profile: PhysicalProfile, parentSpan: number, scale: MapScale) {
  profile.ReliefRadius = scale.supported(0.45 * parentSpan, 2);
  profile.LandformNeighborhoodRadius = profile.ReliefRadius;
  profile.MountainElevation = scale.length(0.000075);
  profile.HillElevation = scale.length(0.000075);
  profile.MountainLocalRelief = scale.length(0.0000375);
  // Ridges and passes are read on mountain country, marked by the drainage divides (the
  // world marks them by tectonic influence, which a region does not carry).
  profile.RidgeElevationThreshold = scale.length(0.000075);
  // A region's channels cut below the smoothed base along most of their length and its coast
  // has inlets at every cell: gorges and fjords are the steep, deep and ice-worn exceptions.
  profile.GorgeMinimumSlope = 0.03;
  profile.GorgeMinimumIncision = scale.length(0.000015);
  profile.FjordMinimumGlacialErosion = regionalFjordErosion(scale);
  profile.RangeMinimumArea = scale.cellArea(resolutionCells ** 2);
  profile.PlainSlopeThreshold = 0.012;
  // The wind's terrain smoothing reads the relief at the parent's scale, and a regional range
  // of a few hundred metres blocks the low air as a world range of fifteen hundred does.
  profile.WindTerrainLength = scale.supported(0.5 * parentSpan, 2);
  profile.WindBlockingHeight = scale.length(0.000075);
}
