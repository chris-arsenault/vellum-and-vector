import {
  requireThat,
  gridType,
  type DomainSnapshot,
  type ReadRequirements,
  type RevisionReference,
  type AtlasFeature,
  type Connection,
  overlayField,
} from "@atlas/domain";
import { Database, ownedVersion, type Sql } from "./database";
import { readWorldHeader } from "./worldHeader";
import { ancestorIds, readAreas } from "./areaReader";
import { readEntities, readFeatures, readLayers } from "./objectReaders";
import { readSelectedNetwork } from "./networkSelection";
import {
  selectedIds,
  spatialFeatureIds,
  dependentIds,
  bindingSourceIds,
  adjacentNetworkFeatures,
} from "./selection";
import { boundFieldResource, readFieldBindings } from "./fieldBindings";
import { readGridSelection } from "./gridSelections";
import { readFieldArtifact, loadField } from "./fieldArtifacts";
import {
  constraintAreaIds,
  readReferenceRevisions,
  layerContentIds,
  layerAreaIds,
  identityKinds,
} from "./constraintSelection";
import { readCoverage } from "./coverage";
import { readFieldPatches } from "./fieldPatches";

export async function readProjection(sql: Sql, input: ReadRequirements): Promise<DomainSnapshot> {
  const metadataReferences: RevisionReference[] = [];
  const s = input.scope,
    world = await readWorldHeader(sql, s.worldId, s.revision, metadataReferences);
  requireThat(
    world.reference.id === s.crsId,
    "reference_mismatch",
    "The requested CRS does not match this world."
  );
  const featureIds = await projectionFeatureIds(sql, input);
  const features = await readFeatures(
    sql,
    world.id,
    world.version,
    featureIds,
    input.layerContents?.length
      ? null
      : {
          ...s,
          ids: selectedIds(input, "representation"),
          completeFeatures: await bindingSourceIds(
            sql,
            world.id,
            world.version,
            input.completeRepresentations ?? []
          ),
        }
  );
  const { nodes, reaches, connections } = await readSelectedNetwork(sql, input, featureIds);
  const areas = await projectionAreas(sql, input, features.objects, connections.objects);
  const layers = await readLayers(sql, world.id, world.version);
  const entities = await readEntities(sql, world.id, world.version, selectedIds(input, "entity"));
  const fields = await projectionFields(sql, input, Object.keys(areas.objects));
  Object.assign(world, {
    features: features.objects,
    areas: areas.objects,
    layers: layers.objects,
    entities: entities.objects,
    connections: connections.objects,
    networkNodes: nodes.objects,
    networkReaches: reaches.objects,
    fields: Object.values(fields.objects),
  });
  const revisions: RevisionReference[] = [
    features,
    areas,
    layers,
    entities,
    connections,
    nodes,
    reaches,
    fields,
  ].flatMap((r) => r.revisions);
  revisions.push(...metadataReferences);
  const { coverage, patches } = await projectionPatches(
    sql,
    input,
    Object.keys(fields.objects),
    revisions
  );
  await appendReferences(sql, input, revisions);
  const snapshot: DomainSnapshot = {
    world,
    scope: s,
    revisions,
    resources: [],
    numerical: {},
    identities: await identityKinds(sql, input),
    coverage: Object.values(coverage.objects),
    fieldPatches: Object.values(patches.objects),
  };
  await loadResources(sql, input, snapshot);
  return snapshot;
}
async function projectionFields(sql: Sql, input: ReadRequirements, areas: string[]) {
  const s = input.scope;
  return readFieldBindings(
    sql,
    s.worldId,
    s.revision,
    areas,
    [...selectedIds(input, "field"), ...input.channels.map((c) => c.fieldId)],
    input.layerContents
  );
}
async function projectionPatches(
  sql: Sql,
  input: ReadRequirements,
  fields: string[],
  revisions: RevisionReference[]
) {
  const s = input.scope;
  const coverage = await readCoverage(
    sql,
    s.worldId,
    s.revision,
    s,
    selectedIds(input, "coverage")
  );
  const patches = await readFieldPatches(
    sql,
    s.worldId,
    s.revision,
    fields,
    s,
    selectedIds(input, "fieldPatch")
  );
  revisions.push(...coverage.revisions, ...patches.revisions);
  return { coverage, patches };
}
async function appendReferences(sql: Sql, input: ReadRequirements, revisions: RevisionReference[]) {
  const references = await readReferenceRevisions(sql, input),
    keys = new Set(revisions.map((r) => `${r.kind}:${r.id}`));
  revisions.push(...references.filter((r) => !keys.has(`${r.kind}:${r.id}`)));
}
async function loadResources(sql: Sql, input: ReadRequirements, snapshot: DomainSnapshot) {
  await loadNumerical(sql, input, snapshot);
  for (const id of input.parentHistory)
    snapshot.resources.push(
      (await readFieldArtifact(sql, snapshot.world.id, id, snapshot.world.version)).reference
    );
}
async function projectionAreas(
  sql: Sql,
  input: ReadRequirements,
  features: Record<string, AtlasFeature>,
  connections: Record<string, Connection>
) {
  const s = input.scope;
  const areaIds = await ancestorIds(sql, s.worldId, s.revision, [
    s.areaId,
    ...selectedIds(input, "area"),
    ...(await constraintAreaIds(sql, input)),
    ...(await layerAreaIds(sql, input)),
    ...Object.values(features).flatMap((f) => [f.areaId, ...Object.keys(f.detail)]),
    ...Object.values(connections).flatMap((c) => [c.a.areaId, c.b.areaId]),
  ]);
  const areas = await readAreas(sql, s.worldId, s.revision, areaIds);
  requireThat(
    areas.objects[s.areaId]?.spaceId === s.spaceId,
    "space_mismatch",
    "The requested area belongs to a different located space."
  );
  return areas;
}
async function projectionFeatureIds(sql: Sql, input: ReadRequirements) {
  const s = input.scope;
  let featureIds = [
    ...new Set([...selectedIds(input, "feature"), ...(await spatialFeatureIds(sql, input))]),
  ];
  featureIds.push(...(await layerContentIds(sql, input)));
  const representationFeatures = await sql.query<{ feature_id: string }>(
    "SELECT feature_id FROM atlas_representation_ids WHERE scope_id=$1 AND id=ANY($2::uuid[])",
    [s.worldId, selectedIds(input, "representation")]
  );
  featureIds.push(...representationFeatures.rows.map((r) => r.feature_id));
  if (input.dependencies) featureIds.push(...(await selectedNetworkFeatures(sql, input)));
  if (input.dependencies)
    featureIds.push(...(await adjacentNetworkFeatures(sql, s.worldId, s.revision, featureIds)));
  if (input.dependencies) featureIds = await dependentIds(sql, s.worldId, s.revision, featureIds);
  return bindingSourceIds(sql, s.worldId, s.revision, featureIds);
}

