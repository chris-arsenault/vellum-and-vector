import { expect, it } from "vitest";
import { regionalDistricts } from "./regionalDistricts";
import { regionalSelectionArea, regionalScale } from "./regionalScale";
import { point, rectangle, spatial } from "./spatial";

it("offers roughly region-sized connected geography across an irregular landmass without changing its coast", () => {
  const target = regionalSelectionArea(1),
    land = spatial.difference(
      rectangle([0, 0, 1_400_000, 2_600_000]),
      rectangle([0, 900_000, 300_000, 1_500_000])
    )!,
    before = structuredClone(land),
    districts = regionalDistricts(land, target);
  expect(districts.length).toBeGreaterThanOrEqual(7);
  expect(districts.length).toBeLessThanOrEqual(15);
  const areas = districts.map((g) => spatial.area(g)).sort((a, b) => a - b);
  expect(areas[Math.floor(areas.length / 2)]).toBeGreaterThan(target / 2);
  expect(areas[Math.floor(areas.length / 2)]).toBeLessThan(target * 2);
  const combined = spatial.unionAll(districts);
  expect(spatial.difference(land, combined)).toBeNull();
  expect(spatial.difference(combined, land)).toBeNull();
  expect(districts.some((g) => spatial.covers(g, point({ x: 100_000, y: 1_200_000, z: 0 })))).toBe(
    false
  );
  expect(land).toEqual(before);
});

it("subdivides a normal parent region at the next fixed scale and responds to geographic centres", () => {
  const target = regionalSelectionArea(2),
    land = rectangle([0, 0, 700_000, 500_000]);
  const a = regionalDistricts(land, target, [{ x: 270_000, y: 250_000, z: 0 }]);
  const b = regionalDistricts(land, target, [{ x: 290_000, y: 255_000, z: 0 }]);
  expect(a.length).toBeGreaterThanOrEqual(8);
  expect(a.length).toBeLessThanOrEqual(15);
  expect(a).not.toEqual(b);
  const areas = a.map((g) => spatial.area(g)).sort((x, y) => x - y);
  const typicalCells = areas[Math.floor(areas.length / 2)] / regionalScale(2).cellArea;
  expect(typicalCells).toBeGreaterThan(30_000);
  expect(typicalCells).toBeLessThan(120_000);
  expect(spatial.area(spatial.unionAll(a))).toBeCloseTo(spatial.area(land), 1);
});

it("keeps suitably sized islands as geographic candidates rather than subdividing them again", () => {
  expect(regionalDistricts(rectangle([0, 0, 400_000, 400_000]), regionalSelectionArea(1))).toEqual(
    []
  );
});
