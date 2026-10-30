import { requireThat, defaultTerrainCells, type Profile } from "@atlas/domain";
export { defaultWorldDimensions, referenceWorldArea, defaultTerrainCells } from "@atlas/domain";

/** Physical area represented by one World terrain cell, independent of map dimensions. */
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
  const cellAreaKm2 = preset.cellAreaKm2 * profileArea[profile];
  return { cellAreaKm2, cellArea: cellAreaKm2 * 1e6, cellSpan: Math.sqrt(cellAreaKm2 * 1e6) };
}

/** Counts are estimates; boundaries and authored refinement add numerical support. */
export function generationWorkload(
  width: number,
  height: number,
  quality: string,
  profile: Profile = "world"
) {
  const resolution = generationResolution(quality, profile);
  const cells = Math.ceil((width * height) / resolution.cellArea);
  return { ...resolution, cells, aboveDefault: cells > defaultTerrainCells };
}
