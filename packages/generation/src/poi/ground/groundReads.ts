import type { MagicSystem } from "@atlas/domain";
import { potentialEvaporation } from "../../canonry/ecologyEnvironment";
import type { PhysicalBufferName } from "../../canonry/field";
import { reservoirAmount } from "../../canonry/magicState";
import type { GenerationState } from "../../process";
import type { RegionalState } from "../../regional/state";
import type { PoiCarried, PoiFieldChange, PoiPlace, PoiUnrealized } from "../poiContract";
import {
  adjacent,
  cellSpan,
  celsiusAt,
  fieldOf,
  gap,
  isLand,
  isRiver,
  magicRule,
  metres,
  sedimentAt,
  slopeAt,
} from "../poiReads";

/**
 * What the ground group's entries share: its material tests, which the mine reads as deposits,
 * and the readings of magic systems and the river's profile the toolkit does not name.
 */
export const floorOf = (band: PhysicalBufferName, cell: number, value: number): PoiFieldChange => ({
  change: "atLeast",
  band,
  cell,
  value,
});
export const capOf = (band: PhysicalBufferName, cell: number, value: number): PoiFieldChange => ({
  change: "atMost",
  band,
  cell,
  value,
});

const systemField = (state: GenerationState, system: string) =>
  state.physical?.magic?.fields.find((field) => field.definition.id === system);
export const effectOf = (
  state: GenerationState,
  system: string,
  effect: keyof MagicSystem["effects"]
) => systemField(state, system)?.definition.effects[effect] ?? 0;
export const parameterOf = (
  state: GenerationState,
  system: string,
  parameter: keyof MagicSystem["parameters"]
) => systemField(state, system)?.definition.parameters[parameter];
/** One stock of a system at a cell, per square metre, as the system's own rules read it. */
export function stockPerArea(state: GenerationState, system: string, key: string, cell: number) {
  const held = systemField(state, system)?.stocks[key];
  return held ? held.get(cell) / fieldOf(state).mesh.area(cell) : 0;
}
/** All of a system's stock in one reservoir at a cell, per square metre. */
export function reservoirPerArea(
  state: GenerationState,
  system: string,
  reservoir: string,
  cell: number
) {
  const field = systemField(state, system);
  return field ? reservoirAmount(field, reservoir, cell) / fieldOf(state).mesh.area(cell) : 0;
}
/** Whether a system's conduit at a cell has sealed after carrying its budget. */
export const sealedAt = (state: GenerationState, system: string, cell: number) =>
  (systemField(state, system)?.sealed.get(cell) ?? 0) > 0;
/** The lowest level of a reading a rule's cells keep, from the system's own definition. */
export function ruleFloor(state: GenerationState, system: string, rule: string, reading: string) {
  const found = systemField(state, system)?.definition.features.find((r) => r.id === rule);
  if (!found) return undefined;
  const floors = (found.retains ?? found.seeds)
    .flat()
    .filter((condition) => condition.field === reading && condition.min !== undefined)
    .map((condition) => condition.min!);
  return floors.length ? Math.min(...floors) : undefined;
}

/** A river's fall over its run from a cell to the next, never negative. */
export function flowGradient(state: GenerationState, cell: number) {
  const map = fieldOf(state),
    target = map.FlowTargets.get(cell);
  if (target < 0) return 0;
  const run = gap(state, cell, target),
    fall = metres(map.Elevation.get(cell) - map.Elevation.get(target));
  return run > 0 ? Math.max(0, fall / run) : 0;
}
/** The steepest river reach running into a cell. */
export function gradientInto(state: GenerationState, cell: number) {
  let steepest = 0;
  for (const next of adjacent(state, cell))
    if (isRiver(state, next) && fieldOf(state).FlowTargets.get(next) === cell)
      steepest = Math.max(steepest, flowGradient(state, next));
  return steepest;
}

/** The least sediment, in metres, that makes a bar; thinner gravel is a bed in passing. */
export const barDepth = 1;
/** A reach above this gradient can carry coarse heavy grains. */
const carryingGradient = 0.001;
/** A river loses its grip on heavy grains where its gradient falls below this share of the reach above. */
const slackening = 0.5;
/** Gravel against the current: the bar a river leaves where it slackens, delta silt excepted. */
const riverBar = (state: GenerationState, cell: number) => {
  if (!isRiver(state, cell) || sedimentAt(state, cell) < barDepth) return false;
  if (fieldOf(state).DeltaIntensity.get(cell) > 0) return false;
  const above = gradientInto(state, cell);
  return above >= carryingGradient && flowGradient(state, cell) <= slackening * above;
};
const firePlacer = magicRule("fire", "placer");
export const placerAt = (state: GenerationState, cell: number) =>
  isLand(state, cell) && (firePlacer(state, cell) || riverBar(state, cell));

