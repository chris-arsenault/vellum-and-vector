import {
  layerSupports,
  profiles,
  requireThat,
  sameValue,
  semanticId,
  storableValue,
  validateCoverage,
  validateLayerChange,
  type Diagnostic,
  type DomainSnapshot,
  type AtlasFeature,
  type Grid,
  type Layer,
} from "@atlas/domain";
import type { GenerationState } from "./process";

interface PublicationBase {
  layer: Layer;
  owners?: readonly string[];
  /** An inactive registered product can remain an inherited/working input. */
  publish?: boolean;
}
export interface FieldPublicationDefinition extends PublicationBase {
  kind: "field";
  channel: string;
  unit: string;
  quantity: "intensive" | "extensive" | "category";
}
export interface GeographyPublicationDefinition extends PublicationBase {
  kind: "geography";
  featureKinds: string[];
  network?: boolean;
}
export type PublicationDefinition = FieldPublicationDefinition | GeographyPublicationDefinition;

/** Register candidate layer metadata before extractors validate geographic output. */
export function preparePublicationLayers(
  snapshot: DomainSnapshot,
  definitions: PublicationDefinition[],
  areaId: string
) {
  const area = snapshot.world.areas[areaId];
  requireThat(area, "publication_area", "Bind publication to an existing mapped area.");
  checkLayerDefinitions(definitions);
  fieldDefinitions(definitions);
  for (const definition of definitions)
    if (definition.publish !== false && definition.layer.profiles.includes(area.profile))
      installLayer(snapshot, definition.layer, areaId);
}

/** Module-owned output bindings cross the worker boundary as plain data. */
export function publishGenerationProducts(
  state: Pick<GenerationState, "domain" | "surface" | "publications">,
  runId: string,
  original?: DomainSnapshot,
  diagnostics: Diagnostic[] = []
) {
  const definitions = state.publications ?? [];
  repairGeneratedAttributes(state.domain, diagnostics);
  checkLayerDefinitions(definitions);
  validateCandidateBindings(state.domain, definitions, original);
  const layers = publishFields(state.domain, state.surface, definitions, runId);
  for (const definition of definitions) {
    if (definition.kind !== "geography" || definition.publish === false) continue;
    const features = Object.values(state.domain.world.features).filter(
      (feature) =>
        feature.areaId === state.surface.scope.areaId &&
        feature.state === "generated" &&
        feature.layerId === definition.layer.id &&
        definition.featureKinds.includes(feature.kind)
    );
    if (!features.length) continue;
    validateGeographicRepresentation(state.domain, definition, features);
    installLayer(state.domain, definition.layer, state.surface.scope.areaId);
    layers.add(definition.layer.id);
  }
  for (const layer of layers) publishCoverage(state.domain, state.surface, layer, runId);
  return layers;
}

/**
 * A generator value that cannot be stored (NaN, a Map, a typed array) becomes its nearest
 * storable value with a warning, so one faulty attribute does not discard the whole run.
 */
function repairGeneratedAttributes(snapshot: DomainSnapshot, diagnostics: Diagnostic[]) {
  for (const feature of Object.values(snapshot.world.features)) {
    if (feature.areaId !== snapshot.scope.areaId || feature.state !== "generated") continue;
    const problems: string[] = [];
    feature.attributes = storableValue(
      feature.attributes,
      "",
      problems
    ) as AtlasFeature["attributes"];
    for (const detail of Object.values(feature.detail))
      if (detail.attributes)
        detail.attributes = storableValue(
          detail.attributes,
          "",
          problems
        ) as AtlasFeature["attributes"];
    if (problems.length)
      diagnostics.push({
        code: "repaired_attributes",
        message: `The ${feature.kind} ${feature.name} (${feature.id}) stored repaired attributes: ${problems.join("; ")}.`,
        severity: "warning",
        invocation: null,
        resource: feature.id,
      });
  }
}

