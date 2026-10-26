import type { PhysicalField } from "./field";
import { moveTectonicPoint } from "./tectonicMotion";

/** One finite mechanical transform for sites, material cells and attached geometry. */
export function tectonicTransport(map: PhysicalField, distance: number) {
  const state = map.tectonics;
  if (!state) return null;
  const plates = new Map(state.plates.map((plate) => [plate.id, plate]));
  return (cell: number, x: number, y: number): [number, number] => {
    const site = state.sites[map.CrustProvinceIds[cell] - 1],
      plate = site && plates.get(site.plate);
    if (!plate)
      return [
        x + (map.CrustMotionX[cell] * distance) / 1000,
        y + (map.CrustMotionY[cell] * distance) / 1000,
      ];
    return moveTectonicPoint(map, site, plate, x, y, distance);
  };
}
