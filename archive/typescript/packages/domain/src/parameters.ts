import { requireThat } from "./errors";
import type {
  ParameterDefinition,
  ParameterDefinitions,
  ParameterValues,
  Scalar,
  Value,
} from "./schemas";

function validType(definition: ParameterDefinition, value: Value): boolean {
  if (definition.type === "integer")
    return typeof value === "number" && Number.isSafeInteger(value);
  if (definition.type === "number") return typeof value === "number" && Number.isFinite(value);
  if (definition.type === "text" || definition.type === "resource")
    return typeof value === "string";
  if (definition.type === "enum") return definition.choices?.includes(value as Scalar) === true;
  return typeof value === "boolean";
}

function normalizedValue(key: string, definition: ParameterDefinition, value: Value): Value {
  if (value === null && definition.nullable === true) return null;
  if (definition.type === "record") {
    requireThat(
      isRecord(value) && definition.fields,
      "invalid_record_parameter",
      `${key} requires declared fields.`
    );
    return resolveParameters(definition.fields, value);
  }
  if (definition.type === "list") {
    requireThat(
      Array.isArray(value) && definition.items,
      "invalid_list_parameter",
      `${key} requires typed items.`
    );
    return value.map((item, index) => normalizedValue(`${key}[${index}]`, definition.items!, item));
  }
  requireThat(
    validType(definition, value),
    "invalid_parameter_type",
    `Parameter ${key} requires ${definition.type}.`
  );
  if (typeof value === "number") {
    requireThat(
      definition.minimum === undefined || value >= definition.minimum,
      "parameter_range",
      `${key} is below its minimum.`
    );
    requireThat(
      definition.maximum === undefined || value <= definition.maximum,
      "parameter_range",
      `${key} exceeds its maximum.`
    );
  }
  return value;
}

function isRecord(value: Value): value is ParameterValues {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mergeValue(definition: ParameterDefinition, previous: Value, next: Value): Value {
  if (definition.override === "merge" && isRecord(previous) && isRecord(next)) {
    requireThat(
      definition.fields,
      "missing_parameter_fields",
      "Merged settings require declared fields."
    );
    const merged = Object.assign(Object.create(null), previous) as ParameterValues;
    for (const [key, value] of Object.entries(next)) {
      requireThat(
        Object.hasOwn(definition.fields, key),
        "unknown_parameter",
        `Parameter ${key} is not declared.`
      );
      merged[key] = Object.hasOwn(merged, key)
        ? mergeValue(definition.fields[key], merged[key], value)
        : value;
    }
    return merged;
  }
  return next;
}

export function resolveParameters(
  definitions: ParameterDefinitions,
  ...overrides: ParameterValues[]
): ParameterValues {
  const values = Object.create(null) as ParameterValues;
  for (const [key, definition] of Object.entries(definitions)) {
    if (definition.default !== undefined) values[key] = definition.default;
  }
  for (const layer of overrides)
    for (const [key, value] of Object.entries(layer)) {
      requireThat(
        Object.hasOwn(definitions, key),
        "unknown_parameter",
        `Parameter ${key} is not declared.`
      );
      values[key] = Object.hasOwn(values, key)
        ? mergeValue(definitions[key], values[key], value)
        : value;
    }
  for (const [key, definition] of Object.entries(definitions)) {
    requireThat(
      !definition.required || Object.hasOwn(values, key),
      "missing_parameter",
      `Parameter ${key} is required.`
    );
    if (Object.hasOwn(values, key)) values[key] = normalizedValue(key, definition, values[key]);
  }
  return values;
}
