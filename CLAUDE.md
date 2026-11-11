# Vellum & Vector

## Project instructions

Read and follow [AGENTS.md](AGENTS.md) for the product direction, application
boundaries and working instructions. The [README](README.md) provides setup and
deployment context. The [product contract](docs/product-spec.md) defines behavior;
the [spatial ADR](docs/adr/0001-spatial-authority.md),
[frontend session ADR](docs/adr/0003-frontend-session.md),
[coupling ADR](docs/adr/0004-coupling-through-each-systems-medium.md),
[scale contract ADR](docs/adr/0005-scale-contract.md),
[landmarks ADR](docs/adr/0006-landmarks-are-injected-causes.md),
[magic materials ADR](docs/adr/0007-magic-systems-are-materials.md),
[regional refinement ADR](docs/adr/0008-regional-refinement-is-conditioned-amplification.md)
(regional refinement is a bidirectional, multi-pass process),
[named entities and shares ADR](docs/adr/0009-named-entities-persist-and-cells-are-shares.md) and
[processes and materials ADR](docs/adr/0010-processes-and-materials-meet-through-modes.md),
[process coupling ADR](docs/adr/0011-processes-couple-through-keys-and-a-ledger.md) and
[people ADR](docs/adr/0012-people-live-on-the-lands-layers.md) record
implementation direction. User requirements and explicitly agreed boundaries govern revisions
to agent-derived choices in those documents and in open plans. The
[documentation index](docs/README.md) lists every durable document.

## Project overview

A TypeScript web atlas for progressively generating and authoring fictional
worlds, with shared geographic identity, causal epoch history, configurable magic,
overlapping thematic layers and located templates.

## Code layout

| Path                                                | Current contents                                                        |
| --------------------------------------------------- | ----------------------------------------------------------------------- |
| `frontend/src`                                      | React/OpenLayers editor, browser workspace client and generation worker |
| `frontend/tests`                                    | Browser UI wiring tests on fixture worlds                               |
| `packages/domain`                                   | Shared TypeScript spatial model, lattice, typed-array structures, magic |
| `packages/application`                              | Command planning, normalization and authoring operations                |
| `packages/storage-browser`                          | SQLite/RTree catalog, GEOS geography, numerical resources and saves     |
| `packages/generation`                               | Pure TypeScript geography, regional refinement and human processes      |
| `packages/name-forge`                               | Name generation (PolyForm Noncommercial license)                        |
| `infrastructure/terraform`                          | Frontend-only Ahara website hosting                                     |
| `backend`, `db`, `infrastructure/backend-prototype` | Preserved backend prototype, outside the active build                   |
| `docs/adr`                                          | Current spatial, generation, storage and platform decisions             |

## Architecture patterns

Shared TypeScript domain and generation modules underpin the browser editor.
Read [ADR 0003](docs/adr/0003-frontend-session.md): no backend, server persistence
or MCP. The workspace keeps records in a local SQLite/RTree catalog with GEOS and
numerical resources in OPFS; **Save map** keeps a map across reloads, and unsaved
changes disappear on reload. The
[generation workflow design](docs/generation-workflows.md) defines the common
GIS/domain-backed process contract, profile-selected sequences, parameters and
epoch cycles. Steps declare the bands they need and write, and processes shape land
through declared contracts ([ADR 0011](docs/adr/0011-processes-couple-through-keys-and-a-ledger.md)).
Workers report progress and can be terminated; there are no restart or recovery
mechanisms. Initial generation installs streamed output progressively;
regeneration publishes after validation and a world-revision check.

## Development commands

Use `pnpm dev`, `make ci`, `make build` and `make test-browser`, as documented in
[README.md](README.md#local-development). No credentials, API or database are needed.
