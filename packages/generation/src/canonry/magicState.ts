import { canonryMagicPresets, fieldInterpolator, type MagicSystem } from "@atlas/domain";
import type { GenerationState } from "../process";
import { nativePosition } from "./atlasWorkspace";
import {
  carriedMagicChannels,
  magicChannels,
  magicFieldDefinitions,
  type MagicChannel,
} from "./magicFieldDefinitions";

export interface MagicField extends Record<MagicChannel, Float64Array> {
  definition: MagicSystem;
  origins: { id: string; x: number; y: number; radius: number; strength: number }[];
  features: Record<string, Uint8Array>;
}
/** Applied contributions are remembered so a re-evaluation replaces them instead of adding. */
export interface MagicWorkspace {
  fields: MagicField[];
  heat: Float64Array;
  coastal: Float64Array;
  upwelling: Float64Array;
  seaSurface: Float64Array;
  fog: Float64Array;
  naturalSurface: Float64Array;
  finalSurface: Float64Array;
}
export function configuredSystems(state: GenerationState) {
  return state.domain.world.magicSystems ?? canonryMagicPresets();
}
export const magicKey = (field: MagicField, channel: string) =>
  `magic:${field.definition.id}:${channel}`;

function createMagicField(state: GenerationState, definition: MagicSystem): MagicField {
  const count = state.physical!.map.mesh.count;
  const channels = {} as Record<MagicChannel, Float64Array>;
  for (const channel of magicChannels)
    channels[channel] = new Float64Array(count).fill(magicFieldDefinitions[channel].initial);
  const field: MagicField = {
    ...channels,
    definition,
    origins: [],
    features: {},
  };
  if (!definition.enabled || !state.physical!.inherited) return field;
  for (const channel of carriedMagicChannels) {
    const key = magicKey(field, channel);
    if (!state.surface.channels[key]) continue;
    const valueAt = fieldInterpolator(
      state.surface,
      key,
      magicFieldDefinitions[channel].quantity === "category"
    );
    for (let i = 0; i < count; i++) field[channel][i] = valueAt(nativePosition(state.physical!, i));
  }
  return field;
}
export function initializeMagic(
  state: GenerationState,
  enabled = true,
  definitions = configuredSystems(state)
) {
  const count = state.physical!.map.mesh.count;
  state.physical!.magic = {
    fields: enabled
      ? structuredClone(definitions).map((system) => createMagicField(state, system))
      : [],
    heat: new Float64Array(count),
    coastal: new Float64Array(count),
    upwelling: new Float64Array(count),
    seaSurface: new Float64Array(count),
    fog: new Float64Array(count),
    naturalSurface: new Float64Array(count),
    finalSurface: new Float64Array(count),
  };
}
export function advectMagic(state: GenerationState) {
  const work = state.physical!;
  for (const field of work.magic?.fields ?? []) {
    if (!field.definition.enabled || !field.definition.history.advect) continue;
    for (const channel of carriedMagicChannels) {
      const previous = field[channel].slice();
      for (let i = 0; i < work.map.mesh.count; i++) {
        const source = work.map.AdvectionSourceIndex[i];
        field[channel][i] = source >= 0 ? previous[source] : magicFieldDefinitions[channel].initial;
      }
    }
  }
}
export function systemSeed(seed: number, id: string) {
  for (const char of id) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  return seed | 0;
}
