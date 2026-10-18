import {
  geometrySchema,
  gridSchema,
  requireThat,
  sameValue,
  type Grid,
  type ResourceReference,
} from "@atlas/domain";
import { integer, insertRows, type Sql } from "./database";
import { writeGrid } from "./gridWriter";
import { readGrid } from "./gridReader";

interface ArtifactRow {
  id: string;
  world_id: string;
  revision: string;
  source_version: string;
  area_id: string;
  space_id: string;
  footprint: string;
  crs_id: string;
  time_context: string;
  resolution: number | null;
  grid_id: string;
  facts: string[];
  lineage: string[];
}

export async function readFieldArtifact(sql: Sql, world: string, id: string, version: number) {
  const result = await sql.query<ArtifactRow>(
    `SELECT a.*,ST_AsGeoJSON(a.footprint,15) AS footprint,
      ARRAY(SELECT input_id FROM atlas_field_sources WHERE resource_id=a.id ORDER BY ordinal) AS lineage
      FROM atlas_field_artifacts a WHERE a.world_id=$1 AND a.id=$2 AND a.published_version<=$3`,
    [world, id, version]
  );
  requireThat(
    result.rowCount === 1,
    "not_found",
    "Numerical artifact is unavailable in this revision."
  );
  const r = result.rows[0];
  const reference: ResourceReference = {
    id: r.id,
    kind: "field",
    schemaId: "atlas.grid",
    schemaVersion: 1,
    revision: r.revision,
    scope: {
      worldId: world,
      areaId: r.area_id,
      spaceId: r.space_id,
      footprint: geometrySchema.parse(JSON.parse(r.footprint)),
      crsId: r.crs_id,
      revision: integer(r.source_version),
      time: r.time_context,
      resolution: r.resolution,
    },
    unit: "grid",
    facts: r.facts,
    lineage: r.lineage,
  };
  return { reference, gridId: r.grid_id };
}

/** Called only inside the transaction publishing the owning domain operation. */
export async function publishField(
  sql: Sql,
  reference: ResourceReference,
  input: Grid,
  version: number
): Promise<void> {
  const grid = gridSchema.parse(input),
    s = reference.scope;
  requireThat(
    reference.kind === "field" &&
      reference.schemaId === "atlas.grid" &&
      reference.schemaVersion === 1 &&
      reference.unit === "grid" &&
      sameValue(grid.scope, s),
    "field_scope_mismatch",
    "A numerical field retains its typed grid scope."
  );
  // IDs are immutable. Operation idempotency is checked before this write; there
  // is no need to stringify/copy all samples to hash an already immutable grid.
  await writeGrid(sql, s.worldId, grid);
  await insertRows(
    sql,
    "atlas_field_artifacts",
    [
      "id",
      "world_id",
      "revision",
      "source_version",
      "area_id",
      "space_id",
      "footprint",
      "crs_id",
      "time_context",
      "resolution",
      "grid_id",
      "facts",
      "published_version",
    ],
    [
      [
        reference.id,
        s.worldId,
        reference.revision,
        s.revision,
        s.areaId,
        s.spaceId,
        JSON.stringify(s.footprint),
        s.crsId,
        s.time,
        s.resolution,
        grid.id,
        [...reference.facts].sort(),
        version,
      ],
    ],
    ["footprint"]
  );
  await insertRows(
    sql,
    "atlas_field_sources",
    ["world_id", "resource_id", "input_id", "mechanism", "ordinal"],
    reference.lineage.map((id, i) => [s.worldId, reference.id, id, "field-input", i])
  );
}

export async function loadField(
  sql: Sql,
  reference: ResourceReference,
  version: number
): Promise<Grid> {
  const artifact = await readFieldArtifact(sql, reference.scope.worldId, reference.id, version);
  requireThat(
    sameValue(artifact.reference, { ...reference, facts: [...reference.facts].sort() }),
    "field_revision_conflict",
    "The numerical artifact differs from its pinned reference."
  );
  return readGrid(sql, reference.scope.worldId, artifact.gridId, artifact.reference.scope);
}
