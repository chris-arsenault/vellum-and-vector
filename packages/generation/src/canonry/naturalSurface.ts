import { biomes, naturalSurfaceNames, surfaceCode } from "@atlas/domain";
import type { GenerationState } from "../process";
import type { PhysicalField } from "./field";
import { Feature, Landform } from "./codes";

function frozenNeighbor(map: PhysicalField, i: number) {
  for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
    const j = map.mesh.neighbors[i * map.mesh.stride + edge];
    if (j >= 0 && map.WaterKindCodes[j] === 1 && map.IceThickness[j] >= 50) return true;
  }
  return false;
}
function oceanSurface(map: PhysicalField, i: number): (typeof naturalSurfaceNames)[number] {
  const special = specialOcean(map, i);
  if (special) return special;
  const frozen = frozenOcean(map, i);
  if (frozen) return frozen;
  if (
    map.BathymetricZoneCodes[i] === 4 &&
    [1, 2].includes(map.TectonicBoundaryCodes[i]) &&
    map.TectonicStrain[i] >= 430
  )
    return "Trench";
  // Cold deep water at the surface, whether a gyre's eastern boundary or a Pressure front.
  if (map.Upwelling[i] >= 450) return "Upwelling water";
  // Only an intensified boundary current reads as a channel; open-ocean drift is "Ocean".
  if (map.OceanCurrentStrength[i] >= 780) return "Current channel";
  return [2, 3].includes(map.BathymetricZoneCodes[i]) ? "Shelf" : "Ocean";
}
function specialOcean(map: PhysicalField, i: number): (typeof naturalSurfaceNames)[number] | null {
  if (map.DeltaIntensity[i] > 0) return "Delta";
  if (map.LandformCodes[i] === Landform.Fjord) return "Fjord";
  const shallow = [2, 3].includes(map.BathymetricZoneCodes[i]);
  if (
    shallow &&
    map.WaterDepths[i] <= 160 * 1024 &&
    (map.Temperature[i] >= 260 || map.OceanCurrentHeat[i] >= 420) &&
    map.Geothermal[i] >= 60
  )
    return "Reef";
  return null;
}
function frozenOcean(map: PhysicalField, i: number): (typeof naturalSurfaceNames)[number] | null {
  const shallow = [2, 3].includes(map.BathymetricZoneCodes[i]);
  if (shallow && map.IceThickness[i] >= 75) return "Ice shelf";
  if (map.FeatureFlags[i] & Feature.PermanentSeaIce) return "Pack ice";
  if (map.FeatureFlags[i] & Feature.PermanentIceMargin || map.IceThickness[i] >= 50)
    return "Sea ice";
  if (frozenNeighbor(map, i)) return "Polynya";
  return null;
}
function landClimate(map: PhysicalField, i: number): (typeof naturalSurfaceNames)[number] {
  const biome = biomes[map.BiomeCodes[i]]?.name;
  const ecological = naturalSurfaceNames.find((name) => name === biome);
  if (ecological) return ecological;
  return legacyLandClimate(map, i);
}
function legacyLandClimate(map: PhysicalField, i: number): (typeof naturalSurfaceNames)[number] {
  if (map.Temperature[i] >= 335 && map.Moisture[i] >= 260) return "Open field";
  if (map.Moisture[i] >= 620) return "Wet tundra";
  if (map.Temperature[i] <= 255 && map.Moisture[i] <= 210) return "Polar barrens";
  if (
    map.Temperature[i] >= 235 &&
    map.Moisture[i] >= 150 &&
    map.Moisture[i] <= 520 &&
    map.Slope[i] <= 0.0042
  )
    return "Cold steppe";
  return "Tundra";
}
/**
 * Living cover is the land surface; bare relief shows only where the ground is bare. The
 * generated biome already follows slope and soil, so a wooded ridge reads as its forest
 * and a rock ridge as rock, instead of every cell near a river or on a ridge losing its
 * cover to a relief label.
 */
function landRelief(map: PhysicalField, i: number): (typeof naturalSurfaceNames)[number] {
  const bare = map.TreeCover[i] + map.GrassCover[i] + map.WetlandCover[i] < 0.12;
  // Bare coastal lowland the sea has washed at some point: seabed left dry, not a desert coast.
  if (bare && map.BathymetricZoneCodes[i] === 1 && map.WaveExposureHistory[i] > 0)
    return "Exposed shelf";
  if (bare && map.Slope[i] >= 0.0235) return "Scree field";
  if (
    bare &&
    [Landform.Ridge, Landform.Peak, Landform.Pass, Landform.ImpactRim].includes(
      map.LandformCodes[i]
    )
  )
    return "Ridge";
  if (!map.EcologyInitialized && map.RiverOrders[i] >= 1) return "River valley";
  return landClimate(map, i);
}
function landSurface(map: PhysicalField, i: number): (typeof naturalSurfaceNames)[number] {
  const fluvial = fluvialSurface(map, i);
  if (fluvial) return fluvial;
  if (map.WaterKindCodes[i] === 2) return "Lake";
  if (map.LandformCodes[i] === Landform.Moraine) return "Moraine";
  if (map.IceThickness[i] >= 300) return "Glacier";
  if (map.IceThickness[i] >= 250) return "Snowfield";
  return landRelief(map, i);
}
function fluvialSurface(
  map: PhysicalField,
  i: number
): (typeof naturalSurfaceNames)[number] | null {
  if (map.DeltaIntensity[i] > 0) return "Delta";
  if (map.LandformCodes[i] === Landform.Waterfall) return "Waterfall";
  if (map.LandformCodes[i] === Landform.Gorge) return "Gorge";
  // A river carrying a wellspring's warmth stays open and green through the cold.
  if (map.RiverOrders[i] >= 1 && map.RiverWarmth[i] >= 50) return "Warm-water reach";
  // Only a trunk river's channel is wider than the cover around it at mesh scale.
  if (map.RiverChannelStrength[i] > 0 && map.RiverOrders[i] >= 4) return "River channel";
  if (map.FloodplainIntensity[i] >= 250) return "Floodplain";
  return null;
}
export function classifyNaturalSurface(state: GenerationState) {
  const { map, magic } = state.physical!;
  if (!magic) return;
  for (let i = 0; i < map.mesh.count; i++)
    magic.naturalSurface[i] = surfaceCode(
      map.WaterKindCodes[i] === 1 ? oceanSurface(map, i) : landSurface(map, i)
    );
  magic.finalSurface.set(magic.naturalSurface);
}
