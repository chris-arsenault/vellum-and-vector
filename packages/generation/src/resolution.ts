import { MapScale, requireThat, defaultTerrainCells, type Profile } from "@atlas/domain";
export { defaultWorldDimensions, referenceWorldArea, defaultTerrainCells } from "@atlas/domain";

/** Detail selects work on each independent map; its actual frame supplies physical cell size. */
export const atlasQuality = {
  draft: { cells: defaultTerrainCells / 4 },
  standard: { cells: defaultTerrainCells },
  fine: { cells: defaultTerrainCells * 4 },
};

export function generationResolution(quality: string, _profile: Profile, scale: MapScale) {
  const preset = atlasQuality[quality as keyof typeof atlasQuality];
  requireThat(preset, "generation_quality", "Choose draft, standard or fine detail.");
  return scale.resolution(preset.cells);
}

/** Counts are estimates; boundaries and authored refinement add numerical support. */
export function generationWorkload(
  width: number,
  height: number,
  quality: string,
  profile: Profile = "world"
) {
  const scale = MapScale.fromCells([0, 0, width, height], defaultTerrainCells),
    resolution = generationResolution(quality, profile, scale),
    cells = atlasQuality[quality as keyof typeof atlasQuality].cells;
  return { ...resolution, cells, aboveDefault: cells > defaultTerrainCells };
}
