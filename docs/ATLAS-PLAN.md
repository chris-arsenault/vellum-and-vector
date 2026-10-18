# Atlas implementation

**Historical plan:** Current work follows the user's frontend-only direction in
[ADR 0003](adr/0003-frontend-session.md). Backend, persistence and MCP are deferred.

This file records historical implementation work. Current direction is defined
by [AGENTS.md](../AGENTS.md), [README.md](../README.md) and the replacement
[spatial](adr/0001-spatial-authority.md) and
[application](adr/0002-relational-spatial-storage.md) ADRs. Read the milestones
below as history of the prototype. The current
[remediation plan](REMEDIATION-PLAN.md) covers replacement implementation against
the TypeScript architecture and product contract.

Contract: `.sulion-paste/world_atlas_creator_design.md`, 2026-10-17 baseline.
Execution is authorized locally, including the Ahara integration prerequisites.
Deployment, publication, commits and pushes are outside this request.

Root Sulion plan: `a1eedc4d-e84f-4ccd-8210-a99708827518`.

## Decisions and reuse

- Use a planar fictional metric engineering CRS initially, with explicit east/north/up
  axes, domain and vertical datum. Reject unsupported topologies explicitly. See
  [the coordinate and authority ADR](adr/0001-spatial-authority.md).
- Keep Canonry's domain-neutral `Engine.WorldGen` and `Engine.Constants` sources
  pinned to `0f62584c114863ffadeb5e29e021f5fce6b37a61`. Reuse the physical evolution
  session, not its game kernel, Godot UI, fixed setting, or gameplay projection.
- Use .NET for the domain service and workers so the existing causal algorithms
  run directly. React/OpenLayers consumes the same commands as agents.
- Use shared PostgreSQL with indexed feature envelopes and NetTopologySuite exact
  geometry predicates. This avoids requiring a platform-wide PostGIS extension;
  geometry is standard GeoJSON in a declared fictional CRS, never implicit WGS84.
- Keep field artifacts separate from ordinary edit transactions. Jobs publish
  validated artifacts and domain changes atomically and preserve authored detail.
- Use an HTTP Lambda behind the shared ALB and separately launched container
  workers for long jobs. Reuse Cognito, VPC, RDS and state. No generation timeout
  is inferred from a performance aspiration. Local tests use isolated PostgreSQL.

## M0 — Spatial contract

Sulion phase `7519eb13-7726-4a3a-bf6f-162509cc9f01`; expansion
`daf81162-1507-41ab-bc08-c85a2dc80359`.

Outcome: anchored World/Region/Local/Site/Interior areas, custom layers, stable
feature identity, invertible local/vertical frames, locked crossings, explicit
traits and noncompeting refinement ownership.

Execution:
1. Write coordinate/authority ADR. Step `42ababa5-3ffd-4a2d-aff5-c05b3b884c6c`.
2. Implement domain records, geometry operations and refinement validation in
   `backend/Atlas.Domain`, with boundary, containment, inheritance, local-frame
   and authored-protection tests in `backend/Atlas.Tests`.
   Step `012289be-772d-47dd-bc04-35ce13a75913`.

Acceptance: a child can skip profiles, resolve world position, inherit a field
and road/river crossings, refine without moving those crossings, and reject
contradictory ownership or ordinary outlet movement. Tests exercise these
contracts rather than prescribed sample-map content.

## M1 — Generation and domain service [depends on M0]

Sulion phase `f6aa7c90-de99-4e1b-a116-ce790d31b5e7`.
Expansion `a193f232-58cc-49c2-81f4-e9295216db30`: causal generators;
durable domain operations; real database and generator acceptance.

Execution steps:
1. Adapt Canonry physical evolution; add constrained child refinement and separate
   magic, cultural, political and built generators in `backend/Atlas.Generation`.
   Verify deterministic inputs, locked edges and semantic identities in Release.
2. Implement `backend/Atlas.Persistence`, `backend/Atlas.Api`, SQL migrations and
   worker entry point. Validate versioned transactions, indexed queries, artifact
   separation and cancellation against isolated PostgreSQL.
3. Exercise the shared operations and job publication, including concurrent edits,
   failure, retry, stale versions and undo in `backend/Atlas.Tests`.
Implement persistence/migrations, typed preview/commit commands, undo/history,
spatial query/export, deterministic coarse physical generation and constrained
child refinement, declarative magic, independent political/cultural and built
generators, templates, durable jobs, cancellation and conflict-safe publication.
Acceptance: domain and real-PostgreSQL tests establish atomicity, idempotency,
restart persistence, cancellation, protected edits and immutable history.

