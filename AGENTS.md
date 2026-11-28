# Vellum & Vector

## The fundamental rule

**Owner direction — 2026-11-27.** Districts, cities, streets and the world must all be
the result of chaotic interactions: processes execute multiple times and feed forward
and back into each other, producing very different results even when input differences
are small.

Every other rule in this file, every ADR, plan phase, design document and agent memory
is a consequence of this rule or a detail under it. Read each of them in its light. When
a narrower rule seems to ask for something else, the fundamental rule governs; say which
rule you are reading and ask the owner before acting on the narrower reading.

**What it forbids.** Constructing a result. A city whose streets are laid on a grid by
one process, with grid spacing as its variable, is constructed: the setting decides the
outcome and nothing else acts on it. So is any step that writes the finished pattern
from its inputs in one pass, any fill that reaches a target by a chosen multiplier, and
any output fitted to one seed.

**What it does not forbid.** Tables of numbers. A table of grid spacings per template is
right when each spacing is one part of a formula inside processes that run again and
again and act on each other's results. Catalogues, settings, multipliers and per-kind
values are how causes speak; they are never the fault. The fault is a process that does
not interact.

**How to check a design or a change before building it.**

1. Name the processes that act on the thing. If there is one, it is constructed.
2. Name what each process reads that another process wrote in an earlier round, and
   what it writes that another reads later. If nothing crosses, there is no interaction.
3. Name the loop that amplifies: where an early chance difference grows across rounds.
   Loops that only damp (shares that equalise, costs that rise with what stands, greedy
   choice by one benefit) pull every place to the same result.
4. Change one input a little, on a small field or one kept map, and compare. The same
   result with a small change of grain is a failed check, whatever the numbers say.

