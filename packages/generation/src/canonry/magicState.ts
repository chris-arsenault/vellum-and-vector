import { canonryMagicPresets, fieldInterpolator, type MagicSystem } from "@atlas/domain";
import type { GenerationState } from "../process";
import { nativePosition } from "./atlasWorkspace";

export interface MagicField {
  definition: MagicSystem;
  origins: { id: string; x: number; y: number; radius: number; strength: number }[];
  intensity: Float64Array;
  source: Float64Array;
  wake: Float64Array;
  rogue: Float64Array;
  history: Float64Array;
  firstEpoch: Float64Array;
  stored: Float64Array;
  retained: Float64Array;
  radii: Float64Array;
  coastalHistory: Float64Array;
  coastalFirstEpoch: Float64Array;
  features: Record<string, Uint8Array>;
}
export interface MagicWorkspace {
  fields: MagicField[];
  heat: Float64Array;
  coastal: Float64Array;
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
  const array = () => new Float64Array(count);
  const field: MagicField = {
    definition,
    origins: [],
    intensity: array(),
    source: array(),
    wake: array(),
    rogue: array(),
    history: array(),
    firstEpoch: array().fill(-1),
    stored: array(),
    retained: array(),
    radii: array(),
    coastalHistory: array(),
    coastalFirstEpoch: array().fill(-1),
    features: {},
  };
  if (!state.physical!.inherited) return field;
  for (const channel of [
    "history",
    "firstEpoch",
    "stored",
    "coastalHistory",
    "coastalFirstEpoch",
  ] as const) {
    const key = magicKey(field, channel);
    if (!state.surface.channels[key]) continue;
    const valueAt = fieldInterpolator(state.surface, key, channel.endsWith("Epoch"));
    for (let i = 0; i < count; i++) field[channel][i] = valueAt(nativePosition(state.physical!, i));
  }
  return field;
}
export function initializeMagic(state: GenerationState, enabled = true) {
  const count = state.physical!.map.mesh.count;
  state.physical!.magic = {
    fields: enabled
      ? configuredSystems(state).map((system) => createMagicField(state, system))
      : [],
    heat: new Float64Array(count),
    coastal: new Float64Array(count),
    naturalSurface: new Float64Array(count),
    finalSurface: new Float64Array(count),
  };
}
export function advectMagic(state: GenerationState) {
  const work = state.physical!;
  for (const field of work.magic?.fields ?? []) {
    if (!field.definition.history.advect) continue;
    for (const channel of [
      "history",
      "firstEpoch",
      "stored",
      "coastalHistory",
      "coastalFirstEpoch",
    ] as const) {
      const previous = field[channel].slice();
      for (let i = 0; i < work.map.mesh.count; i++) {
        const source = work.map.AdvectionSourceIndex[i];
        field[channel][i] = source >= 0 ? previous[source] : channel.endsWith("Epoch") ? -1 : 0;
      }
    }
  }
}
export function systemSeed(seed: number, id: string) {
  for (const char of id) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  return seed | 0;
}
