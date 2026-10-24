# Complete atlas remediation

**Historical plan:** Current work follows the user's frontend-only direction in
[ADR 0003](adr/0003-frontend-session.md). Backend, persistence and MCP are deferred.

Prepared 2026-10-18. Execution of all milestones authorized 2026-10-18.

## Outcome and authority

Replace the prototype with the complete TypeScript atlas described by the
[product contract](product-spec.md), current [instructions](../AGENTS.md),
[spatial ADR](adr/0001-spatial-authority.md),
[application/storage ADR](adr/0002-relational-spatial-storage.md) and
[generation workflow design](generation-workflows.md). A creator must be able to
generate causal geography and history, refine selected places through located
interiors, preserve authored work, and edit the same durable world through UI
and agent operations.

The user authorized execution of all phases, then requested correction of the
instructions and expanded architecture before further implementation. This
update changes guidance and acceptance; application simplification remains work
to execute. Local changes and non-destructive checks are authorized; publication
and live deployment remain separate actions.

User requirements come from the product contract and explicit corrections:
shared TypeScript, GIS/domain-backed common processes, profile-defined selection,
order and parameters, causal epochs with changing variables, durable geography
and authored-data protection. Canonry supplies the generation structure and
algorithmic baseline. The generalized compiler, resource-port language and exact
mid-process recovery were agent-derived choices, now superseded by configured
process sequences over shared working state and deterministic job restart.
Historical M0–M3 records below describe implemented work; retaining that history
does not make its unnecessary mechanisms requirements for later phases.

The persistence implementation also needs architectural reassessment. Prior
M1/M2 completion established implemented records and passing cases, not acceptable
coupling, query/write amplification, memory use or operating cost. Reuse must be
justified against actual map reads, edits, generation publication and retained
history. Preserve user data, domain behavior and required PostgreSQL/PostGIS
boundaries while replacing unnecessary schema/DAL machinery. In particular,
reassess generic value trees, repeated checkpoint serialization and numerical
artifact hashing/copying before building further runtime integration on them.

The existing Sulion root is retained and expanded:
`4b9a54d3-7ec3-42d6-98ee-ec3f97dc6f83`. Its earlier phase descriptions record the
partial storage/hosting approach; the milestone bodies and current phase notes
below define the remaining work. Earlier completion labels establish neither
replacement functionality nor conformance to the current contracts.

## Implementation assessment and reuse

Planning inspected the product and workflow contracts, ADRs, current generation
contracts/runner, persistence and spatial-read paths, SQL schema, job dispatch,
frontend request/UI contracts, and build/platform entry points. The map below
records concrete gaps in those paths. Each milestone must also inspect its
supporting code and recover any requirement absent from this assessment.

| Area and current producers/consumers                                   | Disposition and required correction                                                                                                                                                                            | Milestones     |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `backend/Atlas.Domain`; `frontend/src/types.ts`                        | Replace the C# model and separately maintained DTOs with shared TypeScript domain types and runtime schemas. Preserve justified spatial, protection and operation semantics.                                   | M0, M3, M8     |
| `backend/Atlas.Generation/Contracts.cs`, `Runner.cs`, `backend/vendor` | Replace fixed domain dispatch and copied executable Canonry sources with atlas processes and configured workflows. Preserve the reference algorithms' causal requirements through new implementations.         | M4–M6, M9      |
| `db/migrations/001_atlas.sql`–`003_fields.sql`                         | Current SQL already contains typed rows, PostGIS and numeric arrays. Reuse valid structures after reconciling their ownership, keys and revision semantics; add the missing workflow/run/checkpoint model.     | M0, M1         |
| `backend/Atlas.Persistence/Store.cs`, readers and row writers          | Replace the C# DAL. Several read/preview/commit/analyze paths still hydrate a whole world; field loading uses command-name decisions. Introduce explicit scoped read requirements and typed write sets.        | M2, M3         |
| `FeatureReads.cs`, `SpatialStore.cs`, geometry composition             | Retain useful behavior: SQL feature pagination, exact PostGIS predicates and composed geometry. Move spatial pagination/counts into SQL, narrow hydration, and maintain indexes from actual dependencies.      | M2, M3         |
| `DatabaseTypes.cs`, attribute rows and shape metadata                  | Reconsider storage around the domain rather than CLR serialization. Define dedicated domain structures and schema-driven custom values, with ordering, units and null/absence semantics preserved.             | M0–M2          |
| Field/history and template stores                                      | Retain immutable numerical fields and versioned template behavior where correct. Complete scoped/channel access, historical lineage, instance mappings, external context references and workflow recipes.      | M1, M2, M5, M6 |
| `Atlas.Api/Dispatcher.cs`, worker, job endpoints                       | Production generation is unconfigured. Submission can save a job or template operation before dispatch reports failure. Replace this with coherent durable submission and explicit execution state.            | M3, M7         |
| `Atlas.Api` HTTP/MCP adapters and payload builders                     | Replace C# handlers while retaining shared-operation intent. Correct eager network/spatial pagination, transport sizing, authentication/ownership checks and job/result publication semantics.                 | M3, M7, M8     |
| React/OpenLayers editor, `useAtlas.ts`, `WorkflowPanel`, `JobsPanel`   | Reuse map and authoring components after contract checks. Replace fixed domain/quality choices and unsupported server-execution claims with effective profile/workflow metadata and actual lifecycle behavior. | M8             |
| Makefile, scripts, CI, `platform.yml`, Terraform                       | Replace .NET build/runtime assumptions with TypeScript packaging and Ahara integration. Existing shared-platform resources and configured DNS identities remain the starting point.                            | M0, M9         |

