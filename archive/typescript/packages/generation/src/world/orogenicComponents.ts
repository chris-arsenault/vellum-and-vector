// OrogenicConstructionLayer component discovery, ranking and influence, Canonry 0f62584c.
import { crustForming, type PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { round, toUnits } from "./math";
import { metricSearch } from "./metricSearch";
import { physicalDistance } from "./physicalMetric";
import { meshDeltaX, meshPointX } from "./mesh";
import { CellQueue, type Band } from "@atlas/domain";
import { releaseWorking, workingArray, workingValues } from "./physicalNumerics";
import { groundOf } from "../rock/ground";
import { averageGroundQuery } from "../rock/groundQuery";
import { compileMix, materialGives } from "../rock/modes";

export interface BoundaryComponent {
  id: number;
  code: number;
  pair: number;
  count: number;
  area: number;
  totalWeight: number;
  shortening: number;
  collision: number;
  suture: number;
  strain: number;
  continental: number;
  maximumContinental: number;
  /** The outermost thrust sheet this belt has reached, or -1 before it has any. */
  frontSheet: number;
  /** A seed for what is fixed about this belt from its first pass on. */
  salt: number;
  x: number;
  y: number;
}
export interface OrogenicFrame {
  /** Accumulated shortening work through the intervening material, in baseline-rock metres. */
  distance: Band;
  source: Band;
  /** Physical distance from the current belt contact. */
  reach: Band;
  /** How much of a cell a sheet's leading edge rode over on this pass, in [0, 1]. */
  overlap: Band;
}
const active = (map: PhysicalField, i: number, minimum: number) =>
  map.TectonicBoundaryCodes.get(i) !== 0 && map.TectonicStrain.get(i) >= minimum;
function addCell(c: BoundaryComponent, map: PhysicalField, i: number, origin: number) {
  const area = map.mesh.area(i),
    fraction = map.CrustContinentalFraction.get(i);
  c.count++;
  c.area += area;
  c.collision += map.CrustCollisionIntensity.get(i) * area;
  c.suture += map.CrustSutureStrength.get(i) * area;
  c.strain += map.TectonicStrain.get(i) * area;
  c.continental += fraction * area;
  c.maximumContinental = Math.max(c.maximumContinental, fraction / 1000);
  c.shortening += toUnits(map.ConvergentCrustSurplus.get(i)) * area;
  c.x += (origin + meshDeltaX(map.mesh, map.mesh.x(i) - origin)) * area;
  c.y += map.mesh.y(i) * area;
}
function floodComponent(
  map: PhysicalField,
  context: PhysicalContext,
  ids: Band,
  component: BoundaryComponent,
  start: number
) {
  const queue = new CellQueue();
  queue.push(start);
  for (let i = queue.shift(); i >= 0; i = queue.shift()) {
    addCell(component, map, i, map.mesh.x(start));
    for (let edge = 0; edge < map.mesh.degree(i); edge++) {
      const j = map.mesh.neighbor(i, edge);
      if (
        j < 0 ||
        ids.get(j) >= 0 ||
        map.TectonicBoundaryCodes.get(j) !== component.code ||
        map.TectonicBoundaryPairIds.get(j) !== component.pair ||
        !active(map, j, context.Profile.OrogenicMinimumStrain)
      )
        continue;
      ids.set(j, component.id);
      queue.push(j);
    }
  }
  component.collision /= component.area * 1000;
  component.suture /= component.area * 1000;
  component.strain /= component.area * 1000;
  component.continental /= component.area * 1000;
  component.x = meshPointX(map.mesh, round(component.x / component.area));
  component.y = round(component.y / component.area);
}
export function discoverComponents(
  map: PhysicalField,
  context: PhysicalContext,
  ids: Band
): BoundaryComponent[] {
  const components: BoundaryComponent[] = [];
  for (let i = 0; i < map.mesh.count; i++) {
    if (ids.get(i) >= 0 || !active(map, i, context.Profile.OrogenicMinimumStrain)) continue;
    const component: BoundaryComponent = {
      id: components.length,
      code: map.TectonicBoundaryCodes.get(i),
      pair: map.TectonicBoundaryPairIds.get(i),
      count: 0,
      area: 0,
      totalWeight: 0,
      shortening: 0,
      collision: 0,
      suture: 0,
      strain: 0,
      continental: 0,
      maximumContinental: 0,
      frontSheet: -1,
      salt: context.EpochStableSeed ^ map.TectonicBoundaryPairIds.get(i),
      x: 0,
      y: 0,
    };
    components.push(component);
    ids.set(i, component.id);
    floodComponent(map, context, ids, component, i);
  }
  return components;
}
/** Signed across-strike offset (metres) of a cell from its source boundary cell. */
export function acrossStrike(map: PhysicalField, i: number, source: number): number {
  let tx = map.TectonicTangentX.get(source) / 1000,
    ty = map.TectonicTangentY.get(source) / 1000;
  if (Math.abs(tx) + Math.abs(ty) < 0.01) {
    tx = 1;
    ty = 0;
  }
  return (
    -meshDeltaX(map.mesh, map.mesh.x(i) - map.mesh.x(source)) * ty +
    (map.mesh.y(i) - map.mesh.y(source)) * tx
  );
}
const shear = compileMix({ shear: 1 });
const yielding = averageGroundQuery({
  start: 0,
  throughColumn: true,
  rock: (weakest, { material }) => Math.max(weakest, materialGives(shear, material)),
});
/** Shortening work increases with resistance and the standing wedge it must move. */
export const deformationCost = (distance: number, response: number, load: number) =>
  response > 0 ? (distance * (1 + Math.max(0, load))) / response : Infinity;
function retainReached(
  map: PhysicalField,
  context: PhysicalContext,
  components: BoundaryComponent[],
  distance: Band
) {
  const fronts = new Float64Array(components.length),
    drift = crustForming(map) ? context.Profile.OrogenicInitialShortening : map.LastPlateDriftStep;
  for (let i = 0; i < map.mesh.count; i++) {
    const id = map.OrogenicComponentIds.get(i);
    if (id >= 0 && map.ThrustPairIds.get(i) === components[id].pair + 1)
      fronts[id] = Math.max(fronts[id], distance.get(i));
  }
  for (let i = 0; i < map.mesh.count; i++) {
    const id = map.OrogenicComponentIds.get(i);
    if (id < 0) continue;
    const budget =
      fronts[id] + components[id].strain * drift * context.Profile.OrogenicAccretionRatio;
    if (distance.get(i) > budget) map.OrogenicComponentIds.set(i, -1);
  }
}
export function propagateInfluence(
  map: PhysicalField,
  context: PhysicalContext,
  components: BoundaryComponent[],
  ids: Band
): OrogenicFrame {
  const distance = workingArray(map, "float64", "orogeny:distance").fill(Infinity),
    source = workingArray(map, "int32", "orogeny:source").fill(-1),
    reach = workingArray(map, "float64", "orogeny:reach").fill(0),
    ground = groundOf(map),
    resistance = workingValues(map, "float64", "orogeny:resistance", (i) =>
      deformationCost(
        1,
        ground.fold(i, yielding),
        map.CrustThickness.get(i) > 0 ? map.SurfaceRockLoad.get(i) / map.CrustThickness.get(i) : 0
      )
    );
  function* seeds() {
    for (let i = 0; i < ids.length; i++) {
      const id = ids.get(i);
      if (
        id < 0 ||
        components[id].code !== 1 ||
        components[id].area < context.Profile.OrogenicMinimumComponentArea
      )
        continue;
      map.OrogenicComponentIds.set(i, id);
      distance.set(i, 0);
      source.set(i, i);
      yield i;
    }
  }
  metricSearch(
    map.mesh,
    seeds(),
    distance,
    Infinity,
    (j, i) => {
      source.set(j, source.get(i));
      map.OrogenicComponentIds.set(j, map.OrogenicComponentIds.get(i));
      reach.set(j, reach.get(i) + physicalDistance(map.mesh, i, j));
    },
    (i, j, edge) => (map.mesh.edgeLength(i, edge) * (resistance.get(i) + resistance.get(j))) / 2
  );
  retainReached(map, context, components, distance);
  releaseWorking(map, resistance);
  const overlap = workingArray(map, "float64", "orogeny:overlap").fill(0);
  return { distance, source, reach, overlap };
}
