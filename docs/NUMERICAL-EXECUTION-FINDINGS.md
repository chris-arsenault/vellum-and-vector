# Numerical execution for arbitrary world sizes — findings

Written 2026-10-28 after the storage remediation (commits `7fd8773`..`6ba611c`),
revised the same day after the typed-array structures landed
(`607f7ac`..`a14f516`). This is the findings ledger behind the world coverage
plan (Sulion `2f2eee37`); the base data structure design is
`WORLD-COVERAGE-DESIGN.md`. Not durable architecture: mechanisms that land
move to ADR 0003 and the generation design at closeout.

## Status

The storage remediation made generation fast only while a world's numerical
vectors fit inside a resident budget (`numericalResidentBytes`, 512 MiB in
`packages/storage-browser/src/pagedArena.ts`). Above the budget the arena
silently returns to the paged Proxy path, and every sample read costs a
property trap, a page lookup and a string key again. The product goal is
arbitrary world sizes, so the budget is not a solution; it moved the cliff. The
cliff has not been measured: the shared draft world fits, and nothing above the
budget has been run.

One-run numbers from the storage baselines (node): 1M reads native 4 ms, paged
Proxy 324 ms, resident native through the arena 12 ms.

Since the first version of this document the generation package's queues,
lists, heaps, orderings and cell-keyed collections were replaced by the
resident typed-array structures in `packages/domain/src/hpc`
(`HPC-DATA-STRUCTURES-FINDINGS.md`). They never go through the allocator, so the
frontier side of every connected pass is already off the Proxy path. What
remains on it is the field columns themselves: every `vector[i]` on a
`PhysicalField` channel, the mesh columns, and the working arrays.

## Ledger of the original findings

The 2026-10-28 structural review named nine findings. The storage plan
(`1830dffc`) fixed most of them; this plan owns what it left. Dispositions are
from the plan's phase notes and the current source, not from the phase titles.

| #   | Finding                                                                     | Disposition                                                                                                                                                                                                                              | Owner here   |
| --- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 1   | Every numerical sample read goes through a Proxy trap                       | **Partial.** Native typed arrays within the 512 MiB resident budget; the Proxy path returns above it. Zero `readBlock` call sites in generation. The shared node generation never runs above the budget.                                 | P0–P4, P6    |
| 2   | Catalog write derives every index eagerly, per record, hooks run twice      | Fixed (M3, `d7b4736`): writes no longer derive; one upsert plus bounds. **Residual:** `geometryKernel.ts` still runs `GEOSisValid` on every conversion unless `validate` is false; confirm query rectangles skip it.                     | P5           |
| 3   | Five geometry indexes with separate invalidation                            | Fixed (M3): `GeometryDerivations` is the one lazy owner. Region picking derives on first visit by design.                                                                                                                                | closed       |
| 4   | Feature presentation is an N+1 projection                                   | Fixed (M4, `fb4a22c`): one context per page, per-feature cache keyed by revision.                                                                                                                                                        | closed       |
| 5   | Reads trigger write transactions through a mutable callback                 | Fixed (M3): prepare hook removed; tiles prepare explicitly.                                                                                                                                                                              | closed       |
| 6   | `SpatialStore` is not what anything consumes                                | Fixed (M5, `3a40899`): one typed catalog call plus 14 lifecycle operations. **Residual:** a hosted adapter has not been written against the collapsed surface, so "consumed only" is asserted, not demonstrated.                         | out of scope |
| 7   | One serial worker; publication queues behind pans                           | **Partial** (M5): two-lane scheduler, interactive first. A second SQLite connection from the generation worker is impossible (OPFS sync handles are exclusive per file), so publication still runs on the catalog worker in idle slices. | P5 (verify)  |
| 8   | Generation moves each feature through five encodings                        | **Deferred** (M5 note): records still pass through the private CBOR scratch store, structured clone across the port, and WKB. The CBOR store carries protection and identity semantics and was left in place.                            | P5           |
| 9   | One OPFS pool per world and per save, kept forever; root discovery off-lock | Fixed (M1, `7fd8773`): roots discovered under the catalog worker's lock; paused VFS releases handles.                                                                                                                                    | closed       |

Also deferred by the storage plan and carried here: Safari and large-world
measurements were declared separate evidence, not closeout gates. This plan's
gate runs the shared node generation on a paged arena with the budget forced
below the world's needs, which is the large-world evidence that matters.

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
  a native typed array while `resident + bytes <= residentBytes`, otherwise a
  `NumericalView` over `PagedStorage` with 16 384-sample pages, a 64 MiB page
  cache and a scratch file. Lifetimes (`process`/`run`), `retain`,
  `releaseProcess` and `releaseUnused` work for both kinds.
- `packages/storage-browser/src/zarrInput.ts` — immutable inputs decode once
  into a resident array when the allocator grants one; otherwise a chunked
  `NumericalView` reads on demand with a 32 MiB decoded-chunk cache.
- `packages/generation/src/generationWorkingState.ts` — process boundaries
  call `numericalProcessLifetime`, which releases process-lifetime vectors
  not reachable from the state after each process. Copies between runs use
  `vector.slice()`, a full read of the world on the paged path.
- `packages/domain/src/hpc` — resident structures for frontiers, lists,
  orderings, grouping and marks. `MonotoneHeap` and `EdgeTable` have no users:
  the keyed heap won the one-run flood comparison, and mesh adjacency still
  lives as loose columns on `PhysicalMesh` (`neighbors`, `degree`,
  `edgeLength`, `coordU/V/Inverted`).
- Mesh columns are allocated through the arena with `lifetime: "run"`
  (`canonry/worldMesh.ts`), so above the budget adjacency itself pages.

## Inventory of the generation package

- 44 867 non-test lines; 183 files contain loops; 56 allocation sites use
  `allocateNumerical`/`generateNumerical`; 0 call sites use `readBlock`.
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
     `coastalFrame`). Their frontiers are now resident structures; their
     random access is to field columns and adjacency.

## Plan

The plan is Sulion `2f2eee37`, "World coverage: data structures, adoption,
algorithms, defects". Its phases: D1 lattice; D2 bands, block cache and
coverage; A1 schema and mesh adoption; A2 local and stencil passes; A3
connected passes; F1 restructure global-shape algorithms; F2 delete replaced
code and consolidate; X1 the deferred storage findings in the ledger above;
X2 gate and close. The design those phases build is `WORLD-COVERAGE-DESIGN.md`.
An earlier version of this document proposed a paged vector wrapper and a
tile-bounded size model; both were withdrawn because they kept the paging
accident and invented a requirement the user had not stated.

## Risks

- The adoption touches the algorithms the Canonry notes treat as design, so
  numerical results may change; the shared generation's assertions are the
  only automated check on causal outcomes.
- Code relying on `map`, `filter`, `slice` or `sort` on numerical vectors
  must move to block iteration; the coverage does not reimplement them.
- The typecheck storm when bands stop satisfying `[index]` is large (183
  files); A1 lands the schema first so the tree converts one process class at
  a time.
- Society generation has its own performance plan (`09693b37`, concurrent
  language diffusion on the default world); its grid becomes a coverage here,
  its algorithms stay there.
