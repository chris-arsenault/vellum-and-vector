import type { Profile, RevisionReference, SpatialScope } from "@atlas/domain";
import type { ProcessConfiguration } from "./process";

/** Reproducible inputs. Working arrays and process continuations are not job records. */
export interface GenerationJob {
  id: string;
  operationId: string;
  scope: SpatialScope;
  profile: { id: Profile; variant: string };
  configuration: ProcessConfiguration;
  seed: string;
  seedScope: string;
  reads: RevisionReference[];
  outputLayers: string[];
}
export type RunStatus =
  | "queued"
  | "running"
  | "paused"
  | "cancelling"
  | "cancelled"
  | "failed"
  | "conflicted"
  | "completed";
export interface RunRecord {
  id: string;
  worldId: string;
  operationId: string;
  status: RunStatus;
  stage: string;
  progress: number;
  cancelRequested: boolean;
  attempt: number;
  error: { code: string; message: string } | null;
  createdAt: string;
  updatedAt: string;
}
