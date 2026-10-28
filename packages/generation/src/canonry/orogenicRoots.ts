import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import type { BoundaryComponent, OrogenicFrame } from "./orogenicComponents";
import { constructionWeight } from "./orogenicShape";
import { clamp, crustHeight, maximumCrustThickness, units } from "./math";
import { workingArray, releaseWorking } from "./physicalNumerics";
function addRoot(map: PhysicalField, cell: number, volume: number) {
  const before = map.CrustThickness.get(cell) / 1024,
    fraction = map.CrustContinentalFraction.get(cell) / 1000,
    column = (volume * 1024) / map.mesh.area(cell);
  map.CrustThickness.add(cell, column);
  map.CrustContinentalColumn.add(cell, column);
  const nextFraction = map.CrustContinentalColumn.get(cell) / map.CrustThickness.get(cell);
  map.CrustContinentalFraction.set(cell, Math.round(nextFraction * 1000));
  return units(crustHeight(before + column / 1024, nextFraction) - crustHeight(before, fraction));
}
function capacity(
  map: PhysicalField,
  context: PhysicalContext,
  component: BoundaryComponent,
  i: number
) {
  const p = context.Profile,
    fraction = map.CrustContinentalFraction.get(i) / 1000;
  const rank = clamp(
    (component.prominence - p.OrogenicProminenceMinimum) /
      Math.max(1, p.OrogenicProminenceMaximum - p.OrogenicProminenceMinimum),
    0,
    1
  );
  const root =
    p.OrogenicRootBudgetMinimum +
    rank * (p.OrogenicRootBudgetMaximum - p.OrogenicRootBudgetMinimum);
  const maximum = units(Math.min(maximumCrustThickness, 1000 + 3000 * fraction + root));
  return (Math.max(0, maximum - map.CrustThickness.get(i)) * map.mesh.area(i)) / 1024;
}
function rootCapacity(
  map: PhysicalField,
  context: PhysicalContext,
  components: BoundaryComponent[],
  frame: OrogenicFrame
) {
  // Per-component totals are a handful of records; per-cell measures are bands.
  const reserves = new Float64Array(components.length),
    totals = new Float64Array(components.length),
    weights = workingArray(map, "float64", "roots:weights"),
    capacities = workingArray(map, "float64", "roots:capacities"),
    ratios = workingArray(map, "float64", "roots:ratios").fill(Infinity);
  for (let i = 0; i < map.mesh.count; i++) {
    const id = map.OrogenicComponentIds.get(i);
    if (id < 0 || components[id].code !== 1) continue;
    const area = map.mesh.area(i);
    reserves[id] += (map.CrustRootReserve.get(i) * area) / 1024;
    if (map.CrustContinentalFraction.get(i) < 350) continue;
    const weight = constructionWeight(map, context, components[id], frame, i) * area;
    const room = capacity(map, context, components[id], i);
    if (weight > 0 && room > 0) {
      weights.set(i, weight);
      capacities.set(i, room);
      ratios.set(i, room / weight);
      totals[id] += weight;
    }
  }
  return { reserves, totals, weights, capacities, ratios };
}
/** Shortened continental columns feed roots; ranked relief cannot manufacture crust. */
export function distributeOrogenicRoots(
  map: PhysicalField,
  context: PhysicalContext,
  components: BoundaryComponent[],
  frame: OrogenicFrame
) {
  const { reserves, totals, weights, capacities, ratios } = rootCapacity(
      map,
      context,
      components,
      frame
    ),
    remaining = reserves.slice(),
    admitted = workingArray(map, "float64", "roots:admitted");
  // One external order preserves the capacity order within every independent belt.
  for (const i of map.coverage.order(ratios)) {
    if (!Number.isFinite(ratios.get(i))) break;
    const id = map.OrogenicComponentIds.get(i);
    if (remaining[id] <= 0) continue;
    const weight = weights.get(i);
    const volume = Math.min(capacities.get(i), (remaining[id] * weight) / totals[id]);
    if (volume > 0) admitted.add(i, addRoot(map, i, volume));
    remaining[id] -= volume;
    totals[id] -= weight;
  }
  for (let i = 0; i < map.mesh.count; i++) {
    const id = map.OrogenicComponentIds.get(i);
    if (id >= 0 && reserves[id] > 0)
      map.CrustRootReserve.set(i, (map.CrustRootReserve.get(i) * remaining[id]) / reserves[id]);
  }
  releaseWorking(map, weights, capacities, ratios);
  return admitted;
}
