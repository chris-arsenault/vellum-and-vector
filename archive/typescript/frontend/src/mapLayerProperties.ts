import type { LayerCatalog } from "@atlas/map";

export function mapLayerProperties(schema: Record<string, unknown>): LayerCatalog["properties"] {
  const properties: LayerCatalog["properties"] = {
    name: { type: "string" },
    kind: { type: "string" },
  };
  for (const [key, spec] of Object.entries(schema))
    if (
      spec &&
      typeof spec === "object" &&
      "type" in spec &&
      (spec.type === "string" || spec.type === "number" || spec.type === "boolean")
    )
      properties[key] = { type: spec.type };
  return properties;
}
export function addMapProperties(
  properties: LayerCatalog["properties"],
  attributes: Record<string, unknown>
) {
  for (const [key, value] of Object.entries(attributes)) {
    const type = typeof value;
    if (type === "string" || type === "number" || type === "boolean") properties[key] = { type };
  }
}
