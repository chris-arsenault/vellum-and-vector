import type { Band } from "@atlas/domain";
import type { PhysicalBufferName, PhysicalField } from "../world/field";
import { rebuild } from "../world/surface";
import type { GenerationState } from "../process";
import { Contributions, ledgerCeilings, ledgerFloors } from "../regional/media";
import type { RegionalState } from "../regional/state";
import { poiCatalogue } from "./catalogue";
import type { PoiCarried, PoiFieldChange, PoiMagicBand, PoiPlace } from "./poiContract";
import { carrierFactors } from "./poiCosts";
import { fieldOf, releaseHeld } from "./poiReads";
import { carriedPlaces, placesOf } from "./poiPublish";

interface CellChange {
  add: number;
  atMost: number;
  atLeast: number;
}
type Changes = Map<number, CellChange>;
/** What one evaluation declares: per band and per magic band, per cell. */
interface Declared {
  bands: Map<PhysicalBufferName, Changes>;
  magic: Map<string, { target: PoiMagicBand; cells: Changes }>;
  caps: Map<number, number>;
}
const roles = ["terrain", "water", "climate", "cover", "magic"] as const;

function changeAt(cells: Changes, cell: number) {
  let change = cells.get(cell);
  if (!change) cells.set(cell, (change = { add: 0, atMost: Infinity, atLeast: -Infinity }));
  return change;
}
function take(change: CellChange, declared: PoiFieldChange) {
  if (declared.change === "add") change.add += declared.amount;
  else if (declared.change === "atMost") change.atMost = Math.min(change.atMost, declared.value);
  else if (declared.change === "atLeast") change.atLeast = Math.max(change.atLeast, declared.value);
}
const magicKey = (target: PoiMagicBand) =>
  `${target.system}:${"stock" in target ? `stock:${target.stock}` : target.channel}`;
function collect(declared: Declared, change: PoiFieldChange) {
  if (change.change === "gradientAtMost") {
    const held = declared.caps.get(change.cell);
    declared.caps.set(change.cell, held ? Math.min(held, change.gradient) : change.gradient);
  } else if ("magic" in change) {
    const key = magicKey(change.magic);
    let entry = declared.magic.get(key);
    if (!entry) declared.magic.set(key, (entry = { target: change.magic, cells: new Map() }));
    take(changeAt(entry.cells, change.cell), change);
  } else {
    let cells = declared.bands.get(change.band);
    if (!cells) declared.bands.set(change.band, (cells = new Map()));
    take(changeAt(cells, change.cell), change);
  }
}
type PlaceEffect = (state: GenerationState, place: PoiPlace) => readonly PoiFieldChange[];
const nothingDeclared = (): Declared => ({ bands: new Map(), magic: new Map(), caps: new Map() });
/** What a parent's places must be given on this refined map. */
function declareCarried(state: GenerationState, declared: Declared) {
  if (!("regional" in state)) return;
  const region = state as RegionalState;
  for (const { entry, carried } of carriedPlaces(region)) {
    const realize = entry.acrossMaps.realize;
    if (typeof realize !== "function") continue;
    for (const change of (
      realize as (s: RegionalState, c: PoiCarried) => readonly PoiFieldChange[]
    )(region, carried))
      collect(declared, change);
  }
}
/** Every change every place declares on this map, and those a parent's places must be given. */
function declaredChanges(state: GenerationState) {
  const declared = nothingDeclared();
  for (const entry of Object.values(poiCatalogue)) {
    const effects = roles
      .map((role) => entry.fields[role])
      .filter((effect): effect is PlaceEffect => typeof effect === "function");
    if (!effects.length) continue;
    for (const place of placesOf(state, entry))
      for (const effect of effects)
        for (const change of effect(state, place)) collect(declared, change);
  }
  declareCarried(state, declared);
  return declared;
}
/** The total a cell's change comes to, over what the band holds without any declared change. */
function totalOver(base: number, change: CellChange) {
  const target = Math.min(change.atMost, Math.max(change.atLeast, base + change.add));
  return target - base;
}

