import { createGrid, point, rectangle, residentBand, spatial, type Bounds } from "@atlas/domain";
import { expect, it } from "vitest";
import { landscape } from "../mapFixtures";
import { createField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { createWorldMesh } from "./worldMesh";
import {
  areaGeometry,
  intersectAreas,
  fillSmallHoles,
  combinedContour,
  membershipContour,
  membershipSampler,
} from "./geographicContours";

it("retains polygon area when chart clipping also returns isolated boundary lines", () => {
  const shape = areaGeometry({
    type: "GeometryCollection",
    geometries: [
      rectangle([0, 0, 10, 10]),
      {
        type: "LineString",
        coordinates: [
          [10, 10],
          [20, 10],
        ],
      },
    ],
  });
  expect(shape?.type).toBe("Polygon");
  expect(spatial.area(shape!)).toBe(100);
});

it("clips intersected lake area again when another component only touches its membership boundary", () => {
  const first = rectangle([0, 0, 4, 4]),
    second = rectangle([6, 0, 8, 2]);
  if (first.type !== "Polygon" || second.type !== "Polygon") throw new Error("Expected rectangles");
  const wet: import("geojson").MultiPolygon = {
    type: "MultiPolygon",
    coordinates: [first.coordinates, second.coordinates],
  };
  const membership = rectangle([2, 0, 6, 4]);
  // GEOS legitimately returns the overlapping area plus the other component's touching edge.
  const contact = spatial.intersection(wet, membership)!;
  expect(contact.type).toBe("GeometryCollection");
  const lake = intersectAreas(wet, membership)!;
  expect(lake.type).toBe("Polygon");
  const clipped = intersectAreas(lake, rectangle([3, -1, 7, 5]))!;
  expect(spatial.covers(clipped, point({ x: 3.5, y: 2, z: 0 }))).toBe(true);
  expect(spatial.covers(clipped, point({ x: 6, y: 1, z: 0 }))).toBe(false);
  expect(intersectAreas(contact, rectangle([3, -1, 7, 5]))).not.toBeNull();
  expect(intersectAreas(rectangle([0, 0, 2, 2]), rectangle([2, 0, 4, 2]))).toBeNull();
});

it("unites an enclosed island after filling the surrounding region's small hole", () => {
  const { state } = fixture();
  const outer = rectangle([0, 0, 1000, 1000]) as import("geojson").Polygon;
  const hole = rectangle([300, 300, 700, 700]) as import("geojson").Polygon;
  const island = rectangle([400, 400, 600, 600]) as import("geojson").Polygon;
  const shape: import("geojson").Geometry = {
    type: "MultiPolygon",
    coordinates: [[outer.coordinates[0], hole.coordinates[0]], island.coordinates],
  };
  const result = fillSmallHoles(state, shape, 1e7, () => false);
  expect(result.type).toBe("Polygon");
  expect(spatial.area(result)).toBe(1e6);
});

function fixture(bounds: Bounds = [0, 0, 2000, 1000], cylinder = false) {
  const state = landscape(),
    footprint = rectangle(bounds),
    scope = { ...state.domain.scope, footprint },
    mesh = createWorldMesh(bounds, 64, 0, undefined, undefined, undefined, cylinder, cylinder);
  state.domain.scope = scope;
  state.domain.world.reference.domain = footprint;
  state.domain.world.areas.area.footprint = footprint;
  state.surface = createGrid("contour-fixture", scope, 5, 3);
  const map = createField(mesh);
  state.physical = {
    map,
    profile: atlasPhysicalProfile({}, {}, map.scale),
    samples: residentBand("int32", new Int32Array(state.surface.active.length)),
    grid: state.surface.coverage,
    fixed: [],
    inherited: false,
  };
  return { state, mesh };
}
const liveCells = (mesh: ReturnType<typeof createWorldMesh>) =>
  Array.from({ length: mesh.count }, (_, i) => i).filter((i) => mesh.membership(i) !== 0);
it.each(["membership", "combined"])(
  "keeps %s geography local on a cylindrical world, including its seam",
  (mode) => {
    const { state, mesh } = fixture([0, 0, 4000, 2000], true);
    for (const cell of liveCells(mesh)) {
      const own = (i: number) => Number(i === cell);
      const shape =
        mode === "membership"
          ? membershipContour(state, [cell], own)
          : combinedContour(state, [cell], [own], ([value]) => value - 0.1);
      expect(shape, `${mode} cell ${cell}`).not.toBeNull();
      const covered = spatial.pointCoverage(shape!);
      for (const other of liveCells(mesh))
        expect(
          covered({ x: mesh.x(other) + mesh.origin[0], y: mesh.y(other) + mesh.origin[1], z: 0 }),
          `${mode} ${cell} covering ${other}`
        ).toBe(cell === other);
    }
  }
);

it("closes a combined contour when only its interpolation support touches the mesh edge", () => {
  const { state, mesh } = fixture(),
    // An interior cell whose neighbour lies on the mesh edge.
    cell = liveCells(mesh).find(
      (i) =>
        !mesh.boundary(i) &&
        Array.from({ length: 3 }, (_, edge) => mesh.neighbor(i, edge)).some((j) => mesh.boundary(j))
    )!;
  expect(cell).toBeDefined();
  expect(mesh.boundary(cell)).toBe(false);
  expect(
    Array.from({ length: 3 }, (_, edge) => mesh.neighbor(cell, edge)).some((i) => mesh.boundary(i))
  ).toBe(true);
  const shape = combinedContour(state, [cell], [(i) => Number(i === cell)], ([own]) => own - 0.1)!;
  expect(shape).not.toBeNull();
  expect(spatial.area(shape)).toBeGreaterThan(0);
  expect(
    spatial.covers(
      shape,
      point({ x: mesh.x(cell) + mesh.origin[0], y: mesh.y(cell) + mesh.origin[1], z: 0 })
    )
  ).toBe(true);
});

it.each(["membership", "combined"])(
  "closes %s contours at every cell, including edges, corners and both triangle orientations",
  (mode) => {
    const { state, mesh } = fixture();
    for (const cell of liveCells(mesh)) {
      const includes = (i: number) => Number(i === cell);
      const shape =
        mode === "membership"
          ? membershipContour(state, [cell], includes)
          : combinedContour(state, [cell], [includes], ([own]) => own - 0.1);
      expect(shape, `${mode} cell ${cell}`).not.toBeNull();
      expect(spatial.area(shape!)).toBeGreaterThan(0);
      expect(
        spatial.covers(
          shape!,
          point({ x: mesh.x(cell) + mesh.origin[0], y: mesh.y(cell) + mesh.origin[1], z: 0 })
        ),
        `${mode} centre ${cell}`
      ).toBe(true);
    }
  }
);

it.each([
  { bounds: [0, 0, 2_000_000, 1_000_000] as Bounds },
  { bounds: [30_000_000, -20_000_000, 32_000_000, -19_000_000] as Bounds },
])("closes translated and large-coordinate contours in %j", ({ bounds }) => {
  const { state, mesh } = fixture(bounds),
    includes = (i: number) => Number(i === 2);
  const shape = combinedContour(state, [2], [includes], ([own]) => own - 0.1)!;
  expect(shape).not.toBeNull();
  expect(spatial.area(shape)).toBeGreaterThan(0);
  const at = membershipSampler(state, includes);
  for (const i of liveCells(mesh)) {
    const x = mesh.x(i) + mesh.origin[0],
      y = mesh.y(i) + mesh.origin[1];
    expect(spatial.covers(shape, point({ x, y, z: 0 }))).toBe(at(x, y) > 0.1);
  }
});

it("leaves empty and exact-threshold regions empty", () => {
  const { state } = fixture();
  expect(membershipContour(state, [2], () => 0)).toBeNull();
  expect(combinedContour(state, [2], [() => 0.1], ([value]) => value - 0.1)).toBeNull();
});

it("closes a membership region whose original cells all avoid the boundary", () => {
  const { state, mesh } = fixture(),
    members = liveCells(mesh).filter((i) => !mesh.boundary(i)),
    selected = new Set(members);
  const shape = membershipContour(state, members, (i) => Number(selected.has(i)))!;
  expect(shape).not.toBeNull();
  for (const i of members)
    expect(
      spatial.covers(
        shape,
        point({ x: mesh.x(i) + mesh.origin[0], y: mesh.y(i) + mesh.origin[1], z: 0 })
      )
    ).toBe(true);
});

it("retains separate pieces and combines independent field terms near the boundary", () => {
  const { state, mesh } = fixture([0, 0, 2_000_000, 1_000_000]),
    members = liveCells(mesh).filter((i) => !mesh.boundary(i)),
    selected = new Set(members),
    own = (i: number) => Number(selected.has(i)),
    bands = (i: number) => Math.abs(mesh.x(i)) - 250_000;
  const shape = combinedContour(state, members, [own, bands], ([membership, band]) =>
    Math.min(membership - 0.1, band)
  )!;
  expect(shape.type).toBe("MultiPolygon");
  for (const i of members) {
    const x = mesh.x(i) + mesh.origin[0],
      y = mesh.y(i) + mesh.origin[1];
    expect(spatial.covers(shape, point({ x, y, z: 0 }))).toBe(bands(i) > 0);
  }
});
