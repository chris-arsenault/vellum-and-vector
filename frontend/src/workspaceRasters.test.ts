import { expect, it } from "vitest";
import { rectangle, spatial } from "@atlas/domain";
import { generationSnapshot } from "@atlas/generation";
import { constructedWorld } from "./constructedWorldFixture";
import {
  registerWorldSnapshot,
  readMapRasters,
  fixtureWorkspace,
} from "./testSupport/workspaceFixture";

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

it("keeps parent raster geography current without invalidating it for an independent child", async () => {
  const f = constructedWorld(),
    snapshot = generationSnapshot(f.result, f.input, crypto.randomUUID());
  registerWorldSnapshot(snapshot);
  const before = await readMapRasters(snapshot.world.id, snapshot.scope.areaId),
    { catalog } = await fixtureWorkspace(snapshot.world.id),
    child = {
      ...structuredClone(snapshot.world.areas[snapshot.scope.areaId]),
      id: crypto.randomUUID(),
      parentId: snapshot.scope.areaId,
      map: { sourceAreaId: snapshot.scope.areaId, sourceRevision: snapshot.world.version },
    };
  await catalog.commit({
    operationId: crypto.randomUUID(),
    worldId: snapshot.world.id,
    expected: [{ kind: "area", id: child.id, revision: 0 }],
    writes: [
      {
        scope: { ...snapshot.scope, areaId: child.id },
        reference: { kind: "area", id: child.id, revision: 0 },
        data: { kind: "area", value: child },
      },
    ],
    removes: [],
    resources: [],
  });
  const after = await readMapRasters(snapshot.world.id, snapshot.scope.areaId);
  expect(after).toEqual(before);
});
