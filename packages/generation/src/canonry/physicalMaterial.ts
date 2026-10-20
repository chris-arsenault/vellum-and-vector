import { putChannel } from "@atlas/domain";
import type { GenerationState } from "../process";
import type { PhysicalField } from "./field";
import { Landform } from "./codes";

function landMaterial(map: PhysicalField, i: number): number {
  if (map.DeltaIntensity[i] > 0 || map.FloodplainIntensity[i] > 0) return 3;
  if (map.LandformCodes[i] === Landform.Moraine) return 10;
  if (map.Geothermal[i] >= 760) return 9;
  if (map.IceThickness[i] >= 300) return 5;
  return exposedMaterial(map, i);
}
function exposedMaterial(map: PhysicalField, i: number): number {
  if ([Landform.Gorge, Landform.Waterfall].includes(map.LandformCodes[i])) return 0;
  if ([Landform.Peak, Landform.Ridge].includes(map.LandformCodes[i]))
    return map.Slope[i] >= 0.0085 ? 0 : 1;
  if (map.Temperature[i] <= 250) return map.Moisture[i] >= 560 ? 4 : 2;
  return map.Moisture[i] >= 330 ? 3 : 2;
}
function oceanMaterial(map: PhysicalField, i: number): number {
  if (map.ReefCover[i] > 0.5) return 8;
  if (map.BathymetricZoneCodes[i] === 4) return 7;
  if (map.WaterDepths[i] <= 125 * 1024 && map.Temperature[i] >= 300 && map.Geothermal[i] >= 150)
    return 8;
  return 6;
}
export function projectPhysicalMaterial(state: GenerationState) {
  const work = state.physical!,
    map = work.map;
  putChannel(
    state.surface,
    "physicalMaterial",
    "category",
    Float64Array.from(work.samples, (i) =>
      map.WaterKindCodes[i] === 1 ? oceanMaterial(map, i) : landMaterial(map, i)
    )
  );
}
