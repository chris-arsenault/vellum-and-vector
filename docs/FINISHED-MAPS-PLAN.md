# Finished maps with browser and LAN backend modes

Working plan, 2026-11-12. Sulion root: `e149a291-9b6b-40c9-9ceb-45ab6e03f700`.
This request authorizes planning only. Implementation, deletion and deployment remain pending.

## Outcome and authority

Creators generate, save, reopen, inspect, refine, present and export finished maps. A map is
a complete GIS product with its own schema. Generation produces that product and retains
its own inputs separately. Ordinary map use requires no generation resources or runtime.

There are exactly two supported contexts:

| Context      | Computation     | Map and generation storage | Frontend access                            |
| ------------ | --------------- | -------------------------- | ------------------------------------------ |
| Pure browser | Browser workers | Local browser stores       | Local implementation of the shared facades |
| Pure backend | Backend workers | Backend database and files | Remote implementation of the same facades  |

Browser compute with backend storage, backend compute with browser-owned storage, and
transparent fallback between hosts are excluded. A backend-mode browser still renders the
map, manages interaction and may cache presentation tiles; that is presentation, not
generation computation or an authoritative browser workspace.

### Requirements and corrections from this conversation

- The original request resumed backend storage and compute while retaining local browser
  operation. The later correction, “only pure browser or pure backend is supported,” removes
  the originally discussed hybrid scenario entirely.
- “We should be storing and using a MAP not a generation system”: the finished map is the
  saved product. Tiles derive from published map layers, never from private generation state.
- The map has three raster views and many overlays. Preserve their behavior rather than
  excusing viewing cost through simulation complexity or dropping layers to improve timing.
- “TrueNAS with TrueNAS database and no public route”: development uses the local server,
  its local PostgreSQL database and local files. No public ALB, AWS proxy, tunnel round trip,
  RDS connection or hosted data publication is part of this installation.
- This planning request recommends deleting both old backends, separate map and generation
  schemas, and an explicit facade supporting both contexts. Adopt those recommendations in
  this plan. They supersede preserving the historical backend for later reactivation.
- “Make that the normal generation path”: both hosts publish the same finished-map contract.
  Browser generation does not retain a privileged direct-to-renderer path.
- The owner's subsequent request adds Rust porting where it causes the least functionality
  loss. Plan one shared computational engine compiled natively for backend execution and
  to WebAssembly for browser execution. A benchmark prototype is not a prerequisite to this
  language decision; measurements assess implementation results.
- The owner's architecture clarification requires an inventory before porting: data structures
  may change, but the software architecture paradigms must survive. Establish and guard those
  foundations in Rust before building the publisher or porting process families.

### Existing boundaries retained

Keep TypeScript/React and OpenLayers for the frontend, pnpm for its packages, and Ahara's
applicable TypeScript and Rust standards. Port the existing shared generation algorithms
and map-asset construction to Rust; the new direction supersedes the older requirement that
all generation be implemented in TypeScript. Preserve all active map behavior: arbitrary
configured overlays, point/feature inspection, registry and history, presentation controls, regional
selection and refinement, explicit local saves, and export. Include illustrated maps and
sheet presentation in the consumer change, not just the three live raster views.

Children retain stable named identities, captured context and independent geography.
Parent changes never alter existing child inputs. Zoom stays on the current map; map
navigation is explicit. Retain fixed generation resolutions and the shared triangular
lattice inside generation. Map publication is not permission to change terrain processes,
physical dimensions, settings or geographic significance.

Manual geographic editing, its authoring tools and undo remain deferred. Preserve their
active frontend/domain code and tests without redesigning their behavior. The explicit
retirement of the old backend does include its historical authoring implementations.
Completed causal history belongs to the map and remains separate from undo and job state.

No legacy format converters, compatibility facades, exact replay, fingerprints, numerical
closure checks, execution checkpoints, automatic restart/recovery, arbitrary output caps,
mandatory refinement or performance-derived quotas. No new MCP, billing, public hosting,
collaboration or bidirectional synchronization scope. Do not delete existing saved data or
drop a database as part of source retirement. External writes require the authorization
applicable when that phase executes.

## Current sources and ownership

The following bodies were inspected; they are starting points, not accepted target designs.

| Source                                                                                                                                                                     | Current responsibility and consequence                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `frontend/src/generationExecution.ts`, `generationPublication.ts`                                                                                                          | Runs generation and publishes numerical field resources plus catalog records. This must become the common finished-map publication path.                                                                                |
| `frontend/src/workspaceRasters.ts`, `resourceRaster.ts`, `renderResources.ts`                                                                                              | Presentation opens generation resources and working field readers. Replace that dependency with published map layers.                                                                                                   |
| `frontend/src/numericTiles.ts`, `terrainTile.ts`, `rasterStyles.ts`                                                                                                        | Samples fields per display pixel and builds terrain companions. Retain cartographic behavior while moving source interpretation to publication.                                                                         |
| `frontend/src/useScene.ts`, `mapEngine.ts`, `rasterLayers.ts`                                                                                                              | Reads scene pages, builds OpenLayers sources and selects styles. These become map-facade consumers.                                                                                                                     |
| `frontend/src/drawnMap.ts`, `drawnTerrain.ts`                                                                                                                              | Illustrated presentation also samples numerical fields. Include it in the map contract and consumer replacement.                                                                                                        |
| `frontend/src/workspaceCell.ts`, `cellInspection.ts`, `fieldNames.ts`                                                                                                      | Inspection and overlay discovery expose stored samples, rock and people information. Publish the required values, names and relationships as map data.                                                                  |
| `frontend/src/MapStorage.tsx`, `savedMaps.ts`; `packages/storage-browser/src/browserWorkspace.ts`, `savedMaps.ts`                                                          | Explicit saves retain SQLite roots and OPFS resources. Separate map saves from retained generation context without weakening reopen/refinement behavior.                                                                |
| `packages/domain/src/workspace.ts`, `workspaceResources.ts`                                                                                                                | Existing ports mix catalog, authoring, generation and numerical access. Reuse useful concepts, not their entire interface as the frontend facade.                                                                       |
| `frontend/src/harness/harnessGeneration.ts`, `harnessWorkspace.ts`; `packages/storage-browser/src/sqliteFixture.ts`                                                        | Node already runs the execution path, but uses fixture adapters, in-memory SQLite and an unlimited generation block cache. It is not a production server or a database performance comparison.                          |
| `packages/domain/src/lattice/`, `hpc/`, `spatial.ts`; `packages/generation/src/processes/builder.ts`, `coupling/answers.ts`, `physicalFeatures.ts`, `regional/workflow.ts` | Port source for field ownership, process operations, questions/responders, feature-selected execution and regional reuse. Preserve these mechanisms' actual behavior rather than merely translating their declarations. |
| `packages/name-forge/`, `packages/generation/src/atlasNaming.ts`, `namingCultures.ts`                                                                                      | Existing naming implementation, vocabulary and license boundary. Retain the independent naming library through a same-host batch interface instead of rewriting it to accelerate numerical work.                        |
| `backend/`, `db/migrations/`, `infrastructure/backend-prototype/`, `scripts/build-backend.sh`, `scripts/test-stack.sh`, `scripts/deploy.sh`                                | Abandoned C# and TS implementations, old schema and deployment paths. Replace rather than rehabilitate.                                                                                                                 |
| `AGENTS.md`, `docs/product-spec.md`, `docs/adr/0003-frontend-session.md`, `docs/backlog.md`                                                                                | Retain unrelated product requirements; update conflicting browser-first and backend-preservation statements when implementation establishes the replacement.                                                            |
| `../ahara/INTEGRATION.md`, `../ahara/TRUENAS-DEPLOY.md`, `../ahara-standards/standards/{typescript,rust,testing,terraform}.md`                                             | Reuse local database and Compose/Komodo mechanisms. The owner's LAN-only direction excludes the guide's public reverse-proxy route for this installation.                                                               |

