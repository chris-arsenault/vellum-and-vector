import type { Diagnostic, ParameterValues } from "@atlas/domain";
import type { AtlasParameterDefinition } from "./atlasParameters";
import type { ProductRequirement } from "./productLedger";
import type { PublicationDefinition } from "./publication";
import type { ProcessBehavior } from "./processTraits";

export type GenerationSetupStage = "world" | "land" | "environment" | "magic" | "people";
export type EpochValueKey =
  | "tectonics"
  | "hydrology"
  | "ice"
  | "coasts"
  | "impacts"
  | "volcanism"
  | "temperature"
  | "rainfall"
  | "seaLevel";
export interface EpochControl {
  key: EpochValueKey;
  label: string;
  unit: string;
  min?: number;
  max?: number;
}
export interface ConfigurationPresentation {
  applicability: "initial" | "any";
  epochs?: {
    path: string;
    shape: "clock" | "record";
    extension?: "ecology" | "magicActivity";
  };
}
/** Describes controls; process composition and preflight retain execution authority. */
export interface FeaturePresentation {
  stage: GenerationSetupStage;
  family: string;
  summary: string;
  order: number;
  settingConsumers?: Record<string, readonly string[]>;
  epochControls?: EpochControl[];
  initialOnlySettings?: readonly string[];
  inheritedElapsed?: "preserve-age";
  requiresLocatedSources?: boolean;
  publicationProfiles?: Record<string, readonly string[]>;
}
export interface SetupSetting {
  owner: string;
  controlFeature: string;
  key: string;
  definition: AtlasParameterDefinition;
  value: number;
  active: boolean;
  reason: string | null;
  consumers: string[];
}
export interface SetupInvocation {
  key: string;
  id: string;
  path: string[];
  process: string;
  version: string;
  feature: string | null;
  epochs: { id: string; duration: number }[];
  behavior: ProcessBehavior["kind"];
  durationYears: number | null;
  boundDurationYears: number | null;
  durationNote: string | null;
  parameters: ParameterValues;
  inputs: ProductRequirement[];
  outputs: string[];
  invalidates: string[];
  conditional: boolean;
  reconciliation: boolean;
  scheduled: boolean;
  reconciliationContract?: { invalidates: string[]; guarantees: string[] };
}
export interface SetupFeature {
  id: string;
  label: string;
  presentation: FeaturePresentation;
  enabled: boolean;
  status: "active" | "off" | "inherited" | "unavailable";
  reason: string | null;
  settings: SetupSetting[];
  configuration?: ParameterValues;
  configurationPresentation?: ConfigurationPresentation;
  configurationEditable: boolean;
  requires: string[];
  requiredBy: string[];
  invocations: SetupInvocation[];
  publications: PublicationDefinition[];
  diagnostics: Diagnostic[];
}
export interface GenerationSetup {
  context: { profile: string; inherited: boolean; channels: string[]; locatedSources: number };
  features: SetupFeature[];
  invocations: SetupInvocation[];
  sharedInvocations: SetupInvocation[];
  publications: PublicationDefinition[];
  diagnostics: Diagnostic[];
}
