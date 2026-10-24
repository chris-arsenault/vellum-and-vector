import {
  createIntentRegistry,
  combineChanges,
  stagedSnapshot,
  evaluateFeatures,
  requireThat,
  spatial,
  transformGeometry,
  toWorld,
  frameSchema,
  featureInputSchema,
  featureEditSchema,
  intentSchema,
  type Template,
  type DomainSnapshot,
  type IntentContext,
  type Frame,
  type ChangeSet,
} from "@atlas/domain";
import { changed, indexSnapshot } from "./atlasState";

const library = new Map<string, Template>();
const registry = createIntentRegistry();
export function listTemplates() {
  return [...library.values()];
}
export function saveTemplate(input: Template) {
  const definition = structuredClone(input);
  requireThat(
    definition.name.trim() && definition.parentProfiles.length,
    "template_name",
    "Name the template and declare a compatible parent."
  );
  frameSchema.parse(definition.frame);
  spatial.canonical(definition.footprint);
  const spaces = new Map((definition.spaces ?? []).map((s) => [s.id, s]));
  for (const feature of definition.features) {
    featureInputSchema.parse(feature);
    const footprint = spaces.get(feature.areaId)?.footprint ?? definition.footprint;
    requireThat(
      spatial.covers(footprint, feature.geometry),
      "template_extent",
      "Template content must lie within its local footprint."
    );
  }
  const ids = definition.features.map((f) => f.id);
  requireThat(
    new Set(ids).size === ids.length,
    "template_identity",
    "Each template feature needs a unique identity."
  );
  definition.version = (library.get(input.id)?.version ?? 0) + 1;
  library.set(definition.id, definition);
  changed("templates");
  return definition;
}

