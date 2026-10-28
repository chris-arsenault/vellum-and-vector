import type {
  CatalogChanges,
  FeatureQuery,
  ObjectKind,
  WorkspaceScope,
  WorldMetadata,
  RegionQuery,
  RegionDrawing,
  ReadRequirements,
  Command,
  Template,
  Impact,
  WorkspaceChange,
  DomainWrite,
  DomainSnapshot,
  Bounds,
  AuthoringFeatureQuery,
} from "@atlas/domain";
export interface WorkspaceCommand {
  scope: WorkspaceScope;
  command: Command;
  template?: Template;
  preview: boolean;
}
export interface WorkspaceCommandResult {
  change: WorkspaceChange | null;
  impact: Impact;
  preview: DomainWrite[];
}

export type WorkspaceOperation =
  | { kind: "open"; name: string }
  | { kind: "connect"; port: MessagePort }
  | { kind: "createWorld"; world: WorldMetadata }
  | { kind: "importWorld"; snapshot: DomainSnapshot }
  | { kind: "openLegacyWorld"; worldId: string; saved: import("./legacySave").LegacySavedWorld }
  | { kind: "readEditor"; worldId: string }
  | { kind: "readRegistry"; input: import("@atlas/domain").RegistryRequest }
  | { kind: "readSettlement"; scope: WorkspaceScope; featureId: string }
  | { kind: "readConnections"; scope: WorkspaceScope }
  | { kind: "readLayerPresentation"; worldId: string; layerId: string }
  | { kind: "readFeature"; scope: WorkspaceScope; featureId: string }
  | { kind: "readRasters"; worldId: string; areaId: string; extent: Bounds; tolerance: number }
  | {
      kind: "readRasterGeography";
      scope: WorkspaceScope;
      reference: import("./types").RasterGeographyReference;
    }
  | { kind: "generationSource"; worldId: string; areaId: string }
  | {
      kind: "generationSetup";
      worldId: string;
      input: import("@atlas/generation").AtlasGenerationInput;
    }
  | { kind: "readWorld"; worldId: string }
  | { kind: "readRecords"; scope: WorkspaceScope; recordKind: ObjectKind; ids: string[] }
  | { kind: "readFeatures"; query: FeatureQuery }
  | { kind: "readDisplay"; query: FeatureQuery; tolerance: number }
  | { kind: "readAuthoring"; input: ReadRequirements }
  | { kind: "readAuthoringPage"; input: AuthoringFeatureQuery; after: string | null; limit: number }
  | { kind: "readFieldGeography"; scope: WorkspaceScope; resourceId: string }
  | { kind: "regionChoices"; query: RegionQuery }
  | { kind: "drawRegion"; input: RegionDrawing }
  | { kind: "readHistory"; worldId: string; before: number | null; limit: number }
  | { kind: "readCauses"; worldId: string; areaId: string }
  | { kind: "saveWorld"; worldId: string }
  | { kind: "openSavedWorld"; worldId: string; root: { name: string; path: string } }
  | { kind: "analyze"; worldId: string; input: import("./spatialAnalysis").AnalysisInput }
  | { kind: "export"; worldId: string; areaId?: string }
  | { kind: "undo"; worldId: string; operationId: string }
  | { kind: "commit"; changes: CatalogChanges }
  | { kind: "beginPublication"; worldId: string; input: import("@atlas/domain").CatalogPublication }
  | { kind: "appendPublication"; worldId: string; token: string; changes: CatalogChanges }
  | { kind: "finishPublication"; worldId: string; token: string }
  | { kind: "discardPublication"; worldId: string; token: string }
  | { kind: "executeCommand"; input: WorkspaceCommand }
  | { kind: "close" };
export interface WorkspaceRequest {
  id: number;
  operation: WorkspaceOperation;
}
export type WorkspaceReply = { id: number; value: unknown } | { id: number; error: string };
