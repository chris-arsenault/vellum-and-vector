import { MapScale } from "@atlas/domain";
import type { GenerationState } from "../process";
import { heldFor } from "../poi/poiReads";
import { components } from "./geographicRegions";
import { physicalSampler } from "./physicalMetric";
import { mapScale, rangeSignificance } from "../worldSignificance";
import type { RegionMembers } from "./regionMembers";
import { regionEvidence } from "./worldRegionEvidence";

/**
 * Heights on a ring around each cell. The ring reaches at least one cell spacing, since nearer
 * samples interpolate the cell's own value and cannot measure the terrain around it.
 */
function rings(state: GenerationState) {
  const { map, profile } = state.physical!,
    height = physicalSampler(map.mesh, map.Elevation),
    radius = map.scale.supported(Math.max(profile.ReliefRadius, map.scale.length(0.0125)));
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
  return MapScale.metres(Math.max(...values) - Math.min(...values), "native");
}
/** Whether a cell is mountain land: high, or standing well over the country around it. */
export function mountainTest(state: GenerationState) {
  const { map, profile } = state.physical!,
    ring = rings(state),
    height = (i: number) => MapScale.metres(map.Elevation.get(i) - map.EffectiveSeaLevel, "native");
  return (i: number) =>
    map.WaterKindCodes.get(i) === 0 &&
    (height(i) >= profile.MountainElevation ||
      (height(i) >= profile.HillElevation &&
        localRelief(state, ring, i) >= profile.MountainLocalRelief));
}
/** Whether connected mountain land is great enough to be a range on this map. */
export function isRange(state: GenerationState, members: RegionMembers) {
  const { map, profile } = state.physical!,
    area = members.reduce((sum, i) => sum + map.mesh.contentArea(i), 0);
  if (area < profile.RangeMinimumArea) return null;
  const evidence = regionEvidence(map, members);
  return rangeSignificance(evidence, evidence.relief, evidence.span, mapScale(state)).publish
    ? evidence
    : null;
}
export interface RangeGroup {
  members: Int32Array;
  /** Metres between its highest and lowest ground. */
  relief: number;
}
/** The ranges this map holds, as their cells: what peaks stand among. */
export const rangeGroups = (state: GenerationState): readonly RangeGroup[] =>
  heldFor(state, "ranges", () => {
    const groups: RangeGroup[] = [];
    components(
      state,
      mountainTest(state),
      (members) => {
        const evidence = isRange(state, members);
        if (evidence) groups.push({ members: members.slice(), relief: evidence.relief });
      },
      false,
      true
    );
    return groups;
  });
