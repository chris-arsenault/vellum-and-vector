import { mkdirSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import { CellQueue } from "./cellQueue";
import { RecordQueue } from "./recordQueue";
import { MonotoneHeap } from "./monotoneHeap";
import { radixOrder } from "./radixOrder";
import { BitSet } from "./bitSet";
import { EpochStamps } from "./epochStamps";
import { groupByLabel } from "./groupByLabel";
import { PriorityQueue } from "../../../generation/src/canonry/priorityQueue";
import {
  NumericalQueue,
  NumericalRecordQueue,
} from "../../../generation/src/canonry/numericalQueue";
import { orderedIndices } from "../../../generation/src/canonry/numericalOrder";

/** One run per structure against the current substitute. Numbers go to test-results; no
 * assertions on timing. Sizes are small and tile sized, never a full large world. */
const sizes = [10_000, 1_000_000];
const ms = (t: number) => Math.round((performance.now() - t) * 10) / 10;
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
function keys(n: number) {
  const next = random(n),
    values = new Float64Array(n);
  for (let i = 0; i < n; i++) values[i] = next() * 1e6;
  return values;
}
/** Flood shape: pop, then push up to two neighbours at a key at or above the popped key. */
function floodWithMonotone(n: number, next: () => number) {
  const heap = new MonotoneHeap("min");
  for (let i = 0; i < 64; i++) heap.push(i, next());
  let item = 64,
    pops = 0;
  while (heap.size && item < n) {
    heap.pop();
    const key = heap.key();
    heap.push(item++, key + next());
    if (next() < 0.5) heap.push(item++, key + next());
    pops++;
  }
  while (heap.size) {
    heap.pop();
    pops++;
  }
  return pops;
}
function floodWithBinaryHeap(n: number, next: () => number) {
  const heap = new PriorityQueue<{ i: number; d: number }>(
    (a, b) => a.d - b.d || a.i - b.i,
    undefined,
    ["i", "d"]
  );
  for (let i = 0; i < 64; i++) heap.push({ i, d: next() });
  let item = 64,
    pops = 0;
  while (heap.count && item < n) {
    const { d } = heap.pop();
    heap.push({ i: item++, d: d + next() });
    if (next() < 0.5) heap.push({ i: item++, d: d + next() });
    pops++;
  }
  while (heap.count) {
    heap.pop();
    pops++;
  }
  return pops;
}
function queues(n: number) {
  let t = performance.now();
  const cells = new CellQueue();
  for (let i = 0; i < n; i++) cells.push(i);
  let sum = 0;
  for (let i = cells.shift(); i >= 0; i = cells.shift()) sum += i;
  const cellQueue = ms(t);
  t = performance.now();
  const numerical = new NumericalQueue();
  for (let i = 0; i < n; i++) numerical.push(i);
  for (let i = numerical.shift(); i !== undefined; i = numerical.shift()) sum += i;
  const numericalQueue = ms(t);
  t = performance.now();
  const records = new RecordQueue(2);
  for (let i = 0; i < n; i++) records.push(i, i * 0.5, 1);
  for (let i = records.shift(); i >= 0; i = records.shift()) sum += records.field(0);
  const recordQueue = ms(t);
  t = performance.now();
  const recordNumerical = new NumericalRecordQueue<{ i: number; a: number; b: number }>([
    "i",
    "a",
    "b",
  ]);
  for (let i = 0; i < n; i++) recordNumerical.push({ i, a: i * 0.5, b: 1 });
  for (let r = recordNumerical.shift(); r; r = recordNumerical.shift()) sum += r.a;
  const numericalRecordQueue = ms(t);
  return { cellQueue, numericalQueue, recordQueue, numericalRecordQueue, sink: sum };
}
function flags(n: number) {
  let t = performance.now();
  const bits = new BitSet(n);
  for (let round = 0; round < 10; round++) {
    bits.clearAll();
    for (let i = 0; i < n; i += 3) bits.set(i);
  }
  const bitSet = ms(t);
  t = performance.now();
  const bytes = new Uint8Array(n);
  for (let round = 0; round < 10; round++) {
    bytes.fill(0);
    for (let i = 0; i < n; i += 3) bytes[i] = 1;
  }
  const uint8Fill = ms(t);
  t = performance.now();
  const stamps = new EpochStamps(n);
  for (let round = 0; round < 10; round++) {
    stamps.begin();
    for (let i = 0; i < n; i += 3) stamps.mark(i);
  }
  const epochStamps = ms(t);
  return { bitSet, uint8Fill, epochStamps };
}
function grouping(n: number) {
  const labels = new Int32Array(n);
  const next = random(5);
  for (let i = 0; i < n; i++) labels[i] = Math.floor(next() * 1000);
  let t = performance.now();
  const groups = groupByLabel(labels, 1000);
  const csr = ms(t);
  t = performance.now();
  const map = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    let list = map.get(labels[i]);
    if (!list) map.set(labels[i], (list = []));
    list.push(i);
  }
  const mapOfLists = ms(t);
  return { csr, mapOfLists, sink: groups.members.length + map.size };
}

it("records one run of each structure against its substitute", () => {
  const results: Record<string, unknown> = {};
  for (const n of sizes) {
    const values = keys(n);
    let t = performance.now();
    radixOrder(values);
    const radix = ms(t);
    t = performance.now();
    orderedIndices(values);
    const comparator = ms(t);
    t = performance.now();
    const monotonePops = floodWithMonotone(n, random(1));
    const monotone = ms(t);
    t = performance.now();
    const binaryPops = floodWithBinaryHeap(n, random(1));
    const binary = ms(t);
    results[n] = {
      order: { radixOrder: radix, orderedIndices: comparator },
      flood: {
        monotoneHeap: monotone,
        binaryHeapObjects: binary,
        pops: [monotonePops, binaryPops],
      },
      queues: queues(n),
      flags: flags(n),
      grouping: grouping(n),
    };
  }
  mkdirSync("test-results", { recursive: true });
  writeFileSync("test-results/hpc-structures.json", JSON.stringify(results, null, 1));
});
