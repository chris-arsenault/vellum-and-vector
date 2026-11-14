import type { GenerationState } from "../process";
import type { MagicField } from "./magicState";
import type { LocateContext, SupplyContext } from "./magicSources";
import { siteStrength } from "./magicStocks";
import { depositSaltBed } from "../rock/rockMagicStock";
import { forgetLake } from "../water/column";

/**
 * Salt's death origin: the dead the ground records become brine where they lie. The record
 * is consumed, since the Salt is what is left of them; the source is the salt made this
 * evaluation per area, so a rule can mark the killing in the epoch it happened. A town's
 * ordinary dead make brine but no source: only a killing past the source floor is a site.
 */
export function supplyDeathSalt(
  state: GenerationState,
  field: MagicField,
  _seed: number,
  { origin, activity }: SupplyContext
) {
  const map = state.physical!.map,
    p = field.definition.parameters,
    brine = field.stocks[`${origin.id}/brine`];
  if (!brine) return;
  for (let i = 0; i < map.mesh.count; i++) {
    const dead = map.MassDeath.get(i);
    if (dead <= 0) continue;
    const made = dead * p.saltPerDeath * activity;
    map.MassDeath.set(i, 0);
    if (made <= 0) continue;
    brine.add(i, made);
  }
}
/**
 * Salt's dead-lake origin: a cell that was a lake and is dry ground in a depression now
 * leaves its bed, by the depth of water it held. The memory is consumed with the lake.
 */
export function supplyLakeSalt(
  state: GenerationState,
  field: MagicField,
  _seed: number,
  { origin, activity }: SupplyContext
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
    const made = memory * map.mesh.area(i) * p.saltPerLakeMetre * activity;
    forgetLake(map, i);
    if (made <= 0) continue;
    depositSaltBed(map, bed, i, made, p.saltMaterialDensity);
  }
}
/** Location reads the residue that remains; it never consumes another death or lake. */
export function saltSources(
  state: GenerationState,
  field: MagicField,
  _seed: number,
  { origin }: LocateContext
) {
  const map = state.physical!.map,
    reservoir = origin.source === "death" ? "brine" : "bed",
    values = field.stocks[`${origin.id}/${reservoir}`];
  if (!values) return;
  for (let i = 0; i < map.mesh.count; i++)
    field.source.set(
      i,
      siteStrength((1000 * values.get(i)) / map.mesh.area(i) / field.definition.parameters.saltFull)
    );
}
