// Canonry PhysicalGeographyGenerationContext.cs, commit 0f62584c.
import type { PhysicalProfile } from "./profile";
import type { GenerationState, MapProcessContext } from "../process";
import { atlasEpoch } from "./atlasProfile";
import { round } from "./math";
import { ecologyEpochSchema, type Epoch } from "@atlas/domain";
import { generationBindings } from "../generationBindings";
import type { ProductLedger } from "../productLedger";
import { tectonicDefaultMyr, tectonicReferenceMyr } from "./tectonicControls";
import type { PhysicalField } from "./field";
export interface ProcessObservation {
  readonly processes: readonly string[];
  readonly phase: "before" | "after-run" | "settled";
  readonly substep: number;
}
export interface PhysicalEpoch {
  TectonicDurationMyr?: number;
  StableName: string;
  TectonicStrength: number;
  HydrologyStrength: number;
  GlaciationStrength: number;
  CoastalStrength: number;
  TemperatureOffset: number;
  SeaLevelOffset: number;
}
export interface PhysicalContext {
  TectonicDurationMyr: number;
  /** How much work this pass stands for: processes state their rates per unit of it. */
  Span: number;
  Products?: Pick<ProductLedger, "status">;
  /** What else rides the crust and moves whenever the plates do. */
  AfterPlateStep?: () => void;
  /** Optional live inspection; simultaneous effects are observed after their joint settlement. */
  ObserveProcess?: (
    event: ProcessObservation,
    field: PhysicalField,
    context: PhysicalContext
  ) => void;
  /** Whether what ice weighs is counted in what the crust floats under. */
  IceLoad?: boolean;
  RainfallMultiplier: number;
  Seed: number;
  EpochStableSeed: number;
  EpochIndex: number;
  EpochCount: number;
  Profile: PhysicalProfile;
  TectonicStrength: number;
  HydrologyStrength: number;
  GlaciationStrength: number;
  CoastalStrength: number;
  TemperatureOffset: number;
  SeaLevelOffset: number;
}
const neutral = {
  TectonicStrength: 1000,
  HydrologyStrength: 1000,
  GlaciationStrength: 1000,
  CoastalStrength: 1000,
  TemperatureOffset: 0,
  SeaLevelOffset: 0,
};
export function nativeContext(state: GenerationState, context: MapProcessContext, salt: number) {
  const { settings, seed } = generationBindings(context);
  const index = context.epochIndices[0],
    epoch = index === undefined ? null : atlasEpoch(settings.epochs[index]);
  const nativeIndex = index ?? (state.physical!.map.CrustSupportInitialized ? -1 : 0);
  const definition = index === undefined ? undefined : settings.epochs[index];
  const profile = epochProfile(state.physical!.profile, definition);
  const physical = physicalContext(seed, salt, profile, epoch, nativeIndex, settings.epochs.length);
  physical.RainfallMultiplier = ecologyEpochSchema.parse(
    (definition ?? settings.epochs.at(-1))?.ecology ?? {}
  ).rainfall;
  physical.Products = context.products;
  return physical;
}
function epochProfile(base: PhysicalProfile, definition: Epoch | undefined) {
  const profile = { ...base };
  profile.ImpactCraterCount = round(profile.ImpactCraterCount * (definition?.impacts ?? 1));
  for (const key of ["VolcanicConeHeight", "VolcanicApronHeight", "VolcanicCalderaDepth"] as const)
    profile[key] *= definition?.volcanism ?? 1;
  return profile;
}
export function physicalContext(
  seed: number,
  salt: number,
  Profile: PhysicalProfile,
  epoch: PhysicalEpoch | null = null,
  EpochIndex = -1,
  EpochCount = 0
): PhysicalContext {
  return {
    ...(epoch ?? neutral),
    RainfallMultiplier: 1,
    Seed: seed ^ salt ^ (EpochIndex < 0 ? 0 : Math.imul(EpochIndex + 1, 0x45d9f3b)),
    EpochStableSeed: seed ^ salt,
    EpochIndex,
    EpochCount,
    Profile,
    TectonicDurationMyr: epoch
      ? (epoch.TectonicDurationMyr ?? tectonicDefaultMyr)
      : tectonicReferenceMyr,
    Span: epoch ? (epoch.TectonicDurationMyr ?? tectonicDefaultMyr) / tectonicDefaultMyr : 1,
  };
}
