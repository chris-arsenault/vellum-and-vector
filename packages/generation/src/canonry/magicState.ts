import {
  canonryConfluencePresets,
  canonryMagicPresets,
  originParameters,
  type MagicOrigin,
  type MagicStock,
  type MagicSystem,
  type NumericalVector,
} from "@atlas/domain";
import type { GenerationState } from "../process";
import type { PhysicalField } from "./field";
import { weightScale } from "./transportPlan";
import { createConfluenceWorkspace, type ConfluenceWorkspace } from "./magicConfluences";
import { inheritMagicChannel } from "./magicInheritance";
import { retainedArray, workingArray, releaseWorking } from "./physicalNumerics";
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
export interface MagicField extends Record<MagicChannel, NumericalVector> {
  parents?: NumericalVector;
  wakePaths?: number[][][];
  definition: MagicSystem;
  located: LocatedSource[];
  /** Each origin's own source strength per cell; `source` is their maximum. */
  originSources: Record<string, NumericalVector>;
  /** Amount of the system per cell in each origin reservoir, keyed by `stockKey`. */
  stocks: Record<string, NumericalVector>;
  /** Impact events whose fall has already seeded a finite stock. */
  seeded: Set<string>;
  /** Stock that left the budget: washed to the sea, extracted, released and spent. */
  lost: number;
  /** Stock people drew from each cell since the last advance; an overdrawn spring collapses. */
  drawn: NumericalVector;
  /** Veil's doors: pairs of stable tears, as the cells at their two ends. */
  doors: { a: number; b: number }[];
  features: Record<string, NumericalVector>;
  /** Share of each member cell a rule's class occupies, by rule id. */
  coverage: Record<string, NumericalVector>;
  /** The most any of the system's classes occupies in a cell, after meetings took theirs. */
  systemCoverage: NumericalVector;
}
/** Applied contributions are remembered so a re-evaluation replaces them instead of adding. */
export interface MagicWorkspace {
  fields: MagicField[];
  heat: NumericalVector;
  /** Ice removed in the current epoch, so a second evaluation melts only what is owed. */
  melt: NumericalVector;
  coastal: NumericalVector;
  upwelling: NumericalVector;
  seaSurface: NumericalVector;
  fog: NumericalVector;
  naturalSurface: NumericalVector;
  finalSurface: NumericalVector;
  /** The next class by coverage where it holds the floor of the cell, or -1. */
  secondSurface: NumericalVector;
  confluences: ConfluenceWorkspace;
  /** Cells just outside a Hallowed ring: where what the ward holds back lands. */
  wardRim: NumericalVector;
  /** The ring each warded cell belongs to, and the ring each rim cell touches; -1 for none. */
  wardLabel: NumericalVector;
  rimLabel: NumericalVector;
}
export function configuredSystems(state: GenerationState) {
  return state.domain.world.magicSystems ?? canonryMagicPresets();
}
export function configuredConfluences(state: GenerationState) {
  return state.domain.world.confluences ?? canonryConfluencePresets();
}
export const magicKey = (field: MagicField, channel: string) =>
  `magic:${field.definition.id}:${channel}`;
export const stockKey = (origin: MagicOrigin, stock: MagicStock) => `${origin.id}/${stock.id}`;
/** An origin that declares no stock holds its source in one default reservoir. */
export const defaultStock: MagicStock = { id: "held", reservoir: "held", carriers: [] };
export function originStocks(origin: MagicOrigin): MagicStock[] {
  return origin.stocks.length ? origin.stocks : [defaultStock];
}
/** The first stock of the field in the named reservoir, across its origins. */
export function reservoirStock(field: MagicField, reservoir: string) {
  for (const origin of field.definition.origins)
    for (const stock of originStocks(origin))
      if (stock.reservoir === reservoir) return field.stocks[stockKey(origin, stock)];
  return undefined;
}
/** What every origin holds in the named reservoir at a cell, as one amount. */
export function reservoirAmount(field: MagicField, reservoir: string, cell: number) {
  let total = 0;
  for (const origin of field.definition.origins)
    for (const stock of originStocks(origin))
      if (stock.reservoir === reservoir) total += field.stocks[stockKey(origin, stock)][cell];
  return total;
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
  const map = state.physical!.map;
  const channels = {} as Record<MagicChannel, NumericalVector>;
  const allocate = (name: string) =>
    retainedArray(map, "float64", `magic:${definition.id}:${name}`);
  for (const channel of magicChannels)
    channels[channel] = allocate(channel).fill(magicFieldDefinitions[channel].initial);
  const field: MagicField = {
    ...channels,
    definition,
    located: [],
    doors: [],
    originSources: {},
    stocks: {},
    seeded: new Set(),
    lost: 0,
    drawn: allocate("drawn"),
    features: {},
    coverage: {},
    systemCoverage: allocate("system-coverage"),
  };
  for (const origin of definition.origins) {
    field.originSources[origin.id] = allocate(`origin:${origin.id}`);
    for (const stock of originStocks(origin))
      field.stocks[stockKey(origin, stock)] = allocate(`stock:${stockKey(origin, stock)}`);
  }
  if (!definition.enabled || !state.physical!.inherited) return field;
  inheritMagicField(state, field);
  return field;
}
function inheritMagicField(state: GenerationState, field: MagicField) {
  for (const channel of carriedMagicChannels)
    inheritMagicChannel(
      state,
      magicKey(field, channel),
      field[channel],
      magicFieldDefinitions[channel].quantity
    );
  for (const [key, values] of Object.entries(field.stocks))
    inheritMagicChannel(state, magicKey(field, `stock:${key}`), values, "extensive");
  for (const [id, values] of Object.entries(field.originSources))
    inheritMagicChannel(state, magicKey(field, `origin:${id}:source`), values);
  // Falls the parent already seeded arrive with their stock, not again.
  for (const event of state.physical!.map.events)
    if (event.kind === "impact") field.seeded.add(event.id);
}
/**
 * Take an amount of a system's stock in one reservoir out of the world at a cell, as mining,
 * panning or gathering does, drawing that reservoir's stocks down in proportion across the
 * origins that hold it. Returns what was drawn.
 */
