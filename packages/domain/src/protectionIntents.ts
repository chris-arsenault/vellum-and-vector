import { z } from "zod";
import { uuid } from "./authoringSchemas";
import { intentChanges, intentReads, type IntentRegistry } from "./intent";
import { requireThat } from "./errors";
import { representationId } from "./identity";

export function registerProtectionIntents(registry: IntentRegistry): void {
  registry.register({
    kind: "protectFeature",
    version: 1,
    description: "Set protection on an owning feature or one existing local representation.",
    schema: z.object({ featureId: uuid, areaId: uuid, protected: z.boolean() }),
    requirements: (data, context) =>
      intentReads(context, {
        objects: [
          { kind: "feature", ids: [data.featureId] },
          { kind: "area", ids: [data.areaId] },
        ],
        completeRepresentations: [data.featureId],
      }),
    evaluate(data, context, snapshot) {
      const source = snapshot.world.features[data.featureId];
      requireThat(
        source && data.areaId === context.scope.areaId,
        "feature_scope",
        "Select this feature through its owning or represented mapped area."
      );
      const changes = intentChanges(context, snapshot);
      if (source.areaId === data.areaId)
        changes.writes.push({ kind: "feature", value: { ...source, protected: data.protected } });
      else {
        const detail = source.detail[data.areaId];
        requireThat(
          detail,
          "missing_representation",
          "Materialize this local representation before setting its protection."
        );
        changes.writes.push({
          kind: "representation",
          value: {
            ...detail,
            id: detail.id ?? representationId(snapshot.world.id, source.id, data.areaId),
            featureId: source.id,
            areaId: data.areaId,
            protected: data.protected,
          },
        });
      }
      return changes;
    },
  });
  registry.register({
    kind: "renameArea",
    version: 1,
    description:
      "Rename a mapped area while retaining its geographic reference and inherited interfaces.",
    schema: z.object({ id: uuid, name: z.string().trim().min(1) }),
    requirements: (data, context) =>
      intentReads(context, { objects: [{ kind: "area", ids: [data.id] }] }),
    evaluate(data, context, snapshot) {
      const area = snapshot.world.areas[data.id];
      requireThat(
        area && area.id === context.scope.areaId,
        "area_scope",
        "Rename the selected mapped area."
      );
      const changes = intentChanges(context, snapshot);
      changes.writes.push({ kind: "area", value: { ...area, name: data.name } });
      return changes;
    },
  });
}
