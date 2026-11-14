import type { Database } from "./catalogDatabase";
import {
  validateRegistryRequest,
  registryPage,
  mapBounds,
  mapSpace,
  type MapRef,
  type MapRegistryRequest,
  type MapRegistryPage,
  type MapColumn,
} from "@atlas/map";
import type { MapCatalog } from "./mapCatalog";
import type { GeometryKernel } from "./geometryKernel";
import { mapRegistryPath, mapRegistryWhere } from "./mapRegistryQuery";

const selection = `map_feature_catalog c JOIN map_features f USING(row_id)
  JOIN map_registry_visible v USING(row_id)`;

/** Immutable catalog values are filtered and sorted in SQLite, without loading a world. */
export class MapRegistry {
  constructor(
    private db: Database,
    private maps: MapCatalog,
    private kernel: GeometryKernel
  ) {
    db.exec("CREATE TEMP TABLE IF NOT EXISTS map_registry_visible(row_id INTEGER PRIMARY KEY)");
  }
  read(reference: MapRef, request: MapRegistryRequest): MapRegistryPage {
    validateRegistryRequest(request);
    this.visible(reference, request);
    const { sql, bind } = mapRegistryWhere(request.query);
    const total = Number(this.db.selectValue(`SELECT count(*) FROM ${selection}`));
    const matching = Number(
      this.db.selectValue(
        `SELECT count(*) FROM ${selection} WHERE ${sql}`,
        bind.length ? bind : undefined
      )
    );
    const page = registryPage(request.page, request.limit, matching);
    const key = mapRegistryPath(request.sort.key),
      direction = request.sort.descending ? "DESC" : "ASC";
    const records = this.db.selectObjects(
      `SELECT f.*,c.type,c.values_json FROM ${selection} WHERE ${sql}
      ORDER BY (json_extract(c.values_json,?) IS NULL OR json_extract(c.values_json,?)=''),
      json_extract(c.values_json,?) COLLATE NOCASE ${direction},f.map_id,f.id LIMIT ? OFFSET ?`,
      [...bind, key, key, key, request.limit, page * request.limit]
    );
    return {
      total,
      matching,
      page,
      columns: this.columns(),
      facets: this.facets(),
      rows: records.map((row) => ({
        reference: { mapId: String(row.map_id), revision: String(row.revision) },
        feature: this.maps.feature(row),
        type: JSON.parse(String(row.type)),
        values: JSON.parse(String(row.values_json)),
      })),
    };
  }
  private visible(reference: MapRef, request: MapRegistryRequest) {
    const map = this.maps.open(reference);
    this.db.exec("DELETE FROM map_registry_visible");
    const scope = `(f.map_id=? AND f.revision=?)${
      request.scope === "world"
        ? ` OR (f.map_id<>? AND
      m.descriptor->>'$.worldId'=? AND EXISTS(SELECT 1 FROM map_heads h WHERE h.map_id=f.map_id AND h.revision=f.revision))`
        : ""
    }`;
    const bind = [
      reference.mapId,
      reference.revision,
      ...(request.scope === "world" ? [reference.mapId, map.worldId] : []),
    ];
    if (!request.bounds) {
      this.db.exec({
        sql: `INSERT INTO map_registry_visible SELECT f.row_id FROM map_features f
        JOIN maps m USING(map_id,revision) WHERE ${scope}`,
        bind,
      });
      return;
    }
    const [w, s, e, n] = mapBounds(request.bounds);
    const candidates = this.db.selectObjects(
      `SELECT f.* FROM map_features f
      JOIN maps m USING(map_id,revision) JOIN map_catalog_bounds b USING(row_id)
      WHERE (${scope}) AND b.min_x<=? AND b.max_x>=? AND b.min_y<=? AND b.max_y>=?`,
      [...bind, e, w, n, s]
    );
    const geometry = {
      type: "Polygon" as const,
      coordinates: [
        [
          [w, s],
          [e, s],
          [e, n],
          [w, n],
          [w, s],
        ],
      ],
    };
    for (const row of candidates) {
      const feature = this.maps.feature(row);
      const owner = this.maps.open({ mapId: String(row.map_id), revision: String(row.revision) });
      const precision = mapSpace(owner, feature.spaceId).precision;
      if (
        this.kernel.relation(feature.geometry, geometry, precision, "intersects") ||
        (feature.footprint &&
          this.kernel.relation(feature.footprint, geometry, precision, "intersects"))
      )
        this.db.exec({ sql: "INSERT INTO map_registry_visible VALUES(?)", bind: [row.row_id!] });
    }
  }
  private columns(): MapColumn[] {
    return this.db
      .selectObjects(
        `SELECT json_extract(j.value,'$.key') AS key,
      json_extract(j.value,'$.label') AS label,max(json_extract(j.value,'$.numeric')) AS numeric
      FROM ${selection},json_each(c.columns_json) j GROUP BY json_extract(j.value,'$.key') ORDER BY min(CAST(j.key AS INTEGER)),key`
      )
      .map((row) => ({
        key: String(row.key),
        label: String(row.label),
        numeric: Boolean(row.numeric),
      }));
  }
  private facets(): MapRegistryPage["facets"] {
    const categories = {
      status: [],
      state: [],
      profile: [],
      space: [],
    } as MapRegistryPage["facets"]["categories"];
    for (const key of ["status", "state", "profile", "space"] as const)
      categories[key] = this.db
        .selectValues(
          `SELECT DISTINCT json_extract(c.values_json,?) AS value
        FROM ${selection} WHERE value IS NOT NULL AND value<>'' ORDER BY value`,
          [mapRegistryPath(key)]
        )
        .map(String);
    return {
      categories,
      types: this.db
        .selectValues(`SELECT DISTINCT c.type FROM ${selection} ORDER BY c.type`)
        .map((value) => JSON.parse(String(value))),
    };
  }
}
