# Vellum & Vector

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

Current user direction and the product contract define required behavior. These
instructions and the [ADRs](docs/adr/0001-spatial-authority.md) record implementation
direction. Distinguish explicitly agreed boundaries from agent-derived choices;
revise the latter when a simpler implementation meets the same requirements.
Read the relevant bodies and record consequential changes and their reasons.

**Current scope:** Build a functioning frontend first. Per the user's 2026-10-18
direction and [ADR 0003](docs/adr/0003-frontend-session.md), there is no backend or
MCP in the active product. The browser owns the current session. The user's
2026-10-27 direction replaces eager memory authority with a local SQLite/RTree and
GEOS workspace plus chunked numerical resources in OPFS. The user's
2026-10-24 direction adds explicit local map saves rooted in IndexedDB for reopening
maps without regeneration. Unsaved changes and independent templates disappear
on reload. This direction supersedes the storage, service and durable-job
requirements below and in the older design documents. Do not add generation
recovery or restart mechanisms.

## Application structure

Implement the web application, shared domain logic and procedural generation in
TypeScript. Use React and OpenLayers for the
editor, pnpm for packages, and Ahara's TypeScript tooling and standards.

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

Use Canonry's generation structure and algorithms as the baseline: configured
process order, one shared working state, common application/validation contracts,
required/produced/invalidated facts, deterministic seeds and causal epoch loops.
Adapt that structure to TypeScript and the atlas's GIS/domain model. Read the
corresponding reference implementation before extending its structure.
Choose numerical fidelity and validation precision from the product's map scale
and plausibility requirements, including its approximate physical interfaces.

**Reference parity means semantic algorithm parity.** Per the user's explicit
2026-10-18 direction, numerical equivalence to Canonry is not a product target.
Compare the operations inside process implementations: their inputs, transformations,
causal order, feedback, state carried between epochs and geographic outputs.
Enumerating process names alone does not establish this parity.

Do not chase matching numbers, hashes, exact seed mappings, rounding or identical
arrays, or use their differences as evidence that a semantic operation is missing.
Existing reference fixtures are regression aids, not acceptance requirements for
atlas adaptations or metre conversion. Assess numerical changes only when they
change a required mechanism, physical meaning, creator control or useful geography.
Record concrete missing or materially changed operations separately from parameter,
representation and implementation differences. Preserve determinism within the atlas.

The [generation design](docs/generation-workflows.md) describes these adaptations.
Registered GIS, physical, magical and human/built processes use the same contract.
Map profiles select processes, their order and typed parameters. Epoch loops bind
changing variables and carry the altered domain state into the next iteration.
Ordinary TypeScript composition supports reusable process sequences and nested
history where the map behavior needs them.

Implement actual geography and magical feedback through that common context;
let those processes establish the interfaces they need. Keep numerical fields in
browser-owned resources and working storage, completed geographic history in the
local catalog, and generation status in browser memory. There is
no saved execution state, restart or recovery.

Preserve completed history while ordinary edits change the present. Apply the
same identity, boundary and authored-protection rules to every process result,
and publish validated regeneration geography atomically. Per the user's
2026-10-24 direction, initial generation progressively installs streamed output
and shows independent epoch previews; interrupted delivery stays incomplete.

Generation runs in a Web Worker and ends when the tab closes. Pure generation
modules remain independent of that browser adapter.

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

Ground society effects in fire-core extraction/use, Aurora crystal and ice-memory
practices, and depth-dependent Pressure use and ocean propagation. Do not replace
them with generic abundance, mana, wards or explosions. Treat lore-derived social
uses and practitioner costs as adaptation proposals, not mandatory setting canon.
The society plan records the proposed aggregate adaptation. Configuration and
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
Keep reads and writes scoped to the affected geography. Backend
and SQL files remain historical source outside the active runtime/build.
`infrastructure/terraform` hosts only public frontend assets through Ahara's
website module; the earlier backend Terraform is preserved in
`infrastructure/backend-prototype` with a disabled file extension.

## Working in this repository

Follow the user-wide editing, authorization, credential and planning instructions.
Use native file-editing tools for authored changes and `with-cred --` for
secret-backed commands in Sulion. Read the applicable Ahara integration and
language standards before changing their boundaries.

The backend and its scripts are historical source outside the active product.
Preserve that source for later reconsideration. Do not resume backend migration,
storage or service work from the old plans. Distinguish the implemented browser
behavior from future architecture in documentation and status updates.

Assess changes through representative map behavior, geographic output and
focused domain and browser checks. Keep scope tied to the atlas's authoring
workflows and the product's physical-plausibility requirements.

### Test boundaries — hard requirements

- Algorithm changes use constructed worlds: explicitly provide terrain, water,
  climate, materials, stocks or society, then call the relevant process. Do not
  generate a world or execute a physical schedule to obtain test preconditions.
- Before writing a test, identify the behavior, its controlled preconditions and
  the smallest set of real processes needed to observe it. Supply unrelated
  upstream products directly. Test a perturbation and relevant unchanged state;
  do not mock the algorithm being tested or merely assert fixture assignments.
- Reproduce an integration failure in a constructed test before changing its
  mechanism. Compare controlled inputs, analytic results, geometry, budgets and
  state transitions; do not tune a seed's geography or weaken an assertion to
  recover a passing result.
- Browser tests test UI behavior on small supplied worlds. Import `test` from
  `frontend/tests/uiTest.ts`; its automatic fixture uses at most 256 cells and
  blocks real generation workers. Enable raster fields only for rendering tests.
  A large dimension entered to test a form is configuration, not permission to
  generate that world. Test physical and society algorithms in Vitest.
- Select checks by the changed boundary. A pure algorithm change uses its
  constructed Vitest cases and the routine unit suite. Run browser cases for
  changed controls, rendering, editing or worker/UI publication; an algorithm
  adjustment alone does not justify another browser suite.
- Keep automated end-to-end coverage to a few shared full generations in
  `frontend/src/worldIntegration.generation.test.ts`, with multiple independent
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
  run the routine suite once the relevant constructed cases pass.

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
  control, as in `packages/generation/src/magicCartography.ts`).
- When code and durable documentation disagree, delete the documentation's
  claim rather than equalizing it; the code is the record.
