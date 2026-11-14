import { expect, it } from "vitest";
import { residentBand } from "@atlas/domain";
import { ecologicalFront } from "./ecologyMovement";
import { createField } from "./field";
import { createWorldMesh } from "./worldMesh";

/**
 * The ecological front is a shortest-path search over the mesh's adjacency. With a unit cost
 * per edge its travel times are hop counts and its sources the nearest start, which a plain
 * breadth-first search computes independently here.
 */
function reference(
  mesh: ReturnType<typeof createWorldMesh>,
  starts: Map<number, number>,
  admits: (i: number) => boolean
) {
  const time = new Float64Array(mesh.count).fill(Infinity),
    source = new Int32Array(mesh.count).fill(-1);
  // Starts may begin at different times, so settle cells in time order (unit edges keep this a
  // bucketed breadth-first search).
  const frontier = [...starts].filter(([i]) => admits(i));
  for (const [i, at] of frontier) {
    time[i] = at;
    source[i] = i;
  }
  while (frontier.length) {
    frontier.sort((a, b) => a[1] - b[1]);
    const [i, at] = frontier.shift()!;
    if (at > time[i]) continue;
    for (let edge = 0; edge < mesh.degree(i); edge++) {
      const j = mesh.neighbor(i, edge);
      if (j < 0 || !admits(j) || at + 1 >= time[j]) continue;
      time[j] = at + 1;
      source[j] = source[i];
      frontier.push([j, at + 1]);
    }
  }
  return { time, source };
}

it("matches a breadth-first reference for unit travel costs from two starts", () => {
  const mesh = createWorldMesh([0, 0, 8000, 8000], 64, 0),
    map = createField(mesh),
    cells = Array.from({ length: mesh.count }, (_, i) => i).filter((i) => mesh.degree(i) > 0),
    corner = (sign: number) =>
      cells.reduce((a, b) =>
        sign * (mesh.x(b) + mesh.y(b)) > sign * (mesh.x(a) + mesh.y(a)) ? b : a
      ),
    near = corner(-1),
    far = corner(1),
    starts = new Map([
      [near, 0],
      [far, 3],
    ]),
    values = new Float64Array(mesh.count).fill(Infinity);
  for (const [i, at] of starts) values[i] = at;
  // A wall through the middle (coordinates are centred on the frame) admits nothing except
  // a gap at its east end: the fronts must go around it.
  const admits = (i: number) => {
    const y = mesh.y(i);
    return !(y > -500 && y < 500 && mesh.x(i) < 2000);
  };
  const front = ecologicalFront(map, residentBand("float64", values), admits, () => 1),
    fromNear = reference(mesh, new Map([[near, 0]]), admits),
    fromFar = reference(mesh, new Map([[far, 3]]), admits);
  for (let i = 0; i < mesh.count; i++) {
    const best = Math.min(fromNear.time[i], fromFar.time[i]);
    expect(front.time.get(i)).toBe(best);
    // A tie between the two fronts may name either start; otherwise the nearer one.
    if (best === Infinity) expect(front.source.get(i)).toBe(-1);
    else {
      const winners = [fromNear, fromFar].filter((r) => r.time[i] === best).map((r) => r.source[i]);
      expect(winners).toContain(front.source.get(i));
    }
  }
  // Something was reached from each start and the blocked band was never entered.
  const sources = cells.map((i) => front.source.get(i));
  expect(sources).toContain(near);
  expect(sources).toContain(far);
  for (let i = 0; i < mesh.count; i++)
    if (!admits(i)) {
      expect(front.time.get(i)).toBe(Infinity);
      expect(front.source.get(i)).toBe(-1);
    }
});

it("weighs edges by the supplied travel cost and keeps the cheapest source", () => {
  const mesh = createWorldMesh([0, 0, 4000, 4000], 16, 0),
    map = createField(mesh),
    values = new Float64Array(mesh.count).fill(Infinity);
  values[0] = 0;
  // Moving east costs ten times moving in any other direction.
  const travel = (from: number, _edge: number, to: number) =>
    mesh.x(to) > mesh.x(from) + 1 ? 10 : 1;
  const front = ecologicalFront(map, residentBand("float64", values), () => true, travel);
  // Every settled time is the minimum over its neighbours' times plus the edge cost.
  for (let i = 0; i < mesh.count; i++) {
    if (i === 0) {
      expect(front.time.get(0)).toBe(0);
      continue;
    }
    let best = Infinity;
    for (let edge = 0; edge < mesh.degree(i); edge++) {
      const j = mesh.neighbor(i, edge);
      if (j >= 0) best = Math.min(best, front.time.get(j) + travel(j, edge, i));
    }
    expect(front.time.get(i)).toBe(best);
    expect(front.source.get(i)).toBe(0);
  }
});
