import type { MagicPropagation, MagicSource, MagicSystem } from "@atlas/domain";
import { magicSourceStrategies } from "./world/magicSources";
import { magicPropagationStrategies } from "./world/magicPropagation";
import { coastalMagicParameters } from "./world/magicFeedback";

export type MagicParameter = keyof MagicSystem["parameters"];
type Strategies = Pick<MagicSystem, "origins" | "effects">;

export const magicSourceOptions = (Object.keys(magicSourceStrategies) as MagicSource[]).map(
  (value) => ({ value, label: magicSourceStrategies[value].label })
);
export const magicPropagationOptions = (
  Object.keys(magicPropagationStrategies) as MagicPropagation[]
).map((value) => ({ value, label: magicPropagationStrategies[value].label }));

/** Applicability comes from the same declarations that execute and require each origin. */
export function magicParameterKeys(system: Strategies): MagicParameter[] {
  const keys: MagicParameter[] = [];
  for (const origin of system.origins) {
    const source = magicSourceStrategies[origin.source],
      propagation = magicPropagationStrategies[origin.propagation];
    keys.push(...source.parameters, ...propagation.parameters);
    if (propagation.usesSourceRadius && source.radiusParameter) keys.push(source.radiusParameter);
  }
  if (system.effects.coastalForcing !== 0) keys.push(...coastalMagicParameters);
  keys.push("featureNoiseScale");
  return [...new Set(keys)];
}
