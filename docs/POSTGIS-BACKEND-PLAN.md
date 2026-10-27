# Hosted PostGIS workspace and generation

Status: deferred proposal, Markdown-only. Created 2026-10-27. No Sulion plan is created for
this work. The user's request authorizes this document, not backend implementation, cloud
changes, migrations, deployment or external publication of map data.

## Outcome and relationship to browser work

Provide a hosted workspace for the eventual paid deployment: private persistent geography in
PostgreSQL/PostGIS, numerical resources in S3, authenticated spatial/domain operations and
long-running generation with bounded memory and local scratch. Reuse the domain model,
resource formats and operation contracts established by the
[browser workspace architecture](adr/0003-frontend-session.md).

The browser implementation includes no hosted adapters. This document builds on its contracts;
it is not an instruction to reactivate the old backend, SQL migrations or Terraform unchanged.
An eventual paid deployment requires account/entitlement enforcement, but this plan does not
choose prices, a payment provider or a new billing product. Those are separate product choices.

## Requirements, proposals and unresolved product choices

Requirements from the current request: plan PostGIS, backend services, infrastructure,
migrations and networking; retain domain separation from the browser implementation. Preserve
current geographic identity, representation precedence, authored protection, scoped spaces,
semantic profiles, completed history and map-only editing behavior. Keep the local browser
product usable without a hosted account or automatic upload.

The following deployment/lifecycle choices are proposals, not previously accepted product
requirements:

- Use Ahara's shared AWS platform, a per-project PostGIS database, private S3 resources and
  short TypeScript API operations. Run lengthy generation in AWS Batch on Fargate with local
  scratch and S3-backed resources. Do not run an hours-long Fine process in an HTTP Lambda.
- Hosted generation continues after the browser disconnects. Persist its input references,
  recipe, seed, executable/resource versions, status and completed domain causes. Failure is
  reported; an explicit retry starts from pinned inputs. Do not implement mid-process
  checkpoints, automatic recovery or transparent browser/cloud execution failover.
- Hosted edits become durable when their command commits. Initial generation remains visibly
  incomplete while published in batches; regeneration remains an atomic reference switch.
  Confirm how explicit Save map/named versions appear in hosted mode before implementing UI.
- Use existing platform account/app-access mechanisms as the initial entitlement integration.
  Keep account ownership and authorization at the service boundary; no client-supplied tenant
  identifier establishes access.

Owner decisions: confirm hosted job lifetime/durability and save semantics before H4/H5;
confirm paid access/billing scope before H3/H7; authorize any upload or production cutover
before H7/H8. Implementation may proceed independently on storage/adapters once authorized.
Fine generation still needs explicit authorization. Do not infer live infrastructure state
from registrations, disabled Terraform or old plan completion labels.

## Architecture

| Component                               | Responsibility                                                                                                                |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| React/OpenLayers and typed async client | Domain operations, query/display products and progress; no database credentials or per-cell RPC                               |
| API behind shared ALB                   | Trusted identity, access checks, bounded query/command execution, job submission/status/cancel and authorized resource access |
| Shared TypeScript domain/generation     | Identity, ownership, validation, composition semantics, causal process order and partition algorithms                         |
| PostGIS `SpatialStore`                  | Scoped relational reads, GiST-assisted exact geometry queries, transactions and catalog publication                           |
| S3 `ResourceStore`                      | Browser-compatible Zarr/binary resources, metadata and independently addressable chunks                                       |
| Batch/Fargate generation worker         | Pinned inputs, direct resource I/O, bounded decoded partitions, local scratch, progress and publication                       |

Keep the shared abstraction at the two storage ports and concrete atlas operations. The
PostGIS adapter is a separate query implementation, not a SQL translation of SQLite and not
a second implementation of domain authoring rules. Execute spatial work near its data.
Use SQL joins, indexed predicates, selected projections and bulk transactions; avoid per-record
network loops or rebuilding complete `World` objects. Retain the browser's shared behavior
cases for precision, scope, boundaries and returned domain results.

The API never proxies every numerical sample. Authorized clients receive bounded resource
descriptors and short-lived access to permitted object keys; generation workers use scoped
IAM access. Preserve binary formats and partition identifiers across OPFS and S3. Storage
URLs and credentials remain adapter details. Private responses are not cached as public assets.

## Platform source and current repository state

