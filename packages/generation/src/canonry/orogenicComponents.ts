// OrogenicConstructionLayer component discovery, ranking and influence, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { round, toUnits } from "./math";
import { hashUnit } from "./noise";

export interface BoundaryComponent {
  id: number;
  code: number;
  pair: number;
  prominence: number;
  count: number;
  area: number;
  totalWeight: number;
  shortening: number;
  collision: number;
  suture: number;
  strain: number;
  continental: number;
  maximumContinental: number;
  x: number;
  y: number;
}
export interface OrogenicFrame {
  distance: Float64Array;
  source: Int32Array;
}
const active = (map: PhysicalField, i: number, minimum: number) =>
  map.TectonicBoundaryCodes[i] !== 0 && map.TectonicStrain[i] >= minimum;
function addCell(c: BoundaryComponent, map: PhysicalField, i: number) {
  c.count++;
  c.area += map.mesh.areas[i];
  c.collision += map.CrustCollisionIntensity[i];
  c.suture += map.CrustSutureStrength[i];
  c.strain += map.TectonicStrain[i];
  c.continental += map.CrustContinentalFraction[i];
  c.maximumContinental = Math.max(c.maximumContinental, map.CrustContinentalFraction[i] / 1000);
  c.shortening += toUnits(map.ConvergentCrustSurplus[i]) * map.mesh.areas[i];
  c.x += map.mesh.x[i];
  c.y += map.mesh.y[i];
}
function floodComponent(
  map: PhysicalField,
  context: PhysicalContext,
  ids: Int32Array,
  component: BoundaryComponent,
  start: number
) {
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    addCell(component, map, i);
    for (let edge = 0; edge < 3; edge++) {
      const j = map.mesh.neighbors[i * 3 + edge];
      if (
        j < 0 ||
        ids[j] >= 0 ||
        map.TectonicBoundaryCodes[j] !== component.code ||
        map.TectonicBoundaryPairIds[j] !== component.pair ||
        !active(map, j, context.Profile.OrogenicMinimumStrain)
      )
        continue;
      ids[j] = component.id;
      queue.push(j);
    }
  }
  component.collision /= component.count * 1000;
  component.suture /= component.count * 1000;
  component.strain /= component.count * 1000;
  component.continental /= component.count * 1000;
  component.x = round(component.x / component.count);
  component.y = round(component.y / component.count);
}
export function discoverComponents(
  map: PhysicalField,
  context: PhysicalContext,
  ids: Int32Array
): BoundaryComponent[] {
  const components: BoundaryComponent[] = [];
  for (let i = 0; i < map.mesh.count; i++) {
    if (ids[i] >= 0 || !active(map, i, context.Profile.OrogenicMinimumStrain)) continue;
    const component: BoundaryComponent = {
      id: components.length,
      code: map.TectonicBoundaryCodes[i],
      pair: map.TectonicBoundaryPairIds[i],
      prominence: 0,
      count: 0,
      area: 0,
      totalWeight: 0,
      shortening: 0,
      collision: 0,
      suture: 0,
      strain: 0,
      continental: 0,
      maximumContinental: 0,
      x: 0,
      y: 0,
    };
    components.push(component);
    ids[i] = component.id;
    floodComponent(map, context, ids, component, i);
  }
  return components;
}
function componentScore(c: BoundaryComponent, context: PhysicalContext) {
  const variation = hashUnit(context.EpochStableSeed ^ 0x35a7, c.pair, c.code);
  return (
    Math.log2(c.area / 100_000_000 + 1) *
    (0.7 + variation * 0.6) *
    (0.55 + c.strain) *
    (1 + Math.max(c.collision, c.suture) * 3.2) *
    (0.35 + c.continental + c.maximumContinental * 0.45)
  );
}
export function rankComponents(components: BoundaryComponent[], context: PhysicalContext) {
  const p = context.Profile;
  for (const component of components) component.prominence = p.OrogenicProminenceMinimum;
  const ranked = components
    .filter(
      (c) =>
        c.code === 1 && c.area >= p.OrogenicMinimumComponentArea && c.maximumContinental >= 0.35
    )
    .map((c) => ({ c, score: componentScore(c, context) }))
    .sort((a, b) => b.score - a.score || a.c.pair - b.c.pair);
  ranked.forEach(({ c }, rank) => {
    c.prominence = round(
      p.OrogenicProminenceMinimum +
        (p.OrogenicProminenceMaximum - p.OrogenicProminenceMinimum) *
          Math.exp(-rank / p.OrogenicProminenceRankDecay)
    );
  });
}
export function propagateInfluence(
  map: PhysicalField,
  context: PhysicalContext,
  components: BoundaryComponent[],
  ids: Int32Array
): OrogenicFrame {
  const distance = new Float64Array(map.mesh.count).fill(Infinity),
    source = new Int32Array(map.mesh.count).fill(-1);
  const queue: number[] = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (id < 0 || components[id].area < context.Profile.OrogenicMinimumComponentArea) continue;
    map.OrogenicComponentIds[i] = id;
    map.OrogenicSystemProminence[i] = components[id].prominence;
    distance[i] = 0;
    source[i] = i;
    queue.push(i);
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head],
      next = distance[i] + map.mesh.spacing;
    if (next > context.Profile.OrogenicInfluenceReach) continue;
    for (let edge = 0; edge < 3; edge++) {
      const j = map.mesh.neighbors[i * 3 + edge];
      if (j < 0 || distance[j] <= next) continue;
      distance[j] = next;
      source[j] = source[i];
      map.OrogenicComponentIds[j] = map.OrogenicComponentIds[i];
      map.OrogenicSystemProminence[j] = map.OrogenicSystemProminence[i];
      queue.push(j);
    }
  }
  return { distance, source };
}
