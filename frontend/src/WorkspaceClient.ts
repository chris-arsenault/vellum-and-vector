import type {
  SpatialStore,
  WorldMetadata,
  WorkspaceScope,
  ObjectKind,
  FeatureQuery,
  CatalogChanges,
  RegionQuery,
  RegionDrawing,
  ReadRequirements,
  DomainSnapshot,
  World,
  Bounds,
  AuthoringFeatureQuery,
  CatalogPublication,
  RegistryRequest,
} from "@atlas/domain";
import type {
  CatalogMethod,
  CatalogResult,
  WorkspaceOperation,
  WorkspaceReply,
  WorkspaceCommand,
  WorkspaceCommandResult,
} from "./workspaceProtocol";
import type { RasterGeography, RasterGeographyReference, ResourceRaster } from "./types";

/** The editor's handle on the catalog worker. Catalog methods cross as one typed call. */
export class WorkspaceClient implements SpatialStore {
  private sequence = 0;
  private failed: Error | null = null;
  private closed = false;
  private publications = new Map<string, string>();
  private pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();
  constructor(private worker: Worker | MessagePort) {
    worker.onmessage = (event: MessageEvent<WorkspaceReply>) => {
      const item = this.pending.get(event.data.id);
      if (!item) return;
      this.pending.delete(event.data.id);
      if ("error" in event.data) item.reject(new Error(event.data.error));
      else item.resolve(event.data.value);
    };
    if ("onerror" in worker) worker.onerror = (event) => this.fail(new Error(event.message));
    worker.onmessageerror = () =>
      this.fail(new Error("Could not read geographic workspace output."));
    if ("start" in worker) worker.start();
  }
  private fail(error: Error) {
    this.failed = error;
    for (const item of this.pending.values()) item.reject(error);
    this.pending.clear();
  }
  private request<T>(operation: WorkspaceOperation): Promise<T> {
    if (this.failed || this.closed)
      return Promise.reject(this.failed ?? new Error("Workspace closed."));
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject });
      this.worker.postMessage(
        { id, operation },
        operation.kind === "connect" ? [operation.port] : []
      );
    });
  }
  private catalog<M extends CatalogMethod>(
    worldId: string,
    method: M,
    ...args: Parameters<import("@atlas/storage-browser").SpatialCatalog[M]>
  ) {
    return this.request<CatalogResult<M>>({ kind: "catalog", worldId, method, args });
  }
  async open(name: string) {
    await this.request<void>({ kind: "open", name });
  }
  connect(port: MessagePort) {
    return this.request<void>({ kind: "connect", port });
  }
  // Session and world lifecycle.
  importWorld(snapshot: DomainSnapshot) {
    return this.request<World>({ kind: "importWorld", worldId: snapshot.world.id, snapshot });
  }
  openLegacyWorld(worldId: string, saved: import("./legacySave").LegacySavedWorld) {
    return this.request<World>({ kind: "openLegacyWorld", worldId, saved });
  }
  openSavedWorld(worldId: string, root: { name: string; path: string }) {
    return this.request<World>({ kind: "openSavedWorld", worldId, root });
  }
  saveWorld(worldId: string) {
    return this.request<{ root: { name: string; path: string }; name: string; version: number }>({
      kind: "saveWorld",
      worldId,
    });
  }
  exportWorld(worldId: string, areaId?: string) {
    return this.request<File>({ kind: "export", worldId, areaId });
  }
  abandonOperation(worldId: string, operationId: string) {
    return this.request<void>({ kind: "abandonOperation", worldId, operationId });
  }
  // Application operations executed beside the catalog.
  readRasters(worldId: string, areaId: string, extent: Bounds, tolerance = 0) {
    return this.request<ResourceRaster[]>({
      kind: "readRasters",
      worldId,
      areaId,
      extent,
      tolerance,
    });
  }
  readRasterGeography(reference: RasterGeographyReference) {
    return this.request<RasterGeography>({
      kind: "readRasterGeography",
      worldId: reference.scope.worldId,
      reference,
    });
  }
  generationSource(worldId: string, areaId: string) {
    return this.request<DomainSnapshot>({ kind: "generationSource", worldId, areaId });
  }
  generationSetup(worldId: string, input: import("@atlas/generation").AtlasGenerationInput) {
    return this.request<{
      input: import("@atlas/generation").AtlasGenerationInput;
      diagnostics: import("@atlas/domain").Diagnostic[];
      resolution: { cellSpan: number; cellArea: number; cellAreaKm2: number; cells?: number };
    }>({ kind: "generationSetup", worldId, input });
  }
  analyze(worldId: string, input: import("./spatialAnalysis").AnalysisInput) {
    return this.request<import("./spatialAnalysis").AnalysisResult>({
      kind: "analyze",
      worldId,
      input,
    });
  }
  executeCommand(input: WorkspaceCommand) {
    return this.request<WorkspaceCommandResult>({
      kind: "executeCommand",
      worldId: input.scope.worldId,
      input,
    });
  }
  // Catalog surface.
  createWorld(world: WorldMetadata) {
    return this.catalog(world.id, "createWorld", world);
  }
  readWorld(worldId: string) {
    return this.catalog(worldId, "readWorld", worldId);
  }
  readEditor(worldId: string) {
    return this.catalog(worldId, "readEditor", worldId);
  }
  readRegistry(input: RegistryRequest) {
    return this.catalog(input.worldId, "readRegistry", input);
  }
  readSettlement(scope: WorkspaceScope, featureId: string) {
    return this.catalog(scope.worldId, "readSettlement", scope, featureId);
  }
  readConnections(scope: WorkspaceScope) {
    return this.catalog(scope.worldId, "readConnections", scope);
  }
  readLayerPresentation(worldId: string, layerId: string) {
    return this.catalog(worldId, "readLayerPresentation", worldId, layerId);
  }
  readFeature(scope: WorkspaceScope, featureId: string) {
    return this.catalog(scope.worldId, "readFeature", scope, featureId);
  }
  readRecords(scope: WorkspaceScope, recordKind: ObjectKind, ids: string[]) {
    return this.catalog(scope.worldId, "readRecords", scope, recordKind, ids);
  }
  readFeatures(query: FeatureQuery) {
    return this.catalog(query.scope.worldId, "readFeatures", query);
  }
  readDisplay(query: FeatureQuery, tolerance: number) {
    return this.catalog(query.scope.worldId, "readDisplay", query, tolerance);
  }
  readAuthoring(input: ReadRequirements) {
    return this.catalog(input.scope.worldId, "readAuthoring", input);
  }
  readAuthoringPage(input: AuthoringFeatureQuery, after: string | null, limit: number) {
    return this.catalog(input.scope.worldId, "readAuthoringPage", input, after, limit);
  }
  readFieldGeography(scope: WorkspaceScope, resourceId: string) {
    return this.catalog(scope.worldId, "readFieldGeography", scope, resourceId);
  }
  readProduct<T>(worldId: string, family: string, stamp: string) {
    return this.catalog(worldId, "readProduct", worldId, family, stamp) as Promise<T | null>;
  }
  writeProduct(worldId: string, family: string, stamp: string, value: unknown) {
    return this.catalog(worldId, "writeProduct", worldId, family, stamp, value);
  }
  regionChoices(query: RegionQuery) {
    return this.catalog(query.scope.worldId, "regionChoices", query);
  }
  drawRegion(input: RegionDrawing) {
    return this.catalog(input.query.scope.worldId, "drawRegion", input);
  }
  readHistory(worldId: string, before: number | null, limit: number) {
    return this.catalog(worldId, "readHistory", worldId, before, limit);
  }
  readCauses(worldId: string, areaId: string) {
    return this.catalog(worldId, "readCauses", worldId, areaId);
  }
  undo(worldId: string, operationId: string) {
    return this.catalog(worldId, "undo", worldId, operationId);
  }
  commit(changes: CatalogChanges) {
    return this.catalog(changes.worldId, "commit", changes);
  }
  async beginPublication(input: CatalogPublication) {
    const token = await this.catalog(input.worldId, "beginPublication", input);
    this.publications.set(token, input.worldId);
    return token;
  }
  appendPublication(token: string, changes: CatalogChanges) {
    return this.catalog(changes.worldId, "appendPublication", token, changes);
  }
  async finishPublication(token: string) {
    try {
      return await this.catalog(this.publicationWorld(token), "finishPublication", token);
    } finally {
      this.publications.delete(token);
    }
  }
  async discardPublication(token: string) {
    const worldId = this.publications.get(token);
    if (!worldId) return;
    try {
      await this.catalog(worldId, "discardPublication", token);
    } finally {
      this.publications.delete(token);
    }
  }
  private publicationWorld(token: string) {
    const worldId = this.publications.get(token);
    if (!worldId) throw new Error("This publication is no longer active.");
    return worldId;
  }
  async close() {
    if (this.closed) return;
    try {
      if (!this.failed) await this.request<void>({ kind: "close" });
    } finally {
      this.closed = true;
      if ("terminate" in this.worker) this.worker.terminate();
      else this.worker.close();
      this.fail(new Error("Geographic workspace closed."));
    }
  }
}