Related work retains its own scope:

- Regional plan `ea1eabd9-8a17-4e96-8b90-81b487c7d677`, rendering phase
  `a2fa4de3-37b1-495d-bb66-397177ccf1ec`: its remaining finalized-map representation and
  rendering-performance work is covered here by M1, M3 and M7. Existing measurements remain
  historical evidence; river, road, place and other geography work stays there.
- Overlay plan `de2b1c56-b08a-49f3-aa30-4cd69ab03290`: preserve its requested plain names,
  rock-column inspection, people/identity information and reasons places matter. Its
  generation-backed display mechanism is agent-derived and superseded by this boundary;
  its unfinished product behavior is not canceled or silently narrowed.
- Hosted backlog item 26 includes public infrastructure, MCP, paid access and recovery
  proposals. This plan does not adopt that whole backlog item. Reconcile its overlapping
  map/backend foundations when this work lands; retain unrelated future scope separately.

Do not edit concurrent canonical artifacts without checking their current owner and body.
At M0, place a cross-reference in the older rendering phase rather than maintaining two
implementation lists for the same work. Do not mark the older geography outcome complete
merely because these architectural milestones pass.

## Proposed architecture

New mechanisms in this section are implementation proposals. The existing architecture
contracts inventoried below are preserved by the owner's clarification; their Rust expression
and underlying data structures may change while retaining those contracts.

### Separate schemas and dependency direction

Use an independent map-contract module in the Rust workspace and a TypeScript-facing package,
provisionally `packages/map`. Both depend only on neutral identity, coordinate, unit and geometry
values. Generate TypeScript computational value declarations from the corresponding Rust
contracts; keep frontend service interfaces in TypeScript and authoritative computational
validation/defaults in Rust. Do not maintain two handwritten process/configuration catalogues.
Extract neutral definitions from the current domain package as needed; importing the map
package must not transitively load generation. Generation schemas and engine types remain
separately owned by the generation side. Do not define the map as an `Omit<World>` or a wrapper around
`DomainSnapshot`, `Grid`, `Band`, `ResourceReference` or `NumericalResource`.

On PostgreSQL, use separate `atlas_map` and `atlas_generation` schemas. On the browser, use
separate map and generation catalogs and resource namespaces. Map-layer payloads have map
descriptors and map-owned lifetimes. Generation context has independent descriptors and
lifetimes. Shared immutable bytes are allowed only when the map can open and retain its
own representation without a generation manifest, decoder or cleanup root.

| Map schema owns                                                                                | Generation schema owns                                                                  |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Map/world identities, coordinates, bounds, revision and explicit parent/child navigation       | Recipes, relative configuration and captured inputs for future generation               |
| Geographic features, names, entities, attributes, relationships and located spaces             | Working field layouts, lattice/topology, materials, carriers and process-private arrays |
| Published terrain, water, surface, scalar and categorical raster layers                        | Retained physical context needed to refine an independently captured parent             |
| Vector layers, labels, layer discovery, legends and presentation settings                      | Host-owned job status, progress, cancellation and transient staging                     |
| Inspection records, rock-column and people descriptions, source footprints and reported values | Disposable execution scratch and generation-only diagnostics                            |
| Completed causal history and geographic observations                                           | References to the map revisions from which inputs were captured                         |
| Complete-map publication state and explicit saved revisions                                    | Internal linkage between a job and its resulting map revision                           |

Map tables and descriptors never require a generation row or private-resource reference to
read a map. Generation may reference a map revision; the reverse dependency is prohibited.
Map inspection values needed by the product are materialized at publication, even when the
generator computed them. Storage size alone is not a reason to hide an existing overlay or
replace inspection with a “generation unavailable” message.

Enforce the boundary with separate runtime schemas, imports and store handles, not naming
alone. The backend's map-reader database privileges exclude `atlas_generation`; generation
workers and the publication application service use the permissions their work needs.
The browser map adapter receives no generation catalog handle. Focused architecture checks
cover these dependencies without turning process metadata into an execution sandbox.

### A map is complete before presentation tiles exist

Publish ordinary GIS map assets with explicit bounds, coordinates, units, nodata, categories
and spatial resolution. Terrain and surface layers support relief, topographic and surface
views. Scalar/category overlays are independent map layers. Features and labels are vector
data with stable identities. Point inspection and completed history are map records.

Publish terrain interpolation, water coverage and other cartographic source interpretations
once into those map assets. Store useful scale overviews. Derived tiles, simplified vector
products and illustration placement may be built during publication or from the map later;
they read only the map schema. Deleting a tile cache must not require generation resources
to rebuild the view. Reprojection, clipping, resampling a published raster, GPU styling and
label layout are presentation work and do not make a context hybrid.

Preserve palette/range changes, logarithmic overlays, opacity/order, lighting, exaggeration,
contour controls, categorical legends and illustrated/sheet appearance. Do not bake away a
control to avoid designing its input. Compact numeric map tiles are acceptable where those
controls need them; an eleven-float worker buffer is not automatically the network format.
Use established raster/vector encodings and map-scale tolerances, preserving source values
for inspection. Choose the precise encoding in M1 from the actual consumer inventory; avoid
a bespoke GIS format when an existing one fits the planar coordinates and browser APIs.

The map-layer catalogue explicitly declares available layers and their semantics. It is
not reconstructed by importing generation registries or enumerating every process channel
on each open. Publish every currently supported overlay, including advanced rock, people,
identity and magic fields; naming a field “internal” does not authorize dropping it.

### Facades and host selection

Expose a small typed application boundary, provisionally `AtlasContext`, discriminated by
`mode: "browser" | "backend"`. Each context supplies these services:

| Service             | Operations and values                                                                                                                                                                                | Implementations                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `MapReader`         | Open a map revision; read layer catalogue and tile data; query features/registry; inspect a point or feature; read completed history; select regions; read illustrated/sheet inputs; export map data | Browser worker over local map storage; HTTP client to backend map service                    |
| `MapLibrary`        | List/open explicit saves; save a complete map with an expected revision; save presentation settings; navigate related maps                                                                           | Local catalog/IndexedDB roots; backend map catalog and transactional revision updates        |
| `GenerationService` | Validate/resolve a request; create/refine/regenerate; observe progress/previews; inspect status; cancel                                                                                              | Browser worker with local generation context; backend worker with backend generation context |

Signatures carry map identities/revisions, map-layer values and operation results. Neither
`MapReader` nor `MapLibrary` exposes SQL, worker ports, OPFS paths, Zarr keys, generation
fields, generic method reflection or a whole-world snapshot escape hatch. HTTP uses the
shared API wrapper required by Ahara standards. Long operations support cancellation through
the same contract; tile transport does not force a domain-object RPC for every tile.

The facade is an application boundary, not an emulation of SQLite or PostGIS. Backend spatial
queries use indexed SQL and bulk operations; local queries use the local GIS adapter. Share
map semantics and publication rules rather than maintaining two sets of domain behavior.
These are the new current-format contracts, not legacy adapters around the old backends.

