import { expect, it } from "vitest";
import { fuseRock, fusedMaterial } from "./rockField";
import { rockCatalogue as rocks } from "./rockCatalogue";
import { materialLayer, readLayer, setLayer } from "./rockColumn";
import { createTestField } from "./groundTestFixture";
import { createWorldMesh } from "../world/worldMesh";
import { projectGround } from "./groundShares";
import { units } from "../world/math";

it("fully fused strong material becomes glass without resetting its formation or fabric", () => {
  const host = materialLayer(
    rocks.quartzite.code,
    40,
    { strength: 3800, grainX: 0.4, bedSlopeY: -0.2, deposited: 4 },
    2
  );
  expect(fusedMaterial(host, 0, true, 7)).toMatchObject({
    kind: rocks.saltGlass.code,
    secondaryKind: rocks.saltGlass.code,
    secondaryShare: 0,
    strength: 3800,
    formedMin: 2,
    formedMax: 2,
    altered: 7,
    deposited: 4,
    grainX: 0.4,
    bedSlopeY: -0.2,
  });
});

it("a scorch strengthens the existing mixture without declaring glass", () => {
  const host = materialLayer(rocks.sandstone.code, 40, {
    secondaryKind: rocks.limestone.code,
    secondaryShare: 0.3,
    strength: 800,
  });
  expect(fusedMaterial(host, 200, false, 3)).toMatchObject({
    kind: rocks.sandstone.code,
    secondaryKind: rocks.limestone.code,
    secondaryShare: 0.3,
    strength: 1000,
    altered: 3,
  });
});

it("surface fusion reads each reached substrate and leaves buried rock unaltered", () => {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0));
  map.CompletedEpochCount = 6;
  setLayer(map, 0, 0, rocks.granite.code, units(1000), { strength: 3900, formedMin: 1 });
  setLayer(map, 0, 0, rocks.shale.code, units(1000), { strength: 500, formedMin: 4 }, "loose");
  projectGround(map, 0);
  fuseRock(map, 0, 200, true);
  expect(readLayer(map, 0, 0, "loose")).toMatchObject({
    kind: rocks.saltGlass.code,
    strength: rocks.saltGlass.resistance,
    formedMin: 4,
    altered: 6,
  });
  expect(readLayer(map, 0, 1, "loose")).toMatchObject({ kind: rocks.shale.code, strength: 500 });
  expect(readLayer(map, 0, 0)).toMatchObject({
    kind: rocks.granite.code,
    strength: 3900,
    formedMin: 1,
  });
});
