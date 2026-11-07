import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import type { BoundaryComponent, OrogenicFrame } from "./orogenicComponents";
import {
  addContinentalRoot,
  adjustCrustColumn,
  arcCrustYield,
  initializeCrustColumns,
} from "./crustTransport";
import { constructionWeight, crossSection } from "./orogenicShape";
import { crustHeight, maximumCrustThickness, thickness, units } from "./math";
import { smoothMetric } from "./metricSmoothing";
import { workingArray, workingValues, releaseWorking } from "./physicalNumerics";
export function addRoot(map: PhysicalField, cell: number, volume: number) {
  const before = map.CrustThickness.get(cell) / 1024,
    fraction = map.CrustContinentalFraction.get(cell) / 1000,
    column = (volume * 1024) / map.mesh.area(cell);
  addContinentalRoot(map, cell, column);
  const nextFraction = map.CrustContinentalColumn.get(cell) / map.CrustThickness.get(cell);
  map.CrustContinentalFraction.set(cell, Math.round(nextFraction * 1000));
  return units(crustHeight(before + column / 1024, nextFraction) - crustHeight(before, fraction));
}
/** How much more crust a column can hold. Each pass's crust adds to what earlier passes left. */
const capacity = (map: PhysicalField, i: number) =>
  (Math.max(0, units(maximumCrustThickness) - map.CrustThickness.get(i)) * map.mesh.area(i)) / 1024;
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
    const room = capacity(map, i);
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
  settleStrandedRoots(map, components, context.Span);
  releaseWorking(map, weights, capacities, ratios);
  return admitted;
}
/**
 * A world's first forming stands in for all the drift before it, so its belts begin as later passes
 * do, with crust their plates have already shortened: as much as the boundary's strain took up of
 * that drift, stacked over a thrust sheet's width. What was going down as a slab comes back in part.
 */
export function pileUpEarlierShortening(map: PhysicalField, context: PhysicalContext) {
  const { OrogenicInitialShortening: drift, OrogenicSheetSpacing: width } = context.Profile;
  initializeCrustColumns(map);
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.TectonicBoundaryCodes.get(i) !== 1) continue;
    const continent = map.CrustContinentalFraction.get(i) / 1000,
      returned = continent + (1 - continent) * arcCrustYield;
    map.CrustRootReserve.add(
      i,
      (map.TectonicStrain.get(i) / 1000) * (drift / width) * map.CrustThickness.get(i) * returned
    );
  }
}
/** How much of the root crust a boundary has left behind is still unsettled after a unit of span. */
const unsettledPerSpan = 0.5;
/**
 * Plates carry root crust away from the belt that made it, to ground no convergent belt reaches.
 * Nothing will ever spend it there, so it settles where it lies and the old belt stands on its own
 * root, however thick that makes the crust.
 */
function settleStrandedRoots(map: PhysicalField, components: BoundaryComponent[], span: number) {
  const settled = 1 - unsettledPerSpan ** span;
  for (let i = 0; i < map.mesh.count; i++) {
    const id = map.OrogenicComponentIds.get(i),
      held = map.CrustRootReserve.get(i);
    if (held <= 0 || (id >= 0 && components[id].code === 1)) continue;
    const column = Math.min(
      held * settled,
      Math.max(0, units(maximumCrustThickness) - map.CrustThickness.get(i))
    );
    if (column <= 0) continue;
    addRoot(map, i, (column * map.mesh.area(i)) / 1024);
    map.CrustRootReserve.set(i, held - column);
  }
}
/** Below this much continent a column is ocean crust, too stiff and thin for crust to flow through. */
const flowingFraction = 350;
/**
 * Crust too thick to hold itself up flows outward under its own weight, so a long collision builds a
 * thick core and a high region that widens around it, and later ranges rise on that ground. Only the
 * column above what the crust can bear flows, and the thicker it stands the more of that goes. It bears
 * that much only while being squeezed: once a collision ends, an old belt's root has nothing holding
 * it up and settles out under the land around it, leaving broad raised ground where a range stood.
 */
export function crustFlow(
  map: PhysicalField,
  context: PhysicalContext,
  squeezed: (cell: number) => boolean = () => true
) {
  const { CrustFlowYield: bears, CrustFlowEase: ease, CrustFlowLength: length } = context.Profile,
    continent = workingValues(map, "uint8", "flow:continent", (i) =>
      map.CrustContinentalFraction.get(i) >= flowingFraction ? 1 : 0
    ),
    flowing = workingValues(map, "float64", "flow:flowing", (i) => {
      const fraction = map.CrustContinentalFraction.get(i) / 1000,
        over =
          map.CrustThickness.get(i) / 1024 - (1000 + 3000 * fraction + (squeezed(i) ? bears : 0));
      // The thicker it stands the faster it goes, and what stays after one span flows again in the next.
      return continent.get(i) && over > 0
        ? over * (1 - (1 - over / (over + ease)) ** context.Span)
        : 0;
    }),
    // How far it spreads grows with the square root of how long it has, as anything spreading does.
    spread = smoothMetric(map, flowing, length * Math.sqrt(context.Span), continent);
  for (let i = 0; i < map.mesh.count; i++) {
    const change = spread.get(i) - flowing.get(i);
    if (change !== 0)
      adjustCrustColumn(map, i, units(thickness(map.CrustThickness.get(i) / 1024 + change)));
  }
  releaseWorking(map, continent, flowing, spread);
}
