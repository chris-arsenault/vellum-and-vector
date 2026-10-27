import { z } from "zod";
import { numericalSampleType, type NumericalVector } from "./numericalVector";
import type { SampleType } from "./workspaceResources";

export function numericalSchema(type: SampleType) {
  return z.custom<NumericalVector>(
    (value) => numericalSampleType(value) === type,
    `Numerical storage requires ${type} samples.`
  );
}
