import { MapScale, type AtlasFeature, type MagicSystem } from "@atlas/domain";
import { mapScale } from "../../worldSignificance";
import { bareGround } from "../../world/ecologyBiomes";
import { potentialEvaporation } from "../../world/ecologyEnvironment";
import type { PhysicalBufferName } from "../../world/field";
import { components } from "../../world/geographicRegions";
import { reservoirAmount } from "../../world/magicState";
import type { GenerationState } from "../../process";
import { closedBasinAridity } from "../../regional/network";
import type { RegionalState } from "../../regional/state";
import type { PoiCarried, PoiFieldChange, PoiPlace, PoiUnrealized } from "../poiContract";
import type { PoiKindId } from "../poiKinds";
import { rulePlaces } from "../poiPlaces";
import {
  adjacent,
  cellSpan,
  celsiusAt,
  fieldOf,
  gap,
  heldFor,
  isLand,
  magicRule,
  metres,
  sedimentAt,
  slopeAt,
} from "../poiReads";
import { ruleRecord } from "../poiRecords";
import { onMappedRiver } from "../water/waterReads";

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
    if (onMappedRiver(state, next) && fieldOf(state).FlowTargets.get(next) === cell)
      steepest = Math.max(steepest, flowGradient(state, next));
  return steepest;
}

/** The least sediment, in metres, that makes a bar; thinner gravel is a bed in passing. */
export const barDepth = MapScale.length(0.00000025, 0.5);
/** A reach above this gradient can carry coarse heavy grains. */
const carryingGradient = 0.001;
/** A river loses its grip on heavy grains where its gradient falls below this share of the reach above. */
const slackening = 0.5;
/** Gravel against the current: the bar a river leaves where it slackens, delta silt excepted. */
const riverBar = (state: GenerationState, cell: number) => {
  if (
    !onMappedRiver(state, cell) ||
    sedimentAt(state, cell) < mapScale(state).resolveMeasure(barDepth)
  )
    return false;
  if (fieldOf(state).DeltaIntensity.get(cell) > 0) return false;
  const above = gradientInto(state, cell);
  return above >= carryingGradient && flowGradient(state, cell) <= slackening * above;
};
const firePlacer = magicRule("fire", "placer");
/** A bar with no metal in it: the plain form of a band, which Fire's rule does not hold. */
export const naturalBarAt = (state: GenerationState, cell: number) =>
  isLand(state, cell) && !firePlacer(state, cell) && riverBar(state, cell);
export const placerAt = (state: GenerationState, cell: number) =>
  firePlacer(state, cell) || naturalBarAt(state, cell);

/** A floor this gentle has been levelled by standing water; steeper ground is the basin's side. */
const panFloor = 0.006;
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
    falling = MapScale.metres(map.Rainfall.get(cell) + map.Snowfall.get(cell), "mm");
  return (
    falling <
    closedBasinAridity * potentialEvaporation(celsiusAt(state, cell), fieldOf(state).scale)
  );
};
const saltPanRule = magicRule("salt", "pan"),
  glassRule = magicRule("salt", "flat");
/** A dry, bare, level floor below the spill of its basin: a pan with no magic in it. */
export const naturalPanAt = (state: GenerationState, cell: number) =>
  isLand(state, cell) &&
  !saltPanRule(state, cell) &&
  !glassRule(state, cell) &&
  spillDepthAt(state, cell) > 0 &&
  slopeAt(state, cell) <= panFloor &&
  fieldOf(state).IceThickness.get(cell) <= 0 &&
  coverAt(state, cell) < bareGround &&
  closedByAridity(state, cell);
export const panAt = (state: GenerationState, cell: number) =>
  saltPanRule(state, cell) || naturalPanAt(state, cell);

export const veinAt = magicRule("fire", "vein");
export const dustAt = magicRule("salt", "dust");

/** Salt's yield per death, its killing-ground floor and its full level, where no Salt system defines them. */
const defaultDeathYield = MapScale.area(3.125e-7),
  defaultKillingFloor = 20,
  defaultFullSalt = 400;
