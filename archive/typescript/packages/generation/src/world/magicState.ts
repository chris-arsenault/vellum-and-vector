import {
  MapScale,
  canonryConfluencePresets,
  canonryMagicPresets,
  originParameters,
  resolveMagicSystem,
  resolveConfluences,
  type Band,
  type MagicOrigin,
  type MagicStock,
  type MagicSystem,
  type ResolvedMagicSystem,
} from "@atlas/domain";
import type { GenerationState } from "../process";
import type { PhysicalField } from "./field";
import { weightScale } from "./transportPlan";
import { createConfluenceWorkspace, type ConfluenceWorkspace } from "./magicConfluences";
import { inheritMagicChannel, sourceSiteCells } from "./magicInheritance";
import { bindMagicIceMelt } from "./magicStocks";
import { depositSaltBed } from "../rock/rockMagicStock";
import { stockGroundHosts } from "../rock/rockMagicStock";
import { GroundInventory } from "../rock/groundInventory";
import type { MagicInventory } from "./magicInventory";
import { bindCarrierCosts } from "./magicCarriers";
import { retainedArray, workingArray, releaseWorking } from "./physicalNumerics";
import {
  carriedMagicChannels,
  magicChannels,
  magicFieldDefinitions,
  societyChannels,
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
export interface MagicField extends Record<MagicChannel, Band> {
  parents?: Band;
  wakePaths?: number[][][];
  definition: ResolvedMagicSystem;
  located: LocatedSource[];
  /** Each origin's own source strength per cell; `source` is their maximum. */
  originSources: Record<string, Band>;
  /** Captured discrete source candidates; their strength and receiving medium remain current. */
  inheritedSites?: Record<string, Int32Array>;
  /** Amount of the system per cell in each origin reservoir, keyed by `stockKey`. */
  stocks: Record<string, MagicInventory>;
  /** Impact events whose fall has already seeded a finite stock. */
  seeded: Set<string>;
  /** Last elapsed epoch supplied; a present-field refresh cannot repeat a birth. */
  suppliedEpoch: number;
  /** Stock that left the budget: washed to the sea, extracted, released and spent. */
  lost: number;
  /** Stock people drew from each cell since the last advance; an overdrawn spring collapses. */
  drawn: Band;
  /** Current activity excluding the retained-ground projection; never published or inherited. */
  fresh: Band;
  /** Veil's doors: pairs of stable tears, as the cells at their two ends. */
  doors: { a: number; b: number }[];
  features: Record<string, Band>;
  /** Share of each member cell a rule's class occupies, by rule id. */
  coverage: Record<string, Band>;
  /** The most any of the system's classes occupies in a cell, after meetings took theirs. */
  systemCoverage: Band;
}
/** Applied contributions are remembered so a re-evaluation replaces them instead of adding. */
export interface MagicWorkspace {
  /** What places did last to each carrier's cost, per cell; absent until they have acted. */
  carrierCost?: import("./magicCarriers").CarrierCosts;
  fields: MagicField[];
  heat: Band;
  /** Ice removed in the current epoch, so a second evaluation melts only what is owed. */
  melt: Band;
  coastal: Band;
  upwelling: Band;
  seaSurface: Band;
  fog: Band;
  naturalSurface: Band;
  finalSurface: Band;
  /** The next class by coverage where it holds the floor of the cell, or -1. */
  secondSurface: Band;
  confluences: ConfluenceWorkspace;
  /** Cells just outside a Hallowed ring: where what the ward holds back lands. */
  wardRim: Band;
  /** The ring each warded cell belongs to, and the ring each rim cell touches; -1 for none. */
  wardLabel: Band;
  rimLabel: Band;
}
export function configuredSystems(state: GenerationState) {
  return state.domain.world.magicSystems ?? canonryMagicPresets();
}
export function configuredConfluences(state: GenerationState) {
  return state.domain.world.confluences ?? canonryConfluencePresets();
}
export const magicKey = (field: MagicField, channel: string) =>
  `magic:${field.definition.id}:${channel}` as const;
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
      if (stock.reservoir === reservoir) total += field.stocks[stockKey(origin, stock)].get(cell);
  return total;
}
// hpc-exempt: temporary parameter scope metadata per field; no numerical state or saved representation.
const originScopes = new WeakMap<object, ResolvedMagicSystem>();
/** All-origin readers need the system defaults even while one strategy runs with overrides. */
export const unscopedDefinition = (field: Pick<MagicField, "definition">) =>
  originScopes.get(field) ?? field.definition;
