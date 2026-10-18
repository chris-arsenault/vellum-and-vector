import { z } from "zod";
import { intentReads, intentChanges, type IntentRegistry } from "./intent";
import { magicSystemSchema, validateMagicSystems } from "./magicSystems";
import { invalidateFacts } from "./authoringBasics";

export function registerMagicSystemIntents(registry: IntentRegistry) {
  registry.register({
    kind: "setMagicSystems",
    version: 1,
    description: "Configure source, propagation, feedback and feature rules for magical systems.",
    schema: z.object({ systems: z.array(magicSystemSchema) }),
    requirements: (_data, context) => intentReads(context),
    evaluate(data, context, snapshot) {
      validateMagicSystems(data.systems);
      const changes = intentChanges(context, snapshot),
        world = snapshot.world;
      changes.worldMetadata = {
        name: world.name,
        seed: world.seed,
        epochs: world.epochs,
        humanEras: world.humanEras,
        magicSystems: data.systems,
      };
      invalidateFacts(changes, context, snapshot, ["magic"], context.scope.footprint);
      return changes;
    },
  });
}
