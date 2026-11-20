# Generator kernel: no allocation, no strings

Working copy of a proposed plan (owner direction 2026-11-20). Nothing here is built, and the
owner has said not to start it yet. The last milestone moves its durable content into an ADR
and the backlog and deletes this file.

## Outcome

Every generation step allocates the memory it will use when it starts, then does its work
without allocating and without strings. Its inner loops run over preallocated dense arrays,
scratch buffers and fixed-capacity structures, and identities are integers. Text (feature
ids, names, labels, attributes) is built once, after generation, in one publication join
module. The kernel crate cannot name `Vec`, `String`, `Box`, `format!` or a map, so the rule
holds by construction rather than by review.

## User requirements (owner)

2026-11-20:

1. A no-alloc, no-string generator and publisher, with a specific module for final string
   joins, as in the-canonry-game.
2. No alloc means no alloc. A step preallocates at its start, with scratch arrays for work
   and preallocated vectors for everything else.
3. This needs specific data structure implementations.
4. Write the plan; do not do it yet.

Standing direction that bounds this plan:

- Use named software architecture patterns, not ad hoc structure: "everything at this scale
  should be a named paradigm". The plan names the pattern each part uses (see Named
  patterns).
- 2026-11-12: "data structures (which may need changing) and software architecture
  paradigms (which should not change) including architecture guard tests to prevent
  spills". This plan changes data structures and memory discipline; the existing paradigms
  and their guard tests stay, and M0 inventories them before anything moves.
- 2026-11-19: results may change for performance; numerical equivalence is not a goal.
- 2026-11-19: break the build and tests during a large change; no patches to keep CI green.
- 2026-11-19: some strings are needed, and JSON suits entities without their own schema.
  That allowance now applies to catalogue compilation and the publication join only.
- Another session is editing the town code (`town/`, `processes/town/`, `atlas/town/`).
  This plan converts towns last, after that work lands, and never edits those files while
  it is in progress.

## Reference design: the-canonry-game

Read from `~/repos/the-canonry-game` at 0f62584c:

- `docs/kernel/simulation-kernel-discipline.md`: invariants 1–4 (no runtime string creation,
  no string lookup after domain registration, no hot-path allocation, fixed capacity bounds
  active state with generation-safe handles).
- `src/Engine.Kernel/BannedSymbols.txt`: the kernel project fails its build on `String`,
  `StringBuilder`, LINQ, `List`, `Dictionary`, `HashSet`, `Queue`, `Stack`, `IEnumerable`,
  tasks, console, timers and file I/O. There is no exemption marker.
- Layers: `Engine.Domain` compiles authored strings into stable ids at registration;
  `Engine.Kernel` runs on fixed buffers; `Engine.Projection` resolves text afterwards.
  `ProjectionSymbolCatalog` maps `(kind, id)` to display names and
  `ProjectionEntityNameKey(EntityId, KindId, SubtypeId, CultureId, NameSeed)` to entity
  names. That catalogue is the final string join.
- Capacities are construction options (`SimulationOptions`), checked against derived needs
  in `Simulation.MapCapacity.cs`. Overflow raises
  `KernelCapacityExceededException(capacityCode, requestedIndex, capacity)`; buffers never
  grow.
- Structures: `EpochStampedArray` and `EpochStampSet` (cleared by bumping an epoch),
  `DeltaAppendArena` (per-worker 64-entry blocks claimed atomically, compacted at the
  barrier), `PrimitiveIntTable` (fixed-capacity open addressing with an occupied-slot list,
  so clearing costs the entries in use), ring buffers, and reusable slots with generation
  handles over dense active indexes.

Where this plan goes further: the-canonry-game applies the ban to its tick kernel only.
`Engine.WorldGen` has no analyzer, and 22 of its 81 files use `List`, `Dictionary` or
`string`. Here generation is the hot path, so the ban covers generation and publication.

Not adopted: invariant 5 (integer fixed-point state and a float ban). It serves deterministic
reductions, which this project does not require. [DECISION] owner, only if wanted.

## Evidence: where the time goes now

Rivassanrema run on the local atlas, 2026-11-20, after the Rust-native data rewrite:

- Regional steps: place effects 460 s, water evolution 366 s, ancestral fluvial erosion 215 s.
  All non-town steps took 2,108 s, against 2,714 s before the rewrite.
- Town steps roughly double each round, as the town does. In the last round, construction
  took 664 s and cultivation 276 s. The town had 27,127 buildings at round 9.
- Publication has a 1,000 s baseline that was never re-measured after the rewrite.

Copies and allocations read in the place-effects path:

