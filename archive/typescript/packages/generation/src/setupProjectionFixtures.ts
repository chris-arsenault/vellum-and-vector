import { putChannel, rectangle, residentBand } from "@atlas/domain";
import { landscape } from "./mapFixtures";
import { prepareAtlasGeneration } from "./atlasWorkflow";
import { prepareRegionalRefinement } from "./regional/workflow";
import { projectGenerationSetup } from "./setupProjection";
import type { FeatureSelection } from "./features";

export function world() {
  const state = landscape();
  state.domain.world.magicSystems = [];
  state.domain.world.humanEras = [];
  state.domain.world.epochs = [
    {
      id: "Formation",
      duration: 1000,
      tectonics: 1,
      hydrology: 1,
      ice: 1,
      coasts: 1,
      temperature: 15,
      seaLevel: 0,
    },
  ];
  return state;
}
export function prepared(features: FeatureSelection = {}) {
  const state = world();
  return prepareAtlasGeneration(state.domain, {
    areaId: "area",
    seed: 73,
    quality: "draft",
    domains: ["physical", "magic", "cultural", "political", "built"],
    features,
  });
}
export function feature(view: ReturnType<typeof projectGenerationSetup>, id: string) {
  return view.features.find((item) => item.id === id)!;
}

/** A region is an independent captured map: its inputs are the parent's present channels, pinned. */
export function region() {
  const state = world(),
    domain = state.domain,
    footprint = rectangle([1000, 0, 3000, 1000]);
  domain.world.areas.region = {
    ...structuredClone(domain.world.areas.area),
    id: "region",
    name: "New region",
    parentId: "area",
    profile: "region",
    footprint,
    map: { sourceAreaId: "area", sourceRevision: 1, refinementLevel: 1 },
  };
  for (const name of [
    "CrustProvinceIds",
    "MarginCodes",
    "CrustThickness",
    "ImpactExcavation",
  ] as const)
    putChannel(
      state.surface,
      name,
      name === "CrustProvinceIds" || name === "MarginCodes" ? "category" : "native-length",
      residentBand("float64", Array(10).fill(0))
    );
  domain.world.fields.push({
    id: "captured",
    areaId: "region",
    layerId: "elevation",
    algorithm: "supplied",
    input: true,
    source: { kind: "operation", id: "supplied" },
    samples: 10,
    channels: Object.keys(state.surface.channels),
    resourceId: state.surface.id,
    state: "generated",
    footprint,
    spaceId: "surface",
  });
  domain.numerical.captured = state.surface;
  return prepareRegionalRefinement(domain, {
    areaId: "region",
    seed: 73,
    quality: "draft",
    domains: ["physical", "magic"],
  });
}