/** What magic bands have had applied, by band, so a change is a total and never compounds. */
const appliedMagic = new WeakMap<GenerationState, Map<string, Map<number, number>>>();
function bandOf(state: GenerationState, target: PoiMagicBand): Band | undefined {
  const field = state.physical?.magic?.fields.find((f) => f.definition.id === target.system);
  if (!field) return undefined;
  return "stock" in target ? field.stocks[target.stock] : field[target.channel];
}
function writeMagic(state: GenerationState, declared: Declared) {
  const applied = appliedMagic.get(state) ?? new Map<string, Map<number, number>>();
  appliedMagic.set(state, applied);
  for (const [key, { target, cells }] of declared.magic) {
    const band = bandOf(state, target);
    if (!band) continue;
    const held = applied.get(key) ?? new Map<number, number>();
    applied.set(key, held);
    for (const cell of new Set([...held.keys(), ...cells.keys()])) {
      const before = held.get(cell) ?? 0,
        base = band.get(cell) - before,
        change = cells.get(cell),
        total = change ? totalOver(base, change) : 0;
      band.set(cell, base + total);
      held.set(cell, total);
    }
  }
}
/** Declare every place's effects on a ledger cycle the caller opened; magic bands apply at once. */
export function declarePlaceEffects(state: GenerationState, ledger: Contributions) {
  releaseHeld(state);
  const declared = declaredChanges(state),
    map = fieldOf(state);
  latestCaps.set(state, declared.caps);
  for (const [band, cells] of declared.bands)
    for (const [cell, change] of cells) {
      const total = totalOver(map[band].get(cell) - ledger.appliedTo(band, cell), change);
      ledger.add(band, cell, total);
      // Sediment lies on the ground: more of it raises the surface, less of it lowers it.
      if (band === "SedimentThickness") ledger.add("Elevation", cell, total);
    }
  writeMagic(state, declared);
  const magic = state.physical?.magic;
  if (magic)
    magic.carrierCost = {
      crust: carrierFactors(state, "crust"),
      roots: carrierFactors(state, "roots"),
      ice: carrierFactors(state, "ice"),
    };
  releaseHeld(state);
}

/** The gradient caps of the round's declaration: the relief that follows holds to them. */
const latestCaps = new WeakMap<GenerationState, Map<number, number>>();
/** Before a round has declared anything, only the parent's places stand on this ground. */
function carriedCaps(state: RegionalState) {
  const declared = nothingDeclared();
  releaseHeld(state);
  declareCarried(state, declared);
  releaseHeld(state);
  return declared.caps;
}
/** Per-cell gradient caps from every place's declared change, for the relief step (0 = none). */
export function placeCaps(state: RegionalState, cap: Float64Array) {
  for (const [cell, gradient] of latestCaps.get(state) ?? carriedCaps(state))
    cap[cell] = cap[cell] > 0 ? Math.min(cap[cell], gradient) : gradient;
}

/**
 * Bands the world's processes write afresh within an epoch, so nothing of a place's last total
 * remains in them. The ledger would otherwise count it as still applied and write no change.
 */
const recomputedBands: readonly PhysicalBufferName[] = [
  "Temperature",
  "Moisture",
  "Rainfall",
  "Runoff",
  "RiverOrders",
  "FlowAccumulation",
  "Slope",
  "WaterDepths",
  "WaterSurfaceElevations",
];
const worldLedgers = new WeakMap<GenerationState, Contributions>();
/** The world's cycle, once per epoch: declared totals replace the last epoch's, so nothing compounds. */
export function applyPlaceEffects(state: GenerationState) {
  const map = fieldOf(state);
  let ledger = worldLedgers.get(state);
  if (!ledger) worldLedgers.set(state, (ledger = new Contributions(map.mesh.count)));
  ledger.begin();
  for (const band of recomputedBands) ledger.forget(band);
  declarePlaceEffects(state, ledger);
  ledger.commit(map, ledgerFloors, ledgerCeilings);
  holdLandscape(map);
}
/**
 * The world's surface is its bedrock and the sediment on it, exactly. A place that moved the
 * surface moved the rock beneath, so the processes that rebuild the surface keep the change.
 */
function holdLandscape(map: PhysicalField) {
  for (let cell = 0; cell < map.mesh.count; cell++) {
    const sediment = map.SedimentThickness.get(cell);
    if (map.Elevation.get(cell) === map.BedrockElevation.get(cell) + sediment) continue;
    map.BedrockElevation.set(cell, map.Elevation.get(cell) - sediment);
    rebuild(map, cell);
  }
}
