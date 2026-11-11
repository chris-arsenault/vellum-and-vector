import type { MagicOrigin } from "@atlas/domain";
import type { PhysicalField } from "./field";
import type { MagicField } from "./magicState";
import type { MagicInventory } from "./magicInventory";
import { reservoirStock, originStocks, stockKey, withOrigin } from "./magicState";
import { GroundInventory } from "../rock/groundInventory";
import { materialFact } from "../rock/groundQuery";
import { alterGround } from "../rock/groundAlteration";
import { magicMaterial } from "../rock/rockMagic";
import { rockCatalogue } from "../rock/rockCatalogue";
import { materialLayer } from "../rock/rockColumn";
import { loadOf } from "../rock/groundLoad";
import { workingArray, releaseWorking } from "./physicalNumerics";
import { clamp, units } from "./math";
import type { GenerationState } from "../process";
import { organicCargoKey, organicDensity } from "../rock/organicMaterial";
import { receiveGroundwaterReturn, returnedCharge } from "./groundwater";
import { defineCommand } from "../processOperation";

/** Bind fluid inventory to water returns, including work performed after the epoch exchange. */
export function bindMagicGroundwater(state: GenerationState) {
  const map = state.physical!.map;
  receiveGroundwaterReturn(map, (cell, returned, available) => {
    for (const field of state.physical!.magic?.fields ?? [])
      for (const origin of field.definition.origins)
        returnOriginWater(state, field, origin, cell, returned, available);
  });
}
function returnOriginWater(
  state: GenerationState,
  field: MagicField,
  origin: MagicOrigin,
  cell: number,
  returned: number,
  available: number
) {
  const receiver = field.stocks[`${origin.id}/brine`] ?? field.stocks[`${origin.id}/springwater`];
  for (const stock of originStocks(origin)) {
    if (!stock.carriers.includes("groundwater")) continue;
    const water = field.stocks[stockKey(origin, stock)],
      moved = returnedCharge(water.get(cell), available, returned);
    if (moved <= 0) continue;
    water.add(cell, -moved);
    releaseWaterCharge(field, receiver, cell, moved);
  }
}

/** Once after ordinary groundwater moves and before current spring/soil response is evaluated. */
export const exchangeMagicWater = defineCommand("magic.water-exchange", "event", exchangeWater, []);
function exchangeWater(state: GenerationState) {
  const map = state.physical!.map;
  bindMagicGroundwater(state);
  for (const field of state.physical!.magic!.fields) {
    for (const origin of field.definition.origins)
      withOrigin(field, origin, () => {
        for (const stock of originStocks(origin)) {
          const values = field.stocks[stockKey(origin, stock)];
          if (stock.reservoir === "stratum") leachLivingStrata(map, field, values);
          if (stock.carriers.includes("groundwater")) carryGroundwater(map, field, values, origin);
        }
      });
  }
}

