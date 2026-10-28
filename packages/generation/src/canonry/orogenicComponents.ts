// OrogenicConstructionLayer component discovery, ranking and influence, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { round, toUnits } from "./math";
import { hashUnit } from "./noise";
import { metricSearch } from "./metricSearch";
import { meshDeltaX, meshPointX } from "./mesh";
import { CellQueue, type Band } from "@atlas/domain";
import { workingArray, releaseWorking } from "./physicalNumerics";

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
  distance: Band;
  source: Band;
  // +1 on the belt's hinterland, −1 on its foreland (see assignSides).
  side: Band;
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
    ids.set(i, component.id);
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
    // hpc-exempt: boundary component records, sorted once.
    .sort((a, b) => b.score - a.score || a.c.pair - b.c.pair);
  ranked.forEach(({ c }, rank) => {
    c.prominence = round(
      p.OrogenicProminenceMinimum +
        (p.OrogenicProminenceMaximum - p.OrogenicProminenceMinimum) *
          Math.exp(-rank / p.OrogenicProminenceRankDecay)
    );
  });
}
/** Signed across-strike offset (metres) of a cell from its source boundary cell. */
function acrossStrike(map: PhysicalField, i: number, source: number): number {
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
/**
 * A belt's hinterland is the side of its boundary that holds more continental mass: the
 * overriding plate of a subduction, the larger plate of a collision, where Tibet stands behind
 * the Himalaya. Cells there read +1, the foreland −1; boundary cells themselves count as interior.
 */
function assignSides(
  map: PhysicalField,
  components: BoundaryComponent[],
  source: Band,
  side: Band
) {
  const mass = new Float64Array(components.length);
  for (let i = 0; i < map.mesh.count; i++) {
    const id = map.OrogenicComponentIds.get(i),
      from = source.get(i);
    if (id < 0 || from < 0) continue;
    const offset = acrossStrike(map, i, from);
    if (offset !== 0)
      mass[id] +=
        Math.sign(offset) * (map.CrustContinentalFraction.get(i) / 1000) * map.mesh.area(i);
  }
  for (let i = 0; i < map.mesh.count; i++) {
    const id = map.OrogenicComponentIds.get(i),
      from = source.get(i);
    if (id < 0 || from < 0) continue;
    const offset = acrossStrike(map, i, from);
    side.set(i, offset === 0 ? 1 : Math.sign(offset) * (mass[id] < 0 ? -1 : 1));
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
    side = workingArray(map, "float64", "orogeny:side");
  function* seeds() {
    for (let i = 0; i < ids.length; i++) {
      const id = ids.get(i);
      if (id < 0 || components[id].area < context.Profile.OrogenicMinimumComponentArea) continue;
      map.OrogenicComponentIds.set(i, id);
      map.OrogenicSystemProminence.set(i, components[id].prominence);
      distance.set(i, 0);
      source.set(i, i);
      yield i;
    }
  }
  metricSearch(map.mesh, seeds(), distance, context.Profile.OrogenicInfluenceReach, (j, i) => {
    source.set(j, source.get(i));
    map.OrogenicComponentIds.set(j, map.OrogenicComponentIds.get(i));
    map.OrogenicSystemProminence.set(j, map.OrogenicSystemProminence.get(i));
  });
  assignSides(map, components, source, side);
  releaseWorking(map);
  return { distance, source, side };
}
