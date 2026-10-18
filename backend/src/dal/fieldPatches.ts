import { geometrySchema, type FieldPatch, type SpatialScope } from "@atlas/domain";
import { asRevision, integer, insertRows, type Sql } from "./database";
import type { Revised } from "./objectWriters";

export async function readFieldPatches(
  sql: Sql,
  world: string,
  version: number,
  fields: string[],
  scope: SpatialScope | null,
  ids: string[] = []
) {
  const rows = await sql.query<{
    id: string;
    revision_id: string;
    valid_from: string;
    field_id: string;
    area_id: string;
    space_id: string;
    footprint: string;
    channels: string[];
    actor: string;
    resource_id: string;
    protected: boolean;
    created_version: string;
  }>(
    `SELECT *,ST_AsGeoJSON(footprint,15) AS footprint FROM atlas_field_patches
      WHERE scope_id=$1 AND valid_from<=$2 AND (valid_to IS NULL OR valid_to>$2)
      AND (id=ANY($3::uuid[]) OR (field_id=ANY($4::uuid[]) AND ($5::uuid IS NULL OR space_id=$5)
        AND ($6::text IS NULL OR ST_Intersects(footprint,ST_SetSRID(ST_GeomFromGeoJSON($6::text),0)))))
      ORDER BY created_version,id`,
    [
      world,
      version,
      ids,
      fields,
      scope?.spaceId ?? null,
      scope ? JSON.stringify(scope.footprint) : null,
    ]
  );
  return {
    objects: Object.fromEntries(
      rows.rows.map((r) => [
        r.id,
        {
          id: r.id,
          fieldId: r.field_id,
          areaId: r.area_id,
          spaceId: r.space_id,
          footprint: geometrySchema.parse(JSON.parse(r.footprint)),
          channels: r.channels,
          actor: r.actor,
          resourceId: r.resource_id,
          protected: r.protected,
          createdVersion: integer(r.created_version),
        } satisfies FieldPatch,
      ])
    ),
    revisions: rows.rows.map((r) => asRevision("fieldPatch", r)),
  };
}
export async function writeFieldPatches(
  sql: Sql,
  world: string,
  version: number,
  patches: Revised<FieldPatch>[]
) {
  await insertRows(
    sql,
    "atlas_field_patches",
    [
      "revision_id",
      "scope_id",
      "id",
      "valid_from",
      "world_id",
      "field_id",
      "version",
      "area_id",
      "space_id",
      "footprint",
      "channels",
      "actor",
      "resource_id",
      "protected",
      "created_version",
    ],
    patches.map(({ revision, value: p }) => [
      revision,
      world,
      p.id,
      version,
      world,
      p.fieldId,
      version,
      p.areaId,
      p.spaceId,
      JSON.stringify(p.footprint),
      p.channels,
      p.actor,
      p.resourceId,
      p.protected,
      p.createdVersion,
    ]),
    ["footprint"]
  );
}
