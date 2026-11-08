import { requireThat, type Diagnostic, type ParameterValues } from "@atlas/domain";
import { z } from "zod";
import {
  atlasParametersSchema,
  parameterSchema,
  type AtlasParameterDefinition,
  type AtlasParameters,
} from "./atlasParameters";
import type { ProcessSequence } from "./process";
import type { FeatureApplicability } from "./generationPresentation";
import type { CartographicControl } from "./cartographicControls";
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
  bind(
    configuration: ParameterValues,
    settings: GenerationSettings,
    parameters: AtlasParameters
  ): Partial<GenerationSettings>;
}

/** A creator capability owns its settings, operations and delivered products. */
export interface GenerationFeature {
  id: string;
  label: string;
  applicability?: FeatureApplicability;
  cartography?: readonly CartographicControl[];
  domains: string[];
  defaultEnabled: boolean;
  settings: Record<string, AtlasParameterDefinition>;
  parameterKeys?: (keyof AtlasParameters)[];
  configuration?: z.ZodType<ParameterValues>;
  configurationFromSettings?(settings: ParameterValues): ParameterValues;
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
  /** Histories this feature's processes keep, held as nothing having happened when it is off. */
  absent?: string[];
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

/** Bind feature selections to their current map settings. */
export function resolveGenerationFeatures(
  definitions: GenerationFeature[],
  selected: FeatureSelection = {},
  parameters: Partial<AtlasParameters> = {},
  domains: string[] = ["physical"],
  settings?: ParameterValues
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
  const effective = atlasParametersSchema.parse(parameters);
  const selection: ResolvedFeatures["selection"] = {};
  for (const definition of definitions) {
    const bound = resolveFeature(definition, draft[definition.id], effective, domains, settings);
    for (const key of definition.parameterKeys ?? []) effective[key] = bound.settings[key];
    selection[definition.id] = bound;
  }
  const diagnostics = dependencyDiagnostics(definitions, selection);
  return { selection, parameters: effective, diagnostics };
}
function resolveFeature(
  feature: GenerationFeature,
  draft: FeatureSelection[string] | undefined,
  effective: AtlasParameters,
  domains: string[],
  settings: ParameterValues | undefined
) {
  return {
    enabled:
      domains.some((domain) => feature.domains.includes(domain)) &&
      (draft?.enabled ?? feature.defaultEnabled),
    settings: resolveSettings(feature, draft?.settings ?? {}, effective),
    configuration: resolveConfiguration(feature, draft?.configuration, settings),
  };
}
function resolveConfiguration(
  feature: GenerationFeature,
  draft: ParameterValues | undefined,
  settings: ParameterValues | undefined
) {
  requireThat(
    !draft || feature.configuration,
    "feature_configuration",
    `${feature.id} has no nested configuration.`
  );
  if (!feature.configuration) return undefined;
  // Catalog/publication callers can inspect selection without binding a world.
  // Preparation always supplies the complete settings before execution.
  if (settings === undefined && draft === undefined) return undefined;
  const defaults = settings === undefined ? {} : feature.configurationFromSettings?.(settings);
  return feature.configuration.parse({ ...defaults, ...draft });
}
function resolveSettings(
  feature: GenerationFeature,
  draft: Record<string, number>,
  parameters: AtlasParameters
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
          (feature.parameterKeys?.includes(key as keyof AtlasParameters)
            ? parameters[key as keyof AtlasParameters]
            : undefined)
      ),
    ])
  );
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
