import type { Epoch, GenerationEpoch, ParameterValues } from "@atlas/domain";
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
/** An era's loop index is not a physical epoch; ancestry declares that binding explicitly. */
export function physicalEpochIndex(
  epochs: readonly Pick<Epoch, "id">[],
  ancestry: readonly Pick<GenerationEpoch, "parentEpoch">[]
) {
  const parent = ancestry.find((epoch) => epoch.parentEpoch !== null)?.parentEpoch;
  if (parent === undefined) return epochs.length - 1;
  const index = epochs.findIndex((epoch) => epoch.id === parent);
  requireThat(index >= 0, "physical_epoch", "The era's physical epoch must be in its history.");
  return index;
}
export function serializableBindings(bindings: GenerationBindings): ParameterValues {
  return JSON.parse(JSON.stringify(bindings)) as ParameterValues;
}
