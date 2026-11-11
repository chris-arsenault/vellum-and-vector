import type { MagicOrigin, MagicStock } from "@atlas/domain";
import { workingArray, releaseWorking } from "./physicalNumerics";
import type { GenerationState } from "../process";
import type { PhysicalField } from "./field";
import { originStocks, stockKey, withOrigin, type MagicField } from "./magicState";
import { clamp, round, units } from "./math";
import { displaceGround } from "../rock/groundLedger";
import { seepBrine, settleDust, weatherBed } from "./magicSaltStocks";
import { stockExposure, stockGroundHosts } from "../rock/rockMagicStock";
import type { MagicInventory } from "./magicInventory";
import { GroundInventory } from "../rock/groundInventory";
import { carryShelf } from "./magicCurrentStocks";
import { rockCatalogue } from "../rock/rockCatalogue";
import { buryLivingCharge, carryLitter } from "./magicGroundwater";
import { carrierPassage } from "./magicCarriers";
import { transferIce, receiveIceMelt, meltedInventory } from "../rock/groundSurfaceMedia";

/** Instantaneous melt releases its actual passenger without running a historical stock cycle. */
export function bindMagicIceMelt(state: GenerationState) {
  const map = state.physical!.map;
  receiveIceMelt(map, (cell, melted, before) => {
    for (const field of state.physical!.magic?.fields ?? [])
      for (const origin of field.definition.origins)
        withOrigin(field, origin, () => releaseOriginIce(map, field, origin, cell, melted, before));
  });
}
function releaseOriginIce(
  map: PhysicalField,
  field: MagicField,
  origin: MagicOrigin,
  cell: number,
  melted: number,
  before: number
) {
  for (const stock of originStocks(origin)) {
    if (stock.reservoir !== "ice" && stock.reservoir !== "shelf") continue;
    const values = field.stocks[stockKey(origin, stock)],
      released = meltedInventory(values.get(cell), melted, before);
    if (released <= 0) continue;
    values.add(cell, -released);
    if (stock.reservoir === "shelf" || map.WaterKindCodes.get(cell) === 1) {
      field.lost += released;
      continue;
    }
    const lost = released * field.definition.parameters.meltwaterLoss,
      debris = released - lost;
    field.lost += lost;
    drop(map, cell, debris, field.stocks[`${origin.id}/moraine`], undefined, () => {
      field.lost += debris;
    });
  }
}

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
 * How much of a cell's stock the ground exposes, resolving its host beneath loose and solid cover
 * on each occupied facet. Stocks without a named host use the depth to the first rock.
 */
export const exposure = stockExposure;
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
  if (map.Temperature.get(i) < 300 && ice <= 0) share += p.frostCracking;
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
    withOrigin(field, origin, () => {
      for (const stock of originStocks(origin)) advanceStock(map, field, origin, stock);
      if (origin.source === "impact") barrenFan(map, field, epochIndex);
      if (origin.source === "aquifer") collapseOverdrawn(map, field, origin);
    });
  }
  field.drawn.fill(0);
}
/** What a reservoir does in the advance, then what its carriers do. */
const reservoirAdvances: Record<
  string,
  (map: PhysicalField, field: MagicField, values: MagicInventory, origin: MagicOrigin) => void
