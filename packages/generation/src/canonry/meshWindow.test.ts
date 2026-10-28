import { expect, it } from "vitest";
import { createAdaptiveTopology, rectangle, type Bounds } from "@atlas/domain";
import { createWorldMesh } from "./worldMesh";
import { createMesh, type PhysicalMesh } from "./mesh";
import { adaptivePhysicalMesh } from "./adaptiveMesh";
import { meshWindowCells } from "./meshWindow";

function check(mesh: PhysicalMesh, bounds: Bounds) {
  const expected = Array.from({ length: mesh.count }, (_, i) => i).filter((cell) => {
    if (mesh.membership(cell) === 0) return false;
    const x = mesh.x(cell) + mesh.origin[0],
      y = mesh.y(cell) + mesh.origin[1];
    return x >= bounds[0] && x <= bounds[2] && y >= bounds[1] && y <= bounds[3];
  });
  expect([...meshWindowCells(mesh, bounds)].sort((a, b) => a - b)).toEqual(expected);
}
it("queries local centroids on regular, cylindrical, polar and adaptive meshes without seam duplicates", () => {
  const bounds: Bounds = [0, 0, 4000, 1000],
    topology = createAdaptiveTopology(bounds, { maximumSize: 250, minimumSize: 125 });
  const meshes = [
    createMesh(100, 3),
    createWorldMesh(bounds, 256, 200),
    createWorldMesh(bounds, 256, 0, undefined, undefined, undefined, true, false),
    createWorldMesh(bounds, 256, 0, undefined, undefined, undefined, true, true),
    adaptivePhysicalMesh(topology, rectangle(bounds)),
  ];
  for (const mesh of meshes)
    for (const window of [
      bounds,
      [-100, -100, 100, 100],
      [3900, 0, 4100, 1000],
      [1400, 300, 1600, 700],
    ] as Bounds[])
      check(mesh, window);
});
