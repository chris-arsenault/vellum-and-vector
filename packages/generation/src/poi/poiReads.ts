import type { AtlasFeature } from "@atlas/domain";
import { Landform, Water } from "../canonry/codes";
import type { PhysicalField } from "../canonry/field";
import { meshWindowCells } from "../canonry/meshWindow";
import { physicalDistance } from "../canonry/physicalMetric";
import { generationFeatures } from "../generationFeatures";
import type { GenerationState } from "../process";
import { cellAt, positionOf } from "../regional/lattice";

/**
 * What POI rules read of the generator's own state. Nothing here computes geography: these
 * are names for the field's bands and the lattice, in the units rules are written in.
 */
export const fieldOf = (state: GenerationState): PhysicalField => state.physical!.map;
/** Native elevation units are 1024 to the metre. */
export const metres = (native: number) => native / 1024;
export const toNative = (value: number) => Math.round(value * 1024);
/** Height above the sea, in metres. */
export const heightAt = (state: GenerationState, cell: number) => {
  const map = fieldOf(state);
  return metres(map.Elevation.get(cell) - map.EffectiveSeaLevel);
};
/** Ground gradient, rise over run. */
export const slopeAt = (state: GenerationState, cell: number) => fieldOf(state).Slope.get(cell);
/** Temperature in degrees Celsius. */
export const celsiusAt = (state: GenerationState, cell: number) =>
  fieldOf(state).Temperature.get(cell) * 0.1 - 30;
/** Moisture, geothermal heat, fracture conductance, upwelling and wave exposure, in [0, 1]. */
export const moistureAt = (state: GenerationState, cell: number) =>
  fieldOf(state).Moisture.get(cell) / 1000;
export const geothermalAt = (state: GenerationState, cell: number) =>
  fieldOf(state).Geothermal.get(cell) / 1000;
export const fractureAt = (state: GenerationState, cell: number) =>
  fieldOf(state).FractureConductance.get(cell) / 1000;
export const upwellingAt = (state: GenerationState, cell: number) =>
  fieldOf(state).Upwelling.get(cell) / 1000;
export const waveExposureAt = (state: GenerationState, cell: number) =>
  fieldOf(state).WaveExposure.get(cell) / 1000;
/** Rock resistance in [0, 1]. */
export const rockAt = (state: GenerationState, cell: number) =>
  fieldOf(state).RockResistance.get(cell) / 4000;
/** Rain in metres a year. */
export const rainfallAt = (state: GenerationState, cell: number) =>
  fieldOf(state).Rainfall.get(cell) / 1000;
/** River discharge in cubic metres a second. */
export const dischargeAt = (state: GenerationState, cell: number) =>
  fieldOf(state).FlowAccumulation.get(cell);
/** Ice thickness and sediment thickness, in metres. */
export const iceAt = (state: GenerationState, cell: number) =>
  fieldOf(state).IceThickness.get(cell);
export const sedimentAt = (state: GenerationState, cell: number) =>
  metres(fieldOf(state).SedimentThickness.get(cell));
/** Living cover as shares of the ground, in [0, 1]. */
export const treeCoverAt = (state: GenerationState, cell: number) =>
  fieldOf(state).TreeCover.get(cell);
export const grassCoverAt = (state: GenerationState, cell: number) =>
  fieldOf(state).GrassCover.get(cell);
export const wetlandCoverAt = (state: GenerationState, cell: number) =>
  fieldOf(state).WetlandCover.get(cell);
export const isLand = (state: GenerationState, cell: number) =>
  fieldOf(state).WaterKindCodes.get(cell) === Water.None;
export const isSea = (state: GenerationState, cell: number) =>
  fieldOf(state).WaterKindCodes.get(cell) === Water.Ocean;
export const isLake = (state: GenerationState, cell: number) =>
  fieldOf(state).WaterKindCodes.get(cell) === Water.Lake;
export const isRiver = (state: GenerationState, cell: number) =>
  fieldOf(state).RiverOrders.get(cell) > 0;
export const landformAt = (state: GenerationState, cell: number) =>
  fieldOf(state).LandformCodes.get(cell);
export { Landform };

export function* adjacent(state: GenerationState, cell: number) {
  const mesh = fieldOf(state).mesh;
  for (let edge = 0; edge < mesh.degree(cell); edge++) {
    const next = mesh.neighbor(cell, edge);
    if (next >= 0) yield next;
  }
}
export const gap = (state: GenerationState, a: number, b: number) =>
  physicalDistance(fieldOf(state).mesh, a, b);
