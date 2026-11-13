import type { DomainSnapshot } from "@atlas/domain";
import type { AtlasGenerationInput } from "../atlasWorkflow";
import { composeFeatureSlot } from "../physicalFeatureSequence";
import type { FeatureContributionContext } from "../features";
import type { ProcessInvocation, ProcessSequence } from "../process";
import { rounds } from "./schedule";

const invoke = (
  id: string,
  parameters: ProcessInvocation["parameters"] = {},
  occurrence = ""
): ProcessInvocation => ({
  kind: "process",
  id: occurrence ? `${occurrence}/${id}` : id,
  process: id,
  version: "1",
  parameters,
});
const developmentSlots = [
  "material.relaxation",
  "material.hillslopes",
  "material.margins",
  "ice.model",
  "epoch.sculpting",
  "ice.meltwater",
  "water.routing",
  "water.groundwater",
  "epoch.incision",
  "epoch.after-incision.hillslopes",
  "water.routing",
  "epoch.sediment",
  "epoch.coasts",
  "epoch.ice-load",
];

/** Regional policy supplies order and exposure; features select shared or local algorithms. */
export function regionalSequence(
  source: DomainSnapshot,
  input: AtlasGenerationInput
): ProcessSequence {
  const context: FeatureContributionContext = {
    source,
    input,
    resolved: input.resolvedFeatures!,
    execution: "regional",
  };
  const society = ["built.layout", "human.cultures", "human.politics"].some(
    (id) => context.resolved.selection[id]?.enabled
  );
  const group = (slot: string, occurrence: string, workSpan = 1 / rounds) =>
    composeFeatureSlot(slot, occurrence, context, { workSpan });
  const refresh = (occurrence: string): ProcessSequence => [
    ...group("climate.ocean", occurrence, 0),
    ...group("climate.circulation", occurrence, 0),
    invoke("refinement.media", {}, occurrence),
    ...group("present.climate-forcing", occurrence, 0),
    ...group("climate.atmosphere", occurrence, 0),
    ...group("water.current", occurrence, 0),
  ];
  const sequence: ProcessSequence = [
    invoke("atlas.initialize"),
    invoke("refinement.begin"),
    invoke("refinement.clear-products"),
    invoke("refinement.context"),
    invoke("refinement.relief"),
    ...group("terrain.refinement", "detail"),
    ...group("initialize.ecology", "detail"),
  ];
  for (let round = 1; round <= rounds; round++) {
    const occurrence = `round-${round}`;
    sequence.push(
      invoke("refinement.round", { round }, occurrence),
      ...refresh(`${occurrence}/before`),
      ...group("water.runoff", `${occurrence}/supply`),
      ...group(round === 1 ? "water.initialize" : "water.routing", `${occurrence}/courses`),
      ...(round === 1 ? group("epoch.material-forcing", occurrence) : []),
      ...developmentSlots.flatMap((slot, position) => group(slot, `${occurrence}/${position}`)),
      ...refresh(`${occurrence}/after`),
      ...(round === 1 ? group("ice.flow", `${occurrence}/carriers`, 0) : []),
      ...(round === 1 ? group("epoch.post-glacial-forcing", occurrence) : []),
      ...group("epoch.ecology-evolve", occurrence),
      ...group("epoch.ecology-burial", occurrence),
      invoke("refinement.place-effects", { people: society }, occurrence),
      ...group("water.routing", `${occurrence}/final-courses`)
    );
  }
  sequence.push(
    ...refresh("final"),
    ...[
      "ice.flow",
      "present.glacial-landforms",
      "present.river-geometry",
      "present.floodplains",
      "present.deltas",
      "present.landforms",
      "present.ecology",
    ].flatMap((slot) => group(slot, "final", 0)),
    invoke("refinement.refresh"),
    ...group("present.classify", "final"),
    invoke("atlas.project"),
    invoke("atlas.features"),
    invoke("atlas.magic-places"),
    invoke("refinement.identity"),
    ...(society ? [invoke("refinement.places")] : []),
    invoke("atlas.names")
  );
  return sequence;
}
