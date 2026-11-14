import type { CompletedBoundary, GenerationDiagnostic, GenerationState } from "./process";

/** Transitional host value contract; the TypeScript runner is archived. */
export interface MapRunnerOptions {
  seed: string;
  seedScope: string;
  cancelled?(): boolean;
  progress?(path: string[], fraction: number, message: string): void;
  diagnostic?(diagnostic: GenerationDiagnostic): void;
  /**
   * Observation of the state after each completed process, while its working arrays are
   * still open: a monitoring harness reads what the process produced. Must not mutate.
   */
  inspect?(path: string[], process: string, state: GenerationState): void;
  /**
   * Worker-owned block cache for every coverage of the run (physical, surface, society);
   * resident when absent. Never serialized into a boundary or save.
   */
  cache?: import("@atlas/domain").BlockCache;
  features?: import("@atlas/domain").FeatureWorkspace;
  sourceFeatures?: import("@atlas/domain").FeatureReader;
  networks?: import("@atlas/domain").NetworkWorkspace;
  sourceNetworks?: import("@atlas/domain").NetworkReader;
  contours?: import("@atlas/domain").ContourWorkspace;
  /** Adapter scheduling between processes. */
  yieldControl?(): Promise<void>;
  // Optional completed-epoch/final observation. Serialize before resolving:
  // numerical workspace is shared and the following epoch mutates it.
  saveBoundary?(boundary: CompletedBoundary): Promise<void>;
  /**
   * A monitoring harness's observation of each completed epoch and the final state, before
   * `saveBoundary`. It may copy what it needs to continue the run later; it must not mutate.
   */
  boundary?(boundary: CompletedBoundary): void | Promise<void>;
  /**
   * Continue a run from the saved state of a completed epoch instead of making its history
   * again. Stages up to that epoch's end are not executed, except initializers, which build
   * the working state the restore then fills. Every later stage runs as usual.
   */
  resume?: {
    /** The ids of the completed epoch's ancestry, outermost first. */
    after: string[];
    restore(state: GenerationState): void | Promise<void>;
  };
}
