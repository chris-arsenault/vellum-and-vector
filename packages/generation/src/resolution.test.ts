import { expect, it } from "vitest";
import { defaultTerrainCells, generationResolution, generationWorkload } from "./resolution";
import { createWorldMesh } from "./world/worldMesh";
import { createAtlasWorkspace } from "./world/atlasWorkspace";
import { landscape } from "./mapFixtures";
import { createGrid, rectangle } from "@atlas/domain";

it("resolves physical cell area and warns only above the default workload", () => {
  expect(generationResolution("standard").cellAreaKm2).toBe(200);
  expect(generationWorkload(4_000_000, 3_000_000, "standard")).toMatchObject({
    cells: defaultTerrainCells,
    aboveDefault: false,
  });
  expect(generationWorkload(4_000_000, 3_000_000, "fine")).toMatchObject({
    cells: 240000,
    aboveDefault: true,
  });
  expect(generationWorkload(40_000_000, 20_000_000, "fine")).toMatchObject({
    cellAreaKm2: 50,
    cells: 16000000,
    aboveDefault: true,
  });
  expect(() => generationResolution("unknown")).toThrow("Choose draft");
});

it("estimates change with both dimensions and with the chosen creation profile", () => {
  expect(generationWorkload(2_000_000, 3_000_000, "standard").cells).toBe(30000);
  expect(generationWorkload(4_000_000, 1_500_000, "standard").cells).toBe(30000);
  expect(generationWorkload(100_000, 100_000, "standard", "region").cells).toBe(5000);
  expect(generationResolution("standard", "interior").cellArea).toBeCloseTo(2);
});

it("keeps physical mesh spacing constant when a larger rectangle requests more cells", () => {
  const area = generationResolution("draft").cellArea;
  const meshes = [1, 2].map((scale) =>
    createWorldMesh([0, 0, 200_000 * scale, 100_000], (200_000 * scale * 100_000) / area, 0)
  );
  expect(meshes[1].spacing).toBeCloseTo(meshes[0].spacing, 8);
  expect(meshes[1].contentCount).toBeGreaterThan(meshes[0].contentCount);
});

it("builds world and child maps on the same lattice, the child at its own cell span with a narrow halo", () => {
  const state = landscape();
  const workspaces = [1, 2].map((scale) => {
    const footprint = rectangle([0, 0, 200_000 * scale, 100_000]);
    state.domain.scope.footprint = footprint;
    state.domain.world.areas.area.footprint = footprint;
    state.domain.world.reference.domain = footprint;
    state.surface = createGrid("workspace", state.domain.scope, 2, 2);
    return createAtlasWorkspace(state, "draft");
  });
  expect(workspaces[1].map.mesh.spacing).toBeCloseTo(workspaces[0].map.mesh.spacing, 8);
  expect(workspaces[1].map.mesh.contentCount).toBeGreaterThan(workspaces[0].map.mesh.contentCount);

  const footprint = rectangle([0, 0, 100, 100]);
  state.domain.scope.footprint = footprint;
  state.domain.world.areas.area.footprint = footprint;
  state.domain.world.areas.area.profile = "site";
  state.surface = createGrid("child", state.domain.scope, 2, 2);
  const mesh = createAtlasWorkspace(state, "draft").map.mesh;
  const cellArea = generationResolution("draft", "site").cellArea;
  // One lattice class for every map; the child's cells are uniform at about its own cell
  // area (a footprint of a few cells rounds to whole cells).
  expect(mesh.constructor).toBe(workspaces[0].map.mesh.constructor);
  expect(mesh.contentCount).toBeGreaterThan(1);
  const content = Array.from({ length: mesh.count }, (_, i) => i).filter(
    (i) => mesh.membership(i) === 1
  );
  for (const i of content) expect(mesh.area(i)).toBe(mesh.area(content[0]));
  expect(Math.abs(mesh.area(content[0]) / cellArea - 1)).toBeLessThan(0.3);
  // The halo is a few of the child's own cells, not the world's 100 km padding at site
  // spacing (tens of millions of cells).
  expect(mesh.count).toBeLessThan(defaultTerrainCells);
});
