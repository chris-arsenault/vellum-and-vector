import type { PhysicalField } from "./field";
import type { NumericalVector } from "@atlas/domain";
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
  continental: NumericalVector;
  oceanic: NumericalVector;
  reserve: NumericalVector;
}
export function captureCrustColumns(map: PhysicalField): Columns {
  if (!map.CrustColumnsInitialized) {
    for (let i = 0; i < map.mesh.count; i++)
      map.CrustContinentalColumn[i] =
        (map.CrustThickness[i] * map.CrustContinentalFraction[i]) / 1000;
    map.CrustColumnsInitialized = true;
  }
  return {
    continental: map.CrustContinentalColumn.slice(),
    oceanic: workingValues(map, "float64", "crust:oceanic", (i) =>
      Math.max(0, map.CrustThickness[i] - map.CrustContinentalColumn[i])
    ),
    reserve: map.CrustRootReserve.slice(),
  };
}
function exported(map: PhysicalField, source: number, share: number, columns: Columns) {
  const area = map.mesh.areas[source] / 1024;
  map.crustBudget.continentalExported +=
    (columns.continental[source] + columns.reserve[source]) * share * area;
  map.crustBudget.oceanExported += columns.oceanic[source] * share * area;
}
function accumulate(map: PhysicalField, plan: TransportPlan, old: Columns): Columns {
  const result: Columns = {
    continental: workingArray(map, "float64", "crust:continental"),
    oceanic: workingArray(map, "float64", "crust:oceanicArrival"),
    reserve: workingArray(map, "float64", "crust:reserve"),
  };
  for (let source = 0; source < map.mesh.count; source++) {
    let retained = 0;
    for (let offset = plan.offsets[source]; offset < plan.offsets[source + 1]; offset++) {
      const target = plan.targets[offset],
        share = plan.weights[offset] / weightScale;
      const weight = (share * map.mesh.areas[source]) / map.mesh.areas[target];
      result.continental[target] += old.continental[source] * weight;
      result.oceanic[target] += old.oceanic[source] * weight;
      result.reserve[target] += old.reserve[source] * weight;
      retained += share;
    }
    exported(map, source, Math.max(0, 1 - retained), old);
  }
  return result;
}
function retainColumn(map: PhysicalField, plan: TransportPlan, columns: Columns, i: number) {
  let continental = columns.continental[i],
    oceanic = columns.oceanic[i];
  const arrival = plan.arrivals[i] / weightScale,
    area = map.mesh.areas[i] / 1024;
  const fresh = Math.max(0, 1 - arrival) * units(1000);
  oceanic += fresh;
  map.crustBudget.oceanCreated += fresh * area;
  const total = continental + oceanic;
  const convergence =
    map.TectonicBoundaryCodes[i] === 1 && arrival > 1 ? total - total / arrival : 0;
  const excess = Math.max(convergence, total - units(maximumCrustThickness), 0);
  const consumed = Math.min(oceanic, excess),
    reserve = excess - consumed;
  oceanic -= consumed;
  continental -= reserve;
  map.crustBudget.oceanConsumed += consumed * area;
  map.OceanicSubduction[i] += consumed;
  map.OceanicSubductionHistory[i] += consumed;
  map.CrustRootReserve[i] = columns.reserve[i] + reserve;
  map.ConvergentCrustSurplus[i] = reserve;
  const basal = Math.max(0, units(minimumCrustThickness) - continental - oceanic);
  oceanic += basal;
  map.crustBudget.oceanCreated += basal * area;
  map.CrustContinentalColumn[i] = continental;
  map.CrustThickness[i] = continental + oceanic;
  map.CrustContinentalFraction[i] = Math.round((continental / map.CrustThickness[i]) * 1000);
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
    const delta = next - map.CrustThickness[i],
      continental = (delta * map.CrustContinentalFraction[i]) / 1000,
      area = map.mesh.areas[i] / 1024;
    map.CrustContinentalColumn[i] += continental;
    map.crustBudget.continentalAdjustment += continental * area;
    map.crustBudget.oceanAdjustment += (delta - continental) * area;
  }
  map.CrustThickness[i] = next;
}
