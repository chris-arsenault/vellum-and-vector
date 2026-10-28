# World coverage: the base numerical data structures

Design document, 2026-10-28. For review before any implementation. It replaces
the numerical half of the earlier findings documents; the storage review's
deferred findings stay in `NUMERICAL-EXECUTION-FINDINGS.md` until this design
is accepted and planned.

## 1. What the application holds

Every numerical thing in the atlas is a value per cell of a lattice:

| Holder                          | Lattice                                 | Bands (today)                                                            | Written by                          |
| ------------------------------- | --------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------- |
| Physical field (`field.ts`)     | world triangular lattice or region mesh | ~180 named columns: int32 codes/ids, float64 elevations/metrics, float32 | ~55 physical processes, each epoch  |
| Magic state (`magicState.ts`)   | same                                    | ~23 columns per system, seven systems                                    | magic processes, each epoch         |
| Ecology (`ecologyState.ts`)     | same                                    | ecology scalars inside the field                                         | ecology processes                   |
| Society (`societyGeography.ts`) | rectangular grid                        | owner, distances, works, populations                                     | society processes                   |
| Working arrays (`workingArray`) | same as the owner                       | 163 call sites, process lifetime                                         | any process                         |
| Mesh (`PhysicalMesh`)           | the lattice itself                      | positions, areas, adjacency, edge metrics, lattice addresses             | mesh construction, then read-only   |
| Committed resources (Zarr/OPFS) | one per published area                  | one 1-D array per published channel, chunked                             | publication; read by later runs, UI |
| Parent → child samples          | child lattice                           | projection samples: cells and weights, CSR                               | region refinement, raster rendering |

Three access shapes cover every process: a **local pass** reads and writes a
few bands at the same cell; a **stencil pass** reads a cell's lattice
neighbours; a **connected pass** walks the lattice through a frontier (floods,
routing, components, gyres, groups). Frontiers and scratch are the resident
structures in `packages/domain/src/hpc`. Everything else above is a band.

The world lattice is a regular triangular lattice: a cell is `(u, v, inverted)`
on rows, with a content footprint and a halo, optionally periodic in x with
polar rows. A region lattice is an adaptive quadtree of leaves with stored
adjacency. Regions nest arbitrarily; a child reads its parent through
interpolation samples and publishes its own resource; the parent is
authoritative at its mesh (ADR 0005).

Sizes: Draft 800, Standard 200, Fine 50 km² per cell. The default map is 7 500
cells at Draft and 120 000 at Fine; a 10 000 × 8 000 km Fine map is 1.6 M cells;
the stated goal is any size. At roughly 1 KB of bands per cell the resident
budget of 512 MiB holds about half a million cells; beyond that today every
read is a Proxy trap.

## 2. The design in one paragraph

The world is a **coverage**: a lattice plus a schema of typed **bands**, where
every band is stored as fixed-size spatial **blocks** and a cell id is
`(block, offset)`. Blocks are the unit of residency, of storage chunks, of
iteration and of tiling. A band's block is a native typed array when resident
and `null` when evicted; a read is two array indexings, never a trap. A small
world is fully resident and pays nothing beyond the second indexing; a large
world is served by a block cache that evicts to scratch or reloads from the
committed resource, under the same code. Regions are coverages on their own
lattices, linked to their parent by footprint and resampling. Nothing numerical
exists outside a coverage except the resident hpc structures.

## 3. Structures

### 3.1 Lattice

A lattice defines cells, their geometry, their adjacency and their blocking.
Two implementations behind one interface:

```ts
interface Lattice {
  readonly kind: "triangular" | "adaptive";
  readonly count: number; // cells, including nodata cells inside blocks
  readonly blockShift: number; // block = 1 << blockShift cells (14 → 16 384)
  readonly blockCount: number;
  readonly frame: Frame; // CRS origin, spacing, periodic width, polar rows
  position(i: number): [number, number];
  area(i: number): number;
  degree(i: number): number; // 3 on the triangular lattice
  neighbor(i: number, edge: number): number; // -1 off-lattice
  edgeLength(i: number, edge: number): number;
  cellAt(x: number, y: number): number; // point → cell, -1 outside
  blockBounds(block: number): Bounds; // spatial extent, for windows and tiling
  blockCells(block: number): number; // live cells in the block (0 → block absent)
}
```

**Triangular lattice.** Cells are numbered block-major over a rectangle of
lattice rows and columns: a block is a `rows × columns` rectangle of lattice
slots; `offset` encodes `(row, column, inverted)` inside it. Adjacency, lattice
address, position and area are **arithmetic on the id**; no stored columns.
Periodic x and polar rows are modular arithmetic in `neighbor`. The footprint
and halo become a **mask band** (`content` = 1 content, 2 halo, 0 nodata), and
blocks wholly outside the halo are absent. This deletes `coordU/V/Inverted`,
the address table, `neighbors`, `degree`, `edgeLength`, `edgeX/Y`,
`faceLength`, `faceDistance`, `cellWidth/Height`, `boundary`, `x`, `y`,
`areas` as stored columns on the world mesh.

