import type { Database } from "@sqlite.org/sqlite-wasm";
import {
  mapRefinementLevel,
  minimumRegionWidthMetres,
  requireThat,
  type RegionQuery,
} from "@atlas/domain";
import type { GeometryKernel } from "./geometryKernel";
import { decodeRecord } from "./catalogRecords";

const districtPreferencePenalty = 0.2;
const sparseFootprintPenalty = 0.75;

/** Prefer candidates near the intended map area, accounting for sparse footprints. */
export function candidateScore(area: number, frameArea: number, target: number, district: boolean) {
  return (
    Math.abs(Math.log(frameArea / target)) +
    Math.log(Math.max(1, frameArea / area)) * sparseFootprintPenalty +
    (district ? districtPreferencePenalty : 0)
  );
}

/** Selection constraints use the owning map, including within a nested region. */
export function regionMinimumWidth(db: Database, kernel: GeometryKernel, query: RegionQuery) {
  const row = db.selectObject("SELECT * FROM records WHERE world_id=? AND kind='area' AND id=?", [
    query.scope.worldId,
    query.sourceAreaId,
  ]);
  requireThat(row, "missing_area", "Choose an existing source map.");
  const record = decodeRecord(row, kernel);
  requireThat(record.data.kind === "area", "missing_area", "Choose an existing source map.");
  return minimumRegionWidthMetres(record.data.value.footprint);
}

/** Only scale metadata is needed; selection never initializes numerical geography. */
export function regionSelectionLevel(db: Database, kernel: GeometryKernel, query: RegionQuery) {
  const row = db.selectObject("SELECT * FROM records WHERE world_id=? AND kind='area' AND id=?", [
    query.scope.worldId,
    query.sourceAreaId,
  ]);
  requireThat(row, "missing_area", "Choose an existing source map.");
  const record = decodeRecord(row, kernel);
  requireThat(record.data.kind === "area", "missing_area", "Choose an existing source map.");
  const area = record.data.value;
  return mapRefinementLevel({ [area.id]: area }, area.id) + 1 + regionViewDepth(db, kernel, query);
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
