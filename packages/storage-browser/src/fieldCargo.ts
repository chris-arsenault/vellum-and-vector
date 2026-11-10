import type { Grid, NumericalResource } from "@atlas/domain";
import { fieldPartitionSamples, layoutVector, type LayoutVector } from "./fieldLayout";

/** Sparse material records use normal chunked arrays, outside the scalar channel namespace. */
export function appendFieldCargo(grid: Grid, resource: NumericalResource): LayoutVector[] {
  const cargo = grid.materialCargo;
  if (!cargo) return [];
  const vectors = [
    layoutVector("material_offsets", cargo.offsets, "cells"),
    layoutVector("material_records", cargo.records, "cells"),
  ];
  resource.field!.materialCargo = {
    keys: [...cargo.keys],
    releasedTo: [...cargo.releasedTo],
    slots: [...cargo.slots],
    offsets: vectors[0].array.name,
    records: vectors[1].array.name,
  };
  resource.arrays.push(...vectors.map((vector) => vector.array));
  for (const { array } of vectors)
    for (let start = 0; start < array.shape[0]; start += fieldPartitionSamples)
      resource.partitions.push({
        id: `${array.name}:${start}`,
        bounds: grid.bounds,
        cellStart: 0,
        cellCount: 0,
        neighbors: [],
        arraySlices: {
          [array.name]: {
            offset: [start],
            shape: [Math.min(fieldPartitionSamples, array.shape[0] - start)],
          },
        },
      });
  return vectors;
}
