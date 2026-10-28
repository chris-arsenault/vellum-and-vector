import { z } from "zod";
import { Band } from "./lattice/band";
import type { SampleType } from "./workspaceResources";

/** A band of the declared sample type. */
export function numericalSchema(type: SampleType) {
  return z.custom<Band>(
    (value) => value instanceof Band && value.type === type,
    `Numerical storage requires ${type} samples.`
  );
}
