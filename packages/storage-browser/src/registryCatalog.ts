import type { Database } from "@sqlite.org/sqlite-wasm";
import {
  areaSpace,
  rectangle,
  registryRow,
  registryColumnDefinitions,
  requireThat,
  type RegistryRequest,
  type RegistryPage,
  type RegistryFacets,
  type World,
  type RecordReference,
  type AtlasFeature,
  type CatalogRecord,
} from "@atlas/domain";
import type { CatalogProjection } from "./catalogProjection";
import type { FeatureCatalog } from "./featureCatalog";
import type { GeometryKernel } from "./geometryKernel";
import { registryPath, registryWhere } from "./registryQuery";

const schema = `
CREATE TABLE IF NOT EXISTS registry_cache (
  row_id INTEGER PRIMARY KEY,world_id TEXT NOT NULL,feature_id TEXT NOT NULL,area_id TEXT NOT NULL,
  data TEXT NOT NULL,type TEXT NOT NULL,search TEXT NOT NULL,named INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS registry_features ON registry_cache(world_id,feature_id);
CREATE VIRTUAL TABLE IF NOT EXISTS registry_bounds USING rtree(row_id,min_x,max_x,min_y,max_y);
CREATE TRIGGER IF NOT EXISTS registry_remove AFTER DELETE ON registry_cache BEGIN
  DELETE FROM registry_bounds WHERE row_id=old.row_id;
END;
CREATE TABLE IF NOT EXISTS registry_revision (world_id TEXT PRIMARY KEY,revision INTEGER,area_id TEXT);
CREATE TABLE IF NOT EXISTS registry_dirty (world_id TEXT,feature_id TEXT,PRIMARY KEY(world_id,feature_id));
CREATE TEMP TABLE IF NOT EXISTS registry_visible (row_id INTEGER PRIMARY KEY);`;

/** A disk projection supports filtering/sorting without a browser-wide feature collection. */
export class RegistryCatalog {
  constructor(
    private db: Database,
    private projection: CatalogProjection,
    private features: FeatureCatalog,
    private kernel: GeometryKernel
  ) {
    db.exec(schema);
  }

