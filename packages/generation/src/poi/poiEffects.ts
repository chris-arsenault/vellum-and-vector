import type { Band } from "@atlas/domain";
import {
  isMutablePhysicalName,
  type MutablePhysicalBufferName,
  type PhysicalBufferName,
  type PhysicalField,
} from "../world/field";
import { executeGroundTarget, isGroundTarget, realizeGroundTarget } from "../rock/groundTargets";
import type { GenerationState } from "../process";
import { Contributions, ledgerCeilings, ledgerFloors } from "../coupling/fieldContributions";
import { gradeGround } from "../regional/grading";
import { isContent } from "../regional/lattice";
import type { RegionalState } from "../regional/state";
import { poiCatalogue } from "./catalogue";
import type {
  PoiCarried,
  PoiEventCommand,
  PoiFieldChange,
  PoiMagicBand,
  PoiPlace,
  PoiStruck,
} from "./poiContract";
import { carrierFactors } from "./poiCosts";
import { fieldOf, releaseHeld } from "./poiReads";
import { carriedPlaces, placesOf } from "./poiPublish";
import { respond } from "../coupling/answers";
import { bindOperation, defineQuery } from "../processOperation";
import type { PhysicalInput } from "../processes/groundProcess";
import { retainedArray } from "../world/physicalNumerics";
import { runMemory } from "../runMemory";

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
  grades: Map<number, number>;
  water?: WaterInfluences;
}
interface WaterInfluences {
  withdrawal: Band;
  transmission: Band;
  /** Water places put into a cell's soil, and the least they keep it holding. */
  soilWetting: Band;
  soilHeld: Band;
}
const waterInfluences = new WeakMap<PhysicalField, WaterInfluences>();
/** Bound to one map's generation state; the query cache owns when current inputs need reading. */
export const placeInfluences = defineQuery<PhysicalInput>("place-influences", () => undefined, []);
export function bindPlaceInfluences(state: GenerationState) {
  bindOperation(fieldOf(state), placeInfluences, () => refreshPlaceInfluences(state));
}
respond({
  key: "waterWithdrawal",
  by: "maintained places",
  reads: [],
  queries: [placeInfluences],
  add: (map, cell) => waterInfluences.get(map)?.withdrawal.get(cell) ?? 0,
});
respond({
  key: "waterTransmission",
  by: "maintained places",
  reads: [],
  queries: [placeInfluences],
  scale: (map, cell) => waterInfluences.get(map)?.transmission.get(cell) ?? 1,
});
respond({
  key: "soilWetting",
  by: "maintained places",
  reads: [],
  queries: [placeInfluences],
  add: (map, cell) => waterInfluences.get(map)?.soilWetting.get(cell) ?? 0,
});
respond({
  key: "soilWaterHeld",
  by: "maintained places",
  reads: [],
  queries: [placeInfluences],
  add: (map, cell) => waterInfluences.get(map)?.soilHeld.get(cell) ?? 0,
});
/** A place's change to the soil's water is an answer to the water budget, not a write. */
function wetSoil(water: WaterInfluences, change: PoiFieldChange & { band: PhysicalBufferName }) {
  if (change.change === "add") water.soilWetting.add(change.cell, change.amount);
  else if (change.change === "atLeast")
    water.soilHeld.set(change.cell, Math.max(water.soilHeld.get(change.cell), change.value));
  else throw new Error("A place cannot hold the soil's water down.");
}

function clearWaterInfluences(map: PhysicalField) {
  let water = waterInfluences.get(map);
  if (!water) {
    water = {
      withdrawal: retainedArray(map, "float64", "places:water-withdrawal"),
      transmission: retainedArray(map, "float64", "places:water-transmission"),
      soilWetting: retainedArray(map, "float64", "places:soil-wetting"),
      soilHeld: retainedArray(map, "float64", "places:soil-held"),
    };
    waterInfluences.set(map, water);
  }
  water.soilWetting.fill(0);
  water.soilHeld.fill(0);
  water.withdrawal.fill(0);
  water.transmission.fill(1);
  return water;
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
  if (change.change === "waterPassage") {
    const water = declared.water;
    if (!water) return;
    water.withdrawal.add(change.cell, Math.max(0, change.withdrawal));
    water.transmission.set(
      change.cell,
      water.transmission.get(change.cell) * Math.max(0, Math.min(1, change.transmission))
    );
  } else if (change.change === "gradeGround") {
    const held = declared.grades.get(change.cell);
    declared.grades.set(
      change.cell,
      held === undefined ? change.gradient : Math.min(held, change.gradient)
    );
  } else if ("magic" in change) {
    const key = magicKey(change.magic);
    let entry = declared.magic.get(key);
    if (!entry) declared.magic.set(key, (entry = { target: change.magic, cells: new Map() }));
    take(changeAt(entry.cells, change.cell), change);
  } else if (change.band === "SoilWater") {
    if (declared.water) wetSoil(declared.water, change);
  } else {
    let cells = declared.bands.get(change.band);
    if (!cells) declared.bands.set(change.band, (cells = new Map()));
    take(changeAt(cells, change.cell), change);
  }
}
type PlaceEffect = (state: GenerationState, place: PoiPlace) => readonly PoiFieldChange[];
const nothingDeclared = (): Declared => ({ bands: new Map(), magic: new Map(), grades: new Map() });