The existing prototype remains reference material during replacement. Acceptance
belongs to the new end-to-end behavior, including capabilities that have no
correct prototype equivalent.

## Design direction

### Shared producers and consumers

Use a pnpm workspace with shared TypeScript domain and generation packages,
TypeScript DAL/Lambda packages and the existing frontend. M0 fixes package paths
and import boundaries after checking Ahara standards. The domain package owns
runtime schemas as well as types; frontend, API, MCP, generation and persistence
consume those contracts.

Domain commands describe intent, read requirements, validation and candidate
changes. The DAL supplies revision-consistent scoped inputs. A generation run
reads pinned inputs plus its private validated changes through a GIS/domain
context. Its process registry supplies algorithms, while versioned workflow and
profile data supply composition, ordering and parameters. Both authored commands
and generated candidates publish through the authoritative operation boundary.
Rendering, querying, analysis and export use the same composed spatial model.

### Schema and storage

Use typed relational ownership, references and constraints for these families:

| Family            | Required durable structure                                                                                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Geography         | Worlds/CRS, located spaces/frames, areas/parents/profiles, ownership coverage, layers/views, features/representations, entities/relations, networks and access endpoints         |
| Constraints       | Local authoring intent, effective/inherited traits, boundary versions/crossings/samples, protections, exceptions with causes, materialization and invalidation state             |
| Numerical state   | Immutable grids/mesh metadata, independently addressable typed channels and masks, sampled authored changes, physical/human history, causal links and parent historical mappings |
| Workflows         | Effective process configuration, invocation/process identities, declared order and typed settings; relational records for user-authored configuration                            |
| Profiles and time | Profile defaults, world/area specializations, ordered epoch schedules and typed variables, retained material/magical consequences                                                |
| Execution         | Saved requests/configuration/inputs, allowed outputs, durable job status/progress, deterministic restart, geographic artifacts and provenance                                    |
| Authoring history | Object revisions, operation identities/actors/read-write references, affected scopes, invalidations, history and undo references                                                 |
| Templates         | Owner-scoped immutable definitions, local spaces/units, entities/content/access requirements, versioned workflow recipes, instances and definition-to-instance identity mappings |

PostGIS owns canonical and composed vector geometry; world and space participate
in spatial reads/indexes. Dense numerical state uses typed arrays with explicit
units, ordering, coverage and resolution. M0/M1 select channel partitioning from
actual generation and edit access patterns. Database references establish
artifact ownership and retained history. Scratch generation state remains in
memory; interrupted attempts restart from saved inputs.

Custom GIS attributes have declared schemas and typed values. Domain concepts
have dedicated structures. Evaluate existing PostgreSQL composites on their
value semantics and query needs; the new DAL must not require a bespoke mirror
of CLR object serialization. JSON remains the HTTP/MCP interchange format.

### Workflow and algorithm responsibilities

Follow the corrected [generation design](generation-workflows.md). Registered
processes apply and validate changes to shared private GIS/domain working state,
with typed parameters, scoped facts, deterministic seeds and boundary/protection
checks. Profiles select their order and settings. Ordinary TypeScript sequences
and loops express composition and changing epochs. Develop shared interfaces
alongside actual geography and magic processes.

Keep numerical scratch arrays in memory. Persistent material/magical consequences
carry forward while epoch-local forcing resets. Restart interrupted jobs from
their pinned inputs, configuration and seed.
Magic changes the facts consumed by subsequent physical processes at their causal
position. Check fact validity and refresh affected results in the configured order.

The process catalog must preserve the physical mechanisms in specification
section 10.2, the authored Fire/Aurora/Pressure systems in 10.3, independent human processes in 10.4–10.6
and inherited history in section 11. Region, cave and interior generation use
profile-specific compositions of the same runtime. Completed history remains
fixed while ordinary editing changes present state.

### Settled decisions, assumptions and decision ownership

- **Settled:** TypeScript; planar fictional metric CRS with local/vertical
  frames; shared React/OpenLayers editor; relational PostgreSQL/PostGIS;
  immutable numerical channels; common configurable generation processes;
  shared versioned UI/MCP operations; Ahara-owned shared platform resources.
  The ADRs and latest user instructions establish these boundaries.
- **Settled:** Extension installation is one-time manual administrator setup
  after platform database provisioning, documented in README. Ordinary schema
  migrations check prerequisites. Local disposable test databases can be
  prepared independently. Deployment access does not block implementation.
- **Assumption:** The platform database has not yet been created, per the user's
  statement. M1 inventories retained local data and migration state before
  selecting fresh-schema changes versus a preservation/import transition.
  Existing GeoJSON export is not assumed to contain complete fields/history.
- **Assumption:** Existing SQL and editor components contain reusable behavior.
  Their milestone owners verify that behavior against the current contracts;
  reuse never substitutes for missing functionality.
- **Technical investigations, executor-owned:** M0 resolves TypeScript GIS and
  numerical representations, runtime schema tooling, PostgreSQL access and
  native Node Lambda packaging compatibility. Use representative operations
  and the current Ahara modules to decide, then record the result in the
  relevant ADR when consequential. M5 and M6 settle domain algorithm details
  through reference reading and representative maps.
- **[DECISION] Execution host and browser-closure lifecycle, user-owned:** Resolve
  before M7's execution adapter. Recommend preserving the specification's
  durable background-job behavior and selecting a platform-approved host with
  the user. A browser-compute proposal must state its lifetime implications.
  Domain algorithms, profile configuration, reproducible restart and
  authoritative publication work proceed independently. Recovery granularity
  is an implementation choice separate from the host/lifetime decision.

