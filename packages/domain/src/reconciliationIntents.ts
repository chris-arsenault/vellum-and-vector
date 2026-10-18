import {
  featureEditSchema,
  featureRequirements,
  evaluateFeature,
  validateFeatureComposition,
} from "./featureIntents";
import type { IntentRegistry } from "./intent";
import { requireThat } from "./errors";
import { Spatial } from "./spatial";
import { projectChanges } from "./projection";
import { reconcileFeatureContracts } from "./reconciliation";
import { updateNetworkTopology } from "./networkTopology";

export function registerReconciliationIntents(registry: IntentRegistry): void {
  registry.register({
    kind: "reconcileFeature",
    version: 1,
    description:
      "Change an owning coarse feature, rebuild affected child interfaces and retain stale authored detail for explicit reconciliation.",
    schema: featureEditSchema,
    requirements(data, context) {
      const reads = featureRequirements(data, context);
      reads.constraints = {
        intersectingAreas: true,
        descendantsOf: [data.areaId],
        boundaryFeatures: [data.feature.id],
      };
      return reads;
    },
    evaluate(data, context, snapshot) {
      const source = snapshot.world.features[data.feature.id],
        area = snapshot.world.areas[data.areaId];
      requireThat(
        source && source.areaId === data.areaId,
        "reconcile_owner",
        "Reconcile the feature through its owning coarse area, then refine affected child representations."
      );
      requireThat(
        area &&
          new Spatial(snapshot.world.reference.precision).covers(
            context.scope.footprint,
            area.footprint
          ),
        "reconcile_extent",
        "Select the owning area's extent so reconciliation can resolve its complete child interfaces."
      );
      const changes = evaluateFeature(data, context, snapshot, {
        reconcile: true,
        deferComposition: true,
      });
      changes.highImpact = true;
      const candidate = projectChanges(snapshot, changes).world;
      reconcileFeatureContracts(snapshot, candidate, changes, [source.id], area.id);
      const affected = validateFeatureComposition(snapshot, changes, [source.id]);
      // Shared junctions remain anchored. Moving a junction is its own explicit
      // multi-path operation; changing an area's interface alone does not move it.
      updateNetworkTopology(snapshot, changes, affected);
      return changes;
    },
  });
}
