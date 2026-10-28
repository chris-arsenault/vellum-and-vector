import type { GenerationState } from "../process";
import type { PhysicalField } from "./field";
import type { MagicField } from "./magicState";
import type { LocateContext } from "./magicSources";
import { siteStrength } from "./magicStocks";

/**
 * Salt's death origin: the dead the ground records become brine where they lie. The record
 * is consumed, since the Salt is what is left of them; the source is the salt made this
 * evaluation per area, so a rule can mark the killing in the epoch it happened. A town's
 * ordinary dead make brine but no source: only a killing past the source floor is a site.
 */
export function deathSources(
  state: GenerationState,
  field: MagicField,
  _seed: number,
  { origin }: LocateContext
) {
  const map = state.physical!.map,
    p = field.definition.parameters,
    brine = field.stocks[`${origin.id}/brine`];
  if (!brine) return;
  for (let i = 0; i < map.mesh.count; i++) {
    const dead = map.MassDeath.get(i);
    if (dead <= 0) continue;
    const made = dead * p.saltPerDeath;
    map.MassDeath.set(i, 0);
    if (made <= 0) continue;
    brine.add(i, made);
    field.source.set(i, siteStrength((1000 * made) / map.mesh.area(i) / p.saltFull));
  }
}
/**
 * Salt's dead-lake origin: a cell that was a lake and is dry ground in a depression now
 * leaves its bed, by the depth of water it held. The memory is consumed with the lake.
 */
export function deadLakeSources(
  state: GenerationState,
  field: MagicField,
  _seed: number,
  { origin }: LocateContext
) {
  const map = state.physical!.map,
    p = field.definition.parameters,
    bed = field.stocks[`${origin.id}/bed`];
  if (!bed) return;
  for (let i = 0; i < map.mesh.count; i++) {
    const memory = map.LakeMemory.get(i);
    if (memory <= 0 || map.WaterKindCodes.get(i) !== 0 || map.IceThickness.get(i) > 0) continue;
    // Still a basin: the floor lies below the spill its drainage fills to.
    if (map.DrainageElevations.get(i) <= map.Elevation.get(i)) continue;
    const made = memory * map.mesh.area(i) * p.saltPerLakeMetre;
    map.LakeMemory.set(i, 0);
    if (made <= 0) continue;
    bed.add(i, made);
    field.source.set(i, siteStrength((1000 * made) / map.mesh.area(i) / p.saltFull));
  }
}
/** While a cell is a lake it remembers its depth; the memory outlives the water for Salt to read. */
export function rememberLakes(map: PhysicalField) {
  for (let i = 0; i < map.mesh.count; i++)
    if (map.WaterKindCodes.get(i) === 2)
      map.LakeMemory.set(i, Math.max(map.LakeMemory.get(i), map.WaterDepths.get(i) / 1024));
}
