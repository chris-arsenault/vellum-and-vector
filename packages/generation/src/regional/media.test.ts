import { expect, it } from "vitest";
import { createTestField as createField } from "../rock/groundTestFixture";
import { createMesh } from "../world/mesh";
import { setLayer, readLayer } from "../rock/rockColumn";
import { projectGround } from "../rock/groundShares";
import { rockCatalogue } from "../rock/rockCatalogue";
import { Contributions, ledgerFloors, ledgerCeilings } from "./media";

function ground() {
  const map = createField(createMesh(4, 0));
  map.BedrockElevation.set(0, 10_000);
  setLayer(map, 0, 0, rockCatalogue.sandstone.code, 700, { strength: 1800, formedMin: 2 });
  projectGround(map, 0);
  return { map, ledger: new Contributions(map.mesh.count) };
}

it("lands sediment once and keeps a separate displacement through repeated totals", () => {
  const { map, ledger } = ground();
  for (let round = 0; round < 2; round++) {
    ledger.begin();
    ledger.add("SedimentThickness", 0, 200);
    ledger.add("Elevation", 0, 100);
    ledger.commit(map, ledgerFloors, ledgerCeilings);
    expect(map.SedimentThickness.get(0)).toBe(200);
    expect(map.BedrockElevation.get(0)).toBe(10_100);
    expect(map.Elevation.get(0)).toBe(10_300);
    expect(readLayer(map, 0, 0, "loose").depth).toBe(200);
  }
  ledger.begin();
  ledger.add("SedimentThickness", 0, 50);
  ledger.commit(map, ledgerFloors, ledgerCeilings);
  expect(map.Elevation.get(0)).toBe(10_050);
  expect(map.BedrockElevation.get(0)).toBe(10_000);
  expect(readLayer(map, 0, 0, "loose").depth).toBe(50);
});

it("alters both exposed materials without replacing their inherited strength contrast", () => {
  const { map, ledger } = ground();
  setLayer(map, 0, 0, rockCatalogue.shale.code, 900, { strength: 600, formedMin: 1 }, "cut");
  map.GroundCutShare.set(0, 0.25);
  map.GroundCutDepth.set(0, 400);
  projectGround(map, 0);
  for (let round = 0; round < 2; round++) {
    ledger.begin();
    ledger.add("RockResistance", 0, 100);
    ledger.commit(map, ledgerFloors, ledgerCeilings);
    expect(readLayer(map, 0, 0)).toMatchObject({ strength: 1900, formedMin: 2 });
    expect(readLayer(map, 0, 0, "cut")).toMatchObject({ strength: 700, formedMin: 1 });
    expect(map.RockResistance.get(0)).toBe(1600);
  }
});

it("keeps external soil and ice inputs in their existing bands", () => {
  const { map, ledger } = ground(),
    soil = map.SoilDepth,
    ice = map.IceThickness;
  ledger.begin();
  ledger.add("SoilDepth", 0, 2);
  ledger.add("IceThickness", 0, 3);
  ledger.commit(map, ledgerFloors, ledgerCeilings);
  expect(map.SoilDepth).toBe(soil);
  expect(map.IceThickness).toBe(ice);
  expect(soil.get(0)).toBe(2);
  expect(ice.get(0)).toBe(3);
});
