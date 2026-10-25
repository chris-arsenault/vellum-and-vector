import type { MagicOrigin } from "@atlas/domain";
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
export function seepBrine(
  map: PhysicalField,
  field: MagicField,
  brine: Float64Array,
  origin: MagicOrigin
) {
  const p = field.definition.parameters,
    bed = field.stocks[`${origin.id}/bed`],
    moved = new Float64Array(brine.length);
  for (let i = 0; i < brine.length; i++) {
    if (brine[i] <= 0) continue;
    const anoxic = clamp(map.WetlandCover[i] + map.PeatCarbon[i] / 20, 0, 1),
      flushed = brine[i] * p.brineFlush * (map.Moisture[i] / 1000) * (1 - anoxic);
    brine[i] -= flushed;
    field.lost += flushed;
    const target = map.FlowTargets[i];
    // A pit, a lake floor, or a ward across the drainage: the brine pools here and crusts.
    if (target < 0 || map.WaterKindCodes[i] === 2 || map.Warding[target] >= 0.5) {
      const crust = brine[i] * p.crustShare;
      brine[i] -= crust;
      if (bed) bed[i] += crust;
      continue;
    }
    const share = brine[i] * p.seepShare;
    brine[i] -= share;
    if (map.WaterKindCodes[target] === 1) field.lost += share;
    else moved[target] += share;
  }
  for (let i = 0; i < brine.length; i++) brine[i] += moved[i];
}
/**
 * Bed between evaluations: inert under sediment unless strain domes it; dissolved to the
 * sea where the sea covers it; on wet ground an exposed bed dissolves back to brine and the
 * ground drops a bounded sink; on bare dry ground the wind lifts a share to the downwind
 * cell as dust.
 */
export function weatherBed(
  map: PhysicalField,
  field: MagicField,
  bed: Float64Array,
  origin: MagicOrigin
) {
  const p = field.definition.parameters,
    brine = field.stocks[`${origin.id}/brine`],
    dust = field.stocks[`${origin.id}/dust`],
    moved = new Float64Array(bed.length);
  for (let i = 0; i < bed.length; i++) {
    if (bed[i] <= 0) continue;
    if (map.WaterKindCodes[i] === 1) {
      field.lost += bed[i];
      bed[i] = 0;
      continue;
    }
    const exposed = exposure(map, i, p.buryDepth);
    if (exposed > 0) weatherExposed(map, field, i, bed, brine, exposed, moved);
    else if (map.TectonicStrain[i] >= p.domeStrain) dome(map, field, i, bed, brine);
  }
  if (dust) for (let i = 0; i < bed.length; i++) dust[i] += moved[i];
}
/** An exposed bed dissolves where the ground is wet and blows where it is bare and dry. */
function weatherExposed(
  map: PhysicalField,
  field: MagicField,
  i: number,
  bed: Float64Array,
  brine: Float64Array | undefined,
  exposed: number,
  moved: Float64Array
) {
  if (map.Moisture[i] > 500 && map.WaterKindCodes[i] === 0 && brine)
    dissolve(map, field, i, bed, brine, exposed);
  const lifted = liftedDust(map, field.definition.parameters, bed[i], exposed, i);
  if (lifted <= 0) return;
  const target = alignedNeighbor(map, i, map.WindX[i] / 1000, map.WindY[i] / 1000);
  if (target < 0) return;
  bed[i] -= lifted;
  if (map.WaterKindCodes[target] === 1) field.lost += lifted;
  else moved[target] += lifted;
}
function liftedDust(
  map: PhysicalField,
  p: MagicField["definition"]["parameters"],
  bed: number,
  exposed: number,
  i: number
) {
  const wind = Math.min(1, Math.hypot(map.WindX[i], map.WindY[i]) / 1000),
    bare = 1 - clamp(map.TreeCover[i] + map.GrassCover[i] + map.WetlandCover[i], 0, 1);
  return bed * exposed * p.dustShare * wind * bare;
}
/** Exposed bed on wet ground goes back to brine; the ground over the dissolved bed falls in. */
function dissolve(
  map: PhysicalField,
  field: MagicField,
  i: number,
  bed: Float64Array,
  brine: Float64Array,
  exposed: number
) {
  const p = field.definition.parameters,
    dissolved = bed[i] * exposed * p.dissolveShare * (map.Moisture[i] / 1000);
  if (dissolved <= 0) return;
  bed[i] -= dissolved;
  brine[i] += dissolved;
  const room = Math.max(0, p.thawSubsidenceLimit - field.subsided[i]),
    drop = Math.min(room, p.sinkDepth * Math.min(1, dissolved / (map.mesh.areas[i] * p.saltFull)));
  if (drop <= 0) return;
  field.subsided[i] += drop;
  map.BedrockElevation[i] -= units(drop);
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
  bed: Float64Array,
  brine: Float64Array | undefined
) {
  const p = field.definition.parameters,
    room = Math.max(0, p.domeLimit - field.domed[i]),
    rise = Math.min(room, p.domeRise * Math.min(1, bed[i] / (map.mesh.areas[i] * p.saltFull)));
  if (rise > 0) {
    field.domed[i] += rise;
    map.BedrockElevation[i] += units(rise);
    rebuild(map, i);
  }
  if (!brine) return;
  const ring: number[] = [];
  for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
    const j = map.mesh.neighbors[i * map.mesh.stride + edge];
    if (j >= 0 && map.WaterKindCodes[j] === 0) ring.push(j);
  }
  if (!ring.length) return;
  const seep = bed[i] * p.domeSeep;
  bed[i] -= seep;
  for (const j of ring) brine[j] += seep / ring.length;
}
/** Dust settles to bed by its share each epoch; the rest blows one cell on, or out to sea. */
export function settleDust(
  map: PhysicalField,
  field: MagicField,
  dust: Float64Array,
  origin: MagicOrigin
) {
  const p = field.definition.parameters,
    bed = field.stocks[`${origin.id}/bed`],
    moved = new Float64Array(dust.length);
  for (let i = 0; i < dust.length; i++) {
    if (dust[i] <= 0) continue;
    const settled = dust[i] * p.dustSettle;
    dust[i] -= settled;
    if (bed) bed[i] += settled;
    const target = alignedNeighbor(map, i, map.WindX[i] / 1000, map.WindY[i] / 1000);
    if (target < 0) continue;
    const blown = dust[i];
    dust[i] = 0;
    if (map.WaterKindCodes[target] === 1) field.lost += blown;
    else moved[target] += blown;
  }
  for (let i = 0; i < dust.length; i++) dust[i] += moved[i];
}