**Adaptive lattice.** Leaves in Morton order over the quadtree, so a block is a
spatially compact Morton range. Adjacency is stored: an `offsets` band
(int32, per cell) and a neighbour table blocked by cell, plus edge metrics;
these are ordinary bands on the lattice and page like any other. Positions
and areas derive from the quadtree boxes.

Both lattices keep the ordering invariant that matters to the algorithms:
**cells close in space are close in id.** That is what makes block residency
match a frontier's working set.

### 3.2 Band

```ts
interface BandSchema {
  name: string;
  type: "float64" | "float32" | "int32" | "uint16" | "uint8";
  units?: string;
  nodata?: number;
  lifetime: "run" | "epoch" | "process";
  retained: boolean; // carried across epochs (histories) or recomputed
  published: boolean; // written to the committed resource
}
class Band {
  readonly schema: BandSchema;
  private blocks: (TypedArray | null)[]; // one entry per lattice block, same type throughout
  get(i: number): number; // blocks[i >>> shift] ?? load; [i & mask]
  set(i: number, value: number): void; // marks the block dirty
  block(b: number): TypedArray; // pinned native block for the caller's loop
  release(b: number): void;
  fill(value: number): void; // per block, absent blocks stay absent
}
```

A band belongs to one lattice and one coverage. Its blocks are independent:
the cache evicts band-blocks, not whole cells, so a connected pass that reads
three bands keeps three bands' blocks warm, not 180. A band created from a
committed resource starts with every block absent and loads blocks from the
resource's chunks, which are the same size and order. A band snapshot is
copy-on-write: the new band shares the old blocks until it writes one.

### 3.3 Coverage

```ts
class Coverage {
  readonly lattice: Lattice;
  readonly schema: Map<string, BandSchema>; // registered by physical, magic, ecology, society
  band(name: string): Band;
  scratch(type, name): Band; // lifetime "process", from the pool
  forEachBlock(
    bands: Band[],
    visit: (b: number, arrays: TypedArray[], start: number, count: number) => void
  ): void;
  snapshot(): Coverage; // COW bands, same lattice
  publish(resource: ResourceWriter): void; // dirty blocks → chunks, published bands only
  window(bounds: Bounds, band: Band): TypedArray; // for rendering and export
  warp(from: Coverage, samples: Projection, bands: string[]): void; // resample parent → this
  overview(level: number): Coverage; // coarser lattice, aggregated bands (rendering, multigrid)
  order(key: Band, descending?: boolean): Iterable<number>; // streamed whole-coverage ordering
  reduce(band: Band, fold: (acc: number, v: number) => number, seed: number): number;
}
```

`order` is the block-aware replacement for sorting a whole-world column: each
block's keys are ordered with `radixOrder` as they are today, and the block
runs are merged through a heap of block cursors. The consumer iterates the
order as a stream; resident state is one cursor per block, never the
permutation. A consumer that needs a cell's rank writes it to a rank band.
Descending-elevation sweeps and the source-to-outlet drainage order are the
current users; each may instead become a frontier walk (a priority flood, a
walk from the outlets) when it is converted. Reductions such as the sea-level
balance stream over blocks the same way.

`forEachBlock` is the local-pass primitive: it pins the requested bands'
blocks, hands the body native arrays and a cell range, and writes back. A
stencil pass uses `forEachBlock` for its own cell and `band.get` for
neighbours, which are in the same block except at block borders. A connected
pass uses `get`/`set` with the hpc frontier. There is one code path at every
size; residency changes what `get` finds, not what the algorithm does.

### 3.4 Block cache and memory policy

One cache per worker holds band-blocks under a byte budget. Pinned blocks are
never evicted. Eviction writes dirty blocks of `process` and `epoch` bands to
the worker's scratch file and drops clean blocks of committed bands (they
reload from the resource). When the whole coverage fits, nothing is ever
evicted and the cache is a bookkeeping table. The budget is the only memory
bound and it bounds working set, not world size.

Block size is `2^14` cells, the same as a one-dimensional resource chunk, so
such a block is one chunk on disk and one unit in memory; a block of a tiled
raster decodes each overlapping tile once. At ~1 KB of
bands per cell a full-coverage block is ~16 MB, but bands load independently,
so a typical pass touching five bands holds ~500 KB per block.

### 3.5 World and regions

