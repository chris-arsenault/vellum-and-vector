import { meshDeltaX } from "./mesh";
import { spatial, point, unwrapCoordinates, canonicalGeometry } from "@atlas/domain";
import { nativePosition } from "./atlasWorkspace";
import type { Geometry } from "geojson";
import type { GenerationState } from "../process";
import { components, publishPlace } from "./geographicRegions";
import { Landform } from "./codes";
import { prominence } from "./landforms";
import { physicalSampler } from "./physicalMetric";
import { releaseWorking } from "./physicalNumerics";
import { generationFeature } from "../generationFeatures";
import { isWorldGeography, rangeSignificance } from "../worldSignificance";
import { regionEvidence } from "./worldRegionEvidence";
import { significantSummit, worldGorgeLength, worldGorgeRelief } from "./worldSiteEvidence";

/**
 * Heights on a ring around each cell. The ring reaches at least one cell spacing, since nearer
 * samples interpolate the cell's own value and cannot measure the terrain around it.
 */
function rings(state: GenerationState) {
  const { map, profile } = state.physical!,
    height = physicalSampler(map.mesh, map.Elevation),
    radius = Math.max(profile.ReliefRadius, map.mesh.spacing, isWorldGeography(state) ? 50_000 : 0);
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
/** Metres the lower flank of the best cross-section stands above the cell. */
function valleyDepth(state: GenerationState, ring: (i: number) => number[], i: number) {
  const values = ring(i),
    floor = state.physical!.map.Elevation.get(i);
  let depth = -Infinity;
  for (let direction = 0; direction < 8; direction++) {
    const [left, right] = [values[direction], values[direction + 8]];
    if (Number.isFinite(left) && Number.isFinite(right))
      depth = Math.max(depth, Math.min(left, right) - floor);
  }
  return depth / 1024;
}
/**
 * Peaks by prominence and mountain ranges as connected mountain land, read from the generated
 * surface. Valleys follow the published rivers; see `extractValleys`.
 */
export function extractReliefFeatures(state: GenerationState) {
  const dry = state.surface.ocean
    ? spatial.differenceFrom(state.surface.ocean)
    : (shape: Geometry): Geometry | null => shape;
  const { map, profile } = state.physical!,
    ring = rings(state),
    rise = prominence(map),
    land = (i: number) => map.WaterKindCodes.get(i) === 0,
    height = (i: number) => (map.Elevation.get(i) - map.EffectiveSeaLevel) / 1024;
  components(
    state,
    (i) => map.LandformCodes.get(i) === Landform.Peak,
    (members) => {
      const summit = members.reduce((best, i) => (rise.get(i) > rise.get(best) ? i : best));
      if (isWorldGeography(state) && !significantSummit(state, summit, rise.get(summit) / 1024))
        return;
      publishPlace(
        state,
        "peak",
        "Peak",
        members,
        "geology",
        { prominence: rise.get(summit) / 1024 },
        undefined,
        {
          geometry: point(nativePosition(state.physical!, summit)),
          anchor: summit,
          meaning: "prominent summit",
        }
      );
    }
  );
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
      if (
        isWorldGeography(state) &&
        !rangeSignificance(evidence, evidence.relief, evidence.span).publish
      )
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
    isWorldGeography(state) ? 0 : Infinity
  );
  releaseWorking(map, rise);
}
/**
 * Valleys along published rivers: each run of a reach whose flanks stand at least the minimum
 * depth above the channel for the minimum length. The corridor reaches the flank-measuring
 * distance either side of the river's own line, so the river runs along its middle.
 */
export function extractValleys(
  state: GenerationState,
  reaches: Iterable<{ members: number[]; featureIds: string[] }>
) {
  const { map, profile } = state.physical!,
    ring = rings(state),
    halfWidth = Math.max(profile.ReliefRadius, map.mesh.spacing),
    [x0, y0] = map.mesh.origin;
  for (const { members, featureIds } of reaches) {
    const rivers = featureIds
      .map((id) => generationFeature(state, id)?.geometry)
      .filter((geometry): geometry is Geometry => !!geometry);
    if (!rivers.length) continue;
    const corridor = spatial.buffer(spatial.unionAll(rivers), halfWidth);
    for (const run of incisedRuns(state, ring, members)) {
      const line: Geometry = {
          type: "LineString",
          coordinates: unwrapCoordinates(
            run.map((i) => [x0 + map.mesh.x(i), y0 + map.mesh.y(i)]),
            map.mesh.periodic?.width
          ),
        },
        buffer = corridor && spatial.buffer(line, map.mesh.spacing),
        extent = buffer && canonicalGeometry(state.domain.world.reference, buffer),
        shape = extent && spatial.intersection(corridor!, extent),
        surface = shape && valleySurface(state, shape);
      if (!surface) continue;
      const depth = run.reduce((sum, i) => sum + valleyDepth(state, ring, i), 0) / run.length;
      publishPlace(
        state,
        "valley",
        "Valley",
        run,
        "geology",
        { depth, rivers: featureIds },
        surface
      );
    }
  }
}
function valleySurface(state: GenerationState, shape: Geometry) {
  const land = state.surface.ocean ? spatial.difference(shape, state.surface.ocean) : shape;
  return land && spatial.intersection(land, state.domain.scope.footprint);
}
/** Consecutive incised cells of a source-to-mouth reach, kept when long enough to name. */
function incisedRuns(state: GenerationState, ring: (i: number) => number[], members: number[]) {
  const { map, profile } = state.physical!,
    runs: number[][] = [];
  let run: number[] = [];
  const close = () => {
    let length = 0;
    for (let k = 1; k < run.length; k++)
      length += Math.hypot(
        meshDeltaX(map.mesh, map.mesh.x(run[k]) - map.mesh.x(run[k - 1])),
        map.mesh.y(run[k]) - map.mesh.y(run[k - 1])
      );
    const minimum = isWorldGeography(state) ? worldGorgeLength : profile.ValleyMinimumLength;
    if (run.length > 1 && length >= minimum) runs.push(run);
    run = [];
  };
  for (const i of members)
    if (
      map.WaterKindCodes.get(i) === 0 &&
      valleyDepth(state, ring, i) >=
        (isWorldGeography(state) ? worldGorgeRelief : profile.ValleyMinimumDepth)
    )
      run.push(i);
    else close();
  close();
  return runs;
}
