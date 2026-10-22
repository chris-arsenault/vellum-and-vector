import { biomeInputs, type BiomePoint, type BiomeSamples, type Grid } from "@atlas/domain";
import type { AtlasPhysicalWorkspace } from "./atlasWorkspace";
import { environment } from "./ecologyEnvironment";
import { physicalSupport } from "./physicalSupport";

export function ecologyPoint(work: AtlasPhysicalWorkspace, i: number): BiomePoint {
  const m = work.map,
    e = environment(m, i);
  return {
    temperature: e.temperature,
    water: e.water,
    depth: e.depth,
    ice: m.IceThickness[i],
    wetness: e.wetness,
    moisture: e.moisture,
    trees: m.TreeCover[i],
    grass: m.GrassCover[i],
    wetland: m.WetlandCover[i],
    altered: m.AlteredCover[i],
    juvenileAltered: m.AlteredSaplings[i],
    conifer: m.ConiferCover[i],
    broadleaf: m.BroadleafCover[i],
  };
}
export function projectEcologySupport(work: AtlasPhysicalWorkspace, grid: Grid) {
  if (work.map.mesh.topology || !grid.channels.biome) return;
  const map = work.map,
    n = map.mesh.count;
  const biome: BiomeSamples = {
    values: {},
    seaLevel: (map.EffectiveSeaLevel - map.BaseSeaLevel) / 1024,
    lakes: [],
    protectedMask: new Uint8Array(n),
    protectedCodes: Float64Array.from(map.BiomeCodes),
    codes: [],
  };
  for (const name of biomeInputs) biome.values[name] = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = ecologyPoint(work, i);
    for (const name of biomeInputs) biome.values[name][i] = p[name];
  }
  biome.values.elevation = Float64Array.from(
    map.Elevation,
    (value) => (value - map.BaseSeaLevel) / 1024
  );
  protectBiome(work, biome);
  grid.reconstruction ??= { support: physicalSupport(map.mesh), channels: {} };
  grid.reconstruction.biome = biome;
}
function protectBiome(work: AtlasPhysicalWorkspace, biome: BiomeSamples) {
  for (const fixed of work.fixed) {
    if (fixed.binding.native !== "BiomeCodes") continue;
    for (let i = 0; i < fixed.values.length; i++)
      if (Number.isFinite(fixed.values[i])) biome.protectedMask[i] = 1;
  }
}
