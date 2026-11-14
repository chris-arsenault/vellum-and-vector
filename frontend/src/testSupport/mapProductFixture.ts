import type { MapDescriptor, MapSample, MapLayer } from "@atlas/map";

export const rectangle: Extract<MapSample["footprint"], { type: "Polygon" }> = {
  type: "Polygon",
  coordinates: [
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ],
  ],
};
export function descriptor(revision: string): MapDescriptor {
  return {
    reference: { mapId: "island", revision },
    worldId: "world",
    name: "Island",
    primarySpaceId: "surface",
    profile: "world",
    regionScale: { level: 0, nextArea: 25, subdivision: 7, minimumWidth: 0.001, enabled: true },
    footprint: rectangle,
    bounds: [0, 0, 10, 10],
    parent: null,
    state: "incomplete",
    spaces: [
      {
        id: "surface",
        parentSpaceId: null,
        bounds: [0, 0, 10, 10],
        metresPerUnit: 1,
        precision: 1e-6,
        periodicWidth: null,
        frame: { origin: [0, 0, 0], rotation: 0, floor: null },
      },
    ],
    layers: [places(), height()],
  };
}
function places(): MapLayer {
  return {
    id: "places",
    spaceId: "surface",
    name: "Places",
    bounds: [0, 0, 10, 10],
    attribution: [],
    catalog: {
      path: ["Places"],
      common: true,
      defaultStyle: null,
      presets: [],
      properties: { name: { type: "string" }, kind: { type: "string" } },
      examples: [],
      geometries: [],
      featureTypes: [
        {
          id: "place",
          kind: "place",
          label: "Places",
          path: ["Places"],
          magicDepiction: null,
          count: 0,
          geometries: [],
          footprints: false,
        },
      ],
    },
    source: { kind: "vector", data: { assetId: "places", mediaType: "application/geo+json" } },
  };
}
function height(): MapLayer {
  return {
    id: "height",
    spaceId: "surface",
    name: "Height",
    bounds: [0, 0, 10, 10],
    attribution: [],
    catalog: {
      path: ["Terrain"],
      common: true,
      featureTypes: [],
      properties: {},
      geometries: [],
      examples: [],
      defaultStyle: null,
      presets: [],
    },
    source: {
      kind: "raster",
      data: {
        assetId: "height",
        mediaType: "image/tiff",
        width: 1,
        height: 1,
        cellSpan: 10,
        overviews: [],
        bandIndices: [1],
        bands: [
          {
            id: "height",
            name: "Height",
            unit: "metre",
            display: { unit: "m", factor: 1 },
            nodata: null,
            categories: [],
            range: [0, 25],
          },
        ],
      },
    },
  };
}
export const sample: MapSample = {
  id: "cell",
  spaceId: "surface",
  footprint: rectangle,
  window: { bounds: [0, 0, 10, 10], closedEast: true, closedNorth: true },
  cellSpan: 10,
  center: [5, 5],
  measure: 100,
  active: true,
  attributes: [
    {
      layerId: "height",
      bandId: "height",
      value: 25,
      unit: "metre",
      label: "Height",
      display: { unit: "m", factor: 1 },
      category: null,
    },
  ],
  sections: [{ id: "rock", title: "Rock", records: [{ name: "Basalt", thickness: 12 }] }],
};
