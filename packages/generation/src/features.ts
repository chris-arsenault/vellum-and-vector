import { requireThat, type Diagnostic, type ParameterValues } from "@atlas/domain";
import { z } from "zod";
import {
  atlasParametersSchema,
  parameterSchema,
  type AtlasParameterDefinition,
  type AtlasParameters,
} from "./atlasParameters";
import type { ProcessSequence } from "./process";
import type { FeaturePresentation } from "./generationPresentation";
import type { ConfigurationPresentation } from "./generationPresentation";
import type { GenerationSettings } from "./generationSettings";
import type { AtlasGenerationInput } from "./atlasWorkflow";
import type { DomainSnapshot } from "@atlas/domain";
import type { GenerationSlot } from "./generationSlots";

export interface FeatureRequirement {
  feature: string;
  field?: Diagnostic["field"];
  message?: string;
}
export interface FeatureContributionContext {
  source: DomainSnapshot;
  input: AtlasGenerationInput;
  resolved: ResolvedFeatures;
  initial?: boolean;
  iceLoad?: boolean;
  material?: boolean;
  process?: string;
}
export interface FeatureConfigurationBinding {
  fields: (keyof GenerationSettings)[];
  epochFields?: (keyof GenerationSettings["epochs"][number])[];
  prepare?(
    configuration: ParameterValues,
    settings: GenerationSettings
  ): Partial<GenerationSettings>;
  bind(configuration: ParameterValues, settings: GenerationSettings): Partial<GenerationSettings>;
}

/** A creator capability owns its settings, operations and delivered products. */
export interface GenerationFeature {
  id: string;
  label: string;
  presentation?: FeaturePresentation;
  domains: string[];
  defaultEnabled: boolean;
  settings: Record<string, AtlasParameterDefinition>;
  legacyParameters?: (keyof AtlasParameters)[];
  configuration?: z.ZodType<ParameterValues>;
  configurationFromLegacy?(settings: ParameterValues): ParameterValues;
  configurationBinding?: FeatureConfigurationBinding;
  configurationPresentation?: ConfigurationPresentation;
  processes: string[];
  requires?: string[];
  conditionalRequires?(
    configuration: ParameterValues | undefined,
    context: FeatureContributionContext
  ): FeatureRequirement[];
  diagnostics?(
    configuration: ParameterValues | undefined,
    context: FeatureContributionContext
  ): Diagnostic[];
  absent?: { product: string; initializer: string }[];
  slots: readonly GenerationSlot[];
  contribute(
    slot: string,
    configuration?: ParameterValues,
    context?: FeatureContributionContext
  ): ProcessSequence;
}
export type FeatureSelection = Record<
  string,
  { enabled?: boolean; settings?: Record<string, number>; configuration?: ParameterValues }
>;
export interface ResolvedFeatures {
  selection: Record<
    string,
    { enabled: boolean; settings: Record<string, number>; configuration?: ParameterValues }
  >;
  parameters: AtlasParameters;
  diagnostics: Diagnostic[];
}
export const featureSelectionSchema = z.record(
  z.string(),
  z
    .object({
      enabled: z.boolean().optional(),
      settings: z.record(z.string(), z.number()).optional(),
      configuration: z.record(z.string(), z.json()).optional(),
    })
    .strict()
);

