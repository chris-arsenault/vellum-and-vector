import { z } from "zod";
import { intentReads, intentChanges, type IntentRegistry } from "./intent";
import { magicSystemSchema, validateMagicSystems } from "./magicSystems";
import {
  canonryConfluencePresets,
  magicConfluenceSchema,
  validateMagicConfluences,
} from "./magicConfluences";
import { invalidateFacts } from "./authoringBasics";

export function registerMagicSystemIntents(registry: IntentRegistry) {
  registry.register({
    kind: "setMagicSystems",
    version: 1,
    description:
      "Configure origins, feedback and feature rules for magical systems and the meetings between them.",
    schema: z.object({
      systems: z.array(magicSystemSchema),
      confluences: z.array(magicConfluenceSchema).optional(),
    }),
    requirements: (_data, context) => intentReads(context),
    evaluate(data, context, snapshot) {
      validateMagicSystems(data.systems);
      const world = snapshot.world,
        confluences = data.confluences ?? world.confluences ?? canonryConfluencePresets();
      validateMagicConfluences(confluences, data.systems);
      const changes = intentChanges(context, snapshot);
      changes.worldMetadata = {
        name: world.name,
        seed: world.seed,
        epochs: world.epochs,
        humanEras: world.humanEras,
        magicSystems: data.systems,
        confluences,
      };
      invalidateFacts(changes, context, snapshot, ["magic"], context.scope.footprint);
      return changes;
    },
  });
}
