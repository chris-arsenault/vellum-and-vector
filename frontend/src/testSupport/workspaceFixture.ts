import { afterEach } from "vitest";
import {
  areaSpace,
  attachGrid,
  Band,
  cloneSnapshot,
  configureSpatial,
  Coverage,
  detachGrid,
  mappedField,
  projectChanges,
  spatial,
  type Command,
  type DomainSnapshot,
  type History,
  type ObjectKind,
  type Proposal,
  type DomainWrite,
} from "@atlas/domain";
import { GeometryKernel, GeosSpatial, SpatialCatalog, ZarrResources } from "@atlas/storage-browser";
import { sqliteFixture } from "../../../packages/storage-browser/src/sqliteFixture";
import { blockCacheFixture } from "../../../packages/storage-browser/src/blockCacheFixture";
import { fileStoreFixture } from "../../../packages/storage-browser/src/fileStoreFixture";
import { createWorldSnapshot, worldScope, type WorldCreationInput } from "../worldCreation";
import { executeWorkspaceCommand } from "../workspaceCommands";
import { importState } from "../workspaceImport";
import { LegacyFields } from "../legacyFields";
import { WorkspaceFields } from "../workspaceFields";
import { listTemplates } from "../atlasTemplates";
import { workspaceRasters } from "../workspaceRasters";
import { catalogChanges } from "@atlas/application";

export {
  createWorldSnapshot,
  defaultEpochs,
  worldScope,
  type WorldCreationInput,
} from "../worldCreation";

// Small supplied test data and read-back observations. All edits, spatial queries and
// undo execute through the production catalog; there is no snapshot-based session engine.
const fixtures = new Map<
  string,
  { snapshot: DomainSnapshot; history: History[]; saved?: DomainSnapshot; signature?: string }
