import type { MapRef, ReadOptions, MapAsset } from "@atlas/map";
import type { GenerationStatus, RefinementRequest } from "./generated";

export interface GenerationConfiguration<Configuration> {
  id: string;
  title: string;
  values: Configuration;
}
export type RefinementSubmission<Configuration> = RefinementRequest<Configuration>;
export type GenerationAction<Configuration> =
  | { method: "create"; request: Configuration }
  | { method: "refine"; request: RefinementSubmission<Configuration> }
  | { method: "regenerate"; request: { reference: MapRef; configuration: Configuration } };
export type GenerationEvent =
  | { kind: "published"; reference: MapRef }
  | { kind: "status"; status: GenerationStatus }
  | { kind: "preview"; jobId: string; epoch: number; map: MapAsset };

/** Jobs resolve private inputs on their own host; callers submit public map selections. */
export interface GenerationService<Configuration> {
  jobs(options?: ReadOptions): Promise<GenerationStatus[]>;
  configurations(options?: ReadOptions): Promise<GenerationConfiguration<Configuration>[]>;
  presentation(options?: ReadOptions): Promise<unknown[]>;
  configuration(reference: MapRef, options?: ReadOptions): Promise<Configuration>;
  review(action: GenerationAction<Configuration>, options?: ReadOptions): Promise<unknown>;
  choose(
    configuration: Configuration,
    control: string,
    choice: string,
    options?: ReadOptions
  ): Promise<Configuration>;
  validate(configuration: Configuration, options?: ReadOptions): Promise<Configuration>;
  create(configuration: Configuration, options?: ReadOptions): Promise<GenerationStatus>;
  refine(
    request: RefinementSubmission<Configuration>,
    options?: ReadOptions
  ): Promise<GenerationStatus>;
  regenerate(
    reference: MapRef,
    configuration: Configuration,
    options?: ReadOptions
  ): Promise<GenerationStatus>;
  status(jobId: string, options?: ReadOptions): Promise<GenerationStatus>;
  observe(jobId: string, options?: ReadOptions): AsyncIterable<GenerationEvent>;
  cancel(jobId: string, options?: ReadOptions): Promise<GenerationStatus>;
  resume(jobId: string, options?: ReadOptions): Promise<GenerationStatus>;
}
