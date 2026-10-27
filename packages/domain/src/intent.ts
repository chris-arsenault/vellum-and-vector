import { z } from "zod";
import {
  durableScopeSchema,
  valueRecordSchema,
  type SpatialScope,
  type ParameterValues,
} from "./schemas";
import type { ChangeSet, DomainSnapshot, ReadRequirements } from "./operations";
import type { FieldRef, Layer } from "./model";
import { requireThat } from "./errors";
import type { FactDependencies } from "./factDependencies";
import { Spatial } from "./spatial";
import { areaSpace } from "./composition";
import { assertAgentChangeSafety } from "./changeSafety";
import type { NumericalAllocator } from "./numericalVector";

export const intentSchema = z.object({
  operationId: z.uuid(),
  expectedVersion: z.number().int().positive(),
  version: z.number().int().positive().default(1),
  kind: z.string().min(1),
  scope: durableScopeSchema,
  data: valueRecordSchema,
  confirmed: z.boolean().optional(),
});
export type Intent = z.infer<typeof intentSchema>;
export interface IntentContext {
  numerical?: NumericalAllocator;
  owner: string;
  actor: string;
  operationId: string;
  scope: SpatialScope;
  layers: Layer[];
  fields: FieldRef[];
  facts: FactDependencies;
  introducedIds?: string[];
}
export interface IntentDefinition<T> {
  kind: string;
  version: number;
  description: string;
  schema: z.ZodType<T>;
  requirements(data: T, context: IntentContext): ReadRequirements;
  evaluate(data: T, context: IntentContext, snapshot: DomainSnapshot): ChangeSet;
}
export interface BoundIntent {
  kind: string;
  version: number;
  parameters: ParameterValues;
  requirements: ReadRequirements;
  evaluate(snapshot: DomainSnapshot): ChangeSet;
}
interface RegisteredIntent {
  kind: string;
  version: number;
  description: string;
  schema: z.ZodType;
  bind(intent: Intent, context: IntentContext): BoundIntent;
}
export class IntentRegistry {
  private readonly definitions = new Map<string, RegisteredIntent>();
  register<T>(definition: IntentDefinition<T>): this {
    const key = `${definition.kind}@${definition.version}`;
    requireThat(
      !this.definitions.has(key),
      "duplicate_operation",
      `Operation ${key} is already registered.`
    );
    this.definitions.set(key, {
      ...definition,
      bind(intent, context) {
        const data = definition.schema.parse(intent.data);
        return {
          kind: definition.kind,
          version: definition.version,
          parameters: intent.data,
          requirements: definition.requirements(data, context),
          evaluate: (snapshot) => {
            validateIntentScope(snapshot, context.scope);
            validateIntentScope(snapshot, snapshot.scope);
            const changes = definition.evaluate(data, context, snapshot);
            assertAgentChangeSafety(snapshot, changes);
            return changes;
          },
        };
      },
    });
    return this;
  }
  bind(input: Intent, context: IntentContext): BoundIntent {
    const intent = intentSchema.parse(input),
      definition = this.definitions.get(`${intent.kind}@${intent.version}`);
    requireThat(
      definition,
      "unknown_operation",
      `Operation ${intent.kind}@${intent.version} is unavailable.`
    );
    requireThat(
      intent.scope.worldId === context.scope.worldId &&
        intent.expectedVersion === context.scope.revision &&
        intent.scope.revision === intent.expectedVersion &&
        intent.operationId === context.operationId,
      "operation_context",
      "Operation identity, revision and geographic context must agree."
    );
    requireThat(
      intent.scope.time === "present",
      "historical_read_only",
      "Ordinary authoring changes the present; completed history remains retained provenance."
    );
    return definition.bind(intent, context);
  }
  describe() {
    return [...this.definitions.values()].map((d) => ({
      kind: d.kind,
      version: d.version,
      description: d.description,
      schema: z.toJSONSchema(d.schema, {
        io: "input",
        unrepresentable: ({ zodSchema }) =>
          zodSchema === valueRecordSchema
            ? { type: "object", additionalProperties: true }
            : undefined,
      }),
    }));
  }
}
function validateIntentScope(snapshot: DomainSnapshot, scope: SpatialScope) {
  const area = snapshot.world.areas[scope.areaId],
    world = snapshot.world;
  requireThat(
    area &&
      scope.worldId === world.id &&
      scope.crsId === world.reference.id &&
      scope.revision === world.version &&
      scope.spaceId === areaSpace(world, area.id),
    "operation_scope",
    "The edit must resolve to its declared world, revision, CRS and located area."
  );
  requireThat(
    new Spatial(world.reference.precision).covers(area.footprint, scope.footprint),
    "scope_extent",
    "The edit's declared extent must stay within its selected mapped area."
  );
}
export function intentReads(
  context: IntentContext,
  selection: Partial<Omit<ReadRequirements, "scope">> = {}
): ReadRequirements {
  return {
    scope: context.scope,
    objects: [],
    spatialLayers: [],
    channels: [],
    parentHistory: [],
    dependencies: true,
    ...selection,
  };
}
export function intentChanges(context: IntentContext, snapshot: DomainSnapshot): ChangeSet {
  return {
    operationId: context.operationId,
    actor: context.actor,
    worldId: snapshot.world.id,
    expectedVersion: snapshot.world.version,
    readSet: snapshot.revisions,
    writes: [],
    removes: [],
    invalidations: [],
    highImpact: false,
  };
}
