import { areaCatalogue } from "../../area/catalogue";
import { generationFeatures, writeGenerationFeature } from "../../generationFeatures";
import type { RegionalState } from "../state";

/**
 * After the world has published the field's geography, carry what only a refinement knows:
 * which of this map's records draw a parent's area, and which features are this map's own
 * products (so a later run regenerates them and keeps the captured geography).
 */
export function carryIdentities(state: RegionalState) {
  tagProducts(state);
  for (const { lineage } of Object.values(areaCatalogue))
    if (typeof lineage.adopt === "function") lineage.adopt(state);
}

/** A feature neither captured nor authored is this run's product. */
function tagProducts(state: RegionalState) {
  const areaId = state.regional.input.areaId,
    source = state.sourceFeatures,
    removed = state.regional.removedProducts;
  for (const f of generationFeatures(state, { areaId })) {
    if (f.state !== "generated" || f.protected) continue;
    const captured =
      source?.get(f.id) !== undefined &&
      !removed?.has(f.id) &&
      f.attributes.developedBy !== "regional";
    if (captured || f.attributes.developedBy === "regional") continue;
    writeGenerationFeature(state, {
      ...f,
      attributes: { ...f.attributes, developedBy: "regional" },
    });
  }
}
