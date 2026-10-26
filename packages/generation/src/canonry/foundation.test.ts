import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createMesh, nearestTriangle, triangleIdentity } from "./mesh";
import { fractalNoise, hashUnit } from "./noise";

const reference = JSON.parse(
  readFileSync(new URL("../../fixtures/canonry-foundation.json", import.meta.url), "utf8")
);

it("retains the established deterministic hashing and noise primitives", () => {
  for (const p of reference.hashes) expect(hashUnit(p.salt, p.x, p.y)).toBe(p.value);
  for (const p of reference.noise)
    expect(fractalNoise(p.x, p.y, p.salt, p.scale, p.octaves)).toBeCloseTo(p.value, 14);
});

it("retains triangle identities and three-edge topology", () => {
  const mesh = createMesh(32, 2);
  expect(mesh.count).toBe(reference.mesh.count);
  for (const [i, triangle] of reference.mesh.triangles.entries()) {
    expect(triangleIdentity(mesh, i)).toBe(triangle.identity);
    expect(Array.from(mesh.neighbors.slice(i * 3, i * 3 + 3))).toEqual(triangle.neighbors);
    expect(nearestTriangle(mesh, mesh.x[i], mesh.y[i])).toBe(i);
  }
});