function validateGeographicRepresentation(
  snapshot: DomainSnapshot,
  definition: GeographyPublicationDefinition,
  features: AtlasFeature[]
) {
  const representation = definition.network ? "network" : "vector";
  requireThat(
    layerSupports(definition.layer, representation),
    "publication_representation",
    `Layer ${definition.layer.id} must support ${representation} outputs.`
  );
  if (!definition.network) return;
  for (const feature of features) {
    const reach = Object.values(snapshot.world.networkReaches ?? {}).find(
      (reach) => reach.featureId === feature.id
    );
    requireThat(
      reach && snapshot.world.networkNodes?.[reach.start] && snapshot.world.networkNodes[reach.end],
      "publication_network",
      `Publish ${feature.id} with its network reach and endpoint nodes.`
    );
  }
}

function validateCandidateBindings(
  snapshot: DomainSnapshot,
  definitions: PublicationDefinition[],
  original?: DomainSnapshot
) {
  for (const feature of Object.values(snapshot.world.features)) {
    if (
      feature.areaId !== snapshot.scope.areaId ||
      feature.state !== "generated" ||
      sameValue(original?.world.features[feature.id], feature)
    )
      continue;
    requireThat(
      definitions.some(
        (definition) =>
          definition.kind === "geography" &&
          definition.publish !== false &&
          definition.layer.id === feature.layerId &&
          definition.featureKinds.includes(feature.kind)
      ),
      "unregistered_product",
      `Register an output binding for ${feature.kind} on ${feature.layerId}.`
    );
  }
}

function checkLayerDefinitions(definitions: PublicationDefinition[]) {
  const layers = new Map<string, Layer>();
  for (const definition of definitions) {
    const previous = layers.get(definition.layer.id);
    requireThat(
      !previous || sameValue(previous, definition.layer),
      "publication_layer",
      `Register one compatible definition for layer ${definition.layer.id}.`
    );
    layers.set(definition.layer.id, definition.layer);
  }
}

function fieldDefinitions(definitions: PublicationDefinition[]) {
  const fields = new Map<string, FieldPublicationDefinition>();
  for (const definition of definitions) {
    if (definition.kind !== "field") continue;
    const previous = fields.get(definition.channel);
    requireThat(
      !previous || sameValue(previous, definition),
      "publication_channel",
      `Register one publication binding for channel ${definition.channel}.`
    );
    fields.set(definition.channel, definition);
  }
  return fields;
}

function fieldGroups(grid: Grid, definitions: PublicationDefinition[]) {
  const fields = fieldDefinitions(definitions),
    groups = new Map<string, { layer: Layer; channels: string[] }>();
  for (const channel of Object.keys(grid.channels)) {
    const definition = fields.get(channel);
    requireThat(definition, "unregistered_product", `Register an output binding for ${channel}.`);
    requireThat(
      grid.units[channel] === definition.unit,
      "publication_unit",
      `${channel} requires ${definition.unit}; received ${grid.units[channel]}.`
    );
    const quantity =
      grid.quantities?.[channel] ?? (grid.units[channel] === "category" ? "category" : "intensive");
    requireThat(
      quantity === definition.quantity,
      "publication_quantity",
      `${channel} requires ${definition.quantity} quantities; received ${quantity}.`
    );
    if (definition.publish === false) continue;
    const group = groups.get(definition.layer.id) ?? { layer: definition.layer, channels: [] };
    group.channels.push(channel);
    groups.set(definition.layer.id, group);
  }
  return groups;
}

