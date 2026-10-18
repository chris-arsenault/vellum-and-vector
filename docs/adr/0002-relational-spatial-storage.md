# 0002 — TypeScript generation, relational storage and Ahara integration

Backend, persistence, MCP and durable execution provisions are superseded for
current work by [ADR 0003](0003-frontend-session.md). The active product runs in
browser memory with worker generation. The relational/platform design below is
retained as earlier design context, not implementation work to complete now.

Direction recorded 2026-10-18.

## Application boundaries

Implement the editor, domain logic, generation algorithms and data-access Lambda
handlers in TypeScript. React/OpenLayers presents the map and editing tools.
Shared modules own the typed model, coordinate operations, commands, constraints
and dependency contracts. Keep generation functions independent of UI, transport
and persistence so their inputs and results are reproducible and inspectable.

Data-access Lambdas provide authenticated spatial reads, domain validation,
transactional changes, job records and result publication. HTTP and MCP adapt the
same domain operations. Persistent geographic truth lives in the project database.

## Generation model

Canonry supplies the generation structure and algorithmic baseline: configured
layer order, a shared working map, common application/validation, required,
produced and invalidated facts, deterministic seeds and causal epoch orchestration.
Adapt these mechanisms to TypeScript and the spatial/refinement contracts in
[ADR 0001](0001-spatial-authority.md).

Registered GIS, physical/magical and human/built processes share that contract.
Profiles select an ordered process sequence, typed parameters and an epoch
schedule. Repeated uses have distinct invocation identities. Use ordinary
TypeScript composition for reusable sequences, conditional work and nested
history; grow shared interfaces from the actual generation processes.

Each request pins the effective workflow/profile definitions, process versions,
resolved parameters, input world/area revisions, boundary conditions, epoch
schedule, seed and requested outputs. The runner checks required facts against
the current working state and its spatial context, applies the process, validates
its result and updates fact validity. Later processes read that altered state.

Epoch loops bind changing variables and carry altered domain state forward.
Processes explicitly distinguish persistent material/magical consequences from
current-epoch forcing. Physical/magical feedback occurs at its causal position
within the sequence. Cultural, political and site/cave history use the same
process structure with applicable parent context.

Jobs retain durable inputs, status, stage/epoch progress, cancellation and failure
details. Keep working arrays in memory. Recovery deterministically restarts the
job from its pinned inputs, configuration and seed. Persistent intermediate
recovery requires a concrete measured cost or explicit behavior that restarting
cannot satisfy. Keep candidate output
private until validated publication; commit geographic artifacts, domain
revisions and completion state together.

The [generation workflow design](../generation-workflows.md) specifies the common
process interface, working GIS/domain context, profile configuration, parameter
resolution, cycle semantics, reproducibility and implementation scenarios.

### Execution lifecycle to resolve

The execution host and continuation behavior after browser closure remain open.
The product contract includes durable, inspectable long-running jobs. Determine
their execution lifetime with the user before implementing the execution adapter.
Pure TypeScript stages, reproducible saved inputs and authoritative result publication
are common to that decision. Keep the data-access Lambda boundary focused on
those read, validation and write responsibilities while resolving compute hosting.

## Relational spatial persistence

### TypeScript package and resource boundaries

Use a root pnpm workspace with `packages/domain` for shared types, runtime
schemas, planar GIS operations and numerical resource contracts;
`packages/generation` for configured process sequences, epoch loops and algorithms;
`backend/src` for typed repositories and Lambda adapters; and the
existing `frontend` for React/OpenLayers. Package exports are TypeScript source
consumed by the workspace compiler and bundled for each runtime.

Use JSTS for Cartesian OGC topology, overlays and distance/area operations.
Validate geometry before precision reduction. Normalize polygon representation;
retain directed line/component ordering. World precision is measured in metres;
local-unit round trips account for precision divided by frame scale. Keep
upward elevation and floor identity explicit through transforms.

