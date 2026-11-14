import { rectangle, type FieldGeography, type NumericalResource } from "@atlas/domain";
import type { BinaryStore } from "@atlas/storage-browser";
import { fixtureDocument } from "./fixtureWorld";

/** Twenty-five explicit samples for publication and rendering checks; no process runs. */
export async function publishedMapFixture(binary: BinaryStore) {
  const snapshot = fixtureDocument({ name: "Published island", seed: 1, width: 100, height: 100 });
  const scope = snapshot.scope,
    id = "supplied-map";
  const arrays = suppliedArrays();
  const descriptor = {
    schemaVersion: 1,
    id,
    revision: 1,
    scope: { worldId: scope.worldId, areaId: scope.areaId, spaceId: scope.spaceId },
    crsId: scope.crsId,
    bounds: [0, 0, 100, 100],
    precision: 1e-6,
    layout: "regular",
    sampling: { width: 5, height: 5 },
    state: "ready",
    field: {
      id,
      scope,
      layoutResourceId: id,
      geographyId: id,
      channels: Object.fromEntries(arrays.slice(2).map((array) => [array.name, array.name])),
    },
    arrays: arrays.map(({ name, unit, dtype, quantity }) => ({
      name,
      unit,
      dtype,
      quantity,
      shape: [5, 5],
      chunkShape: [5, 5],
    })),
  };
  const prefix = `/resources/${id}`;
  const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
  await binary.set(`${prefix}/resource.json`, json(descriptor));
  for (const array of arrays) {
    await binary.set(
      `${prefix}/${array.name}/zarr.json`,
      json({
        zarr_format: 3,
        node_type: "array",
        shape: [5, 5],
        data_type: array.dtype,
        chunk_grid: { name: "regular", configuration: { chunk_shape: [5, 5] } },
        chunk_key_encoding: { name: "default", configuration: { separator: "/" } },
        fill_value: 0,
        codecs: [{ name: "bytes", configuration: { endian: "little" } }],
        attributes: {},
      })
    );
    await binary.set(`${prefix}/${array.name}/c/0/0`, new Uint8Array(array.values.buffer));
  }
  snapshot.world.fields.push({
    id,
    areaId: scope.areaId,
    layerId: "geology",
    algorithm: "supplied",
    source: { kind: "run", id: "supplied" },
    samples: 25,
    channels: arrays.slice(2).map((array) => array.name),
    resourceId: id,
    state: "generated",
  });
  const geography: FieldGeography = {
    id,
    scope: descriptor.scope,
    ocean: rectangle([0, 0, 20, 100]),
  };
  return { snapshot, areaId: scope.areaId, geography };
}
function suppliedArrays() {
  const f64 = (at: (index: number) => number) => Float64Array.from({ length: 25 }, (_, i) => at(i));
  const i32 = (at: (index: number) => number) => Int32Array.from({ length: 25 }, (_, i) => at(i));
  const array = (
    name: string,
    unit: string,
    values: Float64Array | Int32Array | Uint8Array,
    quantity: NumericalResource["arrays"][number]["quantity"] = "intensive"
  ) => ({
    name,
    unit,
    values,
    quantity,
    dtype:
      values instanceof Float64Array ? "float64" : values instanceof Int32Array ? "int32" : "uint8",
  });
  return [
    array("active", "mask", new Uint8Array(25).fill(1), "topology"),
    array(
      "measures",
      "square-metre",
      f64(() => 400),
      "topology"
    ),
    array(
      "Elevation",
      "native-length",
      f64((i) => (100 + (i % 5) * 250 + Math.floor(i / 5) * 125) * 1024)
    ),
    array(
      "finalSurface",
      "category",
      i32(() => 32),
      "category"
    ),
    array(
      "naturalSurface",
      "category",
      i32(() => 32),
      "category"
    ),
    array(
      "Temperature",
      "celsius",
      f64((i) => (i % 5) * 10 - 20)
    ),
    array(
      "BiomeCodes",
      "category",
      i32((i) => (i % 5 < 2 ? 3 : 4)),
      "category"
    ),
    array(
      "TreeCover",
      "ratio",
      f64(() => 0.8)
    ),
    array(
      "RockLayerDepth0",
      "native-length",
      f64(() => 12 * 1024)
    ),
    array(
      "RockLayerKind0",
      "category",
      i32(() => 11),
      "category"
    ),
  ];
}
