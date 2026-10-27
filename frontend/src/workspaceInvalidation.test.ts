import { expect, it } from "vitest";
import type { WorkspaceChange, Bounds } from "@atlas/domain";
import { workspaceQueryAffected } from "./workspaceInvalidation";

function change(overrides: Partial<WorkspaceChange> = {}): WorkspaceChange {
  return {
    worldId: "world",
    operationId: "edit",
    revision: 2,
    records: [{ kind: "area", id: "region", revision: 2 }],
    resources: [],
    extents: [{ spaceId: "surface", bounds: [0, 0, 100, 100] }],
    geometryExtents: [],
    ...overrides,
  };
}
const key = (kind: string, windows: Bounds[] = [[0, 0, 100, 100]]) => [
  kind,
  "world",
  "region",
  windows,
];

it("refreshes names and history without rebuilding scenes or terrain after a region rename", () => {
  const renamed = change();
  expect(workspaceQueryAffected(["worlds"], renamed)).toBe(true);
  expect(workspaceQueryAffected(key("history"), renamed)).toBe(true);
  expect(workspaceQueryAffected(key("registry"), renamed)).toBe(true);
  expect(workspaceQueryAffected(key("scene"), renamed)).toBe(false);
  expect(workspaceQueryAffected(key("fields"), renamed)).toBe(false);
  expect(workspaceQueryAffected(["scene", "another-world"], renamed)).toBe(false);
});
it("refreshes affected terrain for lake edits and field patches, including either side of a seam", () => {
  const lake = change({
    records: [{ kind: "feature", id: "lake", revision: 2 }],
    layers: ["lakes"],
  });
  expect(workspaceQueryAffected(key("fields"), lake)).toBe(true);
  expect(workspaceQueryAffected(key("scene"), lake)).toBe(true);
  expect(workspaceQueryAffected(key("fields", [[200, 0, 300, 100]]), lake)).toBe(false);
  expect(
    workspaceQueryAffected(
      key("fields", [
        [900, 0, 1000, 100],
        [0, 0, 100, 100],
      ]),
      lake
    )
  ).toBe(true);
  const patch = change({ records: [{ kind: "fieldPatch", id: "paint", revision: 2 }] });
  expect(workspaceQueryAffected(key("fields"), patch)).toBe(true);
  expect(workspaceQueryAffected(key("scene"), patch)).toBe(false);
});
it("rebuilds scenes and masks on footprint changes and accepts resource publications without an extent", () => {
  const footprint = change({ geometryExtents: [{ spaceId: "surface", bounds: [0, 0, 100, 100] }] });
  expect(workspaceQueryAffected(key("fields"), footprint)).toBe(true);
  expect(workspaceQueryAffected(key("scene"), footprint)).toBe(true);
  const published = change({ records: [], resources: ["terrain"], extents: [] });
  expect(workspaceQueryAffected(key("fields"), published)).toBe(true);
});
it("invalidates bulk publication and undo from changed kinds without a whole-world identity list", () => {
  const bulk = change({ records: [], recordKinds: ["feature", "fieldPatch"] });
  expect(workspaceQueryAffected(key("scene"), bulk)).toBe(true);
  expect(workspaceQueryAffected(key("fields"), bulk)).toBe(true);
  expect(workspaceQueryAffected(key("scene", [[200, 200, 300, 300]]), bulk)).toBe(false);
});