The frontend resolves one context at session entry and consumes its map services normally.
It does not create a browser workspace first and overlay a remote-storage toggle later.
Selecting backend mode does not initialize browser generation/catalog workers. Backend
unavailability is reported without silently opening or generating a different local map.
Selecting browser mode requires no backend or account. Switching context is explicit and
does not transfer user data automatically. Persistent storage location and compute host
are not independently selectable settings.

Inspection requests carry map identity/revision, a location in its coordinate system and
the inspection scope. Replies contain published values with units/categories and sample
footprints/resolution, feature identities/attributes, supported rock/people details and
completed causes. Preserve stored-value inspection independently of display interpolation.
The Rust port must not replace this with pixel-colour decoding or a private-field download.

An accepted region selection carries the parent map/revision and its complete canonical
polygon or multipolygon. Resolve picked display fragments through stable map identities;
keep whole islands, coastal room and compact seam-crossing frames. `GenerationService`
resolves that revision's retained context on its own host and captures the selected extent
plus needed surrounding context. Preserve this mapping through the Rust port; stale input
reports a revision conflict instead of silently choosing another parent or newer geography.

### Normal publication, refinement and durability

Extract publication and execution orchestration from their current frontend-only ownership.
Rust owns numerical map-asset construction, resampling/overviews and computational geography
extraction. A thin application publisher assembles the map records, names and completed
causes, validates the expected revision and installs the result through its host store.
The same Rust computation and publication rules run after browser and backend generation.
No renderer consumes working generation output as its completed map.

Retain independent sampled epoch previews. Initial delivery may progressively expose map
layers marked incomplete; interrupted delivery remains visibly incomplete and cannot be
saved as a finished map. Regeneration stages the next map revision and atomically switches
to validated geography while the prior complete map remains readable. A map revision is
complete when its required map assets and inspection/history records are readable without
generation state; it need not contain every possible rendered tile.

Keep refinement's captured physical inputs in generation storage, pinned independently of
later parent changes. The application generation service resolves them on the same host.
The frontend supplies a map/region reference, not downloaded private numerical chunks.
Explicit saves retain the finished map and the associated captured generation context
needed to reopen and refine it; those remain separate schemas and separately readable.
The ordinary map export reads map data. A complete workspace transfer, if later needed,
is a separate explicitly requested operation, not hidden inside browsing or mode selection.

Browser reload still discards unsaved sessions and stops browser jobs. For the backend,
the proposal is that an already-running job continues when a client disconnects, retains
inspectable status, and can be canceled from another client. A worker/service restart ends
that attempt and reports interruption; it does not recover execution. This ordinary server
lifetime is distinct from checkpoints or deterministic restart guarantees.

Preserve explicit Save behavior rather than silently adding autosave. In backend mode,
completed but unsaved results remain backend session results until explicitly saved;
closing one frontend does not delete another client's active backend map. The durable
library lists explicitly saved revisions. Use revision checks so stale devices cannot
silently overwrite a newer saved revision. Do not add CRDTs or an offline merge engine.

### LAN backend shape

Use a fresh TypeScript API supervising a long-running native Rust worker, PostgreSQL/PostGIS
on TrueNAS, and local persistent volumes for map assets and generation resources. Serve the
frontend and API on one LAN-local HTTPS origin so browser APIs remain available without
public routing. Reuse existing local certificate/database/deployment mechanisms where they
fit. No AWS credential or internet round trip is required for ordinary map use.

Keep the database and worker traffic local, with suitable local scratch storage. Use the
existing TrueNAS database provisioning mechanism; inspect PostGIS availability before
choosing extension setup. Compose/Komodo packaging may use platform deployment plumbing,
but do not configure public DNS ingress, ALB rules or the AWS-to-TrueNAS proxy path. Initial
LAN access is for this owner's devices; paid access and public identity systems are deferred.
An eventual AWS deployment can implement the same host interfaces without changing maps
or the frontend contract; building that deployment is outside these milestones.

### Architecture and data-structure foundation inventory

This inventory reads implementation bodies and all twelve current `.architecture.ts` guards,
plus the architecture runner and relevant ESLint restrictions. It is a foundation inventory,
not an assertion that every algorithm, call site or generated geography has been audited.
Re-read these sources at phase start: the water rewrite is concurrent work. Source locations
below are relative to `packages/` unless stated otherwise.

#### Architecture contracts to preserve

The method in `MATERIALS-AND-PROCESSES-ARCHITECTURE.md` and ADRs 0010–0012 supplies the
reasoning: independently growing materials and processes meet through a shared vocabulary;
reads, decisions and writes have distinct owners; expressive definitions compile into packed
hot-loop data. Port that architecture rather than replacing it with a generic ECS, per-kind
process switches or a central collection of formulas.

