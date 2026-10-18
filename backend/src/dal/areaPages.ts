import { integer, type Sql } from "./database";
import { readAreas } from "./areaReader";
import type { PageRequest } from "./spatialRows";

export async function queryAreaPage(sql: Sql, world: string, version: number, page: PageRequest) {
  const rows = await sql.query<{ id: string }>(
    `SELECT id FROM atlas_areas WHERE scope_id=$1 AND valid_from<=$2 AND (valid_to IS NULL OR valid_to>$2)
    ORDER BY profile,id OFFSET $3 LIMIT $4`,
    [world, version, page.offset, page.limit]
  );
  const count = await sql.query<{ total: string }>(
    "SELECT count(*) AS total FROM atlas_areas WHERE scope_id=$1 AND valid_from<=$2 AND (valid_to IS NULL OR valid_to>$2)",
    [world, version]
  );
  const objects = await readAreas(
      sql,
      world,
      version,
      rows.rows.map((r) => r.id)
    ),
    total = integer(count.rows[0].total);
  return {
    version,
    items: rows.rows.map((r) => objects.objects[r.id]),
    total,
    nextOffset: page.offset + rows.rows.length < total ? page.offset + rows.rows.length : null,
  };
}
