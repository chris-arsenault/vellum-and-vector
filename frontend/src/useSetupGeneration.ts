import { useMutation } from "@tanstack/react-query";
import type { GenerationWorkflow } from "./useGenerationWorkflow";

// Arconis: docs/architecture/subsystems.arconis#item=j_wizard — sends the reviewed setup, refusing unresolved errors.
export function useSetupGeneration(flow: GenerationWorkflow, errors: Record<string, string>) {
  return useMutation({
    mutationFn: async () => {
      if (!flow.draft.name.trim()) throw new Error("Name the mapped area before creating it.");
      if (Object.keys(errors).length) throw new Error("Correct or discard unfinished field edits.");
      if (flow.json.dirty) throw new Error("Apply or discard the JSON edits before generating.");
      if (flow.approach === "blank" && flow.options.onManual)
        return flow.options.onManual(flow.draft);
      if (!flow.prepared || flow.prepared.diagnostics.some((item) => item.severity === "error"))
        throw new Error("Resolve the generation dependencies before generating.");
      await flow.options.onGenerate(flow.draft, flow.prepared);
    },
  });
}
export function invalidSetup(flow: GenerationWorkflow, errors: Record<string, string>) {
  if (!flow.draft.name.trim() || Object.keys(errors).length || flow.json.dirty) return true;
  return (
    flow.approach !== "blank" &&
    (!flow.prepared || flow.prepared.diagnostics.some((item) => item.severity === "error"))
  );
}
