# Data structures for generation — requirements, research, design, results

Written 2026-10-28. Working document for the "Browser HPC data structures for
generation" plan. The structures live in `packages/domain/src/hpc/`; this file
records why they have the shape they have and what remains.

## 1. Requirements from this codebase

Source: `packages/generation/src` (44 867 non-test lines). Loops were
classified by what they touch and representative passes were read in full
(`floodplains`, `channelGeometry`, `landIce`, `lakeStage`, `marineRegions`,
`regionGroups`, `hillslopeFlux`, `magicFeedback`, `magicPropagation`,
`drainageFlood`, `metricSearch`, `oceanComponents`, `routing`, `mesh`,
`adaptiveMeshFaces`, `metricOperator`, `metricMultigrid`).

Seven access patterns cover the generation code:

- **R1 cell columns.** `map.X[i]` over tens of named columns per cell; 290
  scratch columns allocated through the arena with process or run lifetime.
- **R2 padded adjacency.** `neighbors[i*stride+edge]` for `edge < degree[i]`
  with per-edge `edgeLength`, `faceLength`, `faceDistance`, `edgeX/Y`. Right
  shape; coordinates are the exception (a Proxy allocating an object per read,
  and a string-keyed `Map` in the reference mesh).
- **R3 frontiers.** Plain FIFOs of cells; record FIFOs with named float
  fields that allocate an object per pop; 16 priority sites with comparator
  closures and object entries. Nearly all priority uses are monotone (flood,
  propagation, Dijkstra, merge-by-size) and skip stale entries by comparing
  the popped key with the column, so no decrease-key is needed. One bounded
  top-k is the non-monotone exception.
- **R4 orderings.** `orderedIndices(keys, descending)` at 12 sites, consumed
  as `for (const i of order)`; comparator sorts of member lists.
- **R5 grouping.** Union-find on an int parent column; members-by-root through
  `Map` of lists; a fresh `Set` of neighbour roots per activated cell.
- **R6 flags and resets.** 37 byte flag columns; 138 whole-column fills at
  pass start.
- **R7 append lists and edge tables.** `NumericalList` at 44 sites; the face
  table in `hillslopeFlux` with a slot per directed edge, a ring worklist and
  an object per face visit.

## 2. Platform and memory model

Browser dedicated worker, single thread. Typed arrays are the only fast path;
mixed element kinds or an out-of-bounds read slow a site permanently.
`BigInt64Array` allocates per read; bit operations exist only on 32 bits.
Arbitrary world size will be reached by tiling with seams, so a structure's
working set is a tile, not the world: structures are resident typed arrays
that grow by doubling, with no paging of their own. Growth, `transfer`,
`SharedArrayBuffer`, `Atomics`, Float16 and wasm SIMD were surveyed; none is
required here.

## 3. Patterns borrowed

From Canonry (different product, language and constraints): struct-of-arrays
columns, padded adjacency, a monotone radix heap in place of a comparison
heap, LSD radix ordering with ping-pong index arrays, epoch-stamped scratch.
From the Priority-Flood literature: entries equal to the current minimum go to
a FIFO lane drained before the buckets. From graph practice: CSR grouping,
preallocated int queues, bitset flags.

## 4. Research notes

- Native typed-array `sort()` without a comparator is 4–8× faster than
  `Array.sort` _(MeasureThat)_; LSD radix on `Uint32Array` beat it by about
  4× in the one measured study _(Duvanenko 2019)_.
- A one-level radix heap uses about log C buckets with bucket = bit width of
  `key XOR lastMin`; O(1) push, amortized O(log C) pop _(LEMON, Rust
  radix-heap, 2024 survey)_. No typed-array JavaScript implementation existed.
- Dense integer keys need no hashing; open-addressing int maps are a later
  option if a sparse key shows up.
- `-0`, `NaN` and the IEEE sign-flip transform are the only subtleties in
  ordering float keys as integers.

## 5. The structures

All in `packages/domain/src/hpc/`, exported from `@atlas/domain`. Typed
arrays only; no per-entry objects, string keys, Proxies or comparator closures.

