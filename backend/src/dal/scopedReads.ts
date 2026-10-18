import { requireThat, type SpatialScope } from "@atlas/domain";
import type { Sql } from "./database";

export async function validateCommittedScope(sql: Sql, scope: SpatialScope): Promise<void> {
  const rows = await sql.query<{ crs_id: string; space_id: string }>(
    `SELECT v.crs_id,a.space_id FROM atlas_world_versions v JOIN atlas_areas a
    ON a.scope_id=v.world_id AND a.id=$3 AND a.valid_from<=$2 AND (a.valid_to IS NULL OR a.valid_to>$2)
    WHERE v.world_id=$1 AND v.version=$2`,
    [scope.worldId, scope.revision, scope.areaId]
  );
  requireThat(
    rows.rowCount === 1,
    "not_found",
    "The selected mapped area is unavailable at this revision."
  );
  requireThat(
    rows.rows[0].crs_id === scope.crsId && rows.rows[0].space_id === scope.spaceId,
    "reference_mismatch",
    "The query must use this area's CRS and located space."
  );
  requireThat(
    scope.time === "present",
    "historical_resource_required",
    "Completed epochs are queried through retained history resources; versioned map objects describe the present at their saved revision."
  );
}
