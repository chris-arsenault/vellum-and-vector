import type { MagicSystem } from "@atlas/domain";
import { magicSourceStrategies } from "./canonry/magicSources";
import { magicPropagationStrategies } from "./canonry/magicPropagation";
import { coastalMagicParameters } from "./canonry/magicFeedback";

export type MagicParameter = keyof MagicSystem["parameters"];
type Strategies = Pick<MagicSystem, "source" | "propagation" | "effects">;

export const magicSourceOptions = (
  Object.keys(magicSourceStrategies) as MagicSystem["source"][]
).map((value) => ({ value, label: magicSourceStrategies[value].label }));
export const magicPropagationOptions = (
  Object.keys(magicPropagationStrategies) as MagicSystem["propagation"][]
).map((value) => ({ value, label: magicPropagationStrategies[value].label }));

/** Applicability comes from the same declarations that execute and require each strategy. */
export function magicParameterKeys(system: Strategies): MagicParameter[] {
  const source = magicSourceStrategies[system.source],
    propagation = magicPropagationStrategies[system.propagation];
  const keys = [...source.parameters, ...propagation.parameters];
  if (propagation.usesSourceRadius && source.radiusParameter) keys.push(source.radiusParameter);
  if (system.effects.coastalForcing !== 0) keys.push(...coastalMagicParameters);
  keys.push("featureNoiseScale");
  return [...new Set(keys)];
}
