import { resolveParameters, type Diagnostic, type ParameterValues } from "@atlas/domain";
import type { MapProcessContract, MapProcessRegistry, ProcessConfiguration } from "./process";
import { sequenceStages, type SequenceStage } from "./sequence";

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
  return resolveParameters(
    contract.parameters,
    relevant(configuration.parameters),
    relevant(variables),
    stage.invocation!.parameters ?? {}
  );
}
export function preflight(
  configuration: ProcessConfiguration,
  registry: MapProcessRegistry,
  initialFacts: Iterable<string> = []
) {
  const facts = new Set(initialFacts),
    invalidated = new Map<string, string>();
  const diagnostics: Diagnostic[] = [];
  for (const stage of sequenceStages(configuration.sequence)) {
    if (stage.kind === "epochStart") {
      for (const fact of stage.resetFacts ?? []) facts.delete(fact);
    }
    if (!stage.invocation) continue;
    inspectStage(configuration, registry, stage, facts, invalidated, diagnostics);
  }
  return diagnostics;
}
function inspectStage(
  configuration: ProcessConfiguration,
  registry: MapProcessRegistry,
  stage: SequenceStage,
  facts: Set<string>,
  invalidated: Map<string, string>,
  diagnostics: Diagnostic[]
) {
  const invocation = stage.invocation!;
  const variables = Object.assign({}, ...stage.epochs.map((epoch) => epoch.variables));
  if (invocation.when && variables[invocation.when.variable] !== invocation.when.equals) return;
  const path = [...stage.epochs.map((epoch) => epoch.id), ...stage.path].join(" / ");
  try {
    const contract = registry.get(invocation.process, invocation.version).contract;
    invocationParameters(contract, configuration, stage);
    for (const fact of contract.requires) {
      if (!facts.has(fact))
        diagnostics.push({
          code: "generation_prerequisite",
          severity: "error",
          invocation: path,
          resource: fact,
          message: `${path} requires ${fact}${invalidated.has(fact) ? `, invalidated by ${invalidated.get(fact)}` : " from an earlier process"}. Restore its producer or disable the dependent choice.`,
        });
    }
    for (const fact of contract.invalidates) {
      facts.delete(fact);
      invalidated.set(fact, path);
    }
    for (const fact of contract.produces) {
      facts.add(fact);
      invalidated.delete(fact);
    }
  } catch (error) {
    diagnostics.push({
      code: "generation_configuration",
      severity: "error",
      invocation: path,
      resource: null,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
