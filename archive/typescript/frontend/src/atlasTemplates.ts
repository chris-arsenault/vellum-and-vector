import {
  requireThat,
  spatial,
  frameSchema,
  featureInputSchema,
  type Template,
  type DomainSnapshot,
  type IntentContext,
} from "@atlas/domain";
import { instantiateTemplate as placeTemplate } from "@atlas/application";
import { changed } from "./workspaceEvents";

// Independent template definitions belong to this tab; placed geography belongs to its map.
const library = new Map<string, Template>();
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
    requireThat(
      spatial.covers(
        spaces.get(feature.areaId)?.footprint ?? definition.footprint,
        feature.geometry
      ),
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
export function instantiateTemplate(
  source: DomainSnapshot,
  context: IntentContext,
  data: Record<string, unknown>
) {
  const definition = library.get(String(data.templateId));
  requireThat(definition, "template_version", "Choose the current template definition.");
  return placeTemplate(source, context, data, definition);
}
