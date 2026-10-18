import { geometrySchema, requireThat, type ParameterValues } from "@atlas/domain";
import type { GenerationJob, RunRecord, RunStatus } from "@atlas/generation";
import { processConfigurationSchema } from "@atlas/generation";
import { Database, insertRows, integer, ownedVersion, type Sql } from "./database";
import { contentHash, readValues, writeValues } from "./typedValues";
import { readJobSequence, writeJobConfiguration } from "./jobConfiguration";

interface JobRow {
  id: string;
  world_id: string;
  operation_id: string;
  request_hash: string;
  input_version: string;
  area_id: string;
  space_id: string;
  footprint: string;
  crs_id: string;
  time_context: string;
  resolution: number | null;
  configuration_id: string;
  configuration_version: number;
  parameters: string;
  profile: GenerationJob["profile"]["id"];
  variant: string;
  seed: string;
  seed_scope: string;
  output_layers: string[];
  status: RunStatus;
  stage: string;
  progress: number;
  cancel_requested: boolean;
  attempt: number;
  error_code: string | null;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
}
function record(r: JobRow): RunRecord {
  return {
    id: r.id,
    worldId: r.world_id,
    operationId: r.operation_id,
    status: r.status,
    stage: r.stage,
    progress: r.progress,
    cancelRequested: r.cancel_requested,
    attempt: r.attempt,
    error: r.error_code ? { code: r.error_code, message: r.error_message ?? r.error_code } : null,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}
async function row(sql: Sql, world: string, id: string): Promise<JobRow> {
  const result = await sql.query<JobRow>(
    "SELECT *,ST_AsGeoJSON(footprint,15) AS footprint FROM atlas_runs WHERE world_id=$1 AND id=$2",
    [world, id]
  );
  requireThat(result.rowCount === 1, "not_found", "Generation job not found.");
  return result.rows[0];
}
async function writeJob(sql: Sql, owner: string, job: GenerationJob, hash: string) {
  const s = job.scope,
    c = job.configuration;
  const parameters = await writeValues(sql, s.worldId, c.parameters, "parameters", c.id, c.version);
  await insertRows(
    sql,
    "atlas_runs",
    [
      "id",
      "world_id",
      "operation_id",
      "actor",
      "request_hash",
      "input_version",
      "area_id",
      "space_id",
      "footprint",
      "crs_id",
      "time_context",
      "resolution",
      "profile",
      "variant",
      "parameters",
      "seed",
      "seed_scope",
      "configuration_id",
      "configuration_version",
      "output_layers",
      "status",
      "stage",
    ],
    [
      [
        job.id,
        s.worldId,
        job.operationId,
        `user:${owner}`,
        hash,
        s.revision,
        s.areaId,
        s.spaceId,
        JSON.stringify(s.footprint),
        s.crsId,
        s.time,
        s.resolution,
        job.profile.id,
        job.profile.variant,
        parameters,
        job.seed,
        job.seedScope,
        c.id,
        c.version,
        job.outputLayers,
        "queued",
        "queued",
      ],
    ],
    ["footprint"]
  );
  await writeJobConfiguration(sql, s.worldId, job.id, c);
  await insertRows(
    sql,
    "atlas_run_input_revisions",
    ["run_id", "scope_id", "object_id", "kind", "revision_id", "version"],
    job.reads.map((r) => [job.id, s.worldId, r.id, r.kind, r.revisionId, r.version])
  );
}

export class JobRepository {
  constructor(private readonly database: Database) {}
  async submit(world: string, owner: string, input: GenerationJob): Promise<RunRecord> {
    const job = structuredClone(input);
    job.configuration = processConfigurationSchema.parse(job.configuration);
    const hash = contentHash({ ...job, id: null });
    return this.database.transaction(async (sql) => {
      const version = await ownedVersion(sql, world, owner, true);
      const previous = await sql.query<JobRow>(
        "SELECT * FROM atlas_runs WHERE world_id=$1 AND operation_id=$2",
        [world, job.operationId]
      );
      if (previous.rowCount) {
        requireThat(
          previous.rows[0].request_hash === hash,
          "idempotency_conflict",
          "Job identity has different inputs."
        );
        return record(previous.rows[0]);
      }
      requireThat(
        job.scope.worldId === world && job.scope.revision === version,
        "stale_version",
        "The world changed before job submission."
      );
      await writeJob(sql, owner, job, hash);
      return record(await row(sql, world, job.id));
    });
  }
  async inspect(world: string, owner: string, id: string) {
    return this.database.transaction(async (sql) => {
      await ownedVersion(sql, world, owner);
      const r = await row(sql, world, id);
      const parameters = (await readValues(sql, world, [r.parameters])).get(
        r.parameters
      ) as ParameterValues;
      const revisions = await sql.query<{
        kind: GenerationJob["reads"][number]["kind"];
        object_id: string;
        revision_id: string;
        version: string;
      }>("SELECT * FROM atlas_run_input_revisions WHERE run_id=$1 ORDER BY kind,object_id", [id]);
      const job: GenerationJob = {
        id,
        operationId: r.operation_id,
        scope: {
          worldId: world,
          areaId: r.area_id,
          spaceId: r.space_id,
          footprint: geometrySchema.parse(JSON.parse(r.footprint)),
          crsId: r.crs_id,
          time: r.time_context,
          resolution: r.resolution,
          revision: integer(r.input_version),
        },
        profile: { id: r.profile, variant: r.variant },
        seed: r.seed,
        seedScope: r.seed_scope,
        outputLayers: r.output_layers,
        reads: revisions.rows.map((v) => ({
          kind: v.kind,
          id: v.object_id,
          revisionId: v.revision_id,
          version: integer(v.version),
        })),
        configuration: {
          id: r.configuration_id,
          version: r.configuration_version,
          parameters,
          sequence: await readJobSequence(sql, world, id),
        },
      };
      return { record: record(r), job };
    }, true);
  }
  async cancel(world: string, owner: string, id: string): Promise<RunRecord> {
    return this.database.transaction(async (sql) => {
      await ownedVersion(sql, world, owner);
      await sql.query(
        `UPDATE atlas_runs SET cancel_requested=true,status=CASE WHEN status IN ('queued','paused') THEN 'cancelled' ELSE 'cancelling' END,
        updated_at=now() WHERE world_id=$1 AND id=$2 AND status IN ('queued','running','paused')`,
        [world, id]
      );
      return record(await row(sql, world, id));
    });
  }
  /** Recovery reruns from the saved input version/configuration/seed. */
  async restart(world: string, owner: string, id: string): Promise<RunRecord> {
    return this.database.transaction(async (sql) => {
      await ownedVersion(sql, world, owner);
      const result = await sql.query(
        `UPDATE atlas_runs SET status='queued',stage='queued',progress=0,cancel_requested=false,
        error_code=NULL,error_message=NULL,attempt=attempt+1,updated_at=now() WHERE world_id=$1 AND id=$2 AND status IN ('failed','cancelled','paused') RETURNING id`,
        [world, id]
      );
      requireThat(result.rowCount === 1, "job_state", "Restart an interrupted or failed job.");
      return record(await row(sql, world, id));
    });
  }
}