  read(input: RegistryRequest): RegistryPage {
    requireThat(
      Number.isSafeInteger(input.limit) &&
        input.limit > 0 &&
        Number.isSafeInteger(input.page) &&
        input.page >= 0,
      "registry_page",
      "Choose a valid registry page."
    );
    const world = this.projection.editor(input.worldId);
    this.ensure(world, input.areaId);
    this.visible(world, input);
    const selection = "registry_cache r JOIN registry_visible v USING(row_id)";
    const { sql, bind } = registryWhere(input.query);
    const total = Number(this.db.selectValue(`SELECT count(*) FROM ${selection}`));
    const matching = Number(
      this.db.selectValue(
        `SELECT count(*) FROM ${selection} WHERE ${sql}`,
        bind.length ? bind : undefined
      )
    );
    const page = Math.min(input.page, Math.max(0, Math.ceil(matching / input.limit) - 1));
    const key = registryPath(input.sort.key),
      direction = input.sort.descending ? "DESC" : "ASC";
    const rows = this.db.selectObjects(
      `SELECT r.* FROM ${selection} WHERE ${sql}
      ORDER BY (json_extract(r.data,?) IS NULL OR json_extract(r.data,?)=''),
      json_extract(r.data,?) COLLATE NOCASE ${direction},r.feature_id LIMIT ? OFFSET ?`,
      [...bind, key, key, key, input.limit, page * input.limit]
    );
    return {
      total,
      matching,
      page,
      facets: this.facets(selection),
      columns: this.columns(selection, world),
      rows: rows.map((row) => ({
        feature: this.features.one(
          {
            worldId: world.id,
            areaId: String(row.area_id),
            spaceId: areaSpace(world, String(row.area_id)),
          },
          String(row.feature_id)
        )!.feature,
        type: JSON.parse(String(row.type)),
        values: JSON.parse(String(row.data)),
      })),
    };
  }
  private ensure(world: World, areaId?: string) {
    const previous = this.db.selectObject("SELECT * FROM registry_revision WHERE world_id=?", [
      world.id,
    ]);
    if (previous?.revision === world.version && previous.area_id === (areaId ?? "")) {
      this.refresh(world, areaId);
      return;
    }
    this.db.transaction(() => {
      this.db.exec({ sql: "DELETE FROM registry_cache WHERE world_id=?", bind: [world.id] });
      this.db.exec({ sql: "DELETE FROM registry_dirty WHERE world_id=?", bind: [world.id] });
      const stmt = this.db.prepare(`SELECT r.id,r.area_id FROM records_core r
        WHERE r.world_id=? AND r.kind IN ('feature','magic','landmark')
        AND (r.kind<>'feature' OR NOT EXISTS (SELECT 1 FROM records_core s
          WHERE s.world_id=r.world_id AND s.id=r.id AND s.kind IN ('magic','landmark')))
        ORDER BY r.id`);
      try {
        stmt.bind([world.id]);
        while (stmt.step()) this.insert(world, String(stmt.get(0)), areaId ?? String(stmt.get(1)));
      } finally {
        stmt.finalize();
      }
      this.db.exec({
        sql: "INSERT OR REPLACE INTO registry_revision VALUES(?,?,?)",
        bind: [world.id, world.version, areaId ?? ""],
      });
    });
  }
  /** Mark dependencies before and after writes, including removed representations. */
  changed(worldId: string, reference: RecordReference, next?: CatalogRecord) {
    if (reference.kind === "area" && next?.data.kind === "area") {
      if (this.unchangedArea(worldId, next.data.value)) return;
    }
    if (["area", "layer", "entity", "society"].includes(reference.kind)) {
      this.db.exec({ sql: "DELETE FROM registry_revision WHERE world_id=?", bind: [worldId] });
      return;
    }
    const id =
      reference.kind === "representation"
        ? this.db.selectValue(
            "SELECT json_extract(data,'$.value.featureId') FROM records_core WHERE world_id=? AND kind='representation' AND id=?",
            [worldId, reference.id]
          )
        : ["feature", "magic", "landmark"].includes(reference.kind)
          ? reference.id
          : null;
    if (!id) return;
    this.db.exec({
      sql: `WITH RECURSIVE affected(id) AS (SELECT ? UNION SELECT r.id FROM affected a
        JOIN record_links l ON l.world_id=? AND l.target=a.id AND l.relation IN ('follows','dependsOn')
        JOIN records_core r ON r.record_id=l.source)
        INSERT OR IGNORE INTO registry_dirty SELECT ?,id FROM affected`,
      bind: [id, worldId, worldId],
    });
  }
  private unchangedArea(worldId: string, after: import("@atlas/domain").Area) {
    const previous = this.db.selectValue(
      "SELECT data FROM records WHERE world_id=? AND kind='area' AND id=?",
      [worldId, after.id]
    );
    if (previous === undefined) return false;
    const before = JSON.parse(String(previous)).value,
      keys = ["name", "parentId", "profile", "context", "spaceId", "frame"] as const,
      footprint = this.kernel.encode(
        after.footprint,
        this.projection.metadata(worldId).reference.precision ?? 1e-6
      ).bytes;
    return (
      keys.every((key) => JSON.stringify(before[key]) === JSON.stringify(after[key])) &&
      this.db.selectValue(
        "SELECT footprint IS ? FROM records WHERE world_id=? AND kind='area' AND id=?",
        [footprint, worldId, after.id]
      ) === 1
    );
  }
  advance(worldId: string, revision: number) {
    this.db.exec({
      sql: "UPDATE registry_revision SET revision=? WHERE world_id=?",
      bind: [revision, worldId],
    });
  }
  private refresh(world: World, areaId?: string) {
    this.db.transaction(() => {
      const statement = this.db.prepare(
        "SELECT feature_id FROM registry_dirty WHERE world_id=? ORDER BY feature_id"
      );
      try {
        statement.bind([world.id]);
        while (statement.step()) {
          const id = String(statement.get(0));
          this.db.exec({
            sql: "DELETE FROM registry_cache WHERE world_id=? AND feature_id=?",
            bind: [world.id, id],
          });
          const owner = this.db.selectValue(
            "SELECT area_id FROM records_core WHERE world_id=? AND id=? AND kind IN ('feature','magic','landmark') LIMIT 1",
            [world.id, id]
          );
          if (owner !== undefined) this.insert(world, id, areaId ?? String(owner));
        }
      } finally {
        statement.finalize();
      }
      this.db.exec({ sql: "DELETE FROM registry_dirty WHERE world_id=?", bind: [world.id] });
    });
  }
  private insert(world: World, id: string, areaId: string) {
    const item = this.features.one(
      { worldId: world.id, areaId, spaceId: areaSpace(world, areaId) },
      id
    );
    if (!item) return;
    const feature = item.feature,
      precision = world.reference.precision ?? 1e-6;
    const extent = feature.footprint ?? feature.geometry;
    const measures = this.kernel.measure(extent, precision);
    const row = registryRow(world, feature, this.communities(world.id, feature), {
      ...(extent.type.includes("Polygon") ? { areaKm2: measures.area / 1e6 } : {}),
      ...(feature.geometry.type.includes("Line")
        ? {
            lengthKm: this.kernel.measure(feature.geometry, precision).length / 1000,
          }
        : {}),
    });
    this.db.exec({
      sql: "INSERT INTO registry_cache(world_id,feature_id,area_id,data,type,search,named) VALUES(?,?,?,?,?,?,?)",
      bind: [
        world.id,
        id,
        areaId,
        JSON.stringify(row.values),
        JSON.stringify(row.type),
        `${feature.name} ${row.type.path.join(" ")}`,
        Number(feature.attributes.nameStatus !== "label"),
      ],
    });
    const key = this.db.selectValue("SELECT last_insert_rowid()")!;
    const a = this.kernel.encode(feature.geometry, precision).bounds;
    const b = this.kernel.encode(extent, precision).bounds;
    this.db.exec({
      sql: "INSERT INTO registry_bounds VALUES(?,?,?,?,?)",
      bind: [
        key,
        Math.min(a[0], b[0]),
        Math.max(a[2], b[2]),
        Math.min(a[1], b[1]),
        Math.max(a[3], b[3]),
      ],
    });
  }
  private communities(worldId: string, feature: AtlasFeature) {
    const { fromCommunity, toCommunity, communities } = feature.attributes;
    const ids = [
      fromCommunity,
      toCommunity,
      ...(Array.isArray(communities) ? communities : []),
    ].filter((id): id is string => typeof id === "string");
    if (!ids.length) return new Map<string, string>();
    return new Map(
      this.db
        .selectObjects(
          `SELECT json_extract(c.value,'$.id') id,json_extract(c.value,'$.name') name
      FROM records_core r,json_each(r.data,'$.value.communities') c
      WHERE r.world_id=? AND r.kind='society' AND json_extract(c.value,'$.id') IN (SELECT value FROM json_each(?))`,
          [worldId, JSON.stringify(ids)]
        )
        .map((row) => [String(row.id), String(row.name)])
    );
  }
  private visible(world: World, input: RegistryRequest) {
    this.db.exec("DELETE FROM registry_visible");
    if (!input.extent) {
      this.db.exec({
        sql: "INSERT INTO registry_visible SELECT row_id FROM registry_cache WHERE world_id=?",
        bind: [world.id],
      });
      return;
    }
    const b = input.extent,
      precision = world.reference.precision ?? 1e-6;
    this.kernel.withGeometry(rectangle(b), precision, (target) => {
      const stmt = this.db.prepare(`SELECT r.row_id,r.feature_id,r.area_id FROM registry_cache r
        JOIN registry_bounds b USING(row_id) WHERE r.world_id=? AND b.min_x<=? AND b.max_x>=? AND b.min_y<=? AND b.max_y>=?`);
      try {
        stmt.bind([world.id, b[2], b[0], b[3], b[1]]);
        while (stmt.step()) {
          const areaId = String(stmt.get(2));
          const item = this.features.one(
            { worldId: world.id, areaId, spaceId: areaSpace(world, areaId) },
            String(stmt.get(1))
          )!;
          if (
            this.kernel.matches(`${item.key}:geometry`, item.geometry, target, "intersects") ||
            (item.footprint &&
              this.kernel.matches(`${item.key}:footprint`, item.footprint, target, "intersects"))
          )
            this.db.exec({ sql: "INSERT INTO registry_visible VALUES(?)", bind: [stmt.get(0)] });
        }
      } finally {
        stmt.finalize();
      }
    });
  }
  private facets(selection: string): RegistryFacets {
    const categories = {
      status: [],
      state: [],
      profile: [],
      space: [],
    } as RegistryFacets["categories"];
    for (const key of ["status", "state", "profile", "space"] as const)
      categories[key] = this.db
        .selectValues(
          `SELECT DISTINCT json_extract(r.data,?) AS value FROM ${selection}
        WHERE value IS NOT NULL AND value<>'' ORDER BY value`,
          [registryPath(key)]
        )
        .map(String);
    return {
      types: this.db
        .selectValues(`SELECT DISTINCT r.type FROM ${selection} ORDER BY r.type`)
        .map((value) => JSON.parse(String(value))),
      categories,
    };
  }
  private columns(selection: string, world: World) {
    const keys = this.db.selectObjects(`SELECT j.key,max(j.type IN ('real','integer')) AS numeric
      FROM ${selection},json_each(r.data) j GROUP BY j.key`);
    return registryColumnDefinitions(
      new Map(keys.map((row) => [String(row.key), Boolean(row.numeric)])),
      world
    );
  }
}
