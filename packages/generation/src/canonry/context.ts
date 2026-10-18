// Canonry PhysicalGeographyGenerationContext.cs, commit 0f62584c.
import type { PhysicalProfile } from "./profile";
export interface PhysicalEpoch {
  StableName: string;
  TectonicStrength: number;
  HydrologyStrength: number;
  GlaciationStrength: number;
  CoastalStrength: number;
  TemperatureOffset: number;
  SeaLevelOffset: number;
}
export interface PhysicalContext {
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
    Seed: seed ^ salt ^ (EpochIndex < 0 ? 0 : Math.imul(EpochIndex + 1, 0x45d9f3b)),
    EpochStableSeed: seed ^ salt,
    EpochIndex,
    EpochCount,
    Profile,
    IsEvolutionEpoch: epoch !== null,
  };
}