| Where                                                       | What happens                                                                                                                                                                              |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage/band.rs` (`set`, `write_values`, `write_block`)    | Band data is `Rc<Vec<T>>` written through `Rc::make_mut`; the first write after `snapshot()` copies the whole map                                                                         |
| `human/carry.rs` `carry`, `move_layer`                      | Snapshot all 41 people bands, then clear them, so each is copied in full                                                                                                                  |
| `human/carry.rs`, `human/storage.rs` `column()`             | A new `Vec` per identity column read, per cell and per transport target                                                                                                                   |
| `atlas/state/effects.rs` `declared_places`, `carrier_costs` | `places_of(..).as_ref().clone()` deep-copies an entry's `Vec<Place>` (String id, cell list, optional `Feature`, optional String origin), once in declare and five more times for carriers |
| `field/poi/state.rs` `Held`                                 | The POI cache is `BTreeMap<String, Rc<dyn Any>>`, keyed by `format!` per lookup, some per place                                                                                           |
| `field/poi/effect_declarations.rs` `declare`                | Empties that cache at its start and end, so every entry's places are rediscovered over the whole map                                                                                      |
| `effect_declarations.rs` `take`                             | Linear search for the key, and a whole-map `Changes::new` per new key                                                                                                                     |
| `answers.rs` `fill_band`                                    | A new whole-map band per query, filled per cell through a `BTreeMap` lookup and boxed `dyn Fn` responders                                                                                 |
| `execution.rs` `QueryValues::get`                           | Query results are memoized as `Rc<T>` values created per evaluation                                                                                                                       |

Not yet read: water evolution's routing, river advance and projection; fluvial erosion;
coastal forcing; publication.

## Blast radius

Measured on main at 0967447, `crates/atlas-generation/src` (159k lines, 146 named steps):

| Area                                                                                                               | Size                                                                                                                                         | Effect                                                                    |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Spine: `storage/`, `answers.rs`, `execution`, the causes registry, the POI cache                                   | About 1.5k lines, used by every step                                                                                                         | Replaced first (M3)                                                       |
| Step bodies: `field` 56k, `atlas` 22k, `town` 13k, `magic` 10k, `water` 10k, `processes` 8.5k, `rock` 8k, the rest | Every step                                                                                                                                   | Split into setup and kernel                                               |
| Allocation sites                                                                                                   | `Vec<` 2,150 lines in 533 files; `vec!` 1,344; `.collect` 1,058; `Vec::new` 855; maps and sets 383; `Rc` 445; `RefCell` 219; boxed `dyn` 112 | Rewritten or moved into setup                                             |
| Strings and JSON                                                                                                   | `serde_json`/`Value` 1,368 lines in 194 files; `String` 647; `format!` 479                                                                   | Moved to catalogue compilation or the publication join                    |
| Float math                                                                                                         | 440 lines in 190 files                                                                                                                       | Switched to `libm`                                                        |
| Saved state                                                                                                        | 297 serde derives in 139 files                                                                                                               | Checkpoint format changes; the kept local-atlas world is regenerated once |
| `atlas-host`                                                                                                       | 85 of its files import the generator (town about 40 uses, features 16, storage 9, projection 7)                                              | Stays std as the driver; its calls change                                 |
| Tests                                                                                                              | 210 unit tests in 81 generator files; 21 host integration files, 5,135 lines                                                                 | Rewritten or deleted                                                      |
| Parallelism                                                                                                        | rayon in 5 lines in 2 files                                                                                                                  | Moves into the driver                                                     |

Unchanged: `atlas-map` and the published GIS format, `atlas-gis`, the frontend and transport
packages, `atlas-names` (called by the join), and the ts-rs exports (68 lines in 13 files,
configuration types on the setup side).

## Design

### Three layers

1. **Catalogue compilation** (std, at job start). POI kinds and entries, layers, channels,
   processes, causes, answer keys and town catalogue entries are compiled to `u16` or `u32`
   ids. Names stay in the compiled registry as metadata for the join. This is the
   counterpart of `Engine.Domain`.
2. **Kernel** (`crates/atlas-kernel`, `#![no_std]` with no `alloc`). It holds every step's
   per-round work, as functions over `&mut [T]` workspaces and the fixed structures below.
   It depends on `libm` only. It cannot allocate or create text, and a capacity overflow
   returns a typed error carrying a capacity code, the requested index and the capacity.
3. **Driver and join** (std, in `atlas-generation`).
   - Each step's setup reads its queries, sizes its workspace from declared capacities, then
     runs its rounds by calling the kernel.
   - Setup allocates; rounds do not.
   - After generation, the publication join builds feature ids, names, labels and
     attributes from `(kind, id, seed)` keys. This is the counterpart of
     `ProjectionSymbolCatalog`.

