import {
  createGrid,
  generateBand,
  putChannel,
  MapScale,
  canonicalPhysicalFields,
  fieldChannelName,
} from "@atlas/domain";
import { atlasPublicationDefinitions, type CompletedBoundary } from "@atlas/generation";
import { createWorldSnapshot } from "./worldCreation";
import { groundResourceChannels } from "../../packages/generation/src/rock/groundResources";

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
    Elevation: ["native-length", [-100, -50, 100, 300, 500].map(MapScale.native)],
    WaterKindCodes: ["category", [1, 1, 0, 0, 0]],
    MarginCodes: ["category", [0, 0, 0, 0, 0]],
    Temperature: ["native-temperature", [450, 450, 440, 430, 420]],
    ImpactExcavation: ["native-length", [0, 0, 0, MapScale.native(20), 0]],
  };
  for (const [name, [unit, row]] of Object.entries(values))
    putChannel(
      surface,
      fieldChannelName(name),
      unit,
      generateBand(
        surface.coverage,
        canonicalPhysicalFields().find((field) => field.name === name)!.type,
        name,
        (i) => row[i % 5]
      )
    );
  for (const { name, unit, quantity } of groundResourceChannels)
    putChannel(
      surface,
      name,
      unit,
      generateBand(
        surface.coverage,
        canonicalPhysicalFields().find((field) => field.name === name)!.type,
        name,
        (i) =>
          name === "BedrockElevation" || name === "CrustSupportElevation"
            ? values.Elevation[1][i % 5]
            : 0
      ),
      quantity
    );
  for (const name of ["BaseSeaLevel", "EffectiveSeaLevel"] as const)
    putChannel(
      surface,
      name,
      "native-length",
      generateBand(surface.coverage, "float64", name, () => 0)
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
