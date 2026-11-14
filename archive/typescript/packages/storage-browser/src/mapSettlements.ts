import type { Database } from "./catalogDatabase";
import type { MapRef, MapSettlement } from "@atlas/map";
import type { MapCatalog } from "./mapCatalog";

export class MapSettlements {
  constructor(
    private db: Database,
    private maps: MapCatalog
  ) {}
  read(reference: MapRef, id: string): MapSettlement | null {
    this.maps.open(reference);
    const key = [reference.mapId, reference.revision];
    const row = this.db.selectObject(
      "SELECT * FROM map_features WHERE map_id=? AND revision=? AND id=?",
      [...key, id]
    );
    if (!row) return null;
    const feature = this.maps.feature(row);
    if (feature.kind !== "settlement") return null;
    const beside = this.db.selectObjects(
      `SELECT f.* FROM map_features f JOIN map_feature_catalog c USING(row_id)
      WHERE f.map_id=?1 AND f.revision=?2 AND (json_extract(c.attributes_json,'$.fromPlace')=?3
      OR json_extract(c.attributes_json,'$.toPlace')=?3 OR json_extract(c.attributes_json,'$.atPlace')=?3)`,
      [...key, id]
    );
    const ids = new Set(
      beside.flatMap((row) => {
        const way = this.maps.feature(row);
        return [way.id, way.attributes.fromPlace, way.attributes.toPlace].filter(
          (value): value is string => typeof value === "string" && value !== id
        );
      })
    );
    const realm = feature.attributes.polityId;
    if (typeof realm === "string")
      for (const value of this.db.selectValues(
        `SELECT f.id FROM map_features f JOIN map_feature_catalog c USING(row_id)
        WHERE f.map_id=? AND f.revision=? AND json_extract(c.type,'$.kind') IN ('sovereignty','control','claim')
        AND EXISTS(SELECT 1 FROM json_each(c.relations_json) r WHERE json_extract(r.value,'$.targetId')=?)`,
        [...key, realm]
      ))
        ids.add(String(value));
    const related = this.db.selectObjects(
      `SELECT * FROM map_features WHERE map_id=? AND revision=?
      AND id IN (SELECT value FROM json_each(?)) ORDER BY id`,
      [...key, JSON.stringify([...ids])]
    );
    return { related: related.map((row) => this.maps.feature(row)) };
  }
}
