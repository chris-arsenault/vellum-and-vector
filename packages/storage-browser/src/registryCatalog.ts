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
import type { FeatureCatalog, Presented } from "./featureCatalog";
import type { GeometryKernel } from "./geometryKernel";
import { registryPath, registryWhere } from "./registryQuery";
import { RegistryMarks } from "./registryMarks";
import type { CommunityIndex } from "./communityIndex";

/** Rows are kept per presentation scope (an area, or '' for each feature's own area), so a
 * scope is built once and switching back reads it. Marks name the features a write can
 * affect in every built scope; a scope's facets and columns are stored until its rows change. */
const schema = `
CREATE TABLE IF NOT EXISTS registry_rows (
  row_id INTEGER PRIMARY KEY,world_id TEXT NOT NULL,scope TEXT NOT NULL,feature_id TEXT NOT NULL,
  area_id TEXT NOT NULL,data TEXT NOT NULL,type TEXT NOT NULL,search TEXT NOT NULL,named INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS registry_row_features ON registry_rows(world_id,scope,feature_id);
CREATE VIRTUAL TABLE IF NOT EXISTS registry_row_bounds USING rtree(row_id,min_x,max_x,min_y,max_y);
CREATE TRIGGER IF NOT EXISTS registry_row_remove AFTER DELETE ON registry_rows BEGIN
  DELETE FROM registry_row_bounds WHERE row_id=old.row_id;
END;
CREATE TABLE IF NOT EXISTS registry_scopes (
  world_id TEXT NOT NULL,scope TEXT NOT NULL,revision INTEGER NOT NULL,summary TEXT,
  PRIMARY KEY(world_id,scope)
);
CREATE TABLE IF NOT EXISTS registry_marks (
  world_id TEXT NOT NULL,scope TEXT NOT NULL,feature_id TEXT NOT NULL,
  PRIMARY KEY(world_id,scope,feature_id)
);
CREATE TEMP TABLE IF NOT EXISTS registry_visible (row_id INTEGER PRIMARY KEY);`;
const presentationBatch = 128;
interface Summary {
  facets: RegistryFacets;
  keys: [string, boolean][];
}

/** A disk projection supports filtering/sorting without a browser-wide feature collection.
 * Rows are presented in batches from one context per batch; invalidation marks only the
 * features a write can affect. */
export class RegistryCatalog {
  constructor(
    private db: Database,
    private projection: CatalogProjection,
    private features: FeatureCatalog,
    private kernel: GeometryKernel,
    private communityIndex: CommunityIndex
  ) {
    db.exec(schema);
    this.marks = new RegistryMarks(db, projection, kernel);
  }
  private marks: RegistryMarks;

