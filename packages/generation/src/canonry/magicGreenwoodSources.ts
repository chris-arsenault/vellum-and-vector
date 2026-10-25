import type { GenerationState } from "../process";
import type { PhysicalField } from "./field";
import { reservoirStock, type MagicField } from "./magicState";
import type { LocateContext } from "./magicSources";
import { clamp, round } from "./math";

/**
 * Greenwood's stands: old growth (a canopy past the stand age with cover past the floor) and
 * deep peat. Both are living matter that has had time; the strength rises with age and depth.
 */
export function verdantSources(state: GenerationState, field: MagicField) {
  const map = state.physical!.map,
    p = field.definition.parameters;
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes[i] !== 0 || map.IceThickness[i] > 0) continue;
    const canopy = map.BroadleafCover[i] + map.ConiferCover[i];
    let strength = 0;
    if (canopy >= p.standCover && map.CanopyAge[i] >= p.standAge)
      strength = 500 + 300 * clamp((map.CanopyAge[i] - p.standAge) / Math.max(1, p.standAge), 0, 1);
    if (map.PeatCarbon[i] >= p.peatDepth)
      strength = Math.max(
        strength,
        400 + 300 * clamp(map.PeatCarbon[i] / Math.max(1e-9, p.peatDepth) - 1, 0, 1)
      );
    if (strength > 0) field.source[i] = clamp(round(strength), 1, 1000);
  }
}
/** The world has no carbonate channel; its published karst proxy is continental, unvolcanic crust. */
function karst(map: PhysicalField, i: number) {
  return (
    (map.CrustContinentalFraction[i] / 1000) *
    (1 - Math.min(1, map.VolcanicConstructionHistory[i] / (1024 * 100)))
  );
}
/**
 * Greenwood's springs: where a catchment's recharge reaches the surface through soft, soluble
 * rock on a slope break, stronger where a buried peat stratum lies beneath. A spring whose
 * karst has fallen in (sealed) rises no more.
 */
export function aquiferSources(
  state: GenerationState,
  field: MagicField,
  _seed: number,
  { origin }: LocateContext
) {
  const map = state.physical!.map,
    p = field.definition.parameters,
    stratum = reservoirStock(field, "stratum");
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes[i] !== 0 || map.IceThickness[i] > 0 || field.sealed[i] > 0) continue;
    if (map.FlowAccumulation[i] < p.springFlow || map.RockResistance[i] > p.springRock) continue;
    if (map.Slope[i] > 0.01 || karst(map, i) < 0.35) continue;
    const buried = stratum ? Math.min(300, stratum[i] / map.mesh.areas[i]) : 0;
    field.source[i] = clamp(round(600 + buried), 1, 1000);
    field.located.push({
      origin: origin.id,
      id: `spring:${i}`,
      x: map.mesh.x[i],
      y: map.mesh.y[i],
      radius: Math.sqrt(map.mesh.areas[i]),
      strength: field.source[i],
    });
  }
}