## Milestones

M0–M3 established shared domain and persistence work. Remaining generation work
uses actual physical/magical processes to shape its shared interfaces, followed
by the complete catalog and editor integration. Required product behavior stays
in scope; revise agent-derived mechanisms and checks when a simpler complete
approach suffices. Independent work may overlap where its inputs are available.

### M0 — Shared TypeScript contracts and implementation design

Scope: settle workspace/package boundaries, runtime schemas, domain/resource and
operation interfaces, GIS working-context behavior and the relational model.
Read applicable local Ahara standards. Select mature GIS operations and numerical
sampling suitable for arbitrary clipped extents, reciprocal adjacency, halos and
child boundary constraints. Define units and numerical precision, geometry
normalization and directed-order semantics. Check Node ZIP/runtime support in
the shared Lambda and ALB modules; record a bounded platform prerequisite if
necessary. Establish the requirement-to-implementation map for the full spec.

Acceptance: UI, generation and DAL can consume the same implemented contracts;
world/local/vertical round trips and a bounded child field/network example
establish the chosen geometry/sampling approach. Workflow ports/state and schema
keys can represent all profiles and changing epoch variables. Remaining
investigations have owners and blocking milestones.

Evidence: inspect actual shared imports and the representative spatial example,
and compare schema/contracts against product sections 4–12 and the workflow
design. Record technical decisions in existing ADRs rather than new report files.

Sulion: `add28b71-7295-413d-ad0e-6e4b24e82c26`
(existing title: “Set runtime and relational model”).

#### Execution steps

Expansion `0f326fa0-9529-4c79-84c0-edf7dc687c83`.

1. Workspace and shared domain schemas, step
   `8438ccb5-3369-4f62-abe7-0a524cc9bb0f`: establish root pnpm tooling and
   `packages/domain`; make frontend types consume the shared model. Define
   validated spatial/resource/parameter contracts and check consumer imports.
