import { MapScale, type MagicOrigin } from "@atlas/domain";
import { rockCatalogue } from "../rock/rockCatalogue";
import {
  depositSaltBed,
  retainedHostDepth,
  stockExposure,
  withdrawSaltBed,
} from "../rock/rockMagicStock";
import { workingArray, releaseWorking } from "./physicalNumerics";
import type { PhysicalField } from "./field";
import type { MagicField } from "./magicState";
import { alignedNeighbor } from "./atmosphere";
import { clamp, units } from "./math";
import { deposit, displaceGround } from "../rock/groundLedger";
import { MaterialLoad, seaLoadOf } from "../rock/groundLoad";
import type { MagicInventory } from "./magicInventory";
import { GroundInventory } from "../rock/groundInventory";
import { rekeyCargo, withoutCargo } from "../rock/materialCargo";
import { carrierPassage } from "./magicCarriers";

/**
 * Brine between evaluations: flushed by the air's moisture where the ground has oxygen
 * (wetland and peat keep it), seeping one cell down the drainage, lost where the drainage
 * reaches the sea, and crusting to bed at a pit or on a lake floor.
 */
export function seepBrine(
  map: PhysicalField,
  field: MagicField,
  brine: MagicInventory,
  origin: MagicOrigin
) {
  const p = field.definition.parameters,
    bed = field.stocks[`${origin.id}/bed`],
    moved = workingArray(map, "float64", "magic:seep-brine", brine.length);
  for (let i = 0; i < brine.length; i++) {
    if (brine.get(i) <= 0) continue;
    const anoxic = clamp(map.WetlandCover.get(i) + map.PeatCarbon.get(i) / 20, 0, 1),
      flushed = brine.get(i) * p.brineFlush * (map.Moisture.get(i) / 1000) * (1 - anoxic);
    brine.add(i, -flushed);
    field.lost += flushed;
    const target = map.FlowTargets.get(i);
    // A pit, a lake floor, or a ward across the drainage: the brine pools here and crusts.
    if (target < 0 || map.WaterKindCodes.get(i) === 2 || map.Warding.get(target) >= 0.5) {
      const crust = brine.get(i) * p.crustShare;
      brine.add(i, -crust);
      if (bed) depositSaltBed(map, bed, i, crust, p.saltMaterialDensity);
      continue;
    }
    const share = brine.get(i) * p.seepShare * carrierPassage(map, "river", target);
    brine.add(i, -share);
    if (map.WaterKindCodes.get(target) === 1) field.lost += share;
    else moved.add(target, share);
  }
  for (let i = 0; i < brine.length; i++) brine.add(i, moved.get(i));
  releaseWorking(map, moved);
}
/**
 * Bed between evaluations: inert under sediment unless strain domes it; dissolved to the
 * sea where the sea covers it; on wet ground an exposed bed dissolves back to brine and the
 * ground sinks; on bare dry ground the wind lifts a share to the downwind
 * cell as dust.
 */
export function weatherBed(
  map: PhysicalField,
  field: MagicField,
  bed: MagicInventory,
  origin: MagicOrigin
) {
  const p = field.definition.parameters,
    brine = field.stocks[`${origin.id}/brine`],
    dust = field.stocks[`${origin.id}/dust`],
    cargo = new MaterialLoad(map, "salt:wind-bed");
  for (let i = 0; i < bed.length; i++) {
    if (bed.get(i) <= 0) continue;
    const exposed =
      bed instanceof GroundInventory
        ? bed.reached(i, units(p.buryDepth)) / bed.get(i)
        : stockExposure(map, i, p.buryDepth, [rockCatalogue.saltbed.code]);
    if (map.WaterKindCodes.get(i) === 1) {
      const dissolved = withdrawSaltBed(bed, i, bed.get(i) * exposed * p.dissolveShare, {
        reach: units(p.buryDepth),
      });
      field.lost += dissolved;
      continue;
    }
    if (exposed > 0) weatherExposed(map, field, i, bed, brine, exposed, cargo, dust);
    else if (map.TectonicStrain.get(i) >= p.domeStrain) dome(map, field, i, bed, brine);
  }
  depositGrains(map, cargo);
}
/** Moisture past which an exposed bed dissolves. */
export const bedDissolvesAbove = 500;
/** An exposed bed dissolves where the ground is wet and blows where it is bare and dry. */
function weatherExposed(
  map: PhysicalField,
  field: MagicField,
  i: number,
  bed: MagicInventory,
  brine: MagicInventory | undefined,
  exposed: number,
  cargo: MaterialLoad,
  dust: MagicInventory | undefined
) {
  if (map.Moisture.get(i) > bedDissolvesAbove && map.WaterKindCodes.get(i) === 0 && brine)
    dissolve(map, field, i, bed, brine, exposed);
  const lifted = liftedDust(map, field.definition.parameters, bed.get(i), exposed, i);
  if (lifted <= 0) return;
  const target = alignedNeighbor(map, i, map.WindX.get(i) / 1000, map.WindY.get(i) / 1000);
  if (target < 0) return;
  moveGrains(map, field, bed, i, target, lifted, cargo, dust);
}
function liftedDust(
  map: PhysicalField,
  p: MagicField["definition"]["parameters"],
  bed: number,
  exposed: number,
  i: number
) {
  const wind = Math.min(1, Math.hypot(map.WindX.get(i), map.WindY.get(i)) / 1000),
    bare = 1 - clamp(map.TreeCover.get(i) + map.GrassCover.get(i) + map.WetlandCover.get(i), 0, 1);
  return bed * exposed * p.dustShare * wind * bare;
}
/** Exposed bed on wet ground goes back to brine; the ground over the dissolved bed falls in. */
function dissolve(
  map: PhysicalField,
  field: MagicField,
  i: number,
  bed: MagicInventory,
  brine: MagicInventory,
  exposed: number
) {
  const p = field.definition.parameters,
    dissolved = withdrawSaltBed(
      bed,
      i,
      bed.get(i) * exposed * p.dissolveShare * (map.Moisture.get(i) / 1000),
      { reach: units(p.buryDepth) }
    );
  if (dissolved <= 0) return;
  brine.add(i, dissolved);
  const drop = dissolved / (map.mesh.area(i) * p.saltMaterialDensity);
  field.subsided.add(i, drop);
}
/**
 * A buried bed under strain rises as a dome: the ground over it lifts according to the stock
 * per epoch and a share of the bed seeps to the ring of cells around it as brine, the brine
 * springs that ring a salt dome.
 */
