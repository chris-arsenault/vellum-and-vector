import { z } from "zod";
import { finite, geometrySchema } from "./schemas";
import { uuid } from "./authoringSchemas";
import { intentReads, intentChanges, type IntentContext, type IntentRegistry } from "./intent";
import type { DomainSnapshot } from "./operations";
import { requireThat } from "./errors";
import { requireIdentity, invalidateFacts } from "./authoringBasics";
import { spatial } from "./spatial";
import {
  landmarkFootprint,
  landmarkKind,
  validateLandmarkParameters,
  type Landmark,
} from "./landmarks";

const landmarkSchema = z.object({
  id: uuid,
  name: z.string().trim().min(1),
  kind: z.string().min(1),
  geometry: geometrySchema,
  parameters: z.record(z.string(), finite),
  emplacedAtEpoch: z.number().int().nonnegative().default(0),
  origin: z.enum(["generated", "authored"]).optional(),
});
/** Facts a landmark's causes feed; the dependency graph carries them to climate, water and society. */
const landmarkFacts = (id: string) => [`landmark:${id}`, "landmark", "elevation", "geology"];

type LandmarkInput = z.infer<typeof landmarkSchema>;

function validateLandmark(data: LandmarkInput, context: IntentContext, snapshot: DomainSnapshot) {
  requireIdentity(snapshot, data.id, "landmark");
  const kind = landmarkKind(data.kind);
  requireThat(kind, "landmark_kind", "Choose a landmark kind from the catalogue.");
  requireThat(
    data.geometry.type === kind.geometry,
    "landmark_geometry",
    kind.geometry === "Point"
      ? `${kind.label} is placed at a point.`
      : `${kind.label} follows a drawn line.`
  );
  validateLandmarkParameters(kind, data.parameters);
  requireThat(
    data.emplacedAtEpoch < snapshot.world.epochs.length,
    "landmark_epoch",
    "Choose one of this world's epochs for the landmark to form in."
  );
  requireThat(
    spatial.covers(context.scope.footprint, data.geometry),
    "landmark_location",
    "Place the landmark in the selected geographic extent."
  );
}

export function registerLandmarkIntents(registry: IntentRegistry): void {
  registry.register({
    kind: "putLandmark",
    version: 1,
    description:
      "Author a major landmark whose causes are injected at an epoch and whose measures are maintained.",
    schema: landmarkSchema,
    requirements: (data, context) =>
      intentReads(context, { objects: [{ kind: "landmark", ids: [data.id] }] }),
    evaluate(data, context, snapshot) {
      validateLandmark(data, context, snapshot);
      const landmark: Landmark = {
        ...data,
        areaId: context.scope.areaId,
        spaceId: context.scope.spaceId,
      };
      const changes = intentChanges(context, snapshot);
      changes.writes.push({ kind: "landmark", value: landmark });
      const previous = snapshot.world.landmarks.find((l) => l.id === data.id);
      if (previous)
        invalidateFacts(
          changes,
          context,
          snapshot,
          landmarkFacts(data.id),
          landmarkFootprint(previous)
        );
      invalidateFacts(
        changes,
        context,
        snapshot,
        landmarkFacts(data.id),
        landmarkFootprint(landmark)
      );
      return changes;
    },
  });
  registry.register({
    kind: "removeLandmark",
    version: 1,
    description: "Remove an authored landmark and invalidate the geography its causes shaped.",
    schema: z.object({ id: uuid }),
    requirements: (data, context) =>
      intentReads(context, { objects: [{ kind: "landmark", ids: [data.id] }] }),
    evaluate(data, context, snapshot) {
      const landmark = snapshot.world.landmarks.find((l) => l.id === data.id);
      requireThat(landmark, "missing_landmark", "Choose an existing landmark.");
      const changes = intentChanges(context, snapshot);
      changes.removes.push({ kind: "landmark", id: data.id });
      // A magic landmark's injected source goes with it.
      for (const source of snapshot.world.magic)
        if (source.landmarkId === data.id) changes.removes.push({ kind: "magic", id: source.id });
      invalidateFacts(
        changes,
        context,
        snapshot,
        landmarkFacts(data.id),
        landmarkFootprint(landmark)
      );
      return changes;
    },
  });
}