async function selectedNetworkFeatures(sql: Sql, input: ReadRequirements): Promise<string[]> {
  const s = input.scope;
  const result = await sql.query<{ id: string | null }>(
    `SELECT feature_id AS id FROM atlas_reaches WHERE scope_id=$1 AND valid_from<=$2 AND (valid_to IS NULL OR valid_to>$2)
    AND (id=ANY($3::uuid[]) OR start_id=ANY($4::uuid[]) OR end_id=ANY($4::uuid[]))
    UNION SELECT unnest(ARRAY[a_feature,b_feature]) FROM atlas_connections WHERE scope_id=$1 AND valid_from<=$2 AND (valid_to IS NULL OR valid_to>$2)
      AND (id=ANY($5::uuid[]) OR a_node=ANY($4::uuid[]) OR b_node=ANY($4::uuid[]))`,
    [
      s.worldId,
      s.revision,
      selectedIds(input, "reach"),
      selectedIds(input, "node"),
      selectedIds(input, "connection"),
    ]
  );
  return result.rows.flatMap((r) => (r.id ? [r.id] : []));
}
async function loadNumerical(sql: Sql, input: ReadRequirements, snapshot: DomainSnapshot) {
  const s = input.scope;
  for (const selection of input.channels) {
    const field = snapshot.world.fields.find((f) => f.id === selection.fieldId);
    requireThat(
      field,
      "missing_field",
      "A requested numerical field is not bound in this geographic context."
    );
    const { reference: resource, gridId } = await boundFieldResource(sql, s, field);
    requireThat(
      resource.kind === gridType.kind &&
        resource.scope.spaceId === s.spaceId &&
        resource.scope.crsId === s.crsId,
      "field_type",
      "A numerical field must reference a grid artifact."
    );
    snapshot.numerical[field.id] = await readGridSelection(
      sql,
      s.worldId,
      gridId,
      resource.scope,
      s.footprint,
      selection.names,
      selection.haloCells
    );
    snapshot.resources.push(resource);
    snapshot.numerical[field.id].scope = {
      ...snapshot.numerical[field.id].scope,
      revision: s.revision,
    };
    await loadFieldOverlays(sql, snapshot, field.id);
  }
}
async function loadFieldOverlays(sql: Sql, snapshot: DomainSnapshot, field: string) {
  const grid = snapshot.numerical[field],
    s = grid.scope;
  const patches = await readFieldPatches(sql, s.worldId, s.revision, [field], s);
  for (const patch of Object.values(patches.objects)) {
    if (!snapshot.fieldPatches.some((p) => p.id === patch.id)) snapshot.fieldPatches.push(patch);
    const { reference } = await readFieldArtifact(sql, s.worldId, patch.resourceId, s.revision);
    overlayField(grid, await loadField(sql, reference, s.revision), patch.channels);
    snapshot.resources.push(reference);
  }
  const known = new Set(snapshot.revisions.map((r) => r.revisionId));
  snapshot.revisions.push(...patches.revisions.filter((r) => !known.has(r.revisionId)));
  snapshot.fieldPatches.sort(
    (a, b) => a.createdVersion - b.createdVersion || a.id.localeCompare(b.id)
  );
}
export class ProjectionRepository {
  constructor(private readonly database: Database) {}
  async read(world: string, owner: string, input: ReadRequirements): Promise<DomainSnapshot> {
    return this.database.transaction(async (sql) => {
      const current = await ownedVersion(sql, world, owner);
      requireThat(
        input.scope.worldId === world && input.scope.revision <= current,
        "invalid_revision",
        "Requested world revision is unavailable."
      );
      return readProjection(sql, input);
    }, true);
  }
}
