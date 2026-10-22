import { expect, it } from "vitest";
import { createAdaptiveTopology, rectangle, spatial } from "@atlas/domain";
import { adaptivePhysicalMesh } from "./adaptiveMesh";
import { createField } from "./field";
import { provinceTransport } from "./provinceTransport";

function fixture(left: number, right: number) {
  const bounds: [number, number, number, number] = [-1000, -500, 1000, 500];
  const map = createField(
    adaptivePhysicalMesh(
      createAdaptiveTopology(bounds, { maximumSize: 100, minimumSize: 100 }),
      rectangle(bounds)
    )
  );
  map.provinces = {
    origin: [...map.mesh.origin],
    seed: 17,
    scale: 1000,
    strength: 0,
    sites: [
      { x: -500, y: 0, priority: 0, assembly: 1, motionX: left, motionY: 0 },
      { x: 500, y: 0, priority: 0, assembly: 2, motionX: right, motionY: 0 },
    ],
  };
  return map;
}
it("retains holes and rigidly separates material across a diverging boundary", () => {
  const transport = provinceTransport(fixture(-1, 1), 100);
  const ring = spatial.difference(
    rectangle([-300, -300, 300, 300]),
    rectangle([-50, -50, 50, 50])
  )!;
  const moved = transport.transport(ring)!;
  expect(spatial.area(moved)).toBeCloseTo(spatial.area(ring), 5);
  const covers = spatial.pointCoverage(moved);
  expect(covers({ x: 0, y: 200, z: 0 })).toBe(false);
  expect(covers({ x: -120, y: 0, z: 0 })).toBe(false);
  expect(covers({ x: -300, y: 0, z: 0 })).toBe(true);
  expect(transport.sourceAt(0, 0)).toBeNull();
  expect(transport.sourceAt(-300, 0)).toEqual([-200, 0]);
});
it("resolves convergence by source position, including material without history", () => {
  const transport = provinceTransport(fixture(1, -1), 200);
  const rightHistory = transport.transport(rectangle([0, -300, 500, 300]))!;
  const covers = spatial.pointCoverage(rightHistory);
  // The left donor wins the overlap even though only the right has this history.
  expect(covers({ x: 0, y: 0, z: 0 })).toBe(false);
  expect(covers({ x: 250, y: 0, z: 0 })).toBe(true);
  expect(transport.sourceAt(0, 0)).toEqual([-200, 0]);
  expect(transport.sourceAt(250, 0)).toEqual([450, 0]);
});
