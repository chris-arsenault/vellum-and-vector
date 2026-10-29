import type { Database, SqlValue } from "@sqlite.org/sqlite-wasm";
import type { CatalogRecord, ObjectKind, ReadRequirements } from "@atlas/domain";
import { decodeRecord, type CatalogRow } from "./catalogRecords";
import type { GeometryKernel } from "./geometryKernel";

/** A request-local read set, never a resident copy of the world's catalog. */
export class RecordSelection {
  readonly records = new Map<string, CatalogRecord>();
  readonly requested = new Set<string>();
  constructor(
    readonly worldId: string,
    readonly db: Database,
    private kernel: GeometryKernel
  ) {}
  add(row: CatalogRow) {
    const key = `${row.kind}:${row.id}`;
    if (!this.records.has(key)) this.records.set(key, decodeRecord(row, this.kernel));
    return this.records.get(key)!;
  }
  select(where: string, bindings: SqlValue[] = []) {
    return this.db
      .selectObjects(`SELECT r.* FROM records r WHERE r.world_id=? AND (${where})`, [
        this.worldId,
        ...bindings,
      ])
      .map((row) => this.add(row));
  }
  get(kind: ObjectKind, id: string) {
    this.requested.add(id);
    return this.records.get(`${kind}:${id}`) ?? this.select("r.kind=? AND r.id=?", [kind, id])[0];
  }
  ids(ids: string[]) {
    for (const id of ids) this.requested.add(id);
    return this.select("r.id IN (SELECT value FROM json_each(?))", [JSON.stringify(ids)]);
  }
  ofKind(kind: ObjectKind) {
    return [...this.records.values()].filter((r) => r.data.kind === kind);
  }
  ownedArea(id: string): string | null {
    const data = this.get("area", id)?.data;
    return data?.kind === "area" && (!data.value.parentId || data.value.map) ? id : null;
  }
  lineage(id: string): string[] {
    return this.db
      .selectValues(
        `WITH RECURSIVE lineage(id) AS (SELECT ? UNION
      SELECT json_extract(r.data,'$.value.parentId') FROM records r JOIN lineage l ON r.id=l.id
      WHERE r.world_id=? AND r.kind='area' AND json_type(r.data,'$.value.map') IS NULL AND json_extract(r.data,'$.value.parentId') IS NOT NULL) SELECT id FROM lineage`,
        [id, this.worldId]
      )
      .map(String);
  }
  related(ids: string[], relations: string[], reverse: boolean) {
    if (!ids.length) return [];
    return this.select(
      reverse
        ? `r.record_id IN (SELECT source FROM record_links WHERE world_id=? AND relation IN (SELECT value FROM json_each(?)) AND target IN (SELECT value FROM json_each(?)))`
        : `r.id IN (SELECT l.target FROM record_links l JOIN records a ON a.record_id=l.source WHERE l.world_id=? AND l.relation IN (SELECT value FROM json_each(?)) AND a.id IN (SELECT value FROM json_each(?)))`,
      [this.worldId, JSON.stringify(relations), JSON.stringify(ids)]
    );
  }
  bindings(ids: string[], dependents: boolean) {
    let frontier = ids;
    const seen = new Set<string>();
    while (frontier.length) {
      for (const id of frontier) seen.add(id);
      const sources = this.related(frontier, ["follows", "dependsOn"], false);
      const followers = dependents
        ? this.related(frontier, ["follows", "boundedBy", "dependsOn"], true)
        : [];
      frontier = [...sources, ...followers]
        .map((r) => r.reference.id)
        .filter((id) => !seen.has(id));
    }
  }
  representations(areas: string[] | null = null) {
    const ids = this.ofKind("feature").map((r) => r.reference.id);
    this.select(
      `r.kind='representation' AND json_extract(r.data,'$.value.featureId') IN (SELECT value FROM json_each(?))
      AND (? IS NULL OR r.area_id IN (SELECT value FROM json_each(?)))`,
      [JSON.stringify(ids), areas ? JSON.stringify(areas) : null, JSON.stringify(areas)]
    );
  }
  explicit(input: ReadRequirements) {
    for (const selection of input.objects)
      for (const id of selection.ids) this.get(selection.kind, id);
    this.ids(input.references ?? []);
    if (input.referencesTo?.length)
      this.select(
        "r.record_id IN (SELECT source FROM record_links WHERE world_id=? AND target IN (SELECT value FROM json_each(?)))",
        [this.worldId, JSON.stringify(input.referencesTo)]
      );
  }
  connected(input: ReadRequirements) {
    if (!input.connected) return;
    const network = input.connected.mode === "network";
    this.select(
      `r.id IN (WITH RECURSIVE
      eligible AS (SELECT record_id,id FROM records_core WHERE world_id=? AND space_id=?
        AND kind IN (SELECT value FROM json_each(?))),
      edges(a,b) AS (SELECT s.id,t.id FROM record_links l
        JOIN eligible s ON s.record_id=l.source JOIN eligible t ON t.id=l.target
        WHERE l.world_id=? AND l.relation IN (SELECT value FROM json_each(?))),
      connected(id) AS (SELECT value FROM json_each(?)
        UNION SELECT e.b FROM edges e JOIN connected c ON e.a=c.id
        UNION SELECT e.a FROM edges e JOIN connected c ON e.b=c.id)
      SELECT id FROM connected)`,
      [
        this.worldId,
        input.scope.spaceId,
        JSON.stringify(network ? ["feature", "reach", "node"] : ["feature"]),
        this.worldId,
        JSON.stringify(network ? ["feature", "node"] : ["connects", "inside"]),
        JSON.stringify(input.connected.featureIds),
      ]
    );
  }
  attachedRoutes() {
    const communities = this.ofKind("feature").flatMap(({ data }) =>
      data.kind === "feature" &&
      data.value.kind === "settlement" &&
      typeof data.value.attributes.communityId === "string"
        ? [data.value.attributes.communityId]
        : []
    );
    this.related(communities, ["route-end"], true);
  }
  identities() {
    const ids = [...this.requested, ...[...this.records.values()].map((r) => r.reference.id)];
    return Object.fromEntries(
      this.db
        .selectObjects(
          "SELECT id,kind FROM identities WHERE world_id=? AND id IN (SELECT value FROM json_each(?))",
          [this.worldId, JSON.stringify(ids)]
        )
        .map((row) => [String(row.id), String(row.kind)])
    );
  }
}
