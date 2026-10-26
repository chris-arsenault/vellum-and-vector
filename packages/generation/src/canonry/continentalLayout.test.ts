import { expect, it } from "vitest";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { createField } from "./field";
import { landmasses } from "./geography";
import { createWorldMesh } from "./worldMesh";
import { nearestTriangle } from "./mesh";
import { oceanConnectivity } from "./ocean";
import { units } from "./math";

it.each([0.35, 0.48])(
  "floods the requested formation share on a constructed ramp at %s",
  (landFraction) => {
    const map = createField(createWorldMesh([0, 0, 400_000, 400_000], 1024, 0));
    for (let i = 0; i < map.mesh.count; i++) map.Elevation[i] = units(map.mesh.x[i] / 100);
    oceanConnectivity(map, physicalContext(73, 0, atlasPhysicalProfile({ landFraction })));
    const ocean = map.WaterKindCodes.slice(0, map.mesh.contentCount).filter(
      (kind) => kind === 1
    ).length;
    expect(ocean / map.mesh.contentCount).toBeCloseTo(1 - landFraction, 1);
  }
);

it("counts pieces on opposite chart edges as one landmass when the cylinder joins them", () => {
  const map = createField(
    createWorldMesh([0, 0, 4e6, 3e6], 4096, 0, undefined, undefined, undefined, true)
  );
  const dryAt = (x: number, y: number) =>
    (Math.abs(x) > 1.5e6 && Math.abs(y) < 500_000) ||
    (Math.abs(x) < 300_000 && Math.abs(y) < 300_000);
  for (let i = 0; i < map.mesh.count; i++) {
    const dry = dryAt(map.mesh.x[i], map.mesh.y[i]);
    map.WaterKindCodes[i] = dry ? 0 : 1;
    map.Elevation[i] = dry ? 1024 : -1024;
  }
  landmasses(map, physicalContext(73, 0, atlasPhysicalProfile()));
  const left = nearestTriangle(map.mesh, -1.9e6, 0),
    right = nearestTriangle(map.mesh, 1.9e6, 0),
    center = nearestTriangle(map.mesh, 0, 0);
  expect(map.LandmassIds[left]).toBeGreaterThan(0);
  expect(map.LandmassIds[left]).toBe(map.LandmassIds[right]);
  expect(map.LandmassIds[center]).not.toBe(map.LandmassIds[left]);
  expect(new Set(map.LandmassIds).size).toBe(3); // Ocean zero and two dry bodies.
});
