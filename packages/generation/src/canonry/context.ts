// Canonry PhysicalGeographyGenerationContext.cs, commit 0f62584c.
import type { PhysicalProfile } from "./profile";
import type { GenerationState, MapProcessContext } from "../process";
import { atlasEpoch } from "./atlasProfile";
import { round } from "./math";
import { ecologyEpochSchema, type Epoch } from "@atlas/domain";
import { generationBindings } from "../generationBindings";
import type { ProductLedger } from "../productLedger";
import { tectonicDefaultMyr, tectonicReferenceMyr } from "./tectonicControls";
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
  Products?: Pick<ProductLedger, "status">;
  RainfallMultiplier: number;
  Seed: number;
  EpochStableSeed: number;
  EpochIndex: number;
  EpochCount: number;
  IsEvolutionEpoch: boolean;
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
    IsEvolutionEpoch: epoch !== null,
    TectonicDurationMyr: epoch
      ? (epoch.TectonicDurationMyr ?? tectonicDefaultMyr)
      : tectonicReferenceMyr,
  };
}
