import type { Band, MagicOrigin, MagicStock } from "@atlas/domain";
import { workingArray, releaseWorking } from "./physicalNumerics";
import type { GenerationState } from "../process";
import type { PhysicalField } from "./field";
import { originStocks, stockKey, type MagicField } from "./magicState";
import { clamp, round, units } from "./math";
import { rebuild } from "./surface";
import { seepBrine, settleDust, weatherBed } from "./magicSaltStocks";

/**
 * The least strength a located source has, a twentieth of full. A source is a site: the
 * release of a stock, the tenure of a seat or the cracking at a forge that falls short of the
 * floor is still stock (it moves, accumulates and feeds the next evaluation) but it is not a
 * source and seeds no site. Without the floor every trace a river or a trade road carried
 * became a labelled core, and the world had a Fire core every few kilometres.
 */
export const sourceFloor = 50;
/** The strength a located source publishes for a raw strength: rounded, bounded, or none below the floor. */
export function siteStrength(strength: number) {
  const rounded = round(strength);
  return rounded < sourceFloor ? 0 : Math.min(1000, rounded);
}
/**
 * How much of a cell's stock the ground still exposes: whole on bare rock, none once the
 * sediment over it is deeper than the burial depth.
 */
export function exposure(map: PhysicalField, i: number, buryDepth: number) {
  return clamp(1 - map.SedimentThickness.get(i) / units(buryDepth), 0, 1);
}
/**
 * The share of exposed held stock an evaluation releases: a base share plus the cracking
 * agents at work in the cell, tectonic strain, the load of ice, frost on exposed ground and
 * the impact's own shock in the epoch the stock arrived.
 */
export function releaseShare(map: PhysicalField, field: MagicField, i: number, epochIndex: number) {
  const p = field.definition.parameters,
    ice = map.IceThickness.get(i);
  let share = p.fallenRelease + (p.strainCracking * map.TectonicStrain.get(i)) / 1000;
  share += p.iceCracking * clamp(ice / p.iceCrackDepth, 0, 1);
  if (map.Temperature.get(i) < 273 && ice <= 0) share += p.frostCracking;
  if (field.arrival.get(i) === epochIndex) share += p.impactShock;
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
    for (const stock of originStocks(origin)) advanceStock(map, field, origin, stock);
    if (origin.source === "impact") barrenFan(map, field, epochIndex);
    if (origin.source === "aquifer") collapseOverdrawn(map, field, origin);
  }
  field.drawn.fill(0);
}
/** What a reservoir does in the advance, then what its carriers do. */
const reservoirAdvances: Record<
  string,
  (map: PhysicalField, field: MagicField, values: Band, origin: MagicOrigin) => void
> = {
  ice: (_map, field, values) => gatherIntoIce(field, values),
  ground: mirrorGround,
  stratum: buryPeat,
  sap: decaySap,
  forge: coolForge,
  brine: seepBrine,
  bed: weatherBed,
  dust: settleDust,
};
function advanceStock(
  map: PhysicalField,
  field: MagicField,
  origin: MagicOrigin,
  stock: MagicStock
) {
  const values = field.stocks[stockKey(origin, stock)];
  if (origin.renewal === "finite" && stock === originStocks(origin)[0]) consume(field, values);
  reservoirAdvances[stock.reservoir]?.(map, field, values, origin);
  if (stock.carriers.includes("river")) field.lost += carryDownstream(map, field, values);
  if (stock.carriers.includes("ice")) field.lost += carryWithIce(map, field, origin, values);
  if (stock.carriers.includes("animal")) carryInTheGut(map, field, values);
}
/** Sap a cell holds without a stand of its own is spent by the share declared, per epoch. */
function decaySap(_map: PhysicalField, field: MagicField, sap: Band, origin: MagicOrigin) {
  const own = field.originSources[origin.id],
    keep = 1 - field.definition.parameters.sapLoss;
  for (let i = 0; i < sap.length; i++) if (own.get(i) <= 0) sap.set(i, sap.get(i) * keep);
}
/** Cracked cores cool: a share of the forge stock is gone each epoch. */
function coolForge(_map: PhysicalField, field: MagicField, cracked: Band) {
  const keep = 1 - field.definition.parameters.forgeCooling;
  for (let i = 0; i < cracked.length; i++) {
    const value = cracked.get(i);
    field.lost += value * (1 - keep);
    cracked.set(i, value * keep);
  }
}
/** Peat under sediment becomes a stratum the crust carries and an aquifer can leach. */
function buryPeat(map: PhysicalField, field: MagicField, stratum: Band) {
  const p = field.definition.parameters;
  for (let i = 0; i < stratum.length; i++) {
    const buried = 1 - exposure(map, i, p.buryDepth),
      peat = map.PeatCarbon.get(i);
    if (buried > 0 && peat > 0) stratum.add(i, peat * map.mesh.area(i) * p.strataShare * buried);
  }
}
/**
 * Herbivores carry a stock in the gut: a share of a grazed cell's stock goes to the
 * neighbours in proportion to the herds there, so a herd road seeds the ground ahead of it.
 */
