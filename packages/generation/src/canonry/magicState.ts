import {
  canonryMagicPresets,
  fieldInterpolator,
  preparedValue,
  spatial,
  type MagicSystem,
} from "@atlas/domain";
import type { GenerationState } from "../process";
import type { Geometry } from "geojson";
import { advectMagicOccurrences } from "./magicOccurrences";
import { nativePosition } from "./atlasWorkspace";
import { provinceTransport } from "./provinceTransport";
import {
  carriedMagicChannels,
  magicChannels,
  magicFieldDefinitions,
  type MagicChannel,
} from "./magicFieldDefinitions";

export interface MagicField extends Record<MagicChannel, Float64Array> {
  occurrences?: Partial<
    Record<"firstEpoch" | "coastalFirstEpoch", { epoch: number; footprint: Geometry }[]>
  >;
  pendingOccurrences?: Partial<Record<"firstEpoch" | "coastalFirstEpoch", number>>;
  coefficients?: Partial<Record<MagicChannel, import("@atlas/domain").SampleCoefficients>>;
  adaptive?: Partial<Record<MagicChannel, import("@atlas/domain").PreparedAdaptiveCoefficients>>;
  definition: MagicSystem;
  origins: { id: string; x: number; y: number; radius: number; strength: number }[];
  features: Record<string, Uint8Array>;
}
export interface MagicWorkspace {
  classificationSeed?: number;
  fields: MagicField[];
  heat: Float64Array;
  coastal: Float64Array;
  naturalSurface: Int32Array;
  finalSurface: Int32Array;
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
    occurrences: {},
  };
  if (!state.physical!.inherited) return field;
  for (const name of ["firstEpoch", "coastalFirstEpoch"] as const)
    field.occurrences![name] = structuredClone(
      state.surface.geography?.occurrences?.[magicKey(field, name)] ?? []
    );
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
    naturalSurface: state.physical!.map.NaturalSurfaceCodes,
    finalSurface: state.physical!.map.FinalSurfaceCodes,
  };
}
export function advectMagic(state: GenerationState) {
  const work = state.physical!;
  if (work.map.LastPlateDriftStep <= 0) return;
  const transport = provinceTransport(work.map);
  const sources = Array.from({ length: work.map.mesh.count }, (_, i) => {
    const p = nativePosition(work, i);
    return transport.sourceAt(p.x, p.y);
  });
  for (const field of work.magic?.fields ?? []) {
    if (!field.definition.history.advect) continue;
    advectMagicOccurrences(state, field);
    for (const channel of carriedMagicChannels) {
      if (channel === "firstEpoch" || channel === "coastalFirstEpoch") {
        const regions = (field.occurrences?.[channel] ?? []).map((entry) => ({
          epoch: entry.epoch,
          covers: spatial.pointCoverage(entry.footprint),
        }));
        for (let i = 0; i < work.map.mesh.count; i++)
          field[channel][i] = regions.find((r) => r.covers(nativePosition(work, i)))?.epoch ?? -1;
        continue;
      }
      const previous = preparedValue(work.map.continuous!.support, field[channel].slice(), {
        coefficients: field.coefficients?.[channel],
        adaptive: field.adaptive?.[channel],
      });
      for (let i = 0; i < sources.length; i++)
        field[channel][i] = sources[i]
          ? previous(...sources[i]!)
          : magicFieldDefinitions[channel].initial;
    }
  }
}
export function systemSeed(seed: number, id: string) {
  for (const char of id) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  return seed | 0;
}