Read [Ahara integration](../../ahara/INTEGRATION.md),
[CI conventions](../../ahara/CI-WORKFLOW.md), applicable
[Terraform standards](../../ahara-standards/standards/terraform.md) and
[TypeScript standards](../../ahara-standards/standards/typescript.md) before execution.
These files were inspected for this plan; recheck them when implementation starts.

- `infrastructure/terraform/main.tf` currently hosts the public frontend at `maps.ahara.io`.
  `platform.yml` enables TypeScript/Terraform and has no migration path. Preserve this local
  product deployment while introducing the authorized hosted service.
- `infrastructure/backend-prototype/*.disabled` retains obsolete backend examples, including
  per-project OPTIONS routing. Do not enable them wholesale; shared ALB preflight now owns OPTIONS.
- `../ahara-infra/infrastructure/terraform/control/project-vellum-and-vector.tf` exists and
  currently admits only the website bundle and Terraform state policy. Hosted capabilities
  require deliberate control-layer admission changes, not a duplicate registration.
- `../ahara-infra/infrastructure/terraform/services/db-migrate.tf` already lists
  `vellum-and-vector` with database `vellum_and_vector`. Reconcile that entry and inspect actual
  provisioning before choosing a migration baseline; source registration proves no live state.
- Historical SQL, TypeScript/backend code and ADR 0002 are reference material. Current domain
  contracts and runtime semantics are authoritative. Do not restore generic candidate stores,
  dense per-cell rows, obsolete compiler graphs or execution checkpoints.

## Infrastructure and networking

Use the shared ALB, VPC/private subnets, PostgreSQL RDS, Cognito pool and Terraform state bucket.
Discover them through `platform-context`, tags and documented SSM paths. Do not create an API
Gateway, per-project ALB/VPC/RDS/pool/state bucket, NAT Gateway or `terraform_remote_state`.
Shared fck-nat is the existing outbound path; reuse available service endpoints where relevant.
Paid external-user workloads belong in AWS, not owner-only TrueNAS services.

API proposal: a TypeScript Lambda using Ahara's `alb-api` integration, with ACM/DNS for the
selected API hostname, JWT validation at the ALB and actual-response CORS headers restricted
to the approved app origins. Shared priority 1 handles preflight. Search current sibling
Terraform immediately before assigning listener priorities. Validate how the shared Lambda
module packages a TypeScript handler/custom runtime; adapt build artifacts through established
module mechanisms rather than copying the disabled .NET configuration.