A world is a tree of coverages. The root is the world coverage on the
triangular lattice. Each region is a coverage on its own adaptive lattice with
a footprint polygon in the parent's frame. Refinement warps parent bands into
the child through projection samples; the child publishes its own resource;
inherited facts are the parent's published bands read through the warp. The
tree, footprints and resource references live in the catalog as they do now.

Tiles and regions are different things: a tile is a block, chosen by the
lattice for storage and locality; a region is a coverage, chosen by the
creator for refinement. A single-block world is the degenerate case of tiling;
nothing in the processes knows the difference.

### 3.6 What stays as it is

The hpc structures (frontiers, lists, heaps, orderings, grouping, marks,
union-find) are resident and unchanged; they hold cell ids, which now encode
blocks, and their size follows the frontier or the group, not the world.
Per-cell labels (component ids, union-find parents, ranks) are bands. No
whole-world array is resident by design. The SQLite/RTree/GEOS catalog, features, boundaries and regions are the
vector side and are untouched; cells meet features through label bands
(cell → feature or region id) and `groupByLabel`. Zarr resources remain the
committed form; a chunk is a block. The render worker keeps reading chunks
directly.

## 4. GIS concepts this maps to

| Concept                     | Here                                                                 |
| --------------------------- | -------------------------------------------------------------------- |
| Coverage / raster dataset   | `Coverage`                                                           |
| Band                        | `Band` with units and nodata                                         |
| Block / tile, block cache   | blocks of `2^14` cells, one cache per worker                         |
| Sparse raster               | absent blocks outside the halo                                       |
| Nodata mask                 | the `content` band                                                   |
| Overview pyramid            | `overview(level)` for rendering and multigrid                        |
| Window (RasterIO)           | `window(bounds, band)`                                               |
| Warp / resample             | `warp(from, samples)` between parent and child lattices              |
| Versioned raster / snapshot | copy-on-write bands at epoch and run boundaries                      |
| CRS / frame                 | `Lattice.frame`; regions carry their footprint in the parent frame   |
| Spatial index               | the catalog's RTree for vectors; block bounds for the numerical side |

## 5. What this removes

- `NumericalVector` as a typed-array look-alike, `NumericalView` and its Proxy,
  and the per-allocation resident-or-paged decision in `PagedArena`. The arena
  becomes the block cache plus scratch file.
- `PhysicalField` as an interface of ~180 ad hoc fields; it becomes a schema
  registered by the physical modules, and `MagicField`, ecology and society
  register theirs. `createField` becomes `coverage.allocate(schema)`.
- `copyWorkingState`'s reflective object walk; snapshots are COW bands.
- Stored world-mesh columns and the lattice address table; adjacency is
  arithmetic on the triangular lattice.
- `contentCount` ordering (content cells first) as an invariant that loops
  rely on; the `content` band and per-block live counts replace it.

## 6. What this costs

- Every numerical access site changes shape: `map.Elevation[i]` becomes a
  block loop or `band.get(i)`. The counts are known: ~180 field bands, 163
  working-array sites, 257 `mesh.count` loops, 43 `contentCount` loops, 38
  retained arrays, plus magic and society. The compiler enumerates them once
  bands stop satisfying `[index]`.
- World mesh construction, periodic seams and polar rows are rewritten as
  lattice arithmetic. The adaptive mesh keeps its stored adjacency but as
  bands.
- Results may change where a process relied on content-first ordering for tie
  breaking, or where a whole-world sort becomes a frontier walk; those sites
  are documented as they are converted. The Canonry algorithms are design, not
  parity: a process may be restructured when its global shape is the obstacle.
- Seam-aware parallel versions of the global passes (tiled priority flood,
  cross-block drainage) are not required by this design and are not in it;
  the block structure is what makes them possible later.

## 7. Choices made here, open to revision

- Block size `2^14` cells, fixed per lattice; one size for all bands.
- One block cache per worker with a byte budget; no per-band budgets.
- Copy-on-write snapshots rather than explicit retained-history copies.
- Adjacency arithmetic for the triangular lattice; stored for adaptive.
- `float32` only where a band's schema says so; defaults stay as today's types.

## 8. Order of construction, if accepted

1. `Lattice` for the triangular case with arithmetic adjacency and blocking,
   unit-tested against the current mesh on the shared world (same neighbours,
   positions, areas, seams).
2. `Band`, block cache, scratch and resource-backed loading; `Coverage` with
   `forEachBlock`, `snapshot`, `publish`, `window`; perf: one run, resident and
   forced-evicting, against native arrays.
3. Schema registration for the physical field, magic, ecology and society.
4. Conversion by process class behind the compiler: local, stencil, connected.
   The shared node generation on a forced-evicting cache is the gate.
5. Adaptive lattice as bands; region warp; overviews.
6. Delete the replaced code; move the mechanisms into ADR 0003 and the
   generation design.
