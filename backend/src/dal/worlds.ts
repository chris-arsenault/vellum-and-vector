import {
  requireThat,
  referenceSchema,
  validateAreaPlacement,
  spatial,
  type Area,
  type Layer,
  type World,
} from "@atlas/domain";
import { Database, integer, registerObjects, type Sql } from "./database";
import { writeWorldHeader, readWorldHeader } from "./worldHeader";
import { applyWrites } from "./changeWriter";
import { contentHash } from "./typedValues";
import { existingOperation, writeOperation } from "./operations";

export interface CreateWorld {
  id: string;
  name: string;
  seed: number;
  reference: World["reference"];
  root: Area;
  layers: Layer[];
}
export class WorldRepository {
  constructor(private readonly database: Database) {}
  async create(owner: string, operationId: string, input: CreateWorld) {
    const hash = contentHash(input);
    return this.database.transaction(async (sql) => {
      await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `world:${input.id}`,
      ]);
      const existing = await sql.query<{ owner: string }>(
        "SELECT owner FROM atlas_worlds WHERE id=$1",
        [input.id]
      );
      if (existing.rowCount) {
        requireThat(existing.rows[0].owner === owner, "not_found", "World not found.");
        const result = await existingOperation(sql, input.id, operationId, hash);
        requireThat(
          result,
          "identity_conflict",
          "World identity belongs to another creation operation."
        );
        return result;
      }
      const world = initialWorld(owner, input);
      await sql.query("INSERT INTO atlas_scopes(id,owner,kind) VALUES($1,$2,'world')", [
        world.id,
        owner,
      ]);
      await sql.query("INSERT INTO atlas_worlds(id,owner,name,version) VALUES($1,$2,$3,1)", [
        world.id,
        owner,
        world.name,
      ]);
      await writeWorldHeader(sql, world);
      if (input.root.id !== world.id)
        await registerObjects(sql, world.id, [{ id: world.id, kind: "world" }]);
      await writeCreation(sql, world, operationId, hash, input);
      return (await existingOperation(sql, world.id, operationId, hash))!;
    });
  }
  async list(owner: string) {
    return this.database.transaction(async (sql) => {
      const rows = await sql.query<{
        id: string;
        name: string;
        version: string;
        updated_at: Date;
        root_id: string;
      }>(
        `SELECT w.*,
        (SELECT a.id FROM atlas_areas a WHERE a.scope_id=w.id AND a.parent_id IS NULL AND a.valid_to IS NULL LIMIT 1) AS root_id
        FROM atlas_worlds w WHERE owner=$1 ORDER BY updated_at DESC,id`,
        [owner]
      );
      return rows.rows.map((w) => ({
        id: w.id,
        name: w.name,
        version: integer(w.version),
        rootAreaId: w.root_id,
        updatedAt: w.updated_at.toISOString(),
      }));
    }, true);
  }
}
function initialWorld(owner: string, input: CreateWorld): World {
  const reference = referenceSchema.parse({
    ...input.reference,
    version: input.reference.version ?? 1,
    precision: input.reference.precision ?? 0.000001,
  });
  validateAreaPlacement({ id: input.id, reference, areas: {} }, input.root);
  requireThat(
    input.root.parentId === null &&
      input.root.profile === "world" &&
      spatial.covers(reference.domain, input.root.footprint) &&
      spatial.covers(input.root.footprint, reference.domain),
    "world_root",
    "The root world area must cover its declared planar domain."
  );
  requireThat(
    Number.isSafeInteger(input.seed) && input.seed >= -2147483648 && input.seed <= 2147483647,
    "seed_range",
    "World seeds are signed 32-bit integers."
  );
  return {
    id: input.id,
    name: input.name,
    seed: input.seed,
    version: 1,
    owner,
    reference,
    areas: {},
    features: {},
    layers: {},
    fields: [],
    entities: {},
    templates: {},
    magic: [],
    epochs: [],
    humanEras: [],
    generations: [],
    views: [],
    connections: {},
  };
}
async function writeCreation(
  sql: Sql,
  world: World,
  operationId: string,
  hash: string,
  input: CreateWorld
) {
  const changes = await applyWrites(sql, world, {
    operationId,
    actor: `user:${world.owner}`,
    worldId: world.id,
    expectedVersion: 1,
    readSet: [],
    writes: [
      { kind: "area", value: input.root },
      ...input.layers.map((value) => ({ kind: "layer" as const, value })),
    ],
    removes: [],
    invalidations: [],
    highImpact: false,
  });
  await writeOperation(sql, {
    record: {
      worldId: world.id,
      operationId,
      version: 1,
      beforeVersion: 1,
      actor: `user:${world.owner}`,
      kind: "createWorld",
      requestHash: hash,
      commandVersion: 1,
      impact: {
        features: [],
        areas: [input.root.id],
        layers: input.layers.map((l) => l.id),
        invalidations: [],
        highImpact: false,
      },
    },
    parameters: { name: input.name, seed: input.seed },
    reads: [],
    scopes: [{ role: "write", spaceId: world.id, footprint: world.reference.domain }],
    changes: changes.objects,
    worldSettingsChanged: false,
  });
}

export async function currentWorldHeader(sql: Sql, world: string, owner: string): Promise<World> {
  const rows = await sql.query<{ version: string }>(
    "SELECT version FROM atlas_worlds WHERE id=$1 AND owner=$2",
    [world, owner]
  );
  requireThat(rows.rowCount === 1, "not_found", "World not found.");
  return readWorldHeader(sql, world, integer(rows.rows[0].version));
}
