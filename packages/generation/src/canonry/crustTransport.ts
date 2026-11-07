import type { PhysicalField } from "./field";
import type { Band } from "@atlas/domain";
import { maximumCrustThickness, minimumCrustThickness, units } from "./math";
import { weightScale, type TransportPlan } from "./transportPlan";
import { workingArray, workingValues, releaseWorking } from "./physicalNumerics";

export interface CrustBudget {
  oceanCreated: number;
  oceanConsumed: number;
  continentalExported: number;
  oceanExported: number;
  continentalAdjustment: number;
  oceanAdjustment: number;
}
interface Columns {
  continental: Band;
  oceanic: Band;
  reserve: Band;
}
/** Columns as they arrive in a cell, with how much of the cell's area arrived as continent. */
interface Arrived extends Columns {
  land: Band;
}
export function initializeCrustColumns(map: PhysicalField) {
  if (map.CrustColumnsInitialized) return;
  for (let i = 0; i < map.mesh.count; i++)
    map.CrustContinentalColumn.set(
      i,
      (map.CrustThickness.get(i) * map.CrustContinentalFraction.get(i)) / 1000
    );
  map.CrustColumnsInitialized = true;
}
export function captureCrustColumns(map: PhysicalField): Columns {
  initializeCrustColumns(map);
  return {
    continental: map.coverage.copyBand(map.CrustContinentalColumn),
    oceanic: workingValues(map, "float64", "crust:oceanic", (i) =>
      Math.max(0, map.CrustThickness.get(i) - map.CrustContinentalColumn.get(i))
    ),
    reserve: map.coverage.copyBand(map.CrustRootReserve),
  };
}
function exported(map: PhysicalField, source: number, share: number, columns: Columns) {
  const area = map.mesh.area(source) / 1024;
  map.crustBudget.continentalExported +=
    (columns.continental.get(source) + columns.reserve.get(source)) * share * area;
  map.crustBudget.oceanExported += columns.oceanic.get(source) * share * area;
}
function accumulate(map: PhysicalField, plan: TransportPlan, old: Columns): Arrived {
  const result: Arrived = {
    continental: workingArray(map, "float64", "crust:continental"),
    oceanic: workingArray(map, "float64", "crust:oceanicArrival"),
    reserve: workingArray(map, "float64", "crust:reserve"),
    land: workingArray(map, "float64", "crust:landArrival"),
  };
  for (let source = 0; source < map.mesh.count; source++) {
    let retained = 0;
    const end = plan.offsets.get(source + 1),
      continental = old.continental.get(source),
      oceanic = old.oceanic.get(source),
      reserve = old.reserve.get(source),
      buoyant = continental >= oceanic;
    for (let offset = plan.offsets.get(source); offset < end; offset++) {
      const target = plan.targets.get(offset),
        share = plan.weights.get(offset) / weightScale;
      const weight = (share * map.mesh.area(source)) / map.mesh.area(target);
      result.continental.add(target, continental * weight);
      result.oceanic.add(target, oceanic * weight);
      result.reserve.add(target, reserve * weight);
      if (buoyant) result.land.add(target, weight);
      retained += share;
    }
    exported(map, source, Math.max(0, 1 - retained), old);
  }
  return result;
}
/** The share of oceanic crust going down a subduction zone that comes back up as a belt's crust. */
export const arcCrustYield = 0.5;
/**
 * What closing plates take out of a column, by what is closing. Continent floats, so only continent
 * meeting continent is shortened; where a continent rides up on ocean, the ocean goes down under it
 * and the continent keeps its area. Ocean meeting ocean loses what no longer fits.
 */
function closure(
  columns: Arrived,
  i: number,
  arrival: number,
  continental: number,
  oceanic: number
) {
  const land = columns.land.get(i),
    sea = arrival - land,
    room = Math.max(0, 1 - land);
  return {
    slab: sea > 0 ? oceanic - oceanic * Math.min(1, room / sea) : oceanic,
    squeezed: land > 1 ? continental - continental / land : 0,
  };
}
function retainColumn(map: PhysicalField, plan: TransportPlan, columns: Arrived, i: number) {
  let continental = columns.continental.get(i),
    oceanic = columns.oceanic.get(i);
  const arrival = plan.arrivals.get(i) / weightScale,
    area = map.mesh.area(i) / 1024;
  const fresh = Math.max(0, 1 - arrival) * units(1000);
  oceanic += fresh;
  map.crustBudget.oceanCreated += fresh * area;
  const total = continental + oceanic;
  const { slab, squeezed } =
    map.TectonicBoundaryCodes.get(i) === 1 && arrival > 1
      ? closure(columns, i, arrival, continental, oceanic)
      : { slab: 0, squeezed: 0 };
  const over = Math.max(0, total - slab - squeezed - units(maximumCrustThickness));
  const consumed = Math.min(oceanic, slab + over),
    shortened = squeezed + slab + over - consumed,
    // A slab going down melts and rises as new crust under the belt above it: what an arc builds on.
    arc = consumed * arcCrustYield,
    reserve = shortened + arc;
  oceanic -= consumed;
  continental -= shortened;
  map.crustBudget.oceanConsumed += consumed * area;
  map.crustBudget.continentalAdjustment += arc * area;
  map.OceanicSubduction.add(i, consumed);
  map.OceanicSubductionHistory.add(i, consumed);
  map.CrustRootReserve.set(i, columns.reserve.get(i) + reserve);
  map.ConvergentCrustSurplus.set(i, reserve);
  const basal = Math.max(0, units(minimumCrustThickness) - continental - oceanic);
  oceanic += basal;
  map.crustBudget.oceanCreated += basal * area;
  map.CrustContinentalColumn.set(i, continental);
  map.CrustThickness.set(i, continental + oceanic);
  map.CrustContinentalFraction.set(i, Math.round((continental / map.CrustThickness.get(i)) * 1000));
}
/** Continental material is conserved in columns and root reserves; oceanic sinks are explicit. */
export function transportCrustColumns(map: PhysicalField, plan: TransportPlan, old: Columns) {
  const columns = accumulate(map, plan, old);
  for (let i = 0; i < map.mesh.count; i++) retainColumn(map, plan, columns, i);
  releaseWorking(map, ...Object.values(columns));
}

/** Existing vertical column adjustments remain explicit until their process supplies material. */
export function adjustCrustColumn(map: PhysicalField, i: number, next: number) {
  if (map.CrustColumnsInitialized) {
    const delta = next - map.CrustThickness.get(i),
      continental = (delta * map.CrustContinentalFraction.get(i)) / 1000,
      area = map.mesh.area(i) / 1024;
    map.CrustContinentalColumn.add(i, continental);
    map.crustBudget.continentalAdjustment += continental * area;
    map.crustBudget.oceanAdjustment += (delta - continental) * area;
  }
  map.CrustThickness.set(i, next);
}
