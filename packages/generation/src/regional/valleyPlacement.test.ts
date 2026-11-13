import { expect, it } from "vitest";
import { createWorldMesh } from "../world/worldMesh";
import { valleyOrder, valleyShares } from "./valleyPlacement";

it("widens a supplied valley through yielding material before its resistant shoulder", () => {
  const mesh = createWorldMesh([0, 0, 1000, 1000], 16, 0),
    root = 5,
    a = mesh.neighbor(root, 0),
    b = mesh.neighbor(root, 1),
    cells = [root, a, b],
    order = valleyOrder(mesh, cells, [root], (from) => (from === a ? 20 : 1));
  expect(order[0]).toBe(root);
  expect(order.indexOf(b)).toBeLessThan(order.indexOf(a));
});

it("keeps a narrow valley floor along every supplied course cell before widening its banks", () => {
  const shares = valleyShares([5, 6, 7], 2, 1, () => 1);
  expect(shares[0]).toBeGreaterThan(0);
  expect(shares[1]).toBeGreaterThan(0);
  expect(shares[0]).toBeLessThan(1);
  expect(shares[2]).toBe(0);
});
