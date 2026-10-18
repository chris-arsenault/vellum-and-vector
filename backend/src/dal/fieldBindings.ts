import {
  materializationStates,
  type FieldRef,
  type ResourceReference,
  type SpatialScope,
  geometrySchema,
  requireThat,
} from "@atlas/domain";
import { asRevision, insertRows, type Sql } from "./database";
import { readFieldArtifact } from "./fieldArtifacts";
import type { Revised } from "./objectWriters";

export async function readFieldBindings(
  sql: Sql,
  world: string,
  version: number,
  areas: string[],
  ids: string[],
  layers: string[] = []
) {
  const result = await sql.query<{
    id: string;
    revision_id: string;
    valid_from: string;
    area_id: string;
    layer_id: string;
    algorithm: string;
    source_run_id: string | null;
    source_operation_id: string | null;
    samples: number;
    channels: string[] | null;
    resource_id: string | null;
    footprint: string | null;
    space_id: string;
    state: (typeof materializationStates)[number];
  }>(
    `SELECT *, (SELECT ST_AsGeoJSON(r.footprint,15) FROM atlas_field_artifacts r WHERE r.world_id=atlas_field_references.scope_id AND r.id=atlas_field_references.resource_id) AS footprint,
    (SELECT a.space_id FROM atlas_areas a WHERE a.scope_id=atlas_field_references.scope_id AND a.id=atlas_field_references.area_id AND a.valid_from<=$2 AND (a.valid_to IS NULL OR a.valid_to>$2)) AS space_id
    FROM atlas_field_references WHERE scope_id=$1 AND valid_from<=$2 AND (valid_to IS NULL OR valid_to>$2)
    AND (id=ANY($3::uuid[]) OR area_id=ANY($4::uuid[]) OR layer_id=ANY($5::text[])) ORDER BY ordinal,id`,
    [world, version, ids, areas, layers]
  );
  return {
    objects: Object.fromEntries(
      result.rows.map((r) => [
        r.id,
        {
          id: r.id,
          areaId: r.area_id,
          layerId: r.layer_id,
          algorithm: r.algorithm,
          source: r.source_run_id
            ? { kind: "run", id: r.source_run_id }
            : { kind: "operation", id: r.source_operation_id! },
          samples: r.samples,
          channels: r.channels,
          resourceId: r.resource_id,
          state: r.state,
          spaceId: r.space_id,
          ...(r.footprint ? { footprint: geometrySchema.parse(JSON.parse(r.footprint)) } : {}),
        } satisfies FieldRef,
      ])
    ),
    revisions: result.rows.map((r) => asRevision("field", r)),
  };
}
export async function readContextFields(sql: Sql, scope: SpatialScope, ancestors: string[]) {
  const nearby = await sql.query<{ id: string }>(
    `SELECT f.id FROM atlas_field_references f JOIN atlas_areas a ON a.scope_id=f.scope_id AND a.id=f.area_id
    AND a.valid_from<=$2 AND (a.valid_to IS NULL OR a.valid_to>$2)
    LEFT JOIN atlas_field_artifacts r ON r.world_id=f.scope_id AND r.id=f.resource_id
    WHERE f.scope_id=$1 AND f.valid_from<=$2 AND (f.valid_to IS NULL OR f.valid_to>$2) AND a.space_id=$3
    AND ST_Intersects(COALESCE(r.footprint,a.footprint),ST_SetSRID(ST_GeomFromGeoJSON($4::text),0))`,
    [scope.worldId, scope.revision, scope.spaceId, JSON.stringify(scope.footprint)]
  );
  const bindings = await readFieldBindings(
    sql,
    scope.worldId,
    scope.revision,
    ancestors,
    nearby.rows.map((r) => r.id)
  );
  return Object.values(bindings.objects).filter((f) => f.spaceId === scope.spaceId);
}
export async function writeFieldBindings(
  sql: Sql,
  world: string,
  version: number,
  values: Revised<FieldRef & { resourceId: string }>[]
) {
  await insertRows(
    sql,
    "atlas_field_references",
    [
      "revision_id",
      "scope_id",
      "id",
      "valid_from",
      "ordinal",
      "area_id",
      "layer_id",
      "algorithm",
      "source_run_id",
      "source_operation_id",
      "samples",
      "channels",
      "resource_id",
      "state",
    ],
    values.map(({ revision, value: f }, i) => [
      revision,
      world,
      f.id,
      version,
      i,
      f.areaId,
      f.layerId,
      f.algorithm,
      f.source.kind === "run" ? f.source.id : null,
      f.source.kind === "operation" ? f.source.id : null,
      f.samples,
      f.channels,
      f.resourceId,
      f.state ?? "generated",
    ])
  );
}
export async function boundFieldResource(
  sql: Sql,
  scope: SpatialScope,
  field: FieldRef
): Promise<{ reference: ResourceReference; gridId: string }> {
  requireThat(field.resourceId, "missing_field", "A bound field requires its immutable numerical artifact.");
  return readFieldArtifact(sql, scope.worldId, field.resourceId, scope.revision);
}
