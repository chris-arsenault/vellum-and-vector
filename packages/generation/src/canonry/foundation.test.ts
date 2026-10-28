import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createMesh, nearestTriangle, triangleIdentity, type TriangularLattice } from "./mesh";
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
  const mesh = createMesh(32, 2) as TriangularLattice;
  let live = 0;
  for (let i = 0; i < mesh.count; i++) if (mesh.membership(i) !== 0) live++;
  expect(live).toBe(reference.mesh.count);
  // Cells are numbered by block, not by the reference's order: match them by lattice address.
  interface Reference {
    coord: { U: number; V: number; Inverted: boolean };
    identity: number;
    neighbors: number[];
  }
  const triangles: Reference[] = reference.mesh.triangles,
    cellOf = (triangle: Reference) =>
      mesh.addressCell(triangle.coord.U, triangle.coord.V, triangle.coord.Inverted);
  for (const triangle of triangles) {
    const i = cellOf(triangle);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(mesh.membership(i)).not.toBe(0);
    expect(triangleIdentity(mesh, i)).toBe(triangle.identity);
    expect(Array.from({ length: 3 }, (_, edge) => mesh.neighbor(i, edge))).toEqual(
      triangle.neighbors.map((neighbor) => (neighbor < 0 ? -1 : cellOf(triangles[neighbor])))
    );
    expect(nearestTriangle(mesh, mesh.x(i), mesh.y(i))).toBe(i);
  }
});