## M2 — Atlas editor [depends on M1]

Sulion phase `bb90f18b-1bed-4198-ac0a-bce455c514e3`.
Expansion `647f8ce6-5dd2-47a8-9444-1e3131f1dda2`.
Execution steps:
1. Build the typed HTTP/auth client and OpenLayers canvas in `frontend/src`, with
   a fictional metric projection and raster/vector presentation separated from data.
2. Add hierarchy, domain operations, layer composition, geometric editing,
   refinement, templates, magical rules, history and durable job controls.
3. Run TypeScript, ESLint, Vitest and browser journeys against a temporary real
   PostgreSQL/API setup; stop every test-owned process/container afterward.
Implement world creation, map navigation, selection/refinement, visible lineage,
layer presets/composition, feature/field inspection, geometric and semantic
editing, template authoring/placement, job controls and proposal previews.
Acceptance: browser journeys operate against the real local service; zoom does
not materialize geography; political and cultural views retain world identity.

## M3 — Platform and acceptance [depends on M1, M2]

Sulion phase `50ddb967-2f6e-4056-9d18-8a3e3f208317`.
Expansion `28b44147-0f40-463d-92eb-257bc5bcaf0f`.
Execution steps:
1. Add project Terraform and worker image/deploy scripts; register the actual
   deployer and database in `../ahara-infra`. Reuse existing VPC, ALB, Cognito,
   RDS, SSM and state. Use standalone Fargate tasks, not an always-running service.
2. Complete API usage/architecture docs and remaining cross-layer acceptance;
   fix concrete issues found while exercising those contracts.
3. Run `make ci`, browser journeys, self-contained packaging and offline Terraform
   validation. Inspect scoped sibling changes and stop test-owned services.
Implement Ahara registration, shared database admission, Cognito, ALB, frontend
and worker deployment definitions, custom .NET build gates using shared actions,
usage/architecture documentation and the integrated acceptance scenarios.
Acceptance: `make ci`, real persistence tests, browser journeys and Terraform
validation. A local pass does not establish deployed behavior.

## Initial delivery state — superseded by remediation

The initial M0–M3 completion claim was incorrect. The local application passed 19 backend tests and
two frontend tests. The editor and agent journeys
exercise real PostgreSQL, generation, independent overlays, skipped profiles,
POI creation, detached template placement, protection, export and persistence.
Chromium and Firefox pass locally. WebKit requires host libraries absent from this
development environment; the CI matrix installs them through Ahara's shared action.
Self-contained packaging, non-root worker startup and offline Terraform validation pass.
No deployment, commit, push or external publication occurred. The sibling platform
registration remains a local change that must land before application deployment.

The initial coordinate implementation deliberately supports planar worlds only.
Cultural/political generation is a deterministic present projection of inherited
geography, not an ongoing civilization simulation. Worker retry recomputes a saved
input snapshot rather than resuming inside a numerical stage. Authored physical
fields are retained as complete artifacts. Hour-long jobs and large-scene editing
latency have not been measured; no runtime caps are imposed to imply those goals
were verified. Remote MCP OAuth discovery remains a separate integration; current
MCP access uses the platform bearer token.

## Specification remediation

Root Sulion plan: `b8e78b77-a820-40f2-ad09-b5db80b88a7c`.
The original plan remains historical; its completion does not establish product completion.
The user authorized this remediation plan and execution on 2026-10-17 after three
source reviews identified missing mechanisms. The complete product contract remains
`docs/product-spec.md`, including its detailed behavior, not just its checklist.

Outcome: progressively author one coherent world from continents to interiors,
with coupled bounded generation, maintained topology, causal history, independent
human geography, contextual templates, and usable shared human/agent operations.
Existing local work is preserved. No branches, commits, pushes, deployments or
external publication are authorized. No separate review or completion report is needed.

### Design direction

- Retain the real Canonry world pipeline, planar metric CRS, NTS geometry,
  PostgreSQL transactions/artifacts, durable jobs and Ahara definitions.
- Resolve geographic truth from a nonoverlapping spatial composition of base and
  detail patches. A parent's rendering and queries include committed child detail;
  generalization derives from that composition. Interior spaces/floors have distinct
  scene scope while retaining their actual world coordinates and explicit access.
- Track local authoring intent separately from effective inherited constraints.
  Authorship attaches to a representation or field mask, not every representation
  of a feature or every sample in an artifact. Parent changes resolve through the
  ancestry and mark real downstream facts stale.
