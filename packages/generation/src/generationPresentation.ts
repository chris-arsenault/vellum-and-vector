import type { ParameterValues } from "@atlas/domain";
import type { AtlasParameterDefinition } from "./atlasParameters";
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
export interface FeatureApplicability {
  settingConsumers?: Record<string, readonly string[]>;
  epochControls?: EpochControl[];
  initialOnlySettings?: readonly string[];
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
}
export interface SetupFeature {
  id: string;
  label: string;
  epochControls: EpochControl[];
  enabled: boolean;
  status: "active" | "off" | "inherited" | "unavailable";
  reason: string | null;
  settings: SetupSetting[];
  configuration?: ParameterValues;
  configurationPresentation?: ConfigurationPresentation;
  configurationEditable: boolean;
  invocationIds: string[];
}
export interface GenerationSetup {
  context: { inherited: boolean; locatedSources: number };
  features: SetupFeature[];
}
