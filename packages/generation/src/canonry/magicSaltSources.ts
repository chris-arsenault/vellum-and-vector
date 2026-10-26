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
    if (map.MassDeath[i] <= 0) continue;
    const made = map.MassDeath[i] * p.saltPerDeath;
    map.MassDeath[i] = 0;
    if (made <= 0) continue;
    brine[i] += made;
    field.source[i] = siteStrength((1000 * made) / map.mesh.areas[i] / p.saltFull);
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
    if (map.LakeMemory[i] <= 0 || map.WaterKindCodes[i] !== 0 || map.IceThickness[i] > 0) continue;
    // Still a basin: the floor lies below the spill its drainage fills to.
    if (map.DrainageElevations[i] <= map.Elevation[i]) continue;
    const made = map.LakeMemory[i] * map.mesh.areas[i] * p.saltPerLakeMetre;
    map.LakeMemory[i] = 0;
    if (made <= 0) continue;
    bed[i] += made;
    field.source[i] = siteStrength((1000 * made) / map.mesh.areas[i] / p.saltFull);
  }
}
/** While a cell is a lake it remembers its depth; the memory outlives the water for Salt to read. */
export function rememberLakes(map: PhysicalField) {
  for (let i = 0; i < map.mesh.count; i++)
    if (map.WaterKindCodes[i] === 2)
      map.LakeMemory[i] = Math.max(map.LakeMemory[i], map.WaterDepths[i] / 1024);
}
