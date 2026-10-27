import type {
  SpatialStore,
  WorldMetadata,
  WorkspaceScope,
  ObjectKind,
  CatalogRecord,
  FeatureQuery,
  FeaturePage,
  CatalogChanges,
  WorkspaceChange,
  RegionQuery,
  RegionChoices,
  RegionDrawing,
  RegionDrawingResult,
  History,
  ReadRequirements,
  DomainSnapshot,
  FieldGeography,
  World,
  AtlasFeature,
  Bounds,
  EpochHistory,
  AuthoringPage,
  AuthoringFeatureQuery,
} from "@atlas/domain";
import type {
  WorkspaceOperation,
  WorkspaceReply,
  WorkspaceCommand,
  WorkspaceCommandResult,
} from "./workspaceProtocol";
import type { RasterGeography, RasterGeographyReference, ResourceRaster } from "./types";

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
  async open(name: string, roots?: { name: string; path: string }[] | null) {
    await this.request<void>({ kind: "open", name, roots });
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
  createWorld(world: WorldMetadata) {
    return this.request<void>({ kind: "createWorld", world });
  }
  importWorld(snapshot: DomainSnapshot) {
    return this.request<World>({ kind: "importWorld", snapshot });
  }
  openLegacyWorld(worldId: string, saved: import("./legacySave").LegacySavedWorld) {
    return this.request<World>({ kind: "openLegacyWorld", worldId, saved });
  }
  readEditor(worldId: string) {
    return this.request<World>({ kind: "readEditor", worldId });
  }
  readRegistry(input: import("@atlas/domain").RegistryRequest) {
    return this.request<import("@atlas/domain").RegistryPage>({ kind: "readRegistry", input });
  }
  readSettlement(scope: WorkspaceScope, featureId: string) {
    return this.request<import("@atlas/domain").SettlementInspection | null>({
      kind: "readSettlement",
      scope,
      featureId,
    });
  }
  readConnections(scope: WorkspaceScope) {
    return this.request<import("@atlas/domain").Connection[]>({ kind: "readConnections", scope });
  }
  readLayerPresentation(worldId: string, layerId: string) {
    return this.request<import("@atlas/domain").LayerPresentation>({
      kind: "readLayerPresentation",
      worldId,
      layerId,
    });
  }
  readFeature(scope: WorkspaceScope, featureId: string) {
    return this.request<AtlasFeature>({ kind: "readFeature", scope, featureId });
  }
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
      scope: reference.scope,
      reference,
    });
  }
  connect(port: MessagePort) {
    return this.request<void>({ kind: "connect", port });
  }
  generationSource(worldId: string, areaId: string) {
    return this.request<DomainSnapshot>({ kind: "generationSource", worldId, areaId });
  }
  generationSetup(worldId: string, input: import("@atlas/generation").AtlasGenerationInput) {
    return this.request<{
      input: import("@atlas/generation").AtlasGenerationInput;
      diagnostics: import("@atlas/domain").Diagnostic[];
      resolution: { cellSpan: number; cellArea: number; cellAreaKm2: number };
    }>({ kind: "generationSetup", worldId, input });
  }
  readWorld(worldId: string) {
    return this.request<WorldMetadata>({ kind: "readWorld", worldId });
  }
  readRecords(scope: WorkspaceScope, recordKind: ObjectKind, ids: string[]) {
    return this.request<CatalogRecord[]>({ kind: "readRecords", scope, recordKind, ids });
  }
  readFeatures(query: FeatureQuery) {
    return this.request<FeaturePage>({ kind: "readFeatures", query });
  }
  readDisplay(query: FeatureQuery, tolerance: number) {
    return this.request<FeaturePage>({ kind: "readDisplay", query, tolerance });
  }
  readAuthoring(input: ReadRequirements) {
    return this.request<DomainSnapshot>({ kind: "readAuthoring", input });
  }
  readAuthoringPage(input: AuthoringFeatureQuery, after: string | null, limit: number) {
    return this.request<AuthoringPage>({ kind: "readAuthoringPage", input, after, limit });
  }
  readFieldGeography(scope: WorkspaceScope, resourceId: string) {
    return this.request<FieldGeography>({ kind: "readFieldGeography", scope, resourceId });
  }
  regionChoices(query: RegionQuery) {
    return this.request<RegionChoices>({ kind: "regionChoices", query });
  }
  drawRegion(input: RegionDrawing) {
    return this.request<RegionDrawingResult>({ kind: "drawRegion", input });
  }
  readHistory(worldId: string, before: number | null, limit: number) {
    return this.request<History[]>({ kind: "readHistory", worldId, before, limit });
  }
  readCauses(worldId: string, areaId: string) {
    return this.request<EpochHistory[]>({ kind: "readCauses", worldId, areaId });
  }
  saveWorld(worldId: string) {
    return this.request<{ root: { name: string; path: string }; name: string; version: number }>({
      kind: "saveWorld",
      worldId,
    });
  }
  openSavedWorld(worldId: string, root: { name: string; path: string }) {
    return this.request<World>({ kind: "openSavedWorld", worldId, root });
  }
  analyze(worldId: string, input: import("./spatialAnalysis").AnalysisInput) {
    return this.request<import("./spatialAnalysis").AnalysisResult>({
      kind: "analyze",
      worldId,
      input,
    });
  }
  exportWorld(worldId: string, areaId?: string) {
    return this.request<File>({
      kind: "export",
      worldId,
      areaId,
    });
  }
  undo(worldId: string, operationId: string) {
    return this.request<WorkspaceChange>({ kind: "undo", worldId, operationId });
  }
  commit(changes: CatalogChanges) {
    return this.request<WorkspaceChange>({ kind: "commit", changes });
  }
  async beginPublication(input: import("@atlas/domain").CatalogPublication) {
    const token = await this.request<string>({
      kind: "beginPublication",
      worldId: input.worldId,
      input,
    });
    this.publications.set(token, input.worldId);
    return token;
  }
  appendPublication(token: string, changes: CatalogChanges) {
    return this.request<void>({
      kind: "appendPublication",
      worldId: changes.worldId,
      token,
      changes,
    });
  }
  async finishPublication(token: string) {
    try {
      return await this.request<WorkspaceChange>({
        kind: "finishPublication",
        worldId: this.publicationWorld(token),
        token,
      });
    } finally {
      this.publications.delete(token);
    }
  }
  async discardPublication(token: string) {
    const worldId = this.publications.get(token);
    if (!worldId) return;
    try {
      await this.request<void>({ kind: "discardPublication", worldId, token });
    } finally {
      this.publications.delete(token);
    }
  }
  private publicationWorld(token: string) {
    const worldId = this.publications.get(token);
    if (!worldId) throw new Error("This publication is no longer active.");
    return worldId;
  }
  executeCommand(input: WorkspaceCommand) {
    return this.request<WorkspaceCommandResult>({ kind: "executeCommand", input });
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
