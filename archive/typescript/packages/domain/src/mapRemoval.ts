import { z } from "zod";
import { uuid } from "./authoringSchemas";
import { type IntentRegistry, intentChanges, intentReads } from "./intent";
import { presentAtlasFeature } from "./featureReads";
import { writeMapRepresentation } from "./mapRouteEdits";
import { requireThat } from "./errors";

/** Hiding a source feature is a mapped structural edit, never deletion of procedural context. */
export function registerMapRemovalIntents(registry: IntentRegistry) {
  registry.register({
    kind: "deleteMapFeature",
    version: 1,
    description: "Remove a feature from this drawing while retaining its procedural source.",
    schema: z.object({ areaId: uuid, featureId: uuid }),
    requirements: (data, context) =>
      intentReads(context, {
        objects: [
          { kind: "feature", ids: [data.featureId] },
          { kind: "area", ids: [data.areaId] },
        ],
        completeRepresentations: [data.featureId],
      }),
    evaluate(data, context, snapshot) {
      const source = snapshot.world.features[data.featureId],
        area = snapshot.world.areas[data.areaId];
      requireThat(
        source && area && context.scope.areaId === area.id,
        "missing_feature",
        "Choose a feature on this map."
      );
      const drawing = presentAtlasFeature(snapshot.world, source, area.id);
      requireThat(drawing, "missing_feature", "Choose a visible feature on this map.");
      requireThat(
        !Object.values(snapshot.world.features).some(
          (feature) =>
            feature.id !== source.id &&
            feature.relations.some((relation) => relation.targetId === source.id)
        ) &&
          !Object.values(snapshot.world.connections ?? {}).some(
            (connection) =>
              connection.a.featureId === source.id || connection.b.featureId === source.id
          ),
        "attached_feature",
        "Remove the feature's relationships and connections before deleting it."
      );
      requireThat(
        !Object.values(snapshot.world.areas).some(
          (mapped) =>
            mapped.contextFeatureId === source.id ||
            mapped.boundary?.crossings.some((crossing) => crossing.featureId === source.id)
        ),
        "locked_boundary",
        "This feature anchors a mapped area or boundary and must be retained."
      );
      const changes = intentChanges(context, snapshot);
      writeMapRepresentation(snapshot, changes, area, source, drawing, context.actor);
      for (const write of changes.writes)
        if (write.kind === "representation") write.value.state = "intentionallyEmpty";
      return changes;
    },
  });
}