Use scoped regular grids initially, with active sample masks, clipped cell
measures, reciprocal adjacency and explicit channel units. Parent sampling and
child resampling retain geographic coordinates; interpolation and nearest
category sampling are separate operations. Process resources identify world,
space, CRS, footprint, resolution, revision and temporal context. Specialized
processes can add mesh representations through that resource contract.

Use `pg` with parameterized queries and explicit transaction/repository
boundaries. Domain read requirements select object IDs, spatial layers,
channels and historical context. Candidate write sets identify changed objects,
deletions, read revisions and scoped invalidations. Numerical arrays and process
artifacts remain separate from ordinary feature reads.

Use the project's PostgreSQL 16 database on shared Ahara RDS. Persist worlds,
areas, layers, entities, features, representations, relationships, connections,
constraints, templates and operations as typed relational data with explicit
identities and foreign keys. Store source and composed geometry in PostGIS.
Include world and space identity in queries and spatial indexes.

Retain immutable object revisions and operation references to the affected
revisions. Write changed objects and preserve the existing revisions of unchanged
objects. Reconstruct job inputs from pinned revisions and field references.
Read related rows in a consistent transaction; retain explicit ordering for
stations, rings, stages, epochs, recipes and presentation layers.

Persist the profile/process configuration and epoch schedules needed to reproduce
a job, together with its input revisions, seed and algorithm version. Configuration
uses typed relational records where users author it as domain data. Job records
retain progress and failure/restart state. Keep persistent geographic history and causal
references distinct from transient computational workspace.

User-defined GIS properties have declared types and typed attribute values.
Domain structures such as river profiles, water exchange, construction events,
boundary samples and physical/human history have dedicated typed structures.
JSON is the interchange representation for HTTP/MCP and exports.

Dense numerical data uses immutable grid metadata and typed arrays per channel.
Published fields and authored sampled patches reference those grids. Persist
field protection, water bodies and required historical consequences with their
causal identities. Retain epoch causes and ancestry rather than every full
intermediate surface. Load
field channels independently of ordinary feature reads and edits.

Templates have owner-scoped, versioned definitions containing local spaces,
features, entities, access sockets, placement requirements and generation recipes.
Placed content retains its definition version and instance identity mappings.
Preserve authored data and stable identities through application migrations.

## Platform ownership and deployment

Follow the current [Ahara integration guide](https://github.com/chris-arsenault/ahara/blob/main/INTEGRATION.md)
and its applicable standards. The project owns TypeScript application packages,
SQL migrations and application Terraform. `ahara-infra` owns project admission,
deployer permissions and shared infrastructure.

Use Ahara's shared ALB, VPC, PostgreSQL RDS, Cognito pool and state, with the
established frontend, Lambda, authentication and migration modules. The frontend
is hosted through private S3/CloudFront. The platform supplies identity and
application entitlements; the API scopes operations to that authenticated owner.

The first platform migration invocation provisions the project database and
application credentials. After provisioning, an administrator manually enables
`postgis` and `btree_gist` once in that database, following the
[README setup](../../README.md#deployment-and-database-setup). Extension upgrades
remain administrator maintenance. Application migrations use the normal project
role and check the prerequisite. Dense field arrays use PostgreSQL's numeric
storage; PostGIS supplies vector geometry and spatial queries.

## Implementation status

User requirements and explicitly agreed platform/spatial boundaries govern this
ADR. Its implementation choices remain revisable with evidence. The corrected
generation direction replaces the earlier generalized compiler and exact
mid-process continuation requirements. The TypeScript runtime and migration 034
remove those mechanisms and generic candidate payload stores. Numerical payloads
are stored once; operation settings use scalar rows and history references
immutable before/after revisions. Existing ordinary domain revisions and scoped
PostGIS reads remain authoritative. The remaining C# prototype, copied Canonry source and
associated build paths also await replacement.