  read(input: RegistryRequest): RegistryPage {
    requireThat(
      Number.isSafeInteger(input.limit) &&
        input.limit > 0 &&
        Number.isSafeInteger(input.page) &&
        input.page >= 0,
      "registry_page",
      "Choose a valid registry page."
    );
    const world = this.projection.editor(input.worldId),
      scope = input.areaId ?? "";
    this.ensure(world, scope);
    this.visible(world, scope, input);
    const selection = "registry_rows r JOIN registry_visible v USING(row_id)";
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
    const presented = this.present(
      world,
      rows.map((row) => ({ id: String(row.feature_id), areaId: String(row.area_id) }))
    );
    const summary = input.extent ? this.summarize(selection) : this.summary(world.id, scope);
    return {
      total,
      matching,
      page,
      facets: summary.facets,
      columns: registryColumnDefinitions(new Map(summary.keys), world),
      rows: rows.map((row) => ({
        feature: presented.get(String(row.feature_id))!.feature,
        type: JSON.parse(String(row.type)),
        values: JSON.parse(String(row.data)),
      })),
    };
  }
  /** Present features grouped by their presentation area, one context per batch. */
  private present(world: World, items: { id: string; areaId: string }[]) {
    const result = new Map<string, Presented>();
    const groups = new Map<string, string[]>();
    for (const item of items) {
      if (!groups.has(item.areaId)) groups.set(item.areaId, []);
      groups.get(item.areaId)!.push(item.id);
    }
    for (const [areaId, ids] of groups)
      for (let start = 0; start < ids.length; start += presentationBatch) {
        const batch = this.features.many(
          { worldId: world.id, areaId, spaceId: areaSpace(world, areaId) },
          ids.slice(start, start + presentationBatch)
        );
        for (const [id, item] of batch) result.set(id, item);
      }
    return result;
  }
  /** Build a scope once; afterwards refresh only its marked features. */
  private ensure(world: World, scope: string) {
    const previous = this.db.selectValue(
      "SELECT revision FROM registry_scopes WHERE world_id=? AND scope=?",
      [world.id, scope]
    );
    if (previous === world.version) {
      this.refresh(world, scope);
      return;
    }
    this.db.transaction(() => {
      const bind = [world.id, scope];
      this.db.exec({ sql: "DELETE FROM registry_rows WHERE world_id=? AND scope=?", bind });
      this.db.exec({ sql: "DELETE FROM registry_marks WHERE world_id=? AND scope=?", bind });
      const rows = this.db.selectObjects(
        `SELECT r.id,r.area_id FROM records_core r
        WHERE r.world_id=? AND r.kind IN ('feature','magic','landmark')
        AND (r.kind<>'feature' OR NOT EXISTS (SELECT 1 FROM records_core s
          WHERE s.world_id=r.world_id AND s.id=r.id AND s.kind IN ('magic','landmark')))
        ORDER BY r.id`,
        [world.id]
      );
      this.insert(
        world,
        scope,
        rows.map((row) => ({ id: String(row.id), areaId: scope || String(row.area_id) }))
      );
      this.db.exec({
        sql: "INSERT OR REPLACE INTO registry_scopes VALUES(?,?,?,NULL)",
        bind: [world.id, scope, world.version],
      });
    });
  }
  /** Mark the features a write can affect in every built scope. */
  changed(worldId: string, reference: RecordReference, next?: CatalogRecord) {
    this.marks.changed(worldId, reference, next);
  }
  advance(worldId: string, revision: number) {
    this.db.exec({
      sql: "UPDATE registry_scopes SET revision=? WHERE world_id=?",
      bind: [revision, worldId],
    });
  }
  private refresh(world: World, scope: string) {
    this.db.transaction(() => {
      const dirty = this.db.selectObjects(
        `SELECT d.feature_id,(SELECT area_id FROM records_core r WHERE r.world_id=d.world_id AND r.id=d.feature_id
          AND r.kind IN ('feature','magic','landmark') LIMIT 1) AS area_id
        FROM registry_marks d WHERE d.world_id=? AND d.scope=? ORDER BY d.feature_id`,
        [world.id, scope]
      );
      if (!dirty.length) return;
      const bind = [world.id, scope, world.id, scope];
      this.db.exec({
        sql: `DELETE FROM registry_rows WHERE world_id=? AND scope=? AND feature_id IN
          (SELECT feature_id FROM registry_marks WHERE world_id=? AND scope=?)`,
        bind,
      });
      this.insert(
        world,
        scope,
        dirty
          .filter((row) => row.area_id !== null)
          .map((row) => ({ id: String(row.feature_id), areaId: scope || String(row.area_id) }))
      );
      this.db.exec({
        sql: "DELETE FROM registry_marks WHERE world_id=? AND scope=?",
        bind: [world.id, scope],
      });
      this.db.exec({
        sql: "UPDATE registry_scopes SET summary=NULL WHERE world_id=? AND scope=?",
        bind: [world.id, scope],
      });
    });
  }
  private insert(world: World, scope: string, items: { id: string; areaId: string }[]) {
    const presented = this.present(world, items);
    for (const { id, areaId } of items) {
      const item = presented.get(id);
      if (item) this.insertRow(world, scope, id, areaId, item.feature);
    }
  }
  private insertRow(
    world: World,
    scope: string,
    id: string,
    areaId: string,
    feature: AtlasFeature
  ) {
    const precision = world.reference.precision ?? 1e-6;
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
      sql: "INSERT INTO registry_rows(world_id,scope,feature_id,area_id,data,type,search,named) VALUES(?,?,?,?,?,?,?,?)",
      bind: [
        world.id,
        scope,
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
      sql: "INSERT INTO registry_row_bounds VALUES(?,?,?,?,?)",
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
    return this.communityIndex.names(worldId, ids);
  }
  private visible(world: World, scope: string, input: RegistryRequest) {
    this.db.exec("DELETE FROM registry_visible");
    if (!input.extent) {
      this.db.exec({
        sql: "INSERT INTO registry_visible SELECT row_id FROM registry_rows WHERE world_id=? AND scope=?",
        bind: [world.id, scope],
      });
      return;
    }
    const b = input.extent,
      precision = world.reference.precision ?? 1e-6;
    const candidates = this.db.selectObjects(
      `SELECT r.row_id,r.feature_id,r.area_id FROM registry_row_bounds b JOIN registry_rows r USING(row_id)
      WHERE r.world_id=? AND r.scope=? AND b.min_x<=? AND b.max_x>=? AND b.min_y<=? AND b.max_y>=?`,
      [world.id, scope, b[2], b[0], b[3], b[1]]
    );
    const presented = this.present(
      world,
      candidates.map((row) => ({ id: String(row.feature_id), areaId: String(row.area_id) }))
    );
    this.kernel.withShape(rectangle(b), precision, (target) => {
      for (const row of candidates) {
        const item = presented.get(String(row.feature_id));
        if (
          item &&
          (this.kernel.matches(`${item.key}:geometry`, item.geometry, target, "intersects") ||
            (item.footprint &&
              this.kernel.matches(`${item.key}:footprint`, item.footprint, target, "intersects")))
        )
          this.db.exec({ sql: "INSERT INTO registry_visible VALUES(?)", bind: [row.row_id] });
      }
    });
  }
  /** A whole scope's facets and column keys, derived once after its rows change. */
  private summary(worldId: string, scope: string): Summary {
    const stored = this.db.selectValue(
      "SELECT summary FROM registry_scopes WHERE world_id=? AND scope=?",
      [worldId, scope]
    );
    if (typeof stored === "string") return JSON.parse(stored);
    const summary = this.summarize("registry_rows r JOIN registry_visible v USING(row_id)");
    this.db.exec({
      sql: "UPDATE registry_scopes SET summary=? WHERE world_id=? AND scope=?",
      bind: [JSON.stringify(summary), worldId, scope],
    });
    return summary;
  }
  private summarize(selection: string): Summary {
    const keys = this.db.selectObjects(`SELECT j.key,max(j.type IN ('real','integer')) AS numeric
      FROM ${selection},json_each(r.data) j GROUP BY j.key`);
    return {
      facets: this.facets(selection),
      keys: keys.map((row) => [String(row.key), Boolean(row.numeric)]),
    };
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
}
