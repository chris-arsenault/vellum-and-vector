import { expect, it } from "vitest";
import { createField } from "./field";
import { createWorldMesh } from "./worldMesh";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { plateAdvection } from "./advection";
import { tectonicProvinces } from "./provinces";
import { provinceAt } from "./provinceGeography";
import { provinceDisplacement } from "./provinceTransport";
import { spatial } from "@atlas/domain";

function fixture() {
  const map = createField(createWorldMesh([-100_000, -100_000, 100_000, 100_000], 512, 25_000));
  const context = physicalContext(1, 0, {
    ...atlasPhysicalProfile(),
    PlateDriftPerEpoch: 20_000,
    PlateDriftDecay: 1000,
  });
  tectonicProvinces(map, context);
  return { map, context };
}
it("moves events by their producing province, independently of sampling faces", () => {
  const { map, context } = fixture(),
    partition = map.provinces!;
  map.events = [
    [-30_000, 17_000],
    [-29_999.99, 17_000],
    [30_000, 0],
  ].map(([x, y], i) => ({
    id: `impact:${i}`,
    kind: "impact",
    x,
    y,
    radius: 100,
    epoch: 0,
    strength: 1000,
  }));
  const before = structuredClone(map.events);
  plateAdvection(map, context);
  map.events.forEach((event, i) => {
    const p = before[i],
      delta = provinceDisplacement(
        partition,
        provinceAt(partition, p.x + map.mesh.origin[0], p.y + map.mesh.origin[1]),
        20_000
      );
    expect(event.x).toBe(p.x + delta[0]);
    expect(event.y).toBe(p.y + delta[1]);
  });
  expect(map.events[1].x - map.events[0].x).toBeCloseTo(0.01, 7);
});
it("splits a fault across a diverging province boundary under one identity and leaves plumes fixed", () => {
  const { map, context } = fixture();
  map.provinces = {
    origin: [...map.mesh.origin],
    seed: 1,
    scale: 100_000,
    strength: 0,
    sites: [
      { x: -50_000, y: 0, priority: 0, assembly: 1, motionX: -1, motionY: 0 },
      { x: 50_000, y: 0, priority: 0, assembly: 2, motionX: 1, motionY: 0 },
    ],
  };
  map.CrustMotionX.set(Float64Array.from(map.mesh.x, (x) => (x < 0 ? -1000 : 1000)));
  map.CrustMotionY.fill(0);
  map.faults.push({
    id: "fault:test",
    width: 1000,
    coordinates: [
      [-60_000, 0],
      [60_000, 0],
    ],
  });
  map.events.push({
    id: "plume:test",
    kind: "plume",
    x: 0,
    y: 0,
    radius: 100,
    epoch: 0,
    strength: 1000,
  });
  map.events.push({
    id: "impact:split",
    kind: "impact",
    x: 0,
    y: 0,
    radius: 30_000,
    epoch: 0,
    strength: 1000,
    caldera: true,
  });
  plateAdvection(map, context);
  expect(map.faults[0].id).toBe("fault:test");
  expect([...map.faults[0].parts!].sort((a, b) => a[0][0] - b[0][0])).toEqual([
    [
      [-80_000, 0],
      [-20_000, 0],
    ],
    [
      [20_000, 0],
      [80_000, 0],
    ],
  ]);
  expect(map.events[0].x).toBe(0);
  expect(map.events[0].y).toBe(0);
  const event = map.events[1];
  expect(event.id).toBe("impact:split");
  expect(event.footprint?.type).toBe("MultiPolygon");
  expect(spatial.pointCoverage(event.footprint!)({ x: 0, y: 0, z: 0 })).toBe(false);
  expect(spatial.pointCoverage(event.footprint!)({ x: 35_000, y: 0, z: 0 })).toBe(true);
  expect(event.calderaFootprint?.type).toBe("MultiPolygon");
});
it("retains material ownership and age when plate motion is disabled", () => {
  const { map, context } = fixture();
  context.Profile.PlateDriftPerEpoch = 0;
  map.CrustAge.fill(271);
  plateAdvection(map, context);
  expect(Array.from(map.AdvectionSourceIndex)).toEqual(
    Array.from({ length: map.mesh.count }, (_, i) => i)
  );
  expect(map.CrustAge.every((value) => value === 271)).toBe(true);
});
