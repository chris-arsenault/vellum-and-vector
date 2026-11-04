// The catalogue loads first: its entries read the module below, which reads this one's neighbours.
import "./poi/catalogue";
import { putGenerated } from "./mapFeatures";
import type { GenerationState } from "./process";
import type { SocietyWorkKind } from "@atlas/domain";
import { isWorldSociety } from "./societyMapScope";
import { generationFeature } from "./generationFeatures";
import { nameUnrecordedWork, unkindedEvent, workFeature } from "./poi/settlements/workRecords";

/** Works the catalogue has an entry for; the entry publishes them. */
const entryKinds = new Set<SocietyWorkKind>([
  "dam",
  "irrigation",
  "harbor",
  "fire-forge",
  "aurora-archive",
]);

/** A demand is a latent quantity, not a feature, and still carries its name. */
export function nameLatentWorks(state: GenerationState) {
  for (const w of state.society!.region.works) nameUnrecordedWork(state, w);
}
/**
 * The simulation's records no catalogue kind stands for: hunting, conservation, the cold-age
 * set and the like, and a polity's collapse. The World publishes no generated works at all
 * (ADR 0005).
 */
export function publishUnkindedRecords(state: GenerationState) {
  const region = state.society!.region;
  for (const w of region.works) {
    if (entryKinds.has(w.kind) || (w.authored && generationFeature(state, w.id))) continue;
    if (!isWorldSociety(state) && !w.demand) putGenerated(state, workFeature(state, w));
  }
  for (const event of region.events)
    if (event.kind === "collapse") putGenerated(state, unkindedEvent(state, event));
}