A direction that names a mechanism ("no static modifiers", "no caps", "behind
contracts") is this rule seen from one side. Do not read it as a ban on numbers,
tables or settings, and do not rebuild working code to satisfy a narrower reading.

## Product and source authority

Build the fictional-world atlas described in [docs/product-spec.md](docs/product-spec.md).
Creators make maps for tabletop roleplaying, sharing a coordinate system and
world history. Generation supplies interesting geography to work with; numerical
accuracy and continued physical consistency under revision are not product goals.

**Independent regional maps — 2026-10-29 user correction:** Refinement creates a
separate map from parent context. Its elevation and coastline may change freely;
do not freeze inherited heights, conserve parent height samples or require
boundary reconciliation. Refining a child does not modify its parent or siblings.
Later parent changes leave existing children's captured inputs and geography
unchanged. Sharing immutable resource bytes is allowed; map-owned references stay
pinned to their captured resources.
Zooming stays on the open map; seamless navigation between map levels through
zoom is explicitly undesired. Use explicit map navigation. Preserve completed
world history without requiring the revised geography to reproduce it. Region
selection should follow recognizable landforms, including whole islands, and a
coastal region needs room to develop its coast. These corrections supersede older
cross-map physical consistency and boundary-lock requirements in the design docs.

**Deferred product scope — 2026-10-28:** Manual editing, its associated authoring
tools, and undo are deferred until the user resumes their design. Do not implement,
repair, redesign or expand them as part of current work. Preserve their existing
code and tests for future redesign; deferral does not authorize deleting their
implementation or making their eventual return harder. Older requirements for
these features are future scope, not acceptance criteria for current generation,
storage or performance work. Existing code does not establish accepted product
behavior. Generation, regional selection and refinement, inspection, presentation,
explicit local saves and export remain active scope. Completed causal generation
history is separate from undo.

**Real-scale maps — 2026-11-16 owner direction:** Manual authoring and undo are now in
scope for real-scale maps only (ground, caves, settlements, building floors); World and
Region maps stay deferred as above. Land is generated for every real-scale kind and the
creator builds on it with ordinary GIS editing; the first edit makes the published 2D
layers that map's authority. Hexes are a representation built from the shared triangular
lattice, never a lattice of their own. A parent's major landmarks are the only facts a
real-scale child must show and roughly agree with. See
[ADR 0016](docs/adr/0016-real-scale-maps.md).

**Authored maps — 2026-11-21 owner direction:** Authoring of every level, world, region
and city, now takes priority over generation, starting from a blank all-ocean map with
little or no procedural generation. This lifts the deferral of World and Region authoring
for authored maps; generated World and Region maps stay read-only. Work is in the GIS
store and leaves the numerical representation alone; elevation is the only authored
raster; rivers are plain lines; coast polygons decide land and sea; every catalogue kind is
placeable; the target is a finished-looking atlas; agents get the same operations as the UI
over MCP. Ignore generation for this work. See [ADR 0019](docs/adr/0019-authored-maps.md).

Current user direction and the product contract define required behavior. These
instructions and the [ADRs](docs/adr/0001-spatial-authority.md) record implementation
direction. Distinguish explicitly agreed boundaries from agent-derived choices;
revise the latter when a simpler implementation meets the same requirements.
Read the relevant bodies and record consequential changes and their reasons.

**Current scope — 2026-11-13 user direction:** Complete the finished-map and Rust
migration now that the water refactor has finished. Support only pure browser or
pure backend execution, with storage and computation on the same host. The backend
uses TrueNAS compute and its TrueNAS database with LAN-only access and no public route.
Delete the old C# and TypeScript backends rather than reviving them. Published map
products and private generation inputs have separate schemas and lifetimes; normal
viewing reads the map facade. Preserve explicit local saves, independent children,
all presentation and inspection behavior, and the existing architecture paradigms.
See [ADR 0015](docs/adr/0015-finished-maps-and-execution-hosts.md).
The browser worker uses the shared Rust WASM producer; the native application adapter
uses the same core. Do not add a hybrid mode or an incomplete substitute generator.
The owner's 2026-11-15 direction adds limited checkpoint recovery and context management:
one replaced checkpoint per job at completed schedule boundaries, explicit Resume,
coordinated GIS/numerical deletion, and optimistic current-format loading without migrations.
Do not extend recovery to arbitrary process or solver positions.

**Language and storage boundary — 2026-11-14 user correction:** Active TypeScript is
limited to UI, view code and the local/remote facade. Generation preparation, naming,
process execution, map production, storage services and backend application behavior
belong in Rust. A TypeScript wrapper around Rust numerical loops does not complete the
port. Preserve the TypeScript generator in an unused archive for optional port-quality
checks, with its tests outside normal CI; do not delete it or import the archive from
active code. Archive it early rather than preserving its interfaces as the target.
Numerical storage is private generation working/captured data. Presentation, inspection
and export use only published GIS storage and work with generation resources unavailable.

## Application structure

**Subsystem boundary — 2026-11-14 owner diagram:** The TypeScript view/UI reads
finished maps through the TypeScript data-storage facade. The facade selects
PostGIS on TrueNAS or GEOS/SQLite in the browser. Generation reads and writes its
private numerical representation; feature extraction reads it and writes GIS layers
and rasters. `atlas-generation/src/publication` owns that extraction/publication stage,
which runs during map production, never on a view request. Viewer and generator are separate clients
of storage, not callers of each other's implementations. Keep GIS data and query
contracts in `atlas-map`, storage/query implementations in `atlas-gis`, numerical
generation in `atlas-generation`, and application wiring in `atlas-host`.
`atlas-gis` must not depend on generation or private numerical storage. GIS spatial
queries may use Rust/GEOS/PostGIS; language is not the ownership criterion. View
composition stays in the frontend; do not put a rendering-preparation service behind
the data facade. Viewing requires neither a running generator nor private inputs.
This supersedes interpretations that every geometry operation belongs to generation
or that every presentation-related calculation must run in TypeScript.
The diagram itself is [docs/architecture/subsystems.arconis](docs/architecture/subsystems.arconis).

**Rust port — 2026-11-12 user direction:** Execute the finished-map/Rust plan. Preserve
the established software architecture paradigms; numerical data structures may adapt.
Computational foundations and their guards move to one Rust core for native and WASM
execution, with separate published-map and generation contracts. TypeScript keeps the
React/OpenLayers frontend and facade bindings. Rust owns orchestration and publication;
remaining TypeScript implementations are unfinished ports. Only pure
browser or pure backend contexts are supported. The water refactor is complete: port
its final source, ownership and couplings. This supersedes the generation-language
requirement below for the port; foundation checks do not establish a complete generator.

Use React and OpenLayers for the frontend, pnpm for its packages, and Ahara's applicable
TypeScript and Rust standards. Shared domain behavior and procedural generation use Rust.

Organize responsibilities around these boundaries:

| Area                  | Responsibility                                                                        |
| --------------------- | ------------------------------------------------------------------------------------- |
| Frontend              | Map presentation, tools, selection, previews and job inspection                       |
| Shared domain modules | Typed world model, coordinates, commands, invariants and dependency contracts         |
| Generation modules    | Deterministic atlas algorithms, epoch state, causal magic and scoped refinement       |
| Browser workspace     | Canonical records, validated edits, scoped spatial reads, resources, history and undo |
| Browser worker        | Generation lifecycle, previews, cancellation and transferable output delivery         |

Keep domain and generation modules independent of React, HTTP handlers and
database connections. The UI invokes coarse asynchronous workspace operations;
the application layer evaluates shared domain rules against scoped inputs.

## Procedural generation

**User correction — 2026-11-08:** Support only current map and configuration
formats. Do not add or preserve legacy facades, converters or migration fallbacks.
Processes have no arbitrary output or geographic caps. Keep constraints required
by numerical representation and actual material availability; bounded fractions
are distinct from caps on terrain, rates or feature extent. All dimensional
declarations resolve through `MapScale`, and measured settings must not re-enter
the relative configuration boundary.

Generation runs a configured process order on one shared working state, in causal
epoch loops. This product is not The Canonry Game: its code began as a port and has
its own processes now. Do not copy Canonry processes in, and do not keep a value or a
step because Canonry had it. Choose fidelity from the product's map scale and
plausibility requirements.

Every process in a world's history is one entry in `processes/`, owning its algorithm,
settings and any specialist helpers it binds. A native step is a name, a seed salt and
the processes it runs. Feature operations in `crates/atlas-generation/src/atlas/features/` reference those
executable steps; both selected execution and registration derive from those operations.
The sequence modules compose those operations rather than defining a second runtime schedule. New
settings join the profile through their plain settings module. Shared questions compose
responders without editing their consumers. A step that needs a band runs only if a
selected step wrote it earlier or the map inherited it; ordering keeps its inputs useful.
Per the owner's 2026-11-07 correction, prioritize clean code, local extension and reasoning
about actual effects over declaration completeness or metadata enforcement. Typed field
views guide process authors; whole-field builders and local helpers are not sandboxed.

Do not trace numerical accuracy or reproducibility: no fingerprints, exact replay,
byte comparison or closure checks. The generator is being changed on purpose.

The [generation design](docs/generation-workflows.md) describes these adaptations.
Registered GIS, physical, magical and human/built processes use the same contract.
Map profiles select processes, their order and typed parameters. Epoch loops bind
changing variables and carry the altered domain state into the next iteration.
Ordinary Rust composition supports reusable process sequences and nested
history where the map behavior needs them.

Implement actual geography and magical feedback through that common context;
let those processes establish the interfaces they need. Keep numerical fields in
the execution host's private resources and working storage, completed geographic history
in the GIS catalog. The host retains job requests and one private checkpoint at the
supported completed boundaries; live progress remains in memory. Restore owner state
through its existing commands and rebuild disposable query caches and bindings.

Preserve completed history while ordinary edits change the present. Apply the
same identity, boundary and authored-protection rules to every process result,
and publish validated regeneration geography atomically. Per the user's
2026-10-24 direction, initial generation progressively installs streamed output
and shows independent epoch previews; interrupted delivery stays incomplete.

Browser generation runs in a Web Worker and stops when the tab closes. Native generation
runs on the backend and survives a client disconnect. After a host restart, interrupted
jobs wait for explicit Resume from their latest supported checkpoint, or a labelled
restart from the beginning when no checkpoint exists.
Pure generation modules remain independent of both host adapters.

Every map, world, region or real-scale, is a generation state whose geography is the same
physical field on the same triangular lattice class at its own cell span. Fix
world code in place when it fails on a region; do not add a regional grid,
channel vocabulary, unit table, bridge or adapter
([ADR 0008](docs/adr/0008-regional-refinement-is-conditioned-amplification.md)).
Real-scale hexes group that lattice's triangles; they are not a second grid
([ADR 0016](docs/adr/0016-real-scale-maps.md)).
Geographic significance, the rule that decides what a map names and outlines,
is one rule for every map, judged at that map's scale
([ADR 0005](docs/adr/0005-scale-contract.md)).

Maps at different scales are views of one world. Refinement answers where a named entity stands
and how big it is, never whether it exists, and failing to find one is a generator bug to trace.
A coarse value describes the area beneath it, not each child
([ADR 0009](docs/adr/0009-named-entities-persist-and-cells-are-shares.md)).

### Magic source authority

Per the user's 2026-10-22 clarification, the magic systems are first-class world
effects and processes: Fire, Aurora, Pressure, Greenwood, Salt, Hallowed and Veil
(seven, no more, per the 2026-10-24 direction). Preserve their distinct physical
motivations, media, propagation, feedback and interactions; each is a material
with stocks the world's own carriers move
([ADR 0007](docs/adr/0007-magic-systems-are-materials.md)), and their meetings
are processes of their own, never nets or blends. Extension must not require
flattening them into interchangeable generic effects. Use shared process
contracts where useful and system-specific behavior where needed. Do not build
speculative extension machinery before a concrete system needs it.

Before designing magic behavior, read the corresponding bodies in
`../the-canonry-game/docs/lore/lore-bible.md` (especially section 7),
`../the-canonry-game/docs/lore/encyclopedia/three-fires.md`,
`../the-canonry-game/docs/design/physical-microgeography-worldgen.md` and the
relevant `src/IceRemembers.Seed/PhysicalGeneration/Layers` implementations.
Read lore for motivation and code for implemented mechanisms; neither substitutes
for the other. Extract mechanisms without importing named setting lore: gods,
characters, peoples, factions, artifacts, places and historical events do not
become atlas requirements. Record adaptations and proposed additions explicitly.

People's use of a system is its craft: a practice that breaks a rule an existing
process obeys, registered as a breaking responder on the shared question that
process asks
([ADR 0012](docs/adr/0012-people-live-on-the-lands-layers.md)). Design a craft
from the lore and from the process it breaks. No process holds a special case
for a system. Do not replace crafts with hauled material, yield bonuses, generic
abundance, mana, wards or explosions. Treat lore-derived social
uses and practitioner costs as adaptation proposals, not mandatory setting canon.
Configuration and
shaping should expose these systems' actual behavior, not require users to invent
the systems before generation can work.

## Spatial model

Use the fictional planar metre CRS and explicit local/vertical frames in
[ADR 0001](docs/adr/0001-spatial-authority.md). Scope features and queries by world
and located space. Compose finer representations under stable feature identities;
keep network crossings and authored protections attached to that geography.

Use shared spatial contracts with GEOS in each execution context, composed feature geometry
and typed numerical blocks backed by local resources. SQLite/RTree indexes own
canonical records; boundary pieces and display products derive from those records.
Keep reads and writes scoped to the affected geography. Nearest points,
clipping, Voronoi cells, linear referencing and nearest-item lookups go through
the shared `spatial` adapter (GEOS, R-tree or STRtree); do not add hand-written
geometry scans. Finished maps use an independent local catalog or the PostgreSQL/PostGIS
map schema; their readers have no private generation-store capability.
`infrastructure/terraform` hosts only public frontend assets through Ahara's
website module. Backend infrastructure must not add a public route or RDS dependency.

## Working in this repository

Follow the user-wide editing, authorization, credential and planning instructions.
Use native file-editing tools for authored changes and `with-cred --` for
secret-backed commands in Sulion. Read the applicable Ahara integration and
language standards before changing their boundaries.

Sulion plans are a non-linear backlog as much as a list of immediate goals. Going
many sub-plans deep is expected: follow a problem as far as it needs, and record
work found along the way as a phase wherever it belongs instead of doing it
inline or dropping it. Review the plan tree from time to time, and at least
whenever a sub-plan opens or closes, so wanted work is not lost. A sub-plan
extends its parents and does not restate them: when a child takes over a parent's
phase, the parent's note names the child phase, and each piece of work has one
home.

Numerical accuracy and reproducibility are not goals of this repository, and guarding them is
forbidden: no fingerprints, exact-replay gates, byte-identical comparisons or checks that totals close.
Judge changes by what the map and the processes do. See
[ADR 0011](docs/adr/0011-processes-couple-through-keys-and-a-ledger.md) for how processes couple.

The old backends, migrations and deployment scripts are retired. Build the replacement
from the current shared domain behavior and generation algorithms. Distinguish tested
storage/publication foundations from complete frontend and execution cutover.

Assess changes through representative map behavior, geographic output and
focused domain and browser checks. Keep scope tied to the atlas's authoring
workflows and the product's physical-plausibility requirements.

Lint is a CI gate (complexity, lines per function and lines per file on every
`.ts`); lint the touched directory before testing. `make test-architecture`,
part of `make ci`, flags object, `Map`, Proxy or comparator substitutes for the
typed numeric structures in `crates/atlas-generation/src/hpc/` and any regional
representation outside the shared field and lattice. A generation site that no
structure fits carries `// hpc-exempt: <reason>` on its line or the line before.

### Whose direction the code carries

Agents design and iterate on most of this application, and that work is free to
be redesigned. The owner's own directions and corrections are different: they
stand until the owner changes them. The code is the authority, so the code
itself says which is which.

- Code that carries out an owner direction is marked at the governed line with
  `owner-direction(<date>): <the direction in the owner's terms>`. Unmarked
  code is agent-derived and may be redesigned on an agent's judgement.
- Every mark is listed in
  [`ownerDirections.architecture.ts`](packages/atlas-context/src/ownerDirections.architecture.ts),
  which fails when a listed mark is missing from its file. Where a test can
  state the direction's behaviour, the entry also names that test.
- When the owner gives a direction or a correction, add the mark, the list
  entry and the test in the same change that acts on it. A session note, a
  plan, an ADR or an agent's private memory does not establish lineage.
- Never change, weaken, work around or delete marked code, its list entry or
  its test on an agent's judgement, whatever a plan, a refactor or a design
  document says. Ask the owner in the conversation and name the direction
  being changed. The owner does not review design documents, so describing the
  change in one is not asking.
- A mark covers the direction only. The mechanism around it stays agent-derived:
  keep the mark on whatever code carries the direction after a redesign.
- When the owner refers to a past decision, find the discussion in earlier
  sessions before interpreting it.

### Test boundaries — hard requirements

- Routine tests are of two kinds only: unit tests of pure functions, data
  structures, contracts and publication rules on explicit inputs, and UI tests
  of interactions. Do not write tests that run a process on a fixture world and
  assert its simulated outcome, determinism or ledger totals; delete such tests
  rather than repairing their timeouts. Judge generated geography on real maps.
- **Owner direction — 2026-11-28.** A functional change to a generation process is
  proven by a unit test that runs the real process on small constructed inputs and
  checks its outputs, in seconds: "i care that you are using unit tests in order to
  prove functional changes instead of relying only on 10-20 minute generations. you
  need to figure out a way to have the code be tested and results determined quicker.
  this include being able to tell what inputs should create what outputs for a process".
  This is the process test the bullet above does not forbid. It states its inputs and
  the outputs they should give, takes its inputs from the real upstream code and never
  from a guessed magnitude, runs in seconds, and asserts a direction or a clear margin,
  never determinism, exact figures or ledger totals. Tests written only so that a change
  has a test are not wanted. A generation run is for looking at a finished batch, not
  for finding out whether a rule works. Street rounds have a bench for this:
  `crates/atlas-generation/src/atlas/town/bench.rs` founds a small district on
  constructed ground and runs the real steps round after round; see
  [the local atlas notes](docs/local-atlas.md#the-town-bench). City walls have one too:
  `crates/atlas-generation/src/processes/town/urban/defenses/bench.rs` puts a small
  constructed city through the real wall step for a city map's three rounds; see
  [the same notes](docs/local-atlas.md#the-city-wall-bench).
- Browser tests test UI behavior on small supplied worlds. Import `test` from
  `frontend/tests/uiTest.ts`; its automatic fixture uses at most 256 cells and
  blocks real generation workers. Numerical preconditions and raster presentation
  are separate: `numerical: true` supplies data; only `@rendering` (and retained
  `@deferred-authoring`) scenarios enable the raster adapter. Those scenarios must
  assert rendered output, not merely
  controls, metadata, or job completion. Do not opt in to rendering to satisfy an
  unrelated fixture dependency.
  A large dimension entered to test a form is configuration, not permission to
  generate that world. Test physical algorithms and people's operations and
  classifiers in Vitest, on small explicit fields.
- When resuming a generation investigation, read the active plan's decisions and use
  `scripts/local-atlas.sh experiment history <city-or-process>` to find the saved trials.
  Reuse the measurements for an unchanged question. Record a settled result once in
  the active plan with its capture, what was measured, the conclusion and the trial
  path. Replace any phase note that still directs a future session to investigate it.
  Before another generation, identify what changed and which open decision the result
  can settle. A contradictory observation is a reason to reopen a finding.
- A check that needs a generated map runs natively on the
  [local atlas](docs/local-atlas.md): its one kept world, and real-scale maps opened from
  it with `make local-real`. A failed job resumes with `make local-resume` after the fix.
  Do not generate in a browser to verify generation, and do not write another driver.
- Query the local map database through `scripts/local-atlas.sh sql -c '…'` or
  `make local-sql`. The harness opens the local database socket directly. Run it
  without `with-cred` or a hand-written Docker invocation.
- Start ordinary browser scenarios with `openFixtureMap` from `tests/harness.ts`.
  It reuses completed map catalogs and numerical resources across scenarios, then
  restores independent copies into their isolated browser contexts. Reuse the
  same numerical/map configuration; add scenario-specific features, places or
  existing child maps to the copy. Do not rerun generation, resource publication,
  wizard navigation or refinement just to prepare a navigation, inspection, save
  or presentation test. Never share a mutable page/context or depend on test order.
- Exercise the supplied generation worker only when configuration submission,
  progress, cancellation or publication is the assertion under test. Declare
  `@generation` on that scenario, or a reason in `test.use({ generationLifecycle:
"..." })` for a file dedicated to that boundary. The fixture rejects undeclared
  generation. This declaration does not justify unrelated upstream setup; reuse
  the parent map even when the test must run a regional job.
- Before adding a browser scenario, identify its UI assertion, the existing map
  fixture it can reuse, and whether generation or rendering is actually observed.
  Extend a suitable existing scenario when it can share the same setup. Keep
  numerical, geometric and combinatorial cases in Vitest unit tests.
  See `frontend/tests/README.md` for the fixture lifecycle and examples.
- Select checks by the changed boundary. A pure algorithm change uses its
  unit tests and the routine unit suite. Run browser cases for
  changed controls, rendering, editing or worker/UI publication; an algorithm
  adjustment alone does not justify another browser suite.
- Keep automated end-to-end coverage to a few shared Rust generations, with multiple independent
  assertions per result. Reuse suitable generated worlds instead of generating
  a separate world for each check. Add another shared fixture when coverage
  requires different preconditions; there is no fixed generation-count limit.
  Do not rerun the end-to-end suite for each local change.
- These rules organize the automated test suite. They impose no generation quota
  or time limit on implementation, investigation or necessary workload checks.
  Test timeouts apply only to their tests, not to the agent's work. Run the
  representative workloads needed to evaluate the requested behavior and share
  each result across relevant checks.
- Keep Fine generation out of routine automated suites; ask before explicit
  Fine workload verification. The unit setup rejects the full generator,
  ESLint rejects generator and schedule imports in routine tests, and policy
  tests enforce shared generation setup. Do not disguise expensive setup as a
  unit test, route it through another routine runner or increase unit-test
  timeouts to hide it. Use `pnpm --dir frontend test <file>` for focused feedback;
  run the routine suite once the relevant unit tests pass. The old TypeScript generator,
  its `worldIntegration.generation.test.ts` and development harness are archived outside CI.

### Documentation

- `docs/*-PLAN.md` files are working copies of open plans. The last step of
  every plan moves its durable content into the product contract, the
  generation guide, an ADR or the backlog, then deletes the plan file and every
  reference to it. A closed plan has no file; never edit or cite one.
- Durable documentation describes mechanisms at lower fidelity than a plan: no
  provenance chains, measurement tables, parameter sweeps, parameter lists or
  high/middle/low configurations.
- Parameters, thresholds and value sweeps live in code, declared so that a
  reader finds them as easily as in a table (one labelled declaration per
  control, as in `crates/atlas-generation/src/atlas/configuration/cartography.rs`).
- When code and durable documentation disagree, delete the documentation's
  claim rather than equalizing it; the code is the record.
- Architecture diagrams live in one canvas, `docs/architecture/subsystems.arconis`,
  edited with the [Arconis CLI](https://arconis.ahara.io/#cli)
  (`node arconis.mjs --file <diagram> read`); ask the owner before downloading it.
  Each diagram is a frame on its own layer; an overlay that extends a diagram gets its
  own layer placed over that frame. Reuse the canvas's named styles.
- Linked diagram items carry `source "path"` references, and each target has a
  matching `// Arconis: <diagram>#item=<id> — <relationship>` comment beside the
  relevant declaration. When you move, rename or delete a linked file or declaration,
  update both sides in the same change.
