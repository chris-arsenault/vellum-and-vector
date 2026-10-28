// GlacialErosionLayer, GlacialDepositionLayer, GlacialMeltwaterLayer and GlacialRunoffLayer, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { clamp, truncate, units } from "./math";
import { erode, deposit } from "./surface";
import { isGrounded, refreshGrounding } from "./glacierSurface";
import { targetOrder } from "./flowGraph";
import { workingArray, releaseWorking } from "./physicalNumerics";

export function glacialErosion(map: PhysicalField, c: PhysicalContext) {
  const p = c.Profile;
  for (let i = 0; i < map.mesh.count; i++) {
    const flux = map.IceFlux.get(i),
      thickness = map.IceThickness.get(i);
    if (
      c.GlaciationStrength === 0 ||
      flux < p.GlacierFluxThreshold ||
      thickness <= 0 ||
      map.GroundedIce.get(i) === 0
    )
      continue;
    // Charge in sliding ice weakens the bed it touches; cold-based ice never reaches here.
    const power =
      (1 +
        (flux - p.GlacierFluxThreshold) / Math.max(1, p.GlacierFluxThreshold) +
        thickness / Math.max(1, p.GlacierThicknessThreshold)) *
      (1 + (p.ChargedIceErosion / 1000) * map.IceCharge.get(i));
    const resistance = map.CrustTypeCodes.get(i) === 2 ? 4 : 3;
    const cut = units(
      clamp(
        (((power * 3) / resistance) * c.GlaciationStrength) / 1000,
        1 / 1024,
        p.MaximumGlacialErosionPerPass
      )
    );
    erode(map, i, cut);
    map.CumulativeGlacialErosion.add(i, cut);
    map.SedimentSupply.add(i, cut);
    map.SedimentProducedTotal += (cut / 1024) * map.mesh.area(i);
  }
  refreshGrounding(map, p);
}
function isTerminus(map: PhysicalField, c: PhysicalContext, i: number, target: number): boolean {
  return (
    map.GroundedIce.get(i) !== 0 &&
    (target < 0 ||
      map.GroundedIce.get(target) === 0 ||
      map.IceFlux.get(target) < truncate(c.Profile.GlacierFluxThreshold / 3) ||
      (map.IceFlux.get(i) >= c.Profile.GlacierFluxThreshold && map.IceThickness.get(target) === 0))
  );
}
export function glacialDeposition(map: PhysicalField, c: PhysicalContext) {
  const moving = workingArray(map, "float64", "glacier:sediment"),
    order = targetOrder(map, map.IceFlowTargets);
  for (let n = 0; n < order.length; n++) {
    const i = order.get(n),
      area = map.mesh.area(i);
    const load = moving.get(i) + (map.SedimentSupply.get(i) / 1024) * area;
    map.SedimentSupply.set(i, 0);
    if (load <= 0) continue;
    const target = map.IceFlowTargets.get(i);
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
    if (deposited > 0) map.GroundedIce.set(i, isGrounded(map, i, c.Profile) ? 1 : 0);
    map.CumulativeGlacialDeposition.add(i, deposited);
    const volume = (deposited / 1024) * area;
    if (target >= 0) moving.add(target, load - volume);
    else map.SedimentExportedTotal += load - volume;
  }
  releaseWorking(map, moving, order);
}
export function glacialMeltwater(map: PhysicalField, c: PhysicalContext) {
  const p = c.Profile;
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes.get(i) !== 0) {
      map.GlacialMeltwater.set(i, 0);
      continue;
    }
    const ice = map.IceThickness.get(i);
    const thaw = clamp(
      truncate(
        ((map.Temperature.get(i) - p.GlacialMeltTemperatureFloor) * 1000) /
          Math.max(1, p.IceTemperatureThreshold - p.GlacialMeltTemperatureFloor)
      ),
      0,
      1000
    );
    const surface = truncate(
      (truncate((ice * thaw) / 1000) * p.GlacialAblationRunoffStrength) / 1000
    );
    const basal = truncate(
      (truncate((ice * map.Geothermal.get(i)) / 1000) * p.BasalMeltRunoffStrength) / 1000
    );
    const retreat = truncate(
      (Math.max(0, map.MaximumIceThickness.get(i) - ice) * p.GlacialRetreatRunoffStrength) / 1000
    );
    map.GlacialMeltwater.set(i, clamp(surface + basal + retreat, 0, 1000));
  }
}
export function glacialRunoff(map: PhysicalField, c: PhysicalContext) {
  for (let i = 0; i < map.mesh.count; i++)
    map.Runoff.set(
      i,
      map.WaterKindCodes.get(i) !== 0
        ? 0
        : clamp(
            map.Runoff.get(i) +
              truncate((map.GlacialMeltwater.get(i) * c.HydrologyStrength) / 1000),
            0,
            c.Profile.PrecipitationCeiling
          )
    );
}
