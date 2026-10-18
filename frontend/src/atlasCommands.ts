import {
  createIntentRegistry,
  projectChanges,
  requireThat,
  semanticId,
  intentSchema,
  areaSpace,
  spatial,
  point,
  isDescendant,
  type Position,
  type Command,
  type ChangeSet,
  type DomainSnapshot,
  type IntentContext,
  type Proposal,
} from "@atlas/domain";
import { session, worldScope, facts, publish } from "./atlasState";
import { instantiateTemplate, listTemplates } from "./atlasTemplates";
import { listJobs, startGeneration } from "./generationJobs";
import { supplementalChanges } from "./sessionAuthoring";

const registry = createIntentRegistry();

export function prepareCommand(id: string, command: Command) {
  const source = session(id).snapshot;
  requireThat(
    command.expectedVersion === source.world.version,
    "stale_version",
    "The world changed. Review the current geography and try again."
  );
  const data = normalize(source, command);
  const areaId = String(
    data.areaId ?? data.parentId ?? Object.values(source.world.areas).find((a) => !a.parentId)!.id
  );
  const scope = worldScope(source.world, areaId);
  const snapshot = { ...source, scope };
  const context: IntentContext = {
    scope,
    owner: "creator",
    actor: "user",
    operationId: command.operationId,
    layers: Object.values(source.world.layers),
    fields: source.world.fields,
    facts,
  };
  let changes: ChangeSet;
  if (command.kind === "instantiateTemplate")
    changes = instantiateTemplate(snapshot, context, data);
  else {
    const extra = supplementalChanges(snapshot, context, command.kind, data);
    changes =
      extra ??
      registry
        .bind(
          intentSchema.parse({
            ...command,
            kind: aliases[command.kind] ?? command.kind,
            data,
            scope,
            version: 1,
            confirmed: data.confirm === true,
          }),
          context
        )
        .evaluate(snapshot);
  }
  const candidate = projectChanges(snapshot, changes);
  candidate.resources = [
    ...source.resources.filter(
      (r) => !changes.fieldArtifacts?.some((a) => a.reference.id === r.id)
    ),
    ...(changes.fieldArtifacts ?? []).map((a) => a.reference),
  ];
  return { candidate, changes, impact: impact(changes) };
}
const aliases: Record<string, string> = { setView: "putView", putMagic: "putMagicSource" };

function normalize(snapshot: DomainSnapshot, command: Command): Record<string, unknown> {
  const data = { ...command.data };
  const area =
    snapshot.world.areas[String(data.areaId ?? data.parentId)] ??
    Object.values(snapshot.world.areas).find((a) => !a.parentId)!;
  if (command.kind === "reconcileBoundary" && data.sculpt) {
    const sculpt = data.sculpt as Record<string, unknown>;
    const field = brushField(snapshot, String(sculpt.areaId), sculpt);
    requireThat(field, "missing_field", "Choose a field to reconcile.");
    return { ...data, areaId: field.areaId, sculpt: { ...sculpt, fieldId: field.id } };
  }
  if (command.kind === "createArea")
    return {
      ...data,
      id: semanticId(snapshot.world.id, "area", command.operationId),
      layers: Object.values(snapshot.world.layers)
        .filter((l) => l.profiles.includes(data.profile as typeof area.profile))
        .map((l) => l.id),
    };
  if (command.kind === "createField" && !data.channels)
    return {
      ...data,
      id: semanticId(snapshot.world.id, "field", command.operationId),
      footprint: area.footprint,
      width: Number(data.resolution),
      height: Number(data.resolution),
      channels: {
        [String(data.layerId)]: {
          unit: data.layerId === "elevation" ? "metre" : "ratio",
          values: Number(data.value),
        },
      },
    };
  if (command.kind === "sculptField") {
    const field = brushField(snapshot, area.id, data);
    requireThat(field, "missing_field", "Generate or initialize this field before sculpting.");
    return { ...data, fieldId: field.id, mode: "add", amount: data.delta };
  }
  return data;
}
function brushField(snapshot: DomainSnapshot, areaId: string, data: Record<string, unknown>) {
  return [...snapshot.world.fields]
    .reverse()
    .find(
      (field) =>
        field.channels?.includes(String(data.channel)) &&
        areaSpace(snapshot.world, field.areaId) === areaSpace(snapshot.world, areaId) &&
        isDescendant(snapshot.world.areas, areaId, field.areaId) &&
        spatial.covers(snapshot.numerical[field.id].scope.footprint, point(data.center as Position))
    );
}

function impact(changes: ChangeSet): Proposal["impact"] {
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
export function previewCommand(id: string, command: Command): Proposal {
  const result = prepareCommand(id, command);
  return { candidate: result.candidate.world, impact: result.impact };
}
export function commitCommand(id: string, command: Command): Proposal {
  const result = prepareCommand(id, command);
  const recipe =
    command.kind === "instantiateTemplate"
      ? listTemplates().find((t) => t.id === command.data.templateId)?.recipe
      : null;
  requireThat(
    !recipe || !listJobs(id).some((job) => job.status === "running"),
    "generation_running",
    "Finish or cancel generation before placing a template with a generation recipe."
  );
  publish(id, result.candidate, command.kind, command.operationId);
  if (recipe) {
    const placed = result.changes.writes.find(
      (w) => w.kind === "area" && w.value.templateId === command.data.templateId
    );
    requireThat(placed, "template_area", "The placed template must have a located area.");
    startGeneration(id, {
      ...recipe,
      areaId: placed.value.id,
      expectedVersion: result.candidate.world.version,
      operationId: crypto.randomUUID(),
    });
  }
  return { candidate: result.candidate.world, impact: result.impact };
}
