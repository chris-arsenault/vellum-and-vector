import { builtinLayers } from "@atlas/domain";
import type { GenerationState, MapProcessContext } from "./process";
import type { PublicationDefinition } from "./publication";
import type { AtlasGenerationInput } from "./atlasWorkflow";
import { publishLandWays } from "./landWays";
import { publishKinds, publishLatePlaces } from "./poi/poiPublish";
import { nameLatentWorks, publishUnkindedRecords } from "./societyWorkPublication";

export function societyPublications(input: AtlasGenerationInput): PublicationDefinition[] {
  const enabled = ["human.cultures", "human.politics", "built.layout"].some(
    (id) => input.resolvedFeatures?.selection[id]?.enabled
  );
  const base = builtinLayers().find((l) => l.id === "cultures")!;
  const layer = {
    ...base,
    id: "population",
    name: "Population and livelihoods",
    facts: ["populationDensity", "populationCapacity"],
  };
  return (["populationDensity", "populationCapacity"] as const).map((channel) => ({
    kind: "field",
    channel,
    unit: "people/square-kilometre",
    quantity: "intensive",
    layer,
    publish: enabled,
  }));
}
/** The places of the catalogue's society moment, and the ways between the places of the land. */
export function publishSettlements(state: GenerationState, context: MapProcessContext) {
  nameLatentWorks(state);
  publishUnkindedRecords(state);
  publishKinds(state, "society");
  publishLatePlaces(state, "society");
  publishLandWays(state, context);
}
