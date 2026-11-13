import { expect, it } from "vitest";
import { createWorldMesh } from "../world/worldMesh";
import { valleyOrder } from "./valleyPlacement";

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
