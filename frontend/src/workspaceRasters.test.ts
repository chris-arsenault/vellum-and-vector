import { expect, it } from "vitest";
import { rectangle, spatial } from "@atlas/domain";
import { generationSnapshot } from "@atlas/generation";
import { constructedWorld } from "./constructedWorldFixture";
import { registerWorldSnapshot, readMapRasters } from "./testSupport/workspaceFixture";

it("displays an independent map's field beyond its starting outline", async () => {
  const f = constructedWorld(),
    snapshot = generationSnapshot(f.result, f.input, crypto.randomUUID()),
    child = snapshot.world.areas[f.input.areaId],
    parent = crypto.randomUUID();
  snapshot.world.areas[parent] = { ...structuredClone(child), id: parent };
  child.parentId = parent;
  child.map = { sourceAreaId: parent, sourceRevision: 1 };
  child.footprint = rectangle([500, 100, 3500, 900]);
  registerWorldSnapshot(snapshot);
  const rasters = await readMapRasters(snapshot.world.id, child.id),
    elevation = rasters.find((r) => r.channel === "elevation")!;
  expect(spatial.covers(elevation.footprint, rectangle([0, 0, 4000, 1000]))).toBe(true);
  expect(elevation.areaId).toBe(child.id);
});
