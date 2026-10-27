import type { Database } from "@sqlite.org/sqlite-wasm";
import type { Connection, DomainWrite, LayerPresentation, WorkspaceScope } from "@atlas/domain";
import type { FeatureCatalog } from "./featureCatalog";

export class PresentationCatalog {
  constructor(
    private db: Database,
    private features: FeatureCatalog
  ) {}
  connections(scope: WorkspaceScope) {
    return this.db
      .selectValues(
        `SELECT data FROM records_core WHERE world_id=? AND kind='connection'
      AND (json_extract(data,'$.value.a.areaId')=? OR json_extract(data,'$.value.b.areaId')=?) ORDER BY id`,
        [scope.worldId, scope.areaId, scope.areaId]
      )
      .map((data) => (JSON.parse(String(data)) as { value: Connection }).value);
  }
  layer(worldId: string, layerId: string): LayerPresentation {
    const properties: LayerPresentation["properties"] = {
      name: { type: "string" },
      kind: { type: "string" },
    };
    const layer = this.db.selectValue(
      "SELECT data FROM records_core WHERE world_id=? AND kind='layer' AND id=?",
      [worldId, layerId]
    );
    if (layer) Object.assign(properties, schemaProperties(String(layer)));
    const values = this.db.selectObjects(
      `SELECT j.key,j.type FROM records_core r,json_each(r.data,'$.value.attributes') j
      WHERE r.world_id=? AND r.layer_id=? AND j.type IN ('text','integer','real','true','false') GROUP BY j.key,j.type`,
      [worldId, layerId]
    );
    for (const row of values)
      properties[String(row.key)] = {
        type:
          row.type === "text"
            ? "string"
            : row.type === "true" || row.type === "false"
              ? "boolean"
              : "number",
      };
    const examples = this.db
      .selectObjects(
        `SELECT id,area_id,space_id,geometry_type FROM records_core
      WHERE world_id=? AND layer_id=? AND kind IN ('feature','magic','landmark') GROUP BY geometry_type ORDER BY geometry_type`,
        [worldId, layerId]
      )
      .flatMap((row) => {
        const item = this.features.one(
          { worldId, areaId: String(row.area_id), spaceId: String(row.space_id) },
          String(row.id)
        );
        return item ? [item.feature] : [];
      });
    return { examples, properties, geometries: [...new Set(examples.map((f) => f.geometry.type))] };
  }
}
function schemaProperties(data: string): LayerPresentation["properties"] {
  const record = JSON.parse(data) as Extract<DomainWrite, { kind: "layer" }>;
  const properties: LayerPresentation["properties"] = {};
  for (const [key, spec] of Object.entries(record.value.schema))
    if (
      spec &&
      typeof spec === "object" &&
      "type" in spec &&
      (spec.type === "string" || spec.type === "number" || spec.type === "boolean")
    )
      properties[key] = { type: spec.type };
  return properties;
}
