// GlacialErosionLayer, GlacialDepositionLayer, GlacialMeltwaterLayer and GlacialRunoffLayer, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { clamp, truncate, units } from "./math";
import { erode, deposit } from "./surface";
import { isGrounded, refreshGrounding } from "./glacierSurface";
import { targetOrder } from "./flowGraph";

export function glacialErosion(map: PhysicalField, c: PhysicalContext) {
  const p = c.Profile;
  for (let i = 0; i < map.mesh.count; i++) {
    if (
      c.GlaciationStrength === 0 ||
      map.IceFlux[i] < p.GlacierFluxThreshold ||
      map.IceThickness[i] <= 0 ||
      map.GroundedIce[i] === 0
    )
      continue;
    const power =
      1 +
      (map.IceFlux[i] - p.GlacierFluxThreshold) / Math.max(1, p.GlacierFluxThreshold) +
      map.IceThickness[i] / Math.max(1, p.GlacierThicknessThreshold);
    const resistance = map.CrustTypeCodes[i] === 2 ? 4 : 3;
    const cut = units(
      clamp(
        (((power * 3) / resistance) * c.GlaciationStrength) / 1000,
        1 / 1024,
        p.MaximumGlacialErosionPerPass
      )
    );
    erode(map, i, cut);
    map.CumulativeGlacialErosion[i] += cut;
    map.SedimentSupply[i] += cut;
    map.SedimentProducedTotal += (cut / 1024) * map.mesh.areas[i];
  }
  refreshGrounding(map, p);
}
function isTerminus(map: PhysicalField, c: PhysicalContext, i: number, target: number): boolean {
  return (
    map.GroundedIce[i] !== 0 &&
    (target < 0 ||
      map.GroundedIce[target] === 0 ||
      map.IceFlux[target] < truncate(c.Profile.GlacierFluxThreshold / 3) ||
      (map.IceFlux[i] >= c.Profile.GlacierFluxThreshold && map.IceThickness[target] === 0))
  );
}
export function glacialDeposition(map: PhysicalField, c: PhysicalContext) {
  const moving = new Float64Array(map.mesh.count);
  for (const i of targetOrder(map.IceFlowTargets)) {
    const area = map.mesh.areas[i];
    const load = moving[i] + (map.SedimentSupply[i] / 1024) * area;
    map.SedimentSupply[i] = 0;
    if (load <= 0) continue;
    const target = map.IceFlowTargets[i];
    const deposited = isTerminus(map, c, i, target)
      ? deposit(
          map,
          i,
          Math.min(
            units((c.Profile.MaximumGlacialDepositionPerPass * c.GlaciationStrength) / 1000),
            (load * 1024) / area
          )
        )
      : 0;
    if (deposited > 0) map.GroundedIce[i] = isGrounded(map, i, c.Profile) ? 1 : 0;
    map.CumulativeGlacialDeposition[i] += deposited;
    const volume = (deposited / 1024) * area;
    if (target >= 0) moving[target] += load - volume;
    else map.SedimentExportedTotal += load - volume;
  }
}
export function glacialMeltwater(map: PhysicalField, c: PhysicalContext) {
  const p = c.Profile;
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes[i] !== 0) {
      map.GlacialMeltwater[i] = 0;
      continue;
    }
    const ice = map.IceThickness[i];
    const thaw = clamp(
      truncate(
        ((map.Temperature[i] - p.GlacialMeltTemperatureFloor) * 1000) /
          Math.max(1, p.IceTemperatureThreshold - p.GlacialMeltTemperatureFloor)
      ),
      0,
      1000
    );
    const surface = truncate(
      (truncate((ice * thaw) / 1000) * p.GlacialAblationRunoffStrength) / 1000
    );
    const basal = truncate(
      (truncate((ice * map.Geothermal[i]) / 1000) * p.BasalMeltRunoffStrength) / 1000
    );
    const retreat = truncate(
      (Math.max(0, map.MaximumIceThickness[i] - ice) * p.GlacialRetreatRunoffStrength) / 1000
    );
    map.GlacialMeltwater[i] = clamp(surface + basal + retreat, 0, 1000);
  }
}
export function glacialRunoff(map: PhysicalField, c: PhysicalContext) {
  for (let i = 0; i < map.mesh.count; i++)
    map.Runoff[i] =
      map.WaterKindCodes[i] !== 0
        ? 0
        : clamp(
            map.Runoff[i] + truncate((map.GlacialMeltwater[i] * c.HydrologyStrength) / 1000),
            0,
            c.Profile.PrecipitationCeiling
          );
}
