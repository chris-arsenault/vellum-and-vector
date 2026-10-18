import {
  FactDependencies,
  Spatial,
  intentSchema,
  projectChanges,
  requireThat,
  type Intent,
  type IntentContext,
  type IntentRegistry,
  type DomainSnapshot,
  type ChangeSet,
} from "@atlas/domain";
import { Database, ownedVersion, type Sql } from "./dal/database";
import { readWorldHeader } from "./dal/worldHeader";
import { ancestorIds } from "./dal/areaReader";
import { readLayers } from "./dal/objectReaders";
import { readContextFields } from "./dal/fieldBindings";
import { readProjection } from "./dal/projections";
import { executeOperation, type PreparedOperation } from "./dal/commits";
import { existingOperation } from "./dal/operations";
import { contentHash } from "./dal/typedValues";

function fingerprint(intent: Intent): string {
  return contentHash({
    kind: intent.kind,
    version: intent.version,
    parameters: intent.data,
    expectedVersion: intent.expectedVersion,
    scope: intent.scope,
  });
}

export class IntentService {
  constructor(
    private readonly database: Database,
    readonly registry: IntentRegistry,
    private readonly facts = new FactDependencies()
  ) {}
  async prepare(
    world: string,
    owner: string,
    input: Intent,
    actor = `user:${owner}`
  ): Promise<PreparedOperation> {
    const intent = intentSchema.parse(input);
    return this.database.transaction(async (sql) => {
      const version = await ownedVersion(sql, world, owner);
      requireThat(
        intent.scope.worldId === world && intent.expectedVersion === version,
        "stale_version",
        "Reload this world before preparing the edit."
      );
      return this.bind(sql, world, owner, intent, actor);
    }, true);
  }
  private async bind(
    sql: Sql,
    world: string,
    owner: string,
    intent: Intent,
    actor: string
  ): Promise<PreparedOperation> {
    const header = await readWorldHeader(sql, world, intent.expectedVersion),
      layers = await readLayers(sql, world, intent.expectedVersion);
    const ancestors = await ancestorIds(sql, world, intent.expectedVersion, intent.scope.areaId);
    const fields = await readContextFields(sql, intent.scope, ancestors);
    const context: IntentContext = {
      owner,
      actor,
      operationId: intent.operationId,
      scope: intent.scope,
      layers: Object.values(layers.objects),
      fields,
      facts: this.facts,
    };
    const bound = this.registry.bind(intent, context);
    bound.requirements.scope = {
      ...bound.requirements.scope,
      footprint: new Spatial(header.reference.precision).canonical(
        bound.requirements.scope.footprint
      ),
    };
    return {
      id: intent.operationId,
      kind: bound.kind,
      version: bound.version,
      expectedVersion: intent.expectedVersion,
      parameters: bound.parameters,
      requestHash: fingerprint(intent),
      confirmed: intent.confirmed,
      reads: bound.requirements,
      evaluate: (snapshot) => bound.evaluate(snapshot),
    };
  }
  async preview(world: string, owner: string, input: Intent, actor = `user:${owner}`) {
    const prepared = await this.prepare(world, owner, input, actor);
    return this.database.transaction(async (sql) => {
      const version = await ownedVersion(sql, world, owner);
      requireThat(
        version === prepared.expectedVersion,
        "stale_version",
        "The world changed before this preview was read."
      );
      const source = await readProjection(sql, prepared.reads),
        changes = prepared.evaluate(source),
        candidate = projectChanges(source, changes);
      return {
        sourceVersion: source.world.version,
        scope: prepared.reads.scope,
        candidate: candidate.world,
        coverage: candidate.coverage,
        fields: candidate.numerical,
        fieldPatches: candidate.fieldPatches,
        impact: previewImpact(source, changes),
      };
    }, true);
  }
  async commit(world: string, owner: string, input: Intent, actor = `user:${owner}`) {
    const intent = intentSchema.parse(input);
    const hash = fingerprint(intent);
    return this.database.transaction(async (sql) => {
      const version = await ownedVersion(sql, world, owner, true);
      const previous = await existingOperation(sql, world, intent.operationId, hash);
      if (previous) return previous;
      requireThat(
        intent.scope.worldId === world && intent.expectedVersion === version,
        "stale_version",
        "Reload this world before preparing the edit."
      );
      const prepared = await this.bind(sql, world, owner, intent, actor);
      return executeOperation(sql, world, owner, prepared, version, hash, actor);
    });
  }
}
function previewImpact(snapshot: DomainSnapshot, changes: ChangeSet) {
  const features = new Set(
    changes.writes.flatMap((w) =>
      w.kind === "feature" ? [w.value.id] : w.kind === "representation" ? [w.value.featureId] : []
    )
  );
  for (const r of changes.removes.filter((r) => r.kind === "feature")) features.add(r.id);
  let changed = true;
  while (changed) {
    changed = false;
    for (const feature of Object.values(snapshot.world.features))
      if (!features.has(feature.id) && feature.relations.some((r) => features.has(r.targetId))) {
        features.add(feature.id);
        changed = true;
      }
  }
  return {
    features: [...features],
    areas: changes.writes.filter((w) => w.kind === "area").map((w) => w.value.id),
    layers: [
      ...new Set(
        changes.writes.flatMap((w) =>
          "layerId" in w.value ? [w.value.layerId] : w.kind === "layer" ? [w.value.id] : []
        )
      ),
    ],
    invalidations: [...new Set(changes.invalidations.map((i) => i.fact))],
    highImpact: changes.highImpact,
  };
}