/** Fresh burial transfers charge from the organic carrier consumed by ordinary burial. */
export function buriedCharge(
  sap: number,
  buriedCarbon: number,
  remainingCarbon: number,
  share: number
) {
  const carbon = Math.max(0, buriedCarbon) + Math.max(0, remainingCarbon);
  return carbon > 0
    ? Math.max(0, sap) * (Math.max(0, buriedCarbon) / carbon) * clamp(share, 0, 1)
    : 0;
}
/** Charge follows actual new burial and river pickup; no living stock is renewed or aged. */
export function respondOrganicMaterial(state: GenerationState) {
  const { map, magic } = state.physical!;
  for (const field of magic?.fields ?? [])
    for (const origin of field.definition.origins)
      withOrigin(field, origin, () => {
        for (const stock of originStocks(origin)) {
          const values = field.stocks[stockKey(origin, stock)];
          if (stock.reservoir === "stratum") buryLivingCharge(map, field, values, origin);
          if (stock.reservoir === "sap" && stock.carriers.includes("river"))
            carryLitter(map, field, values, origin);
        }
      });
  map.OrganicBurialInput.fill(0);
  map.OrganicBurialThickness.fill(0);
}
/** Organic matter binds finite charge per mass; excess sap remains available at its source. */
export function litterPacket(
  sap: number,
  carbon: number,
  area: number,
  share: number,
  affinity: number
) {
  const taken = Math.max(0, carbon) * clamp(share, 0, 1),
    mass = taken * area,
    volume = mass / organicDensity;
  if (!(volume > 0) || !(sap > 0)) return undefined;
  const density = Math.min((sap * share) / mass, affinity) * organicDensity,
    amount = volume * density;
  if (!(amount > 0)) return undefined;
  return { carbon: taken, volume, density, amount };
}
export function buryLivingCharge(
  map: PhysicalField,
  field: MagicField,
  stratum: MagicInventory,
  origin: MagicOrigin
) {
  const sap = field.stocks[`${origin.id}/sap`];
  if (!(stratum instanceof GroundInventory) || !sap) return;
  for (let i = 0; i < map.mesh.count; i++) {
    const amount = Math.min(
        buriedCharge(
          sap.get(i),
          map.OrganicBurialInput.get(i),
          map.SoilCarbon.get(i) + map.PeatCarbon.get(i),
          field.definition.parameters.strataShare
        ),
        map.OrganicBurialInput.get(i) *
          map.mesh.area(i) *
          field.definition.parameters.organicChargeAffinity
      ),
      depth = units(
        Math.min(map.OrganicBurialThickness.get(i), map.OrganicBurialInput.get(i) / organicDensity)
      ),
      offset = Math.max(0, units(map.OrganicBurialThickness.get(i)) - depth);
    if (amount <= 0 || depth <= 0) continue;
    alterGround(map, i, {
      depth,
      offset,
      retainedOnly: true,
      transform: (layer) => magicMaterial(layer, rockCatalogue.rootstone, map.CompletedEpochCount),
    });
    const admitted = stratum.charge(
      i,
      amount,
      depth,
      [rockCatalogue.rootstone.code],
      "surface",
      offset
    );
    sap.add(i, -admitted);
  }
}
/** Dissolved charge leaves its actual buried package and enters water at the same place. */
export function leachLivingStrata(map: PhysicalField, field: MagicField, stratum: MagicInventory) {
  const water = reservoirStock(field, "aquifer");
  if (!(stratum instanceof GroundInventory) || !water) return;
  const reach = units(map.scale.length(2.5e-6));
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes.get(i) === 1) continue;
    const wet = clamp(
      (map.GroundwaterRecharge.get(i) + map.GroundwaterStorage.get(i)) / map.scale.length(2.5e-6),
      0,
      1
    );
    if (wet <= 0) continue;
    water.add(
      i,
      stratum.release(i, reach, (layer) => wet * materialFact(layer, "porosity") * 0.2)
    );
  }
}
/** Declared groundwater stocks share water routing, while their root-zone destinations remain distinct. */
export function carryGroundwater(
  map: PhysicalField,
  field: MagicField,
  water: MagicInventory,
  origin: MagicOrigin
) {
  const moved = workingArray(map, "float64", "magic:groundwater-carriage"),
    brine = field.definition.effects.salting > 0 ? field.stocks[`${origin.id}/brine`] : undefined,
    spring = field.stocks[`${origin.id}/springwater`];
  for (let i = 0; i < water.length; i++) {
    spring?.set(i, 0);
    // The water owner drains marine groundwater to the sea. Charge carried into an
    // already drained cell by crust motion also leaves; it cannot await nonexistent water.
    if (map.WaterKindCodes.get(i) === 1) {
      field.lost += water.get(i);
      water.set(i, 0);
      continue;
    }
    rechargeBrine(map, i, brine, water, field.definition.parameters.seepShare);
    const held = water.get(i),
      outflow = map.GroundwaterOutflow.get(i),
      returned = map.GroundwaterReturn.get(i),
      volume = map.GroundwaterExchangeVolume.get(i);
    if (held <= 0 || volume <= 0) continue;
    const released = (held * returned) / volume,
      carried = (held * outflow) / volume,
      target = map.GroundwaterTargets.get(i);
    water.add(i, -released - carried);
    releaseWaterCharge(field, brine ?? spring, i, released);
    if (waterDestination(map, target)) moved.add(target, carried);
    else field.lost += carried;
  }
  for (let i = 0; i < water.length; i++) water.add(i, moved.get(i));
  releaseWorking(map, moved);
}
function rechargeBrine(
  map: PhysicalField,
  cell: number,
  brine: MagicInventory | undefined,
  water: MagicInventory,
  share: number
) {
  if (!brine) return;
  const recharge = map.GroundwaterRecharge.get(cell),
    infiltrated =
      returnedCharge(brine.get(cell), map.SoilWater.get(cell) + recharge, recharge) * share;
  brine.add(cell, -infiltrated);
  water.add(cell, infiltrated);
}
const waterDestination = (map: PhysicalField, target: number) =>
  target >= 0 && map.WaterKindCodes.get(target) !== 1;
function releaseWaterCharge(
  field: MagicField,
  receiver: MagicInventory | undefined,
  cell: number,
  amount: number
) {
  if (receiver) receiver.add(cell, amount);
  else field.lost += amount;
}
/** River pickup consumes real litter and sap; ordinary sediment routing owns its next destination. */
export function carryLitter(
  map: PhysicalField,
  field: MagicField,
  sap: MagicInventory,
  origin: MagicOrigin
) {
  const stratum = field.stocks[`${origin.id}/stratum`];
  if (!(stratum instanceof GroundInventory)) return;
  for (let i = 0; i < sap.length; i++) {
    if (map.RiverOrders.get(i) <= 0 || map.WaterKindCodes.get(i) === 1) continue;
    const packet = litterPacket(
      sap.get(i),
      map.SoilCarbon.get(i),
      map.mesh.area(i),
      field.definition.parameters.placerMobility * clamp(map.Runoff.get(i) / 1000, 0, 1),
      field.definition.parameters.organicChargeAffinity
    );
    if (!packet) continue;
    map.SoilCarbon.add(i, -packet.carbon);
    sap.add(i, -packet.amount);
    loadOf(map).add(
      i,
      materialLayer(
        rockCatalogue.rootstone.code,
        packet.volume,
        {
          cargo: new Float64Array([
            stratum.key,
            rockCatalogue.rootstone.code,
            packet.density,
            organicCargoKey(map),
            0,
            organicDensity,
          ]),
        },
        map.CompletedEpochCount
      )
    );
  }
}
