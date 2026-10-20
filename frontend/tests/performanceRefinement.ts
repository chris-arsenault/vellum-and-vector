import { rectangle } from "@atlas/domain";
import { commitCommand } from "../src/atlasCommands";
import { session, subscribe } from "../src/atlasState";
import { listJobs, startGeneration } from "../src/generationJobs";
import type { World } from "../src/types";

/** Exercise actual inherited generation and publication, without generating another world. */
export async function refineScene(world: World) {
  const root = Object.values(world.areas)[0];
  const created = commitCommand(world.id, {
    operationId: crypto.randomUUID(),
    expectedVersion: world.version,
    kind: "createArea",
    data: {
      parentId: root.id,
      name: "Performance coast",
      profile: "region",
      footprint: rectangle([0.4e6, 2e6, 0.6e6, 2.2e6]),
      frame: { ...root.frame, origin: { x: 0.4e6, y: 2e6, z: 0 } },
      approach: "manual",
      traits: [],
    },
  }).candidate;
  const area = Object.values(created.areas).find((a) => a.parentId === root.id)!;
  const operationId = crypto.randomUUID();
  await new Promise<void>((resolve, reject) => {
    const unsubscribe = subscribe(() => {
      const job = listJobs(world.id).find((j) => j.id === operationId);
      if (!job || job.status === "running") return;
      unsubscribe();
      if (job.status === "completed") resolve();
      else reject(new Error(job.error ?? job.status));
    });
    startGeneration(world.id, {
      areaId: area.id,
      seed: world.seed,
      quality: "draft",
      domains: ["physical"],
      expectedVersion: created.version,
      operationId,
    });
  });
  return { world: session(world.id).snapshot.world, area };
}
