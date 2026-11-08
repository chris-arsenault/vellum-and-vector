import { expect, it } from "vitest";
import { createTestField as createField } from "../rock/groundTestFixture";
import { constructRock, deposit, erode, raiseFromCrust } from "../rock/groundLedger";
import { projectGround } from "../rock/groundShares";
import { rockCatalogue } from "../rock/rockCatalogue";
import { setLayer } from "../rock/rockColumn";
import { crustPerRock, elevationLimit, units } from "../world/math";
import { createMesh } from "../world/mesh";

/** Supplied column inputs for owner-operation contracts; no physical process is run. */
function column(height = 1000, crust = 4000) {
  const map = createField(createMesh(4, 0));
  setLayer(map, 0, 0, rockCatalogue.schist.code, units(30_000));
  map.CrustContinentalFraction.set(0, 1000);
  map.CrustThickness.set(0, units(crust));
  map.CrustContinentalColumn.set(0, units(crust));
  map.BedrockElevation.set(0, units(height));
  projectGround(map, 0);
  return map;
}

it("stands no rock without available crust and withdraws the accepted amount", () => {
  const none = column(),
    some = column(1000, 4300);
  expect(raiseFromCrust(none, 0, units(1000), "test")).toBe(0);
  const stood = raiseFromCrust(some, 0, units(5000), "test") / 1024;
  expect(stood).toBeCloseTo(300 / crustPerRock(1), 3);
  expect(stood).toBeLessThan(5000);
  expect(some.CrustThickness.get(0) / 1024).toBeCloseTo(4000, 3);
  expect(some.SurfaceRockLoad.get(0) / 1024).toBeCloseTo(stood, 3);
});

it("clips removal to the available rock load and crust", () => {
  const map = column(1000, 4100);
  constructRock(map, 0, units(50), rockCatalogue.strata, "test", "crust");
  erode(map, 0, units(5000), "test");
  const taken = 50 + 100 / crustPerRock(1) / 0.8;
  expect(map.SurfaceRockLoad.get(0) / 1024).toBeCloseTo(50 - taken, 3);
  expect(map.CrustThickness.get(0)).toBe(units(4000));
  erode(map, 0, units(5000), "test");
  expect(map.SurfaceRockLoad.get(0) / 1024).toBeCloseTo(50 - taken, 3);
});

it("returns only the material accepted below the height limit", () => {
  const map = column(elevationLimit - 10),
    laid = deposit(map, 0, units(100), "test");
  expect(laid).toBe(units(10));
  expect(map.Elevation.get(0)).toBe(units(elevationLimit));
});