function carryInTheGut(map: PhysicalField, field: MagicField, values: Band) {
  const p = field.definition.parameters,
    herds = (i: number) => map.Grazers.get(i) + map.Browsers.get(i),
    moved = workingArray(map, "float64", "magic:animal-carriage", values.length);
  for (let i = 0; i < values.length; i++) {
    const value = values.get(i);
    if (value <= 0 || herds(i) <= 0) continue;
    const grazed = landNeighbours(map, i),
      weight = grazed.reduce((sum, j) => sum + herds(j), 0);
    if (weight <= 0) continue;
    const share = value * p.animalCarry * clamp(herds(i) / 1000, 0, 1);
    values.add(i, -share);
    for (const j of grazed) moved.add(j, (share * herds(j)) / weight);
  }
  for (let i = 0; i < values.length; i++) values.add(i, moved.get(i));
  releaseWorking(map, moved);
}
function landNeighbours(map: PhysicalField, i: number) {
  const cells: number[] = [];
  for (let edge = 0; edge < map.mesh.degree(i); edge++) {
    const j = map.mesh.neighbor(i, edge);
    if (j >= 0 && map.WaterKindCodes.get(j) === 0) cells.push(j);
  }
  return cells;
}
/** A spring drawn past a share of its recharge in one epoch collapses the karst beneath it. */
function collapseOverdrawn(map: PhysicalField, field: MagicField, origin: MagicOrigin) {
  const p = field.definition.parameters,
    own = field.originSources[origin.id];
  for (let i = 0; i < map.mesh.count; i++) {
    const source = own.get(i),
      drawn = field.drawn.get(i);
    if (source <= 0 || drawn <= 0) continue;
    const recharge = source * map.mesh.area(i);
    if (drawn < p.overdrawShare * recharge) continue;
    field.sealed.set(i, 1);
    const room = Math.max(0, p.thawSubsidenceLimit - field.subsided.get(i)),
      drop = Math.min(room, p.sinkDepth);
    if (drop <= 0) continue;
    field.subsided.add(i, drop);
    map.BedrockElevation.add(i, -units(drop));
    rebuild(map, i);
  }
}
/** The charge this epoch's propagation captured in the ice joins the ice reservoir. */
function gatherIntoIce(field: MagicField, ice: Band) {
  for (let i = 0; i < ice.length; i++) ice.add(i, field.retained.get(i));
}
/** The ground reservoir is the stored charge as an amount; the history pass keeps `stored`. */
function mirrorGround(map: PhysicalField, field: MagicField, ground: Band) {
  for (let i = 0; i < ground.length; i++) ground.set(i, field.stored.get(i) * map.mesh.area(i));
}
/**
 * Charge in ice is englacial debris: it rides the ice flow one cell per epoch by the carriage
 * share, is dumped into the moraine where the ice ends on land and onto the shelf where it
 * reaches the sea, and a share leaves with the meltwater. Ice that has gone drops its charge
 * where it stood. The concentration left in the ice is written as `IceCharge`.
 */
