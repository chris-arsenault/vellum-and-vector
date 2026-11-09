import { beforeEach, expect, it, vi } from "vitest";
import { deserialize, serialize } from "node:v8";
import { createField } from "../../../packages/generation/src/world/field";
import { createWorldMesh } from "../../../packages/generation/src/world/worldMesh";
import { physicalContext } from "../../../packages/generation/src/world/context";
import { physicalProfile } from "../../../packages/generation/src/world/profile";
import { captureFailedField, restoreSnapshot, snapshotRecorder } from "./fieldSnapshot";

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
