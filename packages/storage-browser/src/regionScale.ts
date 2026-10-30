import type { Database } from "@sqlite.org/sqlite-wasm";
import { mapRefinementLevel, type Area, type RegionQuery } from "@atlas/domain";
import type { GeometryKernel } from "./geometryKernel";
import { decodeRecord } from "./catalogRecords";

/** Only scale metadata is needed; selection never initializes numerical geography. */
export function regionSelectionLevel(db: Database, kernel: GeometryKernel, query: RegionQuery) {
  const areas: Record<string, Area> = {};
  for (let id: string | null = query.sourceAreaId; id;) {
    const row = db.selectObject("SELECT * FROM records WHERE world_id=? AND kind='area' AND id=?", [
      query.scope.worldId,
      id,
    ]);
    if (!row) break;
    const record = decodeRecord(row, kernel);
    if (record.data.kind !== "area") break;
    const area = record.data.value;
    areas[area.id] = area;
    if (area.map?.refinementLevel !== undefined || !area.map) break;
    id = area.parentId;
  }
  return mapRefinementLevel(areas, query.sourceAreaId) + 1 + regionViewDepth(db, kernel, query);
}
function regionViewDepth(db: Database, kernel: GeometryKernel, query: RegionQuery) {
  let level = 0;
  for (let id = query.parentId; id;) {
    const row = db.selectObject("SELECT * FROM records WHERE world_id=? AND kind='view' AND id=?", [
      query.scope.worldId,
      id,
    ]);
    if (!row) break;
    const record = decodeRecord(row, kernel);
    if (record.data.kind !== "view") break;
    level++;
    id = record.data.value.region?.parentId ?? null;
  }
  return level;
}
