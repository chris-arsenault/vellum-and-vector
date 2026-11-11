import type { PhysicalContext } from "../world/context";
import type { PhysicalBufferName, PhysicalField } from "../world/field";
import type { AnswerKey } from "../coupling/answers";
import type { Pool } from "../coupling/flows";
import type { FieldProcess, PhysicalInput, PhysicalQuery } from "./groundProcess";
import { defineCommand, defineQuery, type Command, type OperationKind } from "../processOperation";

interface FieldEntry {
  id: string;
  statement: string;
  needs?: readonly PhysicalBufferName[];
  provides?: readonly PhysicalBufferName[];
  leaves?: readonly string[];
  moves?: readonly (readonly [Pool, Pool])[];
  asks?: readonly AnswerKey[];
  check?: (map: PhysicalField, context: PhysicalContext) => void;
  execute: (input: PhysicalInput) => void;
}
const declaration = (entry: Omit<FieldEntry, "execute">) => ({
  needs: [],
  provides: [],
  moves: [],
  asks: [],
  settings: {},
  reads: [],
  writes: [],
  ...entry,
  execution: "field" as const,
});

/** Whole-field commands declare their actual lifecycle; there is no default work category. */
export type CommandProcess = FieldProcess & { readonly operation: Command<PhysicalInput, void> };
export function fieldCommand(
  kind: Exclude<OperationKind, "query" | "elapsed" | "publish">,
  entry: FieldEntry,
  dependencies: readonly QueryProcess[]
): CommandProcess {
  const { execute, ...metadata } = entry;
  return {
    ...declaration(metadata),
    operation: defineCommand(
      entry.id,
      kind,
      execute,
      dependencies.map((dependency) => dependency.operation)
    ),
  };
}
export type QueryProcess = FieldProcess & { readonly operation: PhysicalQuery };
/** Queries retain executable dependencies when a map replaces their algorithm. */
export function fieldQuery(entry: FieldEntry, dependencies: readonly QueryProcess[]): QueryProcess {
  const { execute, ...metadata } = entry;
  return {
    ...declaration(metadata),
    operation: defineQuery(
      entry.id,
      ({ map, context }: PhysicalInput) =>
        execute({ map, context: { ...context, Span: 0, LocalDevelopment: false } }),
      dependencies.map((dependency) => dependency.operation)
    ),
  };
}
