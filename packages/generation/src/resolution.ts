import { MapScale, requireThat, defaultTerrainCells, type Profile } from "@atlas/domain";
export { defaultWorldDimensions, referenceWorldArea, defaultTerrainCells } from "@atlas/domain";

/**
 * Ground one World terrain cell represents, whatever the map's dimensions.
 *
 * owner-direction(2026-11-12): the resolutions are fixed; a detail level is not a cell count.
 */
export const atlasQuality = {
  draft: { cellAreaKm2: 800 },
  standard: { cellAreaKm2: 200 },
  fine: { cellAreaKm2: 50 },
};
/** Each finer creation profile resolves ten times smaller linear distances. */
const profileArea: Record<Profile, number> = {
  world: 1,
  region: 0.01,
  local: 0.0001,
  site: 0.000001,
  interior: 0.00000001,
};

export function generationResolution(quality: string, profile: Profile = "world") {
  const preset = atlasQuality[quality as keyof typeof atlasQuality];
  requireThat(preset, "generation_quality", "Choose draft, standard or fine detail.");
  const cellAreaKm2 = preset.cellAreaKm2 * profileArea[profile],
    cellArea = MapScale.areaUnits(cellAreaKm2, "km2", "m2");
  return { cellAreaKm2, cellArea, cellSpan: Math.sqrt(cellArea) };
}

/** Counts are estimates; boundaries and authored refinement add numerical support. */
export function generationWorkload(
  width: number,
  height: number,
  quality: string,
  profile: Profile = "world"
) {
  const resolution = generationResolution(quality, profile),
    cells = Math.ceil((width * height) / resolution.cellArea);
  return { ...resolution, cells, aboveDefault: cells > defaultTerrainCells };
}
