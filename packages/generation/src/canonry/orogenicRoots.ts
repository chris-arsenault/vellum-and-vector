import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import type { BoundaryComponent, OrogenicFrame } from "./orogenicComponents";
import { constructionWeight } from "./orogenicShape";
import { clamp, crustHeight, maximumCrustThickness, units } from "./math";
import { workingArray, releaseWorking } from "./physicalNumerics";
import { radixOrder } from "@atlas/domain";
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
function rootCapacity(
  map: PhysicalField,
  context: PhysicalContext,
  components: BoundaryComponent[],
  frame: OrogenicFrame
) {
  const componentArray = (name: string) =>
    workingArray(map, "float64", `roots:${name}`, components.length);
  const reserves = componentArray("reserves"),
    totals = componentArray("totals"),
    weights = workingArray(map, "float64", "roots:weights"),
    capacities = workingArray(map, "float64", "roots:capacities"),
    ratios = workingArray(map, "float64", "roots:ratios").fill(Infinity);
  for (let i = 0; i < map.mesh.count; i++) {
    const id = map.OrogenicComponentIds[i];
    if (id < 0 || components[id].code !== 1) continue;
    reserves[id] += (map.CrustRootReserve[i] * map.mesh.areas[i]) / 1024;
    if (map.CrustContinentalFraction[i] < 350) continue;
    const weight = constructionWeight(map, context, components[id], frame, i) * map.mesh.areas[i];
    const room = capacity(map, context, components[id], i);
    if (weight > 0 && room > 0) {
      weights[i] = weight;
      capacities[i] = room;
      ratios[i] = room / weight;
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
  const order = radixOrder(ratios);
  for (const i of order) {
    if (!Number.isFinite(ratios[i])) break;
    const id = map.OrogenicComponentIds[i];
    if (remaining[id] <= 0) continue;
    const volume = Math.min(capacities[i], (remaining[id] * weights[i]) / totals[id]);
    if (volume > 0) admitted[i] += addRoot(map, i, volume);
    remaining[id] -= volume;
    totals[id] -= weights[i];
  }
  for (let i = 0; i < map.mesh.count; i++) {
    const id = map.OrogenicComponentIds[i];
    if (id >= 0 && reserves[id] > 0) map.CrustRootReserve[i] *= remaining[id] / reserves[id];
  }
  releaseWorking(map, reserves, remaining, totals, weights, capacities, ratios, order);
  return admitted;
}