> = {
  ice: (_map, field, values) => gatherIntoIce(field, values),
  stratum: (map, field, values, origin) => {
    buryLivingCharge(map, field, values, origin);
  },
  sap: decaySap,
  forge: coolForge,
};
/** Retained material exchanges, independent of supply and elapsed reservoir aging. */
const materialResponses: typeof reservoirAdvances = {
  brine: seepBrine,
  bed: weatherBed,
  dust: settleDust,
};
/** One local transport exposure, using the same carrier owners as an elapsed world pass. */
export function transportRetainedMagic(state: GenerationState) {
  const { map, magic } = state.physical!;
  for (const field of magic?.fields ?? [])
    for (const origin of field.definition.origins)
      withOrigin(field, origin, () => {
        for (const stock of originStocks(origin))
          transportStock(map, field, origin, stock, field.stocks[stockKey(origin, stock)]);
      });
}
function advanceStock(
  map: PhysicalField,
  field: MagicField,
  origin: MagicOrigin,
  stock: MagicStock
) {
  const values = field.stocks[stockKey(origin, stock)];
  if (origin.renewal === "finite" && stock === originStocks(origin)[0]) consume(field, values);
  reservoirAdvances[stock.reservoir]?.(map, field, values, origin);
  transportStock(map, field, origin, stock, values);
}
function transportStock(
  map: PhysicalField,
  field: MagicField,
  origin: MagicOrigin,
  stock: MagicStock,
  values: MagicInventory
) {
  materialResponses[stock.reservoir]?.(map, field, values, origin);
  carryStock(map, field, origin, stock, values);
}
function carryStock(
  map: PhysicalField,
  field: MagicField,
  origin: MagicOrigin,
  stock: MagicStock,
  values: MagicInventory
) {
  if (stock.carriers.includes("river") && stock.reservoir === "sap")
    carryLitter(map, field, values, origin);
  else if (stock.carriers.includes("river") && !(values instanceof GroundInventory))
    field.lost += carryDownstream(map, field, values);
  if (stock.carriers.includes("ice")) field.lost += carryWithIce(map, field, origin, values);
  if (stock.carriers.includes("current")) carryShelf(map, field, values);
  if (stock.carriers.includes("animal")) carryInTheGut(map, field, values);
}
/** Sap a cell holds without a stand of its own is spent by the share declared, per epoch. */
function decaySap(map: PhysicalField, field: MagicField, sap: MagicInventory) {
  const loss = field.definition.parameters.sapLoss;
  for (let i = 0; i < sap.length; i++) {
    const spent = sap.get(i) * loss;
    sap.add(i, -spent);
    if (map.WaterKindCodes.get(i) !== 0 || map.IceThickness.get(i) > 0) continue;
    const suitable =
        clamp(map.SoilDepth.get(i) / map.scale.length(1.25e-7), 0, 1) *
        clamp(map.SoilWater.get(i) / map.scale.length(2.5e-8), 0, 1),
      seeds = (suitable * spent) / (map.mesh.area(i) * field.definition.parameters.groveSap);
    map.BroadleafSeed.set(i, clamp(map.BroadleafSeed.get(i) + seeds, 0, 1));
    map.ConiferSeed.set(i, clamp(map.ConiferSeed.get(i) + seeds, 0, 1));
  }
}
/** Cracked cores cool: a share of the forge stock is gone each epoch. */
function coolForge(_map: PhysicalField, field: MagicField, cracked: MagicInventory) {
  const keep = 1 - field.definition.parameters.forgeCooling;
  for (let i = 0; i < cracked.length; i++) {
    const value = cracked.get(i);
    field.lost += value * (1 - keep);
    cracked.set(i, value * keep);
  }
}
/**
 * Herbivores carry a stock in the gut: a share of a grazed cell's stock goes to the
 * neighbours in proportion to the herds there, so a herd road seeds the ground ahead of it.
 */
