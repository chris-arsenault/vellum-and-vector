import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type {
  AtlasFeature,
  FeatureSelection,
  FeatureWorkspace,
  NetworkNode,
  NetworkReach,
  NetworkWorkspace,
  ReachSelection,
} from "@atlas/domain";

/** The Rust worker owns the file; this local binding stages inputs and reads completed records. */
export function openNativeRecords(path: string) {
  const database = new DatabaseSync(path, { open: true });
  database.exec("PRAGMA cache_size=-4096; PRAGMA temp_store=FILE;");
  let revision = 0;
  function refreshRevisions() {
    revision = Number(
      database
        .prepare(
          `SELECT COALESCE(MAX(revision),0) AS value FROM (
      SELECT revision FROM working_features UNION ALL SELECT revision FROM source_features)`
        )
        .get()!.value
    );
  }
  refreshRevisions();
  const nextRevision = () => ++revision;
  return {
    features: new Features(database, "working_features", nextRevision),
    sourceFeatures: new Features(database, "source_features", nextRevision),
    networks: new Networks(database, "working_networks"),
    sourceNetworks: new Networks(database, "source_networks"),
    refreshRevisions,
    close: () => database.close(),
  };
}
function read<T>(database: DatabaseSync, table: string, filter: string, values: SQLInputValue[]) {
  const row = database.prepare(`SELECT data FROM ${table} WHERE ${filter}`).get(...values);
  return row ? (JSON.parse(String(row.data)) as T) : undefined;
}
function* ids(database: DatabaseSync, table: string, filters: string[], values: SQLInputValue[]) {
  let after = 0;
  const query = database.prepare(`SELECT ordinal,id FROM ${table} WHERE ordinal>?
    ${filters.map((filter) => `AND ${filter}`).join(" ")} ORDER BY ordinal LIMIT 64`);
  for (;;) {
    const page = query.all(after, ...values);
    if (!page.length) return;
    for (const row of page) {
      after = Number(row.ordinal);
      yield String(row.id);
    }
  }
}
class Features implements FeatureWorkspace {
  constructor(
    private db: DatabaseSync,
    private table: string,
    private revision: () => number
  ) {}
  get(id: string) {
    return read<AtlasFeature>(this.db, this.table, "id=?", [id]);
  }
  put(feature: AtlasFeature) {
    this.db
      .prepare(
        `INSERT INTO ${this.table}(id,revision,area_id,layer_id,kind,data)
      VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,
      area_id=excluded.area_id,layer_id=excluded.layer_id,kind=excluded.kind,data=excluded.data`
      )
      .run(
        feature.id,
        this.revision(),
        feature.areaId,
        feature.layerId,
        feature.kind,
        JSON.stringify(feature)
      );
  }
  remove(id: string) {
    this.db.prepare(`DELETE FROM ${this.table} WHERE id=?`).run(id);
  }
  *values(selection: FeatureSelection = {}) {
    const selected = [
      ["area_id=?", selection.areaId],
      ["layer_id=?", selection.layerId],
      ["kind=?", selection.kind],
    ].filter((entry): entry is [string, string] => entry[1] !== undefined);
    for (const id of ids(
      this.db,
      this.table,
      selected.map(([filter]) => filter),
      selected.map(([, value]) => value)
    )) {
      const feature = this.get(id);
      if (feature) yield feature;
    }
  }
  *revisions(): IterableIterator<[string, number]> {
    const query = this.db.prepare(`SELECT revision FROM ${this.table} WHERE id=?`);
    for (const id of ids(this.db, this.table, [], [])) {
      const row = query.get(id);
      if (row) yield [id, Number(row.revision)];
    }
  }
}
class Networks implements NetworkWorkspace {
  constructor(
    private db: DatabaseSync,
    private table: string
  ) {}
  node(id: string) {
    return read<NetworkNode>(this.db, this.table, "kind=? AND id=?", ["node", id]);
  }
  reach(id: string) {
    return read<NetworkReach>(this.db, this.table, "kind=? AND id=?", ["reach", id]);
  }
  *nodes() {
    for (const id of ids(this.db, this.table, ["kind=?"], ["node"])) {
      const node = this.node(id);
      if (node) yield node;
    }
  }
  *reaches(selection: ReachSelection = {}) {
    const filters = ["kind= ?"],
      values: SQLInputValue[] = ["reach"];
    if (selection.featureId !== undefined) {
      filters.push("feature_id=?");
      values.push(selection.featureId);
    }
    if (selection.nodeId !== undefined) {
      filters.push("(start_id=? OR end_id=?)");
      values.push(selection.nodeId, selection.nodeId);
    }
    for (const id of ids(this.db, this.table, filters, values)) {
      const reach = this.reach(id);
      if (reach) yield reach;
    }
  }
  private put(kind: string, value: NetworkNode | NetworkReach, endpoints: (string | null)[]) {
    this.db
      .prepare(
        `INSERT INTO ${this.table}(kind,id,feature_id,start_id,end_id,data)
      VALUES(?,?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET feature_id=excluded.feature_id,
      start_id=excluded.start_id,end_id=excluded.end_id,data=excluded.data`
      )
      .run(kind, value.id, ...endpoints, JSON.stringify(value));
  }
  putNode(node: NetworkNode) {
    this.put("node", node, [null, null, null]);
  }
  putReach(reach: NetworkReach) {
    this.put("reach", reach, [reach.featureId, reach.start, reach.end]);
  }
  removeReach(id: string) {
    this.db.prepare(`DELETE FROM ${this.table} WHERE kind='reach' AND id=?`).run(id);
  }
}
