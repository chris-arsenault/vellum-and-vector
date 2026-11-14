import { rectangle, type AtlasFeature, type EpochHistory, type World } from "@atlas/domain";

export function inspectionFixture(world: World, island: AtlasFeature) {
  const town: AtlasFeature = {
    ...island,
    id: "town",
    placeId: "town",
    kind: "settlement",
    layerId: "settlements",
    name: "River town",
    geometry: { type: "Point", coordinates: [85, 85] },
    attributes: {
      population: 200,
      communityPopulation: 1000,
      ruralPopulation: 800,
      history: [
        { era: "First era", townsfolk: 100, people: 500 },
        { era: "Second era", townsfolk: 200, people: 1000 },
      ],
      groups: [
        {
          people: "residents",
          culture: null,
          languages: ["river", "coast"],
          namingLanguage: "river",
          languageShares: {
            river: { knowledge: 1, use: 0.75 },
            coast: { knowledge: 0.4, use: 0.25 },
          },
          religions: [],
          practices: [],
          count: 1000,
        },
      ],
    },
    causes: ["People gathered beside the river"],
  };
  addLanguages(world);
  const wild: AtlasFeature = {
    ...island,
    id: "wild",
    placeId: "wild",
    name: "Wandering ground",
    layerId: "magic",
    kind: "veil:wild",
    geometry: rectangle([80, 5, 95, 15]),
    causes: [],
  };
  const neighbour: AtlasFeature = {
    ...town,
    id: "neighbour",
    placeId: "neighbour",
    name: "Coastal town",
    geometry: { type: "Point", coordinates: [95, 85] },
    attributes: { population: 50 },
  };
  const road: AtlasFeature = {
    ...island,
    id: "road",
    placeId: "road",
    name: "Coastal road",
    layerId: "roads",
    kind: "road",
    geometry: {
      type: "LineString",
      coordinates: [
        [85, 85],
        [95, 85],
      ],
    },
    attributes: { fromPlace: town.id, toPlace: neighbour.id, travellers: 120, roadClass: "road" },
  };
  return { features: [island, town, neighbour, road, wild], history: surveys(wild) };
}
function surveys(wild: AtlasFeature): EpochHistory[] {
  return [70, 75].map((west, index) => ({
    path: ["history"],
    ancestry: [{ id: `Epoch ${index + 1}`, duration: 100, parentEpoch: null, variables: {} }],
    causes: [
      {
        kind: "geography",
        process: "atlas.magic-history",
        featureKind: "veil:wild",
        observations: [
          { id: wild.id, name: wild.name, geometry: rectangle([west, 5, west + 15, 15]) },
        ],
      },
    ],
  }));
}
function addLanguages(world: World) {
  for (const [id, name] of [
    ["river", "River speech"],
    ["coast", "Coast speech"],
  ])
    world.entities[id] = { id, name, kind: "language", attributes: {} };
}
