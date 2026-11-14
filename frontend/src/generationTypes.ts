/** Creator/view contracts supplied by Rust. No process implementation enters the UI. */
import type { Epoch, MagicSystem, MagicConfluence, HumanEra } from "@atlas/context";
import type { JsonValue } from "@atlas/map";
export type ParameterValues = Record<string, JsonValue>;
export interface GenerationSettings {
  epochs: Epoch[];
  humanEras: HumanEra[];
  magicSystems: MagicSystem[];
  confluences: MagicConfluence[];
}
export type FeatureSelection = Record<
  string,
  { enabled?: boolean; settings?: Record<string, number>; configuration?: ParameterValues }
>;
export interface GenerationRecipe {
  schemaVersion: 3;
  seed: number;
  quality: "draft" | "standard" | "fine";
  domains: ("physical" | "magic" | "cultural" | "political" | "built")[];
  parameters: Record<string, number>;
  features?: FeatureSelection;
  settings: GenerationSettings;
}
export type AtlasGenerationInput = Omit<GenerationRecipe, "schemaVersion"> & { areaId: string };
export type EpochValueKey =
  | "tectonicDurationMyr"
  | "plateTravel"
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
  epochs?: { path: string; shape: "clock" | "record"; extension?: "ecology" | "magicActivity" };
}
export interface FeatureApplicability {
  settingConsumers?: Record<string, readonly string[]>;
  epochControls?: EpochControl[];
  initialOnlySettings?: readonly string[];
  requiresLocatedSources?: boolean;
  publicationProfiles?: Record<string, readonly string[]>;
}
export interface AtlasParameterDefinition {
  label: string;
  unit: string;
  minimum?: number;
  maximum?: number;
  default: number;
  step: number;
  integer?: boolean;
  exclusiveMinimum?: boolean;
  choices?: readonly { value: number; label: string; disabled?: boolean }[];
  group: "geology" | "climate" | "water" | "ecology" | "human";
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
  context: { inherited: boolean; locatedSources: number; landmarks: number };
  features: SetupFeature[];
}
export interface CartographicChoice {
  id: string;
  label: string;
  features: FeatureSelection;
  initialOnly?: boolean;
}
export interface CartographicControl {
  id: string;
  label: string;
  section: "land" | "environment" | "people";
  explanation: string;
  initialOnly?: boolean;
  choices: readonly CartographicChoice[];
  system?: string;
  defaultChoice?: string;
  fields?: readonly string[];
}
export interface GenerationFeature {
  id: string;
  label: string;
  applicability?: FeatureApplicability;
  cartography?: readonly CartographicControl[];
  domains: string[];
  settings: Record<string, AtlasParameterDefinition>;
  configurationPresentation?: ConfigurationPresentation;
  processes: string[];
}
