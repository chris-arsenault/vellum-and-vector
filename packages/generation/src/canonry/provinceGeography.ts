import {
  rectangle,
  sampledFieldContour,
  spatial,
  type Bounds,
  type SampleEnclosure,
  type ProvincePartition,
} from "@atlas/domain";
import type { Geometry } from "geojson";
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import type { ProvinceSite } from "./provinceSites";
import { fractalNoiseField } from "./noiseField";
import type { CausalScalar } from "./causalRegions";
import { clamp, round } from "./math";

export type { ProvincePartition } from "@atlas/domain";
const noises = new WeakMap<ProvincePartition, ReturnType<typeof fractalNoiseField>[]>();
function partitionNoise(partition: ProvincePartition) {
  let fields = noises.get(partition);
  if (!fields) {
    fields = [0x16f1, 0x62bd].map((salt) =>
      fractalNoiseField(partition.origin, partition.seed ^ salt, partition.scale, 3)
    );
    noises.set(partition, fields);
  }
  return fields;
}
export function defineProvincePartition(
  map: PhysicalField,
  c: PhysicalContext,
  sites: ProvinceSite[]
) {
  // A new causal province process replaces inherited generated motion. Authored
  // overrides remain separate and are composed over the newly evolved base.
  map.inheritedMotion = undefined;
  map.provinces = {
    origin: [...map.mesh.origin],
    sites,
    seed: c.Seed,
    scale: c.Profile.ContinentalWarpScale,
    strength: c.Profile.ContinentalWarpStrength,
  };
}
export function provinceAt(partition: ProvincePartition, x: number, y: number) {
  const noise = partitionNoise(partition),
    dx = noise[0](x, y) * partition.strength,
    dy = noise[1](x, y) * partition.strength;
  x -= partition.origin[0];
  y -= partition.origin[1];
  const wx = x + dx,
    wy = y + dy;
  let best = -1,
    distance = Infinity;
  partition.sites.forEach((site, i) => {
    const d = (site.x - wx) ** 2 + (site.y - wy) ** 2;
    if (d < distance) {
      distance = d;
      best = i;
    }
  });
  return best;
}
function provinceMargin(
  partition: ProvincePartition,
  first: number,
  last: number,
  noise: CausalScalar[]
): CausalScalar {
  const a = partition.sites[first],
    b = partition.sites[last],
    length = Math.hypot(b.x - a.x, b.y - a.y);
  const nx = (b.x - a.x) / length,
    ny = (b.y - a.y) / length,
    offset = (a.x * a.x + a.y * a.y - b.x * b.x - b.y * b.y) / (2 * length);
  const at: CausalScalar = (x, y) =>
    nx * (x - partition.origin[0] + noise[0](x, y) * partition.strength) +
    ny * (y - partition.origin[1] + noise[1](x, y) * partition.strength) +
    offset;
  const add = (target: [number, number], source: [number, number], factor: number) => {
    target[0] += Math.min(source[0] * factor, source[1] * factor);
    target[1] += Math.max(source[0] * factor, source[1] * factor);
  };
  at.enclose = (box) => {
    const e: SampleEnclosure = {
      range: [offset, offset],
      gradient: [
        [nx, nx],
        [ny, ny],
      ],
    };
    add(e.range, [box[0] - partition.origin[0], box[2] - partition.origin[0]], nx);
    add(e.range, [box[1] - partition.origin[1], box[3] - partition.origin[1]], ny);
    noise.forEach((field, i) => {
      const bounds = field.enclose!(box),
        factor = [nx, ny][i] * partition.strength;
      add(e.range, bounds.range, factor);
      add(e.gradient[0], bounds.gradient[0], factor);
      add(e.gradient[1], bounds.gradient[1], factor);
    });
    return e;
  };
  return at;
}
function positiveContour(box: Bounds, field: CausalScalar) {
  const [x0, y0, x1, y1] = box,
    a: [number, number, number] = [x0, y0, 0],
    b: [number, number, number] = [x1, y0, 0],
    c: [number, number, number] = [x1, y1, 0],
    d: [number, number, number] = [x0, y1, 0];
  return sampledFieldContour(
    [
      [a, b, c],
      [a, c, d],
    ],
    field,
    0,
    [
      [a, b],
      [b, c],
      [c, d],
      [d, a],
    ],
    10,
    field.enclose
  );
}
export function provinceBounds(map: PhysicalField): Bounds {
  if (map.mesh.topology) return map.mesh.topology.bounds;
  const b: Bounds = [Infinity, Infinity, -Infinity, -Infinity],
    mesh = map.mesh;
  for (let i = 0; i < mesh.count; i++) {
    b[0] = Math.min(b[0], mesh.x[i] + mesh.origin[0] - mesh.spacing);
    b[1] = Math.min(b[1], mesh.y[i] + mesh.origin[1] - mesh.spacing);
    b[2] = Math.max(b[2], mesh.x[i] + mesh.origin[0] + mesh.spacing);
    b[3] = Math.max(b[3], mesh.y[i] + mesh.origin[1] + mesh.spacing);
  }
  return b;
}
/** Split actual distance predicates so every shared province boundary has one
 * polygonal representation. Neither native province IDs nor their masks enter. */
export function prepareProvinceRegions(map: PhysicalField) {
  const partition = map.provinces;
  if (!partition)
    throw new Error("Tectonic provinces must define material motion before advection.");
  partition.fields ??= {
    province: partition.sites.map((_, i) => i + 1),
    crustMotionX: partition.sites.map((site) => round(clamp(site.motionX, -1, 1) * 1000) / 1000),
    crustMotionY: partition.sites.map((site) => round(clamp(site.motionY, -1, 1) * 1000) / 1000),
  };
  if (partition.regions) return partition.regions;
  const noise = partitionNoise(partition);
  let regions = [{ province: 0, footprint: rectangle(provinceBounds(map)) }];
  for (let province = 1; province < partition.sites.length; province++) {
    const incoming: Geometry[] = [],
      next: typeof regions = [];
    for (const region of regions) {
      const field = provinceMargin(partition, region.province, province, noise),
        bounds = spatial.bounds(region.footprint),
        range = field.enclose!(bounds).range;
      if (range[1] <= 0) {
        next.push(region);
        continue;
      }
      const candidate = range[0] >= 0 ? region.footprint : positiveContour(bounds, field);
      const occupied = candidate && spatial.intersection(region.footprint, candidate);
      if (!occupied) {
        next.push(region);
        continue;
      }
      incoming.push(occupied);
      const rest = spatial.difference(region.footprint, occupied);
      if (rest) next.push({ ...region, footprint: rest });
    }
    if (incoming.length) next.push({ province, footprint: spatial.unionAll(incoming) });
    regions = next;
  }
  partition.regions = regions;
  return regions;
}
