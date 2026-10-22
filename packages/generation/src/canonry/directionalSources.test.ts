import { expect, it } from "vitest";
import { createField } from "./field";
import { createWorldMesh } from "./worldMesh";
import { atlasPhysicalProfile } from "./atlasProfile";
import { alignedNeighbor } from "./atmosphere";
import { directionalSources } from "./directionalSources";

it.each([3e4, 1.5e4])("retains non-lattice flow directions at %i m spacing", (spacing) => {
  const map = createField(createWorldMesh([-1e5, -1e5, 1e5, 1e5], 512, spacing)),
    mesh = map.mesh;
  let oldError = 0;
  for (const angle of [0.17, 0.39, 0.72, 1.2]) {
    const x = Math.cos(angle),
      y = Math.sin(angle);
    const source = directionalSources(
      map,
      atlasPhysicalProfile(),
      new Float64Array(mesh.count).fill(x),
      new Float64Array(mesh.count).fill(y)
    );
    for (let i = 0; i < mesh.contentCount; i++) {
      const old = alignedNeighbor(map, i, -x, -y);
      oldError = Math.max(
        oldError,
        Math.abs(x * (mesh.y[old] - mesh.y[i]) - y * (mesh.x[old] - mesh.x[i])) / mesh.spacing
      );
      let dx = 0,
        dy = 0;
      for (const link of source.links[i]) {
        dx += link.weight * (mesh.x[link.i] - mesh.x[i]);
        dy += link.weight * (mesh.y[link.i] - mesh.y[i]);
      }
      expect(Math.abs(x * dy - y * dx) / mesh.spacing).toBeLessThan(1e-8);
      expect(dx * x + dy * y).toBeLessThan(0);
    }
  }
  expect(oldError).toBeGreaterThan(0.3);
});
