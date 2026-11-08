import { expect, it } from "vitest";
import { createTestField as createField } from "../rock/groundTestFixture";
import { createWorldMesh } from "../world/worldMesh";
import { materialBands, sheetFold } from "./material";
import type { RegionalState } from "./state";
import { MapScale } from "@atlas/domain";

it("repeats fold axes across a sheet, standing as high as the sheet has tilted", () => {
  const scale = MapScale.reference();
  expect(Math.abs(sheetFold(1 / 12, 800, scale))).toBeCloseTo(1);
  expect(sheetFold(1 / 12, 100, scale)).toBeCloseTo(0.2);
  expect(sheetFold(1 / 12, 400, scale)).toBeCloseTo(0.5);
  expect(Math.sign(sheetFold(1 / 12, 800, scale))).not.toBe(
    Math.sign(sheetFold(3 / 12, 800, scale))
  );
});
it("takes a region's folds from the parent's sheet, with no noise along the belt", () => {
  const map = createField(createWorldMesh([-100_000, -100_000, 100_000, 100_000], 1600, 5_000));
  for (let i = 0; i < map.mesh.count; i++) {
    map.ThrustSheetIndex.set(i, 2);
    map.ThrustDip.set(i, 800);
    map.ThrustAcross.set(i, Math.round((map.mesh.x(i) / 200_000 + 0.5) * 1000));
  }
  const n = map.mesh.count,
    state = {
      domain: { scope: { resolution: 5_000 } },
      physical: { map },
      regional: {
        input: { seed: 1 },
        parentSpan: 28_000,
        character: { grainX: new Float64Array(n), grainY: new Float64Array(n) },
      },
    } as unknown as RegionalState,
    bands = materialBands(state),
    x = 40_000,
    north = map.mesh.cellAt(x, 50_000),
    south = map.mesh.cellAt(x, -50_000),
    acrossBelt = Array.from(
      { length: 40 },
      (_, n) => bands[map.mesh.cellAt(-95_000 + n * 5_000, 0)]
    );
  expect(bands[north]).toBeCloseTo(bands[south], 1);
  expect(Math.max(...acrossBelt) - Math.min(...acrossBelt)).toBeGreaterThan(1.5);
});
