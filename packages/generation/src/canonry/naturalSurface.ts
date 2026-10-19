import { naturalSurfaceNames, surfaceCode } from "@atlas/domain";
import type { GenerationState } from "../process";
import type { PhysicalField } from "./field";
import { Feature, Landform } from "./codes";

function frozenNeighbor(map: PhysicalField, i: number) {
  for (let edge = 0; edge < 3; edge++) {
    const j = map.mesh.neighbors[i * 3 + edge];
    if (j >= 0 && map.WaterKindCodes[j] === 1 && map.IceThickness[j] > 0) return true;
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
  if (map.OceanCurrentStrength[i] >= 560) return "Current channel";
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
function landRelief(map: PhysicalField, i: number): (typeof naturalSurfaceNames)[number] {
  if (map.RiverOrders[i] >= 1) return "River valley";
  for (let edge = 0; edge < 3; edge++) {
    const j = map.mesh.neighbors[i * 3 + edge];
    if (j >= 0 && map.RiverChannelOrders[j] >= 1) return "River valley";
  }
  if (map.Slope[i] >= 0.0235) return "Scree field";
  if (
    [Landform.Ridge, Landform.Peak, Landform.Pass, Landform.ImpactRim].includes(
      map.LandformCodes[i]
    )
  )
    return "Ridge";
  return landClimate(map, i);
}
function landSurface(map: PhysicalField, i: number): (typeof naturalSurfaceNames)[number] {
  const fluvial = fluvialSurface(map, i);
  if (fluvial) return fluvial;
  if (map.WaterKindCodes[i] === 2) return "Lake";
  if (map.BathymetricZoneCodes[i] === 1) return "Exposed shelf";
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
  if (map.RiverChannelStrength[i] > 0) return "River channel";
  if (map.FloodplainIntensity[i] > 0) return "Floodplain";
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
