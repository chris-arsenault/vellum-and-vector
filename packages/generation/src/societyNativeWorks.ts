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
    standing = work.magnitude * work.condition >= 0.5 && map.WaterKindCodes[cell] === 1;
  if (standing) map.FeatureFlags[cell] |= Feature.Shoal;
  else map.FeatureFlags[cell] &= ~Feature.Shoal;
}
/** Quarrying takes the stored charge of every charge-holding system, and the ice it held. */
function quarryPrism(state: GenerationState, cell: number, kept: number) {
  const physical = state.physical!;
  for (const field of physical.magic?.fields ?? [])
    if (field.definition.effects.icePersistence > 0) field.stored[cell] *= kept;
  physical.map.IcePersistence[cell] *= kept;
}