function carryWithIce(map: PhysicalField, field: MagicField, origin: MagicOrigin, ice: Band) {
  const p = field.definition.parameters,
    moraine = field.stocks[`${origin.id}/moraine`],
    shelf = field.stocks[`${origin.id}/shelf`],
    moved = workingArray(map, "float64", "magic:ice-carriage", ice.length);
  let lost = 0;
  for (let i = 0; i < ice.length; i++) {
    let held = ice.get(i);
    if (held <= 0) continue;
    const melt = held * p.meltwaterLoss * clamp(map.GlacialMeltwater.get(i) / 1000, 0, 1);
    held -= melt;
    lost += melt;
    if (map.IceThickness.get(i) <= 0) {
      const amount = held;
      drop(map, i, amount, moraine, shelf, () => (lost += amount));
      ice.set(i, 0);
      continue;
    }
    const target = map.IceFlowTargets.get(i);
    if (target < 0) {
      ice.set(i, held);
      continue;
    }
    const share = held * p.iceCarry;
    held -= share;
    ice.set(i, held);
    if (map.IceThickness.get(target) > 0 && map.WaterKindCodes.get(target) !== 1)
      moved.add(target, share);
    else drop(map, target, share, moraine, shelf, () => (lost += share));
  }
  for (let i = 0; i < ice.length; i++) {
    const held = ice.get(i) + moved.get(i),
      thickness = map.IceThickness.get(i);
    ice.set(i, held);
    map.IceCharge.set(
      i,
      held > 0 && thickness > 0
        ? clamp(held / (map.mesh.area(i) * thickness * p.iceChargeSaturation), 0, 1)
        : 0
    );
  }
  releaseWorking(map, moved);
  return lost;
}
/** Where ice lets its charge go: the shelf at sea, the moraine on land, or out of the budget. */
function drop(
  map: PhysicalField,
  i: number,
  amount: number,
  moraine: Band | undefined,
  shelf: Band | undefined,
  lose: () => void
) {
  const sink = map.WaterKindCodes.get(i) === 1 ? shelf : moraine;
  if (sink) sink.add(i, amount);
  else lose();
}
function consume(field: MagicField, values: Band) {
  for (let i = 0; i < values.length; i++)
    values.set(i, values.get(i) * (1 - field.releasing.get(i)));
}
/** Placers: a share of the stock on a river cell moves to the cell the river flows to. */
function carryDownstream(map: PhysicalField, field: MagicField, values: Band) {
  const mobility = field.definition.parameters.placerMobility,
    moved = workingArray(map, "float64", "magic:river-carriage", values.length);
  let lost = 0;
  for (let i = 0; i < values.length; i++) {
    const value = values.get(i);
    if (value <= 0 || map.WaterKindCodes.get(i) === 1) continue;
    const share = value * mobility * (map.RiverOrders.get(i) > 0 ? 1 : 0.25),
      target = map.FlowTargets.get(i);
    if (share <= 0 || target < 0) continue;
    values.add(i, -share);
    if (map.WaterKindCodes.get(target) === 1) lost += share;
    else moved.add(target, share);
  }
  for (let i = 0; i < values.length; i++) values.add(i, moved.get(i));
  releaseWorking(map, moved);
  return lost;
}
/** The ejecta fan stays barren for the declared epochs after the fall, then recovers. */
function barrenFan(map: PhysicalField, field: MagicField, epochIndex: number) {
  const p = field.definition.parameters;
  for (let i = 0; i < map.mesh.count; i++) {
    const arrival = field.arrival.get(i);
    if (arrival < 0) continue;
    const age = epochIndex - arrival;
    if (age < 0 || age >= p.fanBarrenEpochs) continue;
    const depth = clamp(map.ImpactEjectaThickness.get(i) / units(p.fanBarrenDepth), 0, 1);
    map.EcologicalToxicity.set(
      i,
      Math.max(map.EcologicalToxicity.get(i), depth * (1 - age / p.fanBarrenEpochs))
    );
  }
}
/** The first declared stock of an origin: where its held cores sit. */
export function heldStock(field: MagicField, origin: MagicOrigin) {
  return field.stocks[stockKey(origin, originStocks(origin)[0])];
}
