import type { GenerationState } from "../process";
import type { PhysicalField } from "./field";
import { reservoirStock, type MagicField } from "./magicState";
import type { LocateContext } from "./magicSources";
import { siteStrength } from "./magicStocks";
import { clamp, round } from "./math";

/**
 * Greenwood's stands: old growth (a canopy past the stand age with cover past the floor) and
 * deep peat. Both are living matter that has had time; the strength rises with age and depth.
 * Sap that herds and people carried to a cell is a grove in the making: planted sap per area
 * counts toward a full grove's strength, so a herd road or a market at the end of a Deepwood
 * road becomes a source of its own. A stand refills its sap; the strategy keeps the stock.
 */
export function verdantSources(
  state: GenerationState,
  field: MagicField,
  _seed: number,
  context: LocateContext
) {
  const map = state.physical!.map,
    p = field.definition.parameters,
    sap = field.stocks[`${context.origin.id}/sap`];
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes.get(i) !== 0 || map.IceThickness.get(i) > 0) continue;
    const canopy = map.BroadleafCover.get(i) + map.ConiferCover.get(i),
      age = map.CanopyAge.get(i),
      peat = map.PeatCarbon.get(i),
      area = map.mesh.area(i);
    let strength = 0;
    if (canopy >= p.standCover && age >= p.standAge)
      strength = 500 + 300 * clamp((age - p.standAge) / Math.max(1, p.standAge), 0, 1);
    if (peat >= p.peatDepth)
      strength = Math.max(
        strength,
        400 + 300 * clamp(peat / Math.max(1e-9, p.peatDepth) - 1, 0, 1)
      );
    if (sap) {
      const grove = clamp(sap.get(i) / area / p.groveSap, 0, 1);
      strength = Math.max(strength, 500 * grove);
    }
    const site = siteStrength(strength);
    if (site === 0) continue;
    field.source.set(i, site);
    // A stand refills its own sap; a planting below the floor is only what was carried there.
    if (sap) sap.set(i, Math.max(sap.get(i), site * area));
  }
}
/**
 * Forge cores: the cracked stock people's trade left at their forges is a source where it
 * lies, at full strength once the cracked cores per area reach the declared amount. Cores
 * carried along the roads between forges are stock in transit, not a source.
 */
export function forgeSources(
  state: GenerationState,
  field: MagicField,
  _seed: number,
  { origin }: LocateContext
) {
  const map = state.physical!.map,
    p = field.definition.parameters,
    cracked = field.stocks[`${origin.id}/cracked`];
  if (!cracked) return;
  for (let i = 0; i < map.mesh.count; i++) {
    const held = cracked.get(i);
    if (held <= 0) continue;
    const area = map.mesh.area(i),
      strength = siteStrength((1000 * held) / area / p.forgeStrength);
    if (strength === 0) continue;
    field.source.set(i, strength);
    field.located.push({
      origin: origin.id,
      id: `forge:${i}`,
      x: map.mesh.x(i),
      y: map.mesh.y(i),
      radius: Math.sqrt(area),
      strength,
    });
  }
}
/** Open, unfrozen ground on soft karst at a slope break with the spring flow through it. */
function springGround(map: PhysicalField, i: number, springFlow: number, springRock: number) {
  if (map.WaterKindCodes.get(i) !== 0 || map.IceThickness.get(i) > 0) return false;
  if (map.FlowAccumulation.get(i) < springFlow || map.RockResistance.get(i) > springRock)
    return false;
  return map.Slope.get(i) <= 0.01 && karst(map, i) >= 0.35;
}
/**
 * The spring is where the river comes onto spring ground: the first such cell along its
 * course, not every reach it then runs along the karst.
 */
function springRises(map: PhysicalField, i: number, springFlow: number, springRock: number) {
  if (!springGround(map, i, springFlow, springRock)) return false;
  for (let edge = 0; edge < map.mesh.degree(i); edge++) {
    const j = map.mesh.neighbor(i, edge);
    if (j >= 0 && map.FlowTargets.get(j) === i && springGround(map, j, springFlow, springRock))
      return false;
  }
  return true;
}
/** The world has no carbonate channel; its published karst proxy is continental, unvolcanic crust. */
function karst(map: PhysicalField, i: number) {
  return (
    (map.CrustContinentalFraction.get(i) / 1000) *
    (1 - Math.min(1, map.VolcanicConstructionHistory.get(i) / (1024 * 100)))
  );
}
/**
 * Greenwood's springs: where a catchment's recharge reaches the surface through soft, soluble
 * rock on a slope break, stronger where a buried peat stratum lies beneath. The spring is
 * where the river comes onto that ground, not every reach it then runs along it. A spring
 * whose karst has fallen in (sealed) rises no more.
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
    if (field.sealed.get(i) > 0 || !springRises(map, i, p.springFlow, p.springRock)) continue;
    const area = map.mesh.area(i),
      buried = stratum ? Math.min(300, stratum.get(i) / area) : 0,
      strength = clamp(round(600 + buried), 1, 1000);
    field.source.set(i, strength);
    field.located.push({
      origin: origin.id,
      id: `spring:${i}`,
      x: map.mesh.x(i),
      y: map.mesh.y(i),
      radius: Math.sqrt(area),
      strength,
    });
  }
}
