import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { clamp, truncate } from "./math";
import { carryOut, deposit } from "../rock/groundLedger";
import { loadOf, MaterialLoad } from "../rock/groundLoad";
import { isGrounded } from "./glacierSurface";
import { targetOrder } from "./flowGraph";
import { releaseWorking } from "./physicalNumerics";
import { MapScale } from "@atlas/domain";

const carriesIceLoad = (map: PhysicalField, cell: number) =>
  map.GroundedIce.get(cell) !== 0 && map.IceThickness.get(cell) > 0;

/** Sediment leaving its ice carrier stays on dry ground for the next carrier, or reaches the sea. */
function releaseIceLoad(map: PhysicalField, moving: MaterialLoad, cell: number) {
  const material = moving.take(cell, moving.amount(cell));
  if (material.depth <= 0) return;
  if (map.WaterKindCodes.get(cell) === 1) carryOut(map, material.depth, "moraines", material, cell);
  else loadOf(map).add(cell, material);
}

function isTerminus(map: PhysicalField, c: PhysicalContext, i: number, target: number): boolean {
  return (
    map.GroundedIce.get(i) !== 0 &&
    (target < 0 || map.GroundedIce.get(target) === 0 || map.IceThickness.get(target) === 0)
  );
}
function moraineRoom(map: PhysicalField, c: PhysicalContext, i: number, target: number) {
  const p = c.Profile,
    holds = p.MassWastingStableGradient * Math.min(p.HillslopeLength, map.mesh.spacing),
    ahead = target >= 0 ? map.Elevation.get(target) : map.EffectiveSeaLevel;
  return Math.max(0, ahead + MapScale.inUnits(holds, "native") - map.Elevation.get(i));
}
export function glacialDeposition(map: PhysicalField, c: PhysicalContext) {
  const moving = new MaterialLoad(map, "glacier:sediment"),
    supply = loadOf(map),
    order = targetOrder(map, map.IceFlowTargets);
  for (let n = 0; n < order.length; n++) {
    const i = order.get(n),
      area = map.mesh.area(i);
    if (!carriesIceLoad(map, i)) {
      releaseIceLoad(map, moving, i);
      continue;
    }
    moving.add(i, supply.take(i, supply.amount(i)));
    const load = moving.amount(i);
    if (load <= 0) continue;
    const target = map.IceFlowTargets.get(i);
    // Ice drops what it carries where it ends, which is what a moraine is. A moraine stands no higher
    // above the ground ahead of it than a slope can hold; what will not fit carries on down.
    const deposited = isTerminus(map, c, i, target)
      ? deposit(
          map,
          i,
          Math.min(MapScale.inUnits(load / area, "native"), moraineRoom(map, c, i, target)),
          "moraines",
          "load",
          moving.get(i)
        )
      : 0;
    if (deposited > 0) map.GroundedIce.set(i, isGrounded(map, i, c.Profile) ? 1 : 0);
    map.CumulativeGlacialDeposition.add(i, deposited);
    const volume = MapScale.metres(deposited, "native") * area;
    moving.take(i, volume);
    if (target >= 0) moving.add(target, moving.take(i, moving.amount(i)));
    else releaseIceLoad(map, moving, i);
  }
  moving.release();
  releaseWorking(map, order);
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
    const surface = (ice * thaw * p.GlacialAblationRunoffStrength) / 1_000_000;
    const basal = (ice * map.Geothermal.get(i) * p.BasalMeltRunoffStrength) / 1_000_000;
    const retreat = (map.IceRetreat.get(i) * p.GlacialRetreatRunoffStrength) / 1000;
    map.GlacialMeltwater.set(
      i,
      MapScale.inUnits(surface + basal + retreat, "mm") + map.ExternalMeltwater.get(i)
    );
  }
}
