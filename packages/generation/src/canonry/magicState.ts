import {
  canonryMagicPresets,
  fieldInterpolator,
  originParameters,
  type MagicOrigin,
  type MagicStock,
  type MagicSystem,
} from "@atlas/domain";
import type { GenerationState } from "../process";
import type { PhysicalField } from "./field";
import { weightScale } from "./transportPlan";
import { nativePosition } from "./atlasWorkspace";
import {
  carriedMagicChannels,
  magicChannels,
  magicFieldDefinitions,
  type MagicChannel,
} from "./magicFieldDefinitions";

/** A source point an origin located, in mesh coordinates. */
export interface LocatedSource {
  origin: string;
  id: string;
  x: number;
  y: number;
  radius: number;
  strength: number;
}
export interface MagicField extends Record<MagicChannel, Float64Array> {
  parents?: Int32Array;
  wakePaths?: number[][][];
  definition: MagicSystem;
  located: LocatedSource[];
  /** Each origin's own source strength per cell; `source` is their maximum. */
  originSources: Record<string, Float64Array>;
  /** Amount of the system per cell in each origin reservoir, keyed by `stockKey`. */
  stocks: Record<string, Float64Array>;
  features: Record<string, Uint8Array>;
}
/** Applied contributions are remembered so a re-evaluation replaces them instead of adding. */
export interface MagicWorkspace {
  fields: MagicField[];
  heat: Float64Array;
  /** Ice removed in the current epoch, so a second evaluation melts only what is owed. */
  melt: Float64Array;
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
export const stockKey = (origin: MagicOrigin, stock: MagicStock) => `${origin.id}/${stock.id}`;
/** An origin that declares no stock holds its source in one default reservoir. */
export const defaultStock: MagicStock = { id: "held", reservoir: "held", carriers: [] };
export function originStocks(origin: MagicOrigin): MagicStock[] {
  return origin.stocks.length ? origin.stocks : [defaultStock];
}
/**
 * Run a strategy with this origin's parameter overrides in place of the system's. Strategies
 * read `field.definition.parameters`; an origin without overrides costs nothing here.
 */
export function withOrigin<T>(field: MagicField, origin: MagicOrigin, run: () => T): T {
  const definition = field.definition;
  if (!Object.keys(origin.parameters).length) return run();
  field.definition = { ...definition, parameters: originParameters(definition, origin) };
  try {
    return run();
  } finally {
    field.definition = definition;
  }
}

function createMagicField(state: GenerationState, definition: MagicSystem): MagicField {
  const count = state.physical!.map.mesh.count;
  const channels = {} as Record<MagicChannel, Float64Array>;
  for (const channel of magicChannels)
    channels[channel] = new Float64Array(count).fill(magicFieldDefinitions[channel].initial);
  const field: MagicField = {
    ...channels,
    definition,
    located: [],
    originSources: {},
    stocks: {},
    features: {},
  };
  for (const origin of definition.origins) {
    field.originSources[origin.id] = new Float64Array(count);
    for (const stock of originStocks(origin))
      field.stocks[stockKey(origin, stock)] = new Float64Array(count);
  }
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
    melt: new Float64Array(count),
    coastal: new Float64Array(count),
    upwelling: new Float64Array(count),
    seaSurface: new Float64Array(count),
    fog: new Float64Array(count),
    naturalSurface: new Float64Array(count),
    finalSurface: new Float64Array(count),
  };
}
/**
 * Move what the crust carries. History channels follow the dominant source of each cell;
 * a stock on the crust carrier is an amount, so it is scattered by the transport plan's
 * weights and its total is conserved.
 */
export function advectMagic(state: GenerationState) {
  const work = state.physical!;
  for (const field of work.magic?.fields ?? []) {
    if (!field.definition.enabled || !field.definition.history.advect) continue;
    carryHistory(field, work.map);
    carryStocks(field, work.map);
  }
}
function carryHistory(field: MagicField, map: PhysicalField) {
  for (const channel of carriedMagicChannels) {
    const previous = field[channel].slice();
    for (let i = 0; i < map.mesh.count; i++) {
      const source = map.AdvectionSourceIndex[i];
      field[channel][i] = source >= 0 ? previous[source] : magicFieldDefinitions[channel].initial;
    }
  }
}
function carryStocks(field: MagicField, map: PhysicalField) {
  for (const origin of field.definition.origins)
    for (const stock of originStocks(origin)) {
      if (!stock.carriers.includes("crust")) continue;
      const values = field.stocks[stockKey(origin, stock)];
      values.set(carryAmount(map, values));
    }
}
/** Scatter an amount per cell along the last plate drift; without a plan the amount stays. */
export function carryAmount(map: PhysicalField, values: Float64Array) {
  const plan = map.transportPlan;
  const moved = new Float64Array(values.length);
  if (!plan) {
    moved.set(values);
    return moved;
  }
  for (let source = 0; source < values.length; source++) {
    const amount = values[source];
    if (amount === 0) continue;
    for (let offset = plan.offsets[source]; offset < plan.offsets[source + 1]; offset++) {
      const target = plan.targets[offset];
      if (target >= 0) moved[target] += (amount * plan.weights[offset]) / weightScale;
    }
  }
  return moved;
}
/**
 * The system's budget as totals over the mesh: what its origins created (source strength
 * times area), what its reservoirs hold, what it stored across epochs and what its field
 * releases now. A test closes it; the history record carries it.
 */
export function magicBudget(field: MagicField, map: PhysicalField) {
  const totals = { created: 0, carried: 0, stored: 0, released: 0 };
  for (let i = 0; i < map.mesh.contentCount; i++) {
    const area = map.mesh.areas[i];
    totals.created += field.source[i] * area;
    totals.stored += field.stored[i] * area;
    totals.released += field.intensity[i] * area;
  }
  for (const values of Object.values(field.stocks))
    for (let i = 0; i < map.mesh.contentCount; i++) totals.carried += values[i];
  return totals;
}
export function systemSeed(seed: number, id: string) {
  for (const char of id) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  return seed | 0;
}
