import { registerCause, type FeatureCause } from "../regional/causes/registry";
import { poiCatalogue } from "./catalogue";
import { drainageCosts } from "./poiCosts";
import { placeCaps } from "./poiEffects";

/**
 * The catalogue's part in refinement's schedule: the steps entries own and the two things every
 * kind declares for it, its drainage cost and its gradient caps. Registered when a refinement
 * starts rather than as modules load, because the entries read the schedule's own modules.
 */
export function registerCatalogueCauses() {
  for (const entry of Object.values(poiCatalogue))
    if (!("slot" in entry.acrossMaps.schedule))
      registerCause(entry.acrossMaps.schedule as FeatureCause);
  registerCause({ kind: "catalogue", influence: drainageCosts, caps: placeCaps });
}
