import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import type { BoundaryComponent, OrogenicFrame } from "./orogenicComponents";
import { constructionWeight } from "./orogenicShape";
import { clamp, crustHeight, maximumCrustThickness, units } from "./math";

interface RootTarget {
  cell: number;
  weight: number;
  capacity: number;
}
function addRoot(map: PhysicalField, cell: number, volume: number) {
  const before = map.CrustThickness[cell] / 1024,
    fraction = map.CrustContinentalFraction[cell] / 1000,
    column = (volume * 1024) / map.mesh.areas[cell];
  map.CrustThickness[cell] += column;
  map.CrustContinentalColumn[cell] += column;
  const nextFraction = map.CrustContinentalColumn[cell] / map.CrustThickness[cell];
  map.CrustContinentalFraction[cell] = Math.round(nextFraction * 1000);
  return units(crustHeight(before + column / 1024, nextFraction) - crustHeight(before, fraction));
}
function capacity(
  map: PhysicalField,
  context: PhysicalContext,
  component: BoundaryComponent,
  i: number
) {
  const p = context.Profile,
    fraction = map.CrustContinentalFraction[i] / 1000;
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
  return (Math.max(0, maximum - map.CrustThickness[i]) * map.mesh.areas[i]) / 1024;
}
function allocate(
  map: PhysicalField,
  targets: RootTarget[],
  available: number,
  admitted: Float64Array
) {
  // Saturate small capacities first, then share the remaining volume by physical weight.
  targets.sort((a, b) => a.capacity / a.weight - b.capacity / b.weight || a.cell - b.cell);
  let remaining = available,
    weight = targets.reduce((sum, target) => sum + target.weight, 0);
  for (const target of targets) {
    const volume = Math.min(target.capacity, (remaining * target.weight) / weight);
    if (volume > 0) admitted[target.cell] += addRoot(map, target.cell, volume);
    remaining -= volume;
    weight -= target.weight;
  }
  return available - remaining;
}
/** Shortened continental columns feed roots; ranked relief cannot manufacture crust. */
export function distributeOrogenicRoots(
  map: PhysicalField,
  context: PhysicalContext,
  components: BoundaryComponent[],
  frame: OrogenicFrame
) {
  const reserves = new Float64Array(components.length),
    targets = components.map((): RootTarget[] => []),
    admitted = new Float64Array(map.mesh.count);
  for (let i = 0; i < map.mesh.count; i++) {
    const id = map.OrogenicComponentIds[i];
    if (id < 0 || components[id].code !== 1) continue;
    reserves[id] += (map.CrustRootReserve[i] * map.mesh.areas[i]) / 1024;
    if (map.CrustContinentalFraction[i] < 350) continue;
    const weight = constructionWeight(map, context, components[id], frame, i) * map.mesh.areas[i];
    const room = capacity(map, context, components[id], i);
    if (weight > 0 && room > 0) targets[id].push({ cell: i, weight, capacity: room });
  }
  const consumed = components.map((_, id) =>
    reserves[id] > 0 ? allocate(map, targets[id], reserves[id], admitted) / reserves[id] : 0
  );
  for (let i = 0; i < map.mesh.count; i++) {
    const id = map.OrogenicComponentIds[i];
    if (id >= 0) map.CrustRootReserve[i] *= 1 - consumed[id];
  }
  return admitted;
}
