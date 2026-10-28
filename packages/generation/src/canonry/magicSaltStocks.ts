import type { Band, MagicOrigin } from "@atlas/domain";
import { workingArray, releaseWorking } from "./physicalNumerics";
import type { PhysicalField } from "./field";
import type { MagicField } from "./magicState";
import { exposure } from "./magicStocks";
import { alignedNeighbor } from "./atmosphere";
import { clamp, units } from "./math";
import { rebuild } from "./surface";

/**
 * Brine between evaluations: flushed by the air's moisture where the ground has oxygen
 * (wetland and peat keep it), seeping one cell down the drainage, lost where the drainage
 * reaches the sea, and crusting to bed at a pit or on a lake floor.
 */
export function seepBrine(map: PhysicalField, field: MagicField, brine: Band, origin: MagicOrigin) {
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
      if (bed) bed.add(i, crust);
      continue;
    }
    const share = brine.get(i) * p.seepShare;
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
 * ground drops a bounded sink; on bare dry ground the wind lifts a share to the downwind
 * cell as dust.
 */
export function weatherBed(map: PhysicalField, field: MagicField, bed: Band, origin: MagicOrigin) {
  const p = field.definition.parameters,
    brine = field.stocks[`${origin.id}/brine`],
    dust = field.stocks[`${origin.id}/dust`],
    moved = workingArray(map, "float64", "magic:weather-bed", bed.length);
  for (let i = 0; i < bed.length; i++) {
    if (bed.get(i) <= 0) continue;
    if (map.WaterKindCodes.get(i) === 1) {
      field.lost += bed.get(i);
      bed.set(i, 0);
      continue;
    }
    const exposed = exposure(map, i, p.buryDepth);
    if (exposed > 0) weatherExposed(map, field, i, bed, brine, exposed, moved);
    else if (map.TectonicStrain.get(i) >= p.domeStrain) dome(map, field, i, bed, brine);
  }
  if (dust) for (let i = 0; i < bed.length; i++) dust.add(i, moved.get(i));
  releaseWorking(map, moved);
}
/** An exposed bed dissolves where the ground is wet and blows where it is bare and dry. */
function weatherExposed(
  map: PhysicalField,
  field: MagicField,
  i: number,
  bed: Band,
  brine: Band | undefined,
  exposed: number,
  moved: Band
) {
  if (map.Moisture.get(i) > 500 && map.WaterKindCodes.get(i) === 0 && brine)
    dissolve(map, field, i, bed, brine, exposed);
  const lifted = liftedDust(map, field.definition.parameters, bed.get(i), exposed, i);
  if (lifted <= 0) return;
  const target = alignedNeighbor(map, i, map.WindX.get(i) / 1000, map.WindY.get(i) / 1000);
  if (target < 0) return;
  bed.add(i, -lifted);
  if (map.WaterKindCodes.get(target) === 1) field.lost += lifted;
  else moved.add(target, lifted);
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
  bed: Band,
  brine: Band,
  exposed: number
) {
  const p = field.definition.parameters,
    dissolved = bed.get(i) * exposed * p.dissolveShare * (map.Moisture.get(i) / 1000);
  if (dissolved <= 0) return;
  bed.add(i, -dissolved);
  brine.add(i, dissolved);
  const room = Math.max(0, p.thawSubsidenceLimit - field.subsided.get(i)),
    drop = Math.min(room, p.sinkDepth * Math.min(1, dissolved / (map.mesh.area(i) * p.saltFull)));
  if (drop <= 0) return;
  field.subsided.add(i, drop);
  map.BedrockElevation.add(i, -units(drop));
  rebuild(map, i);
}
/**
 * A buried bed under strain rises as a dome: the ground over it lifts by a bounded amount
 * per epoch and a share of the bed seeps to the ring of cells around it as brine, the brine
 * springs that ring a salt dome.
 */
function dome(
  map: PhysicalField,
  field: MagicField,
  i: number,
  bed: Band,
  brine: Band | undefined
) {
  const p = field.definition.parameters,
    room = Math.max(0, p.domeLimit - field.domed.get(i)),
    rise = Math.min(room, p.domeRise * Math.min(1, bed.get(i) / (map.mesh.area(i) * p.saltFull)));
  if (rise > 0) {
    field.domed.add(i, rise);
    map.BedrockElevation.add(i, units(rise));
    rebuild(map, i);
  }
  if (!brine) return;
  const ring: number[] = [];
  for (let edge = 0; edge < map.mesh.degree(i); edge++) {
    const j = map.mesh.neighbor(i, edge);
    if (j >= 0 && map.WaterKindCodes.get(j) === 0) ring.push(j);
  }
  if (!ring.length) return;
  const seep = bed.get(i) * p.domeSeep;
  bed.add(i, -seep);
  for (const j of ring) brine.add(j, seep / ring.length);
}
/** Dust settles to bed by its share each epoch; the rest blows one cell on, or out to sea. */
export function settleDust(map: PhysicalField, field: MagicField, dust: Band, origin: MagicOrigin) {
  const p = field.definition.parameters,
    bed = field.stocks[`${origin.id}/bed`],
    moved = workingArray(map, "float64", "magic:settle-dust", dust.length);
  for (let i = 0; i < dust.length; i++) {
    if (dust.get(i) <= 0) continue;
    const settled = dust.get(i) * p.dustSettle;
    dust.add(i, -settled);
    if (bed) bed.add(i, settled);
    const target = alignedNeighbor(map, i, map.WindX.get(i) / 1000, map.WindY.get(i) / 1000);
    if (target < 0) continue;
    const blown = dust.get(i);
    dust.set(i, 0);
    if (map.WaterKindCodes.get(target) === 1) field.lost += blown;
    else moved.add(target, blown);
  }
  for (let i = 0; i < dust.length; i++) dust.add(i, moved.get(i));
  releaseWorking(map, moved);
}
