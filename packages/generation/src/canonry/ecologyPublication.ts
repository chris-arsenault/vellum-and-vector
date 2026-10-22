import { categoryRegions, type BiomePoint, type BiomeSamples, type Grid } from "@atlas/domain";
import type { AtlasPhysicalWorkspace } from "./atlasWorkspace";
import { environment } from "./ecologyEnvironment";
import type { PhysicalArrayName } from "./continuousState";

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
  if (!grid.channels.biome) return;
  const map = work.map,
    n = map.mesh.count;
  const biome: BiomeSamples = {
    values: {},
    prepared: {},
    seaLevel: (map.EffectiveSeaLevel - map.BaseSeaLevel) / 1024,
    lakes: [],
    protectedMask: new Uint8Array(n),
    protectedCodes: map.BiomeCodes,
    codes: [],
    protectedRegions: [],
  };
  const inputs: Record<string, [PhysicalArrayName, number, number]> = {
    temperature: ["Temperature", 0.1, -30],
    elevation: ["Elevation", 1 / 1024, -map.BaseSeaLevel / 1024],
    water: ["WaterKindCodes", 1, 0],
    depth: ["WaterDepths", 1 / 1024, 0],
    ice: ["IceThickness", 1, 0],
    wetness: ["EcologicalWetness", 1, 0],
    moisture: ["EcologicalMoisture", 1, 0],
    trees: ["TreeCover", 1, 0],
    grass: ["GrassCover", 1, 0],
    wetland: ["WetlandCover", 1, 0],
    altered: ["AlteredCover", 1, 0],
    juvenileAltered: ["AlteredSaplings", 1, 0],
    conifer: ["ConiferCover", 1, 0],
    broadleaf: ["BroadleafCover", 1, 0],
  };
  for (const [name, [native, scale, offset]] of Object.entries(inputs)) {
    biome.values[name] = map[native];
    biome.prepared[name] = {
      coefficients: map.continuous!.coefficients[native],
      adaptive: map.continuous!.adaptive[native],
      transform: { scale, offset },
    };
  }
  protectBiome(work, biome);
  (grid.geography ??= {}).biome = biome;
}
function protectBiome(work: AtlasPhysicalWorkspace, biome: BiomeSamples) {
  for (const fixed of work.fixed) {
    if (fixed.binding.native !== "BiomeCodes") continue;
    if (fixed.source)
      for (const [code, footprint] of categoryRegions(fixed.source, "biome", fixed.footprint))
        biome.protectedRegions!.push({ code, footprint });
    for (let i = 0; i < fixed.values.length; i++)
      if (Number.isFinite(fixed.values[i])) biome.protectedMask[i] = 1;
  }
}