| Contract and current source                                                                                                                                                                                        | Required Rust foundation                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generation/src/processOperation.ts`, `processTraits.ts`, `processes/builder.ts`, `processLifecycleContracts.ts`: opaque executable references, selected strategies, synchronous queries and declared dependencies | Separate query and command capabilities; dispatch through registered operations. Preserve dependency evaluation, query-cycle rejection, revision-based invalidation including failed writes, and batch settlement. Process-local helpers and whole-field builders remain ordinary code. |
| `generation/src/physicalFeatures.ts`, `world/sequence.ts`: selected feature operations determine execution and registration                                                                                        | One executable composition path; no independent runtime schedule or handwritten second registration catalogue. Preserve explicit duration/exposure and epoch bindings.                                                                                                                  |
| `generation/src/coupling/answers.ts`: shared questions with base/add/scale/break responders                                                                                                                        | Preserve named questions, responder composition and dependencies. A craft breaks the rule at its declared question; general processes do not switch on magic-system names.                                                                                                              |
| `generation/src/rock/{groundStorage,rockColumn,modes}.ts`, ADR 0010: retained ground columns and material/process modes                                                                                            | Owner-private mutation, read-only public field views, top-down cover/rock/crust behavior and compiled material responses. A new material or process must not require editing unrelated processes. Do not translate every pairing into an enum switch.                                   |
| `generation/src/coupling/{stage,stageRemoval,fieldContributions}.ts`, `rock/{groundLoad,groundCargo}.ts`: deferred requests and owned material movement                                                            | Preserve sequential versus simultaneous visibility, source/destination/pool/facet distinctions, source-local availability, cover before rock, retained cargo properties, and desired-versus-applied contribution updates. No world-total closure or replay gate.                        |
| `generation/src/coupling/{quantities,carriers}.ts`, `human/{layerBands,crustCarrier}.ts`, ADR 0012: quantity semantics and owner packages                                                                          | Share, amount, peak, identity, retained ground and carried quantities keep their actual transport semantics. Carry/refine owner packages together; outsiders cannot mutate individual human or ground internals.                                                                        |
| `generation/src/water/water.architecture.ts`, ADR 0014: water uses the same intentional paradigms and columnar state                                                                                               | Preserve the owner direction. Read the completed owner implementation before porting it. The current ADR's detailed column/network design is agent-derived and in progress; this plan does not declare it implemented or freeze every proposed detail.                                  |
| `domain/src/lattice/`, `generation/src/regional/`, `domain/src/mapScale.ts` and canonical field declarations                                                                                                       | One triangular field/lattice class for world and region, typed field access, a single dimensional conversion authority, independent children with captured context and stable named identities. Published map rasters are a separate representation and may use ordinary raster grids.  |
| `generation/src/human/`, `poi/catalogue.ts`: shared people layers, catalogued classification and publication                                                                                                       | No second regional society model, classifier mutation, or display-raster simulation. Keep one shared people path and catalogue-owned extensions. Preserve the seven magic systems' distinct behavior without a generic replacement.                                                     |
| `domain/src/spatial.ts` and application/host boundaries                                                                                                                                                            | Scoped geometry through existing GEOS/index capabilities; domain and process code remain independent of React, HTTP and database connections. No hand-written global geometry scans or per-cell host calls.                                                                             |
| This conversation's map/generation schemas and three facades                                                                                                                                                       | Published map contracts cannot import numerical/process state. `MapReader` and `MapLibrary` consume the map product; `GenerationService` owns jobs and captured refinement context. Enforce this in both native and WASM dependency paths.                                              |

Rust modules and private writer capabilities should enforce ownership directly. A public
mutable slice, an interior-mutable read view or a broadly exposed `pub(crate)` writer would
reintroduce the spill even if every call passed through a correctly named module. Query
memoization may update its own cache; it must not grant general domain mutation. Do not turn
these boundaries into an arbitrary capability sandbox for internal algorithm helpers.

#### Data structures that may adapt

Preserve each operation's domain meaning, access costs and ownership behavior; the current
TypeScript class names, slot counts, allocation growth factors and byte layouts are not
architectural requirements. Choose standard Rust containers where they satisfy the same
contract; use packed structures where the indexed numerical workload requires them.

| Existing implementation                                                                                                                | Behavior to carry into the Rust foundation                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain/src/hpc/{cellQueue,recordQueue,typedList,growth}.ts`                                                                           | Growable dense FIFO and append storage, columnar multi-value records, explicit views versus owned results. Keep numeric work out of object-per-cell queues.                                                                                                                     |
| `domain/src/hpc/{keyedHeap,multiKeyHeap,keyBits,radixOrder}.ts`                                                                        | Packed priority/lexicographic selection, ordering and ties, TopK requested selections, numeric radix ordering. Preserve meaningful ordering on explicit inputs; no cross-language generated-world equality.                                                                     |
| `domain/src/hpc/{bitSet,smallIntSet,epochStamps,worklist}.ts`                                                                          | Packed membership, small sets, inexpensive reset with wrap handling, and work coalescing until consumption with later requeue allowed.                                                                                                                                          |
| `domain/src/hpc/{unionFind,groupByLabel,intPairIndex}.ts`                                                                              | Dense component identities, grouped offsets/members and indexed integer pairs. Retain reset and lookup semantics without replacing hot numerical indexing with object maps.                                                                                                     |
| `domain/src/lattice/{lattice,triangularLattice,worldLattice}.ts`                                                                       | Coordinate/cell identity, arithmetic adjacency, nonzero origins, periodic seams, shared world/regional topology and block/halo/no-data distinctions.                                                                                                                            |
| `domain/src/lattice/{band,readBand,coverage,bandValues,bandList}.ts`                                                                   | Typed block access and scoped traversal; immutable inputs, live read-only views without mutable buffer aliases, scratch allocation, streaming/reduction, copy-on-write snapshots and explicit release.                                                                          |
| `domain/src/lattice/{blockCache,blockScratch}.ts`                                                                                      | Byte-budgeted eviction, pin lifetimes, spill/reload and owner release. Handle partial host I/O. All-pinned temporary occupancy is not permission to cap map geography; scratch remains disposable, not execution recovery.                                                      |
| `domain/src/{physicalFields,materialFields,materialLoadFields,humanFields,waterFields,waterYearFields}.ts` and their generation owners | Canonical typed bands and retained column/load/identity/water packages, with owner-private mutable storage. Current material/identity slot widths may change; package semantics and material behavior may not disappear. Water declarations are moving with its active rewrite. |

Standard containers for metadata remain legitimate. The existing HPC adoption guard's
numeric `Map`/`Set` and comparator restrictions apply to a narrower source scope than its
other replacement rules; they are not a universal ban on associative collections. Make
the Rust checks explicit about numerical paths versus catalogues and host metadata.

Other existing structures must have an explicit destination, even where the new map boundary
changes their representation:

- `domain/src/{grids,fieldSamples,adaptiveField,adaptiveTopology}.ts` currently describes
  located regular/adaptive samples, masks, measures, channels, units, water geometry and
  material cargo. The adaptive topology uses paged node/leaf arrays and adjacency offsets.
  These are not a second regional generation lattice. Separate published map data from
  retained refinement samples; do not copy the mixed `GridSurface` contract into `MapReader`
  or preserve a numerical representation merely because the renderer currently consumes it.
- `generation/src/world/{field,physicalNumerics}.ts` binds the shared lattice to canonical
  state, typed owner views, process scratch and retained run-lifetime arrays. Keep those
  lifetimes explicit; Rust destruction alone is insufficient if buffers remain registered
  in a cache or a supposedly read-only handle can still write them.
- `generation/src/world/{flowGraph,airColumn}.ts` contains target/source ordering over bands,
  cycle rejection for drainage and explicit loop-boundary handling for air. Port generic
  storage/order helpers in R1 and their process behavior in R2. Do not assume every directed
  network has the same cycle policy.
- `domain/src/ecologyFields.ts`, `generation/src/human/identityColumn.ts` and the canonical
  physical declarations retain ecological stocks, layered traditions and magic carriers.
  Include their package meaning in the family port inventory; packed storage must not
  flatten identity histories or distinct material effects.
- `domain/src/{byteCache,spatial}.ts` supplies a disposable byte-accounted cache and scoped
  geometry/index capabilities. Rust need not duplicate a host's catalogue cache, SQLite
  RTree or GEOS STRtree. Preserve disposal, scoped queries and bulk operations at the actual
  owner. `domain/src/fieldOwnership.ts` belongs to deferred authoring and remains preserved;
  its presence does not authorize an authoring redesign during this port.

#### Existing guards and Rust coverage

All paths in the next table are under `generation/src/`. The table records what the bodies
check, including limits, rather than promising complete coverage from their names.