export function drawReservoir(field: MagicField, reservoir: string, cell: number, amount: number) {
  const held = field.definition.origins
    .flatMap((origin) =>
      originStocks(origin)
        .filter((stock) => stock.reservoir === reservoir)
        .map((stock) => field.stocks[stockKey(origin, stock)])
    )
    .filter((values) => values[cell] > 0);
  const available = held.reduce((sum, values) => sum + values[cell], 0);
  if (available <= 0 || amount <= 0) return 0;
  const drawn = Math.min(amount, available);
  for (const values of held) values[cell] -= (drawn * values[cell]) / available;
  field.lost += drawn;
  field.drawn[cell] += drawn;
  return drawn;
}
/** Mining and panning take held cores; a forge's cracked stock and a spring are not ore. */
export function drawStock(field: MagicField, cell: number, amount: number) {
  return drawReservoir(field, "held", cell, amount);
}
/** Put an amount of a system back into one reservoir at a cell, as planting or cracking does. */
export function depositReservoir(
  field: MagicField,
  reservoir: string,
  cell: number,
  amount: number
) {
  const values = reservoirStock(field, reservoir);
  if (!values || amount <= 0) return 0;
  values[cell] += amount;
  field.lost -= amount;
  return amount;
}
export function initializeMagic(
  state: GenerationState,
  enabled = true,
  definitions = configuredSystems(state),
  confluences = configuredConfluences(state)
) {
  const map = state.physical!.map;
  const allocate = (name: string) => retainedArray(map, "float64", `magic:${name}`);
  state.physical!.magic = {
    fields: enabled
      ? structuredClone(definitions).map((system) => createMagicField(state, system))
      : [],
    confluences: createConfluenceWorkspace(
      enabled ? structuredClone(confluences) : [],
      map.mesh.count,
      map.numerical
    ),
    heat: allocate("heat"),
    melt: allocate("melt"),
    coastal: allocate("coastal"),
    upwelling: allocate("upwelling"),
    seaSurface: allocate("sea-surface"),
    fog: allocate("fog"),
    naturalSurface: allocate("natural-surface"),
    finalSurface: allocate("final-surface"),
    secondSurface: allocate("second-surface").fill(-1),
    wardRim: retainedArray(map, "uint8", "magic:ward-rim"),
    wardLabel: retainedArray(map, "int32", "magic:ward-label").fill(-1),
    rimLabel: retainedArray(map, "int32", "magic:rim-label").fill(-1),
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
    releaseWorking(map, previous);
  }
}
function carryStocks(field: MagicField, map: PhysicalField) {
  for (const origin of field.definition.origins)
    for (const stock of originStocks(origin)) {
      if (!stock.carriers.includes("crust")) continue;
      const values = field.stocks[stockKey(origin, stock)];
      const moved = carryAmount(map, values);
      values.set(moved);
      releaseWorking(map, moved);
    }
}
/** Scatter an amount per cell along the last plate drift; without a plan the amount stays. */
export function carryAmount(map: PhysicalField, values: NumericalVector) {
  const plan = map.transportPlan;
  const moved = workingArray(map, "float64", "magic:carried-amount", values.length);
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
  const totals = { created: 0, carried: 0, stored: 0, released: 0, lost: field.lost };
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
