import { expect, it } from "vitest";
import { createWorldMesh } from "./worldMesh";
import { createField } from "./field";
import { riverWarmth } from "./riverWarmth";
import { environment } from "./ecologyEnvironment";

/** A straight river of eleven cells flowing east, with a wellspring heating its third cell. */
function river() {
  const map = createField(createWorldMesh([0, 0, 1_100_000, 100_000], 64, 0));
  const cells = Array.from({ length: map.mesh.count }, (_, i) => i).sort(
    (a, b) => map.mesh.x[a] - map.mesh.x[b]
  );
  map.FlowTargets.fill(-1);
  for (let k = 0; k < cells.length; k++) {
    map.RiverOrders[cells[k]] = 1;
    map.Temperature[cells[k]] = 250;
    map.IceThickness[cells[k]] = 40;
    if (k + 1 < cells.length) map.FlowTargets[cells[k]] = cells[k + 1];
  }
  map.ExternalHeatForcing[cells[2]] = 300;
  return { map, cells };
}

it("carries a wellspring's warmth downstream, fading with travel, and not upstream", () => {
  const { map, cells } = river();
  riverWarmth(map);
  expect(map.RiverWarmth[cells[0]]).toBe(0);
  expect(map.RiverWarmth[cells[1]]).toBe(0);
  expect(map.RiverWarmth[cells[2]]).toBe(300);
  expect(map.RiverWarmth[cells[3]]).toBeGreaterThan(100);
  expect(map.RiverWarmth[cells[3]]).toBeLessThan(300);
  // The tongue fades with every step until it is gone, and never grows again.
  for (let k = 3; k + 1 < cells.length; k++)
    if (map.RiverWarmth[cells[k]] > 1)
      expect(map.RiverWarmth[cells[k + 1]]).toBeLessThan(map.RiverWarmth[cells[k]]);
    else expect(map.RiverWarmth[cells[k + 1]]).toBe(0);
});

it("keeps a warm reach open and warmer than its frozen banks", () => {
  const { map, cells } = river();
  riverWarmth(map);
  const warm = environment(map, cells[3]),
    cold = environment(map, cells[0]);
  expect(cold.frozen).toBe(true);
  expect(warm.frozen).toBe(false);
  expect(warm.temperature).toBeGreaterThan(cold.temperature);
});
