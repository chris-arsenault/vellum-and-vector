import type { AtlasGenerationInput } from "@atlas/generation";
import type { Diagnostic, GridArrays, WorkspaceChange } from "@atlas/domain";

export interface GenerationWorkspaceStart {
  worldId: string;
  input: AtlasGenerationInput;
  expectedVersion: number;
  operationId: string;
  port: MessagePort;
}
export type GenerationWorkspaceMessage =
  | { kind: "progress"; path: string[]; fraction: number; message: string }
  | { kind: "diagnostic"; diagnostic: Diagnostic }
  | { kind: "preview"; grid: GridArrays; label: string }
  | { kind: "published"; revision: number; partial: boolean; change?: WorkspaceChange }
  | { kind: "completed" }
  | { kind: "cancelled" }
  | { kind: "failed"; error: string; diagnostics?: Diagnostic[] };
