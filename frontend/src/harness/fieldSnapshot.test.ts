import { beforeEach, expect, it, vi } from "vitest";
import { deserialize, serialize } from "node:v8";
import { createField } from "../../../packages/generation/src/world/field";
import { createWorldMesh } from "../../../packages/generation/src/world/worldMesh";
import { physicalContext } from "../../../packages/generation/src/world/context";
import { physicalProfile } from "../../../packages/generation/src/world/profile";
import { GroundInventory } from "../../../packages/generation/src/rock/groundInventory";
import { materialLayer, setLayer } from "../../../packages/generation/src/rock/rockColumn";
import { rockCatalogue } from "../../../packages/generation/src/rock/rockCatalogue";
import { loadOf, seaLoadOf } from "../../../packages/generation/src/rock/groundLoad";
import { units } from "../../../packages/generation/src/world/math";
import { latitudeAt } from "../../../packages/generation/src/world/latitude";
import { drawCells } from "./reliefSystems";
import {
  captureFailedField,
  captureFinalField,
  restoreSnapshot,
  snapshotRecorder,
} from "./fieldSnapshot";

const io = vi.hoisted((): { bytes: Buffer } => ({ bytes: Buffer.alloc(0) }));
vi.mock("node:fs", async (original) => ({
  ...(await original<typeof import("node:fs")>()),
  mkdirSync: vi.fn(),
  writeFileSync: (_path: string, bytes: Buffer) => {
    io.bytes = bytes;
  },
  readFileSync: () => io.bytes,
}));
vi.mock("./harnessWorkspace", () => ({ harnessRoot: "/supplied" }));
beforeEach(() => {
  io.bytes = Buffer.alloc(0);
});

it("rejects snapshots without their recorded epochs instead of supplying current defaults", () => {
  io.bytes = serialize({ lengthUnits: "relative" });
  expect(() => restoreSnapshot("supplied.bin", true)).toThrow("missing its epochs");
});

it("restores a completed current snapshot with its recorded epochs and no failure marker", () => {
  const map = createField(createWorldMesh([0, 0, 1000, 1000], 16, 0)),
    profile = map.scale.resolve(physicalProfile, { BoundaryPadding: 0 }),
    context = physicalContext(19, 0, profile, null, 0),
    record = snapshotRecorder("completed", "standard", []);
  map.Rainfall.set(0, 3.25);
  expect(record("physical-epoch-history", map, context)).toBe(true);
  const restored = restoreSnapshot("pass-1.bin");
  expect(restored).toMatchObject({ seed: 19, epochs: [], failure: undefined });
  expect(restored.map.Rainfall.get(0)).toBe(3.25);
});

it("keeps a supplied lattice in its world frame for positions and latitude", () => {
  const map = createField(createWorldMesh([4000, 6000, 5000, 7000], 16, 0)),
    profile = {
      ...map.scale.resolve(physicalProfile, { BoundaryPadding: 0 }),
      WorldExtentY: [0, 10_000] as [number, number],
      LatitudeSouth: -50,
      LatitudeNorth: 50,
      LatitudeProjection: 0,
    },
    context = physicalContext(19, 0, profile),
    path = captureFinalField(
      { label: "located", quality: "draft", seed: 19, epochs: [] },
      map,
      context
    ),
    restored = restoreSnapshot(path).map,
    cell = restored.mesh.cellAt(0, 0),
    worldX = restored.mesh.x(cell) + restored.mesh.origin[0],
    worldY = restored.mesh.y(cell) + restored.mesh.origin[1];
  expect(restored.mesh.origin).toEqual([4500, 6500]);
  expect(worldX).toBeGreaterThanOrEqual(4000);
  expect(worldX).toBeLessThanOrEqual(5000);
  expect(worldY).toBeGreaterThanOrEqual(6000);
  expect(worldY).toBeLessThanOrEqual(7000);
  expect(latitudeAt(profile, restored, cell)).toBeCloseTo(-50 + worldY / 100);
  expect(latitudeAt(profile, restored, cell)).toBeGreaterThan(10);
  const withoutOrigin = deserialize(io.bytes);
  delete withoutOrigin.worldOrigin;
  io.bytes = serialize(withoutOrigin);
  expect(() => restoreSnapshot(path)).toThrow("missing its world origin");
  let centreRendered = false;
  drawCells(restored, "/supplied", "located.png", (sample) => {
    if (sample === cell) centreRendered = true;
    return [100, 150, 200];
  });
  expect(centreRendered).toBe(true);
});