/** Legacy process names are translated once; no executor consults them. */
export function resolveGenerationFeatures(
  definitions: GenerationFeature[],
  selected: FeatureSelection = {},
  legacy: Record<string, boolean> = {},
  parameters: Partial<AtlasParameters> = {},
  domains: string[] = ["physical"],
  legacySettings?: ParameterValues
): ResolvedFeatures {
  const draft = featureSelectionSchema.parse(selected);
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  requireThat(
    byId.size === definitions.length,
    "feature_identity",
    "Register each generation feature once."
  );
  for (const id of Object.keys(draft))
    requireThat(byId.has(id), "unknown_feature", `Unknown generation feature ${id}.`);
  const translated = translateLegacy(definitions, legacy);
  const effective = atlasParametersSchema.parse(parameters);
  const selection: ResolvedFeatures["selection"] = {};
  for (const definition of definitions) {
    const bound = resolveFeature(
      definition,
      draft[definition.id],
      translated,
      effective,
      domains,
      legacySettings
    );
    for (const key of definition.legacyParameters ?? []) effective[key] = bound.settings[key];
    selection[definition.id] = bound;
  }
  const diagnostics = dependencyDiagnostics(definitions, selection);
  return { selection, parameters: effective, diagnostics };
}
function resolveFeature(
  feature: GenerationFeature,
  draft: FeatureSelection[string] | undefined,
  translated: Record<string, boolean>,
  effective: AtlasParameters,
  domains: string[],
  legacy: ParameterValues | undefined
) {
  return {
    enabled:
      domains.some((domain) => feature.domains.includes(domain)) &&
      (draft?.enabled ?? translated[feature.id] ?? feature.defaultEnabled),
    settings: resolveSettings(feature, draft?.settings ?? {}, effective),
    configuration: resolveConfiguration(feature, draft?.configuration, legacy),
  };
}
function resolveConfiguration(
  feature: GenerationFeature,
  draft: ParameterValues | undefined,
  legacy: ParameterValues | undefined
) {
  requireThat(
    !draft || feature.configuration,
    "feature_configuration",
    `${feature.id} has no nested configuration.`
  );
  if (!feature.configuration) return undefined;
  // Catalog/publication callers can inspect selection without binding a world.
  // Preparation always supplies the complete settings before execution.
  if (legacy === undefined && draft === undefined) return undefined;
  const defaults = legacy === undefined ? {} : feature.configurationFromLegacy?.(legacy);
  return feature.configuration.parse({ ...defaults, ...draft });
}
function resolveSettings(
  feature: GenerationFeature,
  draft: Record<string, number>,
  legacy: AtlasParameters
) {
  for (const key of Object.keys(draft))
    requireThat(
      Object.hasOwn(feature.settings, key),
      "feature_setting",
      `${feature.id} does not own ${key}.`
    );
  return Object.fromEntries(
    Object.entries(feature.settings).map(([key, definition]) => [
      key,
      parameterSchema(definition).parse(
        draft[key] ??
          (feature.legacyParameters?.includes(key as keyof AtlasParameters)
            ? legacy[key as keyof AtlasParameters]
            : undefined)
      ),
    ])
  );
}
function translateLegacy(definitions: GenerationFeature[], legacy: Record<string, boolean>) {
  const result: Record<string, boolean> = {};
  for (const [process, enabled] of Object.entries(legacy)) {
    const owner = definitions.find((definition) => definition.processes.includes(process));
    requireThat(
      owner,
      "unknown_process",
      `Process ${process} has no selectable feature; use feature settings.`
    );
    requireThat(
      result[owner.id] === undefined || result[owner.id] === enabled,
      "coupled_processes",
      `${owner.label} is one feature. Its operations must be selected together.`
    );
    result[owner.id] = enabled;
  }
  return result;
}
function dependencyDiagnostics(
  definitions: GenerationFeature[],
  selection: ResolvedFeatures["selection"]
) {
  const errors: Diagnostic[] = [];
  for (const definition of definitions) {
    if (!selection[definition.id].enabled) continue;
    for (const required of definition.requires ?? []) {
      if (selection[required]?.enabled) continue;
      errors.push({
        severity: "error",
        code: "feature_dependency",
        invocation: definition.id,
        resource: required,
        message: `${definition.label} requires ${required}. Enable it or disable ${definition.id}.`,
      });
    }
  }
  return errors;
}

export function featureEnabled(features: ResolvedFeatures, id: string) {
  requireThat(features.selection[id], "unknown_feature", `Bind generation feature ${id}.`);
  return features.selection[id].enabled;
}
export function featureContribution(
  feature: GenerationFeature,
  slot: string,
  resolved: ResolvedFeatures,
  context?: FeatureContributionContext
): ProcessSequence {
  if (!featureEnabled(resolved, feature.id) || !feature.slots.includes(slot as GenerationSlot))
    return [];
  const bind = (sequence: ProcessSequence): ProcessSequence =>
    sequence.map((node) => {
      if (node.kind === "epochs")
        return { ...node, id: `${feature.id}/${slot}/${node.id}`, body: bind(node.body) };
      requireThat(
        feature.processes.includes(node.process),
        "feature_process",
        `${feature.id} cannot contribute unowned process ${node.process}.`
      );
      return { ...node, id: `${feature.id}/${slot}/${node.id}`, feature: feature.id };
    });
  return bind(feature.contribute(slot, resolved.selection[feature.id].configuration, context));
}
