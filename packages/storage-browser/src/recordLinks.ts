import type { Database } from "@sqlite.org/sqlite-wasm";
import {
  requireThat,
  type Area,
  type Connection,
  type CatalogRecord,
  type DomainWrite,
  type World,
} from "@atlas/domain";

interface Link {
  target: string;
  relation: string;
}
function links(data: DomainWrite): Link[] {
  const value = data.value;
  const result: Link[] = [];
  if ("areaId" in value && value.areaId) result.push({ target: value.areaId, relation: "area" });
  if ("relations" in value && value.relations)
    result.push(...value.relations.map((r) => ({ target: r.targetId, relation: r.kind })));
  if ("landmarkId" in value && value.landmarkId)
    result.push({ target: value.landmarkId, relation: "landmark" });
  result.push(...specificLinks(data));
  return result;
}
function areaLinks(area: Area): Link[] {
  const result: Link[] = [];
  if (area.parentId) result.push({ target: area.parentId, relation: "parent" });
  if (area.regionId) result.push({ target: area.regionId, relation: "region" });
  if (area.contextFeatureId) result.push({ target: area.contextFeatureId, relation: "context" });
  for (const crossing of area.boundary?.crossings ?? []) {
    result.push({ target: crossing.featureId, relation: "crossing" });
    if (crossing.nodeId) result.push({ target: crossing.nodeId, relation: "crossing-node" });
  }
  return result;
}
function connectionLinks(connection: Connection): Link[] {
  return [connection.a, connection.b].flatMap((end) => [
    { target: end.areaId, relation: "area" },
    ...(end.featureId ? [{ target: end.featureId, relation: "feature" }] : []),
    ...(end.nodeId ? [{ target: end.nodeId, relation: "node" }] : []),
  ]);
}
function viewLinks(view: World["views"][number]): Link[] {
  return [
    ...(view.region?.parentId ? [{ target: view.region.parentId, relation: "region-parent" }] : []),
    ...(view.regionId ? [{ target: view.regionId, relation: "region" }] : []),
  ];
}
function specificLinks(data: DomainWrite): Link[] {
  switch (data.kind) {
    case "feature":
      return [
        ...Object.keys(data.value.detail).map((target) => ({
          target,
          relation: "representation-area",
        })),
        ...[data.value.attributes.fromCommunity, data.value.attributes.toCommunity]
          .filter((target): target is string => typeof target === "string")
          .map((target) => ({ target, relation: "route-end" })),
      ];
    case "area":
      return areaLinks(data.value);
    case "representation":
      return [{ target: data.value.featureId, relation: "feature" }];
    case "reach":
      return [
        { target: data.value.featureId, relation: "feature" },
        { target: data.value.start, relation: "node" },
        { target: data.value.end, relation: "node" },
      ];
    case "connection":
      return connectionLinks(data.value);
    case "view":
      return viewLinks(data.value);
    case "magic":
      return (data.value.dependsOn ?? []).map((target) => ({ target, relation: "dependsOn" }));
    default:
      return [];
  }
}
export function writeLinks(db: Database, id: number, record: CatalogRecord) {
  db.exec({ sql: "DELETE FROM record_links WHERE source=?", bind: [id] });
  const insert = db.prepare("INSERT OR IGNORE INTO record_links VALUES(?,?,?,?)");
  try {
    for (const link of links(record.data)) {
      insert.bind([id, record.scope.worldId, link.target, link.relation]).step();
      insert.reset();
    }
  } finally {
    insert.finalize();
  }
}
export function writeIdentity(db: Database, record: CatalogRecord) {
  const { worldId } = record.scope,
    { id, kind } = record.reference;
  const previous = db.selectValue("SELECT kind FROM identities WHERE world_id=? AND id=?", [
    worldId,
    id,
  ]);
  // A generated landmark feature presents its authored source under the same semantic id.
  if (
    record.data.kind === "feature" &&
    previous === "landmark" &&
    record.data.value.kind === "landmark" &&
    record.data.value.attributes.causeId === `landmark:${id}`
  )
    return;
  if (
    record.data.kind === "landmark" &&
    previous === "feature" &&
    db.selectValue(
      "SELECT json_extract(data,'$.value.kind')='landmark' AND json_extract(data,'$.value.attributes.causeId')=? FROM records WHERE world_id=? AND kind='feature' AND id=?",
      [`landmark:${id}`, worldId, id]
    ) === 1
  ) {
    db.exec({
      sql: "UPDATE identities SET kind='landmark' WHERE world_id=? AND id=?",
      bind: [worldId, id],
    });
    return;
  }
  requireThat(
    previous === undefined || previous === kind,
    "identity_kind_conflict",
    "An object identity retains its original domain kind."
  );
  db.exec({ sql: "INSERT OR IGNORE INTO identities VALUES(?,?,?)", bind: [worldId, id, kind] });
}
