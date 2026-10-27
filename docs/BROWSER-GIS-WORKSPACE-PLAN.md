# Browser GIS workspace and bounded-memory generation

Status: planned, implementation not started. Created 2026-10-27.
Sulion root: `1f785e39-7051-4998-bfa7-3a5ef4a536f2`; all milestones pending.
The separate [hosted PostGIS plan](POSTGIS-BACKEND-PLAN.md) is Markdown-only and deferred.

## Outcome and execution scope

Replace the eager browser snapshot runtime with a local geographic workspace. Creators can
generate, select regions, navigate, inspect, edit and explicitly save real maps in Safari.
Local interactions query relevant geography; generation and rendering operate on disk-backed
resources with bounded working sets rather than keeping every world field resident.

The user's 2026-10-27 request authorizes these two planning artifacts, not implementation,
deployment, commit or push. On later implementation authorization, execute this plan through
its milestones. Expand each imminent milestone in this document using `plan-phase`; keep
the matching Sulion phases current. Do not resume historical backend plans.

The browser work includes the domain abstractions needed for a future PostGIS adapter. It
ends before HTTP services, PostGIS implementation, cloud storage, authentication, billing,
MCP, or hosted compute. The active product remains browser-only.

## Authority, decisions and boundaries

### User requirements and corrections

- This conversation, 2026-10-27: address the architecture across generation, geometry,
  selection, copying, invalidation and rendering; another isolated allocation patch is
  insufficient. The supplied design is additional input, not a mandatory implementation.
- Current request: fully plan the selected browser architecture, including future backend
  boundaries, and keep hosted implementation in a separate Markdown-only plan.
- [Product contract](product-spec.md), especially sections 4.5–4.6, and
  [spatial authority](adr/0001-spatial-authority.md): preserve stable identities, scoped
  located spaces, metre coordinates, arbitrary geographic nesting, semantic creation
  profiles, authored protection, map-only edits and their links to procedural geography.
  Picking a region neither generates detail nor copies its parent's fields.
- [Frontend session contract](adr/0003-frontend-session.md): preserve completed causes,
  current undo behavior and explicit local saves. Initial generation progressively installs
  output and remains incomplete after interrupted delivery; regeneration publishes atomically.
  Browser generation ends with the tab. No autosave, execution checkpoints, restart or recovery.
- [Repository instructions](../AGENTS.md): retain deterministic atlas mechanisms and Canonry
  semantic parity, rather than numerical equivalence. Preserve all current generation domains
  and the seven distinct magic systems. This refactor does not redesign their behavior.
- Large-world support must retain all requested coverage and detail. No map-size caps,
  mandatory viewport/refinement workflow, reduced history or hard CI performance budgets.
  Ask before running Fine generation; planning does not grant that authorization.

### Selected implementation direction

These are revisable implementation choices accepted as the basis for this plan, not new
product requirements:

- SQLite with RTree indexes and GEOS WASM owns browser vector storage and geometry execution.
  Use indexed candidates followed by exact predicates; an RTree envelope is not an exact
  geometry result. Do not build a PostGIS function emulator or a general SQL translator.
- Zarr through zarrita stores chunked numerical arrays in OPFS. Use binary resources for
  topology where their shape warrants it. Existing typed arrays remain the in-memory form
  of a loaded partition. Do not introduce a second persistent copy of those same arrays.
- A dedicated GIS worker owns SQLite, GEOS handles, catalog transactions and prepared
  geometry caches. Generation and rendering read numerical resources directly through the
  resource contract; the catalog worker is not a per-sample transport service.
- Browser numerical authority moves from RAM to local working storage. This is an intentional
  revision of ADR 0003's in-memory numerical boundary, motivated by measured failures and
  large-world storage requirements. It does not make unsaved work a saved map.
- Keep existing React/OpenLayers presentation, TypeScript domain/generation modules and pnpm
  tooling. Replace the data and execution boundaries instead of rewriting the editor.

### Assumptions and decisions to resolve during implementation

| Question                                                                            | Owner and evidence trigger                                                                                          | Milestone |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------- |
| SQLite VFS, GEOS build and zarrita integration work in target Safari                | Implementer: real Safari storage/geometry exercise; no whole-database RAM fallback                                  | M1        |
| Chunk layout, codec, cache and concurrency choices                                  | Implementer: actual channel access, decoded memory, I/O and handle measurements; controls declared in code          | M1, M5–M6 |
| Existing local saves need an import path                                            | Implementer: inspect current format and retained data; preserve source saves, add a scoped reader only where needed | M0, M7    |
| Cross-partition algorithms retain their mechanisms                                  | Implementer: inspect atlas and corresponding Canonry process bodies and test geographic behavior                    | M5–M6     |
| Very large Fine verification can run on an available device with sufficient storage | User authorizes Fine execution; implementer records actual browser, disk and workload limits                        | M8        |

