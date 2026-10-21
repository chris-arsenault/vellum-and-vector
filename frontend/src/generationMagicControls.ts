import type { MagicSystem } from "@atlas/domain";
import { magicParameterKeys } from "@atlas/generation";

export const magicControlKeys = magicParameterKeys;

export function removedMagicParameterFields(previous: MagicSystem, next: MagicSystem) {
  const retained = new Set(magicControlKeys(next));
  return magicControlKeys(previous)
    .filter((key) => !retained.has(key))
    .map((key) => `magic.${previous.id}.parameters.${key}`);
}
