import { waterColumn, type Band } from "@atlas/domain";
import { carriedBy } from "../coupling/carriers";
import type { PhysicalField } from "../world/field";
import { noWaterSurface } from "../world/math";
import { releaseWorking, workingArray } from "../world/physicalNumerics";
import { weightScale, type TransportPlan } from "../world/transportPlan";
import type { PhysicalChannel } from "../world/atlasChannels";

/**
 * The water column: what a cell itself holds of water. Lying snow, water in the soil, water
 * in the ground below, and water standing on it (how deep, how high its surface, whether it
 * is sea or lake, and which body). It is one package. Whatever changes a part of it during
 * generation does so through this file; it is carried with the crust as a whole, and its
 * list of parts here is what a finer map inherits. (An author's own values and a finer
 * map's inherited ones are laid in by the same loaders as every other layer.)
 */

/** Depths the column holds as amounts of water, each over the whole cell. */
const held = [waterColumn.snow, waterColumn.soil, waterColumn.ground] as const;

// --- Snow, soil water and groundwater -------------------------------------------------

/** The snow lying on a cell through the year, as a depth of water. */
export const putSnow = (map: PhysicalField, i: number, depth: number) =>
  map[waterColumn.snow].set(i, Math.max(0, depth));
/** What a cell's soil holds, as a depth of water. */
export const putSoilWater = (map: PhysicalField, i: number, depth: number) =>
  map[waterColumn.soil].set(i, Math.max(0, depth));
/** What the ground below a cell's soil holds, as a depth of water. */
export const putGroundwater = (map: PhysicalField, i: number, depth: number) =>
  map[waterColumn.ground].set(i, depth);
/** Water reaching or leaving the ground below a cell, as a depth. */
export const addGroundwater = (map: PhysicalField, i: number, depth: number) =>
  map[waterColumn.ground].add(i, depth);

// --- Standing water -------------------------------------------------------------------

/**
 * Standing water on a cell: sea or lake, with its depth and the height of its surface. These
 * are the only ways a cell comes to hold standing water or to lose it, whoever asks.
 */
export function clearWaterSurface(map: PhysicalField, i: number) {
  map[waterColumn.standing].set(i, 0);
  map[waterColumn.surface].set(i, noWaterSurface);
}
export function setWaterSurface(map: PhysicalField, i: number, surface: number) {
  const depth = surface - map.Elevation.get(i);
  if (depth <= 0) throw new Error("Water surface must be above its physical floor.");
  map[waterColumn.surface].set(i, surface);
  map[waterColumn.standing].set(i, depth);
}
/** No water stands anywhere: the state the sea and the lakes are then read into. */
export function clearStandingWater(map: PhysicalField) {
  map[waterColumn.kind].fill(0);
  map[waterColumn.body].fill(0);
  map[waterColumn.standing].fill(0);
  map[waterColumn.surface].fill(noWaterSurface);
}
/** Water of a kind (1 sea, 2 lake) and body stands on a cell, its surface at this height. */
export function standWater(
  map: PhysicalField,
  i: number,
  kind: 1 | 2,
  surface: number,
  body?: number
) {
  map[waterColumn.kind].set(i, kind);
  if (body !== undefined) map[waterColumn.body].set(i, body);
  setWaterSurface(map, i, surface);
}
/** The water standing on a cell is gone: it is land again. */
export function drainCell(map: PhysicalField, i: number) {
  map[waterColumn.kind].set(i, 0);
  map[waterColumn.body].set(i, 0);
  clearWaterSurface(map, i);
}
/** The ground under standing water moved: the water is as deep as its surface now stands above it. */
export function reconcileWater(map: PhysicalField, i: number) {
  const surface = map.WaterSurfaceElevations.get(i);
  if (surface === noWaterSurface) return;
  if (surface > map.Elevation.get(i)) {
    map[waterColumn.standing].set(i, surface - map.Elevation.get(i));
    return;
  }
  map.LakeOutletTargets.set(i, -1);
  map.LakeOverflow.set(i, 0);
  drainCell(map, i);
}
/** A cell behind a barrier holds water to the barrier's crest, as part of one body. */
export function impound(map: PhysicalField, i: number, body: number, crest: number) {
  standWater(map, i, 2, crest, body);
}
/**
 * A work that holds water up on its cell (a mill pond, a weir, a flooded threshold) keeps the
 * surface there at least so high. It makes no lake and moves no water.
 */
