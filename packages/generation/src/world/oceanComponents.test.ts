import { expect, it } from "vitest";
import { createField } from "./field";
import { OceanComponents, visitConnectedOcean } from "./oceanComponents";
import { createWorldMesh } from "./worldMesh";

it("keeps the connected area equal to the content of every component that touches a seed", () => {
  const mesh = createWorldMesh([0, 0, 6000, 6000], 36, 0),
    map = createField(mesh),
    components = new OceanComponents(map),
    seeds = new Set<number>();
  for (let i = 0; i < mesh.count; i++) if (mesh.boundary(i)) seeds.add(i);
  const expected = () => {
    const byRoot = new Map<number, { content: number; seeded: boolean }>();
    for (let i = 0; i < mesh.count; i++) {
      if (components.parent.get(i) < 0) continue;
      const root = components.root(i),
        entry = byRoot.get(root) ?? { content: 0, seeded: false };
      entry.content += mesh.contentArea(i);
      entry.seeded ||= seeds.has(i);
      byRoot.set(root, entry);
    }
    let total = 0;
    for (const entry of byRoot.values()) if (entry.seeded) total += entry.content;
    return total;
  };
  // Activate interior cells first, then join them to each other, then to the edge, in an
  // order that unions large into small and small into large.
  const cells = Array.from({ length: mesh.count }, (_, i) => i),
    interior = cells.filter((i) => !mesh.boundary(i)),
    edge = cells.filter((i) => mesh.boundary(i));
  for (const i of interior) components.activate(i);
  expect(components.connected).toBe(0);
  for (let k = 1; k < interior.length; k++) {
    components.union(interior[k - 1], interior[k]);
    expect(components.connected).toBeCloseTo(expected(), 6);
  }
  for (const i of edge) components.activate(i);
  expect(components.connected).toBeCloseTo(expected(), 6);
  components.union(edge[0], interior[0]);
  expect(components.connected).toBeCloseTo(expected(), 6);
  components.union(interior[3], edge[1]);
  expect(components.connected).toBeCloseTo(expected(), 6);
  // Joining two already-joined cells changes nothing.
  const before = components.connected;
  components.union(edge[1], edge[0]);
  expect(components.connected).toBe(before);
  components.close();
});

it("visits the connected sea below a level once, from the boundary inward", () => {
  const mesh = createWorldMesh([0, 0, 6000, 6000], 36, 0),
    map = createField(mesh);
  // Low ground everywhere except a dyke of the central cell's neighbours, which isolates it.
  const cells = Array.from({ length: mesh.count }, (_, i) => i),
    pocket = cells.reduce((a, b) =>
      Math.hypot(mesh.x(b), mesh.y(b)) < Math.hypot(mesh.x(a), mesh.y(a)) ? b : a
    ),
    dyke = new Set<number>();
  for (let edge = 0; edge < mesh.degree(pocket); edge++) dyke.add(mesh.neighbor(pocket, edge));
  map.Elevation.fill(-1000);
  for (const i of dyke) map.Elevation.set(i, 1000);
  const visited: number[] = [];
  visitConnectedOcean(map, 0, (i) => visited.push(i));
  expect(new Set(visited).size).toBe(visited.length);
  for (const i of visited) expect(map.Elevation.get(i)).toBeLessThan(0);
  // The pocket inside the dyke is low but not connected to the sea.
  expect(visited).not.toContain(pocket);
  expect(visited.length).toBe(mesh.count - dyke.size - 1);
});
