import type { PhysicalField } from "./field";
import type { PhysicalProfile } from "./profile";
import type { Placed } from "./landmarkGeometry";
import type { LandmarkRecord } from "./landmarkLedger";

/** One catalogue kind in generation: its causes, its measured signature, its correction. */
export interface Kind {
  /** Maintain the causes at this mesh even when the landform itself is below its resolution. */
  holdsLatent?: boolean;
  emplace(
    map: PhysicalField,
    p: PhysicalProfile,
    placed: Placed,
    epoch: number,
    record?: LandmarkRecord
  ): void;
  measure(map: PhysicalField, placed: Placed, record?: LandmarkRecord): Record<string, number>;
  /** Apply the smallest correction for the given shortfalls; returns units corrected. */
  maintain(
    map: PhysicalField,
    p: PhysicalProfile,
    placed: Placed,
    shortfall: Record<string, number>,
    epoch: number,
    record?: LandmarkRecord
  ): number;
  /** Claim a river for a water landmark; returns metres cut to bring it. */
  capture?(map: PhysicalField, placed: Placed, record: LandmarkRecord): number;
}