A query runs during a step's setup, never inside its rounds, and its result is a
preallocated buffer that the kernel borrows.

### Named patterns

| Part                               | Pattern                                                                            | Source                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------- |
| The three layers                   | Microkernel architecture: a minimal, strictly checked core with services around it | the-canonry-game's "microkernel-style project split" |
| Catalogue compilation and the join | Symbol table (string interning): names become ids once and are resolved back once  | `Engine.Domain` and `ProjectionSymbolCatalog`        |
| Kernel workspaces                  | Data-oriented design with structure-of-arrays layout                               | Fabian, _Data-Oriented Design_                       |
| Per-cell bands                     | Double buffer                                                                      | Nystrom, _Game Programming Patterns_                 |
| Identities                         | Object pool with generational indices (slot map)                                   | the-canonry-game invariant 4                         |
| Per-step memory                    | Arena (region-based) allocation: allocated at setup, released at the step's end    | `DeltaAppendArena`                                   |
| Variable-length lists              | Compressed sparse row                                                              | standard sparse-matrix layout                        |
| Visited sets                       | Sparse set with epoch stamps                                                       | `EpochStampSet`                                      |
| Declared changes                   | Bulk-synchronous parallel: rounds write deltas, owners reduce them at the barrier  | the-canonry-game thread discipline                   |
| Responders and causes              | Closed Strategy as an enum (tagged union) instead of boxed open dispatch           | agent choice, to remove per-call `dyn`               |

The generator's existing paradigms (the process, material and mode contracts in ADRs 0010,
0011 and 0012, and the architecture guard tests) are not listed here because they were not read
for this plan; M0 inventories them, and each conversion keeps them.

### Kernel data structures

| Need                                    | Structure                                                                                  | Replaces                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| Per-cell values                         | Dense slices; double buffers that swap when a step reads old values while writing new ones | `Rc<Vec>` bands with copy-on-write snapshots              |
| Fixed-width records per cell            | Strided arrays (for example `[i32; 5]` traditions) read as slice views                     | `column()` building a `Vec`                               |
| Variable-length lists per place or cell | Offset tables (`offsets` plus flat `items`) filled in two passes                           | `Place.cells`, `Vec<Vec<…>>`, per-target `Vec`s           |
| Growing work lists                      | Fixed-capacity vectors; full is an error                                                   | `Vec::new` + `push`, `collect`                            |
| Visited cells and frontiers             | Epoch-stamped sets and arrays sized to the mesh                                            | `BTreeSet`/`HashSet` of cells, `vec![-1; n]` per call     |
| Priority order                          | Heaps and bucket queues with fixed capacity                                                | Growing heaps and sorts                                   |
| Sparse keyed lookup                     | Fixed-capacity open-addressing table with an occupied-slot list                            | `BTreeMap<String, Rc<dyn Any>>`, per-place `format!` keys |
| Identities                              | Slots with generation handles over dense active indexes                                    | String ids such as `"kind:anchor"`                        |
| Declared changes                        | Append arena of primitive records, reduced per key at the step boundary                    | `Vec<FieldChange>`, `take`                                |
| Query answers                           | Written into a supplied band; responders dispatched by enum                                | A new band per query, boxed `dyn Fn`                      |

### Capacities

Each step declares its capacities from mesh size, compiled catalogue counts and current
record counts. A capacity bounds active state, not everything ever created; ended records
release their slots. Records that grow from round to round (town buildings, holdings,
places) are sized as the current count plus the most one step can add, and grow only
between steps, in the next step's setup.

## Decisions

Agreed by the owner (2026-11-20): user requirements 1–4 above, and the-canonry-game as
the reference.

Agent-derived, revisable within the outcome:

- `#![no_std]` without `alloc` as the enforcement, not a lint list. It cannot be exempted.
  It costs `libm` for float math and keeps rayon in the driver. The fallback is a std crate
  with clippy `disallowed-types`, `disallowed-methods` and `disallowed-macros`.
- Steps convert one at a time behind a guard test that lists unconverted steps and fails
  until the list is empty. During the move, kernel steps borrow the same dense bands as
  unconverted steps, so there is one representation rather than an adapter.
- An allocation-counting test checks each converted step on a small field: after setup,
  its rounds make zero allocations. This covers the driver loop, which is std code. It checks
  memory behaviour, not map outcomes; the owner may strike it.

Assumptions that evidence could invalidate:

- `libm` precision is adequate for every process. It will change results, which is allowed.
- The no-std kernel builds for `wasm32` in the browser engine
  (`scripts/ci-browser-engine.sh`).
