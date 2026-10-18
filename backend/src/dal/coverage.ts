import {
  geometrySchema,
  requireThat,
  type MaterializedCoverage,
  type SpatialScope,
} from "@atlas/domain";
import { asRevision, insertRows, type Sql } from "./database";
import type { Revised } from "./objectWriters";

interface CoverageRow {
  id: string;
  revision_id: string;
  valid_from: string;
  area_id: string;
  space_id: string;
  layer_id: string;
  detail_rank: number;
  resolution: number | null;
  time_context: string;
  footprint: string;
  state: MaterializedCoverage["state"];
  resource_id: string | null;
  generation_id: string | null;
}
export async function readCoverage(
  sql: Sql,
  world: string,
  version: number,
  selection: SpatialScope | null,
  ids: string[]
) {
  if (selection === null && !ids.length) return { objects: {}, revisions: [] };
  const rows = await sql.query<CoverageRow>(
    `SELECT *,ST_AsGeoJSON(footprint,15) AS footprint FROM atlas_materialized_coverage WHERE scope_id=$1
    AND valid_from<=$2 AND (valid_to IS NULL OR valid_to>$2) AND (id=ANY($3::uuid[]) OR (space_id=$4 AND time_context=$5 AND ST_Intersects(footprint,ST_SetSRID(ST_GeomFromGeoJSON($6::text),0)))) ORDER BY id`,
    [
      world,
      version,
      ids,
      selection?.spaceId ?? null,
      selection?.time ?? null,
      selection ? JSON.stringify(selection.footprint) : null,
    ]
  );
  return {
    objects: Object.fromEntries(
      rows.rows.map((r) => [
        r.id,
        {
          id: r.id,
          areaId: r.area_id,
          spaceId: r.space_id,
          layerId: r.layer_id,
          detailRank: r.detail_rank,
          resolution: r.resolution,
          time: r.time_context,
          footprint: geometrySchema.parse(JSON.parse(r.footprint)),
          state: r.state,
          resourceId: r.resource_id,
          generationId: r.generation_id,
        } satisfies MaterializedCoverage,
      ])
    ),
    revisions: rows.rows.map((r) => asRevision("coverage", r)),
  };
}
export async function writeCoverage(
  sql: Sql,
  world: string,
  version: number,
  values: Revised<MaterializedCoverage>[]
) {
  for (const { value: c, revision } of values) {
    const conflict = await sql.query(
      `SELECT id FROM atlas_materialized_coverage WHERE scope_id=$1 AND valid_to IS NULL AND state<>'unmaterialized'
      AND id<>$2 AND area_id<>$3 AND space_id=$4 AND layer_id=$5 AND detail_rank=$6 AND time_context=$7 AND $9<>'unmaterialized'
      AND ST_Intersects(footprint,ST_SetSRID(ST_GeomFromGeoJSON($8::text),0)) AND ST_Area(ST_Intersection(footprint,ST_SetSRID(ST_GeomFromGeoJSON($8::text),0)))>0 LIMIT 1`,
      [
        world,
        c.id,
        c.areaId,
        c.spaceId,
        c.layerId,
        c.detailRank,
        c.time,
        JSON.stringify(c.footprint),
        c.state,
      ]
    );
    requireThat(
      conflict.rowCount === 0,
      "overlapping_authority",
      "Same-detail materialization has one authoritative owner at each location and layer."
    );
    await insertRows(
      sql,
      "atlas_materialized_coverage",
      [
        "revision_id",
        "scope_id",
        "id",
        "valid_from",
        "area_id",
        "space_id",
        "layer_id",
        "detail_rank",
        "resolution",
        "time_context",
        "footprint",
        "state",
        "resource_id",
        "generation_id",
      ],
      [
        [
          revision,
          world,
          c.id,
          version,
          c.areaId,
          c.spaceId,
          c.layerId,
          c.detailRank,
          c.resolution,
          c.time,
          JSON.stringify(c.footprint),
          c.state,
          c.resourceId,
          c.generationId,
        ],
      ],
      ["footprint"]
    );
  }
}
