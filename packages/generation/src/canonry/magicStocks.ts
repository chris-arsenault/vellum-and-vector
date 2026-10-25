import type { MagicOrigin } from "@atlas/domain";
import type { GenerationState } from "../process";
import type { PhysicalField } from "./field";
import { originStocks, stockKey, type MagicField } from "./magicState";
import { clamp, units } from "./math";

/**
 * How much of a cell's stock the ground still exposes: whole on bare rock, none once the
 * sediment over it is deeper than the burial depth.
 */
export function exposure(map: PhysicalField, i: number, buryDepth: number) {
  return clamp(1 - map.SedimentThickness[i] / units(buryDepth), 0, 1);
}
/**
 * The share of exposed held stock an evaluation releases: a base share plus the cracking
 * agents at work in the cell, tectonic strain, the load of ice, frost on exposed ground and
 * the impact's own shock in the epoch the stock arrived.
 */
export function releaseShare(map: PhysicalField, field: MagicField, i: number, epochIndex: number) {
  const p = field.definition.parameters;
  let share = p.fallenRelease + (p.strainCracking * map.TectonicStrain[i]) / 1000;
  share += p.iceCracking * clamp(map.IceThickness[i] / p.iceCrackDepth, 0, 1);
  if (map.Temperature[i] < 273 && map.IceThickness[i] <= 0) share += p.frostCracking;
  if (field.arrival[i] === epochIndex) share += p.impactShock;
  return clamp(share, 0, 1);
}
/**
 * Once per epoch, after the field's history is kept: what the finite origins released is
 * gone, river-carried stocks move a share one cell down the drainage and leave the budget
 * when they reach the sea, and a fresh ejecta fan keeps its ground barren.
 */
export function advanceStocks(state: GenerationState, field: MagicField, epochIndex: number) {
  const map = state.physical!.map;
  for (const origin of field.definition.origins) {
    for (const stock of originStocks(origin)) {
      const values = field.stocks[stockKey(origin, stock)];
      if (origin.renewal === "finite" && stock === originStocks(origin)[0]) consume(field, values);
      if (stock.reservoir === "ice") gatherIntoIce(field, values);
      if (stock.reservoir === "ground") mirrorGround(map, field, values);
      if (stock.carriers.includes("river")) field.lost += carryDownstream(map, field, values);
      if (stock.carriers.includes("ice")) field.lost += carryWithIce(map, field, origin, values);
    }
    if (origin.source === "impact") barrenFan(map, field, epochIndex);
  }
}
/** The charge this epoch's propagation captured in the ice joins the ice reservoir. */
function gatherIntoIce(field: MagicField, ice: Float64Array) {
  for (let i = 0; i < ice.length; i++) ice[i] += field.retained[i];
}
/** The ground reservoir is the stored charge as an amount; the history pass keeps `stored`. */
function mirrorGround(map: PhysicalField, field: MagicField, ground: Float64Array) {
  for (let i = 0; i < ground.length; i++) ground[i] = field.stored[i] * map.mesh.areas[i];
}
/**
 * Charge in ice is englacial debris: it rides the ice flow one cell per epoch by the carriage
 * share, is dumped into the moraine where the ice ends on land and onto the shelf where it
 * reaches the sea, and a share leaves with the meltwater. Ice that has gone drops its charge
 * where it stood. The concentration left in the ice is written as `IceCharge`.
 */
function carryWithIce(
  map: PhysicalField,
  field: MagicField,
  origin: MagicOrigin,
  ice: Float64Array
) {
  const p = field.definition.parameters,
    moraine = field.stocks[`${origin.id}/moraine`],
    shelf = field.stocks[`${origin.id}/shelf`],
    moved = new Float64Array(ice.length);
  let lost = 0;
  for (let i = 0; i < ice.length; i++) {
    if (ice[i] <= 0) continue;
    const melt = ice[i] * p.meltwaterLoss * clamp(map.GlacialMeltwater[i] / 1000, 0, 1);
    ice[i] -= melt;
    lost += melt;
    if (map.IceThickness[i] <= 0) {
      drop(map, i, ice[i], moraine, shelf, () => (lost += ice[i]));
      ice[i] = 0;
      continue;
    }
    const target = map.IceFlowTargets[i];
    if (target < 0) continue;
    const share = ice[i] * p.iceCarry;
    ice[i] -= share;
    if (map.IceThickness[target] > 0 && map.WaterKindCodes[target] !== 1) moved[target] += share;
    else drop(map, target, share, moraine, shelf, () => (lost += share));
  }
  for (let i = 0; i < ice.length; i++) {
    ice[i] += moved[i];
    map.IceCharge[i] =
      ice[i] > 0 && map.IceThickness[i] > 0
        ? clamp(ice[i] / (map.mesh.areas[i] * map.IceThickness[i] * p.iceChargeSaturation), 0, 1)
        : 0;
  }
  return lost;
}
/** Where ice lets its charge go: the shelf at sea, the moraine on land, or out of the budget. */
function drop(
  map: PhysicalField,
  i: number,
  amount: number,
  moraine: Float64Array | undefined,
  shelf: Float64Array | undefined,
  lose: () => void
) {
  const sink = map.WaterKindCodes[i] === 1 ? shelf : moraine;
  if (sink) sink[i] += amount;
  else lose();
}
function consume(field: MagicField, values: Float64Array) {
  for (let i = 0; i < values.length; i++) values[i] *= 1 - field.releasing[i];
}
/** Placers: a share of the stock on a river cell moves to the cell the river flows to. */
function carryDownstream(map: PhysicalField, field: MagicField, values: Float64Array) {
  const mobility = field.definition.parameters.placerMobility,
    moved = new Float64Array(values.length);
  let lost = 0;
  for (let i = 0; i < values.length; i++) {
    if (values[i] <= 0 || map.WaterKindCodes[i] === 1) continue;
    const share = values[i] * mobility * (map.RiverOrders[i] > 0 ? 1 : 0.25),
      target = map.FlowTargets[i];
    if (share <= 0 || target < 0) continue;
    values[i] -= share;
    if (map.WaterKindCodes[target] === 1) lost += share;
    else moved[target] += share;
  }
  for (let i = 0; i < values.length; i++) values[i] += moved[i];
  return lost;
}
/** The ejecta fan stays barren for the declared epochs after the fall, then recovers. */
function barrenFan(map: PhysicalField, field: MagicField, epochIndex: number) {
  const p = field.definition.parameters;
  for (let i = 0; i < map.mesh.count; i++) {
    if (field.arrival[i] < 0) continue;
    const age = epochIndex - field.arrival[i];
    if (age < 0 || age >= p.fanBarrenEpochs) continue;
    const depth = clamp(map.ImpactEjectaThickness[i] / units(p.fanBarrenDepth), 0, 1);
    map.EcologicalToxicity[i] = Math.max(
      map.EcologicalToxicity[i],
      depth * (1 - age / p.fanBarrenEpochs)
    );
  }
}
/** The first declared stock of an origin: where its held cores sit. */
export function heldStock(field: MagicField, origin: MagicOrigin) {
  return field.stocks[stockKey(origin, originStocks(origin)[0])];
}
