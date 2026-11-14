import { mkdirSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import { CellQueue } from "./cellQueue";
import { RecordQueue } from "./recordQueue";
import { radixOrder } from "./radixOrder";
import { BitSet } from "./bitSet";
import { EpochStamps } from "./epochStamps";
import { groupByLabel } from "./groupByLabel";
import { KeyedHeap } from "./keyedHeap";

/** One run per structure against a plain-JS baseline (comparator sort, object binary heap,
 * object array queue, Map of lists). Numbers go to test-results; no assertions on timing.
 * Sizes are small and tile sized, never a full large world. */
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
function floodWithKeyedHeap(n: number, next: () => number) {
  const heap = new KeyedHeap("min");
  for (let i = 0; i < 64; i++) heap.push(i, next());
  let item = 64,
    pops = 0;
  while (heap.size && item < n) {
    heap.pop();
    const key = heap.poppedKey();
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
/** Object binary heap with a comparator closure: the shape the conversion replaced. */
class ObjectHeap<T> {
  private items: T[] = [];
  constructor(private readonly compare: (a: T, b: T) => number) {}
  get count() {
    return this.items.length;
  }
  push(value: T) {
    const items = this.items;
    let at = items.length;
    items.push(value);
    while (at > 0) {
      const parent = (at - 1) >>> 1;
      if (this.compare(value, items[parent]) >= 0) break;
      items[at] = items[parent];
      at = parent;
    }
    items[at] = value;
  }
  pop(): T {
    const items = this.items,
      first = items[0],
      last = items.pop()!;
    if (!items.length) return first;
    let at = 0;
    for (;;) {
      let child = at * 2 + 1;
      if (child >= items.length) break;
      if (child + 1 < items.length && this.compare(items[child + 1], items[child]) < 0) child++;
      if (this.compare(last, items[child]) <= 0) break;
      items[at] = items[child];
      at = child;
    }
    items[at] = last;
    return first;
  }
}
function floodWithObjectHeap(n: number, next: () => number) {
  const heap = new ObjectHeap<{ i: number; d: number }>((a, b) => a.d - b.d || a.i - b.i);
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
  const records = new RecordQueue(2);
  for (let i = 0; i < n; i++) records.push(i, i * 0.5, 1);
  for (let i = records.shift(); i >= 0; i = records.shift()) sum += records.field(0);
  const recordQueue = ms(t);
  t = performance.now();
  // Object records in a plain array drained by index (array shift() is quadratic).
  const objects: { i: number; a: number; b: number }[] = [];
  for (let i = 0; i < n; i++) objects.push({ i, a: i * 0.5, b: 1 });
  for (let head = 0; head < objects.length; head++) sum += objects[head].a;
  const objectRecords = ms(t);
  return { cellQueue, recordQueue, objectRecords, sink: sum };
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

it("records one run of each structure against a plain-JS baseline", () => {
  const results: Record<string, unknown> = {};
  for (const n of sizes) {
    const values = keys(n);
    let t = performance.now();
    radixOrder(values);
    const radix = ms(t);
    t = performance.now();
    Int32Array.from({ length: n }, (_, i) => i).sort((a, b) => values[a] - values[b] || a - b);
    const comparator = ms(t);
    t = performance.now();
    const keyedPops = floodWithKeyedHeap(n, random(1));
    const keyed = ms(t);
    t = performance.now();
    const objectPops = floodWithObjectHeap(n, random(1));
    const objects = ms(t);
    results[n] = {
      order: { radixOrder: radix, comparatorSort: comparator },
      flood: { keyedHeap: keyed, objectHeap: objects, pops: [keyedPops, objectPops] },
      queues: queues(n),
      flags: flags(n),
      grouping: grouping(n),
    };
  }
  mkdirSync("test-results", { recursive: true });
  writeFileSync("test-results/hpc-structures.json", JSON.stringify(results, null, 1));
});
