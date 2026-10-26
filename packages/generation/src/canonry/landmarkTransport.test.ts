import { expect, it } from "vitest";
import { createAdaptiveTopology, rectangle, refineAdaptiveTopology } from "@atlas/domain";
import { createField, type PhysicalField } from "./field";
import { createWorldMesh } from "./worldMesh";
import { adaptivePhysicalMesh } from "./adaptiveMesh";
import { buildTransportPlan } from "./transportPlan";
import { advectLandmarkDrainage } from "./landmarkTransport";
import { remeshPhysical } from "./physicalRemesh";
import { captureInto } from "./landmarkCanyon";
import { meshDeltaX } from "./mesh";
import type { LandmarkRecord } from "./landmarkLedger";

function record(map: PhysicalField, cell: number): LandmarkRecord {
  const value: LandmarkRecord = {
    id: "canyon",
    kind: "canyon",
    realized: true,
    emplacedAtEpoch: 0,
    target: {},
    measured: {},
    maintenance: 0,
    capture: { x: map.mesh.x[cell], y: map.mesh.y[cell], accumulation: 1000 },
    corridor: [cell],
    notes: [],
  };
  map.landmarkLedger = new Map([[value.id, value]]);
  return value;
}

it("uses present captured flow rather than retaining a historical peak", () => {
  const map = createField(createWorldMesh([0, 0, 400_000, 300_000], 1024, 0)),
    value = record(map, 0);
  map.RiverOrders[0] = 1;
  map.FlowAccumulation[0] = 10;
  captureInto(map, value, {
    head: 0,
    floor: new Set([0]),
    floorWidth: 100,
    reach: 100,
    label: "head",
  });
  expect(value.capture?.accumulation).toBe(10);
  map.RiverOrders.fill(0);
  captureInto(map, value, {
    head: 0,
    floor: new Set([0]),
    floorWidth: 100,
    reach: 100,
    label: "head",
  });
  expect(value.capture).toBeNull();
});

it("moves capture coordinates and corridor indices along the actual periodic scatter", () => {
  const map = createField(
    createWorldMesh([0, 0, 400_000, 300_000], 1024, 0, undefined, undefined, undefined, true)
  );
  const source = map.mesh.x.findIndex((x) => x > 190_000),
    value = record(map, source),
    start = value.capture!.x;
  map.CrustMotionX.fill(1000);
  const plan = buildTransportPlan(map, 80_000);
  advectLandmarkDrainage(map, plan, 80_000);
  expect(meshDeltaX(map.mesh, value.capture!.x - start)).toBeCloseTo(80_000, 5);
  expect(value.corridor.length).toBeGreaterThan(0);
  for (const cell of value.corridor) {
    expect(plan.dominant[cell]).toBe(source);
    expect(map.mesh.x[cell]).toBeLessThan(0);
  }
});

it("preserves the physical corridor area when its mesh cells are refined", () => {
  const bounds: [number, number, number, number] = [0, 0, 400_000, 400_000];
  const topology = createAdaptiveTopology(bounds, { maximumSize: 100_000, minimumSize: 100_000 });
  const map = createField(adaptivePhysicalMesh(topology, rectangle(bounds))),
    value = record(map, 0),
    area = map.mesh.areas[0];
  const refined = refineAdaptiveTopology(topology, [0], 50_000);
  const next = remeshPhysical(map, refined, rectangle(bounds));
  expect(value.corridor.length).toBeGreaterThan(1);
  expect(value.corridor.reduce((sum, cell) => sum + next.mesh.areas[cell], 0)).toBe(area);
});
