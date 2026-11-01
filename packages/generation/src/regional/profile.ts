import { resolutionCells } from "@atlas/domain";
import type { PhysicalProfile } from "../canonry/profile";

/**
 * The regional reading of the world's extraction thresholds. The mechanisms (prominence,
 * relief rings, range area, landform radius) are the generator's; a region reads them at its
 * own scale: a summit is named when it stands out against the parent's sample span, a range
 * is mountain country at a few hundred metres of relief, and a published region must span the
 * physical footprint minimum at this map's cell span.
 */
export function regionalProfile(profile: PhysicalProfile, parentSpan: number, cellSpan: number) {
  profile.PeakMinimumProminence = Math.max(50, 0.03 * parentSpan);
  profile.ReliefRadius = Math.max(2 * cellSpan, 0.45 * parentSpan);
  profile.LandformNeighborhoodRadius = profile.ReliefRadius;
  profile.MountainElevation = 300;
  profile.HillElevation = 300;
  profile.MountainLocalRelief = 150;
  // Ridges and passes are read on mountain country, marked by the drainage divides (the
  // world marks them by tectonic influence, which a region does not carry).
  profile.RidgeElevationThreshold = 300;
  // A region's channels cut below the smoothed base along most of their length and its coast
  // has inlets at every cell: gorges and fjords are the steep, deep and ice-worn exceptions.
  profile.GorgeMinimumSlope = 0.03;
  profile.GorgeMinimumIncision = 60;
  profile.FjordMinimumGlacialErosion = 30;
  profile.RangeMinimumArea = (resolutionCells * cellSpan) ** 2;
  profile.PlainSlopeThreshold = 0.012;
  // The wind's terrain smoothing reads the relief at the parent's scale, and a regional range
  // of a few hundred metres blocks the low air as a world range of fifteen hundred does.
  profile.WindTerrainLength = Math.max(2 * cellSpan, 0.5 * parentSpan);
  profile.WindBlockingHeight = 300;
}
