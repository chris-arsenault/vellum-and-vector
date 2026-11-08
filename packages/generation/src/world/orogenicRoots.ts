import type { PhysicalField } from "./field";
import { accrueRootReserve, spendRootReserve, retainRootReserve } from "../rock/groundWorld";
import type { PhysicalContext } from "./context";
import type { BoundaryComponent, OrogenicFrame } from "./orogenicComponents";
import {
  addContinentalRoot,
  adjustCrustColumn,
  arcCrustYield,
  initializeCrustColumns,
} from "../rock/crustTransport";
import { constructionWeight, crossSection } from "./orogenicShape";
import { crustHeight, crustFoundation, crustPerRock, units } from "./math";
import { smoothMetric } from "./metricSmoothing";
import { workingArray, workingValues, releaseWorking } from "./physicalNumerics";
import { MapScale } from "@atlas/domain";
export function addRoot(map: PhysicalField, cell: number, volume: number) {
  const before = MapScale.metres(map.CrustThickness.get(cell), "native"),
    fraction = map.CrustContinentalFraction.get(cell) / 1000,
    column = MapScale.inUnits(volume / map.mesh.area(cell), "native");
  addContinentalRoot(map, cell, column);
  const nextFraction = map.CrustContinentalColumn.get(cell) / map.CrustThickness.get(cell);
  return units(
    crustHeight(before + MapScale.metres(column, "native"), nextFraction, map.scale) -
      crustHeight(before, fraction, map.scale)
  );
}
function rootWeights(
  map: PhysicalField,
  context: PhysicalContext,
  components: BoundaryComponent[],
  frame: OrogenicFrame
) {
  // Per-component totals are a handful of records; per-cell measures are bands.
  const reserves = new Float64Array(components.length),
    totals = new Float64Array(components.length),
    weights = workingArray(map, "float64", "roots:weights");
  for (let i = 0; i < map.mesh.count; i++) {
    const id = map.OrogenicComponentIds.get(i);
    if (id < 0 || components[id].code !== 1) continue;
    const area = map.mesh.area(i);
    reserves[id] += MapScale.metres(map.CrustRootReserve.get(i), "native") * area;
    // A belt with a continent builds on it; one without builds an arc on the ocean crust it has.
    if (map.CrustContinentalFraction.get(i) < 350 && components[id].maximumContinental >= 0.35)
      continue;
    const section = crossSection(map, context, components[id], frame, i);
    const weight = constructionWeight(map, context, components[id], frame, i, section) * area;
    if (weight > 0) {
      weights.set(i, weight);
      totals[id] += weight;
    }
  }
  return { reserves, totals, weights };
}
/** Shortened continental columns feed roots; ranked relief cannot manufacture crust. */
export function distributeOrogenicRoots(
  map: PhysicalField,
  context: PhysicalContext,
  components: BoundaryComponent[],
  frame: OrogenicFrame
) {
  const { reserves, totals, weights } = rootWeights(map, context, components, frame),
    admitted = workingArray(map, "float64", "roots:admitted");
  for (let i = 0; i < map.mesh.count; i++) {
    const weight = weights.get(i),
      id = map.OrogenicComponentIds.get(i);
    if (weight <= 0 || reserves[id] <= 0) continue;
    const volume = (reserves[id] * weight) / totals[id];
    if (volume > 0) admitted.add(i, addRoot(map, i, volume));
  }
  for (let i = 0; i < map.mesh.count; i++) {
    const id = map.OrogenicComponentIds.get(i);
    if (id >= 0 && totals[id] > 0) retainRootReserve(map, i, 0);
  }
  settleStrandedRoots(map, components, context.Span);
  releaseWorking(map, weights);
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
    accrueRootReserve(
      map,
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
    const column = held * settled;
    if (column <= 0) continue;
    addRoot(map, i, MapScale.metres(column, "native") * map.mesh.area(i));
    spendRootReserve(map, i, column);
  }
}
/** Below this much continent a column is ocean crust, too stiff and thin for crust to flow through. */
const flowingFraction = 350;
/** Excess load in equivalent crust metres; surface rock can drive flow through a thin root. */
export function mobileCrust(
  column: number,
  surfaceRock: number,
  fraction: number,
  supported: number,
  ease: number,
  span: number,
  scale: MapScale
) {
  const over =
    column +
    Math.max(0, surfaceRock) * crustPerRock(fraction) -
    (crustFoundation(fraction, scale) + supported);
  if (over <= 0 || span <= 0) return 0;
  return Math.min(Math.max(0, column), over * (1 - (ease / (over + ease)) ** span));
}
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
      return continent.get(i)
        ? mobileCrust(
            MapScale.metres(map.CrustThickness.get(i), "native"),
            MapScale.metres(map.SurfaceRockLoad.get(i), "native"),
            map.CrustContinentalFraction.get(i) / 1000,
            squeezed(i) ? bears : 0,
            ease,
            context.Span,
            map.scale
          )
        : 0;
    }),
    // How far it spreads grows with the square root of how long it has, as anything spreading does.
    spread = smoothMetric(map, flowing, length * Math.sqrt(context.Span), continent);
  for (let i = 0; i < map.mesh.count; i++) {
    const change = spread.get(i) - flowing.get(i);
    if (change !== 0)
      adjustCrustColumn(
        map,
        i,
        units(Math.max(0, MapScale.metres(map.CrustThickness.get(i), "native") + change))
      );
  }
  releaseWorking(map, continent, flowing, spread);
}
