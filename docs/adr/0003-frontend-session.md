# 0003 — Build the atlas in the browser first

User direction recorded 2026-10-18. Supersedes the backend, persistence, MCP and
execution-lifecycle requirements in the product specification and ADRs 0001–0002
for the current product.

## Decision

Run the atlas entirely in the browser. React and OpenLayers present the editor;
shared TypeScript domain operations validate changes against session memory.
Generation runs the shared process sequence in a Web Worker. Keep worlds,
templates, numerical fields, completed causes, edit history and undo in memory.
Reloading or closing the tab discards them and ends generation.

There is no authentication, API, database, localStorage, IndexedDB, MCP service,
saved job input, restart mechanism or recovery mechanism. Explicit GIS and
template downloads are local user actions. They do not introduce an automatic
storage path.

Keep the existing spatial model: geographically parented areas, planar metric
coordinates, stable feature identity, distinct located floors, layer composition,
authored protection and fixed refinement interfaces. Reuse domain validation
directly; do not emulate HTTP routes inside the browser.

## Generation and edits

Each worker receives the current in-memory snapshot. Processes share its private
working map and report stage progress. Cancellation terminates that worker.
Successful, validated geography replaces session state as one operation. If the
world was edited during the run, retain the edits and report that its generation
result is out of date. The creator can generate again from the current state.
There is no automatic retry.

Child numerical generation samples its parent and evolves the interior. A band
one sample wide retains the parent's numerical authority at the established area
boundary. This uses the existing field coverage composition; it does not require
a second boundary solver or changing a neighboring map. Existing contracted
network features retain their identities and crossing geometry.

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