function installLayer(snapshot: DomainSnapshot, definition: Layer, areaId: string) {
  const world = snapshot.world,
    area = world.areas[areaId],
    previous = world.layers[definition.id];
  requireThat(
    definition.profiles.includes(area.profile),
    "publication_profile",
    `${definition.name} does not support ${area.profile}.`
  );
  if (!previous) {
    validateLayerChange(undefined, definition, [], 0);
    world.layers[definition.id] = structuredClone(definition);
    return;
  }
  requireThat(
    previous.profiles.includes(area.profile),
    "publication_profile",
    `Layer ${definition.id} must support ${area.profile}.`
  );
  requireThat(
    previous.family === definition.family &&
      previous.generator === definition.generator &&
      sameValue(previous.schema, definition.schema),
    "publication_layer",
    `Layer ${definition.id} must retain its registered family, generator and attribute schema.`
  );
  const next = {
    ...previous,
    facts: [...new Set([...(previous.facts ?? []), ...(definition.facts ?? [])])],
    representations: [
      ...new Set([
        ...(previous.representations ?? [
          previous.representation as "field" | "vector" | "network",
        ]),
        ...(definition.representations ?? [
          definition.representation as "field" | "vector" | "network",
        ]),
      ]),
    ],
  };
  validateLayerChange(
    previous,
    next,
    Object.values(world.features).filter((feature) => feature.layerId === definition.id),
    world.fields.filter((field) => field.layerId === definition.id).length
  );
  world.layers[definition.id] = next;
}

function publishFields(
  snapshot: DomainSnapshot,
  grid: Grid,
  definitions: PublicationDefinition[],
  runId: string
) {
  const layers = new Set<string>();
  for (const { layer, channels } of fieldGroups(grid, definitions).values()) {
    const fieldId = semanticId(
        snapshot.world.id,
        "atlas-field",
        `${grid.scope.areaId}:${layer.id}`
      ),
      existing = snapshot.world.fields.find((field) => field.id === fieldId);
    if (existing?.state === "authored" || existing?.state === "protected") continue;
    installLayer(snapshot, layer, grid.scope.areaId);
    requireThat(
      layerSupports(snapshot.world.layers[layer.id], "field"),
      "publication_representation",
      `Layer ${layer.id} must support numerical fields.`
    );
    publishField(snapshot, grid, layer.id, channels, fieldId, runId);
    layers.add(layer.id);
  }
  return layers;
}

function publishField(
  snapshot: DomainSnapshot,
  grid: Grid,
  layerId: string,
  channels: string[],
  fieldId: string,
  runId: string
) {
  const world = snapshot.world,
    resourceId = semanticId(world.id, "atlas-samples", `${runId}:${layerId}`);
  world.fields = [
    ...world.fields.filter((field) => field.id !== fieldId),
    {
      id: fieldId,
      areaId: grid.scope.areaId,
      layerId,
      algorithm: "generation",
      source: { kind: "run", id: runId },
      samples: grid.active.length,
      channels,
      resourceId,
      state: "generated",
      footprint: grid.scope.footprint,
      spaceId: grid.scope.spaceId,
    },
  ];
  snapshot.numerical[fieldId] = {
    ...grid,
    id: resourceId,
    channels: Object.fromEntries(channels.map((channel) => [channel, grid.channels[channel]])),
    units: Object.fromEntries(channels.map((channel) => [channel, grid.units[channel]])),
    quantities: Object.fromEntries(
      channels.map((channel) => [
        channel,
        grid.quantities?.[channel] ??
          (grid.units[channel] === "category" ? "category" : "intensive"),
      ])
    ),
    overlays: snapshot.numerical[fieldId]?.overlays,
  };
  world.layers[layerId].facts = [...new Set([...(world.layers[layerId].facts ?? []), ...channels])];
}

function publishCoverage(snapshot: DomainSnapshot, grid: Grid, layerId: string, runId: string) {
  const world = snapshot.world,
    area = world.areas[grid.scope.areaId];
  const coverage = {
    id: semanticId(world.id, "generated-coverage", `${area.id}:${layerId}`),
    areaId: area.id,
    spaceId: grid.scope.spaceId,
    layerId,
    detailRank: profiles.indexOf(area.profile),
    resolution: grid.scope.resolution ?? null,
    time: "present",
    footprint: grid.scope.footprint,
    state: "generated" as const,
    resourceId: grid.id,
    generationId: runId,
  };
  validateCoverage(
    world,
    coverage,
    snapshot.coverage.filter((entry) => entry.id !== coverage.id)
  );
  snapshot.coverage = [...snapshot.coverage.filter((entry) => entry.id !== coverage.id), coverage];
  area.layers[layerId] = "generated";
}
