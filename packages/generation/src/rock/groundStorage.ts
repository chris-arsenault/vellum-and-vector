import { type Band, ReadBandView } from "@atlas/domain";
import type { PhysicalBufferName, PhysicalField } from "../world/field";
import { allColumnFields } from "./rockLayerFields";
import {
  loadIntegerFields,
  loadScalarFields,
  seaLoadIntegerFields,
  seaLoadScalarFields,
} from "./groundLoadFields";

/** The single writable inventory, including projections that only the owner can publish. */
export const groundOwnedFields = [
  ...allColumnFields,
  ...loadIntegerFields,
  ...loadScalarFields,
  ...seaLoadIntegerFields,
  ...seaLoadScalarFields,
  "Elevation",
  "BedrockElevation",
  "CrustSupportElevation",
  "CrustSupportTarget",
  "SurfaceRockLoad",
  "CrustThickness",
  "CrustContinentalColumn",
  "CrustContinentalFraction",
  "CrustRootReserve",
  "SedimentThickness",
  "SedimentSupply",
  "RockResistance",
  "RockKindCodes",
  "GroundCutShare",
  "GroundCutDepth",
  "GroundCutCover",
  "StructuralGrainX",
  "StructuralGrainY",
  "ThrustPairIds",
  "ThrustSheetIndex",
  "ThrustSegmentIds",
  "ThrustAcross",
  "ThrustDip",
  "CrustSutureStrength",
  "CrustSuturePairIds",
  "CrustProvinceSeam",
] as const;
export type GroundOwnedName = (typeof groundOwnedFields)[number];
export type GroundStorage = Readonly<Record<GroundOwnedName, Band>>;

// hpc-exempt: one ownership record per map, holding its existing typed-array bands.
const storage = new WeakMap<PhysicalField, GroundStorage>();

/** Field construction hands original bands to their owner before publishing any field reference. */
export function ownGround(map: PhysicalField, bands: Record<PhysicalBufferName, Band>) {
  if (storage.has(map)) throw new Error("Ground already has an owner.");
  const owned = Object.fromEntries(groundOwnedFields.map((name) => [name, bands[name]]));
  storage.set(map, Object.freeze(owned) as GroundStorage);
  for (const name of groundOwnedFields)
    Object.defineProperty(map, name, {
      value: new ReadBandView(bands[name]),
      enumerable: true,
      configurable: false,
      writable: false,
    });
  map.coverage.protect(groundOwnedFields);
}

/** Internal capability: imports are restricted to the rock owner, construction and test fixtures. */
export function groundStorage(map: PhysicalField): GroundStorage {
  const owned = storage.get(map);
  if (!owned) throw new Error("Ground has not been initialized by its field.");
  return owned;
}

/** Explicit-input fixtures alone may edit supplied initial state before exercising an operation. */
export function groundFixture(map: PhysicalField): PhysicalField & GroundStorage {
  const owned = groundStorage(map),
    fixture = { ...map, ...owned };
  storage.set(fixture, owned);
  return fixture;
}
