import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { GenerationJob } from "@atlas/generation";
import { Database } from "./database";
import { JobRepository } from "./jobs";
import { testDatabase } from "../testDatabase";
import { createTestWorld } from "../testWorld";

it("freezes nested epoch configuration once and restarts a job from the same inputs", async () => {
  const db = await testDatabase();
  try {
    const database = new Database(db.client);
    const { world, scope } = await createTestWorld(database);
    const job = jobFixture(scope, world.id);
    const repository = new JobRepository(database);
    const record = await repository.submit(world.id, "alice", job);
    expect(record.status).toBe("queued");
    expect((await repository.inspect(world.id, "alice", record.id)).job).toEqual(job);
    job.configuration.parameters.temperature = 99;
    expect(
      (await repository.inspect(world.id, "alice", record.id)).job.configuration.parameters
        .temperature
    ).toBe(12);
    await expect(repository.submit(world.id, "alice", job)).rejects.toMatchObject({
      code: "idempotency_conflict",
    });
    await expect(repository.inspect(world.id, "bob", record.id)).rejects.toMatchObject({
      code: "not_found",
    });
    await repository.cancel(world.id, "alice", record.id);
    expect((await repository.restart(world.id, "alice", record.id)).attempt).toBe(2);
    expect(
      (await repository.inspect(world.id, "alice", record.id)).job.configuration.parameters
        .temperature
    ).toBe(12);
    const tables = await db.client.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND (tablename LIKE 'atlas_checkpoint%' OR tablename='atlas_workflow_nodes' OR tablename='atlas_resources')"
    );
    expect(tables.rows).toEqual([]);
    expect(
      (await db.client.query("SELECT rolsuper FROM pg_roles WHERE rolname=current_user")).rows[0]
        .rolsuper
    ).toBe(false);
    await expect(
      db.client.query("UPDATE atlas_runs SET seed='changed' WHERE id=$1", [record.id])
    ).rejects.toThrow("immutable");
  } finally {
    await db.close();
  }
});

function jobFixture(scope: GenerationJob["scope"], seedScope: string): GenerationJob {
  return {
    id: randomUUID(),
    operationId: randomUUID(),
    scope,
    profile: { id: "world", variant: "landscape" },
    seed: "42",
    seedScope,
    reads: [],
    outputLayers: ["terrain"],
    configuration: {
      id: "landscape",
      version: 1,
      parameters: { temperature: 12 },
      sequence: [
        {
          kind: "process",
          id: "base",
          process: "terrain.initialize",
          version: "1",
          parameters: { elevation: 100 },
        },
        {
          kind: "epochs",
          id: "physical",
          resetFacts: ["temperature"],
          epochs: [
            { id: "glacial", duration: 1000, parentEpoch: null, variables: { temperature: -12 } },
            { id: "present", duration: 200, parentEpoch: null, variables: { temperature: 12 } },
          ],
          body: [
            { kind: "process", id: "temperature", process: "climate.temperature", version: "1" },
            {
              kind: "epochs",
              id: "human",
              resetFacts: [],
              epochs: [
                {
                  id: "settled",
                  duration: 40,
                  parentEpoch: "present",
                  variables: { occupied: true },
                },
              ],
              body: [
                {
                  kind: "process",
                  id: "build",
                  process: "settlement.build",
                  version: "1",
                  when: { variable: "occupied", equals: true },
                },
              ],
            },
          ],
        },
      ],
    },
  };
}
