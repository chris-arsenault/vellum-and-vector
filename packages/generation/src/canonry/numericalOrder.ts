import {
  allocateNumerical,
  readNumericalBlock,
  writeNumericalBlock,
  type NumericalAllocator,
  type NumericalVector,
} from "@atlas/domain";

const orderingRunSamples = 16_384;
interface SortColumns {
  keys: NumericalVector;
  ids: NumericalVector;
}
function columns(length: number, numerical: NumericalAllocator): SortColumns {
  const allocate = (type: "float64" | "int32") =>
    allocateNumerical({ type, length, lifetime: "process", name: `ordering:${type}` }, numerical);
  return { keys: allocate("float64"), ids: allocate("int32") };
}
function compare(a: number, ai: number, b: number, bi: number, descending: boolean) {
  return (descending ? b - a : a - b) || ai - bi;
}
function sortedRuns(values: NumericalVector, target: SortColumns, descending: boolean) {
  for (let start = 0; start < values.length; start += orderingRunSamples) {
    const size = Math.min(orderingRunSamples, values.length - start),
      input = readNumericalBlock(values, start, size),
      ids = Int32Array.from({ length: size }, (_, i) => i);
    ids.sort((a, b) => compare(input[a], a, input[b], b, descending));
    const keys = Float64Array.from(ids, (i) => input[i]);
    for (let i = 0; i < size; i++) ids[i] += start;
    writeNumericalBlock(target.keys, start, keys);
    writeNumericalBlock(target.ids, start, ids);
  }
}
function mergeRuns(source: SortColumns, target: SortColumns, run: number, descending: boolean) {
  const length = source.ids.length;
  for (let start = 0; start < length; start += 2 * run) {
    const middle = Math.min(start + run, length),
      end = Math.min(start + 2 * run, length);
    let a = start,
      b = middle;
    for (let out = start; out < end; out++) {
      const takeA =
          a < middle &&
          (b >= end ||
            compare(source.keys[a], source.ids[a], source.keys[b], source.ids[b], descending) <= 0),
        at = takeA ? a++ : b++;
      target.keys[out] = source.keys[at];
      target.ids[out] = source.ids[at];
    }
  }
}
/** External merge ordering carries keys with indices, avoiding random world-field reads in merges. */
export function orderedIndices(
  values: NumericalVector,
  descending = false,
  numerical?: NumericalAllocator
) {
  if (!numerical)
    return Int32Array.from({ length: values.length }, (_, i) => i).sort((a, b) =>
      compare(values[a], a, values[b], b, descending)
    );
  let source = columns(values.length, numerical),
    target = columns(values.length, numerical);
  try {
    sortedRuns(values, source, descending);
    for (let run = orderingRunSamples; run < values.length; run *= 2) {
      mergeRuns(source, target, run, descending);
      [source, target] = [target, source];
    }
    numerical.release(source.keys);
    numerical.release(target.keys);
    numerical.release(target.ids);
    return source.ids;
  } catch (error) {
    for (const vector of [source.keys, source.ids, target.keys, target.ids])
      numerical.release(vector);
    throw error;
  }
}
