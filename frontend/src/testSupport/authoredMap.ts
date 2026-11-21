import type { MapDescriptor, MapFeatureType } from "@atlas/map";

const type = (
  kind: string,
  label: string,
  path: string[],
  geometries: MapFeatureType["geometries"]
) => ({ id: kind, kind, label, path, geometries, count: 0, footprints: false });
const layer = (id: string, name: string, featureTypes: ReturnType<typeof type>[]) => ({
  id,
  name,
  spaceId: "surface",
  source: { kind: "vector" },
  catalog: { featureTypes },
});
/** The parts of an authored map's descriptor that the editing panel reads. */
export const authoredMap = {
  profile: "world",
  bounds: [0, 0, 100_000, 50_000],
  reference: { mapId: "authored", revision: 1 },
  realScale: { kind: "authored", hexSize: "", creatorLayers: [], edits: 0 },
  layers: [
    layer("vector:landmasses", "Landmasses", [
      type("landmass", "Landmass", ["Land", "Coasts"], ["Polygon"]),
      type("island", "Island", ["Land", "Coasts"], ["Polygon"]),
    ]),
    layer("vector:rivers", "Rivers", [
      type("river", "River", ["Water"], ["LineString"]),
      type("stream", "Stream", ["Water"], ["LineString"]),
    ]),
    layer("vector:settlements", "Settlements", [
      type("city", "City", ["Places", "Settlements"], ["Point"]),
      type("village", "Village", ["Places", "Settlements"], ["Point"]),
    ]),
    layer("vector:geology", "Geology", [
      type("mountain-range", "Mountain range", ["Land", "Relief"], ["Polygon"]),
    ]),
    layer("vector:plots", "Plots", [type("plot", "Plot", ["Parcels"], ["Polygon"])]),
    // A hex layer belongs to real-scale maps; an authored map never offers it.
    layer("vector:hexes", "Hexes", [type("hex", "Hex", ["Grid"], ["Polygon"])]),
    { id: "terrain", name: "Terrain", spaceId: "surface", source: { kind: "raster" } },
  ],
} as unknown as MapDescriptor;
/** The same catalogue as a City map, whose profile is "local". */
export const cityMap = { ...authoredMap, profile: "local" } as unknown as MapDescriptor;
