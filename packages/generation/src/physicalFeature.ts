import type { ParameterValues } from "@atlas/domain";
import { atlasParameterDefinitions, type AtlasParameters } from "./atlasParameters";
import type { GenerationFeature, FeatureContributionContext } from "./features";
import type { ProcessInvocation } from "./process";
import { physicalApplicability } from "./physicalApplicability";
import { physicalCartography } from "./physicalCartography";
import type { GenerationSlot } from "./generationSlots";
import { physicalProfileConfiguration } from "./physicalProfileConfiguration";
import type { NativeStep } from "./world/sequence";

type Operation = NativeStep | readonly [NativeStep, ParameterValues] | string;
type Operations = Partial<Record<GenerationSlot, readonly Operation[]>>;
export interface PhysicalFeature extends GenerationFeature {
  readonly nativeSteps?: readonly NativeStep[];
}
/** Non-native atlas operations already have their own MapProcess registration. */
function operation(entry: Operation): {
  step?: NativeStep;
  name: string;
  parameters: ParameterValues;
} {
  if (typeof entry === "string") return { name: entry, parameters: {} };
  if (typeof entry[0] === "string")
    return { step: entry as NativeStep, name: entry[0], parameters: {} };
  const [step, parameters] = entry as readonly [NativeStep, ParameterValues];
  return { step, name: step[0], parameters };
}
export const nativeStepsOf = (features: readonly PhysicalFeature[]): NativeStep[] => [
  ...new Set(features.flatMap((feature) => feature.nativeSteps ?? [])),
];
type FeatureOptions = {
  settings?: (keyof AtlasParameters)[];
  requires?: string[];
  absent?: string[];
  inherited?: boolean;
  configuration?: Partial<GenerationFeature>;
  when?(slot: string, context?: FeatureContributionContext): boolean;
};

export function physicalFeature(
  id: string,
  label: string,
  operations: Operations,
  options: FeatureOptions = {}
): PhysicalFeature {
  const entries = Object.values(operations).flat().map(operation),
    processes = entries.map(({ name }) => `atlas.${name}`);
  return {
    id,
    label,
    nativeSteps: [...new Set(entries.flatMap(({ step }) => (step ? [step] : [])))],
    applicability: physicalApplicability[id],
    cartography: [physicalCartography[id] ?? []].flat(),
    domains: options.inherited ? ["physical", "magic"] : ["physical"],
    defaultEnabled: true,
    settings: Object.fromEntries(
      (options.settings ?? []).map((key) => [key, atlasParameterDefinitions[key]])
    ),
    legacyParameters: options.settings ?? [],
    processes: [...new Set(processes)],
    slots: Object.keys(operations) as GenerationSlot[],
    requires: options.requires ?? [],
    absent: options.absent ?? [],
    contribute(slot, _configuration, context) {
      if (options.when && !options.when(slot, context)) return [];
      return (operations[slot as GenerationSlot] ?? []).map((entry): ProcessInvocation => {
        const { name, parameters } = operation(entry);
        return {
          kind: "process",
          id: name,
          process: `atlas.${name}`,
          version: "1",
          parameters,
        };
      });
    },
    ...(options.configuration ?? physicalProfileConfiguration(id)),
  };
}
