import type { ParameterValues } from "@atlas/domain";
import { requireThat } from "@atlas/domain";
import type { MapProcessContext, ProcessReconciliation } from "./process";
import type { AtlasParameters } from "./atlasParameters";
import type { GenerationSettings } from "./generationSettings";
import type { ResolvedFeatures } from "./features";
import type { PublicationDefinition } from "./publication";

/** Plain data crosses the worker boundary; operation implementations stay local. */
export interface GenerationBindings {
  seed: number;
  quality: string;
  domains: string[];
  parameters: AtlasParameters;
  settings: GenerationSettings;
  features: ResolvedFeatures;
  publications?: PublicationDefinition[];
  reconciliations?: Record<string, ProcessReconciliation>;
}
export function generationBindings(context: MapProcessContext): GenerationBindings {
  requireThat(
    context.inputs?.settings && context.inputs?.features,
    "generation_binding",
    "Resolve feature settings before executing atlas generation."
  );
  return context.inputs as unknown as GenerationBindings;
}
export function serializableBindings(bindings: GenerationBindings): ParameterValues {
  return JSON.parse(JSON.stringify(bindings)) as ParameterValues;
}
