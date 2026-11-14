import type { PhysicalField } from "./field";
import { moveTectonicPoint } from "./tectonicMotion";
import type { Deformation } from "../rock/groundTransform";

interface SourceMotion {
  move(x: number, y: number): [number, number];
  deformation: Deformation;
}

/** One finite mechanical transform for sites, material cells and attached geometry. */
export function tectonicTransport(map: PhysicalField, distance: number) {
  const state = map.tectonics,
    plates = new Map(state?.plates.map((plate) => [plate.id, plate]));
  return (cell: number): SourceMotion => {
    const site = state?.sites[map.CrustProvinceIds.get(cell) - 1],
      plate = site && plates.get(site.plate);
    if (!plate) {
      const dx = (map.CrustMotionX.get(cell) * distance) / 1000,
        dy = (map.CrustMotionY.get(cell) * distance) / 1000;
      return { move: (x, y) => [x + dx, y + dy], deformation: [1, 0, 0, 1] };
    }
    // Derivative within this source's affine motion, holding its site and plate fixed.
    // A discontinuity between independently moving plates is contact, not strain in either bed.
    const angle = plate.spin * distance,
      a = Math.cos(angle),
      b = Math.sin(angle) - site.compliance * angle;
    return {
      move: (x, y) => moveTectonicPoint(map, site, plate, x, y, distance),
      deformation: [a, -b, b, a],
    };
  };
}
