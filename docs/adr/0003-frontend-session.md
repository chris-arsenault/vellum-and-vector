# 0003 — Build the atlas in the browser first

User direction recorded 2026-10-18. Supersedes the backend, persistence, MCP and
execution-lifecycle requirements in the product specification and ADRs 0001–0002
for the current product.

## Decision

Run the atlas entirely in the browser. React and OpenLayers present the editor;
shared TypeScript domain operations validate scoped inputs in a dedicated worker.
The browser GIS workspace uses SQLite and RTree indexes for canonical records,
GEOS for spatial operations, and immutable Zarr resources in origin-private file
storage for numerical fields. This follows the user's 2026-10-27 direction to
replace whole-world reconstruction with scoped storage and incremental processing.
Reloading or closing the tab ends generation and discards unsaved session changes.

Per the user's 2026-10-24 direction, explicit **Save map** creates a local catalog
snapshot and records its root in IndexedDB. **Saved maps** lists local saves and
reopens a selected map without generation, replacing that world's current session. A save
retains geography, numerical fields, world map views, completed causes, history
and undo. Saving again updates that world's copy. Independent templates and
running jobs are not saved; generation must finish before saving its output.
Saved roots and undo history retain the numerical resources they reference.
Cleanup reclaims abandoned working files while respecting other live tabs.
The catalog worker discovers saved roots itself while holding the exclusive storage
lock, so cleanup never acts on a root list read before the lock. There is no
autosave, generation restart or recovery mechanism. Browser storage belongs to the
current browser and site origin and may be cleared by the browser or user.

There is no authentication, API, server database or MCP service. Explicit GIS and
template downloads remain local user actions.

Keep the existing spatial model: geographically parented areas, planar metric
coordinates, stable feature identity, distinct located floors, layer composition,
authored protection and fixed refinement interfaces. Reuse domain validation
directly. The application layer resolves domain read requirements and maps domain
changes to transactional catalog writes. Domain values contain no SQL, WASM
handles or file paths. `SpatialStore` and `ResourceStore` describe geographic and
numerical operations that a later hosted adapter can implement; they do not emulate
PostGIS functions or prescribe HTTP routes.

The editor holds configuration, selections and current viewport products. It reads
features and registry rows through scoped, paged queries. A page composes its
features from one context and caches each presented feature by identity until the
next commit; the registry presents rows in batches through the same path and marks
only the features a write can affect. Canonical geometry stays separate from
indexed boundary pieces and generalized display products: a record write stores
the geometry row, links and bounds, and one owner derives boundary parts, spatial
pieces and overviews lazily, keyed by the immutable geometry id. Region picking
follows connected edges through locally noded tiles, installing boundary sources
only for the tiles a query visits and widening the nearest-boundary search
locally. Storage boundaries do not become geographic borders. Display reads
return a fragment per seam window; the editor keeps every fragment under the
feature's canonical identity. Render workers register a raster by the immutable
resources it samples and update viewport geography in place; immutable inputs
are bands over their chunks in the renderer's block cache.
Raster ranges and category legends include applicable patches and finer map coverage.
The UI and each worker initialize the same GEOS spatial adapter. There is no JSTS
fallback or snapshot-based session engine. Released snapshot saves retain a narrow
importer so existing explicit saves remain readable.

## Generation and edits

Each generation worker receives configuration and a workspace connection. It resolves
scoped geography and opens immutable field resources directly. Processes share a private
working map and report stage progress. The physical world is a coverage of typed bands
over a block-major lattice: a band is blocks of one native typed-array type, a read is
two indexings, and a block cache keeps blocks resident within the worker's budget and
spills them to worker-owned scratch beyond it, owning process lifetimes, release and
retention either way (`docs/WORLD-COVERAGE-DESIGN.md`). Grids, adaptive topologies,
society and committed field inputs are coverages in the same cache; an input band
decodes the chunks under each block on demand and reloads them instead of spilling.
Grids cross a worker port only as detached arrays (previews, tile grids). No indirection
sits on the sample path. Canonical feature inputs arrive in revision-pinned pages. The
catalog worker serves the editor's own requests ahead of queued generation and render
traffic, so publication batches never delay a scene read. Private SQLite tables keep the source baseline separate from generated features,
network reaches and junctions. Processes read detached domain values and explicitly write
changes; protection checks, identity reuse and publication compare against the source records.
Contour edges use indexed working tables; face assembly consumes bounded line batches through
the geometry kernel. Numerical queues, rankings and transient channels share the
operation's block cache. Native geometry assembly still scales with the size of an individual feature.
Cancellation belongs to the host: it asks the worker to stop, terminates it after a
short grace period, and discards its staged batches and working files.
Per the user's 2026-10-24 direction, initial generation shows independent sampled
previews at completed epochs and progressively installs validated output as it
arrives. The worker finalizes immutable numerical resources and publishes bounded
batches of world records. Shared field layouts are referenced once; samples do not
travel through the editor or catalog worker. Independent preview buffers use transfer
lists. The first batch marks the world's publication incomplete and the last clears
the mark; cancellation or failure during delivery leaves that mark on the world, so
saving and map status read completion from the world rather than from a job.

Regeneration stages catalog batches in disposable local storage and publishes validated
geography in one transaction. The undo journal retains prior record values and immutable
geometry references; undo reads those records in pages. If the
world was edited during the run, retain the edits and report that its generation
result is out of date. The creator can generate again from the current state.
There is no automatic retry.

Regional generation reads its ancestors and constructs finer present geography
without replaying physical epochs or human eras. Existing crossings, landmarks,
material quantities and located settlements retain their context and identities.
One semantic Region profile supports arbitrary geographic nesting.

Ordinary edits write mapped representations and surface overlays, with the
procedural state retained separately as generation context. Local saves and undo
include these drawings. A regional edit does not appear on its parent map; later
parent painting preserves finer authored detail. These edits do not reconstruct
terrain, water or population. Generation excludes map-only edits from its inputs
and restores their drawings at publication. Structural feature edits and surface
patches block intersecting geographic generation in the same located space;
names and visual styles do not. Untouched descendants and neighboring regions
remain eligible. Existing session undo restores eligibility together with the
drawing, and local saves retain the original procedural representation underneath
the edit. Removing a source feature from a map hides its representation rather
than erasing its procedural records.

## Repository boundaries

The active pnpm workspace, checks and build contain `frontend`, `packages/domain`,
`packages/application`, `packages/storage-browser` and `packages/generation`.
Prototype backend and database files remain outside
that path as historical source. The earlier combined Terraform and platform
registration are preserved under `infrastructure/backend-prototype` with disabled
extensions. Do not deploy that backend as part of frontend development.
Backend and MCP work will be reconsidered after the frontend product functions.

Ahara's shared CI workflow deploys only static frontend assets using its website
module in `infrastructure/terraform`. This hosting supplies S3, CloudFront, TLS
and DNS without authentication, application Lambdas or database migrations.
`platform.yml` intentionally has no `migrations` entry.
