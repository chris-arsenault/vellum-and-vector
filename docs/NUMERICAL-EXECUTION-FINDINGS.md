# Numerical execution for arbitrary world sizes — findings

Written 2026-10-28 after the storage remediation (commits `7fd8773`..`6ba611c`).
This is a working document for the next plan, not durable architecture.

## Status

The remediation made generation fast only while a world's numerical vectors fit
inside a resident budget. Above the budget the arena silently returns to the
paged Proxy path, and every sample read costs a property trap, a page lookup
and a string key again. The product goal is arbitrary world sizes, so the
budget is not a solution; it moved the cliff.

Numbers from the one-run baselines (node): 1M reads native 4 ms, paged Proxy
324 ms, resident native through the arena 12 ms. Nothing was measured above
the budget because the shared draft world fits inside it.

## What exists now

- `packages/domain/src/numericalVector.ts` — `NumericalVector` is typed to
  look like a typed array: `[index: number]: number` plus the array methods.
  Optional `readBlock`/`writeBlock`/`retain`/`immutable`. Any typed array
  satisfies it, so nothing in the compiler distinguishes resident from paged.
- `packages/storage-browser/src/numericalView.ts` — `NumericalView` wraps a
  `VectorStorage` in a `Proxy` whose `get`/`set` traps parse the property key,
  range-check, and call `storage.read(i)`. Every array method (`map`,
  `slice`, `sort`, iteration) is reimplemented on top of per-sample reads.
- `packages/storage-browser/src/pagedArena.ts` — `PagedArena.allocate` returns
  a native typed array while `resident + bytes <= residentBytes`
  (512 MiB default from `opfsArena.ts`), otherwise a `NumericalView` over
  `PagedStorage` with 16 384-sample pages, a 64 MiB page cache and a scratch
  file. Lifetimes (`process`/`run`), `retain`, `releaseProcess` and
  `releaseUnused` work for both kinds.
- `packages/storage-browser/src/zarrInput.ts` — immutable inputs decode once
  into a resident array when the allocator grants one; otherwise a chunked
  `NumericalView` reads on demand with a 32 MiB decoded-chunk cache.
- `packages/generation/src/generationWorkingState.ts` — process boundaries
  call `numericalProcessLifetime`, which releases process-lifetime vectors
  not reachable from the state after each process. Copies between runs use
  `vector.slice()`.
- `packages/generation/src/canonry/numericalQueue.ts`, `numericalList.ts`,
  `numericalOrder.ts`, `queueStorage.ts` — queues, lists and orderings are
  already chunked (16 384 samples) and release consumed chunks. They index
  their chunks with `values[i]`, so they inherit the Proxy cost when paged.

## Inventory of the generation package

- 44 867 non-test lines; 183 files contain loops; 56 allocation sites use
  `allocateNumerical`/`generateNumerical`; 1 call site uses `readBlock`.
- Access shape is `vector[i]` everywhere, including mesh adjacency:
  `mesh.neighbors[i * stride + edge]`, `mesh.degree[i]` (`canonry/mesh.ts`).
- The densest files by loop count: `metricMultigrid`, `magicHallowed`,
  `magicStocks`, `magicFeedback`, `magicSources`, `magicPropagation`,
  `regionGroups`, `metricSmoothing`, `geography`, `riverPaths`, `oceanGyres`,
  `mesh`, `landmarkCanyon`, `landforms`, `ecologyFeatures`, `currents`.
- Three classes of code, which need different treatment:
  1. **Local passes**: one output sample from a few input samples at the same
     index. Blockable: read a block, compute, write a block. Most magic,
     climate, ecology and metric smoothing loops are this shape.
  2. **Neighbor passes**: each cell reads its mesh neighbors
     (`hillslopeFlux`, `metricOperator`, `metricMultigrid`, `advection`,
     `currents`). Blockable only if adjacency and the neighbor values are
     resident or fetched by block with a halo; otherwise random access.
  3. **Connected passes**: flood fills, priority floods, drainage routing,
     component labelling, gyres, region groups, lake stages, face walks
     (`routing`, `drainageFlood`, `flowGraph`, `lakes`, `lakeStage`,
     `oceanComponents`, `regionGroups`, `marineRegions`, `orogenicComponents`,
     `coastalFrame`). Inherently random access over the whole mesh.

## What meeting the goal requires

1. **Make paged access explicit and trap-free.** Give paged vectors a real
   method surface (`get(i)`, `set(i, v)`, `block(start, count)`,
   `write(start, block)`) and stop satisfying `[index: number]` for them. The
   type system then flags every `v[i]` on a paged vector at compile time,
   which is how the 183 files get found and converted without guessing.
   Resident arrays keep native indexing.
2. **Block helpers for local passes.** A small set of iterators in the
   generation package (`forEachBlock(vectors, fn)`, `mapBlock`) that pull
   native blocks from any vector, run the body on native arrays, and write
   outputs back. Local passes convert to these and run at native speed at any
   size.
3. **Neighbor passes with resident adjacency.** Mesh adjacency
   (`neighbors`, `degree`, `edgeLength`, coordinates) is read by every
   neighbor and connected pass; it should be resident and typed, sized at
   `count * 3` int32 plus a few float64 columns. Decision needed on whether
   adjacency itself must page for the largest worlds or whether its size is
   the one accepted bound.
4. **Connected passes on the explicit paged accessor.** They keep random
   access, use `get`/`set` with the page cache, and accept a slowdown over
   native. The cache must be sized for their working set (frontier plus
   touched pages), which is a parameter to tune per pass, not a global.
5. **Conversion order.** Local passes first (largest count, mechanical),
   neighbor passes second, connected passes last. The shared draft generation
   in node (`frontend/vitest.generation.config.ts`, ~4 minutes) is the gate
   after each process; `numericalProcess.test.ts` already runs a physical
   pipeline on a tiny paged arena and should be extended per converted pass.

## Decisions for the user

- Whether to keep a resident budget at all once blocks exist, or run paged
  always and let the page cache be the only memory bound.
- Whether mesh adjacency may stay resident (simplest) or must page.
- The acceptable slowdown for connected passes relative to native, which sets
  the page-cache sizes and whether any connected pass needs an algorithmic
  change (for example tiled priority floods).
- Whether to introduce a distinct `PagedVector` type now (compiler finds every
  site) or convert file by file behind the current `NumericalVector` type.
- Process conversion order within each class, since several processes share
  helpers in `canonry/field.ts`, `physicalMetric.ts` and `physicalNumerics.ts`.

## Risks

- The conversion touches the algorithms the Canonry notes treat as design, so
  numerical results may change; the shared generation's assertions are the
  only automated check on causal outcomes.
- `NumericalView` reimplements `map`, `filter`, `slice`, `sort` and iteration
  on per-sample reads; code relying on those on paged vectors must move to
  blocks or it will stay slow even after indexing is fixed.
- Queues and orderings index their chunks with `[i]`; they need the explicit
  accessor too, or connected passes pay the trap on every push and shift.
- `generationWorkingState.copyWorkingState` copies every vector with
  `slice()` between runs, which is a full read of the world on the paged path.
