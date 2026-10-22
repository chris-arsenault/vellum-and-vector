import { expect, it } from "vitest";
import { createAdaptiveTopology, rectangle, spatial } from "@atlas/domain";
import { adaptivePhysicalMesh } from "./adaptiveMesh";
import { createField } from "./field";
import { prepareProvinceRegions, provinceAt } from "./provinceGeography";

function fixture(warp: number) {
  const box: [number, number, number, number] = [-2000, -1000, 2000, 1000];
  const map = createField(
    adaptivePhysicalMesh(
      createAdaptiveTopology(box, { maximumSize: 500, minimumSize: 500 }),
      rectangle(box)
    )
  );
  map.provinces = {
    origin: [...map.mesh.origin],
    seed: 17,
    scale: 1500,
    strength: warp,
    sites: [
      { x: -900, y: 0, priority: 0, assembly: 1, motionX: 0.4, motionY: 0 },
      { x: 900, y: 0, priority: 0, assembly: 2, motionX: -0.2, motionY: 0 },
      { x: 0, y: 700, priority: 0, assembly: 3, motionX: 0, motionY: 0.3 },
    ],
  };
  return { map, box };
}
it.each([0, 800])("partitions actual warped distance predicates with warp %s", (warp) => {
  const { map, box } = fixture(warp),
    regions = prepareProvinceRegions(map);
  expect(spatial.area(spatial.unionAll(regions.map((r) => r.footprint)))).toBeCloseTo(8_000_000, 1);
  for (let i = 0; i < regions.length; i++)
    for (let j = 0; j < i; j++)
      // Overlay vertices round to the shared micrometre precision.
      expect(spatial.intersectionArea(regions[i].footprint)(regions[j].footprint)).toBeLessThan(
        12_000 * spatial.precision
      );
  const cover = regions.map((r) => ({
    province: r.province,
    at: spatial.pointCoverage(r.footprint),
  }));
  for (let x = box[0] + 31; x < box[2]; x += 139)
    for (let y = box[1] + 17; y < box[3]; y += 127) {
      const expected = provinceAt(map.provinces!, x, y);
      // Polygonization approximates the analytic boundary to ten metres.
      if (
        [
          [x - 11, y],
          [x + 11, y],
          [x, y - 11],
          [x, y + 11],
        ].some(([a, b]) => provinceAt(map.provinces!, a, b) !== expected)
      )
        continue;
      expect(cover.find((r) => r.at({ x, y, z: 0 }))?.province).toBe(expected);
    }
});
