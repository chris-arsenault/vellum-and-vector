import { expect, it } from "vitest";
import type { AtlasFeature, CatalogChanges, ResourceStore, WorkspaceChange } from "@atlas/domain";
import { createRequestScheduler } from "./requestScheduler";
import { publishWorkspaceGeneration } from "./generationPublication";
import { createWorldSnapshot } from "./worldCreation";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function generated(areaId: string, n: number): AtlasFeature {
  return {
    id: crypto.randomUUID(),
    areaId,
    name: `Site ${n}`,
    kind: "poi",
    layerId: "pois",
    geometry: { type: "Point", coordinates: [10 + n, 20] },
    attributes: {},
    relations: [],
    detail: {},
    causes: [],
    protected: false,
    actor: "generator",
    state: "generated",
    generationId: null,
  };
}
/**
 * Finding 7: publication shares the catalog worker with the editor. Each batch is one bulk
 * request, so a scene read that arrives during a publication waits for the batch in flight
 * and never for the rest of the backlog.
 */
it("lets a scene read through after at most the publication batch in flight", async () => {
  const scheduler = createRequestScheduler(),
    original = createWorldSnapshot({ name: "Busy world", seed: 3, width: 1000, height: 1000 }),
    snapshot = structuredClone(original),
    areaId = original.scope.areaId;
  for (let n = 0; n < 600; n++) {
    const feature = generated(areaId, n);
    snapshot.world.features[feature.id] = feature;
  }
  const sizes: number[] = [],
    order: string[] = [];
  let revision = original.world.version,
    readQueued = false;
  const workspace = {
    commit: (changes: CatalogChanges) =>
      new Promise<WorkspaceChange>((resolve) => {
        scheduler.enqueue("bulk", async () => {
          sizes.push(changes.writes.length);
          order.push(`batch ${sizes.length}`);
          if (!readQueued) {
            // While the first batch runs, render traffic queues behind it and the editor asks
            // for its scene.
            readQueued = true;
            for (let k = 0; k < 3; k++)
              scheduler.enqueue("bulk", async () => {
                order.push("render");
              });
            scheduler.enqueue("interactive", async () => {
              order.push("scene read");
            });
          }
          await tick();
          resolve({ revision: ++revision } as WorkspaceChange);
        });
      }),
    beginPublication: () => Promise.reject(new Error("Initial publication commits batches.")),
    appendPublication: () => Promise.reject(new Error("unused")),
    finishPublication: () => Promise.reject(new Error("unused")),
    discardPublication: () => Promise.resolve(),
  };
  await publishWorkspaceGeneration(
    workspace as never,
    {} as ResourceStore,
    original,
    snapshot,
    crypto.randomUUID(),
    true,
    [],
    () => {}
  );
  const writes = sizes.reduce((sum, size) => sum + size, 0);
  expect(writes).toBeGreaterThanOrEqual(600);
  expect(sizes.length).toBeGreaterThan(4);
  expect(Math.max(...sizes)).toBeLessThanOrEqual(128);
  // The read arrived during batch 1; it runs next, ahead of the render backlog and batch 2.
  expect(order.slice(0, 2)).toEqual(["batch 1", "scene read"]);
});