/** Salt's full level, per square metre. */
export const fullSaltOf = (state: GenerationState) =>
  parameterOf(state, "salt", "saltFull") ?? defaultFullSalt;
const killingRule = magicRule("salt", "ground");
/** The least brine per square metre that makes a killing ground. */
export const killingFloor = (state: GenerationState) =>
  ruleFloor(state, "salt", "ground", "stock:death/brine") ?? defaultKillingFloor;
/** The dead the MassDeath band still records, as the brine per square metre they will become. */
export function recordedBrineAt(state: GenerationState, cell: number) {
  const map = fieldOf(state),
    made =
      parameterOf(state, "salt", "saltPerDeath") ?? map.scale.resolveMeasure(defaultDeathYield);
  return (map.MassDeath.get(cell) * made) / map.mesh.area(cell);
}
/** Dead the ground records past Salt's floor and outside its rule: before Salt has read them, or with no Salt. */
export const naturalKillingAt = (state: GenerationState, cell: number) =>
  isLand(state, cell) &&
  !killingRule(state, cell) &&
  recordedBrineAt(state, cell) >= killingFloor(state);
export const killingAt = (state: GenerationState, cell: number) =>
  killingRule(state, cell) || naturalKillingAt(state, cell);

/** Salting as the living feedback wrote it. */
export const saltingAt = (state: GenerationState, cell: number) => fieldOf(state).Salting.get(cell);

type CellTest = (state: GenerationState, cell: number) => boolean;
/** Each connected group of cells of a kind's natural form, anchored where `rank` is highest. */
const naturalPlaces =
  (kind: PoiKindId, natural: CellTest, rank: (state: GenerationState, cell: number) => number) =>
  (state: GenerationState): readonly PoiPlace[] =>
    heldFor(state, `natural:${kind}`, () => {
      const found: PoiPlace[] = [];
      components(
        state,
        (i) => natural(state, i),
        (members) => {
          const cells = [...members],
            anchor = cells.reduce((a, b) => (rank(state, b) > rank(state, a) ? b : a), cells[0]);
          found.push({ id: `${kind}:${anchor}`, kind, cells, anchor });
        }
      );
      return found;
    });
/** A kind a magic rule grows that also forms without it: the rule's places, then the natural ones. */
export const grownAndNaturalPlaces = (
  kind: PoiKindId,
  [system, rule]: readonly [string, string],
  natural: CellTest,
  rank: (state: GenerationState, cell: number) => number
) => {
  const grown = rulePlaces(kind, system, rule),
    formed = naturalPlaces(kind, natural, rank);
  return (state: GenerationState): readonly PoiPlace[] => [...grown(state), ...formed(state)];
};
/** A rule's place publishes as the system's class; a natural one by the kind's own record. */
export const grownOrNaturalRecord = (
  system: string,
  rule: string,
  natural: (state: GenerationState, place: PoiPlace) => AtlasFeature | null
) => {
  const grown = ruleRecord(system, rule),
    isGrown = magicRule(system, rule);
  return (state: GenerationState, place: PoiPlace) =>
    isGrown(state, place.anchor) ? grown(state, place) : natural(state, place);
};

/** A place's ground area in square metres. */
export const areaOf = (state: GenerationState, place: PoiPlace) =>
  place.cells.reduce((sum, cell) => sum + fieldOf(state).mesh.area(cell), 0);
/** A course's length in metres, as many cell spans as it has cells. */
export const lengthOf = (state: GenerationState, place: PoiPlace) =>
  place.cells.length * cellSpan(state);
/** The country a place is judged against, in metres. */
// length-unit: fraction
const countryReach = 0.0075;
/** That country, and always some of it: a map whose cells are wider still reads its neighbours. */
export const aroundOf = (state: GenerationState) =>
  mapScale(state).supported(mapScale(state).length(countryReach), 2);
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
