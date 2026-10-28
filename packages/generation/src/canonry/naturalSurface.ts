import { biomes, naturalSurfaceNames, surfaceCode } from "@atlas/domain";
import type { GenerationState } from "../process";
import type { PhysicalField } from "./field";
import { Feature, Landform } from "./codes";

type Surface = (typeof naturalSurfaceNames)[number];
function frozenNeighbor(map: PhysicalField, i: number) {
  for (let edge = 0; edge < map.mesh.degree(i); edge++) {
    const j = map.mesh.neighbor(i, edge);
    if (j >= 0 && map.WaterKindCodes.get(j) === 1 && map.IceThickness.get(j) >= 50) return true;
  }
  return false;
}
function oceanSurface(map: PhysicalField, i: number): Surface {
  const special = specialOcean(map, i);
  if (special) return special;
  const frozen = frozenOcean(map, i);
  if (frozen) return frozen;
  const zone = map.BathymetricZoneCodes.get(i);
  if (
    zone === 4 &&
    [1, 2].includes(map.TectonicBoundaryCodes.get(i)) &&
    map.TectonicStrain.get(i) >= 430
  )
    return "Trench";
  // Cold deep water at the surface, whether a gyre's eastern boundary or a Pressure front.
  if (map.Upwelling.get(i) >= 450) return "Upwelling water";
  // Only an intensified boundary current reads as a channel; open-ocean drift is "Ocean".
  if (map.OceanCurrentStrength.get(i) >= 780) return "Current channel";
  return [2, 3].includes(zone) ? "Shelf" : "Ocean";
}
function specialOcean(map: PhysicalField, i: number): Surface | null {
  if (map.DeltaIntensity.get(i) > 0) return "Delta";
  if (map.LandformCodes.get(i) === Landform.Fjord) return "Fjord";
  const shallow = [2, 3].includes(map.BathymetricZoneCodes.get(i));
  if (
    shallow &&
    map.WaterDepths.get(i) <= 160 * 1024 &&
    (map.Temperature.get(i) >= 260 || map.OceanCurrentHeat.get(i) >= 420) &&
    map.Geothermal.get(i) >= 60
  )
    return "Reef";
  return null;
}
function frozenOcean(map: PhysicalField, i: number): Surface | null {
  const shallow = [2, 3].includes(map.BathymetricZoneCodes.get(i)),
    ice = map.IceThickness.get(i),
    flags = map.FeatureFlags.get(i);
  if (shallow && ice >= 75) return "Ice shelf";
  if (flags & Feature.PermanentSeaIce) return "Pack ice";
  if (flags & Feature.PermanentIceMargin || ice >= 50) return "Sea ice";
  if (frozenNeighbor(map, i)) return "Polynya";
  return null;
}
function landClimate(map: PhysicalField, i: number): Surface {
  const biome = biomes[map.BiomeCodes.get(i)]?.name;
  const ecological = naturalSurfaceNames.find((name) => name === biome);
  if (ecological) return ecological;
  return legacyLandClimate(map, i);
}
function legacyLandClimate(map: PhysicalField, i: number): Surface {
  const temperature = map.Temperature.get(i),
    moisture = map.Moisture.get(i);
  if (temperature >= 335 && moisture >= 260) return "Open field";
  if (moisture >= 620) return "Wet tundra";
  if (temperature <= 255 && moisture <= 210) return "Polar barrens";
  if (temperature >= 235 && moisture >= 150 && moisture <= 520 && map.Slope.get(i) <= 0.0042)
    return "Cold steppe";
  return "Tundra";
}
/**
 * Living cover is the land surface; bare relief shows only where the ground is bare. The
 * generated biome already follows slope and soil, so a wooded ridge reads as its forest
 * and a rock ridge as rock, instead of every cell near a river or on a ridge losing its
 * cover to a relief label.
 */
function landRelief(map: PhysicalField, i: number): Surface {
  const bare = map.TreeCover.get(i) + map.GrassCover.get(i) + map.WetlandCover.get(i) < 0.12;
  // Bare coastal lowland the sea has washed at some point: seabed left dry, not a desert coast.
  if (bare && map.BathymetricZoneCodes.get(i) === 1 && map.WaveExposureHistory.get(i) > 0)
    return "Exposed shelf";
  if (bare && map.Slope.get(i) >= 0.0235) return "Scree field";
  if (
    bare &&
    [Landform.Ridge, Landform.Peak, Landform.Pass, Landform.ImpactRim].includes(
      map.LandformCodes.get(i)
    )
  )
    return "Ridge";
  if (!map.EcologyInitialized && map.RiverOrders.get(i) >= 1) return "River valley";
  return landClimate(map, i);
}
function landSurface(map: PhysicalField, i: number): Surface {
  const fluvial = fluvialSurface(map, i);
  if (fluvial) return fluvial;
  if (map.WaterKindCodes.get(i) === 2) return "Lake";
  if (map.LandformCodes.get(i) === Landform.Moraine) return "Moraine";
  const ice = map.IceThickness.get(i);
  if (ice >= 300) return "Glacier";
  if (ice >= 250) return "Snowfield";
  return landRelief(map, i);
}
function fluvialSurface(map: PhysicalField, i: number): Surface | null {
  if (map.DeltaIntensity.get(i) > 0) return "Delta";
  const landform = map.LandformCodes.get(i);
  if (landform === Landform.Waterfall) return "Waterfall";
  if (landform === Landform.Gorge) return "Gorge";
  const order = map.RiverOrders.get(i);
  // A river carrying a wellspring's warmth stays open and green through the cold.
  if (order >= 1 && map.RiverWarmth.get(i) >= 50) return "Warm-water reach";
  // Only a trunk river's channel is wider than the cover around it at mesh scale.
  if (map.RiverChannelStrength.get(i) > 0 && order >= 4) return "River channel";
  if (map.FloodplainIntensity.get(i) >= 250) return "Floodplain";
  return null;
}
export function classifyNaturalSurface(state: GenerationState) {
  const { map, magic } = state.physical!;
  if (!magic) return;
  for (let i = 0; i < map.mesh.count; i++)
    magic.naturalSurface.set(
      i,
      surfaceCode(map.WaterKindCodes.get(i) === 1 ? oceanSurface(map, i) : landSurface(map, i))
    );
  magic.finalSurface.copyFrom(magic.naturalSurface);
}
