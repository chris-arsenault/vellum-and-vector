// Canonry PhysicalGeographyGenerationContext.cs, commit 0f62584c.
import type { PhysicalProfile } from "./profile";
import type { GenerationState, MapProcessContext } from "../process";
import { atlasEpoch } from "./atlasProfile";
import { round } from "./math";
import { ecologyEpochSchema, type Epoch, type GenerationEpoch, type MapScale } from "@atlas/domain";
import { boundPhysicalEpochIndex, generationBindings } from "../generationBindings";
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
  /** Explicit local material work; it does not create an epoch or advance history. */
  LocalDevelopment?: boolean;
  Products?: Pick<ProductLedger, "status">;
  /** What else rides the crust and moves whenever the plates do. */
  AfterPlateStep?: () => void;
  /** Selected deformation processes act before this interval's contacts weld or split. */
  DuringPlateStep?: (interval: PhysicalContext) => void;
  /** Optional live inspection; simultaneous effects are observed after their joint settlement. */
  ObserveProcess?: (
    event: ProcessObservation,
    field: PhysicalField,
    context: PhysicalContext
  ) => void;
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
  const physical = contextualPhysicalContext(seed, salt, state.physical!.profile, {
    epochs: settings.epochs,
    ancestry: context.epochs,
    scale: state.physical!.map.scale,
    initialized: state.physical!.map.CrustSupportInitialized,
  });
  physical.Products = context.products;
  return physical;
}
/** Context construction is independent of terrain execution and the requesting loop's ordinal. */
export function contextualPhysicalContext(
  seed: number,
  salt: number,
  base: PhysicalProfile,
  source: {
    epochs: readonly Epoch[];
    ancestry: readonly Pick<GenerationEpoch, "parentEpoch">[];
    scale: MapScale;
    initialized: boolean;
  }
) {
  const index = boundPhysicalEpochIndex(source.epochs, source.ancestry),
    epoch = index === undefined ? null : atlasEpoch(source.epochs[index], source.scale);
  const nativeIndex = index ?? (source.initialized ? -1 : 0);
  const definition = index === undefined ? undefined : source.epochs[index];
  const profile = epochProfile(base, definition);
  const physical = physicalContext(seed, salt, profile, epoch, nativeIndex, source.epochs.length);
  physical.RainfallMultiplier = ecologyEpochSchema.parse(
    (definition ?? source.epochs.at(-1))?.ecology ?? {}
  ).rainfall;
  return physical;
}
function epochProfile(base: PhysicalProfile, definition: Epoch | undefined) {
  const profile = { ...base };
  profile.ImpactCraterCount = round(profile.ImpactCraterCount * (definition?.impacts ?? 1));
  profile.VolcanicConeHeight *= definition?.volcanism ?? 1;
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
    ...physicalSeeds(seed, salt, EpochIndex),
    EpochIndex,
    EpochCount,
    Profile,
    TectonicDurationMyr: epoch
      ? (epoch.TectonicDurationMyr ?? tectonicDefaultMyr)
      : tectonicReferenceMyr,
    Span: epoch ? (epoch.TectonicDurationMyr ?? tectonicDefaultMyr) / tectonicDefaultMyr : 1,
  };
}

/** A process owns its spatial pattern; the requesting consumer supplies only the current epoch. */
export function physicalSeeds(seed: number, salt: number, epochIndex: number) {
  return {
    Seed: seed ^ salt ^ (epochIndex < 0 ? 0 : Math.imul(epochIndex + 1, 0x45d9f3b)),
    EpochStableSeed: seed ^ salt,
  };
}