- Every step has a derivable capacity bound. A step without one needs redesign, not a
  growable buffer.

Deferred:

- Fixed-point state (the-canonry-game invariant 5). [DECISION] owner; not proposed.
- A parallel driver over kernel chunks. The kernel functions take index ranges so a later
  driver can split them; this plan keeps the current serial order plus the existing rayon
  sites.

## Milestones

### M0 — Kernel crate and guard

- Inventory the generator's existing software architecture paradigms and their guard tests
  (ADRs, `*.architecture.ts`, owner-direction marks). Record which pattern each one is and
  how a converted step keeps it.

- Create `crates/atlas-kernel` (`#![no_std]`, no `alloc`, `libm` only).
- Add it to the dependency boundary check in
  `packages/atlas-context/src/rustFoundations.architecture.ts`.
- Add the unconverted-steps guard listing all 146 steps, and the allocation-counting test
  harness.
- Evidence: the crate builds natively and for `wasm32`; the guard fails, listing every step.

### M1 — Kernel data structures [depends on M0]

- Implement the structures in the design table, each with its capacity error.
- Evidence: unit tests of each structure's contract: capacity overflow, epoch clear and
  wrap, open-addressing probe and clear, offset-table fill, handle generation mismatch.

### M2 — Catalogue compilation [depends on M0]

- Compile POI kinds and entries, layers, channels, processes, causes and answer keys to ids
  at job start, with names kept as registry metadata.
- Evidence: compilation unit tests; no step reads a kind or layer by string afterwards
  (source check).

### M3 — Spine [depends on M1, M2]

- Bands become plain owned dense arrays with double buffers; `snapshot()` and
  `Rc::make_mut` go.
- `answers.rs` writes into supplied bands, with responders dispatched by enum.
- The causes registry dispatches by enum.
- The step interface splits into setup (queries, capacities, workspace) and rounds (kernel
  calls), inside the existing commands.
- The build is broken from here until M8.

### M4 — Place effects and people [depends on M3]

- Places become a slot table with an offset table of cells; the POI cache becomes an
  open-addressing table; effect declarations go through the append arena; carry and move
  use double buffers and strided identity columns.
- Evidence: allocation-counting test passes for the step; the guard list shrinks.

### M5 — Water evolution and fluvial erosion [depends on M3]

- Read routing, river advance, identity establishment and projection, then convert.
- Evidence: as M4.

### M6 — Publication join [depends on M2, M3]

- Move feature ids, names, labels and JSON attributes out of generation into one join
  module that reads `(kind, id, seed)` keys and calls `atlas-names`; the host's record store
  receives its output.
- Evidence: join unit tests; no generation module outside the join builds a `String` or
  `serde_json::Value` (source check).

### M7 — Remaining non-town steps [depends on M3]

- Convert the rest of `field`, `rock`, `tectonics`, `magic`, `ecology`, climate and `atlas`,
  in order of measured time, until only town steps remain on the guard list.

### M8 — Towns [depends on M3, and on the other session's town work landing]

- Convert town processes, fabric and catalogue, with capacities from current counts plus
  the most one step can add.
- Evidence: the guard list is empty and the guard passes.

### M9 — Integration and records [depends on M4–M8]

- Regenerate the kept local-atlas world once (the checkpoint format changed).
- Run the regional and town chain once and record step times against the 2026-11-20
  figures above.
- Run `make ci` and the frontend suite once.
- Move the durable design into an ADR (0018) and the backlog, then delete this file.

## Sulion mapping

Root `deef9160-eea8-4778-9a85-5a069a2c849d` (paused). Phases:

| Milestone | Phase ID                               |
| --------- | -------------------------------------- |
| M0        | `83bcdda0-ca73-49af-905c-9d6e16dc2d67` |
| M1        | `d40c489a-f5dd-41dc-be18-ea0e7d91fafa` |
| M2        | `1a00f170-0926-42ac-865a-7e9454f54cc5` |
| M3        | `13308aba-ac87-4977-8fd3-72c2da66af6a` |
| M4        | `c137f303-5952-48c4-9b45-3ef4d704efc0` |
| M5        | `214d2363-c6b3-47c6-945f-dde1e6cf8eaa` |
| M6        | `3c2ed12a-5f7c-4c39-82ca-b718e83a3a89` |
| M7        | `5c75014c-4111-44f4-b98a-44f3de3d4857` |
| M8        | `d0d79fb8-58e1-4e93-a88b-b65d6611caab` |
| M9        | `0986af76-679c-4fed-b455-590bf324281d` |

## Current state

Not started, by owner direction 2026-11-20. Next action: when the owner says go, expand M0.
