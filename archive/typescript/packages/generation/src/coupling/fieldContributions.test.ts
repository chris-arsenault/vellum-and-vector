import { expect, it } from "vitest";
import { createTestField } from "../rock/groundTestFixture";
import { createMesh } from "../world/mesh";
import { Contributions, ledgerFloors, ledgerCeilings } from "./fieldContributions";

it("replaces external forcing without replacing its band or compounding the prior contribution", () => {
  const map = createTestField(createMesh(4, 0));
  const ledger = new Contributions(map.mesh.count),
    soil = map.SoilDepth;
  soil.set(0, 1);
  ledger.begin();
  ledger.add("SoilDepth", 0, 2);
  ledger.commit(map, ledgerFloors, ledgerCeilings);
  ledger.begin();
  ledger.add("SoilDepth", 0, 3);
  ledger.commit(map, ledgerFloors, ledgerCeilings);
  expect(map.SoilDepth).toBe(soil);
  expect(soil.get(0)).toBe(4);
});
