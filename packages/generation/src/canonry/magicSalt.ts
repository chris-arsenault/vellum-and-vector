import type { GenerationState } from "../process";
import type { PhysicalField } from "./field";
import { reservoirAmount, type MagicField } from "./magicState";
import { clamp, round } from "./math";

/**
 * What Salt does to the ground it lies on, once per epoch after the shared forcings: bed
 * deep enough fuses the ground to glass (rock resistance up, soil gone), salted ground
 * draws the air's moisture down in proportion to its salting, and Fire burns every Salt
 * reservoir by its share of the quickening intensity, fusing what it burns.
 */
export function saltWrites(state: GenerationState) {
  const work = state.physical!,
    map = work.map,
    fields = work.magic!.fields.filter((field) => field.definition.enabled),
    salts = fields.filter((field) => field.definition.effects.salting > 0),
    fire = fields.find((field) => field.definition.effects.quickening > 0);
  for (const field of salts)
    for (let i = 0; i < map.mesh.count; i++) {
      if (map.WaterKindCodes[i] !== 0) continue;
      const p = field.definition.parameters,
        bed = reservoirAmount(field, "bed", i) / map.mesh.areas[i];
      if (bed >= p.glassBed) fuse(map, i, p.glassResistance);
      const salting = (field.intensity[i] / 1000) * field.definition.effects.salting;
      if (salting > 0) map.Moisture[i] = round(map.Moisture[i] * (1 - p.desiccation * salting));
      if (fire && fire.intensity[i] > 0) burn(map, field, fire, i);
    }
}
function fuse(map: PhysicalField, i: number, resistance: number) {
  map.RockResistance[i] = clamp(map.RockResistance[i] + round(resistance), 0, 1000);
  map.SoilDepth[i] = 0;
}
/** Fire burns the Salt clean: every reservoir loses its share, and the burnt ground fuses. */
function burn(map: PhysicalField, field: MagicField, fire: MagicField, i: number) {
  const p = field.definition.parameters,
    share = clamp(p.saltBurn * (fire.intensity[i] / 1000), 0, 1);
  let burnt = 0;
  for (const values of Object.values(field.stocks)) {
    burnt += values[i] * share;
    values[i] *= 1 - share;
  }
  if (burnt <= 0) return;
  field.lost += burnt;
  fuse(map, i, p.glassResistance * Math.min(1, burnt / (map.mesh.areas[i] * p.saltFull)));
}
