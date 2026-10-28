import {
  requireThat,
  type SpatialScope,
  type SpatialStore,
  type ChangeSet,
  type Impact,
  type ReadRequirements,
  type BlockCache,
} from "@atlas/domain";
import { planCommand, catalogChanges } from "@atlas/application";
import { openBlockCache, type FieldInputStore } from "@atlas/storage-browser";
import type { WorkspaceCommand, WorkspaceCommandResult } from "./workspaceProtocol";
import { WorkspaceFields } from "./workspaceFields";

async function commandScope(catalog: SpatialStore, input: WorkspaceCommand): Promise<SpatialScope> {
  const world = await catalog.readWorld(input.scope.worldId);
  requireThat(
    input.command.expectedVersion === world.version,
    "stale_version",
    "The world changed. Review the current geography."
  );
  const records = await catalog.readRecords(input.scope, "area", [input.scope.areaId]);
  const area = records[0]?.data;
  requireThat(area?.kind === "area", "missing_area", "Choose an existing mapped area.");
  return {
    ...input.scope,
    crsId: world.reference.id,
    revision: world.version,
    time: "present",
    resolution: null,
    footprint: area.value.footprint,
  };
}
function bootstrap(scope: SpatialScope, input: WorkspaceCommand): ReadRequirements {
  const ids = [input.command.data.areaId, input.command.data.parentId].filter(
    (id): id is string => typeof id === "string"
  );
  return {
    scope,
    objects: [{ kind: "area", ids }],
    channels: [],
    spatialLayers: [],
    parentHistory: [],
    dependencies: false,
  };
}
export async function executeWorkspaceCommand(
  catalog: SpatialStore,
  resources: FieldInputStore,
  input: WorkspaceCommand,
  blocks?: BlockCache
): Promise<WorkspaceCommandResult> {
  const scope = await commandScope(catalog, input);
  const source = await catalog.readAuthoring(bootstrap(scope, input));
  const working = blocks
    ? { cache: blocks, close() {} }
    : await openBlockCache(`command_${input.command.operationId}`);
  const fields = new WorkspaceFields(catalog, resources, working.cache);
  try {
    const plan = planCommand(source, input.command, input.template, working.cache);
    const snapshot = await catalog.readAuthoring(plan.requirements);
    await fields.read(snapshot, plan.requirements);
    const changes = plan.evaluate(snapshot),
      impact = commandImpact(changes);
    if (input.preview) return { change: null, impact, preview: changes.writes };
    await fields.publish(changes, snapshot.world.reference.precision ?? 1e-6);
    const publication = catalogChanges(snapshot, changes, fields.outputs, input.command.kind);
    publication.geography = fields.geography;
    const change = await catalog.commit(publication);
    fields.accept();
    return { change, impact, preview: [] };
  } finally {
    try {
      await fields.close();
    } finally {
      await working.close();
    }
  }
}
function commandImpact(changes: ChangeSet): Impact {
  return {
    features: [
      ...new Set([
        ...changes.writes.flatMap((w) =>
          w.kind === "feature"
            ? [w.value.id]
            : w.kind === "representation"
              ? [w.value.featureId]
              : []
        ),
        ...changes.removes.filter((r) => r.kind === "feature").map((r) => r.id),
      ]),
    ],
    areas: changes.writes.filter((w) => w.kind === "area").map((w) => w.value.id),
    layers: [
      ...new Set(changes.writes.flatMap((w) => ("layerId" in w.value ? [w.value.layerId] : []))),
    ],
    invalidations: [...new Set(changes.invalidations.map((i) => i.fact))],
    highImpact: changes.highImpact,
  };
}
