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
export function captureCrustColumns(map: PhysicalField): Columns {
  if (!map.CrustColumnsInitialized) {
    for (let i = 0; i < map.mesh.count; i++)
      map.CrustContinentalColumn.set(
        i,
        (map.CrustThickness.get(i) * map.CrustContinentalFraction.get(i)) / 1000
      );
    map.CrustColumnsInitialized = true;
  }
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
function accumulate(map: PhysicalField, plan: TransportPlan, old: Columns): Columns {
  const result: Columns = {
    continental: workingArray(map, "float64", "crust:continental"),
    oceanic: workingArray(map, "float64", "crust:oceanicArrival"),
    reserve: workingArray(map, "float64", "crust:reserve"),
  };
  for (let source = 0; source < map.mesh.count; source++) {
    let retained = 0;
    const end = plan.offsets.get(source + 1),
      continental = old.continental.get(source),
      oceanic = old.oceanic.get(source),
      reserve = old.reserve.get(source);
    for (let offset = plan.offsets.get(source); offset < end; offset++) {
      const target = plan.targets.get(offset),
        share = plan.weights.get(offset) / weightScale;
      const weight = (share * map.mesh.area(source)) / map.mesh.area(target);
      result.continental.add(target, continental * weight);
      result.oceanic.add(target, oceanic * weight);
      result.reserve.add(target, reserve * weight);
      retained += share;
    }
    exported(map, source, Math.max(0, 1 - retained), old);
  }
  return result;
}
function retainColumn(map: PhysicalField, plan: TransportPlan, columns: Columns, i: number) {
  let continental = columns.continental.get(i),
    oceanic = columns.oceanic.get(i);
  const arrival = plan.arrivals.get(i) / weightScale,
    area = map.mesh.area(i) / 1024;
  const fresh = Math.max(0, 1 - arrival) * units(1000);
  oceanic += fresh;
  map.crustBudget.oceanCreated += fresh * area;
  const total = continental + oceanic;
  const convergence =
    map.TectonicBoundaryCodes.get(i) === 1 && arrival > 1 ? total - total / arrival : 0;
  const excess = Math.max(convergence, total - units(maximumCrustThickness), 0);
  const consumed = Math.min(oceanic, excess),
    reserve = excess - consumed;
  oceanic -= consumed;
  continental -= reserve;
  map.crustBudget.oceanConsumed += consumed * area;
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
