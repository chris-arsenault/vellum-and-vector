import { spatial } from "@atlas/domain";
import type { Geometry } from "geojson";
import type { GenerationState } from "../process";
import { heldFor, releaseHeld } from "../poi/poiReads";
import { peakTops } from "../poi/relief/peakTops";
import { components, publishPlace } from "./geographicRegions";
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
/** Whether a cell is mountain land: high, or standing well over the country around it. */
function mountainTest(state: GenerationState) {
  const { map, profile } = state.physical!,
    ring = rings(state),
    height = (i: number) => (map.Elevation.get(i) - map.EffectiveSeaLevel) / 1024;
  return (i: number) =>
    map.WaterKindCodes.get(i) === 0 &&
    (height(i) >= profile.MountainElevation ||
      (height(i) >= profile.HillElevation &&
        localRelief(state, ring, i) >= profile.MountainLocalRelief));
}
/** Whether connected mountain land is great enough to be a range on this map. */
function isRange(state: GenerationState, members: RegionMembers) {
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
/** Mountain ranges as connected mountain land, read from the generated surface. */
export function extractRanges(state: GenerationState) {
  releaseHeld(state);
  const dry = state.surface.ocean
      ? spatial.differenceFrom(state.surface.ocean)
      : (shape: Geometry): Geometry | null => shape,
    tops = peakTops(state);
  components(
    state,
    mountainTest(state),
    (members, extent) => {
      const surface = extent && dry(extent);
      if (!surface || !isRange(state, members)) return;
      publishPlace(
        state,
        "range",
        "Range",
        members,
        "geology",
        { peaks: members.filter((i) => tops.has(i)).length, area: spatial.area(surface) },
        surface
      );
    },
    true,
    true
  );
}
