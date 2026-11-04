import { spatial } from "@atlas/domain";
import type { Geometry } from "geojson";
import type { GenerationState } from "../process";
import { components, publishPlace } from "./geographicRegions";
import { prominence } from "./landforms";
import { physicalSampler } from "./physicalMetric";
import { releaseWorking } from "./physicalNumerics";
import { mapScale, rangeSignificance } from "../worldSignificance";
import { regionEvidence } from "./worldRegionEvidence";

/**
 * Heights on a ring around each cell. The ring reaches at least one cell spacing, since nearer
 * samples interpolate the cell's own value and cannot measure the terrain around it.
 */
function rings(state: GenerationState) {
  const { map, profile } = state.physical!,
    height = physicalSampler(map.mesh, map.Elevation),
    radius = Math.max(profile.ReliefRadius, map.mesh.spacing, 50_000 * mapScale(state).length);
  return (i: number) => {
    const values: number[] = [],
      x = map.mesh.x(i),
      y = map.mesh.y(i);
    for (let direction = 0; direction < 16; direction++) {
      const angle = (direction * Math.PI) / 8;
      values.push(height(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius));
    }
    return values;
  };
}
/** Metres between the highest and lowest terrain within the relief radius. */
function localRelief(state: GenerationState, ring: (i: number) => number[], i: number) {
  const values = [state.physical!.map.Elevation.get(i), ...ring(i).filter(Number.isFinite)];
  return (Math.max(...values) - Math.min(...values)) / 1024;
}
/** Mountain ranges as connected mountain land, read from the generated surface. */
export function extractRanges(state: GenerationState) {
  const dry = state.surface.ocean
    ? spatial.differenceFrom(state.surface.ocean)
    : (shape: Geometry): Geometry | null => shape;
  const { map, profile } = state.physical!,
    ring = rings(state),
    rise = prominence(map),
    land = (i: number) => map.WaterKindCodes.get(i) === 0,
    height = (i: number) => (map.Elevation.get(i) - map.EffectiveSeaLevel) / 1024;
  const mountain = (i: number) =>
    land(i) &&
    (height(i) >= profile.MountainElevation ||
      (height(i) >= profile.HillElevation &&
        localRelief(state, ring, i) >= profile.MountainLocalRelief));
  components(
    state,
    mountain,
    (members, extent) => {
      const area = members.reduce((sum, i) => sum + map.mesh.contentArea(i), 0),
        surface = extent && dry(extent);
      if (area < profile.RangeMinimumArea || !surface) return;
      const evidence = regionEvidence(map, members);
      if (!rangeSignificance(evidence, evidence.relief, evidence.span, mapScale(state)).publish)
        return;
      const summits = members.filter(
        (i) => rise.get(i) >= profile.PeakMinimumProminence * 1024
      ).length;
      publishPlace(
        state,
        "range",
        "Range",
        members,
        "geology",
        { summits, area: spatial.area(surface) },
        surface
      );
    },
    true,
    true
  );
  releaseWorking(map, rise);
}
