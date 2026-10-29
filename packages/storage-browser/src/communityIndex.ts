import type { Database } from "@sqlite.org/sqlite-wasm";
import type {
  SocietyCommunity,
  SocietyConnection,
  SocietyEvent,
  SocietyPolity,
  SocietyRegion,
  SocietyWork,
} from "@atlas/domain";

/** One community's slice of its society record, indexed once per society record revision:
 * the community and its connections, works, events and magic. Polities are indexed by id. */
const schema = `
CREATE TABLE IF NOT EXISTS community_index (
  world_id TEXT NOT NULL,community_id TEXT NOT NULL,record_id INTEGER NOT NULL,
  area_id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(world_id,community_id,area_id)
);
CREATE TABLE IF NOT EXISTS community_polities (
  world_id TEXT NOT NULL,record_id INTEGER NOT NULL,polity_id TEXT NOT NULL,data TEXT NOT NULL,
  PRIMARY KEY(record_id,polity_id)
);
CREATE TABLE IF NOT EXISTS community_index_sources (
  world_id TEXT NOT NULL,record_id INTEGER NOT NULL,revision INTEGER NOT NULL,base TEXT NOT NULL,
  PRIMARY KEY(world_id,record_id)
);
CREATE INDEX IF NOT EXISTS records_community ON records_core(
  world_id,kind,json_extract(data,'$.value.attributes.communityId'));`;

