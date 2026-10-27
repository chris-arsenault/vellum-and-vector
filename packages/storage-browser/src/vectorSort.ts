import type { VectorStorage } from "./vectorStorage";

export const numericalSortRunSamples = 16_384;
function numericOrder(a: number, b: number) {
  if (Number.isNaN(a)) return Number.isNaN(b) ? 0 : 1;
  if (Number.isNaN(b)) return -1;
  if (a === 0 && b === 0) return zeroOrder(a, b);
  return a < b ? -1 : a > b ? 1 : 0;
}
function zeroOrder(a: number, b: number) {
  if (Object.is(a, b)) return 0;
  return Object.is(a, -0) ? -1 : 1;
}
function merge(
  source: VectorStorage,
  target: VectorStorage,
  start: number,
  middle: number,
  end: number,
  compare: (a: number, b: number) => number
) {
  let left = start,
    right = middle;
  for (let out = start; out < end; out++) {
    if (right >= end) target.write(out, source.read(left++));
    else if (left >= middle) target.write(out, source.read(right++));
    else if (compare(source.read(left), source.read(right)) <= 0)
      target.write(out, source.read(left++));
    else target.write(out, source.read(right++));
  }
}
/** Stable external merge sorting retains bounded decoded runs. */
export function sortVector(
  storage: VectorStorage,
  offset: number,
  length: number,
  order: (a: number, b: number) => number = numericOrder
) {
  for (let start = 0; start < length; start += numericalSortRunSamples) {
    const run = storage.readBlock(
      offset + start,
      Math.min(numericalSortRunSamples, length - start)
    );
    run.sort(order);
    storage.writeBlock(offset + start, run);
  }
  if (length <= numericalSortRunSamples) return;
  const working = storage.allocate({
    type: storage.type,
    length,
    lifetime: "process",
    name: "sort",
  });
  const original: VectorStorage = {
    ...storage,
    type: storage.type,
    length,
    read: (i) => storage.read(offset + i),
    write: (i, v) => storage.write(offset + i, v),
    readBlock: (s, n) => storage.readBlock(offset + s, n),
    writeBlock: (s, v) => storage.writeBlock(offset + s, v),
    fill: (s, n, v) => storage.fill(offset + s, n, v),
    allocate: (input) => storage.allocate(input),
    release: () => {},
  };
  let source = original,
    target = working;
  try {
    for (let width = numericalSortRunSamples; width < length; width *= 2) {
      for (let start = 0; start < length; start += width * 2)
        merge(
          source,
          target,
          start,
          Math.min(start + width, length),
          Math.min(start + width * 2, length),
          order
        );
      [source, target] = [target, source];
    }
    if (source !== original)
      for (let start = 0; start < length; start += numericalSortRunSamples) {
        original.writeBlock(
          start,
          source.readBlock(start, Math.min(numericalSortRunSamples, length - start))
        );
      }
  } finally {
    working.release();
  }
}
