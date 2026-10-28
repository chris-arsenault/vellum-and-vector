import { putChannel } from "@atlas/domain";
import type { GenerationState } from "../process";
import type { PhysicalField } from "./field";
import { Landform } from "./codes";
import { projectedValues } from "./atlasSampling";

function landMaterial(map: PhysicalField, i: number): number {
  if (map.DeltaIntensity.get(i) > 0 || map.FloodplainIntensity.get(i) > 0) return 3;
  if (map.LandformCodes.get(i) === Landform.Moraine) return 10;
  if (map.Geothermal.get(i) >= 760) return 9;
  if (map.IceThickness.get(i) >= 300) return 5;
  return exposedMaterial(map, i);
}
function exposedMaterial(map: PhysicalField, i: number): number {
  const landform = map.LandformCodes.get(i);
  if ([Landform.Gorge, Landform.Waterfall].includes(landform)) return 0;
  if ([Landform.Peak, Landform.Ridge].includes(landform)) return map.Slope.get(i) >= 0.0085 ? 0 : 1;
  const moisture = map.Moisture.get(i);
  if (map.Temperature.get(i) <= 250) return moisture >= 560 ? 4 : 2;
  return moisture >= 330 ? 3 : 2;
}
function oceanMaterial(map: PhysicalField, i: number): number {
  if (map.BathymetricZoneCodes.get(i) === 4) return 7;
  if (
    map.WaterDepths.get(i) <= 125 * 1024 &&
    map.Temperature.get(i) >= 300 &&
    map.Geothermal.get(i) >= 150
  )
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
    projectedValues(
      work,
      (i) => (map.WaterKindCodes.get(i) === 1 ? oceanMaterial(map, i) : landMaterial(map, i)),
      true
    )
  );
}