export function holdWaterSurface(map: PhysicalField, i: number, surface: number) {
  if (surface > map.WaterSurfaceElevations.get(i)) map[waterColumn.surface].set(i, surface);
}
/** A lake bed that has given up what its water left behind remembers no lake. */
export function forgetLake(map: PhysicalField, i: number) {
  map.LakeMemory.set(i, 0);
}

// --- Carried with the crust -----------------------------------------------------------

/**
 * When the plates move, the column goes with its ground as one package. The water held in
 * snow, soil and ground arrives with the crust that carried it, each cell taking what its
 * arriving shares held. A lake rides the ground it lies on: a cell takes the lake of the
 * ground that mostly arrived there, and loses one whose ground has moved away. The sea does
 * not ride the crust; it stays in the basins and is read again from the ground as it lies.
 */
export function carryColumn(map: PhysicalField, plan: TransportPlan) {
  const arriving = workingArray(map, "float64", "water:column-arriving");
  for (const part of held) {
    arriving.fill(0);
    spread(map, plan, map[part], arriving);
    for (let cell = 0; cell < map.mesh.count; cell++)
      map[part].set(cell, arriving.get(cell) / weightScale);
  }
  releaseWorking(map, arriving);
  carryLakes(map, plan);
}
const standing = [
  waterColumn.kind,
  waterColumn.body,
  waterColumn.standing,
  waterColumn.surface,
] as const;
function carryLakes(map: PhysicalField, plan: TransportPlan) {
  const before = standing.map((part) => map.coverage.copyBand(map[part])),
    [kinds] = before;
  for (let cell = 0; cell < map.mesh.count; cell++) {
    const source = plan.dominant.get(cell);
    // New crust, and ground that stayed under the sea, keep what stands there.
    if (source < 0 || (kinds.get(source) === 1 && kinds.get(cell) === 1)) continue;
    if (kinds.get(source) === 2)
      standing.forEach((part, n) => map[part].set(cell, before[n].get(source)));
    else if (kinds.get(cell) === 2) drainCell(map, cell);
  }
  releaseWorking(map, ...before);
}
function spread(map: PhysicalField, plan: TransportPlan, values: Band, arriving: Band) {
  for (let source = 0; source < map.mesh.count; source++) {
    const value = values.get(source),
      end = plan.offsets.get(source + 1);
    for (let offset = plan.offsets.get(source); offset < end; offset++) {
      const target = plan.targets.get(offset);
      // A depth over a larger sending cell is a greater depth over a smaller receiving one.
      if (target >= 0)
        arriving.add(
          target,
          (value * plan.weights.get(offset) * map.mesh.area(source)) / map.mesh.area(target)
        );
    }
  }
}
carriedBy("water", carryColumn);

// --- Handed to a finer map ------------------------------------------------------------

const depth = (name: (typeof waterColumn)[keyof typeof waterColumn]): PhysicalChannel => ({
  name,
  unit: "metre",
  minimum: 0,
});
/**
 * The column as a finer map receives it: every part, published and inherited together. A
 * finer map starts with its parent's snow, soil water, groundwater and standing water.
 */
export const waterColumnChannels: PhysicalChannel[] = [
  ...held.map(depth),
  { name: waterColumn.standing, unit: "native-length", minimum: 0 },
  { name: waterColumn.surface, unit: "native-length" },
  { name: waterColumn.kind, unit: "category", quantity: "category" },
  { name: waterColumn.body, unit: "category", quantity: "category" },
];
/**
 * The parts by who publishes them. Where water stands is published with the sea, which every
 * map has; what the land holds, and which lake is which, with the land's water.
 */
export const standingWaterNames = [waterColumn.kind, waterColumn.standing, waterColumn.surface];
export const landWaterNames = [...held, waterColumn.body];
