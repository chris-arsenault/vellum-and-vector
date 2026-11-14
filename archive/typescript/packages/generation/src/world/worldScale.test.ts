import { expect, it } from "vitest";
import { areaBudget } from "./worldScale";
import { createWorldMesh } from "./worldMesh";
import { createField } from "./field";
import { worldCandidates } from "./worldSources";

it("distributes spatial candidates to all rectangle edges on an elongated domain", () => {
  const map = createField(createWorldMesh([0, 0, 40_000_000, 2_000_000], 1024, 0));
  const candidates = worldCandidates(map.mesh, 42, 10000);
  for (const axis of ["x", "y"] as const) {
    const size = axis === "x" ? 40_000_000 : 2_000_000;
    expect(candidates.some((c) => c[axis] < -size * 0.49)).toBe(true);
    expect(candidates.some((c) => c[axis] > size * 0.49)).toBe(true);
  }
});

it("allocates an explicit count by supplied relative area and preserves an empty budget", () => {
  expect(areaBudget(6, 12e12, 12e12)).toBe(6);
  expect(areaBudget(6, 120e12, 12e12)).toBe(60);
  expect(areaBudget(0, 120e12, 12e12)).toBe(0);
  expect(areaBudget(6, 0, 12e12)).toBe(0);
});
