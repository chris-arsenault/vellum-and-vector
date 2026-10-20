import { resolveParameters, type Diagnostic, type ParameterValues } from "@atlas/domain";
import {
  verifyReconciliationBindings,
  type MapProcessContract,
  type MapProcessRegistry,
  type ProcessConfiguration,
  type ProcessReconciliation,
} from "./process";
import { sequenceStages, type SequenceStage } from "./sequence";
import { ProductLedger, processRequirements } from "./productLedger";
import { validateBehaviorBinding } from "./processTraits";
import type { ResolvedFeatures } from "./features";

export function invocationParameters(
  contract: MapProcessContract,
  configuration: ProcessConfiguration,
  stage: SequenceStage
) {
  const variables = Object.assign(
    {},
    ...stage.epochs.map((epoch) => epoch.variables)
  ) as ParameterValues;
  const relevant = (values: ParameterValues) =>
    Object.fromEntries(
      Object.entries(values).filter(([key]) => Object.hasOwn(contract.parameters, key))
    );
  const features = configuration.inputs?.features as unknown as ResolvedFeatures | undefined;
  const feature = stage.invocation!.feature;
  const owned = feature ? (features?.selection[feature]?.settings ?? {}) : {};
  return resolveParameters(
    contract.parameters,
    relevant(configuration.parameters),
    relevant(owned),
    relevant(variables),
    stage.invocation!.parameters ?? {}
  );
}
export function preflight(
  configuration: ProcessConfiguration,
  registry: MapProcessRegistry,
  initialFacts: Iterable<string> = []
) {
  const products = new ProductLedger(new Set(initialFacts), registry.productDefinitions());
  const diagnostics: Diagnostic[] = [];
  try {
    verifyReconciliationBindings(configuration, registry);
  } catch (error) {
    diagnostics.push(configurationError(error, configuration.id));
    return diagnostics;
  }
  for (const stage of sequenceStages(configuration.sequence)) {
    if (stage.kind === "epochStart") {
      products.enterEpoch(stage.path.join("/"));
      for (const fact of stage.resetFacts ?? []) products.invalidate(fact, "epoch reset");
    }
    if (stage.kind === "epochEnd") products.enterEpoch(stage.path.join("/"));
    if (!stage.invocation) continue;
    inspectStage(configuration, registry, stage, products, diagnostics);
  }
  return diagnostics;
}
function inspectStage(
  configuration: ProcessConfiguration,
  registry: MapProcessRegistry,
  stage: SequenceStage,
  products: ProductLedger,
  diagnostics: Diagnostic[]
) {
  const invocation = stage.invocation!;
  const variables = Object.assign({}, ...stage.epochs.map((epoch) => epoch.variables));
  if (invocation.when && variables[invocation.when.variable] !== invocation.when.equals) return;
  const path = [...stage.epochs.map((epoch) => epoch.id), ...stage.path].join(" / ");
  try {
    const process = registry.get(invocation.process, invocation.version);
    const contract = process.contract;
    validateBehaviorBinding(process, stage);
    invocationParameters(contract, configuration, stage);
    for (const input of processRequirements(contract)) {
      if (!products.accepts(input)) {
        const invalidator = products.invalidatedBy(input.product);
        diagnostics.push({
          code: "generation_prerequisite",
          severity: "error",
          invocation: path,
          resource: input.product,
          message: `${path} requires ${input.product}${invalidator ? `, invalidated by ${invalidator}` : " from an earlier process"}. Restore its producer or disable the dependent choice.`,
        });
      }
    }
    if (contract.reconciliation)
      inspectReconciliation(
        configuration,
        registry,
        stage,
        products,
        diagnostics,
        contract.reconciliation
      );
    products.commit(contract, path);
  } catch (error) {
    diagnostics.push(configurationError(error, path));
  }
}

function inspectReconciliation(
  configuration: ProcessConfiguration,
  registry: MapProcessRegistry,
  parent: SequenceStage,
  products: ProductLedger,
  diagnostics: Diagnostic[],
  reconciliation: ProcessReconciliation
) {
  const path = [...parent.path, "reconciliation"];
  const changed = products.fork();
  for (const product of reconciliation.invalidates) changed.invalidate(product, path.join("/"));
  const stages = sequenceStages(reconciliation.sequence, path, parent.epochs, parent.epochIndices);
  if (stages.some((stage) => stage.kind !== "process"))
    throw new Error("Reconciliation subplans cannot replay or introduce an epoch.");
  for (const stage of stages) {
    const contract = registry.get(stage.invocation!.process, stage.invocation!.version).contract;
    if (contract.reconciliation)
      throw new Error(
        "Reconciliation subplans contain ordinary operations, not further conditional branches."
      );
    inspectStage(configuration, registry, stage, changed, diagnostics);
  }
  checkGuarantees(products, reconciliation, "unchanged", path, diagnostics);
  checkGuarantees(changed, reconciliation, "changed", path, diagnostics);
  products.join(changed, path.join("/"));
}
function checkGuarantees(
  products: ProductLedger,
  reconciliation: ProcessReconciliation,
  outcome: string,
  path: string[],
  diagnostics: Diagnostic[]
) {
  for (const product of reconciliation.guarantees)
    if (!products.facts.has(product))
      diagnostics.push({
        code: "reconciliation_guarantee",
        severity: "error",
        invocation: path.join("/"),
        resource: product,
        message: `The ${outcome} reconciliation path must retain fresh ${product}.`,
      });
}
function configurationError(error: unknown, path: string): Diagnostic {
  return {
    code: "generation_configuration",
    severity: "error",
    invocation: path,
    resource: null,
    message: error instanceof Error ? error.message : String(error),
  };
}
