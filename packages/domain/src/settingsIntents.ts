import { z } from "zod";
import { finite, positionSchema, geometrySchema } from "./schemas";
import { uuid } from "./authoringSchemas";
import { intentReads, intentChanges, type IntentRegistry } from "./intent";
import { requireThat } from "./errors";
import { requireIdentity, requireRelations, invalidateFacts } from "./authoringBasics";
import { spatial, point } from "./spatial";
import type { World } from "./model";
import { registerMagicSystemIntents } from "./magicSystemIntents";
import { rasterPresentationSchema, symbolStyleSchema } from "./viewSchemas";

const magicSchema = z.object({
  systemId: z.string().min(1).optional(),
  id: uuid,
  name: z.string().trim().min(1),
  source: positionSchema,
  radius: finite.positive(),
  strength: finite,
  propagation: z.enum(["radial", "fracture", "cold", "ocean", "advect"]),
  effect: z.enum([
    "heat",
    "cold",
    "pressure",
    "uplift",
    "erosionResistance",
    "gravity",
    "fertility",
    "luminous",
  ]),
  decay: finite.min(0).max(1),
  storage: finite.nonnegative(),
  dependsOn: z.array(uuid).nullable().default(null),
  startsAtEpoch: z.number().int().nonnegative().default(0),
  scope: geometrySchema.optional(),
});
const styleSchema = z.object({
  symbols: symbolStyleSchema.optional(),
  layerId: z.string().min(1),
  visible: z.boolean(),
  opacity: finite.min(0).max(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  minScale: finite.nonnegative(),
  labels: z.boolean().default(true),
  filter: z.string().nullable().default(null),
});
const viewSchema = z.object({
  id: uuid,
  name: z.string().trim().min(1),
  areaId: uuid,
  layers: z.array(styleSchema),
  raster: rasterPresentationSchema.optional(),
});

function validateMagicGraph(values: World["magic"]) {
  const byId = new Map(values.map((m) => [m.id, m])),
    done = new Set<string>();
  const visit = (id: string, path: Set<string>) => {
    requireThat(
      !path.has(id),
      "magic_cycle",
      "Magical source dependencies must form an acyclic configuration; interactions run through workflow feedback."
    );
    if (done.has(id)) return;
    const source = byId.get(id);
    requireThat(
      source,
      "missing_magic_dependency",
      "Every magical source dependency resolves in this world."
    );
    for (const next of source.dependsOn ?? []) visit(next, new Set([...path, id]));
    done.add(id);
  };
  for (const source of values) visit(source.id, new Set());
}
function registerMagic(registry: IntentRegistry) {
  registry.register({
    kind: "putMagicSource",
    version: 1,
    description: "Author a declarative magical source that participates in causal generation.",
    schema: magicSchema,
    requirements: (data, context) =>
      intentReads(context, {
        objects: [{ kind: "magic", ids: [data.id] }],
        references: data.dependsOn ?? [],
      }),
    evaluate(data, context, snapshot) {
      requireIdentity(snapshot, data.id, "magic");
      requireRelations(snapshot, data.dependsOn ?? [], [data.id]);
      requireThat(
        spatial.covers(context.scope.footprint, point(data.source)),
        "magic_location",
        "Place the magical source in the selected geographic extent."
      );
      const influence = data.scope ?? spatial.buffer(point(data.source), data.radius)!;
      const source = {
        ...data,
        scope: influence,
        areaId: context.scope.areaId,
        spaceId: context.scope.spaceId,
      };
      validateMagicGraph([...snapshot.world.magic.filter((m) => m.id !== data.id), source]);
      const changes = intentChanges(context, snapshot);
      changes.writes.push({ kind: "magic", value: source });
      const previous = snapshot.world.magic.find((m) => m.id === data.id);
      if (previous)
        invalidateFacts(
          changes,
          context,
          snapshot,
          [`magic:${data.id}`, "magic", previous.effect],
          previous.scope ?? spatial.buffer(point(previous.source), previous.radius)!
        );
      invalidateFacts(
        changes,
        context,
        snapshot,
        [`magic:${data.id}`, "magic", source.effect],
        influence
      );
      return changes;
    },
  });
}
function registerRemoveMagic(registry: IntentRegistry) {
  registry.register({
    kind: "removeMagicSource",
    version: 1,
    description:
      "Remove a current magical source and invalidate its dependent effects while retaining history.",
    schema: z.object({ id: uuid }),
    requirements: (data, context) =>
      intentReads(context, { objects: [{ kind: "magic", ids: [data.id] }] }),
    evaluate(data, context, snapshot) {
      const source = snapshot.world.magic.find((m) => m.id === data.id);
      requireThat(source, "missing_magic_source", "Choose an existing magical source.");
      requireThat(
        !snapshot.world.magic.some((m) => m.dependsOn?.includes(data.id)),
        "magic_dependency",
        "Update dependent source definitions before removing their input."
      );
      const changes = intentChanges(context, snapshot);
      changes.removes.push({ kind: "magic", id: data.id });
      invalidateFacts(
        changes,
        context,
        snapshot,
        [`magic:${data.id}`, "magic", source.effect],
        source.scope ?? spatial.buffer(point(source.source), source.radius)!
      );
      return changes;
    },
  });
}
function registerViews(registry: IntentRegistry) {
  registry.register({
    kind: "putView",
    version: 1,
    description: "Save a geographic presentation of shared world layers.",
    schema: viewSchema,
    requirements: (data, context) =>
      intentReads(context, {
        objects: [
          { kind: "view", ids: [data.id] },
          { kind: "area", ids: [data.areaId] },
        ],
      }),
    evaluate(data, context, snapshot) {
      requireIdentity(snapshot, data.id, "view");
      requireThat(
        snapshot.world.areas[data.areaId],
        "missing_area",
        "A view requires a mapped area."
      );
      requireThat(
        new Set(data.layers.map((s) => s.layerId)).size === data.layers.length,
        "view_layer",
        "Each layer has one style in a view."
      );
      requireThat(
        data.layers.every((s) => Object.hasOwn(snapshot.world.layers, s.layerId)),
        "missing_layer",
        "View styles refer to registered layers."
      );
      const changes = intentChanges(context, snapshot);
      changes.writes.push({ kind: "view", value: data });
      return changes;
    },
  });
  registry.register({
    kind: "removeView",
    version: 1,
    description: "Remove a saved view without altering its shared geographic data.",
    schema: z.object({ id: uuid }),
    requirements: (data, context) =>
      intentReads(context, { objects: [{ kind: "view", ids: [data.id] }] }),
    evaluate(data, context, snapshot) {
      requireThat(
        snapshot.world.views.some((v) => v.id === data.id),
        "missing_view",
        "Choose a saved view."
      );
      const changes = intentChanges(context, snapshot);
      changes.removes.push({ kind: "view", id: data.id });
      return changes;
    },
  });
}
export function registerSettingsIntents(registry: IntentRegistry): void {
  registerMagicSystemIntents(registry);
  registerMagic(registry);
  registerRemoveMagic(registry);
  registerViews(registry);
  registry.register({
    kind: "setWorldSettings",
    version: 1,
    description:
      "Set the world name and seed for future generation while retaining completed history.",
    schema: z.object({
      name: z.string().trim().min(1),
      seed: z.number().int().min(-2147483648).max(2147483647),
    }),
    requirements: (_data, context) => intentReads(context),
    evaluate(data, context, snapshot) {
      const changes = intentChanges(context, snapshot);
      changes.worldMetadata = {
        ...data,
        epochs: snapshot.world.epochs,
        humanEras: snapshot.world.humanEras,
      };
      changes.highImpact = data.seed !== snapshot.world.seed;
      return changes;
    },
  });
}
