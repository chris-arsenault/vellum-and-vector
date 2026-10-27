import {
  createIntentRegistry,
  layerSupports,
  intentSchema,
  intentReads,
  FactDependencies,
  type Command,
  type DomainSnapshot,
  type ChangeSet,
  type ReadRequirements,
  type IntentContext,
  type Template,
  type NumericalAllocator,
} from "@atlas/domain";
import { normalizeCommand } from "./commandNormalization";
import { supplementalChanges } from "./supplemental";
import { instantiateTemplate } from "./templatePlacement";

const registry = createIntentRegistry();
export const atlasFacts = new FactDependencies()
  .add("elevation", ["climate", "rivers", "lakes", "roads", "cultures", "sovereignty"])
  .add("climate", ["rivers", "cultures"])
  .add("rivers", ["roads", "cultures", "sovereignty"]);
const aliases: Record<string, string> = { setView: "putView", putMagic: "putMagicSource" };
const supplemental = new Set([
  "deleteFeature",
  "connectSpaces",
  "setHumanEras",
  "setPhysicalEpochs",
  "putLandform",
  "routeNetwork",
  "reconcileBoundary",
]);
export interface CommandPlan {
  requirements: ReadRequirements;
  evaluate(snapshot: DomainSnapshot): ChangeSet;
}
export function planCommand(
  source: DomainSnapshot,
  command: Command,
  template?: Template,
  numerical?: NumericalAllocator
): CommandPlan {
  const data = normalizeCommand(source, command);
  const context: IntentContext = {
    numerical,
    scope: source.scope,
    owner: source.world.owner,
    actor: "user",
    operationId: command.operationId,
    layers: Object.values(source.world.layers),
    fields: source.world.fields,
    facts: atlasFacts,
  };
  if (command.kind === "instantiateTemplate")
    return {
      requirements: supplementalReads(command.kind, context, data, template),
      evaluate(snapshot) {
        if (!template) throw new Error("Choose the current template definition.");
        return instantiateTemplate(snapshot, context, data, template);
      },
    };
  if (supplemental.has(command.kind) || (command.kind === "putEntity" && !!data.origin))
    return {
      requirements: supplementalReads(command.kind, context, data),
      evaluate(snapshot) {
        const result = supplementalChanges(snapshot, context, command.kind, data);
        if (!result) throw new Error(`Unknown authoring operation: ${command.kind}`);
        return result;
      },
    };
  const intent = registry.bind(
    intentSchema.parse({
      ...command,
      kind: aliases[command.kind] ?? command.kind,
      data,
      scope: source.scope,
      version: 1,
      confirmed: data.confirm === true,
    }),
    context
  );
  return { requirements: intent.requirements, evaluate: (snapshot) => intent.evaluate(snapshot) };
}
function referenceIds(data: Record<string, unknown>, template?: Template): string[] {
  const connectionEnds = [data.a, data.b].filter(Boolean) as {
    featureId?: string;
    areaId: string;
    nodeId?: string;
  }[];
  return [
    data.featureId,
    data.startFeatureId,
    data.endFeatureId,
    data.contextFeatureId,
    ...connectionEnds.flatMap((e) => [e.areaId, e.featureId, e.nodeId]),
    ...Object.values(data.bindings ?? {}),
    ...(template?.features.flatMap((f) => f.relations.map((r) => r.targetId)) ?? []),
  ].filter((id): id is string => typeof id === "string");
}
function supplementalReads(
  kind: string,
  context: IntentContext,
  data: Record<string, unknown>,
  template?: Template
): ReadRequirements {
  const ids = referenceIds(data, template);
  const geographic = [
    "instantiateTemplate",
    "routeNetwork",
    "putLandform",
    "reconcileBoundary",
    "putEntity",
  ].includes(kind);
  const numerical = geographic ? numericalReads(kind, context, data) : [];
  return intentReads(context, {
    objects:
      kind === "setHumanEras"
        ? [{ kind: "society", ids: [`society:${context.scope.areaId}`] }]
        : [],
    references: ids,
    referencesTo: kind === "deleteFeature" ? ids : [],
    spatialLayers: geographic
      ? context.layers.filter((l) => layerSupports(l, "network")).map((l) => l.id)
      : [],
    channels: numerical,
    constraints: {
      intersectingAreas: geographic,
      descendantsOf: kind === "setPhysicalEpochs" ? [context.scope.areaId] : [],
      boundaryFeatures: ids,
    },
    completeRepresentations: ids,
  });
}
function numericalReads(kind: string, context: IntentContext, data: Record<string, unknown>) {
  const sculpt = data.sculpt as Record<string, unknown> | undefined;
  const needed =
    kind === "putLandform"
      ? ["elevation"]
      : kind === "routeNetwork"
        ? ["elevation", "drainageElevation", "flow", "water"]
        : sculpt
          ? [String(sculpt.channel)]
          : ["elevation", "flow"];
  return context.fields.flatMap((field) => {
    const names = (field.channels ?? []).filter((name) => needed.includes(name));
    return names.length ? [{ fieldId: field.id, names }] : [];
  });
}