it("retains failed values and known run inputs without treating the last boundary as completion", () => {
  const map = createField(createWorldMesh([0, 0, 1000, 1000], 16, 0)),
    profile = map.scale.resolve(physicalProfile, { BoundaryPadding: 0 }),
    context = physicalContext(19, 123, profile),
    failure = {
      status: "failed" as const,
      message: "negative rainfall",
      lastObservedStep: "plate-advection",
      lastObservedEpoch: 0,
    };
  map.Rainfall.set(0, -3.25);
  const path = captureFailedField(
      { label: "case", quality: "standard", seed: 57721, epochs: [] },
      map,
      context,
      failure
    ),
    raw = deserialize(io.bytes);
  expect(path).toBe("/supplied/snapshots/case/failure.bin");
  expect(raw).toMatchObject({ seed: 57721, epochs: [], failure });
  expect(raw.bands.Rainfall[0]).toBe(-3.25);
  expect(() => restoreSnapshot(path)).toThrow("inspection-only");
  const restored = restoreSnapshot(path, true);
  expect(restored.map.Rainfall.get(0)).toBe(-3.25);
  expect(restored.failure).toEqual(failure);
});

it("captures the completed field after later writers change the last observed map", () => {
  const map = createField(createWorldMesh([0, 0, 1000, 1000], 16, 0)),
    profile = map.scale.resolve(physicalProfile, { BoundaryPadding: 0 }),
    context = physicalContext(19, 123, profile),
    input = { label: "complete", quality: "draft", seed: 57721, epochs: [] };
  map.Rainfall.set(0, 2);
  snapshotRecorder("complete", "draft", [])("physical-epoch-history", map, context);
  map.Rainfall.set(0, 5);
  const path = captureFinalField(input, map, context),
    restored = restoreSnapshot(path);
  expect(path).toBe("/supplied/snapshots/complete/final.bin");
  expect(restored.seed).toBe(57721);
  expect(restored.map.Rainfall.get(0)).toBe(5);
  expect(restored.failure).toBeUndefined();
});
it("restores buried hosted charge and both persistent material cargo loads", () => {
  const map = createField(createWorldMesh([0, 0, 1000, 1000], 16, 0)),
    profile = map.scale.resolve(physicalProfile, { BoundaryPadding: 0 }),
    context = physicalContext(19, 0, profile),
    stock = new GroundInventory(map, "salt:sea/bed"),
    kind = rockCatalogue.saltbed.code;
  setLayer(map, 0, 0, kind, units(2));
  setLayer(map, 0, 1, kind, units(3), { cargo: new Float64Array([stock.key, kind, 10]) });
  setLayer(map, 0, 2, rockCatalogue.granite.code, 1);
  const parcel = materialLayer(kind, 7, {
    cargo: new Float64Array([stock.key, kind, 4]),
    formedMin: 3,
  });
  loadOf(map).add(0, parcel);
  seaLoadOf(map).add(0, { ...parcel, depth: 11 });
  const path = captureFinalField(
      { label: "cargo", quality: "draft", seed: 19, epochs: [] },
      map,
      context
    ),
    restored = restoreSnapshot(path).map,
    inherited = new GroundInventory(restored, "salt:sea/bed");
  expect(inherited.reached(0, units(2))).toBe(0);
  expect(inherited.get(0)).toBeCloseTo(restored.mesh.area(0) * 30);
  expect(loadOf(restored).get(0)).toMatchObject({ depth: 7, formedMin: 3 });
  expect(loadOf(restored).get(0).cargo?.[2]).toBe(4);
  expect(seaLoadOf(restored).get(0).cargo?.[2]).toBe(4);
});
