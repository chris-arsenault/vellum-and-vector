import { expect, it } from "vitest";
import { createField } from "../world/field";
import { createWorldMesh } from "../world/worldMesh";
import { blurContent, blurOverLand, releaseBlurs } from "./lattice";
import type { RegionalState } from "./state";

it("does not drag a coastal country down toward the sea when it blurs heights", () => {
  const map = createField(createWorldMesh([-100_000, -100_000, 100_000, 100_000], 1600, 5_000)),
    state = { physical: { map } } as unknown as RegionalState,
    n = map.mesh.count,
    sea = Uint8Array.from({ length: n }, (_, i) => (map.mesh.x(i) < 0 ? 1 : 0)),
    heights = () => Float64Array.from({ length: n }, (_, i) => (sea[i] ? 0 : 100)),
    coast = map.mesh.cellAt(10_000, 0),
    plain = heights(),
    overLand = heights();
  blurContent(state, plain, 30_000);
  blurOverLand(state, overLand, sea, 30_000);
  releaseBlurs(state);
  expect(plain[coast]).toBeLessThan(90);
  expect(overLand[coast]).toBeGreaterThan(98);
});
