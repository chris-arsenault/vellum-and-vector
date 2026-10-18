import { geometrySchema, requireThat, type SpatialScope } from "@atlas/domain";
import type { Geometry } from "geojson";
import { insertRows, integer, type Sql } from "./database";

export interface ComposedSpatialRow {
  featureId: string;
  spaceId: string;
  layerId: string;
  geometry: Geometry;
}
interface DifferenceRow {
  feature_id: string;
  space_id: string;
  layer_id: string | null;
  geometry: string | null;
}

async function geometryDifferences(
  sql: Sql,
  world: string,
  features: string[],
  rows: ComposedSpatialRow[]
): Promise<DifferenceRow[]> {
  const result = await sql.query<DifferenceRow>(
    `WITH incoming AS (
    SELECT n.feature_id,n.space_id,n.layer_id,ST_SetSRID(ST_GeomFromGeoJSON(n.value::text),0) AS geometry
      FROM unnest($3::uuid[],$4::uuid[],$5::text[],$6::text[]) AS n(feature_id,space_id,layer_id,value)),
    previous AS (SELECT * FROM atlas_spatial_revisions WHERE scope_id=$1 AND feature_id=ANY($2::uuid[]) AND valid_to IS NULL)
    SELECT COALESCE(p.feature_id,n.feature_id) AS feature_id,COALESCE(p.space_id,n.space_id) AS space_id,
      n.layer_id,ST_AsGeoJSON(n.geometry,15) AS geometry FROM previous p FULL JOIN incoming n USING(feature_id,space_id)
    WHERE p.feature_id IS NULL OR n.feature_id IS NULL OR p.layer_id<>n.layer_id OR NOT ST_OrderingEquals(p.geometry,n.geometry)`,
    [
      world,
      features,
      rows.map((row) => row.featureId),
      rows.map((row) => row.spaceId),
      rows.map((row) => row.layerId),
      rows.map((row) => JSON.stringify(geometrySchema.parse(row.geometry))),
    ]
  );
  return result.rows;
}

export async function writeSpatialRows(
  sql: Sql,
  world: string,
  version: number,
  changedFeatures: string[],
  rows: ComposedSpatialRow[]
): Promise<void> {
  if (changedFeatures.length === 0) return;
  const differences = await geometryDifferences(sql, world, changedFeatures, rows);
  if (differences.length === 0) return;
  await sql.query(
    `UPDATE atlas_spatial_revisions s SET valid_to=$1 FROM unnest($3::uuid[],$4::uuid[]) AS d(feature,space)
    WHERE s.scope_id=$2 AND s.feature_id=d.feature AND s.space_id=d.space AND s.valid_to IS NULL`,
    [
      version,
      world,
      differences.map((row) => row.feature_id),
      differences.map((row) => row.space_id),
    ]
  );
  await sql.query(
    `DELETE FROM atlas_feature_index s USING unnest($2::uuid[],$3::uuid[]) AS d(feature,space)
    WHERE s.world_id=$1 AND s.feature_id=d.feature AND s.space_id=d.space`,
    [world, differences.map((row) => row.feature_id), differences.map((row) => row.space_id)]
  );
  const present = differences.filter((row) => row.geometry !== null);
  await insertRows(
    sql,
    "atlas_spatial_revisions",
    ["scope_id", "feature_id", "space_id", "valid_from", "layer_id", "geometry"],
    present.map((row) => [
      world,
      row.feature_id,
      row.space_id,
      version,
      row.layer_id,
      row.geometry,
    ]),
    ["geometry"]
  );
  await insertRows(
    sql,
    "atlas_feature_index",
    ["world_id", "feature_id", "space_id", "layer_id", "geometry"],
    present.map((row) => [world, row.feature_id, row.space_id, row.layer_id, row.geometry]),
    ["geometry"]
  );
}

export interface SpatialPage {
  items: ComposedSpatialRow[];
  total: number;
  nextOffset: number | null;
}
export interface PageRequest {
  offset: number;
  limit: number;
}

export async function querySpatialPage(
  sql: Sql,
  scope: SpatialScope,
  layers: string[],
  page: PageRequest
): Promise<SpatialPage> {
  requireThat(
    Number.isSafeInteger(page.offset) &&
      page.offset >= 0 &&
      Number.isSafeInteger(page.limit) &&
      page.limit > 0,
    "invalid_page",
    "A page needs a nonnegative offset and a positive item count."
  );
  const values = [
    scope.worldId,
    scope.spaceId,
    scope.revision,
    JSON.stringify(scope.footprint),
    layers,
  ];
  const predicate = `scope_id=$1 AND space_id=$2 AND valid_from<=$3 AND (valid_to IS NULL OR valid_to>$3)
    AND ST_Intersects(geometry,ST_SetSRID(ST_GeomFromGeoJSON($4::text),0)) AND (cardinality($5::text[])=0 OR layer_id=ANY($5))`;
  const result = await sql.query<{
    feature_id: string;
    space_id: string;
    layer_id: string;
    geometry: string;
  }>(
    `SELECT feature_id,space_id,layer_id,ST_AsGeoJSON(geometry,15) AS geometry FROM atlas_spatial_revisions
      WHERE ${predicate} ORDER BY feature_id OFFSET $6 LIMIT $7`,
    [...values, page.offset, page.limit]
  );
  const counted = await sql.query<{ total: string }>(
    `SELECT count(*) AS total FROM atlas_spatial_revisions WHERE ${predicate}`,
    values
  );
  const total = integer(counted.rows[0].total),
    items = result.rows.map((row) => ({
      featureId: row.feature_id,
      spaceId: row.space_id,
      layerId: row.layer_id,
      geometry: geometrySchema.parse(JSON.parse(row.geometry)),
    }));
  return {
    items,
    total,
    nextOffset: page.offset + items.length < total ? page.offset + items.length : null,
  };
}
