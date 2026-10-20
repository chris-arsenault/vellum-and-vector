import { z } from "zod";
import { finite, scalarSchema, valueRecordSchema } from "@atlas/domain";
import type { ProcessConfiguration, ProcessSequence } from "./process";

const id = z.string().min(1);
const epoch = z
  .object({
    id,
    duration: finite.nonnegative(),
    parentEpoch: id.nullable(),
    variables: valueRecordSchema,
  })
  .strict();
const invocation = z
  .object({
    kind: z.literal("process"),
    id,
    process: id,
    version: id,
    parameters: valueRecordSchema.optional(),
    when: z.object({ variable: id, equals: scalarSchema }).strict().optional(),
  })
  .strict();
const sequence: z.ZodType<ProcessSequence> = z.array(
  z.union([
    invocation,
    z
      .object({
        kind: z.literal("epochs"),
        id,
        epochs: z.array(epoch).min(1),
        resetFacts: z.array(id),
        body: z.lazy(() => sequence),
      })
      .strict(),
  ])
);
export const processConfigurationSchema: z.ZodType<ProcessConfiguration> = z
  .object({
    id,
    version: z.number().int().positive(),
    parameters: valueRecordSchema,
    sequence,
    inputs: valueRecordSchema.optional(),
  })
  .strict();
