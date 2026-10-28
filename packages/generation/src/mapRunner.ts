import {
  DomainError,
  requireThat,
  sameValue,
  type ParameterValues,
  type NumericalAllocator,
} from "@atlas/domain";
import {
  MapProcessRegistry,
  verifyReconciliationBindings,
  type CompletedBoundary,
  type GenerationState,
  type GenerationCause,
  type GenerationDiagnostic,
  type MapProcessContext,
  type ProcessConfiguration,
  type ProcessSequence,
} from "./process";
import { planHash } from "./planHash";
import { randomStream } from "./random";
import { sequenceStages, type SequenceStage } from "./sequence";
import { validateWorkingMap } from "./mapValidation";
import { composeAuthoredSamples } from "./mapAuthored";
import { invocationParameters } from "./preflight";
import {
  ProductLedger,
  bindNativeFacts,
  detachNativeFacts,
  processRequirements,
} from "./productLedger";
import { executeProcessBehavior } from "./processTraits";
import {
  processDiagnostics,
  processFailureDiagnostics,
  stageEnabled,
  unrecoverableProcessFailure,
} from "./processRecovery";
import { prepareWorkingState, numericalProcessLifetime } from "./generationWorkingState";

export interface MapRunnerOptions {
  seed: string;
  seedScope: string;
  cancelled?(): boolean;
  progress?(path: string[], fraction: number, message: string): void;
  diagnostic?(diagnostic: GenerationDiagnostic): void;
  /** Worker-owned numerical storage; never serialized into a boundary or save. */
  numerical?: NumericalAllocator;
  /** Worker-owned block cache for the physical coverage; resident when absent. */
  cache?: import("@atlas/domain").BlockCache;
  features?: import("@atlas/domain").FeatureWorkspace;
  sourceFeatures?: import("@atlas/domain").FeatureReader;
  networks?: import("@atlas/domain").NetworkWorkspace;
  sourceNetworks?: import("@atlas/domain").NetworkReader;
  contours?: import("@atlas/domain").ContourWorkspace;
  /** Adapter scheduling between processes. */
  yieldControl?(): Promise<void>;
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
    verifyReconciliationBindings(this.configuration, registry);
    this.stages = sequenceStages(this.configuration.sequence);
    for (const stage of this.stages)
      if (stage.invocation) registry.get(stage.invocation.process, stage.invocation.version);
  }
  async run(initial: GenerationState, options: MapRunnerOptions): Promise<CompletedBoundary> {
    return this.runState(initial, options, false);
  }
  /** The execution adapter transfers its private working state; immutable inputs stay scoped. */
  async runOwned(initial: GenerationState, options: MapRunnerOptions): Promise<CompletedBoundary> {
    return this.runState(initial, options, true);
  }
  private async runState(
    initial: GenerationState,
    options: MapRunnerOptions,
    owned: boolean
  ): Promise<CompletedBoundary> {
    verifyReconciliationBindings(this.configuration, this.registry);
    const configurationHash = await this.configurationHash(initial, options);
    const state = prepareWorkingState(initial, options, owned);
    const causes: GenerationCause[][] = [];
    const products = new ProductLedger(state.facts, this.registry.productDefinitions());
    bindNativeFacts(state, products);
    const validate = workingValidator(state, initial);
    composeAuthoredSamples(state, initial.domain);
    options.progress?.(["prepare"], 0, "Validating inherited geography");
    validate();
    for (const [stageIndex, stage] of this.stages.entries()) {
      await options.yieldControl?.();
      this.checkCancelled(options);
      if (stage.kind === "epochStart") {
        causes.push([]);
        products.enterEpoch(stage.path.join("/"));
        for (const fact of stage.resetFacts!) products.invalidate(fact, "epoch reset");
        continue;
      }
      if (stage.kind === "epochEnd") {
        state.history.push({
          path: [...stage.path],
          ancestry: structuredClone(stage.epochs),
          causes: causes.pop()!,
        });
        this.checkCancelled(options);
        products.enterEpoch(stage.path.join("/"));
        validate();
        await observeBoundary(
          options,
          {
            configurationHash,
            kind: "epoch",
            ancestry: structuredClone(stage.epochs),
            state,
          },
          products
        );
      } else {
        await this.runProcess(
          state,
          stage,
          {
            ...options,
            progress: (path, fraction, message) =>
              options.progress?.(
                path,
                ((stageIndex + fraction) / this.stages.length) * 0.98,
                message
              ),
          },
          activeCauses(state, causes),
          initial.domain,
          validate,
          products
        );
      }
      this.checkCancelled(options);
    }
    options.progress?.(["finalize"], 0.99, "Validating completed geography");
    validate();
    detachNativeFacts(state);
    const result: CompletedBoundary = { configurationHash, kind: "final", ancestry: [], state };
    await options.saveBoundary?.(result);
    return result;
  }
  private configurationHash(initial: GenerationState, options: MapRunnerOptions) {
    return planHash({
      configuration: this.configuration,
      scope: initial.domain.scope,
      seed: options.seed,
      seedScope: options.seedScope,
    });
  }
  private checkCancelled(options: MapRunnerOptions): void {
    requireThat(!options.cancelled?.(), "generation_cancelled", "Generation was cancelled.");
  }
  private async runProcess(
    state: GenerationState,
    stage: SequenceStage,
    options: MapRunnerOptions,
    causes: GenerationCause[],
    original: GenerationState["domain"],
    validate: () => void,
    products: ProductLedger
  ) {
    if (!stageEnabled(stage)) {
      options.progress?.(stage.path, 1, `Skipped ${stage.invocation!.process}`);
      return true;
    }
    const process = this.registry.get(stage.invocation!.process, stage.invocation!.version);
    const record = processDiagnostics(state, stage, options.diagnostic);
    const missing = processRequirements(process.contract).filter(
      (input) => !products.accepts(input)
    );
    if (missing.length) {
      record(
        missing.map((input) => ({
          code: "stale_fact",
          message: `Skipped ${process.contract.id}: requires fresh ${input.product} in the current map/epoch.`,
          severity: "warning",
          invocation: null,
          resource: input.product,
        })),
        "skipped"
      );
      options.progress?.(stage.path, 1, `Skipped ${process.contract.id}`);
      return false;
    }
    const parameters = invocationParameters(process.contract, this.configuration, stage);
    products.checkProviders(process.contract);
    const releaseNumerical = numericalProcessLifetime(options.numerical, state, true);
    try {
      const diagnostics = await this.applyProcess(
        state,
        stage,
        options,
        causes,
        original,
        products,
        parameters,
        validate
      );
      record(diagnostics, "retained");
    } catch (error) {
      this.checkCancelled(options);
      if (unrecoverableProcessFailure(error)) throw error;
      record(processFailureDiagnostics(error), "omitted", error);
      [...process.contract.produces, ...process.contract.invalidates].forEach((product) =>
        products.invalidate(product, stage.path.join("/"))
      );
      validate();
      options.progress?.(stage.path, 1, `Skipped ${process.contract.id}`);
      return false;
    } finally {
      releaseNumerical();
    }
    options.progress?.(stage.path, 1, `Completed ${process.contract.id}`);
    return true;
  }
  private async applyProcess(
    state: GenerationState,
    stage: SequenceStage,
    options: MapRunnerOptions,
    causes: GenerationCause[],
    original: GenerationState["domain"],
    products: ProductLedger,
    parameters: ParameterValues,
    validate: () => void
  ) {
    const invocation = stage.invocation!,
      process = this.registry.get(invocation.process, invocation.version);
    bindNativeFacts(state, products);
    const context = this.context(state, stage, parameters, options, causes, products, original);
    options.progress?.(stage.path, 0, `Starting ${process.contract.id}`);
    await executeProcessBehavior(process, state, context);
    bindNativeFacts(state, products);
    options.progress?.(stage.path, 0.95, `Validating ${process.contract.id}`);
    if (!process.contract.workspaceOnly) composeAuthoredSamples(state, original);
    const diagnostics = process.validate(state, context);
    if (diagnostics.some((d) => d.severity === "error"))
      throw new DomainError(
        "process_output_invalid",
        diagnostics.map((d) => d.message).join(" "),
        diagnostics
      );
    for (const product of process.contract.reconciliation?.guarantees ?? [])
      requireThat(
        products.facts.has(product),
        "reconciliation_guarantee",
        `${stage.path.join("/")} must retain fresh ${product} after either reconciliation outcome.`
      );
    if (!process.contract.workspaceOnly) {
      options.progress?.(stage.path, 0.98, `Checking geography after ${process.contract.id}`);
      validate();
    }
    products.commit(process.contract, stage.path.join("/"));
    return diagnostics;
  }
  private context(
    state: GenerationState,
    stage: SequenceStage,
    parameters: ParameterValues,
    options: MapRunnerOptions,
    causes: GenerationCause[],
    products: ProductLedger,
    original: GenerationState["domain"]
  ): MapProcessContext {
    let reconciled = false;
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
      inputs: structuredClone(this.configuration.inputs ?? {}),
      products,
      reconcile: async () => {
        const contract = this.registry.get(
          stage.invocation!.process,
          stage.invocation!.version
        ).contract;
        requireThat(
          contract.reconciliation && !reconciled,
          "reconciliation_branch",
          "Execute a declared reconciliation branch at most once per invocation."
        );
        verifyReconciliationBindings(this.configuration, this.registry);
        reconciled = true;
        for (const product of contract.reconciliation.invalidates)
          products.invalidate(product, `${stage.path.join("/")}/reconciliation`);
        await this.executeNested(
          state,
          stage,
          contract.reconciliation.sequence,
          options,
          causes,
          products,
          original
        );
      },
      epochs: structuredClone(stage.epochs),
      epochIndices: [...stage.epochIndices],
      causes,
      recordCause: (cause) => causes.push(structuredClone(cause)),
      random: (persistent = false) => (persistent ? stable : varying).next(),
      cancelled: () => options.cancelled?.() ?? false,
      progress: (fraction, message) => options.progress?.(stage.path, fraction * 0.9, message),
    };
  }
  private async executeNested(
    state: GenerationState,
    parent: SequenceStage,
    sequence: ProcessSequence,
    options: MapRunnerOptions,
    causes: GenerationCause[],
    products: ProductLedger,
    original: GenerationState["domain"]
  ) {
    const stages = sequenceStages(
      sequence,
      [...parent.path, "reconciliation"],
      parent.epochs,
      parent.epochIndices
    );
    requireThat(
      stages.every((stage) => stage.kind === "process"),
      "nested_epoch",
      "Reconciliation subplans cannot replay or introduce an epoch."
    );
    for (const stage of stages) {
      requireThat(
        !this.registry.get(stage.invocation!.process, stage.invocation!.version).contract
          .reconciliation,
        "reconciliation_branch",
        "Reconciliation subplans contain ordinary operations, not further conditional branches."
      );
      this.checkCancelled(options);
      const completed = await this.runProcess(
        state,
        stage,
        options,
        causes,
        original,
        () => validateWorkingMap(state, original),
        products
      );
      requireThat(
        completed,
        "reconciliation_failed",
        "A reconciliation operation was omitted; its parent outputs remain unavailable."
      );
    }
  }
}
function workingValidator(state: GenerationState, initial: GenerationState) {
  return () => {
    validateWorkingMap(state, initial.domain);
    requireThat(
      sameValue(state.history.slice(0, initial.history.length), initial.history),
      "generation_history",
      "Generation retains completed historical causes while changing the present."
    );
  };
}
async function observeBoundary(
  options: MapRunnerOptions,
  boundary: CompletedBoundary,
  products: ProductLedger
) {
  detachNativeFacts(boundary.state);
  try {
    await options.saveBoundary?.(boundary);
  } finally {
    bindNativeFacts(boundary.state, products);
  }
}
