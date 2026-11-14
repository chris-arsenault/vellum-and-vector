import { waterYearFields, waterYearStateFields } from "@atlas/domain";
import type { PhysicalField } from "../world/field";
import type { PhysicalChannel } from "../world/atlasChannels";

/** The owner publishes the established supply year, not a reconstruction from ending stocks. */
export const waterYearChannels: PhysicalChannel[] = [
  ...waterYearFields.map((name) => ({ name, unit: "millimetre", minimum: 0 })),
  { name: "WaterRecharge", unit: "millimetre/year", minimum: 0 },
  { name: "SnowKept", unit: "millimetre/year", minimum: 0 },
];

export function inheritWaterYear(
  map: PhysicalField,
  cell: number,
  value: (part: (typeof waterYearStateFields)[number]) => number
) {
  for (const part of waterYearStateFields) map[part].set(cell, value(part));
}