- Maintain directed network nodes/reaches and explicit entrance connections.
  Geometry editing must retain junctions, flow feasibility and connection attachment.
  Reconciliation follows actual feature/network relations and geographic dependencies.
- Replace child noise-and-bending with a bounded physical solve on an explicit
  regional mesh/grid with neighboring influence, fixed interfaces and causal substrate.
  Drainage, water balance, erosion/deposition, climate and ice respond to one another;
  physical laws and material contracts are reused from Canonry where applicable.
  A raster is an implementation choice, not permission to omit those processes.
- Preserve sufficient physical causes and epoch consequences for local histories;
  extract semantic lakes, river systems, peaks/craters and classifications instead
  of claiming generation from a layer flag. Feature identity survives resampling.
- Selected magic uses the same physical response as full generation. Declarative
  effects compose through explicit dependencies, propagation, storage, feedback and
  exception mechanisms; gravity is not merely a validator bypass.
- Generate historical human geography through population and route processes,
  migration/diffusion, institutions, polity expansion/control and relationships.
  Distinct political facts have distinct causes. No ongoing civilization simulation
  or historical timeline editor is introduced.
- Site, cave and interior layouts derive from spatial context and process history.
  Templates carry local units, contextual constraints, entities/recipes and access
  requirements; placement binds actual doors, routes and vertical connections.

Provisional numerical assumption: a bounded raster with a surrounding influence
domain can satisfy the required local conservation and topology. R1 owns this
decision; if current Canonry mesh adaptation is a better fit, change the solver
without reducing the physical or boundary requirements. Existing planar scope is
settled; globe rendering and an ongoing civilization simulation remain non-goals.

### R0 — Shared spatial authority and topology

Sulion phase `ed1b3d52-9ee0-4945-a4ef-a0206dfd81c0`.
Expansion `e96edf38-a3fe-47a7-a8ee-879dd3b38541`; steps respectively
`456e53bc-f4a5-490c-b07d-eff6ae41bc53`,
`399a1295-e302-49fa-acaf-457080d0fb3a`,
`dee682f1-9b29-43dc-a205-88c637ce8360`,
`4b074bc7-7eb7-45ed-8757-026c36a86ecb`.
Scope: world/detail composition, spatial and floor scope, inherited constraints,
representation-level authorship, directed network contracts, dependency reconciliation.
Consumers: GIS query/export, map rendering, every generator, edit commands and jobs.
Acceptance: a local river edit changes the same world feature in parent and child
views, unaffected reaches remain; floors do not leak into one another; changing an
ancestor trait updates effective descendant constraints; editing one representation
does not protect unrelated reaches; moving a connected entrance cannot strand it;
reconciliation identifies connected reaches and bound thematic features.

Execution steps:
1. Implement canonical feature composition and live effective constraints in
   `Atlas.Domain`; distinguish local constraints and spatial authorship from inherited
   state. Resolve base/detail attributes together and preserve original source geometry.
2. Implement directed junction/crossing contracts, connection maintenance and
   dependency traversal in `Atlas.Domain`; wire commands and generation publication.
3. Wire spatial/floor composition through query/export, field sampling and React map
   presentation. Update existing API/ADR documentation where the authority changes.
4. Exercise actual nested/adjacent geometry, directed water connections, independent
   floors and scoped edits; inspect the resulting geometry and domain records.
   Existing tests remain baseline regression checks, not the definition of completion.

### R1 — Bounded causal physical generation [depends on R0]

Sulion phase `5fa21d77-0ab8-4373-a41c-48a0137649f8`.
Replace interpolation/noise/sinusoidal pathways with bounded material-aware geography:
inherited/neighboring substrate, priority-conditioned drainage and receiving waters,
runoff/discharge budgets, lakes, channel and floodplain geometry, fluvial transport,
climate transport/orographic response, ice accumulation/flow and retained deposition.
Retain parent forcing and epoch causes, preserve authored masks and fixed crossings,
and derive semantic feature identities rather than exposing independent lattice edges.
Acceptance: a refined watershed develops new coherent internal drainage and landforms
without changing contracted external flow; terrain changes produce coupled climate,
water and ice effects; source features and inherited history remain interpretable.
Inspect representative generated fields/networks, conservation and shared-edge behavior.

Expansion `5d712d84-1ce4-443f-b683-915f10620727`:
1. Retain Canonry epoch substrate, material, motion and process consequences in field
   artifacts; resolve parent and neighboring influence into a regional halo.