function composeFrames(outer: Frame, inner: Frame): Frame {
  return {
    origin: toWorld(outer, inner.origin),
    rotation: outer.rotation + inner.rotation,
    metresPerUnit: outer.metresPerUnit * inner.metresPerUnit,
    floor: inner.floor ?? outer.floor,
  };
}
function operation(
  snapshot: DomainSnapshot,
  context: IntentContext,
  kind: string,
  data: Record<string, unknown>
) {
  return registry
    .bind(
      intentSchema.parse({
        operationId: context.operationId,
        expectedVersion: snapshot.world.version,
        scope: context.scope,
        version: 1,
        kind,
        data,
      }),
      context
    )
    .evaluate(snapshot);
}
interface InstanceLayout {
  definition: Template;
  frame: Frame;
  parentId: string;
  name: string;
  contextFeatureId: string | null;
  bindings: Record<string, string>;
}
export function instantiateTemplate(
  source: DomainSnapshot,
  context: IntentContext,
  data: Record<string, unknown>
) {
  const definition = library.get(String(data.templateId));
  requireThat(
    definition && definition.version === data.definitionVersion,
    "template_version",
    "Choose the current template definition."
  );
  const layout: InstanceLayout = {
    definition,
    frame: frameSchema.parse(data.frame),
    parentId: String(data.parentId),
    name: String(data.name),
    contextFeatureId: data.contextFeatureId as string | null,
    bindings: (data.bindings ?? {}) as Record<string, string>,
  };
  validatePlacement(source, layout);
  const parts: ChangeSet[] = [];
  let snapshot = source;
  const append = (part: ChangeSet) => {
    parts.push(part);
    snapshot = indexSnapshot(stagedSnapshot(snapshot, part));
  };
  const entityIds = insertTemplateSemantics(definition, () => snapshot, context, append);
  const rootFrame = composeFrames(layout.frame, definition.frame);
  const rootId = crypto.randomUUID();
  append(
    createInstanceArea(
      snapshot,
      context,
      layout,
      rootId,
      rootFrame,
      definition.footprint,
      layout.name
    )
  );
  const areas = new Map<string, { id: string; frame: Frame }>();
  for (const space of definition.spaces ?? []) {
    const id = crypto.randomUUID(),
      frame = composeFrames(rootFrame, space.frame);
    append(
      createInstanceArea(
        snapshot,
        context,
        layout,
        id,
        frame,
        space.footprint,
        `${layout.name} · ${space.name}`
      )
    );
    areas.set(space.id, { id, frame });
  }
  const featureIds = new Map(definition.features.map((f) => [f.id, crypto.randomUUID()]));
  insertTemplateFeatures(
    snapshot,
    context,
    { definition, rootId, rootFrame, areas, featureIds, entityIds },
    append
  );
  bindSockets(snapshot, layout, featureIds, parts);
  return combineChanges(context, source, parts);
}
interface PlacedFeatures {
  definition: Template;
  rootId: string;
  rootFrame: Frame;
  areas: Map<string, { id: string; frame: Frame }>;
  featureIds: Map<string, string>;
  entityIds: Map<string, string>;
}
function insertTemplateFeatures(
  initial: DomainSnapshot,
  context: IntentContext,
  placement: PlacedFeatures,
  append: (part: ChangeSet) => void
) {
  const { definition, rootId, rootFrame, areas, featureIds, entityIds } = placement;
  let snapshot = initial;
  const groups = new Map<string, Template["features"]>();
  for (const feature of definition.features) {
    const space = areas.get(feature.areaId) ?? { id: rootId, frame: rootFrame };
    const placed = {
      ...feature,
      id: featureIds.get(feature.id)!,
      areaId: space.id,
      geometry: transformGeometry(feature.geometry, space.frame),
      ...(feature.footprint
        ? { footprint: transformGeometry(feature.footprint, space.frame) }
        : {}),
      relations: feature.relations.map((r) => ({
        ...r,
        targetId: featureIds.get(r.targetId) ?? entityIds.get(r.targetId) ?? r.targetId,
      })),
    };
    groups.set(space.id, [...(groups.get(space.id) ?? []), placed]);
  }
  for (const [areaId, features] of groups) {
    const area = snapshot.world.areas[areaId];
    const scope = { ...context.scope, areaId, spaceId: area.spaceId!, footprint: area.footprint };
    const changes = evaluateFeatures(
      features.map((feature) => featureEditSchema.parse({ areaId, feature })),
      { ...context, scope },
      { ...snapshot, scope }
    );
    append(changes);
    snapshot = indexSnapshot(stagedSnapshot(snapshot, changes));
  }
}
function validatePlacement(source: DomainSnapshot, layout: InstanceLayout) {
  const { definition } = layout;
  const parent = source.world.areas[layout.parentId];
  requireThat(
    parent && definition.parentProfiles.includes(parent.profile),
    "template_parent",
    `This template requires a ${definition.parentProfiles.join(" / ")} parent.`
  );
  const contextFeature = Object.values(source.world.features).find(
    (feature) => feature.id === layout.contextFeatureId
  );
  if (definition.requirements?.contextKinds?.length)
    requireThat(
      contextFeature && definition.requirements.contextKinds.includes(contextFeature.kind),
      "template_context",
      "Select a compatible building footprint before placing this template."
    );
}
function insertTemplateSemantics(
  definition: Template,
  current: () => DomainSnapshot,
  context: IntentContext,
  append: (part: ChangeSet) => void
) {
  for (const layer of definition.layers ?? [])
    if (!current().world.layers[layer.id])
      append(operation(current(), context, "putLayer", { ...layer }));
  const ids = new Map((definition.entities ?? []).map((e) => [e.id, crypto.randomUUID()]));
  for (const entity of definition.entities ?? [])
    append(
      operation(current(), context, "putEntity", {
        ...entity,
        id: ids.get(entity.id),
        relations: (entity.relations ?? []).map((r) => ({
          ...r,
          targetId: ids.get(r.targetId) ?? r.targetId,
        })),
      })
    );
  return ids;
}
function createInstanceArea(
  snapshot: DomainSnapshot,
  context: IntentContext,
  layout: InstanceLayout,
  id: string,
  frame: Frame,
  footprint: Template["footprint"],
  name: string
) {
  const part = operation(snapshot, context, "createArea", {
    id,
    parentId: layout.parentId,
    name,
    profile: layout.definition.profile,
    frame,
    footprint: transformGeometry(footprint, frame),
    approach: "manual",
    layers: ["structures", "pois"],
    traits: layout.definition.traits,
    context: "structure",
    contextFeatureId: layout.contextFeatureId,
    createEntrance: true,
  });
  for (const write of part.writes)
    if (write.kind === "area" && write.value.id === id)
      write.value.templateId = layout.definition.id;
  return part;
}
function bindSockets(
  snapshot: DomainSnapshot,
  layout: InstanceLayout,
  featureIds: Map<string, string>,
  parts: ChangeSet[]
) {
  for (const socket of layout.definition.sockets ?? []) {
    const target = socketTarget(layout, socket, featureIds);
    requireThat(
      !socket.required || target,
      "template_socket",
      "Select an access feature to bind the template's required entrance."
    );
    if (!target) continue;
    const a = snapshot.world.features[featureIds.get(socket.featureId)!],
      b = snapshot.world.features[target];
    requireThat(
      a?.geometry.type === "Point" && b?.geometry.type === "Point",
      "template_socket",
      "Access sockets must connect located point features."
    );
    requireThat(
      spatial.distance(a.geometry, b.geometry) <= (snapshot.world.reference.precision ?? 1e-6),
      "template_alignment",
      "Align the template door or stairs with the selected access feature."
    );
    const part = {
      ...parts[0],
      writes: [],
      removes: [],
      invalidations: [],
      fieldArtifacts: [],
    } as ChangeSet;
    part.writes.push({
      kind: "connection",
      value: {
        id: crypto.randomUUID(),
        kind: socket.kind,
        a: {
          areaId: a.areaId,
          featureId: a.id,
          position: {
            x: a.geometry.coordinates[0],
            y: a.geometry.coordinates[1],
            z: snapshot.world.areas[a.areaId].frame.origin.z,
          },
        },
        b: {
          areaId: b.areaId,
          featureId: b.id,
          position: {
            x: b.geometry.coordinates[0],
            y: b.geometry.coordinates[1],
            z: snapshot.world.areas[b.areaId].frame.origin.z,
          },
        },
        flow: 0,
      },
    });
    parts.push(part);
  }
}
function socketTarget(
  layout: InstanceLayout,
  socket: NonNullable<Template["sockets"]>[number],
  featureIds: Map<string, string>
) {
  return (
    layout.bindings[socket.id] ??
    (socket.connectsTo ? featureIds.get(socket.connectsTo) : undefined)
  );
}