>();
let opened: ReturnType<typeof open> | undefined;
async function open() {
  const db = await sqliteFixture();
  const kernel = await GeometryKernel.create();
  const catalog = new SpatialCatalog(db, kernel);
  const files = fileStoreFixture();
  // A small budget so field inputs and command outputs exercise eviction and reload.
  const working = blockCacheFixture(1024 * 1024);
  configureSpatial((precision) => new GeosSpatial(kernel, precision));
  return { db, catalog, resources: new ZarrResources(files.store), files, working };
}
afterEach(async () => {
  if (opened) {
    const current = await opened;
    configureSpatial();
    await current.catalog.close();
    current.working.close();
    current.files.close();
    opened = undefined;
  }
  fixtures.clear();
});
export function fixtureState(id: string) {
  const value = fixtures.get(id);
  if (!value) throw new Error("Unknown supplied world.");
  return value;
}
export async function fixtureWorkspace(id: string) {
  return ready(id);
}
export function fixtureWorld(input: WorldCreationInput) {
  return registerWorldSnapshot(createWorldSnapshot(input));
}
export function registerWorldSnapshot(snapshot: DomainSnapshot) {
  fixtures.set(snapshot.world.id, { snapshot, history: [] });
  return snapshot.world;
}
export function listWorlds() {
  return [...fixtures.values()].map(({ snapshot: { world } }) => ({
    id: world.id,
    name: world.name,
    version: world.version,
  }));
}
async function ready(id: string) {
  const current = await (opened ??= open());
  const entry = fixtureState(id);
  const signature = snapshotSignature(entry.snapshot);
  if (signature !== entry.signature) {
    entry.saved = await importState(
      current,
      new LegacyFields(),
      entry.snapshot,
      entry.saved,
      undefined,
      current.working.cache
    );
    entry.signature = signature;
  }
  return current;
}
/** Bands serialize as their samples; coverages are accounting, not content. */
function snapshotSignature(snapshot: DomainSnapshot) {
  return JSON.stringify(snapshot, (_key, value) =>
    value instanceof Band ? Array.from(value) : value instanceof Coverage ? undefined : value
  );
}
/** Loaded grids page through the read's inputs; keep resident copies past its close. */
function resident(snapshot: DomainSnapshot): DomainSnapshot {
  return {
    ...snapshot,
    numerical: Object.fromEntries(
      Object.entries(snapshot.numerical).map(([id, grid]) => [
        id,
        attachGrid(detachGrid(grid)) as (typeof snapshot.numerical)[string],
      ])
    ),
  };
}
async function observe(id: string, current: Awaited<ReturnType<typeof open>>) {
  const world = await current.catalog.readEditor(id);
  const root = Object.values(world.areas).find((area) => !area.parentId)!;
  const rows = current.db.selectObjects("SELECT kind,id FROM records WHERE world_id=?", [id]);
  const requirements = {
    scope: worldScope(world, root.id),
    objects: rows.map((row) => ({ kind: String(row.kind) as ObjectKind, ids: [String(row.id)] })),
    channels: world.fields.map((field) => ({ fieldId: field.id, names: field.channels ?? [] })),
    spatialLayers: [],
    parentHistory: [],
    dependencies: false,
  };
  const snapshot = await current.catalog.readAuthoring(requirements);
  const fields = new WorkspaceFields(current.catalog, current.resources, current.working.cache);
  try {
    await fields.read(snapshot, requirements);
    const entry = fixtureState(id);
    entry.snapshot = resident(snapshot);
    entry.saved = cloneSnapshot(entry.snapshot);
    entry.signature = snapshotSignature(entry.snapshot);
    entry.history = await current.catalog.readHistory(id, null, 1000);
    return entry.snapshot;
  } finally {
    await fields.close();
  }
}
function scope(snapshot: DomainSnapshot, areaId: string) {
  return { worldId: snapshot.world.id, areaId, spaceId: areaSpace(snapshot.world, areaId) };
}
async function execute(id: string, command: Command, preview: boolean): Promise<Proposal> {
  const current = await ready(id);
  const source = fixtureState(id).snapshot;
  const areaId = String(
    command.data.areaId ??
      command.data.parentId ??
      Object.values(source.world.areas).find((area) => !area.parentId)!.id
  );
  const result = await executeWorkspaceCommand(
    current.catalog,
    current.resources,
    {
      scope: scope(source, areaId),
      command,
      preview,
      template: listTemplates().find((template) => template.id === command.data.templateId),
    },
    current.working.cache
  );
  const candidate = preview
    ? projectChanges(source, {
        operationId: command.operationId,
        worldId: id,
        expectedVersion: source.world.version,
        actor: "user",
        readSet: [],
        writes: result.preview,
        removes: [],
        invalidations: [],
        highImpact: false,
      }).world
    : (await observe(id, current)).world;
  return { candidate, impact: result.impact };
}
export const commitCommand = (id: string, command: Command) => execute(id, command, false);
export const previewCommand = (id: string, command: Command) => execute(id, command, true);
export async function commitFixtureRecords(id: string, writes: DomainWrite[]) {
  const current = await ready(id);
  const source = await observe(id, current);
  const operation = crypto.randomUUID();
  await current.catalog.commit(
    catalogChanges(
      source,
      {
        operationId: operation,
        worldId: id,
        expectedVersion: source.world.version,
        actor: "user",
        readSet: [],
        writes,
        removes: [],
        invalidations: [],
        highImpact: false,
      },
      [],
      "fixture"
    )
  );
  return { world: (await observe(id, current)).world, operation };
}
export async function undoWorld(id: string, operationId: string) {
  const current = await ready(id);
  await current.catalog.undo(id, operationId);
  return (await observe(id, current)).world;
}
export async function readFeature(id: string, featureId: string, areaId: string) {
  const current = await ready(id);
  return current.catalog.readFeature(scope(fixtureState(id).snapshot, areaId), featureId);
}
export async function readScene(id: string, areaId: string, extent?: number[]) {
  const current = await ready(id);
  const snapshot = fixtureState(id).snapshot;
  const query = {
    scope: scope(snapshot, areaId),
    extent: (extent ?? spatial.bounds(snapshot.world.areas[areaId].footprint)) as [
      number,
      number,
      number,
      number,
    ],
    layers: [],
    geometry: null,
    predicate: "intersects" as const,
    limit: 128,
  };
  const features = [];
  let after: string | null = null;
  do {
    const page = await current.catalog.readFeatures({ ...query, after });
    features.push(...page.records.map((record) => record.feature));
    after = page.next;
  } while (after);
  return features;
}
export async function readMapRasters(id: string, areaId: string) {
  const current = await ready(id);
  return workspaceRasters(current, id, areaId, [0, 0, 100_000, 100_000], 0);
}
export async function readRaster(id: string, fieldId: string, channel: string, areaId?: string) {
  const snapshot = await observe(id, await ready(id));
  const field = mappedField(snapshot.numerical[fieldId], snapshot.world, areaId);
  return {
    id: fieldId,
    areaId: field.scope.areaId,
    footprint: field.scope.footprint,
    bounds: field.bounds,
    channel,
    field,
  };
}
export async function exportWorld(id: string, areaId?: string) {
  const current = await ready(id);
  const world = await current.catalog.readEditor(id);
  const features = [];
  let after: string | null = null;
  do {
    const page = current.catalog.exportFeatures(id, areaId, after, 64);
    features.push(...page.features);
    after = page.next;
  } while (after);
  return {
    features,
    worldReference: world.reference,
    regions: world.views.filter((view) => view.region),
  };
}
