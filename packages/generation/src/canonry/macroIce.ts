import type { GenerationState } from "../process";
import type { AtlasPhysicalWorkspace } from "./atlasWorkspace";
import { macroComponents, reconstructRegion } from "./macroRegions";
import { fitRegionalRelief } from "./macroStructures";
import { Landform } from "./codes";
import { fixedTerrain } from "./macroTerrain";
import { branchingSections } from "./macroSkeleton";
import { roundStructuralProfile } from "./macroCurves";
import { membershipContour } from "./geographicContours";
import { addTerrainProfile, profileElevation } from "./macroTerrain";
import { sectionQuantile } from "./macroAxis";
import type { LandscapeProfile } from "./landscapeProfiles";

export function composeGlacialLandforms(state: GenerationState) {
  const map = state.physical!.map;
  const glacial = new Set([Landform.UValley, Landform.Cirque, Landform.Fjord]);
  for (const cells of macroComponents(
    map.mesh,
    (i) => glacial.has(map.LandformCodes[i]) || map.CumulativeGlacialErosion[i] > 20 * 1024
  ))
    fitGlacialSystem(state, cells);
  for (const cells of macroComponents(map.mesh, (i) => map.LandformCodes[i] === Landform.Moraine))
    fitRegionalRelief(state, cells, "moraine", 0.8, 0.95, "raise");
  for (const [id, includes] of [
    ["floodplain", (i: number) => map.FloodplainIntensity[i] > 0],
    ["delta", (i: number) => map.DeltaIntensity[i] > 0],
  ] as const)
    for (const cells of macroComponents(map.mesh, includes))
      fitRegionalRelief(state, cells, id, 0.35, 0.85, "replace");
}
function fitGlacialSystem(state: GenerationState, cells: number[]) {
  const work = state.physical!,
    mesh = work.map.mesh,
    members = new Set(cells),
    footprint = membershipContour(state, cells, (i) => Number(members.has(i)));
  if (!footprint) return;
  for (const [branch, axis] of branchingSections(
    mesh,
    cells,
    work.profile.LandformNeighborhoodRadius
  ).entries()) {
    if (axis.length < 2) continue;
    const floors = axis.map((s) =>
      profileElevation(work, sectionQuantile(s.cells, work.map.Elevation, 0.18))
    ), profile: LandscapeProfile = {
      id: `glacial-system:${cells[0]}:${branch}`, points: axis.map((s) => s.point),
      widths: axis.map((s) => s.width), values: {elevation: floors}, flat: 0.4,
      operation: "lower", footprint, edgeBlend: work.profile.LandformNeighborhoodRadius * 0.3,
    }, pins = hangingJunction(work, axis, profile, branch);
    addTerrainProfile(
      work,
      roundStructuralProfile(
        profile, work.profile.LandformNeighborhoodRadius, pins
      )
    );
  }
}
function hangingJunction(work: AtlasPhysicalWorkspace, axis: {cells: number[]}[],
  profile: LandscapeProfile, branch: number) {
  if (!branch) return [];
  const erosion = (cells: number[]) => cells.reduce((sum, i) => sum + work.map.CumulativeGlacialErosion[i], 0) / cells.length,
    floors = profile.values.elevation;
  if (floors[1] - floors[0] < 150 || erosion(axis[0].cells) <= erosion(axis[1].cells) * 2) return [];
  const [a, b] = profile.points;
  profile.points.splice(1, 0, [a[0] * 0.85 + b[0] * 0.15, a[1] * 0.85 + b[1] * 0.15]);
  profile.widths.splice(1, 0, profile.widths[0] * 0.85 + profile.widths[1] * 0.15);
  floors.splice(1, 0, floors[1]);
  return [1];
}

/** Reconstruct present ice bodies by redistributing their represented ice volume. */
export function composeIceBodies(work: AtlasPhysicalWorkspace) {
  const map = work.map,
    mesh = map.mesh;
  for (const water of [0, 1, 2]) {
    const original = Uint8Array.from(map.IceThickness, (value, i) =>
        Number(value > 50 && map.WaterKindCodes[i] === water && !fixedTerrain(work, i))
      ),
      admits = (i: number) =>
        map.WaterKindCodes[i] === water &&
        map.Temperature[i] <= 310 &&
        map.Geothermal[i] < 500 &&
        !fixedTerrain(work, i),
      region = reconstructRegion(mesh, original, admits, 30_000);
    fitIceVolume(work, original, region);
  }
}
function fitIceVolume(work: AtlasPhysicalWorkspace, original: Uint8Array,
  region: {mask: Uint8Array; source: Int32Array}) {
  const map = work.map, mesh = map.mesh, before = map.IceThickness.slice();
  for (const cells of macroComponents(mesh, (i) => Boolean(original[i] || region.mask[i]))) {
    if (!cells.some((i) => Boolean(region.mask[i]))) continue;
    const volume = cells.reduce((sum, i) => sum + before[i] * mesh.areas[i], 0);
    for (const i of cells) {
      const donor = region.source[i];
      map.IceThickness[i] = region.mask[i] ? Math.max(before[i], donor >= 0 ? before[donor] : 0) : 0;
    }
    const target = cells.reduce((sum, i) => sum + map.IceThickness[i] * mesh.areas[i], 0);
    if (target > 0) for (const i of cells) map.IceThickness[i] *= volume / target;
  }
}
