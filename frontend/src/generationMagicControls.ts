import type { MagicSystem } from "@atlas/context";
import { magicPresentation } from "./generationPresentation";

export function magicControlKeys(
  system: {
    origins: Pick<MagicSystem["origins"][number], "source" | "propagation">[];
    effects: Pick<MagicSystem["effects"], "coastalForcing">;
  },
  metadata = magicPresentation()
) {
  const keys = system.origins.flatMap((origin) => {
    const source = metadata.sources.find((entry) => entry.value === origin.source)!;
    const propagation = metadata.propagations.find((entry) => entry.value === origin.propagation)!;
    return [
      ...source.parameters,
      ...propagation.parameters,
      ...(propagation.usesSourceRadius && source.radiusParameter ? [source.radiusParameter] : []),
    ];
  });
  if (system.effects.coastalForcing !== 0) keys.push(...metadata.coastal);
  keys.push("featureNoiseScale");
  return [...new Set(keys)];
}

export function removedMagicParameterFields(previous: MagicSystem, next: MagicSystem) {
  const retained = new Set(magicControlKeys(next));
  return magicControlKeys(previous)
    .filter((key) => !retained.has(key))
    .map((key) => `magic.${previous.id}.parameters.${key}`);
}