/** The mean distance between neighbouring cells of this map, in metres. */
export const cellSpan = (state: GenerationState) => fieldOf(state).mesh.spacing;

/** Every cell within `radius` metres of a cell, itself included. */
export function cellsWithin(state: GenerationState, cell: number, radius: number): number[] {
  const mesh = fieldOf(state).mesh,
    { x, y } = positionOf(mesh, cell),
    bounds: [number, number, number, number] = [x - radius, y - radius, x + radius, y + radius],
    found: number[] = [];
  for (const other of meshWindowCells(mesh, bounds))
    if (physicalDistance(mesh, cell, other) <= radius) found.push(other);
  return found.includes(cell) ? found : [cell, ...found];
}
/** The nearest cell within `radius` metres meeting a test, the cell itself first, or -1. */
export function nearestWhere(
  state: GenerationState,
  cell: number,
  radius: number,
  test: (other: number) => boolean
) {
  let best = -1,
    reach = Infinity;
  for (const other of cellsWithin(state, cell, radius)) {
    const d = gap(state, cell, other);
    if (d < reach && test(other)) [best, reach] = [other, d];
  }
  return best;
}
/** How many of a cell's neighbours meet a test, as a share of its neighbours. */
export function shareAround(
  state: GenerationState,
  cell: number,
  test: (other: number) => boolean
) {
  let all = 0,
    met = 0;
  for (const next of adjacent(state, cell)) {
    all++;
    if (test(next)) met++;
  }
  return all ? met / all : 0;
}

/** The cell of a feature's first coordinate on this map's lattice. */
export function featureCell(state: GenerationState, feature: AtlasFeature) {
  const [x, y] = firstCoordinate(feature.geometry);
  return cellAt(fieldOf(state).mesh, x, y);
}
function firstCoordinate(geometry: AtlasFeature["geometry"]): number[] {
  if (geometry.type === "GeometryCollection") return firstCoordinate(geometry.geometries[0]);
  let at: unknown = geometry.coordinates;
  while (Array.isArray(at) && Array.isArray(at[0])) at = at[0];
  return at as number[];
}
/** Published features of a kind on this map, optionally of one layer. */
export function* featuresOf(state: GenerationState, kind: string, layerId?: string) {
  for (const feature of generationFeatures(state, { kind }))
    if (layerId === undefined || feature.layerId === layerId) yield feature;
}
/** The settlements published on this map, ruins excluded. */
export const settlementsOf = (state: GenerationState): readonly AtlasFeature[] =>
  heldFor(state, settlementsKey, () =>
    [...featuresOf(state, "settlement", "settlements")].filter(inhabited)
  );
const settlementsKey = "settlementRecords";
/** Settlements were just written: what was kept of them no longer stands. */
export const forgetSettlements = (state: GenerationState) => {
  held.get(state)?.delete(settlementsKey);
};
/** Regional seats keep ruined communities on the settlement layer; only their status tells. */
export const inhabited = (feature: AtlasFeature) =>
  !["abandoned", "ruined"].includes(String(feature.attributes.status));

/** Whether a cell belongs to a magic system's place rule, as the system itself grew it. */
export const magicRule =
  (system: string, rule: string) =>
  (state: GenerationState, cell: number): boolean => {
    const field = state.physical?.magic?.fields.find((f) => f.definition.id === system);
    return (field?.features[rule]?.get(cell) ?? 0) > 0;
  };
/** A magic system's channel at a cell, or 0 where the system is absent. */
export function magicValue(
  state: GenerationState,
  system: string,
  channel: "intensity" | "source",
  cell: number
) {
  const field = state.physical?.magic?.fields.find((f) => f.definition.id === system);
  return field?.[channel]?.get(cell) ?? 0;
}

/** Values kept for one state while it is read between process steps; cleared for the next. */
const held = new WeakMap<GenerationState, Map<string, unknown>>();
export function heldFor<T>(state: GenerationState, key: string, compute: () => T): T {
  let values = held.get(state);
  if (!values) held.set(state, (values = new Map()));
  if (!values.has(key)) values.set(key, compute());
  return values.get(key) as T;
}
/** Forget what was kept for a state: its fields have changed. */
export const releaseHeld = (state: GenerationState) => held.delete(state);