2. Couple priority-flood drainage, precipitation/runoff/groundwater, sediment transport,
   atmospheric transport and ice mass transfer. Fix geographic interfaces and authored
   samples during the solve. Retain explicit water and material budgets.
3. Route inherited waterways between fixed crossings and shared junctions using the
   physical surface; extract connected drainage chains, lakes and terrain features.
   Preserve semantic identities on refinement and present-day regeneration.
4. Exercise arbitrary polygons, receiving waters, coupled terrain/climate changes,
   conserved transfers and inherited epoch consequences. Inspect actual output fields
   and networks before closing R1.

Numerical direction: finite-volume regional raster with a sixteen-cell surrounding
influence domain. The root continues to use Canonry's triangular lattice. Regional
evolution resolves inherited material/tectonic forcing rather than assembling new
continental plates. Completed epoch surfaces remain immutable during present edits
and ordinary regeneration; they are inputs to local history and later cave processes.

Root prerequisite branch `5d389dd6-47d5-40e3-becf-11e8973a4be8` adapted Canonry's
constraint boundary. Native layers must consume constrained terrain and climate;
export-time clamping is removed. Authored flat/cold worlds can legitimately lack
natural precipitation/current diversity or dry land, so those expectations are
separated from structural field, material, drainage and water validation.

Regional interface branch `d40f41d1-7d1b-4d37-a4c6-77a47d904f8f` addressed numerical
resolution and connected storage before the user directed work away from river
simulation. Initial worlds publish Canonry's completed solve directly. Subsequent
physical response and refinement use the regional model. Control volumes are clipped to
the actual footprint, including holes; stock densities are prolonged by overlap.
Water transfers include finite groundwater movement and river/aquifer exchange.
Lake minima retain separate storage until their surface reaches an intervening saddle.
Extracted river vertices carry their own discharge and junction inflow.

The spec requires approximate inherited discharge, not exact equality between
different discretizations. Generated crossings therefore retain an immutable
discharge envelope derived from the parent's channel variation and the unresolved
runoff of coarse control volumes cut by the child's boundary. Authored quantities
remain exact. Local water budgets conserve the actual rainfall, melt, storage and
external transfers; an uncertainty envelope supplies no water. Positions, directions
and water levels remain fixed. A solve outside the inherited envelope still requires
physical storage/transport or explicit reconciliation. This replaces the earlier,
agent-authored exact-discharge restriction.

### R2 — Causal magical systems [depends on R1]

Sulion phase `96fa63b4-f9f7-4021-8b46-cd0837d7150c`.
Implement declared source/propagation/effect composition with fracture, cold/ice and
bathymetric ocean transport, storage/decay/advection, interactions and physical feedback.
Selected-domain work runs the same affected physical processes as full generation.
Gravity and other exceptions supply a scoped physical mechanism with provenance.
Acceptance: geothermal, cold/ice and coastal systems change physical consequences
when generated locally; present sources preserve past epochs; interactions retain
natural backgrounds and explain their combined result.

Execution uses `RegionalMagic` inside the existing physical response. Propagation
uses fracture conductance, temperature/ice storage, ocean depth and current direction;
ordered dependencies compose intensities. Fields retain source intensity, stored
energy, accumulated wake, natural reference and applied forcing. Selected magic
publishes the affected physical fields and geometry through the same job as combined
generation. Completed epoch records are retained. Gravity strength supplies a scoped
potential head in metres; an authored uphill path must have sufficient potential
drop, rather than merely naming a source. The editor exposes dependency selection.

### R3 — Historical cultural and political geography [depends on R1, R2]

Sulion phase `9e482d5a-3b62-459f-9957-0ec96bbea496`.
Generate population/settlement suitability, traversable routes, migration and cultural,
language and religious diffusion with origins and institutions. Produce distinct
sovereignty, jurisdictions, claims, actual control, capitals and relationships from
constrained historical expansion/contraction and geography, population and culture.
Acceptance: route/terrain/magic changes have causal demographic consequences; cultures
overlap across states; disputes/control have causes independent of polygon buffering;
regional/local refinement preserves identities while adding meaningful local detail.

Execution uses finite population counts for cultures, speakers and religious
affiliations. Growth responds to carrying capacity; conservative movement follows
terrain, water, ice and route costs. Independent affiliation movement produces
overlapping distributions. Child detail conserves inherited culture totals within
its footprint and retains completed era snapshots. Origins, communities and faith
institutions are located entities/features. Human eras have explicit durations and
optional physical-epoch contexts, configured before generation.

