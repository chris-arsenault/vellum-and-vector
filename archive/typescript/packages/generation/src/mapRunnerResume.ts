import { requireThat, sameValue } from "@atlas/domain";
import type { GenerationCause, GenerationState, MapProcess } from "./process";
import type { MapRunnerOptions } from "./mapRunner";
import type { ProductLedger } from "./productLedger";
import type { SequenceStage } from "./sequence";
import { stageEnabled } from "./processRecovery";

/** The stage ending the epoch a run resumes after, or -1 for a run from the start. */
export function resumeStageIndex(stages: readonly SequenceStage[], options: MapRunnerOptions) {
  const after = options.resume?.after;
  if (!after) return -1;
  const index = stages.findIndex(
    (stage) =>
      stage.kind === "epochEnd" &&
      sameValue(
        stage.epochs.map((epoch) => epoch.id),
        after
      )
  );
  requireThat(index >= 0, "generation_resume", `No completed epoch ${after.join(" / ")}.`);
  return index;
}
export interface ReplayedRun {
  state: GenerationState;
  causes: GenerationCause[][];
  products: ProductLedger;
  validate(): void;
  /** The stage's process, absent for an epoch boundary. */
  process?: MapProcess;
  /** Runs the stage as an ordinary run would. */
  execute(): Promise<unknown>;
}
/**
 * A stage whose result the saved state already holds. Initializers still run, because they
 * build the working state; every other process only records what it would have produced.
 * The epoch the run resumes after ends by restoring the saved state.
 */
export async function replayCompletedStage(
  stage: SequenceStage,
  last: boolean,
  options: MapRunnerOptions,
  run: ReplayedRun
) {
  if (stage.kind === "epochEnd") {
    run.causes.pop();
    run.products.enterEpoch(stage.path.join("/"));
    if (!last) return;
    options.progress?.(stage.path, 1, "Restoring the saved epoch");
    await options.resume!.restore(run.state);
    run.validate();
    return;
  }
  if (!run.process || !stageEnabled(stage)) return;
  if (run.process.operation.kind === "initialize") await run.execute();
  else run.products.commit(run.process.contract, stage.path.join("/"));
}
