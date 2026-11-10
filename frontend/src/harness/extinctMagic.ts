import type { MutablePhysicalBufferName } from "../../../packages/generation/src/world/field";

/** Active magical forcing is not a geological remnant. Keep material and physical consequences. */
export const liveMagicForcing = [
  "ExternalHeatForcing",
  "ExternalCoastalForcing",
  "ExternalUpwelling",
  "ExternalSeaSurfaceForcing",
  "FogForcing",
  "StormForcing",
  "StormTrack",
  "Quickening",
  "Stillness",
  "IcePersistence",
  "IceCharge",
  "Verdure",
  "Salting",
  "Warding",
  "Tearing",
  "RiverWarmth",
] as const satisfies readonly MutablePhysicalBufferName[];

/** Explicit harness intervention before a physical-only continuation, never a product process. */
export function clearLiveMagic(
  fields: Record<(typeof liveMagicForcing)[number], { fill(value: number): void }>
) {
  for (const name of liveMagicForcing) fields[name].fill(0);
}
