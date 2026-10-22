import { biomeCode, biomes, spatial } from "@atlas/domain";
import type { GenerationState } from "../process";
import { components, publishPlace } from "./geographicRegions";

/** Located woodland and wetland regions use the same spatial publication as landforms. */
export function extractEcologicalFeatures(state: GenerationState) {
  const map = state.physical!.map;
  const dry = state.surface.ocean
    ? spatial.differenceFrom(state.surface.ocean)
    : (shape: import("geojson").Geometry) => shape;
  const kinds = [
    ["Barren", "barren"],
    ["Desert", "desert"],
    ["Tundra", "tundra"],
    ["Grassland", "grassland"],
    ["Savanna", "savanna"],
    ["Woodland", "forest"],
    ["Temperate forest", "forest"],
    ["Boreal forest", "forest"],
    ["Rainforest", "forest"],
    ["Marsh", "marsh"],
    ["Swamp", "swamp"],
    ["Altered woodland", "forest"],
    ["Altered wetland", "swamp"],
  ] as const;
  for (const [name, kind] of kinds) {
    const code = biomeCode(name);
    components(
      state,
      (i) => map.BiomeCodes[i] === code,
      (members, geometry) => {
        if (!geometry) return;
        const extent = dry(geometry);
        if (!extent) return;
        const area = members.reduce((sum, i) => sum + map.mesh.areas[i], 0);
        const average = (values: Float64Array) =>
          members.reduce((sum, i) => sum + values[i] * map.mesh.areas[i], 0) / area;
        publishPlace(
          state,
          kind,
          name,
          members,
          "ecology",
          {
            sourceAlgorithm: "atlas-ecology-1",
            biome: biomes[code].name,
            treeCover: average(map.TreeCover),
            broadleafCover: average(map.BroadleafCover),
            coniferCover: average(map.ConiferCover),
            alteredCover: average(map.AlteredCover),
            canopyAge: average(map.CanopyAge),
            wetlandCover: average(map.WetlandCover),
            herbivores: average(map.Herbivores),
            peatCarbon: average(map.PeatCarbon),
          },
          extent
        );
      },
      true
    );
  }
}
