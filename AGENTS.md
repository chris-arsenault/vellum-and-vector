# Vellum & Vector

## Product and source authority

Build the fictional-world atlas described in [docs/product-spec.md](docs/product-spec.md).
Creators progressively generate and author one geographically coherent world,
from broad landscapes to located sites and interiors. Keep manual editing,
spatial identity, authored protection and understandable causal history central.

Current user direction and the product contract define required behavior. These
instructions and the [ADRs](docs/adr/0001-spatial-authority.md) record implementation
direction. Distinguish explicitly agreed boundaries from agent-derived choices;
revise the latter when a simpler implementation meets the same requirements.
Read the relevant bodies and record consequential changes and their reasons.

**Current scope:** Build a functioning frontend first. Per the user's 2026-10-18
direction and [ADR 0003](docs/adr/0003-frontend-session.md), there is no backend,
persistence or MCP in the active product. Browser memory owns the current session;
closing or reloading the tab discards it. This direction supersedes the storage,
service and durable-job requirements below and in the older design documents.
Do not add recovery or restart mechanisms.

## Application structure

Implement the web application, shared domain logic and procedural generation in
TypeScript. Use React and OpenLayers for the
editor, pnpm for packages, and Ahara's TypeScript tooling and standards.

Organize responsibilities around these boundaries:

| Area                  | Responsibility                                                                       |
| --------------------- | ------------------------------------------------------------------------------------ |
| Frontend              | Map presentation, tools, selection, previews and job inspection                      |
| Shared domain modules | Typed world model, coordinates, commands, invariants and dependency contracts        |
| Generation modules    | Deterministic atlas algorithms, epoch state, causal magic and scoped refinement      |
| Browser session       | In-memory worlds, direct validated edits, spatial reads, templates, history and undo |
| Browser worker        | Generation lifecycle, progress, cancellation and complete result delivery            |

Keep domain and generation modules independent of React, HTTP handlers and
database connections. The UI calls shared domain operations directly.

## Procedural generation

Use Canonry's generation structure and algorithms as the baseline: configured
process order, one shared working state, common application/validation contracts,
required/produced/invalidated facts, deterministic seeds and causal epoch loops.
Adapt that structure to TypeScript and the atlas's GIS/domain model. Read the
corresponding reference implementation before extending its structure.
Choose numerical fidelity and validation precision from the product's map scale
and plausibility requirements, including its approximate physical interfaces.

The [generation design](docs/generation-workflows.md) describes these adaptations.
Registered GIS, physical, magical and human/built processes use the same contract.
Map profiles select processes, their order and typed parameters. Epoch loops bind
changing variables and carry the altered domain state into the next iteration.
Ordinary TypeScript composition supports reusable process sequences and nested
history where the map behavior needs them.

Implement actual geography and magical feedback through that common context;
let those processes establish the interfaces they need. Keep numerical arrays,
completed geographic history and generation status in browser memory. There is
no saved execution state, restart or recovery.

Preserve completed history while ordinary edits change the present. Apply the
same identity, boundary and authored-protection rules to every process result,
and publish validated candidate geography atomically.

Generation runs in a Web Worker and ends when the tab closes. Pure generation
modules remain independent of that browser adapter.

## Spatial model

Use the fictional planar metre CRS and explicit local/vertical frames in
[ADR 0001](docs/adr/0001-spatial-authority.md). Scope features and queries by world
and located space. Compose finer representations under stable feature identities;
keep network crossings and authored protections attached to that geography.

Use shared JSTS spatial operations, composed feature geometry and typed numerical
arrays in memory. Keep reads and writes scoped to the affected geography. Backend
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