function carryInTheGut(map: PhysicalField, field: MagicField, values: MagicInventory) {
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
    const drop = p.sinkDepth;
    if (drop <= 0) continue;
    field.subsided.add(i, drop);
    displaceGround(map, i, -units(drop), "greenwood");
  }
}
/** The charge this epoch's propagation captured in the ice joins the ice reservoir. */
function gatherIntoIce(field: MagicField, ice: MagicInventory) {
  for (let i = 0; i < ice.length; i++) ice.add(i, field.retained.get(i));
}
/** The ground reservoir is the stored charge as an amount; the history pass keeps `stored`. */
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
  ice: MagicInventory
) {
  const p = field.definition.parameters,
    moraine = field.stocks[`${origin.id}/moraine`],
    shelf = field.stocks[`${origin.id}/shelf`],
    moved = workingArray(map, "float64", "magic:ice-carriage", ice.length);
  let lost = 0;
  for (let i = 0; i < ice.length; i++) {
    let held = ice.get(i);
    if (held <= 0) continue;
    if (map.IceThickness.get(i) <= 0 || map.WaterKindCodes.get(i) === 1) {
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
    const share = held * p.iceCarry * carrierPassage(map, "ice", target);
    held -= share;
    ice.set(i, held);
    if (map.IceThickness.get(target) > 0 && map.WaterKindCodes.get(target) !== 1)
      moved.add(target, share);
    else {
      calveIce(map, i, target, share / (held + share));
      drop(map, target, share, moraine, shelf, () => (lost += share));
    }
  }
  for (let i = 0; i < ice.length; i++) {
    const held = ice.get(i) + moved.get(i),
      thickness = map.IceThickness.get(i);
    ice.set(i, held);
    map.IceCharge.set(
      i,
      iceConcentration(held, map.mesh.area(i) * thickness * p.iceChargeSaturation)
    );
  }
  releaseWorking(map, moved);
  return lost;
}
function iceConcentration(held: number, capacity: number) {
  return held > 0 && capacity > 0 ? clamp(held / capacity, 0, 1) : 0;
}
function calveIce(map: PhysicalField, source: number, target: number, share: number) {
  if (map.WaterKindCodes.get(target) !== 1) return;
  const calved = map.IceThickness.get(source) * share;
  transferIce(map, source, target, calved * map.mesh.area(source));
}
/** Where ice lets its charge go: the shelf at sea, the moraine on land, or out of the budget. */
function drop(
  map: PhysicalField,
  i: number,
  amount: number,
  moraine: MagicInventory | undefined,
  shelf: MagicInventory | undefined,
  lose: () => void
) {
  const sink = map.WaterKindCodes.get(i) === 1 ? shelf : moraine;
  if (sink instanceof GroundInventory)
    sink.construct(
      i,
      amount,
      units(amount / (map.mesh.area(i) * 500)),
      rockCatalogue.auroraCrystal.code,
      "ice debris"
    );
  else if (sink) sink.add(i, amount);
  else lose();
}
function consume(field: MagicField, values: MagicInventory) {
  for (let i = 0; i < values.length; i++)
    values.set(i, values.get(i) * (1 - field.releasing.get(i)));
}
/** Placers: a share of the stock on a river cell moves to the cell the river flows to. */
function carryDownstream(map: PhysicalField, field: MagicField, values: MagicInventory) {
  const mobility = field.definition.parameters.placerMobility,
    moved = workingArray(map, "float64", "magic:river-carriage", values.length);
  let lost = 0;
  for (let i = 0; i < values.length; i++) {
    const value = values.get(i);
    if (value <= 0 || map.WaterKindCodes.get(i) === 1) continue;
    const exposed = exposure(map, i, field.definition.parameters.buryDepth),
      target = map.FlowTargets.get(i),
      share =
        value *
        exposed *
        mobility *
        (map.RiverOrders.get(i) > 0 ? 1 : 0.25) *
        carrierPassage(map, "river", target);
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
/** Ground charge is retained in its reached material; stored is its read projection. */
export function retainGroundCharge(
  map: PhysicalField,
  field: MagicField,
  i: number,
  ground: MagicInventory | undefined,
  before: number,
  stored: number
) {
  if (ground instanceof GroundInventory) {
    const retained = before * field.definition.history.retention;
    ground.set(i, retained * map.mesh.area(i));
    ground.charge(
      i,
      Math.max(0, stored - retained) * map.mesh.area(i),
      units(field.definition.parameters.buryDepth),
      stockGroundHosts(field.definition.id, "ground") ?? []
    );
    field.stored.set(i, ground.get(i) / map.mesh.area(i));
  } else field.stored.set(i, stored);
}
/** Strain memory advances with time, never with inspection. */
export function rememberStrain(map: PhysicalField, field: MagicField) {
  for (const origin of field.definition.origins) {
    if (origin.source !== "strain") continue;
    const previous = field.stocks[`${origin.id}/held`];
    for (let i = 0; i < map.mesh.count; i++)
      previous.set(i, field.originSources[origin.id].get(i) * map.mesh.area(i));
  }
}
