import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import type { BoundaryComponent, OrogenicFrame } from "./orogenicComponents";
import { constructionWeight, crossSection, orogenicCrestSection } from "./orogenicShape";
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
/** How much of a belt's root budget any ground in its sheets can take. */
const sheetRootShare = 0.5;
function capacity(
  map: PhysicalField,
  context: PhysicalContext,
  component: BoundaryComponent,
  i: number,
  section: number
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
  // A root stands as deep as the sheet above it was stacked, and shortening thickens the whole of a
  // sheet, so ground in a belt's sheets can always take some, wherever on the sheet it lies.
  const stacked = clamp(section / orogenicCrestSection, 0, 1),
    shaped = root * (map.ThrustSheetIndex.get(i) > 0 ? Math.max(sheetRootShare, stacked) : stacked);
  const maximum = units(Math.min(maximumCrustThickness, 1000 + 3000 * fraction + shaped));
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
    // A belt with a continent builds on it; one without builds an arc on the ocean crust it has.
    if (map.CrustContinentalFraction.get(i) < 350 && components[id].maximumContinental >= 0.35)
      continue;
    const section = crossSection(map, context, components[id], frame, i);
    const weight = constructionWeight(map, context, components[id], frame, i, section) * area;
    const room = capacity(map, context, components[id], i, section);
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
  settleStrandedRoots(map, context, components);
  releaseWorking(map, weights, capacities, ratios);
  return admitted;
}
/** How much of the root crust a boundary has left behind settles on each pass. */
const settledPerPass = 0.5;
/**
 * Plates carry root crust away from the belt that made it, to ground no convergent belt reaches.
 * Nothing will ever spend it there, so it settles where it lies, as far as the crust has room, and
 * the old belt stands on its own root.
 */
function settleStrandedRoots(
  map: PhysicalField,
  context: PhysicalContext,
  components: BoundaryComponent[]
) {
  const budget = context.Profile.OrogenicRootBudgetMinimum;
  for (let i = 0; i < map.mesh.count; i++) {
    const id = map.OrogenicComponentIds.get(i),
      held = map.CrustRootReserve.get(i);
    if (held <= 0 || (id >= 0 && components[id].code === 1)) continue;
    const fraction = map.CrustContinentalFraction.get(i) / 1000,
      maximum = units(Math.min(maximumCrustThickness, 1000 + 3000 * fraction + budget)),
      column = Math.min(held * settledPerPass, Math.max(0, maximum - map.CrustThickness.get(i)));
    if (column <= 0) continue;
    addRoot(map, i, (column * map.mesh.area(i)) / 1024);
    map.CrustRootReserve.set(i, held - column);
  }
}
