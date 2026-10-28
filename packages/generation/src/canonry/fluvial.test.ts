import { expect, it } from "vitest";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { createField } from "./field";
import { fluvialErosion } from "./fluvial";
import { units } from "./math";
import { createWorldMesh } from "./worldMesh";

it("grades a coastal river to the sea and never cuts its bed below sea level", () => {
  const map = createField(createWorldMesh([0, 0, 200_000, 200_000], 1024, 0)),
    mesh = map.mesh;
  map.Runoff.fill(800);
  map.RockResistance.fill(600);
  for (let i = 0; i < mesh.count; i++) {
    const x = mesh.x(i) + 100_000,
      y = mesh.y(i);
    if (x < 30_000) {
      map.WaterKindCodes.set(i, 1);
      map.Elevation.set(i, units(-300));
      map.BedrockElevation.set(i, units(-300));
      map.WaterDepths.set(i, units(300));
      map.WaterSurfaceElevations.set(i, 0);
      continue;
    }
    // A low coastal plain whose trunk valley along y = 0 gathers the whole catchment.
    const floor = 4 + (x - 30_000) * 0.0015 + Math.abs(y) * 0.0012;
    map.Elevation.set(i, units(floor));
    map.BedrockElevation.set(i, units(floor));
  }
  const c = physicalContext(5, 0, atlasPhysicalProfile());
  fluvialErosion(map, c);
  let eroded = 0;
  for (let i = 0; i < mesh.count; i++) {
    if (mesh.membership(i) === 0 || map.WaterKindCodes.get(i) === 1) continue;
    eroded += map.CumulativeFluvialErosion.get(i);
    expect(map.Elevation.get(i)).toBeGreaterThan(map.EffectiveSeaLevel);
  }
  expect(eroded).toBeGreaterThan(0);
});
