import { chartCopies, point } from "@atlas/domain";
import type { GenerationState } from "../process";
import { fallsSignificance, summitSignificance, worldPeakIsolation } from "../worldSignificance";
import { nativePosition } from "./atlasWorkspace";
import { physicalDistance } from "./physicalMetric";
import { meshWindowCells } from "./meshWindow";
import { regionEvidence } from "./worldRegionEvidence";
import type { RegionMembers } from "./regionMembers";

/** Isolation only needs searching as far as the World qualification distance. */
export function significantSummit(state: GenerationState, summit: number, prominence: number) {
  const work = state.physical!,
    map = work.map,
    radius = worldPeakIsolation;
  let isolation = radius;
  for (const copy of chartCopies(
    state.domain.world.reference,
    point(nativePosition(work, summit))
  )) {
    if (copy.type !== "Point") continue;
    const [x, y] = copy.coordinates;
    for (const i of meshWindowCells(map.mesh, [x - radius, y - radius, x + radius, y + radius]))
      if (map.Elevation.get(i) > map.Elevation.get(summit))
        isolation = Math.min(isolation, physicalDistance(map.mesh, i, summit));
  }
  return summitSignificance(prominence, isolation).publish;
}

/** World landforms need their actual distinguishing mechanism as well as extent. */
export function significantLandform(state: GenerationState, kind: string, members: RegionMembers) {
  const map = state.physical!.map;
  if (kind === "waterfall") {
    for (const i of members) {
      const target = map.FlowTargets.get(i);
      if (
        target >= 0 &&
        fallsSignificance(
          (map.Elevation.get(i) - map.Elevation.get(target)) / 1024,
          map.FlowAccumulation.get(i)
        ).publish
      )
        return true;
    }
    return false;
  }
  const evidence = regionEvidence(map, members);
  if (kind === "gorge")
    return evidence.span >= worldGorgeLength && evidence.relief >= worldGorgeRelief;
  if (kind === "fjord")
    return evidence.span >= worldFjordLength && evidence.breadth >= worldFjordBreadth;
  return evidence.area >= worldGlacialComplexArea && evidence.relief >= worldGlacialComplexRelief;
}
/** Connected incised courses need a substantial longitudinal form. */
export const worldGorgeLength = 100_000;
export const worldGorgeRelief = 300;
/** A major glacial inlet may be narrow but must extend well beyond a coastal notch. */
export const worldFjordLength = 80_000;
export const worldFjordBreadth = 8_000;
/** Ordinary cirques and moraine ridges are local; extensive relief complexes can be global. */
export const worldGlacialComplexArea = 8e9;
export const worldGlacialComplexRelief = 300;