| Existing guard                            | Actual coverage and Rust continuation                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hpcAdoption.architecture.ts`             | Rejects named obsolete structures across runtime generation; numeric collection/comparator checks are scoped to `canonry/`, with reasoned `hpc-exempt` lines. Cover the corresponding Rust numerical modules and justify exemptions; a TS-only scan cannot cover their replacement.                                                                                                                   |
| `canonicalFields.architecture.ts`         | Compiler-resolved TS field access inventory, literal publication units and typed grid/field boundaries; rejects widening/casts in generation. Use typed Rust identifiers/units and accessors plus compile-fail cases. Keep any remaining TS call-site inventory. This is not a ban on finished-map raster grids.                                                                                      |
| `processLifecycle.architecture.ts`        | Compiler-derived registrations, callback owners and call sites; rejects raw/cast callbacks, bypass dispatch and asynchronous queries, including supplied negative fixtures. Preserve operation opacity and query/command rules with Rust compile-fail and explicit lifecycle tests; keep the retained TS host checks.                                                                                 |
| `design.architecture.ts`                  | Scoped source/declaration checks for shared questions, responder locality, other-owner writes, ground stack order, staged competition, quantity transport, arbitrary caps and inherited Canonry machinery. Its magic-module sample does not cover all seven systems. Translate the rules with explicit coverage of all ported owners, not a claim that these regexes prove the full dependency graph. |
| `lengthAuthority.architecture.ts`         | `lengthAuthorityCheck.ts` resolves TS aliases and known dimensional boundaries through `MapScale`; uncertain findings are review inventory rather than failures. Rust scale/unit contracts and targeted source checks must preserve that distinction. No speculative general unit-inference engine.                                                                                                   |
| `geologyAlwaysRuns.architecture.ts`       | One required-geography authority, no optional physical/preserve-terrain bypass paths. Retain the configuration contract and equivalent source/explicit-input checks in Rust.                                                                                                                                                                                                                          |
| `regional/representation.architecture.ts` | Source checks reject a separate regional grid, neighbor implementation, allocator and unit table, with explicit representation exemptions. Guard Rust module dependencies and the shared lattice API as well as retained TS callers.                                                                                                                                                                  |
| `regional/people.architecture.ts`         | Rejects the retired regional society files/model and requires the shared people/refinement/publication calls. Preserve one shared execution path through Rust composition and checks of that path.                                                                                                                                                                                                    |
| `human/adoption.architecture.ts`          | Scans active TS packages/frontend for retired society records and names, excluding harness/tests/fixtures. Add the Rust source scope when those owners move; names alone cannot prove equivalent behavior.                                                                                                                                                                                            |
| `human/humanLayers.architecture.ts`       | Source checks of writer locality, operation registration, package carry/units, read-only answers, POI classification and owner separation. Use private Rust writers and public read views first; supplement with targeted dependency checks and positive/negative extension cases.                                                                                                                    |
| `ownerDirections.architecture.ts`         | Verifies registered marks and associated test files; its unlisted-mark search covers listed files, not every repository source. Move marks and behavior tests with implementations, extend discovery to Rust, and keep owner directions distinct from agent-derived structure choices.                                                                                                                |
| `water/water.architecture.ts`             | Checks known water-band writes outside the owner namespace and `WeakMap` side stores inside it. The first check was observed failing during the concurrent rewrite. Port owner-private write/state contracts; do not weaken the guard or exempt violations to make the port pass.                                                                                                                     |

Also preserve the relevant `eslint.config.ts` owner/resource import restrictions: construction
and restoration are distinct from process mutation; raw ground/human writer imports cannot
escape through a re-export. Rust visibility and dependency checks replace this protection
for Rust code. Keep the ordinary TypeScript lint boundaries for remaining code.

`make test-architecture` currently uses `vitest.architecture.config.ts` to discover
`packages/**/*.architecture.ts`; the performance runner selects a different file family.
Before the first computational port, extend the architecture gate to invoke Rust checks
explicitly alongside retained TS checks. A green scan that discovers no Rust files is not
port evidence. Keep equivalent checks operational as each TS owner is retired, rather than
waiting for M4 to rebuild protection.

For each contract, R1 records its source, Rust enforcement point, retained TS checks and
explicit-input evidence here as the phase expands. Prefer compiler visibility/types,
compile-fail cases and small runtime contract tests; use narrow source checks for architectural
rules that those cannot express. Include deliberately invalid bypasses and permitted ordinary
helpers so tests establish both sides of the boundary. Do not build a general architecture
analysis framework or strengthen an agent-derived regex into a new product requirement.
Storage round-trips and explicit container ordering are legitimate unit contracts; generated
field fingerprints, numerical closure and identical-map comparisons remain excluded.

### Rust ownership and port sequence

Use one Cargo workspace with independent map contracts, a shared computation/publication
library and thin native and WebAssembly host targets. Keep crates proportionate to these
real dependency boundaries. The shared library contains no DOM, OPFS, HTTP, database
connections or native filesystem assumptions. Native and browser hosts provide storage,
geometry, progress and cancellation capabilities. Rust owns numerical state throughout a
run; it is not called once per sample from TypeScript.

| Responsibility                                                                                    | Target owner                                                    | Functionality preserved during the port                                                                                                          |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| React, OpenLayers, tools, UI state, appearance controls and facade clients                        | TypeScript                                                      | Keep interactions and controls while replacing their data source with finished maps.                                                             |
| HTTP API, map library, authorization boundary and SQL transactions                                | TypeScript host/application                                     | Replace the abandoned API with the new contract; no API-language rewrite for its own sake.                                                       |
| Map-asset construction, scale overviews and generation-to-map numerical projection                | Shared Rust library                                             | Build on the guarded Rust foundation, using supplied output and the existing generator as producer.                                              |
| Fields/lattice, block/cache/scratch ownership, queues, units and numerical operations             | Shared Rust library                                             | Retain the current representations' guarantees, including spill/release lifetimes and fixed map-scale dimensions.                                |
| Process scheduling, epochs, questions/responders, material settlement and all generation families | Shared Rust library                                             | Port algorithms and causal interactions from current TypeScript; one implementation serves both hosts.                                           |
| Naming vocabulary and the independent NameForge implementation                                    | Existing TypeScript library on the selected host                | Keep authored/existing names, culture rules, geographic terms and license notices. Rust requests names in batches at the relevant naming stages. |
| Geometry and spatial indexing                                                                     | Existing GEOS/PostGIS/local GIS kernels through host interfaces | Retain supported geometry operations; no replacement with hand-written scans or a new approximate geometry engine.                               |

The staged order is M0 contracts/build targets, R1 guarded architecture/data-structure
foundations, M1 publication, M2 adapters, M3 finalized-map consumers, R2 coupled world processes, R3 people/regional
completion, then M4 engine cutover and host integration. M5–M8 finish saves, installation,
workload evaluation and consolidation. M7's baseline is captured before its affected paths
change; performance evidence does not decide whether the Rust work is allowed to start.

This order establishes the shared architecture before publication and changes the viewer's
data contract before replacing the generator. During
M1–M3 the complete TypeScript generator remains authoritative and supplies bounded output
batches to the Rust map publisher. That temporary same-host producer bridge is an
implementation transition, not a third context or a legacy saved-format converter. Remove
it at M4 when the Rust engine can publish directly from its own state.

During R1–R3, do not expose a Rust-only physics demo as a replacement for the product.
Keep the existing complete workflow authoritative while porting coherent groups of
dependencies. Switch the supported generation path only after world generation, all seven
magic systems, ecology, people, configured feature selection, regional refinement, names,
history and publication are connected on both targets. There is no final TS fallback for
unported processes, separate backend algorithm, or permanent host-specific scheduler.

Use the existing source bodies as the algorithm reference and reread them at each phase:
concurrent geography work is active. Inventory process owners, settings, dependencies,
responders, feature publications and consumer-visible values by family. Every active entry
must have a port destination and behavior evidence before retiring its old owner. This is
an implementation coverage list, not new runtime metadata machinery. Keep process-local
extension, ordinary composition and whole-field helpers; Rust traits/types do not authorize
flattening the seven systems or centralizing their behavior into system switches.

First preserve algorithms, units, process order, material availability and local extension
boundaries. Separate later vectorization/parallelism or algorithm redesign from the port.
No identical generated world, random stream, numerical totals or byte output is required;
no cross-language replay/comparison gate is added. Keep seeds/configuration as product
controls, and judge geography and feature interactions on representative maps. Existing
bugs and unfinished geography remain recorded in their own plans, not treated as new port
requirements or reasons to silently remove features.

#### Host boundaries and WebAssembly completeness

Pass configuration, scoped feature pages, bounded asset batches, names, previews and errors
at operation boundaries. Do not stringify a whole working world, cross JS/WASM for every
band read, or call HTTP/IPC per cell. Keep writable fields and material state in Rust memory;
browser/native scratch adapters support those fields without changing their algorithms.
TypeScript naming runs on the same host as generation, including the backend's Node host;
it never sends a backend naming computation to a viewing device.

Establish WebAssembly capabilities in M0/R1 rather than discovering them after a native-only
port. The Rust browser target does not supply ordinary filesystem or thread APIs; provide
worker-local browser storage and an execution driver that yields for progress/cancellation.
Use the existing host termination behavior when cooperative cancellation cannot run soon
enough. Native worker cancellation must also stop compute and prevent publication.
Threading is an optional optimization, not a new requirement that removes browser support.
See the [Rust target contract](https://doc.rust-lang.org/rustc/platform-support/wasm32-unknown-unknown.html).

Native geometry may bind GEOS directly. Browser geometry retains the existing GEOS-WASM
capabilities behind feature/batch operations unless linking that kernel into the Rust
target proves simpler. Cover clipping, prepared predicates, nearest/index queries, line
referencing and polygon assembly before their callers move. Backend PostGIS performs
catalog queries; numerical terrain loops do not become SQL calls.

Bindings must specify buffer ownership and release points. Passing boxed numeric slices
through wasm-bindgen copies data; do not label the interface zero-copy or retain stale memory
views across growth. Use bounded copies at coarse boundaries or explicitly owned views
where justified. Reuse Rust-owned output directly within the Rust generator/publisher.
See the [wasm-bindgen boxed-slice contract](https://wasm-bindgen.github.io/wasm-bindgen/reference/types/boxed-number-slices.html).

#### Functionality evidence and retirement

Port meaningful pure-function/data-structure tests onto small explicit Rust inputs, with
native execution and focused browser-WASM checks. Retain UI scenarios against the shared
facade. Exercise selected process dispatch, publication, inspection and independent child
capture as behavior, not merely registration lists. No process-on-fixture-world outcome
tests, exact comparisons, hidden full generations or increased timeouts enter routine suites.
Reuse representative Draft/Standard workloads and the few shared generation integration
fixtures; Fine still requires explicit owner permission.

Move owner-direction marks to the governed Rust lines in the same change that moves their
implementation, update the existing registry to cover Rust files, and port behavior tests
without weakening their direction. Keep deferred authoring and the helpers/tests it still
needs in TypeScript. Retire replaced active TS implementations and the temporary publication
bridge after their consumers move; do not preserve two executable generators for comparison.
Rust and WASM builds, formatting, Clippy, facade type checks and both mode-specific UI
boundaries must be wired into the applicable CI path before completing M4.

## Milestones

Future milestones remain pending. Expand one with the plan-phase workflow immediately
before implementation; keep its expansion in this document. File lists below identify
boundaries, not a requirement to preserve the current module layout.

### M0 — Fresh schemas and backend replacement

Scope: define map/generation runtime schemas and facade signatures; establish import/storage
ownership; retire both abandoned implementations, their copied vendor sources and obsolete
build/test/deploy wiring. Establish the Rust workspace, generated TypeScript contract values
and thin native/WASM targets without porting the React frontend or independent naming library.
Rebuild `backend/` only for the new service. Review old SQL and disabled Terraform as
retirement candidates, not a migration foundation. Inspect whether
any old migrations were actually applied before retiring their chain; never rewrite an
applied history or drop retained data. Preserve necessary third-party notices wherever
active code still carries that provenance. Update the browser-first/backend-preservation
instructions only to reflect this owner's new scope. Add owner-direction marks, registry
entries and applicable behavior tests when the governed implementation lands.

Acceptance: a fresh current schema describes a complete map independently of generation;
prototype API/worker/build paths are gone; retained shared generation and deferred authoring
remain available. Browser/backend selection has exactly two legal variants. Inventory every
active overlay/inspection/presentation consumer and generation family so later milestones
cannot omit one. Native and browser-WASM hosts can call the same small Rust contract operation
and report a typed failure; document the actual storage/geometry/cancellation host boundaries.
Confirm the foundation inventory and each guard's Rust destination before starting R1;
M0's scaffold must not introduce an alternate numerical or process architecture.

Evidence: dependency and retirement review, schema/facade unit checks on explicit inputs,
owner-direction checks and applicable type/lint/build checks. No prototype database repair.
Coordinate the older rendering phase and concurrent overlay work as described above.
Capture the existing map-viewing baseline before changing its producer or consumer paths;
M7 owns the comparison and follow-up, so this does not create another performance workstream.

### R1 — Rust architecture and data-structure foundations

Depends on: M0. Complete before M1, M2/M3 adoption and any process-family port. These R
milestones extend the existing M sequence without renumbering its published IDs.

Scope: implement the architecture contracts and data-structure families inventoried above,
with Rust enforcement and tests in the same changes as their implementations. Port the shared
triangular lattice, scale/unit handling, typed bands, block cache and scratch ownership,
queues and numerical helpers. Port executable process/query/command dispatch,
feature-derived selection, epoch bindings, invalidation, composed questions and responders,
material settlement and their actual lifecycle. Preserve local extension and one state per
run. Supply native filesystem and browser-worker storage through host adapters; make bulk
geometry capabilities and cooperative cancellation usable on both targets.

Acceptance: native and WASM execute the same Rust core on small explicit inputs, including
nonzero origins, periodic seams, spill/reload/release, scoped geometry and typed errors.
Sequential operations observe the required preceding effects; queries refresh their own
derived outputs. Material movement retains its source/destination/pool distinctions.
Public read views cannot mutate owner state, operation dispatch cannot be bypassed, and
world/regional code share the same lattice and owner packages. All twelve guard families
have explicit Rust/retained-TS coverage or a documented equivalent compiler protection;
the architecture gate actually runs that coverage on both supported targets where applicable.
Invalid extension examples fail and permitted local helpers remain usable. Known upstream
violations stay recorded with their current owner rather than becoming new exemptions.
No numerical hot loop needs TypeScript callbacks or per-cell storage requests. The existing
TS generator remains the complete supported producer while its families are ported.

Evidence: port relevant existing unit and architecture contracts to Rust, not their generated
world outputs. Use explicit data for material availability and process ordering; no total
closure or replay assertions. Run focused native and browser-WASM checks, Rust lint/format,
and host/facade type checks. Resolve required target capability gaps here rather than deferring
them until production cutover.

### M1 — Normal generation publishes finished maps

Depends on: M0 and R1. The publisher uses the guarded numerical/storage foundation rather
than introducing an independent set of fields, buffers and lifecycle rules.

Scope: implement shared Rust map-asset construction and the application publication path,
complete map rasters/vector records, layer catalogue, overviews, inspection values and
history. Separate retained refinement inputs from published
map assets. Adapt `generationExecution.ts` and `generationPublication.ts` so every completed
result goes through this publisher, regardless of host. Choose standard asset encodings from
the consumer inventory. Include illustrated-map inputs and every configured overlay. Keep
the existing complete TS generator as the producer during this milestone, passing bounded
data at the publication boundary; do not port its numerical processes at the same time.

Acceptance: supplied generated output becomes a self-contained map; map reads and tile
rebuilding succeed with generation storage unavailable. All three raster views, overlays,
inspection and completed history have published inputs. Refinement still resolves captured
physical context through the generation service. Initial/incomplete and atomic regeneration
publication retain their existing user behavior.

Evidence: small explicit publication/schema fixtures for both successful and interrupted
delivery, revision switching, map-owned resource lifetimes and independent child capture.
Use the shared generation integration result for the later end-to-end publication assertion;
do not add full-world process-outcome unit tests or per-host duplicate generations.

### M2 — Browser and backend adapters

Depends on: M0 and the map product from M1.

Scope: implement map and generation stores for local SQLite/OPFS and new PostgreSQL/PostGIS
plus host files. Implement the facade services with host-specific query execution and one
shared map contract, plus the storage/geometry capabilities the Rust publisher actually uses.
Map-reader privileges/handles exclude generation storage. Add current
schema initialization and the new TypeScript API; no old DAL or HTTP compatibility layer.

Acceptance: both adapters serve the same explicit map fixture, its layers, feature/point
inspection and history. Each map store can be opened without its generation store. Backend
responses carry requested map data rather than a serialized generation workspace.

Evidence: unit contract checks and the existing small browser storage/UI harness. Exercise
PostGIS schema constraints and map/generation privilege separation against a disposable local
database with explicit rows, as an isolated storage integration check; never generate worlds
there. This extends validation for the new database boundary, not the routine simulation
suite. Confirm current schemas without applying historical backend migrations.

### M3 — Frontend consumes finished maps

Depends on: M1 and M2.

Scope: move `useScene`, raster sources, overlay discovery, feature/point inspection,
registry/history, region selection, illustrations/sheets and export onto map facades.
Replace `World`/generation-field presentation assumptions with map values. Local mode uses
the new consumer path too. Keep OpenLayers rendering and the current controls, replacing
unnecessary field interpretation with ordinary map-layer sampling and styling.

Acceptance: the same frontend works against either map adapter, with no imports from
generation or access to its storage during normal viewing. It does not fetch hidden layers' payloads simply
to enumerate the catalogue. Panning and zooming read the relevant map products. All current
overlay choices and appearance controls work; named-feature picking, inspection and sheet
presentation retain their meaning. Backend mode opens no local generation workspace.

Evidence: extend existing supplied-map UI scenarios for actual rendered output in the three
views and representative scalar/category/vector overlays, plus inspection and illustrated
presentation. Verify the dependency boundary with generation storage inaccessible. Fixtures
use the new normal map publication path once per reusable supplied configuration. Preserve
the repository's rendering/generation declarations and fixture isolation rules.

### R2 — Rust world physical, magic and ecology workflows

Depends on: R1 and the publication/consumer path from M1–M3.

Scope: port world initialization and configured epoch execution, geology/material structure,
climate, water/ice/coastal processes, ecological layers, feature extraction and completed
physical history. Port all seven magic systems with their existing stocks, carriers,
questions/responders, meetings and causal feedback. Carry their current settings and units
through the same configured feature/operation selection. Keep preview/status delivery and
publication connected while completing the remaining people/craft consumers in R3.

Acceptance: every active world-process family in the M0 inventory has a Rust owner and
its selected executable path reaches the shared state and map publisher. Magic retains its
system-specific media and interactions; ecology and physical effects remain causally ordered.
The port does not disable a system, reduce settings, substitute generic effects or change
generation resolution to obtain a runnable demonstration. Incomplete Rust workflows are not
offered as replacements for the current application.

Evidence: pure algorithm/contract tests on explicit fields and code review against current
source bodies. Reuse representative generated maps to inspect physical, magic and ecology
effects; final coupled application acceptance belongs to R3/M4. Do not demand identical TS,
native or WASM geography or use replay fingerprints to judge the port.

### R3 — Rust people, regional refinement and complete workflow coverage

Depends on: R2.

Scope: port human layers, identity, land use, exchange/reach, crafts, place classification,
POI/feature publications, regional capture and dedicated regional development. Complete
world people epochs and regional/shared-process bindings rather than implementing a second
regional engine. Preserve all selected domains and optional branches. Keep the existing
NameForge library, vocabularies and authored-name protection through a coarse same-host
naming interface; implement that provider in the Node backend host and browser worker.
Complete map overlays, inspection records, history and captured-input publication.

Acceptance: the complete requested world and regional workflows run on both Rust targets,
including physical/magical/people interactions, named entities and nested independent maps.
A selected parent map revision resolves the right captured inputs, extent and surrounding
context. Whole islands/coasts and compact seam-crossing regions remain valid. Current names,
rock/people inspection, scalar/category overlays and causal history are available in the
finished map. No TS process fallback fills an unported family.

Evidence: explicit unit cases for classifications, captured scope/revision, shared responders,
name request/response contracts and publication values; UI checks reuse supplied finished
maps. Representative world/region workload observations cover the completed interactions,
not only a no-magic or no-people configuration. Track all unfinished coverage in this phase
before switching production execution in M4; do not defer omitted functionality to a backlog.

### M4 — Rust execution and two complete modes

Depends on: M1–M3 and R1–R3.

Scope: integrate the native Rust worker under the new TS API and the same engine's WASM
target in the browser worker, with local field/scratch adapters, job submission,
progress/previews, status and cancellation. Run the ported shared algorithms and publisher.
Wire complete browser and complete backend contexts into session entry and generation UI.
Retain regional capture and stable identities without transferring private inputs to the
backend-mode browser. Service interruption is failure, not an automatic restart mechanism.
Replace the authoritative TS generation path only now. Remove its temporary producer bridge
to the Rust publisher and retire replaced active TS engine code after checking deferred
authoring and concurrent consumers; retain the UI, facade clients and naming provider.

Acceptance: browser mode generates and refines locally without a backend. Backend mode
generates and refines beside its own data and publishes finished maps consumable by a second
client. Backend jobs remain visible after client disconnect; cancellation stops further
publication and leaves coherent map state. A context cannot select a different storage host
for its generator or silently fall back to the other mode. Both contexts use the shared Rust
engine for every supported generation family. Native/WASM builds and appropriate checks are
part of CI, and marked owner directions and their behavior tests follow the ported code.

Evidence: lifecycle UI checks with controlled supplied output; pure contract checks for
unsupported combinations and cancellation/publication rules. Use representative Draft and
Standard workload checks for the actual host, sharing each result with publication and
viewing measurements. Existing harness timings do not establish host performance parity.

### M5 — Explicit saves and cross-device access

Depends on: M3 and M4.

Scope: make save/open/list/presentation persistence use `MapLibrary`; retain explicit local
saves and implement the backend saved library. Save the map and associated refinement
context with independent ownership. Use expected saved revisions and clear source labels
for browser versus backend libraries. Current-format changes do not authorize deleting old
browser data or adding a legacy importer. Explain incompatible existing saves plainly.

Acceptance: a saved backend map reopens on another device without generation or transfer of
generation state. A browser save reopens locally without backend access. Both retain map
presentation, completed history and captured inputs for later refinement. Incomplete output
cannot be saved as finished. Stale saves produce a clear conflict; no automatic merge,
upload, autosave or cross-context synchronization occurs.

Evidence: supplied-map save/reopen/inspection/refinement lifecycle scenarios with independent
client contexts, stale-revision cases and current-format errors. Test source labeling and
backend-unavailable behavior without adding a second local fallback workflow.

### M6 — LAN-only TrueNAS installation

Depends on: M2, M4 and M5.

Scope: prepare project images, Compose/Komodo configuration, persistent volumes, the existing
TrueNAS database registration, PostGIS setup and a local HTTPS origin for app/API access.
Package the release-mode Rust worker and its required native GIS libraries beside the TS API;
include the WASM module in the browser build. Use Ahara's normal prebuild/image packaging.
Read current platform sources again before making any sibling-repository changes. Check
hardware, available memory, scratch storage and database extension state through the normal
authorized access path. Use broker-backed credentials; no alternate credential hunting.

Acceptance: two home devices use the same backend library and can observe the same backend
job/map revision. App/API, database and resource traffic stay on the LAN. There is no public
route, AWS RDS dependency or client fetch of private generation resources. Ordinary backend
use requires no AWS API call. Local certificates support the browser APIs actually used.

Evidence: packaging/configuration checks, then explicitly authorized LAN deployment and
two-client smoke checks. No unrequested public deployment, new certificate system or assumed
PostGIS availability. Installation continues after the planning request only under execution
authorization; report actual environmental blockers rather than inventing workarounds.

### M7 — Representative map performance

Depends on: M3–M6. Capture the current baseline before replacing the relevant consumer path.

Scope: compare current and new map use on existing world and refined-map checkpoints.
Measure cold open, first visible map, warm pan/zoom, base-view switching, scalar/category
overlay switching, feature/point inspection, illustrated presentation and cross-device open.
Separate publication time, derived-product preparation, network bytes/request counts,
database work, rendering time and generation time. Include native/WASM memory residency,
scratch work, binding copies and cancellation responsiveness. Inspect the supported layer inventory;
no performance result substitutes a reduced-feature viewer for the product.

Acceptance: report representative responsiveness and data volume, fix demonstrated costs
within this architecture, and identify remaining limits honestly. Judge the result against
ordinary tiled-map behavior: navigation remains interactive while visible products arrive,
revisits reuse loaded products, and visual style changes do not rerun publication. Ordinary
view changes never read generation state. Publication can prepare useful map products without computing
the entire theoretical tile pyramid. Fine workloads still require the owner's explicit
approval. Choose refinements from measured causes rather than raising test timeouts or
changing resolution, disabling layers, adding caps or imposing hard CI timing budgets.

Evidence: representative map observations and focused workload measurements, summarized in
chat and existing ignored artifacts. Run lint on touched directories before appropriate
unit/UI/architecture checks; run routine suites at useful integration points. Use the shared
full-generation suite only when its changed boundary warrants it. Do not create a repository
verification or performance report. A small supplied-map UI pass is not proof of workload
responsiveness; a full generation pass is not proof of map presentation quality.

### M8 — Consolidate and close

Depends on: M0–M7 and R1–R3.

Scope: update the product contract, generation guide, architecture decision and usage docs
to describe implemented finished maps, separate schemas, Rust/TS ownership, both compilation
targets, the two contexts and LAN setup. Remove replaced active TS engine paths and any
remaining temporary port bridge while preserving deferred authoring and its dependencies.
Reconcile backlog item 26 and the older rendering phase without claiming unrelated work.
Remove obsolete runtime references, finish applicable checks, then move durable content out
of this working plan and delete this file and every reference to it. Close the Sulion root
only after the required product behavior and implementation evidence are established.

Acceptance: maintained docs describe the running application; no closed `*-PLAN.md` remains;
browser and backend use the normal finished-map path; unfinished geography, public hosting,
MCP and deferred authoring remain accurately recorded in their own homes.

Evidence: documentation/link review and the applicable integrated checks. No separate handoff
or completion report file, branch creation, commit, push or deployment inferred from planning.

## Assumptions and decisions to resolve during execution

- **Agent proposal, M1:** standard tiled raster/vector encodings can support the fictional
  planar CRS and all present controls. Check actual consumers and codec support before
  selecting one; representation choice must not reduce layer or inspection coverage.
- **Technical investigation, M0/R1:** confirm the actual GEOS, storage and cancellation
  bindings on both Rust targets before porting their callers. Preserve existing kernels and
  owned data; a native-only library is not grounds for dropping browser functionality.
- **Agent proposal, R3:** preserve the independent TypeScript NameForge library through
  batched same-host naming rather than porting its implementation. Revisit only if actual
  invocation placement cannot be preserved; no duplicate names or silent naming reduction.
- **Agent proposal, M4–M5:** backend jobs continue across frontend disconnect and completed
  results require explicit Save to enter the durable library. This keeps explicit saving
  while allowing cross-device job observation. The owner can change these semantics before
  their implementation; neither persistence nor compute implies execution recovery.
- **Technical investigation, M6:** existing TrueNAS PostgreSQL can host PostGIS and an existing
  local HTTPS mechanism is suitable. Check installed capabilities and LAN routing, not just
  the platform guide. Hardware and storage performance are currently unverified.
- **Current-format boundary, M0/M5:** determine whether any old database has applied migrations
  and identify existing current saves before changing storage. Do not create a converter,
  compatibility runtime or destructive cleanup to conceal a format break.
- **Coordination, M0:** check ongoing overlay/inspection and owner-direction work before
  moving definitions. This plan owns the representation and facade change, not their
  independent geography or naming outcomes.

These items do not block writing the plan. Public identity, paid hosting, workspace transfer,
multiuser collaboration and deferred manual editing are outside this feature, not missing
implementations to add during an architectural refactor.

## Sulion mapping and current state

| Milestone                             | Phase ID                               | State                                                                   |
| ------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------- |
| Write feature contract and milestones | `db8ea1cc-443e-428c-981b-6b79d87b544d` | Completed: contract and milestone review                                |
| Revise plan for shared Rust engine    | `41c80f70-a17a-4f29-9602-bfe5f6933a0c` | Completed: port ownership and stages reviewed                           |
| Inventory architecture foundations    | `e4a66b37-4338-40f5-b7bd-e8d59028ba2c` | Completed: structures, contracts and guards inventoried; R1 moved first |
| M0                                    | `1cd272fe-6359-4d9a-bf3b-5772767c5a91` | Pending                                                                 |
| R1                                    | `6c7338fc-c4e3-4203-8ba3-f5b8604b4d98` | Pending                                                                 |
| M1                                    | `9a3208ab-57cb-4bb0-86d3-928b0fcee2f2` | Pending                                                                 |
| M2                                    | `aa8bc865-3285-41be-889c-32bce9686e0a` | Pending                                                                 |
| M3                                    | `7a57d309-506c-4fa9-b11c-d98cd34d11f2` | Pending                                                                 |
| R2                                    | `1f927e72-eea1-4821-bd31-f4fb0b1c3982` | Pending                                                                 |
| R3                                    | `8df93b57-6bd2-4efb-a526-21bf1bfe4987` | Pending                                                                 |
| M4                                    | `337e670f-2e28-425b-b41b-c6baa3cdad76` | Pending                                                                 |
| M5                                    | `c1ffb94d-76e5-4a67-903f-489c46ffb71b` | Pending                                                                 |
| M6                                    | `2d876feb-57a0-426d-b8a4-3335634ca0c2` | Pending                                                                 |
| M7                                    | `059cb374-c172-4fa4-9b32-88ce8182c7fe` | Pending                                                                 |
| M8                                    | `9f9d44e5-5f39-4a57-b08b-346745288f08` | Pending                                                                 |

No implementation expansion exists yet. Next: expand M0 with plan-phase after execution is
authorized, read the current plan guidance and relevant sources, and coordinate the consumer
inventory and source retirement. No backend code, saved data, runtime behavior or deployment
has been changed by this planning task.
