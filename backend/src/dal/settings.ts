import { geometrySchema, type World } from "@atlas/domain";
import { asRevision, insertRows, type Sql } from "./database";
import type { Revised } from "./objectWriters";

type Magic = World["magic"][number];
type View = World["views"][number];
export async function readMagic(sql: Sql, world: string, version: number) {
  const rows = await sql.query<{
    id: string;
    revision_id: string;
    valid_from: string;
    name: string;
    x: number;
    y: number;
    z: number;
    radius: number;
    strength: number;
    propagation: string;
    effect: string;
    decay: number;
    storage: number;
    depends_on: string[] | null;
    starts_at_epoch: number;
    area_id: string | null;
    space_id: string | null;
    scope: string | null;
  }>(
    `SELECT *, (source).x AS x,(source).y AS y,(source).z AS z,ST_AsGeoJSON(scope,15) AS scope
    FROM atlas_magic WHERE scope_id=$1 AND valid_from<=$2 AND (valid_to IS NULL OR valid_to>$2) ORDER BY ordinal,id`,
    [world, version]
  );
  return {
    objects: Object.fromEntries(
      rows.rows.map((r) => [
        r.id,
        {
          id: r.id,
          name: r.name,
          source: { x: r.x, y: r.y, z: r.z },
          radius: r.radius,
          strength: r.strength,
          propagation: r.propagation,
          effect: r.effect,
          decay: r.decay,
          storage: r.storage,
          dependsOn: r.depends_on,
          startsAtEpoch: r.starts_at_epoch,
          ...(r.area_id ? { areaId: r.area_id } : {}),
          ...(r.space_id ? { spaceId: r.space_id } : {}),
          ...(r.scope ? { scope: geometrySchema.parse(JSON.parse(r.scope)) } : {}),
        } satisfies Magic,
      ])
    ),
    revisions: rows.rows.map((r) => asRevision("magic", r)),
  };
}
export async function writeMagic(
  sql: Sql,
  world: string,
  version: number,
  values: Revised<Magic>[]
) {
  for (const [ordinal, { revision, value: m }] of values.entries())
    await sql.query(
      `INSERT INTO atlas_magic(revision_id,scope_id,id,valid_from,ordinal,name,source,radius,strength,propagation,effect,decay,storage,depends_on,starts_at_epoch,scope,area_id,space_id)
      VALUES($1,$2,$3,$4,$5,$6,ROW($7,$8,$9)::atlas_position,$10,$11,$12,$13,$14,$15,$16,$17,
      ST_SetSRID(ST_GeomFromGeoJSON($18::text),0),$19,$20)`,
      [
        revision,
        world,
        m.id,
        version,
        ordinal,
        m.name,
        m.source.x,
        m.source.y,
        m.source.z,
        m.radius,
        m.strength,
        m.propagation,
        m.effect,
        m.decay,
        m.storage,
        m.dependsOn,
        m.startsAtEpoch,
        m.scope ? JSON.stringify(m.scope) : null,
        m.areaId ?? null,
        m.spaceId ?? null,
      ]
    );
}
export async function readViews(sql: Sql, world: string, version: number) {
  const rows = await sql.query<{
    id: string;
    revision_id: string;
    valid_from: string;
    name: string;
    area_id: string;
  }>(
    "SELECT * FROM atlas_views WHERE scope_id=$1 AND valid_from<=$2 AND (valid_to IS NULL OR valid_to>$2) ORDER BY ordinal,id",
    [world, version]
  );
  const styles = await sql.query<{
    revision_id: string;
    layer_id: string;
    visible: boolean;
    opacity: number;
    color: string;
    min_scale: number;
    labels: boolean;
    filter: string | null;
  }>("SELECT * FROM atlas_view_layers WHERE revision_id=ANY($1::uuid[]) ORDER BY ordinal", [
    rows.rows.map((r) => r.revision_id),
  ]);
  return {
    objects: Object.fromEntries(
      rows.rows.map((r) => [
        r.id,
        {
          id: r.id,
          name: r.name,
          areaId: r.area_id,
          layers: styles.rows
            .filter((s) => s.revision_id === r.revision_id)
            .map((s) => ({
              layerId: s.layer_id,
              visible: s.visible,
              opacity: s.opacity,
              color: s.color,
              minScale: s.min_scale,
              labels: s.labels,
              filter: s.filter,
            })),
        } satisfies View,
      ])
    ),
    revisions: rows.rows.map((r) => asRevision("view", r)),
  };
}
export async function writeViews(
  sql: Sql,
  world: string,
  version: number,
  values: Revised<View>[]
) {
  await insertRows(
    sql,
    "atlas_views",
    ["revision_id", "scope_id", "id", "valid_from", "ordinal", "name", "area_id"],
    values.map(({ revision, value: v }, i) => [revision, world, v.id, version, i, v.name, v.areaId])
  );
  await insertRows(
    sql,
    "atlas_view_layers",
    [
      "revision_id",
      "ordinal",
      "layer_id",
      "visible",
      "opacity",
      "color",
      "min_scale",
      "labels",
      "filter",
    ],
    values.flatMap(({ revision, value: v }) =>
      v.layers.map((s, i) => [
        revision,
        i,
        s.layerId,
        s.visible,
        s.opacity,
        s.color,
        s.minScale,
        s.labels ?? true,
        s.filter ?? null,
      ])
    )
  );
}
