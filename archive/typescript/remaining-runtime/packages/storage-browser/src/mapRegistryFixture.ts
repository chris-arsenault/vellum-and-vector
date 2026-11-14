import type { MapFeature, MapRegistryRequest } from "@atlas/map";
import { descriptor, rectangle } from "./mapPublicationFixture";

export function registryFixture() {
  const map = descriptor("registry");
  map.layers[0].catalog.featureTypes = ["settlement", "road", "sovereignty"].map((kind) => ({
    id: kind,
    kind,
    label: kind,
    path: ["People", kind],
    magicDepiction: null,
    count: kind === "settlement" ? 3 : 1,
    geometries: ["Polygon"],
    footprints: false,
  }));
  const features = [
    record("town", "settlement", 20),
    record("neighbour", "settlement", 10),
    record("label", "settlement", 30),
    record("way", "road"),
    record("realm", "sovereignty"),
  ];
  features[0].attributes.polityId = "union";
  features[0].catalog.values.protected = true;
  features[2].attributes.nameStatus = "label";
  features[3].attributes = { fromPlace: "town", toPlace: "neighbour" };
  features[4].relations = [{ targetId: "union", targetName: "Coastal union", kind: "sovereign" }];
  return { map, features };
}
function record(id: string, kind: string, population?: number): MapFeature {
  return {
    id,
    name: id,
    geometry: rectangle,
    spaceId: "surface",
    layerId: "places",
    kind,
    typeId: kind,
    entityId: null,
    footprint: null,
    relations: [],
    causes: [],
    attributes: {},
    catalog: {
      origin: "Generated geography",
      mapOnly: false,
      values: {
        name: id,
        population: population ?? null,
        protected: false,
        status: "inhabited",
        space: "surface",
      },
      columns: [
        { key: "name", label: "Name", numeric: false },
        { key: "population", label: "Residents", numeric: true },
      ],
    },
  };
}
export function registryRequest(): MapRegistryRequest {
  return {
    scope: "map",
    page: 0,
    limit: 2,
    sort: { key: "population", descending: true },
    query: {
      search: "",
      type: "settlement",
      status: "",
      state: "",
      profile: "",
      space: "",
      named: true,
      protectedOnly: false,
      attributes: [],
    },
  };
}