export interface CommunitySlice {
  community: SocietyCommunity;
  connections: SocietyConnection[];
  works: SocietyWork[];
  events: SocietyEvent[];
  magic: SocietyRegion["magic"];
}
function communitySlices(society: SocietyRegion) {
  const slices = new Map<string, CommunitySlice>(
    society.communities.map((community) => [
      community.id,
      { community, connections: [], works: [], events: [], magic: [] },
    ])
  );
  const add = <K extends keyof Omit<CommunitySlice, "community">>(
    id: unknown,
    key: K,
    value: CommunitySlice[K][number]
  ) => {
    const slice = typeof id === "string" ? slices.get(id) : undefined;
    if (slice && !(slice[key] as unknown[]).includes(value)) (slice[key] as unknown[]).push(value);
  };
  for (const link of society.connections) {
    add(link.from, "connections", link);
    add(link.to, "connections", link);
  }
  for (const work of society.works) {
    add(work.communityId, "works", work);
    for (const id of work.country ?? []) add(id, "works", work);
  }
  for (const event of society.events)
    for (const id of event.communities ?? []) add(id, "events", event);
  for (const magic of society.magic) add(magic.communityId, "magic", magic);
  return slices;
}
export class CommunityIndex {
  constructor(private db: Database) {
    db.exec(schema);
  }
  /** Index society records written since they were last indexed. */
  private ensure(worldId: string) {
    const stale = this.db.selectObjects(
      `SELECT r.record_id,r.revision,r.area_id FROM records_core r
      LEFT JOIN community_index_sources s ON s.world_id=r.world_id AND s.record_id=r.record_id
      WHERE r.world_id=? AND r.kind='society' AND (s.revision IS NULL OR s.revision<>r.revision)`,
      [worldId]
    );
    const removed = this.db.selectValue(
      `SELECT 1 FROM community_index_sources s WHERE s.world_id=? AND NOT EXISTS
      (SELECT 1 FROM records_core r WHERE r.record_id=s.record_id AND r.kind='society') LIMIT 1`,
      [worldId]
    );
    if (!stale.length && !removed) return;
    this.db.savepoint(() => {
      this.db.exec({
        sql: `DELETE FROM community_index WHERE world_id=? AND record_id NOT IN
          (SELECT record_id FROM records_core WHERE world_id=? AND kind='society')`,
        bind: [worldId, worldId],
      });
      this.db.exec({
        sql: `DELETE FROM community_polities WHERE world_id=? AND record_id NOT IN
          (SELECT record_id FROM records_core WHERE world_id=? AND kind='society')`,
        bind: [worldId, worldId],
      });
      this.db.exec({
        sql: `DELETE FROM community_index_sources WHERE world_id=? AND record_id NOT IN
          (SELECT record_id FROM records_core WHERE world_id=? AND kind='society')`,
        bind: [worldId, worldId],
      });
      for (const row of stale)
        this.index(worldId, Number(row.record_id), Number(row.revision), String(row.area_id));
    });
  }
  private index(worldId: string, recordId: number, revision: number, areaId: string) {
    const society = JSON.parse(
      String(this.db.selectValue("SELECT data FROM records_core WHERE record_id=?", [recordId]))
    ).value as SocietyRegion;
    for (const table of ["community_index", "community_polities"])
      this.db.exec({ sql: `DELETE FROM ${table} WHERE record_id=?`, bind: [recordId] });
    for (const [id, slice] of communitySlices(society))
      this.db.exec({
        sql: "INSERT OR REPLACE INTO community_index VALUES(?,?,?,?,?)",
        bind: [worldId, id, recordId, areaId, JSON.stringify(slice)],
      });
    for (const polity of society.politics?.polities ?? [])
      this.db.exec({
        sql: "INSERT OR REPLACE INTO community_polities VALUES(?,?,?,?)",
        bind: [worldId, recordId, polity.id, JSON.stringify(polity)],
      });
    const base: Partial<SocietyRegion> = { ...society };
    for (const key of ["communities", "connections", "works", "events", "magic", "politics"])
      delete base[key as keyof SocietyRegion];
    delete (base as { id?: string }).id;
    this.db.exec({
      sql: "INSERT OR REPLACE INTO community_index_sources VALUES(?,?,?,?)",
      bind: [worldId, recordId, revision, JSON.stringify(base)],
    });
  }
  /** The society record's own fields, without its per-community lists. */
  base(recordId: number): SocietyRegion {
    return JSON.parse(
      String(
        this.db.selectValue("SELECT base FROM community_index_sources WHERE record_id=?", [
          recordId,
        ])
      )
    );
  }
  /** The society record holding a community, preferring the given areas in order. */
  slice(worldId: string, communityId: string, areas: string[]) {
    this.ensure(worldId);
    const row = this.db.selectObject(
      `SELECT record_id,data FROM community_index WHERE world_id=? AND community_id=?
      AND area_id IN (SELECT value FROM json_each(?)) ORDER BY area_id=? DESC LIMIT 1`,
      [worldId, communityId, JSON.stringify(areas), areas[0]]
    );
    return row
      ? { recordId: Number(row.record_id), slice: JSON.parse(String(row.data)) as CommunitySlice }
      : null;
  }
  /** Community names by id, across the world's society records. */
  names(worldId: string, ids: string[]) {
    this.ensure(worldId);
    return new Map(
      this.db
        .selectObjects(
          `SELECT community_id,json_extract(data,'$.community.name') AS name FROM community_index
          WHERE world_id=? AND community_id IN (SELECT value FROM json_each(?))`,
          [worldId, JSON.stringify(ids)]
        )
        .map((row) => [String(row.community_id), String(row.name)])
    );
  }
  communities(recordId: number, ids: string[]) {
    return this.db
      .selectValues(
        `SELECT json_extract(data,'$.community') FROM community_index
        WHERE record_id=? AND community_id IN (SELECT value FROM json_each(?))`,
        [recordId, JSON.stringify(ids)]
      )
      .map((value) => JSON.parse(String(value)) as SocietyCommunity);
  }
  polities(recordId: number, ids: string[]) {
    return this.db
      .selectValues(
        `SELECT data FROM community_polities WHERE record_id=? AND polity_id IN (SELECT value FROM json_each(?))`,
        [recordId, JSON.stringify(ids)]
      )
      .map((value) => JSON.parse(String(value)) as SocietyPolity);
  }
}
