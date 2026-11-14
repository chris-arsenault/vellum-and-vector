import { DomainError, type Diagnostic } from "@atlas/domain";
import type { GenerationDiagnostic, GenerationState } from "./process";
import type { SequenceStage } from "./sequence";

export function processDiagnostic(
  stage: SequenceStage,
  diagnostic: Diagnostic,
  outcome: GenerationDiagnostic["outcome"],
  error?: unknown
): GenerationDiagnostic {
  return {
    ...diagnostic,
    invocation: stage.path.join("/"),
    process: stage.invocation!.process,
    epochs: structuredClone(stage.epochs),
    outcome,
    ...(error instanceof Error ? { stack: error.stack } : {}),
  };
}

export function processFailureDiagnostics(error: unknown): Diagnostic[] {
  if (error instanceof DomainError && error.code === "process_output_invalid")
    return error.details as Diagnostic[];
  return [
    {
      code: error instanceof DomainError ? error.code : "process_failed",
      message: error instanceof Error ? error.message : String(error),
      severity: "error",
      invocation: null,
      resource: null,
    },
  ];
}

export function processDiagnostics(
  state: GenerationState,
  stage: SequenceStage,
  notify?: (diagnostic: GenerationDiagnostic) => void
) {
  return (diagnostics: Diagnostic[], outcome: GenerationDiagnostic["outcome"], error?: unknown) => {
    for (const diagnostic of diagnostics) {
      const entry = processDiagnostic(stage, diagnostic, outcome, error);
      (state.diagnostics ??= []).push(entry);
      notify?.(entry);
    }
  };
}

export function stageEnabled(stage: SequenceStage) {
  const when = stage.invocation!.when;
  if (!when) return true;
  const variables = Object.assign({}, ...stage.epochs.map((epoch) => epoch.variables));
  return variables[when.variable] === when.equals;
}
