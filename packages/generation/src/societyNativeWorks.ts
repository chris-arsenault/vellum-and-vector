import type { SocietyWork } from "@atlas/domain";
import type { GenerationState } from "./process";
import { Feature } from "./canonry/codes";

/**
 * Consequences that live in the physical workspace rather than a published channel: a weir
 * marks its seabed as a shoal that reflects Pressure rays after the sea drowns it; quarrying
 * a prism ridge removes the charge that holds its ice still.
 */
export function applyNativeColdAgeWork(
  state: GenerationState,
  work: SocietyWork,
  i: number,
  amount: number,
  years: number
) {
  const physical = state.physical;
  if (!physical) return;
  const cell = physical.samples[i];
  if (cell === undefined || cell < 0) return;
  if (work.kind === "weir") markWeir(state, work, cell);
  if (work.kind === "quarrying") quarryPrism(state, cell, Math.exp((-amount * years) / 100));
}
/** Only a standing weir on the water is a shoal; a decayed or landward one leaves none. */
function markWeir(state: GenerationState, work: SocietyWork, cell: number) {
  const map = state.physical!.map,
    standing = work.magnitude * work.condition >= 0.5 && map.WaterKindCodes.get(cell) === 1,
    flags = map.FeatureFlags.get(cell);
  map.FeatureFlags.set(cell, standing ? flags | Feature.Shoal : flags & ~Feature.Shoal);
}
/** Quarrying takes the stored charge of every charge-holding system, and the ice it held. */
function quarryPrism(state: GenerationState, cell: number, kept: number) {
  const physical = state.physical!;
  for (const field of physical.magic?.fields ?? [])
    if (field.definition.effects.icePersistence > 0)
      field.stored.set(cell, field.stored.get(cell) * kept);
  physical.map.IcePersistence.set(cell, physical.map.IcePersistence.get(cell) * kept);
}
