import { sameValue, requireThat, semanticId, type DomainSnapshot } from "@atlas/domain";
import type { PublicationDefinition, FieldPublicationDefinition } from "./publication";

/** Canonical field identities and declarations; Rust writes the current resource format locally. */
export function rustOutputPlan(
  source: DomainSnapshot,
  publications: PublicationDefinition[],
  runId: string,
  seed: number
) {
  const world = source.world,
    definitions = new Map<string, FieldPublicationDefinition>();
  for (const definition of publications) {
    if (definition.kind !== "field") continue;
    const previous = definitions.get(definition.channel);
    requireThat(
      !previous || sameValue(previous, definition),
      "publication_channel",
      `Register one publication binding for channel ${definition.channel}.`
    );
    definitions.set(definition.channel, definition);
  }
  return {
    layoutId: `${runId}:layout:0`,
    surfaceId: semanticId(world.id, "surface", `${source.scope.areaId}:${seed}`),
    scope: source.scope,
    precision: world.reference.precision ?? 1e-6,
    channels: Object.fromEntries(
      [...definitions].map(([channel, definition]) => {
        const fieldId = semanticId(
            world.id,
            "atlas-field",
            `${source.scope.areaId}:${definition.layer.id}`
          ),
          existing = world.fields.find((field) => field.id === fieldId),
          publish =
            definition.publish !== false &&
            existing?.state !== "authored" &&
            existing?.state !== "protected";
        return [
          channel,
          {
            unit: definition.unit,
            quantity: definition.quantity,
            output: publish
              ? {
                  fieldId,
                  resourceId: semanticId(
                    world.id,
                    "atlas-samples",
                    `${runId}:${definition.layer.id}`
                  ),
                }
              : null,
          },
        ];
      })
    ),
  };
}