function dome(
  map: PhysicalField,
  field: MagicField,
  i: number,
  bed: MagicInventory,
  brine: MagicInventory | undefined
) {
  const p = field.definition.parameters,
    retained =
      MapScale.metres(retainedHostDepth(map, i, [rockCatalogue.saltbed.code]), "native") *
      map.mesh.area(i) *
      p.saltMaterialDensity;
  // A depleted or eroded seam cannot dome merely because its cell still holds a charge record.
  if (retained <= 0) return;
  const rise =
    p.domeRise * Math.min(1, Math.min(bed.get(i), retained) / (map.mesh.area(i) * p.saltFull));
  if (rise > 0) {
    field.domed.add(i, rise);
    displaceGround(map, i, units(rise), "salt");
  }
  if (!brine) return;
  const ring: number[] = [];
  for (let edge = 0; edge < map.mesh.degree(i); edge++) {
    const j = map.mesh.neighbor(i, edge);
    if (j >= 0 && map.WaterKindCodes.get(j) === 0) ring.push(j);
  }
  if (!ring.length) return;
  const seep = withdrawSaltBed(bed, i, bed.get(i) * p.domeSeep, {
    reach: Infinity,
  });
  for (const j of ring) brine.add(j, seep / ring.length);
}
/** Dust grains rest in loose ground between hops; settling changes their reservoir, not their age. */
export function settleDust(
  map: PhysicalField,
  field: MagicField,
  dust: MagicInventory,
  origin: MagicOrigin
) {
  const p = field.definition.parameters,
    bed = field.stocks[`${origin.id}/bed`],
    cargo = new MaterialLoad(map, "salt:wind-dust");
  for (let i = 0; i < dust.length; i++) {
    if (dust.get(i) <= 0) continue;
    const settled = dust.get(i) * p.dustSettle;
    if (dust instanceof GroundInventory && bed instanceof GroundInventory)
      dust.transfer(i, settled, bed);
    const target = alignedNeighbor(map, i, map.WindX.get(i) / 1000, map.WindY.get(i) / 1000);
    if (target < 0) continue;
    const blown = dust.get(i);
    moveGrains(map, field, dust, i, target, blown, cargo, dust, true);
  }
  depositGrains(map, cargo);
}

/** A hop transports actual constituent parcels; sea export retains grains while losing magic. */
function moveGrains(
  map: PhysicalField,
  field: MagicField,
  stock: MagicInventory,
  cell: number,
  target: number,
  amount: number,
  cargo: MaterialLoad,
  destination: MagicInventory | undefined,
  looseOnly = false
) {
  const sea = map.WaterKindCodes.get(target) === 1,
    carried = withdrawSaltBed(
      stock,
      cell,
      amount * carrierPassage(map, "wind", target),
      { reach: Infinity, surfaceOnly: true, looseOnly },
      (material) => {
        const payload =
          stock instanceof GroundInventory && destination instanceof GroundInventory
            ? rekeyCargo(material.cargo, stock.key, destination.key)
            : material.cargo;
        (sea ? seaLoadOf(map) : cargo).add(target, {
          ...material,
          cargo:
            sea && stock instanceof GroundInventory
              ? withoutCargo(material.cargo, stock.key)
              : payload,
          depth: MapScale.metres(material.depth, "native") * map.mesh.area(cell),
        });
      }
    );
  if (sea) field.lost += carried;
}

function depositGrains(map: PhysicalField, cargo: MaterialLoad) {
  for (let cell = 0; cell < map.mesh.count; cell++) {
    const material = cargo.get(cell);
    if (material.depth <= 0) continue;
    const depth = MapScale.inUnits(material.depth / map.mesh.area(cell), "native");
    deposit(map, cell, depth, "salt", "load", { ...material, depth });
  }
  cargo.release();
}
