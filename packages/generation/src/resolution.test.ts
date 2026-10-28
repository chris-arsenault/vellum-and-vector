import { expect, it } from "vitest";
import { defaultTerrainCells, generationResolution, generationWorkload } from "./resolution";
import { createWorldMesh } from "./canonry/worldMesh";
import { createAtlasWorkspace } from "./canonry/atlasWorkspace";
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
  expect((meshes[0].spacing ** 2 * 3 * Math.sqrt(3)) / 4).toBeCloseTo(area, 4);
});

it("uses the physical preset in the actual workspace and refines a child without refining its exterior halo", () => {
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
  expect(workspaces[0].sampling.maximumSize).toBe(generationResolution("draft").cellSpan);

  const footprint = rectangle([0, 0, 100, 100]);
  state.domain.scope.footprint = footprint;
  state.domain.world.areas.area.footprint = footprint;
  state.domain.world.areas.area.profile = "site";
  state.surface = createGrid("child", state.domain.scope, 2, 2);
  const mesh = createAtlasWorkspace(state, "draft").map.mesh;
  const cellSpan = generationResolution("draft", "site").cellSpan;
  expect(mesh.topology).not.toBeNull();
  expect(mesh.contentCount).toBeGreaterThan(1);
  for (let i = 0; i < mesh.count; i++) {
    if (mesh.membership(i) !== 1) continue;
    expect(mesh.cellWidth(i)).toBeLessThanOrEqual(cellSpan);
    expect(mesh.cellHeight(i)).toBeLessThanOrEqual(cellSpan);
  }
  // The existing 100 km inherited halo remains coarse instead of creating millions of site cells.
  expect(mesh.count).toBeLessThan(1000);
});
