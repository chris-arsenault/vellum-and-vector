import {
  parameterSchema,
  valueRecordSchema,
  type ParameterDefinition,
  type ParameterDefinitions,
  type Value,
} from "./schemas";
import type { Layer } from "./model";
import { DomainError, requireThat } from "./errors";
import { resolveParameters } from "./parameters";

function plain(value: object) {
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}
function flagged(problems: string[], path: string, value: unknown, stored: Value | undefined) {
  const found =
    typeof value === "number"
      ? String(value)
      : typeof value === "object" && value !== null
        ? `a ${value.constructor?.name ?? "non-plain object"}`
        : typeof value;
  problems.push(`${path || "attributes"} is ${found}`);
  return stored;
}
/**
 * The nearest storable value: non-finite numbers become null, undefined and functions are
 * omitted, maps, sets, typed arrays and other objects become plain records or lists. Each
 * change is recorded against its attribute path.
 */
export function storableValue(value: unknown, path: string, problems: string[]): Value | undefined {
  if (typeof value === "object" && value !== null) return storableObject(value, path, problems);
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number")
    return Number.isFinite(value) ? value : flagged(problems, path, value, null);
  return flagged(problems, path, value, typeof value === "bigint" ? Number(value) : undefined);
}
function storableObject(value: object, path: string, problems: string[]): Value {
  if (Array.isArray(value) || ArrayBuffer.isView(value) || value instanceof Set) {
    const list = Array.from(
      value as Iterable<unknown>,
      (item, i) => storableValue(item, `${path}[${i}]`, problems) ?? null
    );
    return Array.isArray(value) ? list : flagged(problems, path, value, list)!;
  }
  const entries =
    value instanceof Map
      ? Array.from(value, ([key, item]) => [String(key), item])
      : Object.entries(value);
  const record: Record<string, Value> = {};
  for (const [key, item] of entries) {
    const stored = storableValue(item, path ? `${path}.${key}` : key, problems);
    if (stored !== undefined) record[key] = stored;
  }
  return plain(value) ? record : flagged(problems, path, value, record)!;
}
/** An attribute record, or an error naming its owner and every value that cannot be stored. */
export function requireValueRecord(input: unknown, owner: string): Record<string, Value> {
  const problems: string[] = [],
    stored = storableValue(input, "", problems);
  if (!problems.length && stored && typeof stored === "object" && !Array.isArray(stored))
    return valueRecordSchema.parse(input);
  throw new DomainError(
    "invalid_attributes",
    `${owner} has attributes that cannot be stored: ${problems.join("; ") || `attributes is ${typeof stored}`}.`,
    { problems }
  );
}

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
  input: Record<string, unknown>,
  owner = "A feature"
): Record<string, Value> {
  const attributes = requireValueRecord(input, `${owner} on layer ${layer.id}`),
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
  features: Iterable<{
    id?: string;
    kind?: string;
    attributes: Record<string, unknown>;
    detail: Record<string, { attributes: Record<string, unknown> | null }>;
  }>,
  materializedFields: number
): void {
  layerAttributeDefinitions(next.schema);
  const retained =
    previous === undefined ||
    (previous.representations ?? [previous.representation]).every((r) =>
      (next.representations ?? [next.representation]).includes(r)
    );
  requireThat(
    retained || materializedFields === 0,
    "layer_representation",
    "A materialized layer keeps its vector, field or network representation."
  );
  for (const feature of features) {
    requireThat(
      retained,
      "layer_representation",
      "A materialized layer keeps its vector, field or network representation."
    );
    const owner = `The ${feature.kind ?? "feature"} ${feature.id ?? ""}`.trimEnd();
    validateLayerAttributes(next, feature.attributes, owner);
    for (const [areaId, detail] of Object.entries(feature.detail))
      if (detail.attributes)
        validateLayerAttributes(
          next,
          { ...feature.attributes, ...detail.attributes },
          `${owner} (detail in area ${areaId})`
        );
  }
}
