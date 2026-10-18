import {
  parameterSchema,
  valueRecordSchema,
  type ParameterDefinition,
  type ParameterDefinitions,
  type Value,
} from "./schemas";
import type { Layer } from "./model";
import { requireThat } from "./errors";
import { resolveParameters } from "./parameters";

function attributeDefinition(input: unknown): ParameterDefinition {
  const raw = valueRecordSchema.parse(input),
    type =
      raw.type === "string"
        ? "text"
        : raw.type === "object"
          ? "record"
          : raw.type === "array"
            ? "list"
            : raw.type;
  const nested = raw.fields ?? raw.properties;
  const fields =
    nested === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(valueRecordSchema.parse(nested)).map(([key, value]) => [
            key,
            attributeDefinition(value),
          ])
        );
  return parameterSchema.parse({
    ...raw,
    type,
    required: raw.required ?? false,
    unit: raw.unit ?? null,
    fields,
    items: raw.items === undefined ? undefined : attributeDefinition(raw.items),
  });
}
export function layerAttributeDefinitions(input: Record<string, unknown>): ParameterDefinitions {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, attributeDefinition(value)])
  );
}
export function validateLayerAttributes(
  layer: Layer,
  input: Record<string, unknown>
): Record<string, Value> {
  const attributes = valueRecordSchema.parse(input),
    result = Object.assign(Object.create(null), attributes) as Record<string, Value>;
  for (const [key, definition] of Object.entries(layerAttributeDefinitions(layer.schema))) {
    const resolved = resolveParameters(
      { [key]: definition },
      Object.hasOwn(attributes, key) ? { [key]: attributes[key] } : {}
    );
    if (Object.hasOwn(resolved, key)) result[key] = resolved[key];
  }
  return result;
}
export function validateLayerChange(
  previous: Layer | undefined,
  next: Layer,
  features: {
    attributes: Record<string, unknown>;
    detail: Record<string, { attributes: Record<string, unknown> | null }>;
  }[],
  materializedFields: number
): void {
  layerAttributeDefinitions(next.schema);
  requireThat(
    previous === undefined ||
      (previous.representations ?? [previous.representation]).every((r) =>
        (next.representations ?? [next.representation]).includes(r)
      ) ||
      (features.length === 0 && materializedFields === 0),
    "layer_representation",
    "A materialized layer keeps its vector, field or network representation."
  );
  for (const feature of features) {
    validateLayerAttributes(next, feature.attributes);
    for (const detail of Object.values(feature.detail))
      if (detail.attributes)
        validateLayerAttributes(next, { ...feature.attributes, ...detail.attributes });
  }
}