Generation proposal: an AWS Batch Fargate compute environment, queue and immutable image-digest
job definition in the shared private subnets, with no public task IP. Include an ECR repository,
task execution role, worker task role, logs and status integration. The worker has database,
approved S3 prefix, image/log and credential connectivity; it exposes no inbound public port.
Size CPU/RAM/scratch from measured browser-process requirements. Fargate scratch is a bounded
cache and temporary workspace, not a requirement to download the whole world's resources.
See [AWS Batch Fargate definitions](https://docs.aws.amazon.com/batch/latest/userguide/create-job-definition-Fargate.html).
Use another platform-compatible execution shape only if actual workload requirements invalidate
this proposal; record the evidence rather than silently reducing generated coverage.

Allow database traffic only through established platform security-group patterns for API and
worker identities, with TLS to RDS. Keep RDS private. Reuse shared subnets/routes; add only
required app-specific rules. S3 remains private with public access blocked, encryption and
policies scoped to this application's data. Browser access uses authorized resource operations
or short-lived signed requests, not public bucket access or embedded AWS credentials.

Extend Ahara deployer admission only for the selected API/auth/storage/Batch/ECR capabilities.
Separate deployment, migration, API, task execution and generation-worker permission needs.
Scope role passing to the app's intended task roles and data access to intended resources.
Runtime secrets use the platform credential path; local secret-backed commands use `with-cred --`.
No `.env` files, committed secrets or credential-source substitutions after an auth failure.

## PostGIS schema and migration design

Derive a fresh reviewed schema from the browser domain, not from serialized JavaScript objects.

| Schema family                     | Required shape and indexing                                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Ownership and worlds              | Account/workspace ownership, world reference and precision, explicit access relationships and version tokens                         |
| Areas and representations         | Geographic parentage, located space, local frame, profile, coverage and authoritative representation precedence                      |
| Features and thematic data        | Stable semantic identity, binary/PostGIS geometry, optional footprint, typed attributes/relations and authored state                 |
| Networks and boundaries           | Shared nodes/reaches/crossings, connected partition interfaces, relevant reusable boundary topology and dependency revisions         |
| Resources                         | Immutable resource/manifest references, channel and topology descriptors, ready/temporary state; no dense samples in relational rows |
| Commands, history and publication | Changed records/resources, conflicts, completed causes, current undo/version semantics and publication visibility                    |
| Generation requests               | Owner, scope, pinned inputs/recipe/seed/code versions, Batch identifier, status/progress/cancel and output references                |

Scope every query and constraint by account access, world and located space as appropriate.
Use planar `geometry` for the fictional metre CRS; retain explicit CRS/frame metadata rather
than applying geographic/geodesic meanings. Match the shared precision policy. GiST indexes
serve feature/footprint/area/boundary searches; B-tree indexes serve ownership, identity,
ancestry, resource and job access. Exact predicates follow candidate narrowing. Do not
replace relevant boundary queries with a global `ST_Union` on every pick.

Use the platform migration service and checksum-tracked, lexicographically ordered SQL with
appropriate rollback counterparts. Inspect existing migration history/data before selecting
new filenames or a transition. Never rewrite an applied migration, reset a shared database or
assume a fresh database. Privileged PostGIS extension setup belongs in the platform provisioning
path where app-role privileges require it. Application migration SQL contains schema/data,
not `CREATE DATABASE`, roles/users, grants or privilege administration.

Test migration application, constraints and rollback against real disposable PostGIS. Preserve
resource references and existing data through a reviewed transition; destructive repair requires
explicit authorization. Database rollback does not imply rolling back independently written S3
objects: publish only ready immutable resources and retain objects referenced by live/history
roots. Reclaim abandoned temporary objects without deleting currently referenced data.

## Implementation sequence, deferred

No step below is executing or registered in Sulion. If later authorized, read the completed
browser architecture and this document before creating the separate hosted implementation plan.

### H0 — Reconcile domain, product lifecycle and platform admission

Depends on: browser domain/resource contracts established, with out-of-core behavior proven
before hosted generation integration.

Inspect current platform records and actual authorized deployment state. Confirm account access,
hosted save/job lifetime semantics, API hostname, long-job compute proposal and supported resource
versions. Map browser operations to service operations without leaking SQLite details. Reconcile
control admission, existing database registration and privileged PostGIS setup requirements.

Acceptance: a concrete topology and migration transition with identified owners; no assumed
fresh database, unverified service capabilities or inherited recovery requirements.

### H1 — PostGIS adapter, schema and migrations

[depends on H0] Implement the typed catalog adapter, migrations, scoped/bulk query execution,
indexed region selection/composition, transactional edits and changed-data notifications. Keep
domain rules shared. Match browser behavior on boundary points, holes, precision, chart seams,
representation precedence, ownership conflicts and returned measurements.

Acceptance: real PostGIS executes the common domain scenarios without complete-world hydration,
cross-account reads or duplicate authoring logic. Migration/rollback evidence uses actual SQL.

### H2 — S3 resources and publication

[depends on H0, H1] Implement `ResourceStore` against S3, compatible Zarr/binary formats, bounded
local file cache, manifest finalization and reference publication. Add IAM/bucket/CORS policies
for authorized transfers and rules for temporary-data reclamation. No bucket-wide public access.

Acceptance: a scoped resource window reads the needed objects/ranges; completed bytes precede
catalog visibility; failed publication cannot expose missing chunks or remove referenced data.
Exercise transfers and failure ordering with service doubles, then a deliberately authorized
private deployment. No actual user-map upload is implicit in implementation authorization.

### H3 — Authenticated service and account isolation

[depends on H1, H2] Build the TypeScript request adapter and frontend async client implementation.
Use ALB JWT validation and shared Cognito, trusted identity-to-account membership, per-operation
authorization and existing app-access/entitlement integration. Implement region/feature/display
queries, commands, history/save operations and resource authorization as coarse operations.
Restrict payloads and result pagination to requested data; large exports use resource delivery.

Acceptance: the same domain operations work through the service; another account cannot select,
read, alter or obtain URLs for a world's data. Handle expired sessions and platform login MFA
states; enrollment remains in `ahara-business`. Pricing/payment integration remains a separate
decision rather than a fabricated entitlement source.

### H4 — Long-running hosted generation

[depends on H1–H3 and browser M5–M7 algorithms] Package the shared generator as a container
using PostGIS and direct S3 resources. Implement submit/status/cancel, pinned inputs and code
versions, progress, previews, staged output and conflict-safe publication. Use Batch's queue
and native job identifiers/statuses; reconcile terminal outcomes after worker loss. Cover the
database/Batch submission gap with an idempotent request record and explicit dispatch handling,
not an unbounded custom scheduler. Default to one attempt; no automatic paid rerun or checkpoint
framework. A user-requested retry creates an explicit attempt from pinned inputs.

Acceptance: lengthy generation outlives the HTTP request and, under confirmed hosted semantics,
the browser connection. Cancellation stops compute and prevents later publication. Duplicate
notifications cannot duplicate publication. Initial output remains incomplete on failure;
regeneration preserves the previous authoritative map and any protected intervening edits.

### H5 — Terraform, networking and delivery

[depends on H0; integrate H1–H4 artifacts] Implement project Terraform for API/auth, private
S3 resources, Batch/ECR/IAM and necessary networking. Update existing `ahara-infra` admission
and migration integration as actual cross-repository changes during execution. Reuse shared
resources, current module versions and TypeScript packaging. Include DNS/TLS, trusted auth
path, CORS, DB credentials, image pulling, private task routes and logging connectivity.

Update `platform.yml`, build/deploy scripts and shared CI integration so migrations run in
the established deployment order. Review Terraform plans against actual state; keep the public
browser-only deployment functional. No disabling permissions boundaries, deny policies or auth
to resolve a guessed deployment failure. Get real logs; stop if the cause is unverified.

Acceptance: formatting/validation and reviewed infrastructure plans cover both project and
platform changes. Authorized deployment provisions the actual resources, runs migrations and
serves authenticated requests; CI success alone does not establish live connectivity.

### H6 — Operations, observability and restoration

[depends on H4, H5] Integrate existing Ahara telemetry with request/world/job identity, stage
latency, resource I/O, database waits and worker failures. Keep high-cardinality identifiers out
of metric labels. Provide operational status/cancel/retry and actionable failure information.
Use platform backup/restore mechanisms for the catalog and a compatible object-retention
policy. Record how a restored catalog resolves its resource versions; do not assume RDS and
S3 snapshots occur atomically.

Acceptance: operator can distinguish queued compute, failed dispatch, failed work, storage
errors, stale publication and auth failures. Exercise a disposable backup/restore with referenced
objects and inspect actual service logs. No separate telemetry product or elaborate recovery
engine is implied.

### H7 — Hosted product integration and explicit data transfer

[depends on H3–H6] Integrate hosted workspace selection, authenticated operations, progress,
save semantics and account access. Local mode remains usable without login or upload. An
explicit transfer uses domain/resource export/import and stable identities; do not sync SQLite
database files into PostgreSQL or automatically upload local maps. Resolve account entitlement
and any paid execution confirmation with the product owner before enabling the paid flow.

Acceptance: creator can intentionally open a hosted workspace, generate/select/edit/save/reopen
maps and export data with the same geographic semantics as local mode. Disconnect behavior is
understandable, and authorization failures cannot be bypassed through resource URLs.

### H8 — Representative hosted verification and closeout

[depends on H1–H7] Exercise real PostGIS query plans, scoped edits, migration transitions,
private resource delivery, cancellation, worker loss and publication conflicts. Measure actual
default Draft interaction and 10k × 5k Standard generation through display. Run the full large
Fine case only with explicit permission; retain unresolved acceptance honestly. Review aggregate
memory, scratch, object I/O, execution duration and costs, without inventing hard CI budgets or
reducing requested detail to pass.

Update durable architecture, usage/deployment instructions and operating procedures as the
implementation becomes real. Retire only obsolete active paths; preserve historical source
until separately authorized otherwise. Move settled content into durable docs, remove this
plan and every current reference to it, and close any later hosted Sulion plan when complete.

## Current state

Only this proposal exists. No backend Sulion plan, code, migration, infrastructure change,
credential use, deployment or data upload has been performed. Browser implementation is the
independent next workstream; this document is ready for later reconciliation and expansion.
