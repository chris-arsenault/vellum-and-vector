import { macroComponents } from "./macroRegions";
import { sectionQuantile } from "./macroAxis";
import { branchingSections } from "./macroSkeleton";
import { roundStructuralProfile } from "./macroCurves";
import { addTerrainProfile, profileElevation, fixedTerrain } from "./macroTerrain";
import { Landform, Feature } from "./codes";
import type { GenerationState } from "../process";
import { membershipContour } from "./geographicContours";

/** Compose the broad floors and submerged structural bands around their regional axes. */
export function composeStructuralRegions(state: GenerationState) {
  const work = state.physical!,
    map = work.map;
  composeConstructionRegions(state);
  for (const code of [Landform.Plain, Landform.Basin, Landform.OutwashPlain]) {
    for (const cells of macroComponents(
      map.mesh,
      (i) => map.LandformCodes[i] === code && !map.WaterKindCodes[i] && !fixedTerrain(work, i)
    )) {
      fitRegionalRelief(state, cells, `floor:${code}`, 0.4, 0.7, "replace");
    }
  }
  for (const margin of [1, 2, 3, 4]) {
    for (const cells of macroComponents(
      map.mesh,
      (i) =>
        map.WaterKindCodes[i] === 1 &&
        map.CoastalMarginCodes[i] === margin &&
        map.BathymetricZoneCodes[i] !== 4
    )) {
      fitRegionalRelief(state, cells, `margin:${margin}`, 0.5, 0.6, "replace", true);
    }
  }
  for (const cells of macroComponents(
    map.mesh,
    (i) =>
      map.WaterKindCodes[i] === 1 &&
      map.TectonicBoundaryCodes[i] === 1 &&
      map.BathymetricZoneCodes[i] === 4
  )) {
    fitRegionalRelief(state, cells, "trench", 0.15, 0.7, "lower", true);
  }
}
function composeConstructionRegions(state: GenerationState) {
  const work = state.physical!,
    map = work.map;
  const systems: [string, (i: number) => boolean, number][] = [
    ["rift", (i) => !map.WaterKindCodes[i] && map.TectonicBoundaryCodes[i] === 2, 0.2],
    ["lava", (i) => Boolean(map.FeatureFlags[i] & Feature.LavaPlain), 0.45],
    ["ejecta", (i) => map.ImpactEjectaThickness[i] > 0, 0.5],
  ];
  for (const [id, includes, quantile] of systems)
    for (const cells of macroComponents(map.mesh, includes))
      fitRegionalRelief(state, cells, id, quantile, 0.75, "replace", true);
}
export function fitRegionalRelief(
  state: GenerationState,
  cells: number[],
  id: string,
  quantile: number,
  width: number,
  operation: "replace" | "lower" | "raise",
  relative = false
) {
  if (!cells.length) return;
  const work = state.physical!,
    members = new Set(cells),
    footprint = membershipContour(state, cells, (i) => Number(members.has(i)));
  if (!footprint) return;
  for (const [branch, axis] of branchingSections(
    work.map.mesh,
    cells,
    work.profile.LandformNeighborhoodRadius
  ).entries()) {
    const heights = axis.map((section) => {
      const target = sectionQuantile(section.cells, work.map.Elevation, quantile);
      if (!relative) return profileElevation(work, target);
      const size = section.cells.reduce((sum, i) => sum + work.map.mesh.areas[i], 0),
        mean =
          section.cells.reduce(
            (sum, i) => sum + work.map.Elevation[i] * work.map.mesh.areas[i],
            0
          ) / size,
        delta = target - mean;
      return (operation === "lower" ? Math.min(0, delta) : delta) / 1024;
    });
    addTerrainProfile(
      work,
      roundStructuralProfile(
        {
          id: `${id}:${cells[0]}:${branch}`,
          points: axis.map((section) => section.point),
          widths: axis.map((section) => Math.max(1000, section.width * width)),
          values: { elevation: heights },
          operation: relative ? "offset" : operation,
          strength: 0.45,
          footprint,
          edgeBlend: work.profile.LandformNeighborhoodRadius * 0.5,
        },
        work.profile.LandformNeighborhoodRadius
      )
    );
  }
}