| Structure                        | Requirement | Replaces                                                                | Shape                                                                                                                                                                                                                                                    |
| -------------------------------- | ----------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CellQueue`                      | R3          | `NumericalQueue`, hand-rolled int queues                                | one `Int32Array` ring, doubling growth; `push`, `shift` (-1 when empty)                                                                                                                                                                                  |
| `RecordQueue`                    | R3          | `NumericalRecordQueue`                                                  | cell ring plus up to four `Float64Array` field rings; `shift()` returns the cell, `field(k)` reads its fields; no record object                                                                                                                          |
| `MonotoneHeap`                   | R3          | `PriorityQueue` in flood, propagation, metric search, merge-groups, ice | radix heap: float64 keys as ordered `(hi, lo)` 32-bit halves, 64 buckets by `Math.clz32` of the differing half, a FIFO lane for keys equal to the minimum; min or max order; `pop()` returns the item and `key()` its key; throws on a non-monotone push |
| `KeyedHeap`, `TopK`              | R3          | `BoundedCandidates`, non-monotone needs                                 | binary heap on `Int32Array` items and `Float64Array` keys with index tie rules; `TopK` keeps the k strongest                                                                                                                                             |
| `radixOrder`                     | R4          | `orderedIndices`, comparator sorts of indices                           | eight stable byte passes over the ordered key bits with constant-byte passes skipped; descending keeps ties ascending                                                                                                                                    |
| `CellList`, `FloatList`          | R7          | `NumericalList`                                                         | growable typed array, `finish()` is a view, native `sort()`                                                                                                                                                                                              |
| `UnionFind`                      | R5          | `MarineWatershed`, `OceanComponents`, `regionGroups.root`               | parent and size columns, path halving, `union` by size or `attach` by the caller's rule                                                                                                                                                                  |
| `groupByLabel`                   | R5          | `Map<number, NumericalList>`, hand-built offsets                        | counting sort of a labels column into CSR `offsets`/`members`                                                                                                                                                                                            |
| `SmallIntSet`                    | R5          | per-cell `new Set<number>()`                                            | linear-scan `Int32Array`                                                                                                                                                                                                                                 |
| `BitSet`                         | R6          | `uint8` flag columns                                                    | one bit per index, SWAR popcount, `nextSet`                                                                                                                                                                                                              |
| `EpochStamps`                    | R6          | `fill(-1)` resets                                                       | stamps column with an epoch counter; `begin()` is O(1); optional paired values                                                                                                                                                                           |
| `EdgeTable`                      | R7          | the face table and slots in `hillslopeFlux`                             | faces listed once as `from`/`to` columns, a slot per directed edge, named float columns                                                                                                                                                                  |
| `Worklist`                       | R7          | ring queue plus `queued` flags                                          | `CellQueue` plus `BitSet`; each index held once                                                                                                                                                                                                          |
| `orderedHi/Lo`, `keyFromOrdered` | —           | —                                                                       | the key transform shared by the heap and the ordering                                                                                                                                                                                                    |

Not built: `LatticeIndex` (it needs `latticeRows` from the generation package
and belongs there when the coordinate Proxy is removed), a general int map,
block iteration over columns, SIMD, shared memory.

Decisions taken: structures own plain typed arrays and are GC-managed
(the arena's lifetimes apply to columns, not to transient structures); pops
return the item and expose the key or fields by accessor; float keys are
ordered exactly through their bits with `-0` treated as `0`; adjacency stays
as the loose fields on `PhysicalMesh` for now, with `EdgeTable` consuming that
shape through the `PaddedAdjacency` interface.

## 6. Results (one run, node, `test-results/hpc-structures.json`)

The baselines are plain JS shapes written inline in the perf test (comparator
sort of an index array, an object binary heap with a comparator closure, an
object array drained by index, a `Map` of arrays); the earlier chunked
substitutes are deleted. Run after the conversion landed.

| Workload                      | n              | New                                       | Baseline               |
| ----------------------------- | -------------- | ----------------------------------------- | ---------------------- |
| Order 1M float keys           | 1 000 000      | `radixOrder` 110 ms                       | comparator sort 451 ms |
| Order 10k float keys          | 10 000         | 5 ms                                      | 3 ms                   |
| Flood-shaped push/pop         | 1 000 000 pops | `KeyedHeap` 214 ms, `MonotoneHeap` 457 ms | object heap 787 ms     |
| Flood-shaped push/pop         | 10 000 pops    | `KeyedHeap` 4 ms, `MonotoneHeap` 9 ms     | object heap 4 ms       |
| Record FIFO push/shift        | 1 000 000      | `RecordQueue` 27 ms                       | object records 40 ms   |
| Cell FIFO push/shift          | 1 000 000      | `CellQueue` 21 ms                         |                        |
| 10 resets and sparse marks    | 1 000 000      | `EpochStamps` 6 ms, `BitSet` 9 ms         | `Uint8Array.fill` 3 ms |
| Members by label, 1000 labels | 1 000 000      | `groupByLabel` 7 ms                       | `Map` of arrays 28 ms  |

Read plainly: the ordering, the grouping and the record queue are clear wins
at scale and a wash at 10k, where the first-measured structure also pays JIT
warm-up in this single-run protocol. The binary heap on typed columns beats
the radix heap on this flood shape at both sizes: the radix heap's bucket
refills cost more than the comparison heap's sifts save, so generation uses
`KeyedHeap` everywhere and `MonotoneHeap` stays in the library as the
monotone option without a current user. Byte fills are faster than bitsets at
this density, so `BitSet` earns its place on memory and `nextSet`, not on
marking speed. `radixOrder` runs eight byte passes; 16-bit digits (four
passes, 65 536 counts) are the obvious tuning if ordering shows up in a profile.

## 7. Adoption check

`make test-architecture` runs `packages/generation/src/hpcAdoption.architecture.ts`,
which prints every site that still uses a substitute shape with file, line and
replacement, and passes when there are none. It is part of `make ci`. Rules
flag `new PriorityQueue`, `BoundedCandidates`, `orderedIndices(`,
`new NumericalQueue(`, `new NumericalRecordQueue<`, `new NumericalList(`,
`.coords[`, and, inside `canonry/`, `new Map<number,`, `new Set<number>`,
comparator `.sort((` and `JSON.stringify(`. A site that no structure fits
carries `// hpc-exempt: <reason>` on its line or the line before; the current
exemptions are sorts and tables over feature, region and seeded-candidate
records, a few dozen to a few hundred objects handled once.

## 8. Conversion

The conversion landed in six commits after this document's first version. The
substitute modules (`numericalQueue.ts`, `numericalList.ts`, `priorityQueue.ts`,
`numericalOrder.ts`, `queueStorage.ts`) are deleted. Where a structure changed
behaviour rather than only representation:

- Lattice addresses are three columns (`coordU`, `coordV`, `coordInverted`)
  and a dense address table; adaptive meshes carry empty columns and an index
  that answers `undefined`.
- `coastDistances` (magic ocean) and `oceanPathDistance` (gyres) had no tie
  order; `KeyedHeap` breaks their ties by ascending cell. Only the distances
  are consumed, so results are unchanged.
- Candidate lists that had no tie order (`landmarkCanyon` rivers near a head,
  ocean magic sources) now break ties by ascending cell through `radixOrder`.
- Lake membership and marine regions group by label in one counting pass;
  marine region records stay in a small `Map` keyed by watershed root.
- `metricSearch` no longer takes an allocator; frontiers are resident
  typed arrays and are never paged.

## Sources

- V8, [Elements kinds in V8](https://v8.dev/blog/elements-kinds)
- MDN, [ArrayBuffer.prototype.transfer](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/ArrayBuffer/transfer), [Atomics](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Atomics), [Float16Array](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Float16Array)
- web-features, [Resizable buffers](https://web-platform-dx.github.io/web-features-explorer/features/resizable-buffers)
- Chrome, [Synchronous methods for access handles](https://developer.chrome.com/blog/sync-methods-for-accesshandles)
- Barnes, Lehman, Mulla, [Priority-Flood](https://ar5iv.labs.arxiv.org/html/1511.04463)
- [Exploring Monotone Priority Queues for Dijkstra Optimization](https://arxiv.org/html/2409.06061v2)
- Wikipedia, [Radix heap](https://en.wikipedia.org/wiki/Radix_heap); LEMON [radix_heap.h](https://lemon.cs.elte.hu/trac/lemon/export/3b544a9c92db4c654d06009f6eb0ffacff2d5392/lemon/lemon/radix_heap.h); Rust [radix-heap](https://docs.rs/radix-heap/)
- Duvanenko, [Faster JavaScript Sorting Using Typed Arrays](https://duvanenko.tech.blog/2019/04/14/faster-javascript-sorting-using-typed-arrays/); JobLeonard, [Radix sorts for TypedArrays](https://gist.github.com/JobLeonard/eb482c82dfa0a5b78688109652ab8f68)
- MeasureThat, [Int32Array.sort vs Array.sort](https://measurethat.net/benchmarks/Show/20538/0/int32arraysort-vs-arraysort), [typed vs plain array access](https://measurethat.net/Benchmarks/Show/12331/0/item-getting-in-typed-array-vs-simple-array)
- StackBlitz, [Cross-origin isolation](https://blog.stackblitz.com/posts/cross-browser-with-coop-coep/); Mozilla intents for [Relaxed SIMD](https://groups.google.com/a/mozilla.org/g/dev-platform/c/x5x86TnmVh8/m/1onhzF7iAwAJ) and [memory64](https://groups.google.com/a/mozilla.org/g/dev-platform/c/I-MywEnFxKc); WebKit [Memory64 bug](https://bugs.webkit.org/show_bug.cgi?id=300538)
- Sethi, [Data locality beats algorithmic complexity](https://ankursethi.com/blog/data-locality-sometimes-beats-algorithmic-complexity/); Go [intmap](https://github.com/paul1r/intmap)
- Canonry at `0f62584c`: `PhysicalGeographyGrid.cs`, `MonotoneRadixPriorityQueue.cs`, `IntegerKeyOrdering.cs`, `PriorityFlood.cs`, `EpochStampedArray.cs`
