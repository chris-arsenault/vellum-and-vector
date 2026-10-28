import type { Database } from "@sqlite.org/sqlite-wasm";
import {
  profiles,
  type Area,
  type AtlasFeature,
  type Bounds,
  type WorkspaceScope,
} from "@atlas/domain";
import type { BoundaryIndex } from "./boundaryIndex";
import type { GeometryDerivations } from "./geometryDerivations";

/** Uncomposed sources can expose indexed original edges without decoding their full shape. */
export class CanonicalBoundaries {
  constructor(
    private db: Database,
    private index: BoundaryIndex,
    private derivations: GeometryDerivations
  ) {}
  install(scope: WorkspaceScope, extent: Bounds, areas: Record<string, Area>, precision: number) {
    const handled = new Set<string>();
    const statement = this.db.prepare(`SELECT r.record_id,r.id,r.area_id,r.data,
      coalesce(r.footprint_id,r.geometry_id) geometry_id FROM records_core r
      JOIN record_bounds b USING(record_id) WHERE r.world_id=? AND r.space_id=? AND r.kind='feature'
      AND b.min_x<=? AND b.max_x>=? AND b.min_y<=? AND b.max_y>=?
      AND NOT EXISTS(SELECT 1 FROM records_core p WHERE p.world_id=r.world_id
        AND p.kind IN ('landmark','magic') AND p.id=r.id)
      AND NOT EXISTS(SELECT 1 FROM records_core p WHERE p.world_id=r.world_id
        AND p.kind='representation' AND json_extract(p.data,'$.value.featureId')=r.id)
      ORDER BY r.id`);
    try {
      statement.bind([scope.worldId, scope.spaceId, extent[2], extent[0], extent[3], extent[1]]);
      while (statement.step()) {
        const row = statement.get({}),
          owner = areas[String(row.area_id)];
        if (
          !owner ||
          profiles.indexOf(owner.profile) > profiles.indexOf(areas[scope.areaId].profile)
        )
          continue;
        const feature = (JSON.parse(String(row.data)) as { value: AtlasFeature }).value;
        if (
          Object.keys(feature.detail).length ||
          feature.relations.some((r) => r.kind === "follows")
        )
          continue;
        handled.add(feature.id);
        if (row.geometry_id === null) continue;
        const geometryId = Number(row.geometry_id);
        this.derivations.ensureBoundaries(geometryId, precision);
        for (const part of this.derivations.boundaryWindow(geometryId, extent))
          this.index.refresh(Number(row.record_id), scope, part.bytes, part.partId);
      }
    } finally {
      statement.finalize();
    }
    return handled;
  }
}
