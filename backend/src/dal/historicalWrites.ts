import { requireThat, type DomainWrite, type ObjectKind } from "@atlas/domain";
import type { Sql } from "./database";
import { readAreas } from "./areaReader";
import { readFeatures, readEntities, readLayers } from "./objectReaders";
import { readNodes, readReaches, readConnections } from "./networkRows";
import { readFieldBindings } from "./fieldBindings";
import { readRepresentationRows } from "./representations";
import { readAttributes } from "./attributes";
import { geometrySchema, materializationStates } from "@atlas/domain";
import { readCoverage } from "./coverage";
import { readFieldPatches } from "./fieldPatches";
import { readMagic, readViews } from "./settings";

export async function historicalWrites(
  sql: Sql,
  world: string,
  version: number,
  objects: { kind: ObjectKind; id: string }[]
): Promise<DomainWrite[]> {
  const result: DomainWrite[] = [],
    ids = (kind: ObjectKind) => objects.filter((o) => o.kind === kind).map((o) => o.id);
  result.push(
    ...Object.values((await readMagic(sql, world, version)).objects)
      .filter((m) => ids("magic").includes(m.id))
      .map((value) => ({ kind: "magic" as const, value }))
  );
  result.push(
    ...Object.values((await readViews(sql, world, version)).objects)
      .filter((v) => ids("view").includes(v.id))
      .map((value) => ({ kind: "view" as const, value }))
  );
  for (const value of Object.values((await readAreas(sql, world, version, ids("area"))).objects))
    result.push({ kind: "area", value });
  for (const value of Object.values(
    (await readFeatures(sql, world, version, ids("feature"))).objects
  ))
    result.push({ kind: "feature", value });
  for (const value of Object.values(
    (await readEntities(sql, world, version, ids("entity"))).objects
  ))
    result.push({ kind: "entity", value });
  if (ids("layer").length)
    for (const value of Object.values((await readLayers(sql, world, version)).objects).filter((v) =>
      ids("layer").includes(v.id)
    ))
      result.push({ kind: "layer", value });
  for (const value of Object.values((await readNodes(sql, world, version, ids("node"))).objects))
    result.push({ kind: "node", value });
  for (const value of Object.values((await readReaches(sql, world, version, ids("reach"))).objects))
    result.push({ kind: "reach", value });
  for (const value of Object.values(
    (await readConnections(sql, world, version, ids("connection"))).objects
  ))
    result.push({ kind: "connection", value });
  for (const value of Object.values(
    (await readFieldBindings(sql, world, version, [], ids("field"))).objects
  )) {
    requireThat(
      value.resourceId,
      "legacy_field_transition",
      "A prototype field must be imported before editing its binding."
    );
    result.push({ kind: "field", value: { ...value, resourceId: value.resourceId } });
  }
  result.push(...(await historicalRepresentations(sql, world, version, ids("representation"))));
  result.push(
    ...Object.values(
      (await readFieldPatches(sql, world, version, [], null, ids("fieldPatch"))).objects
    ).map((value) => ({ kind: "fieldPatch" as const, value }))
  );
  result.push(
    ...Object.values((await readCoverage(sql, world, version, null, ids("coverage"))).objects).map(
      (value) => ({ kind: "coverage" as const, value })
    )
  );
  requireThat(
    result.length === objects.length,
    "missing_historical_revision",
    "The retained operation does not have all required source revisions."
  );
  return result;
}
async function historicalRepresentations(
  sql: Sql,
  world: string,
  version: number,
  ids: string[]
): Promise<DomainWrite[]> {
  if (ids.length === 0) return [];
  const identities = await sql.query<{ feature_id: string }>(
    "SELECT DISTINCT feature_id FROM atlas_representation_ids WHERE scope_id=$1 AND id=ANY($2::uuid[])",
    [world, ids]
  );
  const rows = (
    await readRepresentationRows(
      sql,
      world,
      version,
      identities.rows.map((r) => r.feature_id),
      null
    )
  ).filter((r) => ids.includes(r.id));
  const attributes = await readAttributes(
    sql,
    rows.map((r) => r.revision_id)
  );
  return rows.map((r) => ({
    kind: "representation",
    value: {
      id: r.id,
      featureId: r.feature_id,
      areaId: r.area_id,
      geometry: geometrySchema.parse(JSON.parse(r.geometry)),
      state: materializationStates[r.state],
      actor: r.actor,
      generationId: r.generation_id,
      protected: r.protected,
      needsReconciliation: r.needs_reconciliation,
      attributes: r.has_attributes ? attributes.get(r.revision_id)! : null,
    },
  }));
}