2. Planar GIS and numerical resources, step
   `536866d6-3707-4f03-9b43-3642442c5a48` [depends on #1]: use JSTS for Cartesian
   OGC predicates/overlay, invertible local/vertical transforms and clipped
   regular-grid adjacency/sampling. Exercise a nonrectangular child footprint
   and directed crossing with inherited sampled values.
3. Workflow contracts and foundation integration, step
   `b4f8427b-799b-4092-a362-380f68b358ed` [depends on #1, #2]: define process,
   invocation, binding, loop and resource schemas in `packages/generation`.
   Verify shared consumers and deterministic named random streams. Resolve
   schema keys against current migrations before M1.

Current state: M0 implemented. The shared package is consumed by the frontend;
runtime schemas cover geometry/reference/resources, structured typed parameters,
workflow invocations/bindings and epoch/feedback definitions. Scoped operation
read/write contracts are separate from the editor's world projection. JSTS
handles planar topology and precision; clipped grid measures and reciprocal
boundary-aware adjacency preserve arbitrary coverage. Named counter streams
retain their exact resume position. Native Node packaging requires ALB-module
pass-through of the base Lambda module's existing package/runtime/handler
inputs; resolve that bounded prerequisite during M9. The M7 lifecycle question
has been presented while independent work proceeds.

Checks: shared typecheck/lint and spatial/parameter/randomness behavior checks
passed. Existing frontend tests, lint and production build passed; lint retains
one existing Fast Refresh warning, and Vite reports its existing bundle-size and
runtime-config script warnings. The initial exact transformed-coordinate
assertion was replaced with the error bound derived from world precision and
local unit scale. Full domain commands, persisted schema and runtime execution
remain the responsibilities of M1–M4, not completed by these foundation checks.

### M1 — Complete relational/PostGIS schema and migration transition

[depends on M0]

Scope: implement the storage families above with explicit owner/world/space
keys, temporal and ordering semantics, foreign keys, uniqueness and spatial
indexes. Complete workflow/profile/epoch definitions, pinned plans and resumable
execution records. Preserve source/composed geometry, attribute fidelity,
immutable field/history references and template identity/context. Reconcile
fresh-install and rollback paths; preserve any retained authored data through
an explicit transition. Document the actual first-deploy/manual-extension order.

Acceptance: a fresh application schema under the normal role represents every
contract family. Workflow edits create new versions while saved runs retain
their pinned definitions. Domain/history/template references survive storage
round trips. Any retained-data transition preserves IDs, protections, field
channels and historical context. Migration code checks extension prerequisites.

Evidence: run migrations and relevant rollback/reapply paths in disposable
PostgreSQL/PostGIS; exercise representative connected records, invalid
references and exact numeric/ordering/null semantics. Shared RDS setup waits
for a separately authorized first deployment.

Sulion: `e1491430-5eba-46bc-b4ff-aea37c542f4f`
(existing title: “Implement relational spatial persistence”).

#### Execution steps

Expansion `3a5336c1-d0f4-44b3-92d2-44c1a8e0236b`.

1. Workflow/epoch storage, step `b518d919-d31a-450e-949b-7f64894933d8`:
   add normalized versioned workflows, process invocations, typed parameter
   declarations/values/bindings, profile assignments and epoch schedules.
2. Execution storage, step `51c4a1cd-94ad-4a94-9d77-96705c4529c6`
   [depends on #1]: add pinned runs/plans, resource manifests, node/loop
   checkpoints, continuation values, random counters and causal references.
3. Domain constraints and migrations, step
   `57548c02-3d55-472e-aa4e-9d5187d31436` [depends on #1, #2]: correct reference,
   temporal, numerical/geometry and immutable-data constraints; exercise
   migrations, rollback/reapply and representative records under an app role.

Current state: M1 implemented by migrations 004–007 and their rollbacks. Storage
now includes workflow/process versions, graph/binding/parameter/epoch rows,
profile/area/template configuration, pinned runs, scoped resource manifests and
typed payloads, node/loop checkpoints, RNG counters, history/events, coverage,
operation changes and invalidations. Sealing protects definitions, values,
grids and checkpoints. Composite ownership keys and temporal exclusions
prevent mismatched owners and overlapping revisions. Exact geographic ownership
checks belong in the publication transaction, preserving arbitrary polygons.

Checks: fresh migrations and full rollback/reapply passed under a nonsuperuser
application role in disposable PostGIS. Typed epoch values, repeated process
invocations, saved run/checkpoint references, random counters, immutable fields,
channel lengths and nonfinite-value rejection were exercised. Two migration
defects surfaced and were fixed: a reserved function argument and a guessed
auto-generated constraint name, replaced with an explicit name. All workspace
checks run so far pass; repository-level domain round trips follow with M2's
actual DAL. Temporary database containers were removed.

Docker volume inspection found no volume
named for atlas/vellum. Preserve existing migration history by adding migrations;
test only in disposable PostgreSQL/PostGIS. Extensible typed value sets store
declared process parameters/continuations and custom values, while domain,
workflow structure, scope, lineage and numeric fields have dedicated tables.

### M2 — Scoped TypeScript DAL and durable persistence

[depends on M0, M1]

Scope: implement typed repositories and transaction boundaries for domain data,
operations, fields, templates, workflows, jobs and checkpoints. Load explicit
spatial/dependency scopes at a consistent revision. Apply parameterized, batched
changed-object writes; maintain composed indexes from dependency changes.
Implement immutable input reconstruction, operation idempotency, coherent undo,
owner isolation and artifact lifecycle. Page/count feature, spatial and network
queries in the database; load selected field channels/windows independently.

Acceptance: ordinary scoped reads/edits work without hydrating the complete
world or unrelated numerical/history state. Queries use exact space-scoped
PostGIS predicates and bounded result pages. Commits, retries, failed writes
and undo preserve atomic state and monotonic revisions. Changes to one
representation update its dependent composed geometry and following features.

Evidence: real database round trips across fields, custom attributes, revisions
and template context; conflict/idempotency/rollback cases; inspect query plans
and representative query/write behavior as unrelated world content grows.
Optimize demonstrated costs without inventing performance enforcement caps.

Sulion: `c0c4cd00-d62a-48e7-a5f4-794ea053e9cb`.

#### Execution steps

Expansion `94420803-91f8-4e40-a216-7545608e1130`.

1. Transactions/definition values, step `791026a8-5ea2-4fd0-a3a4-936b3b5cd13f`:
   implement `backend/src/dal` transaction, ownership and batch helpers, typed
   extensible values and versioned workflow/profile repositories. Round-trip
   actual definitions, structured parameters and epoch assignments.
2. Scoped objects/revisions, step `adc4787f-2bc5-4e56-a32d-59a125ce52cf`
   [depends on #1]: implement scoped world/area/layer/feature/entity/network
   repositories, changed revisions, history and PostGIS composition/indexing.
   Exercise real paging, ownership, retained revisions and dependency updates.
3. Fields/artifacts/checkpoints/templates, step
   `ff952720-a7a8-4082-a44d-08efa792a91c` [depends on #1; integrates #2]: implement immutable
   typed numerical channels, resources/history, exact continuation state and
   owner-scoped template definitions/instances with identity/context mappings.
4. Integration, step `2d2d35e3-d08b-40e7-b3e6-513abc3855b6`
   [depends on #1–#3]: establish round-trip fidelity, failed-write atomicity,
   retries/undo and representative scoped query/write behavior in PostGIS.

Current state: M2 implemented. PostgreSQL composites are projected into
ordinary scalar columns/rows rather than introducing a Node composite codec.
Parameterized batch inserts honor the PostgreSQL bind-parameter limit. API
ownership is enforced before repository reads or writes.

Step 1 is implemented and its real-database checks pass: typed values preserve
empty containers, nulls, numeric/text distinctions and attribute keys;
transactions roll back failed writes; workflow/profile versions, repeated
invocations, parameter schemas, feedback and epoch state bindings round-trip.
Migration 008 adds the state-dependent epoch bindings discovered during wiring.
Step 2 is in progress. Migrations 009–012 add resource publication validity,
historical composed spatial indexes, normalized boundary/trait rows and network
query indexes. Boundary backfill preserves existing composite data while new
application writes use relational children. This replaces the nested boundary
encoding rather than reproducing a CLR serialization codec.

Scoped-storage prerequisite branch `6ce01b3a-8c90-4010-bd0c-ea61cf590c5b`
is anchored to step 2. Step `d94c3ced-cb56-49d5-bbe0-2d4c4eb3fc03` completes
independent representation identity/revisions and located-space metadata plus
their row adapters; step `bc398204-fbbf-4d80-90b7-206457839704` establishes
real spatial round trips and downgrade behavior. The old representation FK
forced all detail geometry to be copied with a feature revision. Migrations
013–014 remove that coupling and make spatial scope explicit.

The storage prerequisite is complete. Real PostGIS exercises retain detailed
geometry and its revision when the feature is renamed, retain old composed
geometry after a local patch changes, filter by located space/extent, preserve
typed domain/custom attribute shapes, and retain nonempty boundary/trait data
through the supported composite transition. Unsupported representation-history
downgrades fail explicitly. An exclusion-constraint dependency found during
rollback was fixed with an explicitly named constraint/drop. Shared typecheck
and lint pass. Continue M2 with operation records, scoped projections and the
field/artifact/checkpoint/template repositories; the complete DAL is unfinished.

The projection assembler needs field/resource readers, so step 3 proceeds from
the completed core row adapters while step 2 remains open for their integration.
Operation records now retain typed parameters and scoped input/change references
and are sealed after transactional publication. Migration 016 makes payload
schema IDs/versions and field-channel units explicit in workflow ports and
resource metadata. This supports actual compatibility checks in M4.

Step 3 now has numerical array/channel/window storage, nominal resource payload
schemas, immutable staged/validated artifacts, pinned run plans and nested
checkpoint repositories. Checkpoints retain process state, iteration contexts,
child cursors, output/working resources, diagnostics and named random counters.
Templates have owner-scoped immutable definition versions, located area content,
typed placement constraints, access sockets, external references and workflow
recipes. Migrations 017–022 complete those adapters and their retention rules.
Real database exercises cover numerical bodies through downgrade/reapply,
private artifact visibility, nested continuation, profile/run round trips and
template version/context fidelity. They do not establish workflow execution.

Step 2 now connects explicit scoped read requirements to transactional changed
objects, independently versioned representations, dependent composed geometry
and conflict-aware undo. Shared geometry composition is implemented here because
the DAL needs the same calculation that M3 will expose through domain commands.
Its integration exercise passes for representation edits, following borders,
idempotency, rollback and conflicting undo. Unreferenced terminal-run artifacts
and grids can be discarded while checkpoints, committed references and lineage
retain their inputs. Network reads page/count in SQL and retain independent
located spaces; scoped dependency reads include connected reaches, access
connections and following sources. Small field selections read numerical array
slices and rebuild clipped sample measures without hydrating the source grid.
Template-instance member/layer mappings and stable layer registries are stored
transactionally. Submitted plans are sealed independently of mutable job state.
M3 still
owns command invariants, authoring validation and the HTTP authority boundary.
Its field-edit commands will extend these write sets with authored sampled
patches and operation-owned artifacts; generation publication remains M7.

M2 exit: workspace checks pass. Real PostGIS cases exercise migrations and their
supported downgrades, all typed payload families, channel/window reads, private
artifact visibility/retention, nested continuations, template versions/context,
scoped network pagination, following geometry, monotonic commits and conflict-aware
undo. Migrations 023–024 add stable layer/instance mappings and sealed run plans.
Read selection now loads nearby network interfaces once and follows actual
geometry dependencies; it avoids traversing an entire connected watershed for
an ordinary edit. Generation, full command authority and product UI are still
unfinished milestones.

### M3 — Shared spatial domain and authoritative operations

[depends on M0, M2]

Scope: implement shared TypeScript domain commands for world/area/layer/entity
authoring, direct and semantic feature/field/network edits, traits/exceptions,
protections, preview/commit, invalidation, reconciliation and undo/history.
Complete stable cross-scale representation composition, ownership, locked
boundary/halo contracts and located access/vertical topology. Add thin
authenticated Lambda HTTP adapters over those operations and DAL reads.

Acceptance: create a sparse world, skip a creation profile, establish a bounded
child field and road/water crossing, edit inside its interfaces and retain the
same semantic identities. Invalid boundary/ownership/protection changes produce
actionable diagnostics; reconciliation previews the real dependency closure.
Multi-object changes publish atomically with actor/version/provenance. A small
present-day edit leaves completed history intact.

Evidence: exercise these operations through the real HTTP adapter and database,
including failed/stale requests, independent spaces, protected sampled patches,
following borders and the same composed geometry in reads/analysis/export.

Sulion: `4e4615eb-4309-4ed2-95d9-a508c10d2ef8`.

#### Execution steps

1. Shared intent/validation contracts: implement the versioned domain operation
   registry, runtime schemas, scoped dependency requirements, attribute/layer
   schemas, local/effective constraints and explicit materialization ownership.
   Reuse M2's composition and storage adapters; evaluate geometry and attributes
   through the same model used by downstream reads.
2. Authoring and refinement: implement world/area/layer/entity/view/magic
   authoring, direct and semantic feature/network edits, field creation and
   sampled sculpt/protection, locked boundary contracts, located access,
   invalidation and explicit reconciliation. Extend typed write sets and SQL for
   operation-owned artifacts, field patches and metadata where these intents
   require them. Preserve source identity, authored protection and completed
   history. Template definition storage is reused; procedural placement remains
   the M6 catalog/template outcome.
3. Authoritative HTTP integration: wire read/preview/validate/commit/analyze,
   reconciliation, history and undo through authenticated TypeScript handlers
   and PostGIS. Use Ahara's ALB JWT-validation boundary and owner/entitlement
   claims. UI and MCP will consume these same operations in M8. Package/deploy
   wiring remains M9.
4. Persisted authoring journeys: exercise a sparse world with skipped profiles,
   field/network boundaries, local reshaping, authored sampled patches, following
   borders and independent vertical spaces. Check actual adapter conflicts,
   preview/commit parity and undo; correct omitted behavior before M3 exit.

Expansion `bddda856-f1b0-4847-985b-0e64b756b51e`: steps
`2e39fd1b-f1cc-4545-88c3-a4062a8b7386`,
`bfac2722-2bce-46da-ac0e-1c54cc26a92a`,
`6c4bbc5c-060e-429e-973a-8604757614ee`, and
`81d4c581-1cba-4193-bfb9-4295840162a6`, respectively. Step 1 is complete; steps 2 and 3 are in progress.

Shared authoring intents now bind typed inputs to scoped read requirements and
pure change sets. Feature and area creation retain effective constraints,
stable representations and locked interfaces. Parent validation excludes a
child's own detail when checking that child's inherited boundary, preventing
an old overlay from hiding a disconnected parent edit. Real IntentService /
PostGIS journeys cover preview/commit parity, retained protected detail,
idempotency, stale requests and ownership.

Migration 029 makes authored sampled patches independently revisioned and links
immutable operation-owned artifacts to their audit operation. Field creation,
bounded sculpting and patch protection use the shared registry. A persisted
journey confirms that sculpting leaves surrounding samples and the immutable
base binding intact, and undo restores the composed field. Network topology,
metadata commands, reconciliation, HTTP authority and the remaining M3 journeys
are still in progress; workflow execution remains M4.

Independent review found and implementation corrected sampled-patch precedence,
scope escape and interpolation-support defects. Protection metadata retains an
immutable creation order. Effective fields sample ordered overlays by their
actual footprints; smoothing reads a separate one-cell support halo. Constraint
validation computes bilinear extrema over clipped cells, including quadratic
edge extrema and scoped exceptions. Persisted cases cover overlapping brushes,
protection toggles, consistent full/narrow reads and forged child scopes.
Layer-declared facts distinguish physical fields from unrelated custom channels.

Present command work also adds versioned views/magical sources, sparse-world
creation, explicit located access-node connections and local network noding.
Network edits retain remote reach geometry; ordinary junction movement is
diagnosed. Agent writes use shared protection checks. Product section 14.3's
high-impact confirmation applies to owner commits; agents can request the
owner's confirmation through the editor. HTTP identity follows Ahara's actual
ALB boundary: ALB verifies issuer/signature, the Lambda checks access-token
purpose and this application's client, and `sub` owns data. No additional
entitlement claim is minted by the platform. Terraform now passes the client ID
and permits an unauthenticated OPTIONS-only preflight route; no apply occurred.
HTTP journeys cover sparse refinement, independent spaces, typed access,
protection, actor restrictions, retries and conflicts. Shared coarse-feature and
field reconciliation retain authored detail/patches and completed history while
updating affected child interfaces. Traits validate effective sampled values.
Migration 032 distinguishes world-scoped semantic fact invalidation from spatial
invalidation; resource freshness intersects the requested geography. Undo retains
the original invalidation scopes. Analysis reads the same composed features and
fields. M3's final workspace checks passed; editor, MCP, procedural catalog
and publication wiring remain their later milestones. M10 will check broader
analysis sampling, precision propagation and sequential undo across restored
revisions; these are retained work, not completion claims for those behaviors.

### M4 — Configured processes over shared GIS/domain state

[depends on M0, M2, M3; develops initial real processes alongside M5]

Scope: adapt the overgeneralized runtime to Canonry's process/application model.
Use a shared private working map, registered apply/validate processes, typed
parameters, required/produced/invalidated facts and configured sequence order.
Map profiles select processes and settings. Epoch loops carry altered state and
bind changing variables; ordinary TypeScript composition supplies reusable
sequences and nested history where needed. Develop the interfaces with actual
GIS, physical and magical processes. M5 owns the complete algorithm catalog.

Acceptance: the same registered process runs at two profiles and at multiple
causal positions. An actual physical/magical sequence evolves the shared map
across changed epochs, retaining material/magical consequences and resetting
current forcing. Incorrect order yields a missing/stale-fact diagnosis.
Deterministic restart preserves equivalent geographic results and
history. Future profile edits leave an existing job's configuration intact.
Generated results preserve identity, boundaries and authored protections.

Evidence: inspect real fields/features and physical/magical feedback through
the common process context, alongside focused behavior checks. Interrupt a real
stage and restart from the pinned input state deterministically. Arithmetic
and clipping exercises can support runtime checks but do not establish physical
generation behavior.

Implementation choices: keep working arrays in memory, use explicit process
order and keep reproducible job inputs. Remove the existing
compiler, port-binding, per-node continuation and journal code where it exceeds
those needs. Reassess the underlying schema/DAL for coupling, database work,
memory use and operating cost, including ordinary authoring paths. Replace
unnecessary machinery while preserving retained user data. Persistent intermediate
recovery needs an actual process cost or explicit behavior that restart cannot satisfy.

Sulion milestone: `bdaf0b0f-0c5b-4872-8fe2-92655eb8b92d`.

#### Revised execution direction

1. Establish the shared working map and apply/validate lifecycle alongside actual
   GIS, physical and magical processes. Preserve scoped facts and authoring rules.
2. Configure profiles, ordered reusable process sequences, typed settings and
   epoch loops. Exercise changed variables, carried consequences and reset forcing.
3. Replace execution persistence with frozen job inputs/configuration and status.
   Remove generic candidate stores, recursive checkpoints and dense operation
   parameter duplication; restart interrupted work deterministically.
4. Exercise actual geographic outputs, causal feedback, regional interfaces,
   authored protection and safe publication inputs. Complete the process catalog
   in M5 and the execution host adapter in M7.

#### Prior implementation and outstanding work

Active expansion `25b5e129-1442-45c1-8f44-804d5e63cab4` follows the four revised
steps above: shared map/real processes, profile sequences/epochs, job persistence
with retirement of the old executor, then integrated geographic behavior.
Input protection and reproducible recovery remain required outcomes.

Canceled expansion `da5f9f6c-973e-4a03-8921-f25509082453` records the earlier compiler,
validated-resource execution and nested-continuation work. Its first three
completed steps are historical implementation results, not completion of this
revised direction. Its fourth step was skipped because its exact-continuation
acceptance is superseded by the adaptation above. Revised M4 execution is active.

The historical migrations through 033 created the generalized binding and
per-node continuation model. Migration 034 removes those tables and their DAL;
the current runner uses shared state. Independent review found
input-rebinding, dependency selection, epoch ordering, unit/output validation,
protection and authored-field composition defects. Assess and fix retained
behavior during adaptation; simplifying the engine does not waive geographic
correctness or authored-data preservation.

### M5 — Causal physical and magical process catalog

[depends on M4]

Scope: implement atlas-specific TypeScript processes for crust/tectonics,
orography, volcanism/impacts, material resistance/mass wasting, oceans/coasts,
climate/transport, drainage/water balance/erosion/deposition, ice and persistent
landforms, surface derivation and named-feature extraction. Configure World,
Region and Local workflows with inherited historical states, local sampling,
halos and fixed interfaces. Implement declarative magical sources, propagation,
storage/decay, interactions, material advection and physical feedback at the
proper workflow positions. Quality controls sampling and algorithm depth.

Acceptance: warm/glacial/present epochs produce accumulated physical and magical
consequences with distinguishable natural state, applied forcing and history.
Regional refinement elaborates parent geography while retaining stable feature
identity, crossings and protected authored detail. A magical exception explains
its physical effect. Selected regeneration updates its declared outputs and
invalidations. Each listed mechanism has an implemented process or a documented
equivalent within the atlas algorithm, rather than an empty stage label.

Evidence: inspect representative geographic outputs and their causal resources,
alongside structural continuity, conservation where modeled, boundary and
determinism checks. Compare the algorithms with the relevant Canonry reference
bodies. Keep effort at map-generation fidelity and the agreed atlas scope.

Sulion: `c074f2dc-1f37-4ce0-bdf6-1b798c5f561e`.

### M6 — Human geography, sites, caves, interiors and templates

[depends on M4, M5]

Scope: implement independently selectable culture/population/migration and
political processes with overlapping prevalence, claims, sovereignty,
administration, effective control, institutions and historical consequences.
Implement settlement/route/infrastructure, parcel/building, cave and interior
processes through the common runtime. Inherit physical/human history at the
correct epochs; model cave substrate/fractures/water and construction,
occupation, abandonment and later alteration where applicable. Complete
versioned template authoring, placement validation, access binding, identity
mappings and workflow recipes.

Acceptance: culture and political geography remain distinct while responding
to terrain, access and history. Refinement preserves polity/culture identities.
A cave beneath inherited limestone/glacial terrain has a consistent history
and connected surface entry. A reusable tavern template instantiates twice
with correct world/floor transforms, independent instance identities and
connected access. All generated layouts satisfy their actual spatial and
network constraints, with present edits preserving completed history.

Evidence: inspect causal outputs at applicable profiles, overlapping thematic
queries and stable identities across refinement. Exercise cave and construction
histories, template context/unit failures, successful placements and protected
recipe regeneration. Human history remains a constrained generation model.

Sulion: `998b40c8-35f8-4599-bbbd-99f96a5a8b15`.

### M7 — Execution lifecycle and authoritative generation publication

[depends on M2, M4; integrates M5, M6]

Scope: resolve the user-owned host/lifetime decision, then implement its
adapter over the shared runtime. Complete durable submission, execution
ownership, progress, cancellation, failure and deterministic restart.
Define result transport that fits
the actual ALB/Lambda path. Bind upload/read/publication authority to the saved
plan, actor, input revisions, resource identities and allowed scope. Validate
latest protections and dependencies when publishing. Commit domain changes,
artifact references, operation history and completion coherently. Template
recipe scheduling uses the same reliable job submission behavior.

Acceptance: a saved request has an honest observable lifecycle, including after
browser closure according to the agreed behavior. Duplicate submission and
retry do not duplicate committed features. Recovery restores pinned inputs
and deterministically restarts unfinished work.
Cancellation/failure preserves committed geography. Forged output
layers/scope/artifacts cannot authorize writes. Concurrent edits produce safe
publication or explicit conflicts. Submission responses distinguish durable
acceptance from execution failure, including template-triggered work.

Evidence: exercise the chosen adapter with large field artifacts, interrupted
execution, stale inputs/protections, duplicate requests and publication failures.
Inspect actual committed state and saved job inputs. The host decision is
blocking here, not for preceding domain/schema/workflow implementation.

Sulion: `caa639f5-a0bb-436d-928c-6ecb034d14a6`
(existing title: “Replace compute hosting”).

### M8 — Complete editor, HTTP and MCP integration

[depends on M3, M5, M6, M7]

Scope: adapt the React/OpenLayers editor to shared contracts and scoped reads.
Provide profile/workflow selection, effective parameters, epoch/magic
configuration, real node progress and lifecycle controls. Complete geographic
selection/refinement, sparse-detail states, manual/semantic editing, layers and
styles, fields/analysis, entities/relations, protection, templates,
reconciliation, provenance/history and undo. Implement all required HTTP/MCP
operation families over the same authority, with actual authentication,
owner-scoped reads/writes, pagination, error semantics and transport behavior.
Complete GIS-compatible interchange with explicit CRS/vertical metadata and
documented losses.

Acceptance: product journeys work through the editor and equivalent MCP
operations. Arbitrary typed GIS layers require no generator. Political/cultural
views alter presentation of shared data. UI previews, committed reads and export
agree on geography. Unmaterialized, intentionally empty, generated, authored,
protected and stale states remain distinguishable. Every visible control has
an implemented operation and reports actual outcome, including conflicts.

Evidence: exercise specification scenarios A–I with representative worlds and
templates through real adapters. Check auth/owner boundaries, layer/field views,
preview/commit parity and cache updates after authoring and job publication.

Sulion: `2eb0126c-bc54-4b1c-97cc-580c929e016c`
(existing title: “Integrate product and platform”).

### M9 — Ahara delivery paths and prototype retirement

[depends on M3, M7, M8; package compatibility established in M0]

Scope: complete TypeScript builds, Node Lambda ZIP/runtime packaging, local
developer/test commands, migration tooling and shared Ahara CI/platform.yml
coverage for all workspace packages. Reconcile Terraform, shared-module
compatibility and actual project admission in `ahara-infra`; any necessary
shared-module changes are bounded prerequisites with their own plan branch.
Preserve Cognito/shared ALB/VPC/RDS/state ownership and the configured frontend,
API and MCP identities. Align README/domain API docs with actual behavior and
manual extension setup. Retire replaced C# projects, copied runtime sources,
SDKs, containers and .NET build/CI configuration after tracing their consumers.

Acceptance: documented commands produce and check the complete application and
deployment artifacts through Ahara's established paths. Configured domains are
`vellum-and-vector.ahara.io` and `api.vellum-and-vector.ahara.io`, with MCP on
`/mcp`; configuration is distinguished from deployed availability. No remaining
product capability or build step depends on the retired prototype. Database
provisioning, manual extension setup and application migration ordering are
correct and reviewable before a first deployment.

Evidence: run the relevant workspace/build/CI and static Terraform/package
checks locally. Inspect the shared module and admission configuration, not just
project documentation. Live apply, DNS verification and manual shared-RDS
extension installation occur only within later deployment authorization.

Sulion: `ef8f3563-d03b-4f5c-b1ef-ba01ea369ca2`.

### M10 — Complete product behavior and remaining remediation

[depends on M0–M9]

Scope: resolve remaining gaps discovered across the full requirement map;
exercise specification scenarios A–I and every workflow-design scenario with
real persisted worlds. Include custom layers/interchange, inherited cave and
human history, repeated/refined generation, changed definitions, resumption,
conflicting edits, templates and all UI/MCP command families. Measure ordinary
editing and representative larger generation/read/write workloads; address
observed unnecessary global work and report actual variability.

Acceptance: every requirement in product section 16 has a concrete implementation
and observable behavior, with architecture constraints honored. Generated maps
show the required causal structure and usable geographic output. Data survives
reopening and resumption without lost identity, authored state or history.
Ordinary local edits remain interactive while generation proceeds. Required
checks pass; unresolved functionality remains an unfinished milestone rather
than being covered by an earlier completion label.

Evidence: inspect the maps and user journeys as well as focused automated
checks of durable and spatial invariants. Summarize actual results and material
limits in this plan's existing milestone state and chat/CI output. Completion
does not require a separate verification report.

Sulion: `2cd0192d-6582-4144-8cd0-4f65f9e11266`
(existing title: “Exercise persistence and authoring”).

## Coverage and execution state

| Product requirements                                                                                    | Owning milestones |
| ------------------------------------------------------------------------------------------------------- | ----------------- |
| GEO-01–05: reference, sparse hierarchy, boundaries, cross-scale identity, connectivity                  | M0–M3, M5, M6, M8 |
| LYR-01–04: shared built-in/custom layers and views                                                      | M0–M3, M5, M6, M8 |
| GEN-01–06: causal history, magic, human domains, scoped generation, quality/jobs                        | M1, M2, M4–M8     |
| EDIT-01–04: responsive edits, authored/materialization state, validation/reconciliation                 | M1–M3, M7, M8     |
| TMP-01: detached definitions and anchored instances                                                     | M1–M3, M6–M8      |
| DOM-01–03: common UI/agent operations, durable service and MCP                                          | M0–M3, M7–M9      |
| INT-01: geometric interchange and CRS metadata                                                          | M0, M3, M8        |
| EXT-01 and workflow-design scenarios: extensible processes/layers, configuration, cycles and resumption | M0–M2, M4–M8      |
| Ahara readiness, retained-data transition and prototype removal                                         | M0–M2, M9         |

M10 checks the complete map, including supporting behavior missed during
individual migrations. Future discoveries update the owning milestone and
dependencies instead of silently reducing scope.

Planning phase: `fbf9633b-bf4b-4aa3-8e72-8c98888b9535`.
M0–M3 have implemented foundations; M4 remains unfinished and requires adaptation
to the corrected generation direction. M5–M10 remain pending. The instruction
correction is tracked in prerequisite branch
`79d9cdc4-d65a-436a-ae80-1c74e8f79cf2`, now complete. It changed guidance and plan
acceptance; application changes remain for resumed implementation. Read current Sulion
guidance and relevant source before continuing. M7's host/lifetime decision
remains open and does not block independent domain work.

At phase boundaries, record implemented behavior, actual checks, remaining gaps,
decision changes and the next action in the relevant milestone. A multi-step
prerequisite gets a nested Sulion branch tied to the affected phase. Retain this
document as the detailed execution record and keep the Sulion root synchronized.
