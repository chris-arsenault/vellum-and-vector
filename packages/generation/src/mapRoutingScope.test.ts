import { afterEach, expect, it, vi } from "vitest";
import {
  createGrid,
  generateChannel,
  gridPosition,
  putChannel,
  rectangle,
  spatial,
} from "@atlas/domain";
import { landscape } from "./mapFixtures";
import { withRouteFinder } from "./mapRouting";

afterEach(() => vi.restoreAllMocks());
function grid() {
  const supplied = createGrid("routes", landscape().domain.scope, 5, 3);
  putChannel(
    supplied,
    "elevation",
    "metre",
    generateChannel(supplied, "elevation", () => 100)
  );
  return supplied;
}
function coverageQueries() {
  const prepare = spatial.geometryCoverage.bind(spatial),
    checks = vi.fn();
  const preparations = vi.spyOn(spatial, "geometryCoverage").mockImplementation((geometry) => {
    const covers = prepare(geometry);
    return (query) => {
      checks(query);
      return covers(query);
    };
  });
  return { checks, preparations };
}
it("checks each queried adjacency once within a routing batch", () => {
  const supplied = grid(),
    { checks, preparations } = coverageQueries(),
    from = gridPosition(supplied, 5),
    to = gridPosition(supplied, 9);
  withRouteFinder(supplied, (find) => {
    expect(find(from, to, "road").at(-1)).toEqual(to);
    const checked = checks.mock.calls.length;
    expect(checked).toBeGreaterThan(0);
    expect(find(from, to, "road")[0]).toEqual(from);
    expect(checks).toHaveBeenCalledTimes(checked);
  });
  expect(preparations).toHaveBeenCalledOnce();
});
it("reads changed terrain costs while reusing checked adjacency", () => {
  const supplied = grid(),
    from = gridPosition(supplied, 5),
    to = gridPosition(supplied, 9),
    crest = gridPosition(supplied, 7);
  withRouteFinder(supplied, (find) => {
    expect(find(from, to, "road")).toContainEqual(crest);
    supplied.channels.elevation.set(7, 10000);
    const around = find(from, to, "road");
    expect(around.at(-1)).toEqual(to);
    expect(around).not.toContainEqual(crest);
  });
});
it("rechecks a changed footprint in a new scope and retains holes on cached routes", () => {
  const supplied = grid(),
    from = gridPosition(supplied, 5),
    to = gridPosition(supplied, 9),
    middle = gridPosition(supplied, 7),
    { checks, preparations } = coverageQueries();
  expect(withRouteFinder(supplied, (find) => find(from, to, "road"))).toContainEqual(middle);
  supplied.scope.footprint = {
    type: "Polygon",
    coordinates: [
      (rectangle(supplied.bounds) as GeoJSON.Polygon).coordinates[0],
      (rectangle([1800, 200, 2200, 800]) as GeoJSON.Polygon).coordinates[0],
    ],
  };
  withRouteFinder(supplied, (find) => {
    for (let repeat = 0; repeat < 2; repeat++) {
      const route = find(from, to, "road");
      expect(route.at(-1)).toEqual(to);
      expect(route).not.toContainEqual(middle);
      expect(
        spatial.covers(supplied.scope.footprint, {
          type: "LineString",
          coordinates: route.map((p) => [p.x, p.y]),
        })
      ).toBe(true);
    }
  });
  expect(preparations).toHaveBeenCalledTimes(2);
  expect(checks.mock.calls.length).toBeGreaterThan(0);
});
it("retains checked seam neighbors throughout a batch", () => {
  const supplied = grid();
  supplied.periodicWidth = 4000;
  supplied.active.fill(0);
  supplied.active.set(5, 1);
  supplied.active.set(9, 1);
  const from = gridPosition(supplied, 5),
    to = gridPosition(supplied, 9),
    { checks } = coverageQueries();
  withRouteFinder(supplied, (find) => {
    expect(find(from, to, "road")).toEqual([from, to]);
    const checked = checks.mock.calls.length;
    expect(checked).toBeGreaterThan(0);
    expect(find(from, to, "road")).toEqual([from, to]);
    expect(checks).toHaveBeenCalledTimes(checked);
  });
});
it("builds one active-sample index for multiple routes", () => {
  const supplied = grid(),
    index = vi.spyOn(spatial, "withIndex");
  supplied.active.fill(0);
  for (let i = 5; i < 10; i++) supplied.active.set(i, 1);
  const from = { x: 1100, y: 600, z: 0 },
    to = { x: 3900, y: 500, z: 0 };
  const routes = withRouteFinder(supplied, (find) => [
    find(from, to, "road"),
    find(to, from, "road"),
  ]);
  expect(index).toHaveBeenCalledOnce();
  expect(index.mock.calls[0][0]).toHaveLength(5);
  expect(routes[0][1]).toEqual(gridPosition(supplied, 7));
  expect(routes[0][0]).toEqual(from);
  expect(routes[1].at(-1)).toEqual(from);
});
it("uses periodic nearest candidates for samples across the seam", () => {
  const supplied = grid();
  supplied.periodicWidth = 4000;
  supplied.active.fill(0);
  supplied.active.set(5, 1);
  supplied.active.set(6, 1);
  const from = { x: 3900, y: 500, z: 0 },
    to = { x: 1000, y: 500, z: 0 };
  const path = withRouteFinder(supplied, (find) => find(from, to, "road"));
  expect(path).toEqual([from, to]);
});
it("normalizes canonical endpoints into a compact periodic chart", () => {
  const supplied = grid();
  supplied.bounds = [3500, 0, 4500, 1000];
  supplied.periodicWidth = 4000;
  supplied.scope.footprint = {
    type: "MultiPolygon",
    coordinates: [
      (rectangle([0, 0, 500, 1000]) as GeoJSON.Polygon).coordinates,
      (rectangle([3500, 0, 4000, 1000]) as GeoJSON.Polygon).coordinates,
    ],
  };
  supplied.active.fill(0);
  supplied.active.set(8, 1);
  const from = { x: 200, y: 500, z: 0 },
    to = { x: 300, y: 500, z: 0 };
  expect(withRouteFinder(supplied, (find) => find(from, to, "road"))).toEqual([from, to]);
});
it("keeps endpoint extent checks, rejects empty sample sets and closes the scoped callback", () => {
  const supplied = grid();
  expect(() =>
    withRouteFinder(supplied, (find) =>
      find({ x: -1, y: 500, z: 0 }, gridPosition(supplied, 6), "road")
    )
  ).toThrow("inside");
  supplied.active.fill(0);
  expect(() =>
    withRouteFinder(supplied, (find) =>
      find({ x: 100, y: 500, z: 0 }, { x: 200, y: 500, z: 0 }, "road")
    )
  ).toThrow("no active");
  const escaped = withRouteFinder(supplied, (find) => find);
  expect(() => escaped({ x: 100, y: 500, z: 0 }, { x: 200, y: 500, z: 0 }, "road")).toThrow(
    "scope has ended"
  );
});
