import {
  geometrySchema,
  type Connection,
  type NetworkNode,
  type NetworkReach,
} from "@atlas/domain";
import { integer, insertRows, type Sql } from "./database";
import type { ObjectRows } from "./objectReaders";
import type { Revised } from "./objectWriters";

export async function readConnections(
  sql: Sql,
  scope: string,
  version: number,
  ids: string[]
): Promise<ObjectRows<Connection>> {
  const result = await sql.query<{
    revision_id: string;
    valid_from: string;
    id: string;
    kind: string;
    a_area: string;
    ax: number;
    ay: number;
    az: number;
    a_feature: string | null;
    a_node: string | null;
    b_area: string;
    bx: number;
    by: number;
    bz: number;
    b_feature: string | null;
    b_node: string | null;
    flow: number;
  }>(
    `SELECT revision_id,valid_from,id,kind,a_area,(a_point).x AS ax,(a_point).y AS ay,(a_point).z AS az,a_feature,a_node,
      b_area,(b_point).x AS bx,(b_point).y AS by,(b_point).z AS bz,b_feature,b_node,flow FROM atlas_connections
      WHERE scope_id=$1 AND valid_from<=$2 AND (valid_to IS NULL OR valid_to>$2) AND id=ANY($3::uuid[])`,
    [scope, version, ids]
  );
  return {
    objects: Object.fromEntries(
      result.rows.map((row) => [
        row.id,
        {
          id: row.id,
          kind: row.kind,
          flow: row.flow,
          a: {
            areaId: row.a_area,
            position: { x: row.ax, y: row.ay, z: row.az },
            featureId: row.a_feature,
            ...(row.a_node ? { nodeId: row.a_node } : {}),
          },
          b: {
            areaId: row.b_area,
            position: { x: row.bx, y: row.by, z: row.bz },
            featureId: row.b_feature,
            ...(row.b_node ? { nodeId: row.b_node } : {}),
          },
        },
      ])
    ),
    revisions: result.rows.map((row) => ({
      kind: "connection",
      id: row.id,
      revisionId: row.revision_id,
      version: integer(row.valid_from),
    })),
  };
}

export async function readNodes(
  sql: Sql,
  scope: string,
  version: number,
  ids: string[]
): Promise<ObjectRows<NetworkNode>> {
  const result = await sql.query<{
    revision_id: string;
    valid_from: string;
    id: string;
    kind: string;
    x: number;
    y: number;
    z: number;
    space_id: string | null;
    water_level: number | null;
  }>(
    `SELECT revision_id,valid_from,id,kind,(point).x AS x,(point).y AS y,(point).z AS z,space_id,water_level FROM atlas_nodes
      WHERE scope_id=$1 AND valid_from<=$2 AND (valid_to IS NULL OR valid_to>$2) AND id=ANY($3::uuid[])`,
    [scope, version, ids]
  );
  return {
    objects: Object.fromEntries(
      result.rows.map((row) => [
        row.id,
        {
          id: row.id,
          kind: row.kind,
          position: { x: row.x, y: row.y, z: row.z },
          spaceId: row.space_id,
          waterLevel: row.water_level,
        },
      ])
    ),
    revisions: result.rows.map((row) => ({
      kind: "node",
      id: row.id,
      revisionId: row.revision_id,
      version: integer(row.valid_from),
    })),
  };
}

export async function readReaches(
  sql: Sql,
  scope: string,
  version: number,
  ids: string[]
): Promise<ObjectRows<NetworkReach>> {
  const result = await sql.query<{
    revision_id: string;
    valid_from: string;
    id: string;
    feature_id: string;
    start_id: string;
    end_id: string;
    geometry: string;
    flow: number;
    end_flow: number | null;
  }>(
    `SELECT revision_id,valid_from,id,feature_id,start_id,end_id,ST_AsGeoJSON(geometry,15) AS geometry,flow,end_flow FROM atlas_reaches
      WHERE scope_id=$1 AND valid_from<=$2 AND (valid_to IS NULL OR valid_to>$2) AND id=ANY($3::uuid[])`,
    [scope, version, ids]
  );
  return {
    objects: Object.fromEntries(
      result.rows.map((row) => [
        row.id,
        {
          id: row.id,
          featureId: row.feature_id,
          start: row.start_id,
          end: row.end_id,
          geometry: geometrySchema.parse(JSON.parse(row.geometry)),
          flow: row.flow,
          endFlow: row.end_flow,
        },
      ])
    ),
    revisions: result.rows.map((row) => ({
      kind: "reach",
      id: row.id,
      revisionId: row.revision_id,
      version: integer(row.valid_from),
    })),
  };
}

export async function writeNodes(
  sql: Sql,
  scope: string,
  version: number,
  nodes: Revised<NetworkNode>[]
): Promise<void> {
  if (nodes.length === 0) return;
  const values = nodes.map(({ revision, value }) => ({ revision, ...value }));
  await sql.query(
    `INSERT INTO atlas_nodes(revision_id,scope_id,id,valid_from,kind,point,space_id,water_level)
    SELECT n.revision,$1,n.id,$2,n.kind,ROW(n.x,n.y,n.z)::atlas_position,n.space,n.level
    FROM unnest($3::uuid[],$4::uuid[],$5::text[],$6::float8[],$7::float8[],$8::float8[],$9::uuid[],$10::float8[])
      AS n(revision,id,kind,x,y,z,space,level)`,
    [
      scope,
      version,
      values.map((v) => v.revision),
      values.map((v) => v.id),
      values.map((v) => v.kind),
      values.map((v) => v.position.x),
      values.map((v) => v.position.y),
      values.map((v) => v.position.z),
      values.map((v) => v.spaceId),
      values.map((v) => v.waterLevel),
    ]
  );
}

export async function writeReaches(
  sql: Sql,
  scope: string,
  version: number,
  reaches: Revised<NetworkReach>[]
): Promise<void> {
  await insertRows(
    sql,
    "atlas_reaches",
    [
      "revision_id",
      "scope_id",
      "id",
      "valid_from",
      "feature_id",
      "start_id",
      "end_id",
      "geometry",
      "flow",
      "end_flow",
    ],
    reaches.map(({ revision, value }) => [
      revision,
      scope,
      value.id,
      version,
      value.featureId,
      value.start,
      value.end,
      JSON.stringify(geometrySchema.parse(value.geometry)),
      value.flow,
      value.endFlow,
    ]),
    ["geometry"]
  );
}
