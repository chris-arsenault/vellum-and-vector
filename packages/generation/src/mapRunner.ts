import { requireThat, resolveParameters, sameValue, type ParameterValues } from "@atlas/domain";
import {
  MapProcessRegistry,
  type CompletedBoundary,
  type GenerationState,
  type GenerationCause,
  type MapProcessContext,
  type ProcessConfiguration,
} from "./process";
import { planHash } from "./planHash";
import { randomStream } from "./random";
import { sequenceStages, type SequenceStage } from "./sequence";
import { validateWorkingMap } from "./mapValidation";
import { composeAuthoredSamples } from "./mapAuthored";

export interface MapRunnerOptions {
  seed: string;
  seedScope: string;
  cancelled?(): boolean;
  progress?(path: string[], fraction: number, message: string): void;
  // Optional completed-epoch/final observation. Serialize before resolving:
  // numerical workspace is shared and the following epoch mutates it.
  saveBoundary?(boundary: CompletedBoundary): Promise<void>;
}
function activeCauses(state: GenerationState, nested: GenerationCause[][]): GenerationCause[] {
  return nested.at(-1) ?? (state.causes ??= []);
}

export class MapRunner {
  private readonly configuration: ProcessConfiguration;
  private readonly stages: SequenceStage[];
  constructor(
    configuration: ProcessConfiguration,
    private readonly registry: MapProcessRegistry
  ) {
    this.configuration = structuredClone(configuration);
    this.stages = sequenceStages(this.configuration.sequence);
    for (const stage of this.stages)
      if (stage.invocation) registry.get(stage.invocation.process, stage.invocation.version);
  }
  async run(initial: GenerationState, options: MapRunnerOptions): Promise<CompletedBoundary> {
    const configurationHash = await planHash({
      configuration: this.configuration,
      scope: initial.domain.scope,
      seed: options.seed,
      seedScope: options.seedScope,
    });
    const state = structuredClone(initial);
    const causes: GenerationCause[][] = [];
    const validate = () => {
      validateWorkingMap(state, initial.domain);
      requireThat(
        sameValue(state.history.slice(0, initial.history.length), initial.history),
        "generation_history",
        "Generation retains completed historical causes while changing the present."
      );
    };
    composeAuthoredSamples(state, initial.domain);
    validate();
    for (const [stageIndex, stage] of this.stages.entries()) {
      this.checkCancelled(options);
      if (stage.kind === "epochStart") {
        causes.push([]);
        for (const fact of stage.resetFacts!) state.facts.delete(fact);
        continue;
      }
      if (stage.kind === "epochEnd") {
        state.history.push({
          path: [...stage.path],
          ancestry: structuredClone(stage.epochs),
          causes: causes.pop()!,
        });
      } else {
        const spatialChanged = await this.applyProcess(
          state,
          stage,
          {
            ...options,
            progress: (path, fraction, message) =>
              options.progress?.(path, (stageIndex + fraction) / this.stages.length, message),
          },
          activeCauses(state, causes),
          initial.domain
        );
        if (spatialChanged) validate();
      }
      this.checkCancelled(options);
      if (stage.kind === "epochEnd") {
        validate();
        await options.saveBoundary?.({
          configurationHash,
          kind: "epoch",
          ancestry: structuredClone(stage.epochs),
          state,
        });
      }
    }
    validate();
    const result: CompletedBoundary = { configurationHash, kind: "final", ancestry: [], state };
    await options.saveBoundary?.(result);
    return result;
  }
  private checkCancelled(options: MapRunnerOptions): void {
    requireThat(!options.cancelled?.(), "generation_cancelled", "Generation was cancelled.");
  }
  private async applyProcess(
    state: GenerationState,
    stage: SequenceStage,
    options: MapRunnerOptions,
    causes: GenerationCause[],
    original: GenerationState["domain"]
  ) {
    const invocation = stage.invocation!,
      process = this.registry.get(invocation.process, invocation.version),
      variables = Object.assign(
        {},
        ...stage.epochs.map((epoch) => epoch.variables)
      ) as ParameterValues;
    if (invocation.when && variables[invocation.when.variable] !== invocation.when.equals)
      return false;
    for (const fact of process.contract.requires)
      requireThat(
        state.facts.has(fact),
        "stale_fact",
        `${stage.path.join("/")} requires fresh ${fact} in the current map/epoch.`
      );
    const definitions = process.contract.parameters;
    const relevant = (values: ParameterValues) =>
      Object.fromEntries(Object.entries(values).filter(([key]) => Object.hasOwn(definitions, key)));
    const parameters = resolveParameters(
      definitions,
      relevant(this.configuration.parameters),
      relevant(variables),
      invocation.parameters ?? {}
    );
    const context = this.context(state, stage, parameters, options, causes);
    await process.apply(state, context);
    if (!process.contract.workspaceOnly) composeAuthoredSamples(state, original);
    const diagnostics = process.validate(state, context);
    requireThat(
      diagnostics.every((d) => d.severity !== "error"),
      "process_output_invalid",
      diagnostics.map((d) => d.message).join(" ")
    );
    for (const fact of process.contract.invalidates) state.facts.delete(fact);
    for (const fact of process.contract.produces) state.facts.add(fact);
    options.progress?.(stage.path, 1, `Completed ${process.contract.id}`);
    return !process.contract.workspaceOnly;
  }
  private context(
    state: GenerationState,
    stage: SequenceStage,
    parameters: ParameterValues,
    options: MapRunnerOptions,
    causes: GenerationCause[]
  ): MapProcessContext {
    const varying = randomStream(
        options.seed,
        options.seedScope,
        stage.path.join("/"),
        "variation",
        stage.epochs.map((e) => e.id)
      ),
      stable = randomStream(options.seed, options.seedScope, stage.path.join("/"), "structure", []);
    return {
      scope: structuredClone(state.domain.scope),
      invocation: [...stage.path],
      parameters,
      epochs: structuredClone(stage.epochs),
      epochIndices: [...stage.epochIndices],
      causes,
      recordCause: (cause) => causes.push(structuredClone(cause)),
      random: (persistent = false) => (persistent ? stable : varying).next(),
      cancelled: () => options.cancelled?.() ?? false,
      progress: (fraction, message) => options.progress?.(stage.path, fraction, message),
    };
  }
}
