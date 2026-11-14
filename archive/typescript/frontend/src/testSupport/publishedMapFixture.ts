import {
  createGrid,
  generateBand,
  putChannel,
  MapScale,
  surfaceCode,
  rectangle,
  columnFields,
  type Grid,
} from "@atlas/domain";
import { createWorldSnapshot, worldScope } from "../worldCreation";
import type { LoadedRaster } from "../types";

/** Twenty-five explicit samples for publication and rendering checks; no process runs. */
export function publishedMapFixture() {
  const snapshot = createWorldSnapshot({
    name: "Published island",
    seed: 1,
    width: 100,
    height: 100,
  });
  const { world } = snapshot;
  const areaId = Object.keys(world.areas)[0];
  const field = createGrid("supplied-map", worldScope(world, areaId), 5, 5);
  putChannel(
    field,
    "Elevation",
    "native-length",
    generateBand(field.coverage, "float64", "height", (i) =>
      MapScale.native(100 + (i % 5) * 250 + Math.floor(i / 5) * 125)
    )
  );
  for (const channel of ["finalSurface", "naturalSurface"] as const)
    putChannel(
      field,
      channel,
      "category",
      generateBand(field.coverage, "int32", channel, () => surfaceCode("Boreal forest")),
      "category"
    );
  field.ocean = rectangle([0, 0, 20, 100]);
  putChannel(
    field,
    "Temperature",
    "celsius",
    generateBand(field.coverage, "float64", "temperature", (i) => (i % 5) * 10 - 20)
  );
  putChannel(
    field,
    "BiomeCodes",
    "category",
    generateBand(field.coverage, "int32", "biome", (i) => (i % 5 < 2 ? 3 : 4)),
    "category"
  );
  const raster: LoadedRaster = {
    id: field.id,
    areaId,
    footprint: field.scope.footprint,
    bounds: field.bounds,
    channel: "Elevation",
    field,
    surface: field,
  };
  addInspectionBands(field);
  putChannel(
    field,
    "TreeCover",
    "ratio",
    generateBand(field.coverage, "float64", "trees", () => 0.8)
  );
  world.fields.push({
    id: field.id,
    areaId,
    layerId: "geology",
    algorithm: "supplied",
    source: { kind: "run", id: "supplied" },
    samples: field.active.length,
    channels: Object.keys(field.channels),
    resourceId: field.id,
    state: "generated",
  });
  snapshot.numerical[field.id] = field;
  return { world, raster, snapshot };
}
function addInspectionBands(field: Grid) {
  const rock = columnFields.land;
  putChannel(
    field,
    rock.depth[0],
    "native-length",
    generateBand(field.coverage, "float64", "depth", () => MapScale.native(12))
  );
  putChannel(
    field,
    rock.kind[0],
    "category",
    generateBand(field.coverage, "int32", "rock", () => 11),
    "category"
  );
}
