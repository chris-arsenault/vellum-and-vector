# 0003 — Build the atlas in the browser first

User direction recorded 2026-10-18. Supersedes the backend, persistence, MCP and
execution-lifecycle requirements in the product specification and ADRs 0001–0002
for the current product.

## Decision

Run the atlas entirely in the browser. React and OpenLayers present the editor;
shared TypeScript domain operations validate changes against session memory.
Generation runs the shared process sequence in a Web Worker. Keep worlds,
templates, numerical fields, completed causes, edit history and undo in memory.
Reloading or closing the tab ends generation and discards unsaved session changes.

Per the user's 2026-10-24 direction, explicit **Save map** stores a world's session
snapshot in IndexedDB. **Saved maps** lists local saves and reopens a selected
map without generation, replacing that world's current session copy. A save
retains geography, numerical fields, world map views, completed causes, history
and undo. Saving again updates that world's copy. Independent templates and
running jobs are not saved; generation must finish before saving its output.
There is no autosave, generation restart or recovery mechanism. Browser storage
belongs to the current browser and site origin and may be cleared by the browser
or user.

There is no authentication, API, server database or MCP service. Explicit GIS and
template downloads remain local user actions.

Keep the existing spatial model: geographically parented areas, planar metric
coordinates, stable feature identity, distinct located floors, layer composition,
authored protection and fixed refinement interfaces. Reuse domain validation
directly; do not emulate HTTP routes inside the browser.

## Generation and edits

Each worker receives the current in-memory snapshot. Processes share its private
working map and report stage progress. Cancellation terminates that worker.
Per the user's 2026-10-24 direction, initial generation shows independent sampled
previews at completed epochs and progressively installs validated output as it
arrives. The worker prepares publication, sends numerical buffer ownership through
transfer lists, and batches world records. Shared buffers and topology travel
once; completion is a small notification. There are no acknowledgements or saved
delivery state. Cancellation or failure during delivery leaves initial output
marked incomplete; it does not claim a completed world.

Regeneration retains its existing behavior: successful, validated geography
replaces session state as one operation after delivery. If the
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

The active pnpm workspace, checks and build contain `frontend`, `packages/domain`
and `packages/generation`. Prototype backend and database files remain outside
that path as historical source. The earlier combined Terraform and platform
registration are preserved under `infrastructure/backend-prototype` with disabled
extensions. Do not deploy that backend as part of frontend development.
Backend and MCP work will be reconsidered after the frontend product functions.

Ahara's shared CI workflow deploys only static frontend assets using its website
module in `infrastructure/terraform`. This hosting supplies S3, CloudFront, TLS
and DNS without authentication, application Lambdas or database migrations.
`platform.yml` intentionally has no `migrations` entry.
