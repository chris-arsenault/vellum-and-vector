import { expect, it } from "vitest";
import { rectangle } from "@atlas/domain";
import { generateAtlas, prepareAtlasGeneration } from "@atlas/generation";
import { physicalFeatureDefinitions } from "../../packages/generation/src/physicalFeatures";
import { landscape } from "../../packages/generation/src/mapFixtures";

function source() {
  const domain = landscape().domain;
  domain.world.id = domain.scope.worldId = "00000000-0000-4000-8000-000000000001";
  const footprint = rectangle([0, 0, 3_000_000, 2_000_000]);
  domain.scope.footprint = footprint;
  domain.world.reference.domain = footprint;
  domain.world.areas[domain.scope.areaId].footprint = footprint;
  domain.world.epochs = [
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
  domain.world.humanEras = [];
  domain.world.magicSystems = [];
  return domain;
}
function prepareOmission(id: string) {
  const domain = source();
  return prepareAtlasGeneration(domain, {
    areaId: domain.scope.areaId,
    seed: 73,
    quality: "draft",
    domains: ["physical"],
    features: { [id]: { enabled: false } },
  });
}

const independentOmissions = [
  "physical.tectonic-history",
  "physical.mountains",
  "physical.volcanism",
  "physical.impacts",
  "physical.hillslopes",
  "physical.continental-margins",
  "physical.coastal-construction",
  "physical.fractures",
  "physical.geothermal",
  "physical.ocean-circulation",
  "physical.river-incision",
  "physical.glacial-sculpting",
  "physical.sea-ice",
  "physical.coastal-evolution",
  "physical.deltas",
  "physical.landforms",
];
const supportedOmissions = physicalFeatureDefinitions.filter((feature) =>
  independentOmissions.includes(feature.id)
);
it.each(supportedOmissions)(
  "generates valid fresh geography without $id",
  async (feature) => {
    const prepared = prepareOmission(feature.id);
    const executed: string[] = [];
    const result = await generateAtlas(prepared.source, prepared.input, {
      progress: (path) => {
        executed.push(path.join("/"));
      },
      saveBoundary: async (boundary) => {
        if (feature.id !== "physical.fractures" || boundary.kind !== "final") return;
        const map = boundary.state.physical!.map;
        expect(map.faults).toEqual([]);
        expect(map.FractureConductance.some((value) => value > 0)).toBe(true);
        expect(map.Geothermal.some((value) => value > 0)).toBe(true);
      },
    });
    const elevation = result.state.surface.channels.elevation;
    expect(elevation.length).toBeGreaterThan(0);
    expect(elevation.every(Number.isFinite)).toBe(true);
    expect(result.state.history).toHaveLength(1);
    for (const process of feature.processes) {
      const name = process.slice("canonry.".length);
      expect(executed.some((path) => path.endsWith(`/${name}`))).toBe(false);
    }
    assertAbsentGeography(
      feature.id,
      result.state.domain.world.features,
      result.state.surface.channels
    );
  },
  120000
);

function assertAbsentGeography(
  id: string,
  features: ReturnType<typeof source>["world"]["features"],
  channels: Record<string, ArrayLike<number>>
) {
  const kinds: Record<string, string[]> = {
    "physical.impacts": ["crater"],
    "physical.volcanism": ["volcano", "plume"],
    "physical.glacial-sculpting": ["cirque", "moraine", "fjord"],
  };
  const buffers: Record<string, string[]> = {
    "physical.impacts": ["impactExcavation", "impactRim"],
    "physical.volcanism": ["volcanicConstruction"],
    "physical.glacial-sculpting": ["glacialErosion", "glacialDeposition"],
    "physical.coastal-evolution": ["coastalErosion"],
  };
  if (id === "physical.fractures") {
    expect(Object.values(features).filter((feature) => feature.kind === "fault")).toEqual([]);
  }
  expect(Object.values(features).filter((feature) => kinds[id]?.includes(feature.kind))).toEqual(
    []
  );
  for (const channel of buffers[id] ?? [])
    if (channels[channel])
      expect(Array.from(channels[channel]).every((value) => value === 0)).toBe(true);
}