/** Dispatch supplied initialization strategies, independently of maintained-place queries. */
export function eventChanges<State>(
  commands: readonly PoiEventCommand<State>[],
  state: State,
  event: PoiStruck
) {
  return commands.flatMap((command) =>
    command.accepts(event) ? command.changes(state, event) : []
  );
}
/** Called by the existing event owner after accepting a new event, never by capture or refresh. */
export function applyPlaceEvent(state: GenerationState, event: PoiStruck) {
  const commands = Object.values(poiCatalogue).flatMap((entry) =>
      entry.event ? [entry.event] : []
    ),
    map = fieldOf(state);
  for (const change of eventChanges(commands, state, event)) {
    const target = { add: 0, atMost: Infinity, atLeast: -Infinity };
    take(target, change);
    if (isGroundTarget(change.band)) executeGroundTarget(map, change.band, change.cell, target);
    else {
      if (!isMutablePhysicalName(change.band))
        throw new Error(`Unsupported event target: ${change.band}`);
      const band = map[change.band],
        current = band.get(change.cell);
      band.set(change.cell, current + totalOver(current, target));
    }
  }
}
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
  declared.water = clearWaterInfluences(fieldOf(state));
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
/** Derived query: only recomposes current influences; it executes no material commands. */
export function refreshPlaceInfluences(state: GenerationState) {
  releaseHeld(state);
  const declared = nothingDeclared();
  declared.water = clearWaterInfluences(fieldOf(state));
  for (const entry of Object.values(poiCatalogue)) {
    const water = entry.fields.water;
    if (typeof water !== "function") continue;
    for (const place of placesOf(state, entry))
      for (const change of water(state, place))
        if (change.change === "waterPassage" || ("band" in change && change.band === "SoilWater"))
          collect(declared, change);
  }
  // What a parent's places must be given here wets the soil as the map's own places do.
  declareCarried(state, declared);
  releaseHeld(state);
}
/** The total a cell's change comes to, over what the band holds without any declared change. */
function totalOver(base: number, change: CellChange) {
  const target = Math.min(change.atMost, Math.max(change.atLeast, base + change.add));
  return target - base;
}

/** What magic bands have had applied, by band, so a change is a total and never compounds. */
const appliedMagic = (state: GenerationState) =>
  runMemory(state, "places.applied-magic", () => new Map<string, Map<number, number>>());
function bandOf(
  state: GenerationState,
  target: PoiMagicBand
): Pick<Band, "get" | "set"> | undefined {
  const field = state.physical?.magic?.fields.find((f) => f.definition.id === target.system);
  if (!field) return undefined;
  return "stock" in target ? field.stocks[target.stock] : field[target.channel];
}
function writeMagic(state: GenerationState, declared: Declared) {
  const applied = appliedMagic(state);
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
  latestGrades.set(state, declared.grades);
  for (const [band, cells] of declared.bands)
    for (const [cell, change] of cells) {
      if (isGroundTarget(band)) {
        realizeGroundTarget(map, band, cell, change);
        continue;
      }
      if (!isMutablePhysicalName(band)) throw new Error(`Unsupported owned place target: ${band}`);
      const total = totalOver(map[band].get(cell) - ledger.appliedTo(band, cell), change);
      ledger.add(band, cell, total);
    }
  writeMagic(state, declared);
  const magic = state.physical?.magic;
  if (magic)
    magic.carrierCost = {
      crust: carrierFactors(state, "crust"),
      roots: carrierFactors(state, "roots"),
      ice: carrierFactors(state, "ice"),
      river: carrierFactors(state, "river"),
      wind: carrierFactors(state, "wind"),
    };
  releaseHeld(state);
}

/** The ground grades requested by the round's feature declarations. */
const latestGrades = new WeakMap<GenerationState, Map<number, number>>();
/** Before a round has declared anything, only the parent's places stand on this ground. */
function carriedGrades(state: RegionalState) {
  const declared = nothingDeclared();
  releaseHeld(state);
  declareCarried(state, declared);
  releaseHeld(state);
  return declared.grades;
}
/** Realize each declared footprint through Ground after natural relief develops. */
export function gradePlaces(state: RegionalState) {
  const map = state.physical.map,
    targets = new Map(
      [...(latestGrades.get(state) ?? carriedGrades(state))].filter(
        ([cell]) => isContent(map.mesh, cell) && map.WaterKindCodes.get(cell) === 0
      )
    ),
    footprint = new Map(targets);
  // A grade belongs to cell faces: even a single-cell bench needs its neighboring land.
  for (const [cell, grade] of targets)
    for (let edge = 0; edge < map.mesh.degree(cell); edge++) {
      const next = map.mesh.neighbor(cell, edge);
      if (next < 0 || !isContent(map.mesh, next) || map.WaterKindCodes.get(next) !== 0) continue;
      footprint.set(next, Math.min(footprint.get(next) ?? Infinity, grade));
    }
  gradeGround(state, footprint);
}

/**
 * Bands the world's processes write afresh within an epoch, so nothing of a place's last total
 * remains in them. The ledger would otherwise count it as still applied and write no change.
 */
const recomputedBands: readonly MutablePhysicalBufferName[] = [
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
/** The world's cycle, once per epoch: declared totals replace the last epoch's, so nothing compounds. */
export function applyPlaceEffects(state: GenerationState) {
  const map = fieldOf(state);
  const applied = runMemory(
    state,
    "places.applied-effects",
    () => new Map<MutablePhysicalBufferName, Float64Array>()
  );
  const ledger = new Contributions(map.mesh.count, applied);
  ledger.begin();
  for (const band of recomputedBands) ledger.forget(band);
  declarePlaceEffects(state, ledger);
  ledger.commit(map, ledgerFloors, ledgerCeilings);
}
