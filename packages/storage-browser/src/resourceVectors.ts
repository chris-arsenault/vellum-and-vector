import {
  readNumericalBlock,
  requireThat,
  writeNumericalBlock,
  type NumericalVector,
  type PartitionReference,
  type ResourceArray,
  type SampleArray,
} from "@atlas/domain";
import { sampleConstructors } from "./vectorStorage";

export function arraySelection(array: ResourceArray, partition: PartitionReference) {
  return (
    partition.arraySlices?.[array.name] ?? {
      offset: [partition.cellStart],
      shape: [partition.cellCount],
    }
  );
}
function selectionRows(array: ResourceArray, partition: PartitionReference) {
  const region = arraySelection(array, partition);
  requireThat(array.shape.length <= 2, "field_shape", "Field arrays have one or two dimensions.");
  if (region.shape.length === 1)
    return { start: region.offset[0], rows: 1, width: region.shape[0], stride: region.shape[0] };
  return {
    start: region.offset[0] * array.shape[1] + region.offset[1],
    rows: region.shape[0],
    width: region.shape[1],
    stride: array.shape[1],
  };
}
export function readVectorPartition(
  vector: NumericalVector,
  array: ResourceArray,
  partition: PartitionReference
): SampleArray {
  const { start, rows, width, stride } = selectionRows(array, partition),
    result = new sampleConstructors[array.dtype](rows * width);
  for (let row = 0; row < rows; row++)
    if (width) result.set(readNumericalBlock(vector, start + row * stride, width), row * width);
  return result;
}
export function writeVectorPartition(
  vector: NumericalVector,
  array: ResourceArray,
  partition: PartitionReference,
  samples: SampleArray
) {
  const { start, rows, width, stride } = selectionRows(array, partition);
  requireThat(
    samples.length === rows * width,
    "field_shape",
    "Loaded field samples retain their shape."
  );
  for (let row = 0; row < rows; row++)
    if (width)
      writeNumericalBlock(
        vector,
        start + row * stride,
        samples.subarray(row * width, (row + 1) * width)
      );
}