Political frontiers use traversable supply distance, founding-cultural support,
population resources and era capacity. Historical reach retains claims; changes in
frontier advantage establish title, while current supply determines effective
control. Claims over foreign control produce disputes and rivalry. Communities seed
administrative districts; capitals and trade/rival relations retain polity identity.
The private generation context feeds completed cultural output into politics and
built generation before the single atomic publication. Field history is inspectable
through the editor and API without introducing an interactive timeline.

### R4 — Contextual sites, interiors and templates [depends on R0–R3]

Sulion phase `0fdd3024-2be1-47a9-89e6-b7a3570db0b8`.
Implement settlement/site access, parcels, building/room connectivity, walls, doors
and furnishings; generate caves from lithology, fracture, groundwater, dissolution,
collapse, deposition/flood and occupation context. Construction, abandonment and
rebuilding produce geometric consequences. Templates declare local frames/units,
contextual placement constraints, entities and optional generation recipes; resolve
actual door/street/surface and vertical attachments, with separate floors/subspaces.
Acceptance: a reusable tavern/cave template binds to compatible located geography,
doors and circulation connect, floor views remain independent, and later editing
preserves fixed local history and detached definitions without silent propagation.

Execution uses community-based settlements and terrain-routed transport with
located river crossings and ports. Sites derive frontage seeds and Voronoi parcels
from their access network; buildings have actual doors and street paths. Interior
partitioning creates connected rooms, doors cut wall openings, and furnishings
inherit use and condition. Population contraction, flood damage and renewed growth
retain abandonment, collapse and rebuilding with footprint/layout consequences.

Cave paths follow sampled fracture/soluble-rock/groundwater conductance. Each path
samples inherited epoch surfaces for dissolution, ice damage, collapse and deposits;
these change aperture, floors, chamber geometry and passability. Present aquifer head
produces underground water. Habitation remains require nearby settlements.

Templates have an owner-scoped library independent of worlds, composed unit/frame
transforms, local entities/layers, access sockets, context requirements, additional
floor spaces and durable generation recipes. Placement remaps actual features and
entities, binds access geometry, and retains each instance independently of later
definition edits. Editor, HTTP and MCP expose the same library/placement operations.

### R5 — Complete authoring and integrated workflows [depends on R0–R4]

Sulion phase `002fd1d2-36cd-4a40-9ea7-5fb7e6864618`.
Complete schema-driven custom GIS attributes, entity/relationship editing, meaningful
semantic terrain/river/network operations, adjustable positive/negative field brushes,
spatial query/analysis and visible dependency reconciliation. Add extent/profile
selection paths and contextual template authoring; UI and MCP use the same operations.
Avoid whole-world index reconstruction for a small edit; scope data retrieval and
rendering by extent and space. Preserve production/authentication and Ahara boundaries.
Acceptance: the full §13 journeys and §17 scenarios are executable through ordinary
authoring tools, with geographic and historical consequences visible and editable.
Check representative artifacts and actual interactions before final build/CI checks.

Execution adds typed scalar/structured attributes, editable relations, located entity
origins, custom layer schema updates, terrain landforms, routed networks, adjustable
field brushes and entrance/floor/portal connection editing. Spatial analysis is shared
by HTTP, MCP and the editor. Fixed-interface edits can stage related changes and preview
their impact before explicit reconciliation. Scene/raster reads follow the viewport;
OpenLayers retains unchanged objects, and small commits update only changed feature
index rows plus their bound dependents. New authored cultures seed declared populations;
demographic child totals and inherited edges remain fixed. Template edits retain imported
socket identities, requirements, unsupported access features and relations.

### Remediation current state

R0 is implemented, including follow-up review corrections to bindings, indexing,
multi-feature reconciliation, authored field limits, node identity and generation
publication. Further R1 river work is stopped at the user's direction after the
implementation grew disproportionate to the atlas product. The current regional
model retains coupled terrain, climate, ice, water and material effects. Initial native
world publication works after removing the competing second world solve. A physical
refinement around a native watercourse can still fail its regional outlet/storage
constraint; that advanced R1 scenario remains unresolved. R2–R5 are implemented;
ordinary editor/agent integration is exercised locally. The root plan records R1 as
skipped under the user's scope correction, rather than completed. No reviewed omission is declared repaired
merely because a schema, endpoint, named algorithm or generated flag exists.