SQLite's [OPFS guidance](https://www.sqlite.org/wasm/doc/trunk/persistence.md) and GEOS's
[C API](https://libgeos.org/usage/c_api/) provide the starting mechanisms. PGlite's official
[filesystem documentation](https://pglite.dev/docs/filesystems) currently excludes Safari
from its OPFS AHP implementation and describes its IndexedDB implementation as memory-backed.
That is why PGlite is not this plan's browser baseline. Recheck dependencies at M1; do not
turn this distinction into an unchangeable domain rule.

## Investigation and reuse map

These are observed problems and source locations, not claims of completed remediation.

| Existing boundary                                                                                 | Reuse and required change                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `frontend/src/useRegions.ts`, `packages/domain/src/regionGeometry.ts`                             | Preserve candidate semantics, outlines, cuts and hierarchy. Replace synchronous whole-area line union/polygonization and late point filtering.                                |
| `packages/domain/src/spatial.ts`                                                                  | Preserve metre-space geometry semantics. Replace repeated GeoJSON parse/validation/precision reduction with reusable geometry execution and one declared precision policy.    |
| `packages/domain/src/operations.ts`, `snapshot.ts`, `projection.ts`                               | Reuse read requirements, changes and identity semantics. Replace whole-world command cloning and complete numerical hydration with scoped records and references.             |
| `frontend/src/atlasState.ts`, `atlasCommands.ts`, `atlasReads.ts`, `useScene.ts`, `SceneIndex.ts` | Replace global revision indexing, world-version cache invalidation and serialized feature signatures. The scene hook currently accepts an extent but reads the complete area. |
| `frontend/src/TileWorkerClient.ts`, `numericTiles.ts`, `mapEngine.ts`, `drawnMap.ts`              | Reuse presentation and styles. Stop sending complete grids into a worker to generate display tiles; provide visible blocks and generalized vector products.                   |
| `frontend/src/generationJobs.ts`, `generation.worker.ts`, `generationTransport.ts`                | Preserve progress, previews, cancellation and publication semantics; replace full snapshot worker inputs and final whole-result assembly.                                     |
| `packages/generation/src/mapRunner.ts`, `atlasWorkflow.ts`, `canonry/*`, `society*`               | Reuse process order, required/produced/invalidated facts, epoch state and causal algorithms. Convert access and lifetime across all processes.                                |
| `packages/domain/src/adaptiveTopology.ts`, `adaptiveField.ts`, `frontend/src/savedMaps.ts`        | Preserve topology relationships, quantities, masks, local saves and undo behavior; replace eager resource ownership and snapshot serialization.                               |

The current picker on an existing October 19 Draft fixture, 4,000 × 3,000 km with 2,170
features, failed after 14.3 seconds with precision collapse. This is a related reproduction,
not a reproduction of the user's exact non-noded-intersection geometry. Prior Standard
generation reached about 2.4 GiB RSS in Node; final-code full Standard completion in Safari
was not established. Allocation microbenchmarks and fixture browser suites do not establish it.

Use current wizard defaults when capturing new baselines. Current target counts from
`packages/generation/src/resolution.ts` are 15,000 cells for default-size Draft, 250,000 for
10,000 × 5,000 km Standard and 20 million for 10,000 × 100,000 km Fine, before numerical
support. Counts and earlier memory estimates are planning context, not runtime caps.

## Domain and storage contract

Keep two storage ports, established by actual atlas operations:

| Port            | Responsibilities                                                                                                                    | Browser realization                     | Future realization, not built here                              |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------- |
| `SpatialStore`  | Scoped feature/representation/network reads, spatial predicates, relevant boundary data, transactional changes, catalog publication | SQLite/RTree and GEOS in the GIS worker | PostgreSQL/PostGIS in a service                                 |
| `ResourceStore` | Resource descriptors, selected channels/windows, mesh partitions, chunk writes and resource finalization                            | OPFS-backed Zarr/binary resources       | Same logical formats in object storage with local worker caches |

Shared domain operations own identity, representation precedence, authored protection,
geographic scope, command validation and publication rules. Storage adapters own SQL, engine
objects, binary encoding, filesystem handles and physical transactions. Resource descriptors
carry schema/format version, coordinate/frame identity, scope, channel dtype/units/quantity,
coverage, topology reference, partition addressing and resource revision. Database row IDs,
signed URLs, GEOS pointers and OPFS handles never become domain identities.

Use coarse asynchronous atlas operations at the UI boundary: query a region, fetch a feature
projection, apply an edit, request display products, start/cancel generation, save/open a map.
Keep command/query execution next to its storage adapter. A future service executes the same
domain operations there; it does not make a network request for each predicate or cell.
Extend existing packages first; add an adapter package only where it establishes a real
dependency boundary. Do not hydrate a complete `World` to satisfy an interface.

Geographic regions and storage partitions are separate. A selected region references source
geography; detail materialization adds resources only where required. A logical global grid
may remain global while stored in chunks. Adaptive partitions retain cell identity, measures,
local indices, global-to-local lookup, reciprocal adjacency, periodic seam links and boundary
ownership. Chunking must not create artificial river outlets or geography at the viewport edge.

Persist canonical vector geometry in a standard binary form with explicit CRS/frame metadata.
Retain reusable decoded/prepared geometry while useful; derive GeoJSON and OpenLayers features
at the presentation boundary. One precision policy governs ingestion, noding and overlays.
Use modern robust GEOS operations and meaningful precision; do not hide topology failures by
dropping features, repeatedly buffering them, or silently changing the declared precision.

Working resources, saved-map roots and domain history have distinct lifetimes. Write and finish
resources before a catalog transaction exposes their references. Store changed record/resource
versions for current undo behavior without whole-world copies. A Save operation commits an
explicit saved root; unsaved working versions do not reopen after reload. Saved roots keep
referenced resources alive. Clean abandoned temporary data without reconstructing interrupted
generation. Existing user saves must not be silently deleted.

## Milestones

Every milestone below is pending. Acceptance is required behavior; the named checks establish
evidence for the proposed implementation and can change if the mechanism changes. Do not
substitute a fixture or a storage benchmark for a complete generation or authoring outcome.

### M0 — Domain and resource contracts

Depends on: none. Sulion phase: `3451ae3d-44f5-48aa-bce1-db1bf2a95bf3`.

Scope: trace all producers/consumers listed above, including current society and seven-system
magic work. Define scoped domain inputs/results, the two ports, format ownership, precision,
partition seams, revision tokens and change notifications. Read current save behavior and
identify any actual import need. Establish representative workload recipes and source versions.

Acceptance: the contracts support selection, editing, rendering and connected generation
without an obligatory complete-world object. Specify which current memory-authority rules
will change and which lifecycle/product rules remain. Record the replacement architecture in
the applicable ADR/product sections when implementation establishes it, not as already built.

Evidence: review actual call paths; capture default Draft picker and 10k × 5k Standard phase,
memory and I/O baselines where feasible. Reuse existing generated geography before rerunning
expensive work. No Fine generation. Missing Safari access remains an explicit verification gap.

### M1 — Browser spatial and numerical engine

[depends on M0] Sulion phase: `2a9a78a8-7b17-4d85-a711-bc1e0c39a981`.

Scope: implement SQLite tables, transactional RTree maintenance, selected projections and GEOS
ownership. Integrate worker-local SQLite OPFS storage, Zarr reads/writes and partitioned binary
topology. Establish byte-bounded decoded caches, bounded open handles, error reporting, cleanup
and separate working/saved roots. Use standard browser lock mechanisms for exclusive catalog
ownership; do not invent leader election or silently race another tab.

Acceptance: a real generated map can be imported into the engine, queried and closed without
loading its complete catalog or numerical resources into RAM. A selected field window loads
only intersecting chunks and required neighbours. SQLite and RTree updates agree after commit
and rollback. Unsupported storage/quota failures are explicit; no in-memory scalability fallback.

Evidence: real SQLite constraints/query tests, GEOS object-lifetime checks and production-bundle
WASM loading. Exercise OPFS read/write/reopen in Safari, not only Node or Linux WebKit. Measure
decoded buffers, handles and I/O on representative resource access; no arbitrary hard budget.

### M2 — Indexed selection and reusable boundary topology

[depends on M1] Sulion phase: `b2bdce04-5643-4cfd-a895-6b6a11ee548f`.

Scope: replace the `useRegions`/`regionCandidates` full-scene path with indexed polygon
containment and relevant boundary queries. Reuse spatially partitioned noded linework for the
requested geographic/social boundaries, composing the selected connected component on demand.
Do not precompute the combinatorial arrangement of every thematic layer. Cache by actual
geometry dependencies; edits and drawn cuts update affected components. Share the precision
and robust overlay implementation with other GIS operations.

Acceptance: clicking generated Draft geography returns useful candidates without rebuilding
the whole area's arrangement or blocking UI event handling. Preserve mixed shore/river/social
boundaries, scale-sensitive ranking, snapping, sibling exclusions, nesting and cut/outline
editing. A component crossing a partition, chart seam or viewport remains connected to its
true enclosing boundary. Point queries must not discard remote edges needed to close it.

Evidence: real generated Draft picker/cut journeys, the reported case if its complete geometry
is available, related precision/near-coincidence cases and cross-partition components. Record
cold and repeated query latency and the geography actually read. Retain the old-fixture failure
as a regression input; do not treat it as the exact user's map.

### M3 — Scoped authoring and domain consumers

[depends on M1, M2] Sulion phase: `969fc998-880f-4501-b7ec-3d96eca17e2a`.

Scope: move commands, analysis, feature/catalog inspection, region hierarchy, templates,
located connections and map-only edits onto scoped read sets and transactional change sets.
Replace `projectChanges` world cloning, `indexSnapshot` global rebuilding and whole-feature
serialization for change detection. Keep reusable domain rules outside SQLite/GEOS adapters.

Acceptance: a rename changes the relevant records and display metadata without reading terrain
or copying every geometry. Geometry edits affect their representation, attachments and relevant
derived caches. Authored protection, finer representation precedence, source geography,
completed causes, network identity and undo retain current behavior. Large catalogs can be
filtered/paged without constructing the entire world; large exports stream from scoped reads.

Evidence: current authoring/domain journeys adapted to real storage; stale read/write conflicts,
transaction failure and scope isolation; representative rename, brush, delete, outline and
template operations with observed reads/invalidations. No test that merely mirrors SQL wiring.

### M4 — Tiled rendering and inspection

[depends on M1, M3] Sulion phase: `9c052bd6-0932-4081-99c8-73820658fc97`.

Scope: wire viewport/scale queries through the editor to vector display products and numerical
windows. Replace complete-grid raster-worker registration. Retain canonical geometry for
editing while deriving generalized display geometry and raster overviews from those facts.
Adapt investigation and drawn presentation, masks, labels, snapping, feature picking and export.

Acceptance: pan, zoom and layer changes load required display data and evict unused decoded
products. They do not generate finer semantic features, clone whole fields, or rebuild unrelated
illustration. Small edits invalidate affected tiles/geometry. Rendering, selection and export
continue to resolve the same source features and authored representations.

Evidence: real-map cold/warm navigation, HiDPI, cylindrical seam, nested subjects and both
presentation modes. Measure UI responsiveness, worker memory and render/GPU resource behavior
where the browser exposes it. A tile-loading mock alone cannot establish this milestone.

### M5 — Resource-based generation execution

[depends on M0, M1] Sulion phase: `b8c166d7-035e-427a-9d9b-46dde2e91802`.

Scope: replace full-snapshot generation messages and eager whole-world field construction with
resolved configuration, scoped references and resource access. Adapt process contexts, required/
produced facts, epochs, numerical projection, previews and extraction to partition/channel reads
and writes. Implement stage lifetimes and release scratch after its last consumer. Port local
processes first; temporary compatibility adapters are removed before completion of M6–M8.

Acceptance: actual processes run against the resource contracts without fetching every field
or routing samples through the GIS worker. Chunk writes are single-owner, outputs are separate
from inputs where required, and current state carries into the next causal stage. Cancellation
releases worker-owned resources; completed history is domain evidence, not a scratch dump.

Evidence: same-seed repeated execution, partition-order determinism, channel/quantity fidelity,
preview/extraction behavior and measured stage working sets. Compare semantic geography and
material quantities at meaningful tolerances; do not require Canonry hashes or identical arrays.

### M6 — Connected global process execution

[depends on M5] Sulion phase: `2e96cf0b-c656-42df-bf73-172269e6eef2`.

Scope: complete the process conversion, inspecting corresponding Canonry bodies before changing
algorithms. Cover mesh construction and projection, plate advection and carried history,
drainage conditioning/accumulation and lake outlets, erosion/sediment/ice, climate/ocean and
metric smoothing, all seven magic materials/carriers/meetings, ecology, society and networks.
Include contour extraction, generalization and numerical-to-map publication.

Use connected partition interfaces, appropriately sized halos, compact global graphs, external
queues/reductions and multiple coordinated passes where the algorithm requires them. Coarse
coordination may serve a process where physically justified; it is not permission to replace
requested Fine coverage with coarse geography or eliminate fine feedback. Treat advection
destinations and network connections as potentially nonlocal, not a fixed one-cell halo.

Acceptance: no process restores resident whole-world dense fields as its operating model.
Rivers cross partitions without invented outlets; transported material and magic retain their
stocks and causal feedback; iterative solves exchange boundary information; epochs and human
eras carry the altered geography forward. Every requested partition is processed at requested
detail. Region refinement preserves inherited context without replaying completed history.

Evidence: process-level geographic and conservation cases, cross-partition/seam stress cases,
and complete current-default Draft and 10k × 5k Standard runs including extraction. Inspect
actual working-set and I/O scaling as data grows. Storage-only synthetic tests are supporting
evidence, not proof that the globally coupled generation is complete. Fine runs need approval.

### M7 — Publication, history and explicit local saves

[depends on M3, M4, M6] Sulion phase: `f3f5b59c-b109-4df6-9453-51afa1a327cc`.

Scope: integrate ready-resource references with domain publication, previews, completed causes,
current undo and explicit saved-map roots. Replace `generationTransport` whole-result assembly
and `savedMaps` whole-session serialization. Preserve source saves and add a narrow import path
where actual user data requires one; do not build a general migration framework for fixtures.

Acceptance: initial output becomes visible in validated batches with an incomplete state until
completion. Interrupted initial delivery stays incomplete. Regeneration switches authoritative
references atomically after validation and retains intervening edits under existing conflict
rules. Save/open preserves authored geography, regions, views, fields, history and undo without
regeneration. Unsaved edits and temporary generation state do not resume after reload. Referenced
saved/history resources survive cleanup; abandoned work can be reclaimed.

Evidence: real-worker progressive delivery, cancellation, failure between resource finalization
and catalog commit, regeneration conflicts, save/reopen and undo after reopening. Measure save
and publication memory rather than assuming chunk transfer makes the receiver bounded.

### M8 — Safari integration and retirement

[depends on M2–M7] Sulion phase: `23b851b3-8090-4c71-a669-7b163e58bd74`.

Scope: finish end-to-end integration and remove eager runtime paths, transitional full-world
adapters, global clone/invalidation and renderer field copies. Keep historical backend source
outside the build. Confirm shared contracts can be implemented by PostGIS without adding a
PostGIS driver, HTTP facade, server query implementation or hosted infrastructure.

Acceptance: current-default Draft generation followed by repeated region picks, mixed cuts,
navigation, edits, undo, save/reopen and export works on real generated geography in Safari.
The 10k × 5k Standard workload completes generation, extraction, publication and interactive use
with observed aggregate working memory. The 10k × 100k Fine world remains a full-coverage target;
verify storage/access scaling first, then complete the authorized Fine workflow before claiming
that target supported. If authorization, storage or Safari access is unavailable, keep that
acceptance unfinished and report the precise limit. Do not close on smaller substitutes.

Evidence: focused domain/storage/generation tests, typecheck, lint, production build, UI wiring
suite and selected real-map browser journeys. Record actual browser/OS, recipe, elapsed stages,
total memory where observable, disk/I/O and geographic failures. Measurements are goals and
evidence, not runtime limits or mandatory CI timing gates. Logs stay in ignored artifacts;
summarize results in chat and existing plan state, not separate verification report files.

Final closeout: move settled mechanisms into ADR 0003 (or its successor), the product contract
and generation guide at lower fidelity. Update repository guidance for the implemented storage
authority and kernel. Replace references to this document, including the deferred backend plan
and current Sulion summary, with durable sources; delete this plan file. Close the Sulion root
only after all required behavior/evidence is complete. A closed plan has no Markdown file.

## Current state and next action

Only planning has been performed. No engine, schema, generator, UI or infrastructure change is
implemented by this document. M0 is the first milestone; no phase expansion has been created.
Read `sulion plan current` and current source before expanding it. Reconcile concurrent society,
magic and browser-test work without taking ownership of those plans or weakening their behavior.
