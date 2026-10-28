import type {
  WorkspaceScope,
  WorldMetadata,
  Command,
  Template,
  Impact,
  WorkspaceChange,
  DomainWrite,
  DomainSnapshot,
  Bounds,
} from "@atlas/domain";
import type { SpatialCatalog } from "@atlas/storage-browser";

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
/** Catalog reads and writes cross the worker boundary as a typed method call. This is the
 * surface a hosted adapter would implement; everything else below is session plumbing. */
export type CatalogMethod =
  | "createWorld"
  | "readWorld"
  | "readRecords"
  | "readFeatures"
  | "readDisplay"
  | "readAuthoring"
  | "readAuthoringPage"
  | "readEditor"
  | "readRegistry"
  | "readSettlement"
  | "readConnections"
  | "readLayerPresentation"
  | "readFeature"
  | "readFieldGeography"
  | "regionChoices"
  | "drawRegion"
  | "readHistory"
  | "readCauses"
  | "undo"
  | "commit"
  | "beginPublication"
  | "appendPublication"
  | "finishPublication"
  | "discardPublication"
  | "abandonPublication";
export type CatalogCall<M extends CatalogMethod = CatalogMethod> = {
  kind: "catalog";
  worldId: string;
  method: M;
  args: Parameters<SpatialCatalog[M]>;
};
export type CatalogResult<M extends CatalogMethod> = Awaited<ReturnType<SpatialCatalog[M]>>;

export type WorkspaceOperation =
  | { kind: "open"; name: string }
  | { kind: "connect"; port: MessagePort }
  | { kind: "close" }
  | CatalogCall
  | { kind: "importWorld"; worldId: string; snapshot: DomainSnapshot }
  | { kind: "openLegacyWorld"; worldId: string; saved: import("./legacySave").LegacySavedWorld }
  | { kind: "openSavedWorld"; worldId: string; root: { name: string; path: string } }
  | { kind: "saveWorld"; worldId: string }
  | { kind: "export"; worldId: string; areaId?: string }
  | { kind: "readRasters"; worldId: string; areaId: string; extent: Bounds; tolerance: number }
  | {
      kind: "readRasterGeography";
      worldId: string;
      reference: import("./types").RasterGeographyReference;
    }
  | { kind: "generationSource"; worldId: string; areaId: string }
  | {
      kind: "generationSetup";
      worldId: string;
      input: import("@atlas/generation").AtlasGenerationInput;
    }
  | { kind: "analyze"; worldId: string; input: import("./spatialAnalysis").AnalysisInput }
  | { kind: "executeCommand"; worldId: string; input: WorkspaceCommand }
  | { kind: "abandonOperation"; worldId: string; operationId: string };
export type WorldOperation = Exclude<
  WorkspaceOperation,
  { kind: "open" } | { kind: "connect" } | { kind: "close" }
>;
export interface WorkspaceRequest {
  id: number;
  operation: WorkspaceOperation;
}
export type WorkspaceReply = { id: number; value: unknown } | { id: number; error: string };
export type { WorldMetadata };
