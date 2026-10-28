import {
  newBlock,
  readRange,
  requireThat,
  type Band,
  type PartitionReference,
  type ResourceArray,
  type SampleArray,
} from "@atlas/domain";

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
export function readBandPartition(
  band: Band,
  array: ResourceArray,
  partition: PartitionReference
): SampleArray {
  const { start, rows, width, stride } = selectionRows(array, partition),
    result = newBlock(array.dtype, rows * width);
  for (let row = 0; row < rows; row++)
    if (width) readRange(band, start + row * stride, width, result, row * width);
  return result;
}
