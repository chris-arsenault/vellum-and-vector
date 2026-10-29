import type { Database } from "@sqlite.org/sqlite-wasm";
import {
  requireThat,
  type Area,
  type DomainSnapshot,
  type ReadRequirements,
  type World,
  type WorldMetadata,
  type Bounds,
  type DomainWrite,
  type AuthoringFeatureQuery,
} from "@atlas/domain";
import { RecordSelection } from "./recordSelection";
import type { GeometryKernel } from "./geometryKernel";
import { authoringFeatureIds } from "./authoringPage";

function worldProjection(metadata: WorldMetadata): World {
  return {
    ...metadata,
    areas: {},
    features: {},
    entities: {},
    templates: {},
    connections: {},
    networkNodes: {},
    networkReaches: {},
    fields: [],
    magic: [],
    landmarks: [],
    views: [],
  };
}
function emptySnapshot(
  metadata: WorldMetadata,
  scope: DomainSnapshot["scope"],
  identities: DomainSnapshot["identities"]
): DomainSnapshot {
  return {
    world: worldProjection(metadata),
    scope,
    identities,
    revisions: [],
    resources: [],
    numerical: {},
    coverage: [],
    fieldPatches: [],
  };
}
type Projection = Pick<DomainSnapshot, "world" | "revisions" | "coverage" | "fieldPatches">;
function install(snapshot: Projection, selection: RecordSelection) {
  const world = snapshot.world;
  for (const record of selection.records.values()) {
    const data = record.data;
    snapshot.revisions.push({
      kind: record.reference.kind,
      id: record.reference.id,
      revisionId: record.reference.id,
      version: record.reference.revision,
    });
    installRecord(world, data);
    installList(snapshot, data);
  }
  for (const { data } of selection.ofKind("representation"))
    if (data.kind === "representation") {
      const { featureId, areaId, ...detail } = data.value;
      if (world.features[featureId]) world.features[featureId].detail[areaId] = detail;
    }
}
function installRecord(world: World, data: DomainWrite) {
  switch (data.kind) {
    case "area":
      world.areas[data.value.id] = data.value;
      break;
    case "feature":
      world.features[data.value.id] = data.value;
      break;
    case "entity":
      world.entities[data.value.id] = data.value;
      break;
    case "layer":
      world.layers[data.value.id] = data.value;
      break;
    case "connection":
      world.connections![data.value.id] = data.value;
      break;
    case "node":
      world.networkNodes![data.value.id] = data.value;
      break;
    case "reach":
      world.networkReaches![data.value.id] = data.value;
      break;
    default:
      installGeographicState(world, data);
  }
}
function installGeographicState(world: World, data: DomainWrite) {
  switch (data.kind) {
    case "society": {
      const { id, ...value } = data.value;
      void id;
      (world.societies ??= {})[value.areaId] = value;
      break;
    }
    case "drainage": {
      const { id, ...value } = data.value;
      void id;
      (world.drainage ??= {})[value.areaId] = value;
      break;
    }
  }
}
function installList(snapshot: Projection, data: DomainWrite) {
  switch (data.kind) {
    case "field":
      snapshot.world.fields.push(data.value);
      break;
    case "magic":
      snapshot.world.magic.push(data.value);
      break;
    case "landmark":
      snapshot.world.landmarks.push(data.value);
      break;
    case "view":
      snapshot.world.views.push(data.value);
      break;
    case "coverage":
      snapshot.coverage.push(data.value);
      break;
    case "fieldPatch":
      snapshot.fieldPatches.push(data.value);
      break;
  }
}
function recordAreas(selection: RecordSelection, complete: boolean) {
  const ids: string[] = [];
  for (const { data, scope } of selection.records.values()) {
    ids.push(scope.areaId);
    if (complete && data.kind === "feature") ids.push(...Object.keys(data.value.detail));
    if (data.kind === "connection") ids.push(data.value.a.areaId, data.value.b.areaId);
  }
  return ids;
}
/** Reuse the existing domain read contract without hydrating numerical resources. */
export class CatalogProjection {
  constructor(
    private db: Database,
    private kernel: GeometryKernel
  ) {}
  metadata(worldId: string): WorldMetadata {
    const row = this.db.selectObject("SELECT data,revision FROM worlds WHERE id=?", [worldId]);
    requireThat(row, "missing_world", "Choose an existing world.");
    return { ...JSON.parse(String(row.data)), version: Number(row.revision) };
  }
  /** Configuration for the editor; geographic objects and samples remain query-owned. */
  editor(worldId: string): World {
    const selection = new RecordSelection(worldId, this.db, this.kernel);
    selection.select("r.kind IN ('area','entity','layer','field','magic','landmark','view')");
    const world = worldProjection(this.metadata(worldId));
    delete world.societies;
    delete world.drainage;
    const snapshot = { world, revisions: [], coverage: [], fieldPatches: [] };
    install(snapshot, selection);
    return world;
  }
  read(input: ReadRequirements, featurePage?: string[]): DomainSnapshot {
    const metadata = this.metadata(input.scope.worldId);
    requireThat(
      metadata.reference.id === input.scope.crsId,
      "reference_mismatch",
      "The requested CRS does not match this world."
    );
    requireThat(
      metadata.version === input.scope.revision,
      "stale_version",
      "The world changed. Read its current revision."
    );
    const selection = new RecordSelection(metadata.id, this.db, this.kernel);
    if (featurePage) selection.ids(featurePage);
    else selection.explicit(input);
    if (!featurePage) selection.connected(input);
    selection.related(
      selection.ofKind("representation").map((r) => r.reference.id),
      ["feature"],
      false
    );
    if (!featurePage) this.spatial(input, selection);
    if (!featurePage)
      selection.bindings(
        [...selection.records.values()].map((r) => r.reference.id),
        input.dependencies
      );
    if (featurePage) this.pageNetwork(selection, featurePage);
    else if (input.dependencies) this.network(selection);
    selection.representations();
    this.areas(input, selection);
    this.fields(input, selection);
    const snapshot = emptySnapshot(metadata, input.scope, selection.identities());
    install(snapshot, selection);
    return snapshot;
  }
  readPage(input: AuthoringFeatureQuery, after: string | null, limit: number) {
    const ids = authoringFeatureIds(
      this.db,
      this.kernel,
      input,
      after,
      limit,
      this.metadata(input.scope.worldId).reference.precision ?? 1e-6
    );
    const reads: ReadRequirements = {
      scope: input.scope,
      objects: [],
      spatialLayers: [],
      channels: [],
      parentHistory: [],
      dependencies: false,
    };
    return { snapshot: this.read(reads, ids), next: ids.length === limit ? ids.at(-1)! : null };
  }
  private pageNetwork(selection: RecordSelection, ids: string[]) {
    const related = selection.related(ids, ["feature", "crossing"], true);
    selection.related(
      related.map((record) => record.reference.id),
      ["node", "crossing-node"],
      false
    );
  }
  private spatial(input: ReadRequirements, selection: RecordSelection) {
    const bounds = this.kernel.encode(
      input.scope.footprint,
      this.metadata(selection.worldId).reference.precision ?? 1e-6
    ).bounds;
    const owner = selection.ownedArea(input.scope.areaId);
    if (input.spatialLayers.length) {
      this.intersecting(
        selection,
        input.scope.spaceId,
        bounds,
        "feature",
        input.spatialLayers,
        owner
      );
    }
    if (input.layerContents?.length)
      selection.select(
        "r.kind='feature' AND json_extract(r.data,'$.value.layerId') IN (SELECT value FROM json_each(?))",
        [JSON.stringify(input.layerContents)]
      );
    if (input.channels.length || input.constraints?.intersectingAreas) {
      this.intersecting(selection, input.scope.spaceId, bounds, "coverage", null, owner);
      this.intersecting(selection, input.scope.spaceId, bounds, "fieldPatch", null, owner);
    }
    this.constraints(input, selection, bounds);
  }
  private constraints(input: ReadRequirements, selection: RecordSelection, bounds: Bounds) {
    if (input.constraints?.intersectingAreas)
      this.intersecting(selection, input.scope.spaceId, bounds, "area");
    for (const id of input.constraints?.descendantsOf ?? []) this.descendants(selection, id);
    selection.related(input.constraints?.boundaryFeatures ?? [], ["crossing"], true);
  }
  private intersecting(
    selection: RecordSelection,
    spaceId: string,
    b: Bounds,
    kind: string,
    layers: string[] | null = null,
    owner: string | null = null
  ) {
    return selection.select(
      `r.space_id=? AND r.kind=? AND r.record_id IN (SELECT record_id FROM record_bounds WHERE min_x<=? AND max_x>=? AND min_y<=? AND max_y>=?)
      AND (? IS NULL OR json_extract(r.data,'$.value.layerId') IN (SELECT value FROM json_each(?)))
      AND (? IS NULL OR r.area_id=?)`,
      [
        spaceId,
        kind,
        b[2],
        b[0],
        b[3],
        b[1],
        layers ? JSON.stringify(layers) : null,
        JSON.stringify(layers),
        owner,
        owner,
      ]
    );
  }
  private descendants(selection: RecordSelection, id: string) {
    selection.select(
      `r.kind='area' AND r.id IN (WITH RECURSIVE children(id) AS (
      SELECT ? UNION SELECT a.id FROM records a JOIN children c ON json_extract(a.data,'$.value.parentId')=c.id
      WHERE a.world_id=? AND a.kind='area') SELECT id FROM children)`,
      [id, selection.worldId]
    );
  }
  private network(selection: RecordSelection) {
    selection.attachedRoutes();
    const features = selection.ofKind("feature").map((r) => r.reference.id);
    const reaches = selection
      .related(features, ["feature"], true)
      .filter((r) => r.data.kind === "reach");
    const nodes = selection
      .related(
        reaches.map((r) => r.reference.id),
        ["node"],
        false
      )
      .map((r) => r.reference.id);
    const adjacent = selection.related(nodes, ["node"], true);
    selection.related(
      adjacent.map((r) => r.reference.id),
      ["feature"],
      false
    );
    selection.bindings(
      selection.ofKind("feature").map((r) => r.reference.id),
      false
    );
    selection.related([...features, ...nodes], ["feature", "node"], true);
  }
  private areas(input: ReadRequirements, selection: RecordSelection, complete = true) {
    selection.get("area", input.scope.areaId);
    let frontier = [input.scope.areaId, ...recordAreas(selection, complete)];
    const seen = new Set<string>();
    while (frontier.length) {
      const next: string[] = [];
      for (const id of frontier)
        if (!seen.has(id)) {
          seen.add(id);
          const record = selection.get("area", id);
          if (record?.data.kind === "area" && record.data.value.parentId)
            next.push(record.data.value.parentId);
        }
      frontier = next;
    }
  }
  private fields(input: ReadRequirements, selection: RecordSelection) {
    for (const { fieldId } of input.channels) selection.get("field", fieldId);
    const areas = selection.ownedArea(input.scope.areaId)
      ? [input.scope.areaId]
      : selection.ofKind("area").map((r) => r.reference.id);
    selection.select(
      "(r.kind='layer' OR (r.kind='field' AND r.area_id IN (SELECT value FROM json_each(?))))",
      [JSON.stringify(areas)]
    );
    const requestedAreas = input.objects.filter((o) => o.kind === "view").length ? areas : [];
    selection.select("r.kind='view' AND r.area_id IN (SELECT value FROM json_each(?))", [
      JSON.stringify(requestedAreas),
    ]);
    let frontier = [...selection.records.values()].map((r) => r.reference.id);
    const visited = new Set<string>();
    while (frontier.length) {
      for (const id of frontier) visited.add(id);
      frontier = selection
        .related(frontier, ["region-parent", "region"], false)
        .map((r) => r.reference.id)
        .filter((id) => !visited.has(id));
    }
  }
  context(worldId: string, areaId: string, featureIds: string[], complete = false) {
    const metadata = this.metadata(worldId);
    const selection = new RecordSelection(worldId, this.db, this.kernel);
    selection.ids(featureIds);
    selection.bindings(featureIds, false);
    const root = selection.get("area", areaId);
    requireThat(root?.data.kind === "area", "missing_area", "Choose an existing mapped area.");
    const area: Area = root.data.value;
    const scope = {
      worldId,
      areaId,
      spaceId: root.scope.spaceId,
      crsId: metadata.reference.id,
      revision: metadata.version,
      footprint: area.footprint,
      time: "present",
      resolution: null,
    };
    const reads: ReadRequirements = {
      scope,
      objects: [],
      channels: [],
      spatialLayers: [],
      parentHistory: [],
      dependencies: false,
    };
    if (complete) return this.read({ ...reads, references: featureIds });
    this.areas(reads, selection, false);
    const ancestors = selection.lineage(areaId);
    selection.representations(ancestors);
    for (const { data } of selection.ofKind("feature"))
      if (data.kind === "feature")
        data.value.detail = Object.fromEntries(
          Object.entries(data.value.detail).filter(([id]) => ancestors.includes(id))
        );
    const snapshot = emptySnapshot(metadata, scope, {});
    install(snapshot, selection);
    return snapshot;
  }
}
