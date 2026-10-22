import { rectangle, spatial, transformGeometry } from "@atlas/domain";
import type { Geometry } from "geojson";
import type { PhysicalField } from "./field";
import { clamp, round } from "./math";
import { composedMaterialTransport } from "./composedMaterial";
import {
  prepareProvinceRegions,
  provinceAt,
  provinceBounds,
  type ProvincePartition,
} from "./provinceGeography";

type Position = [number, number];
export function provinceDisplacement(
  partition: ProvincePartition,
  province: number,
  step: number
): Position {
  const site = partition.sites[province];
  return [site.motionX, site.motionY].map(
    (v) => (round(clamp(v, -1, 1) * 1000) * step) / 1000
  ) as Position;
}
export function translateMaterial(geometry: Geometry, [x, y]: Position) {
  return transformGeometry(geometry, {
    origin: { x, y, z: 0 },
    rotation: 0,
    metresPerUnit: 1,
    floor: null,
  });
}
const transports = new WeakMap<
  PhysicalField,
  {
    partition: ProvincePartition;
    step: number;
    inherited: PhysicalField["inheritedMotion"];
    authored: PhysicalField["authoredMotion"];
    value: ReturnType<typeof buildProvinceTransport> | ReturnType<typeof composedMaterialTransport>;
  }
>();

function buildProvinceTransport(map: PhysicalField, step: number) {
  const partition = map.provinces!,
    bounds = provinceBounds(map),
    domain = rectangle(bounds);
  const donors = prepareProvinceRegions(map)
    .map((region) => ({ ...region, delta: provinceDisplacement(partition, region.province, step) }))
    .sort((a, b) => b.delta[0] - a.delta[0] || b.delta[1] - a.delta[1] || a.province - b.province);
  // Rigid translation has unit Jacobian. Equal arrival densities are resolved
  // lexicographically by source position, independent of mesh enumeration.
  let occupied: Geometry | null = null;
  const arrivals = donors.flatMap((donor) => {
    const moved = spatial.intersection(translateMaterial(donor.footprint, donor.delta), domain);
    if (!moved) return [];
    const winner = occupied ? spatial.difference(moved, occupied) : moved;
    occupied = occupied ? spatial.union(occupied, moved) : moved;
    return winner
      ? [
          {
            ...donor,
            source: translateMaterial(winner, [-donor.delta[0], -donor.delta[1]]),
          },
        ]
      : [];
  });
  const inside = ([x, y]: Position) =>
    x >= bounds[0] && x <= bounds[2] && y >= bounds[1] && y <= bounds[3];
  return {
    contributions: undefined as
      ((source: number) => { target: number; fraction: number }[]) | undefined,
    displacementAt(x: number, y: number): Position {
      return provinceDisplacement(partition, provinceAt(partition, x, y), step);
    },
    sourceAt(x: number, y: number): Position | null {
      if (!inside([x, y])) return null;
      for (const donor of donors) {
        const source: Position = [x - donor.delta[0], y - donor.delta[1]];
        if (inside(source) && provinceAt(partition, ...source) === donor.province) return source;
      }
      return null;
    },
    transport(geometry: Geometry): Geometry | null {
      const pieces: Geometry[] = [];
      for (const arrival of arrivals) {
        const source = spatial.intersection(geometry, arrival.source);
        if (!source) continue;
        pieces.push(translateMaterial(source, arrival.delta));
      }
      return pieces.length ? spatial.unionAll(pieces) : null;
    },
  };
}
/** Prepared once by plate advection, shared by history and geological geometry. */
export function provinceTransport(map: PhysicalField, step = map.LastPlateDriftStep) {
  if (!map.provinces) throw new Error("Material advection requires the causal province partition.");
  const previous = transports.get(map);
  if (
    previous?.partition === map.provinces &&
    previous.step === step &&
    previous.inherited === map.inheritedMotion &&
    previous.authored === map.authoredMotion
  )
    return previous.value;
  const value =
    map.inheritedMotion?.length || map.authoredMotion?.length
      ? composedMaterialTransport(map, step)
      : buildProvinceTransport(map, step);
  transports.set(map, {
    partition: map.provinces,
    step,
    inherited: map.inheritedMotion,
    authored: map.authoredMotion,
    value,
  });
  return value;
}
