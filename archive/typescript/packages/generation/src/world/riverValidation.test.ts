import { expect, it } from "vitest";
import { createTestField } from "../rock/groundTestFixture";
import { addReach } from "../water/reachEvolution";
import { validateRiverReferences } from "./validation";
import { createWorldMesh } from "./worldMesh";

function supplied() {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0));
  const reach = addReach(map.rivers, [map.mesh.cellAt(0, 0)]);
  reach.drawn = true;
  reach.river = "losing-river";
  reach.months = 12;
  reach.flow = 20;
  reach.monthly.fill(20);
  return { map, reach };
}

it("allows a retained river to end inland without requiring quantity-flow closure", () => {
  const { map } = supplied();
  expect(() => validateRiverReferences(map)).not.toThrow();
});

it("checks receiving references and map-owned cell addresses", () => {
  const { map, reach } = supplied();
  reach.downstream = 999;
  expect(() => validateRiverReferences(map)).toThrow("invalid receiving reach");
  reach.downstream = null;
  reach.cells = [-1];
  expect(() => validateRiverReferences(map)).toThrow("outside this map");
});
