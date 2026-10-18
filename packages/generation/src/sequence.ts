import { requireThat } from "@atlas/domain";
import type { GenerationEpoch, ProcessInvocation, ProcessSequence } from "./process";

export type SequenceStage = {
  kind: "process" | "epochStart" | "epochEnd";
  path: string[];
  epochs: GenerationEpoch[];
  epochIndices: number[];
  resetFacts?: string[];
  invocation?: ProcessInvocation;
};

export function sequenceStages(
  sequence: ProcessSequence,
  path: string[] = [],
  epochs: GenerationEpoch[] = [],
  epochIndices: number[] = []
): SequenceStage[] {
  const result: SequenceStage[] = [];
  requireThat(
    new Set(sequence.map((node) => node.id)).size === sequence.length,
    "duplicate_invocation",
    "Invocations have unique identities within a sequence."
  );
  for (const node of sequence) {
    const nextPath = [...path, node.id];
    if (node.kind === "process") {
      result.push({ kind: "process", path: nextPath, epochs, epochIndices, invocation: node });
      continue;
    }
    requireThat(
      node.epochs.length > 0 && new Set(node.epochs.map((e) => e.id)).size === node.epochs.length,
      "epoch_schedule",
      "An epoch sequence needs a nonempty schedule with unique identities."
    );
    requireThat(
      Array.isArray(node.resetFacts) &&
        node.resetFacts.every((fact) => typeof fact === "string" && fact.length > 0),
      "epoch_reset_facts",
      "An epoch loop declares the facts to refresh for its changing context."
    );
    for (const [index, epoch] of node.epochs.entries()) {
      requireThat(
        Number.isFinite(epoch.duration) && epoch.duration >= 0,
        "epoch_duration",
        "Epoch duration is finite and nonnegative."
      );
      const context = [...epochs, epoch];
      const indices = [...epochIndices, index];
      result.push({
        kind: "epochStart",
        path: nextPath,
        epochs: context,
        epochIndices: indices,
        resetFacts: node.resetFacts,
      });
      result.push(...sequenceStages(node.body, nextPath, context, indices));
      result.push({ kind: "epochEnd", path: nextPath, epochs: context, epochIndices: indices });
    }
  }
  return result;
}