/** Run with this origin's overrides, restoring the enclosing scope even when a strategy throws. */
export function withOrigin<T>(
  field: Pick<MagicField, "definition">,
  origin: MagicOrigin,
  run: () => T
): T {
  const previous = field.definition,
    definition = unscopedDefinition(field),
    overrides = Object.keys(origin.parameters).length > 0,
    nested = originScopes.has(field);
  if (!overrides && previous === definition) return run();
  if (!nested) originScopes.set(field, definition);
  field.definition = overrides
    ? { ...definition, parameters: originParameters(definition, origin) }
    : definition;
  try {
    return run();
  } finally {
    field.definition = previous;
    if (!nested) originScopes.delete(field);
  }
}

function createMagicField(state: GenerationState, definition: MagicSystem): MagicField {
  const map = state.physical!.map;
  const channels = {} as Record<MagicChannel, Band>;
  const allocate = (name: string) =>
    retainedArray(map, "float64", `magic:${definition.id}:${name}`);
  for (const channel of magicChannels)
    channels[channel] = allocate(channel).fill(magicFieldDefinitions[channel].initial);
  const field: MagicField = {
    ...channels,
    definition: resolveMagicSystem(definition, map.scale),
    located: [],
    doors: [],
    originSources: {},
    stocks: {},
    seeded: new Set(),
    suppliedEpoch: -1,
    lost: 0,
    drawn: allocate("drawn"),
    fresh: allocate("fresh"),
    features: {},
    coverage: {},
    systemCoverage: allocate("system-coverage"),
  };
  for (const origin of definition.origins) {
    field.originSources[origin.id] = allocate(`origin:${origin.id}`);
    for (const stock of originStocks(origin))
      field.stocks[stockKey(origin, stock)] =
        !["strain", "pairing", "tenure", "kept-line"].includes(origin.source) &&
        stockGroundHosts(definition.id, stock.reservoir)
          ? new GroundInventory(map, `${definition.id}:${stockKey(origin, stock)}`)
          : allocate(`stock:${stockKey(origin, stock)}`);
  }
  if (!definition.enabled || !state.physical!.inherited) return field;
  inheritMagicField(state, field);
  return field;
}
/** Locators that place discrete sites (a vein, a locus, a placed source, a forge), not ground. */
const siteSources = new Set<string>(["geothermal", "deep-ocean", "placed", "forge"]);
function inheritMagicField(state: GenerationState, field: MagicField) {
  for (const channel of carriedMagicChannels)
    inheritMagicChannel(
      state,
      magicKey(field, channel),
      field[channel],
      magicFieldDefinitions[channel].quantity
    );
  // Sources and the stock a forge holds are located sites; the other stocks are spread fields.
  for (const origin of field.definition.origins)
    for (const stock of originStocks(origin)) {
      const key = stockKey(origin, stock);
      const values = field.stocks[key];
      // Hosted inventories arrive only with captured material, never from a scalar total.
      if (values instanceof GroundInventory) continue;
      inheritMagicChannel(
        state,
        magicKey(field, `stock:${key}`),
        values as Band,
        stock.reservoir === "forge" ? "site-amount" : "extensive"
      );
    }
  for (const origin of field.definition.origins)
    inheritMagicChannel(
      state,
      magicKey(field, `origin:${origin.id}:source`),
      field.originSources[origin.id],
      siteSources.has(origin.source) ? "site-strength" : "intensive"
    );
  inheritSourceSites(field);
  // Falls the parent already seeded arrive with their stock, not again.
  for (const event of state.physical!.map.events)
    if (event.kind === "impact") field.seeded.add(event.id);
}
function inheritSourceSites(field: MagicField) {
  field.inheritedSites = {};
  for (const origin of field.definition.origins)
    if (origin.source === "geothermal" || origin.source === "deep-ocean")
      field.inheritedSites[origin.id] = sourceSiteCells(field.originSources[origin.id]);
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
    .filter((values) => values.get(cell) > 0);
  const available = held.reduce((sum, values) => sum + values.get(cell), 0);
  if (available <= 0 || amount <= 0) return 0;
  const drawn = Math.min(amount, available);
  let removed = 0;
  for (const values of held) {
    const request = (drawn * values.get(cell)) / available;
    if (values instanceof GroundInventory)
      removed += values.extract(cell, request, {
        reach: MapScale.native(field.definition.parameters.buryDepth),
      });
    else {
      values.add(cell, -request);
      removed += request;
    }
  }
  field.lost += removed;
  if (reservoir === "aquifer") field.drawn.add(cell, removed);
  return removed;
}
/** Mining and panning take held cores; a forge's cracked stock and a spring are not ore. */
export function drawStock(field: MagicField, cell: number, amount: number) {
  return drawReservoir(field, "held", cell, amount);
}
/** Put an amount of a system back into one reservoir at a cell, as planting or cracking does. */
export function depositReservoir(
  map: PhysicalField,
  field: MagicField,
  reservoir: string,
  cell: number,
  amount: number
) {
  const values = reservoirStock(field, reservoir);
  if (!values || amount <= 0) return 0;
  if (reservoir === "bed" && field.definition.effects.salting > 0)
    depositSaltBed(map, values, cell, amount, field.definition.parameters.saltMaterialDensity);
  else values.add(cell, amount);
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
  if (state.physical!.inherited)
    for (const [name, , quantity] of societyChannels)
      inheritMagicChannel(state, name, map[name], quantity);
  const allocate = (name: string) => retainedArray(map, "float64", `magic:${name}`);
  state.physical!.magic = {
    fields: enabled
      ? structuredClone(definitions).map((system) => createMagicField(state, system))
      : [],
    confluences: createConfluenceWorkspace(
      enabled ? resolveConfluences(confluences, map.scale) : [],
      map
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
    wardRim: retainedArray(map, "float64", "magic:ward-rim"),
    wardLabel: retainedArray(map, "int32", "magic:ward-label").fill(-1),
    rimLabel: retainedArray(map, "int32", "magic:rim-label").fill(-1),
  };
  bindCarrierCosts(map, () => state.physical?.magic?.carrierCost);
  bindMagicIceMelt(state);
}
/**
 * Move what the crust carries. History channels follow the dominant source of each cell;
 * a stock in crust or pore water is an amount scattered by the transport plan's weights.
 */
export function advectMagic(state: GenerationState) {
  const work = state.physical!;
  for (const field of work.magic?.fields ?? []) {
    if (!field.definition.history.advect) continue;
    carryHistory(field, work.map);
    carryStocks(field, work.map);
  }
}
function carryHistory(field: MagicField, map: PhysicalField) {
  for (const channel of carriedMagicChannels) {
    const previous = map.coverage.copyBand(field[channel]),
      values = field[channel],
      initial = magicFieldDefinitions[channel].initial;
    for (let i = 0; i < map.mesh.count; i++) {
      const source = map.AdvectionSourceIndex.get(i);
      values.set(i, source >= 0 ? previous.get(source) : initial);
    }
    releaseWorking(map, previous);
  }
}
function carryStocks(field: MagicField, map: PhysicalField) {
  for (const origin of field.definition.origins)
    for (const stock of originStocks(origin)) {
      // Pore water travels with its aquifer; hydraulic exchange moves it again after advection.
      if (!stock.carriers.some((carrier) => carrier === "crust" || carrier === "groundwater"))
        continue;
      const values = field.stocks[stockKey(origin, stock)];
      if (values instanceof GroundInventory) continue;
      const moved = carryAmount(map, values);
      for (let i = 0; i < values.length; i++) values.set(i, moved.get(i));
      releaseWorking(map, moved);
    }
}
/** Scatter an amount per cell along the last plate drift; without a plan the amount stays. */
export function carryAmount(map: PhysicalField, values: MagicInventory) {
  const plan = map.transportPlan;
  const moved = workingArray(map, "float64", "magic:carried-amount", values.length);
  if (!plan) {
    for (let i = 0; i < values.length; i++) moved.set(i, values.get(i));
    return moved;
  }
  for (let source = 0; source < values.length; source++) {
    const amount = values.get(source);
    if (amount === 0) continue;
    const end = plan.offsets.get(source + 1);
    for (let offset = plan.offsets.get(source); offset < end; offset++) {
      const target = plan.targets.get(offset);
      if (target >= 0) moved.add(target, (amount * plan.weights.get(offset)) / weightScale);
    }
  }
  return moved;
}
/**
 * The system's budget as totals over the mesh: what its origins created (source strength
 * times area), what its reservoirs hold, what it stored across epochs and what its field
 * releases now. These observations describe the history, not a numerical acceptance gate.
 */
export function magicBudget(field: MagicField, map: PhysicalField) {
  const totals = { created: 0, carried: 0, stored: 0, released: 0, lost: field.lost };
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.mesh.membership(i) !== 1) continue;
    const area = map.mesh.area(i);
    totals.created += field.source.get(i) * area;
    totals.stored += field.stored.get(i) * area;
    totals.released += field.intensity.get(i) * area;
  }
  for (const values of Object.values(field.stocks))
    for (let i = 0; i < map.mesh.count; i++)
      if (map.mesh.membership(i) === 1) totals.carried += values.get(i);
  return totals;
}
export function systemSeed(seed: number, id: string) {
  for (const char of id) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  return seed | 0;
}
