import { createGrid, generateBand, putChannel } from "@atlas/domain";
import { atlasPublicationDefinitions, type CompletedBoundary } from "@atlas/generation";
import { createWorldSnapshot } from "./worldCreation";

/** Known coast and upland cells, supplied directly rather than found by generating a seed. */
export function constructedWorld() {
  const source = createWorldSnapshot({
    name: "Constructed coast",
    seed: 73,
    width: 4000,
    height: 1000,
  });
  const input = { areaId: source.scope.areaId, seed: 73, quality: "draft", domains: ["physical"] };
  const surface = createGrid("constructed", source.scope, 5, 2);
  const values: Record<string, [string, number[]]> = {
    elevation: ["metre", [-100, -50, 100, 300, 500]],
    water: ["category", [1, 1, 0, 0, 0]],
    temperature: ["celsius", [15, 15, 14, 13, 12]],
    impactExcavation: ["metre", [0, 0, 0, 20, 0]],
  };
  for (const [name, [unit, row]] of Object.entries(values))
    putChannel(
      surface,
      name,
      unit,
      generateBand(surface.coverage, "float64", name, (i) => row[i % 5])
    );
  const result: CompletedBoundary = {
    kind: "final",
    configurationHash: "constructed-coast",
    ancestry: [],
    state: {
      domain: structuredClone(source),
      surface,
      facts: new Set(Object.keys(values)),
      history: [],
      publications: atlasPublicationDefinitions(input, source.world),
    },
  };
  return { source, input, result };
}