/** Precipitation over evaporation below which a basin stays closed, as the regional network holds it. */
const closedAridity = 0.5;
/** A floor this gentle has been levelled by standing water; steeper ground is the basin's side. */
const panFloor = 0.006;
/** Living cover below which the ground is bare, the cut ecology makes between pan and heath. */
export const bareCover = 0.12;
const coverAt = (state: GenerationState, cell: number) => {
  const map = fieldOf(state);
  return map.TreeCover.get(cell) + map.GrassCover.get(cell) + map.WetlandCover.get(cell);
};
export const spillDepthAt = (state: GenerationState, cell: number) => {
  const map = fieldOf(state);
  return metres(map.DrainageElevations.get(cell) - map.Elevation.get(cell));
};
/** Whether rain and snow fall short of what the air takes up by enough to keep a basin closed. */
export const closedByAridity = (state: GenerationState, cell: number) => {
  const map = fieldOf(state),
    falling = (map.Rainfall.get(cell) + map.Snowfall.get(cell)) / 1000;
  return falling < closedAridity * potentialEvaporation(celsiusAt(state, cell));
};
/** A dry, bare, level floor below the spill of its basin: a pan with no magic in it. */
export const naturalPanAt = (state: GenerationState, cell: number) =>
  isLand(state, cell) &&
  spillDepthAt(state, cell) > 0 &&
  slopeAt(state, cell) <= panFloor &&
  fieldOf(state).IceThickness.get(cell) <= 0 &&
  coverAt(state, cell) < bareCover &&
  closedByAridity(state, cell);
const saltPanRule = magicRule("salt", "pan"),
  glassRule = magicRule("salt", "flat");
export const panAt = (state: GenerationState, cell: number) =>
  isLand(state, cell) &&
  !glassRule(state, cell) &&
  (saltPanRule(state, cell) || naturalPanAt(state, cell));

export const veinAt = magicRule("fire", "vein");
const dustRule = magicRule("salt", "dust");
export const dustAt = (state: GenerationState, cell: number) =>
  isLand(state, cell) && dustRule(state, cell);

/** Salt's yield per death and its killing-ground floor, used where no Salt system defines them. */
const defaultDeathYield = 5_000_000,
  defaultKillingFloor = 20;
const killingRule = magicRule("salt", "ground");
/** The least brine per square metre that makes a killing ground. */
export const killingFloor = (state: GenerationState) =>
  ruleFloor(state, "salt", "ground", "stock:death/brine") ?? defaultKillingFloor;
/** The dead the MassDeath band still records, as the brine per square metre they will become. */
export function recordedBrineAt(state: GenerationState, cell: number) {
  const map = fieldOf(state),
    made = parameterOf(state, "salt", "saltPerDeath") ?? defaultDeathYield;
  return (map.MassDeath.get(cell) * made) / map.mesh.area(cell);
}
/** The brine of the dead, or the dead the ground records before Salt has read them or without Salt. */
export const killingAt = (state: GenerationState, cell: number) =>
  isLand(state, cell) &&
  (killingRule(state, cell) || recordedBrineAt(state, cell) >= killingFloor(state));

/** Salting as the living feedback wrote it. */
export const saltingAt = (state: GenerationState, cell: number) => fieldOf(state).Salting.get(cell);
/**
 * Salted ground draws the air's moisture down: declared as the ceiling that holds whatever the
 * moisture was, so declaring it twice takes nothing twice.
 */
export function saltedAir(state: GenerationState, place: PoiPlace): readonly PoiFieldChange[] {
  const drying = parameterOf(state, "salt", "desiccation") ?? 0;
  return place.cells
    .filter((cell) => saltingAt(state, cell) > 0)
    .map((cell) =>
      capOf("Moisture", cell, Math.round(1000 * (1 - drying * saltingAt(state, cell))))
    );
}
/** Growth on salted ground falls by this share of the salting, as ecology's growth terms hold it. */
const saltThinning = 0.8;
/** The tree and grass cover salted ground can carry. */
export function saltThinned(state: GenerationState, place: PoiPlace): readonly PoiFieldChange[] {
  return place.cells.flatMap((cell) => {
    const share = 1 - saltThinning * saltingAt(state, cell);
    return share >= 1 ? [] : [capOf("TreeCover", cell, share), capOf("GrassCover", cell, share)];
  });
}
/** Holds the salting a place has: Salt does not decay, whatever the field does around it. */
export const saltHeld = (state: GenerationState, place: PoiPlace): readonly PoiFieldChange[] =>
  place.cells
    .filter((cell) => saltingAt(state, cell) > 0)
    .map((cell) => floorOf("Salting", cell, saltingAt(state, cell)));

/** A place's ground area in square metres. */
export const areaOf = (state: GenerationState, place: PoiPlace) =>
  place.cells.reduce((sum, cell) => sum + fieldOf(state).mesh.area(cell), 0);
/** A course's length in metres, as many cell spans as it has cells. */
export const lengthOf = (state: GenerationState, place: PoiPlace) =>
  place.cells.length * cellSpan(state);
/** The country a place is judged against. */
export const aroundOf = (state: GenerationState) => 6 * cellSpan(state);
/** A place stands on another when the other's cells include its anchor. */
export const standsOn = (_state: GenerationState, a: PoiPlace, b: PoiPlace) =>
  b.cells.includes(a.anchor);

/** Takes the nearest cell of the kind, or goes when the finer ground holds none. */
export const movesOrGoes =
  (counterpart: (state: RegionalState, carried: PoiCarried) => number) =>
  (state: RegionalState, carried: PoiCarried): PoiUnrealized => {
    const cell = counterpart(state, carried);
    return cell >= 0 ? { outcome: "move", cell } : { outcome: "drop" };
  };
