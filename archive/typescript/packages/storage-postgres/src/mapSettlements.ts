import type { MapRef, MapSettlement, MapFeature, Geometry } from "@atlas/map";
import type { SqlReader } from "./database";
import type { PostgresMapCatalog } from "./mapCatalog";

export class PostgresMapSettlements {
  constructor(
    private db: SqlReader,
    private maps: PostgresMapCatalog
  ) {}
  async read(reference: MapRef, id: string): Promise<MapSettlement | null> {
    await this.maps.open(reference);
    const key = [reference.mapId, reference.revision];
    const { rows } = await this.db.query<{ data: MapFeature }>(
      "SELECT data FROM map.features WHERE map_id=$1 AND revision=$2 AND id=$3",
      [...key, id]
    );
    const feature = rows[0]?.data;
    if (!feature || feature.kind !== "settlement") return null;
    const { rows: beside } = await this.db.query<{ id: string; data: MapFeature }>(
      `SELECT id,data FROM map.features WHERE map_id=$1 AND revision=$2
       AND (data#>>'{attributes,fromPlace}'=$3 OR data#>>'{attributes,toPlace}'=$3
         OR data#>>'{attributes,atPlace}'=$3)`,
      [...key, id]
    );
    const ids = [
      ...new Set(
        beside.flatMap((row) =>
          [row.id, row.data.attributes.fromPlace, row.data.attributes.toPlace].filter(
            (value): value is string => typeof value === "string" && value !== id
          )
        )
      ),
    ];
    const realm = feature.attributes.polityId;
    const { rows: related } = await this.db.query<{
      data: Omit<MapFeature, "geometry">;
      geometry: Geometry;
    }>(
      `SELECT data,ST_AsGeoJSON(geometry,15,0)::json AS geometry FROM map.features
       WHERE map_id=$1 AND revision=$2 AND (id=ANY($3::text[]) OR
         (data->>'kind' IN ('sovereignty','control','claim') AND data->'relations' @> $4::jsonb)) ORDER BY id`,
      [...key, ids, JSON.stringify(typeof realm === "string" ? [{ targetId: realm }] : null)]
    );
    return { related: related.map((row) => ({ ...row.data, geometry: row.geometry })) };
  }
}
