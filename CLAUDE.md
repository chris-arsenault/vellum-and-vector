# Vellum & Vector

## Project instructions

Read and follow [AGENTS.md](AGENTS.md) for the product direction, application
boundaries and working instructions. The [README](README.md) provides setup and
deployment context. The [product contract](docs/product-spec.md) defines behavior;
the [spatial ADR](docs/adr/0001-spatial-authority.md) and
[application ADR](docs/adr/0002-relational-spatial-storage.md) record implementation
direction. User requirements and explicitly agreed boundaries govern revisions
to agent-derived choices in those documents and the plan.

## Project overview

A TypeScript web atlas for progressively generating and authoring fictional
worlds, with shared geographic identity, causal epoch history, configurable magic,
overlapping thematic layers and located templates.

## Code layout

| Path                                                | Current contents                                                 |
| --------------------------------------------------- | ---------------------------------------------------------------- |
| `frontend/src`                                      | React/OpenLayers editor, in-memory session and generation worker |
| `frontend/tests`                                    | Browser journeys                                                 |
| `packages/domain`                                   | Shared TypeScript spatial model, commands and validation         |
| `packages/generation`                               | Pure TypeScript geography and built/human process sequences      |
| `infrastructure/terraform`                          | Frontend-only Ahara website hosting                              |
| `backend`, `db`, `infrastructure/backend-prototype` | Preserved backend prototype, outside the active build            |
| `docs/adr`                                          | Current spatial, generation, storage and platform decisions      |

## Architecture patterns

Shared TypeScript domain and generation modules underpin the browser editor.
Read [ADR 0003](docs/adr/0003-frontend-session.md): no backend, persistence or MCP.
Reloading or closing the tab discards the session. The
[generation workflow design](docs/generation-workflows.md) defines the common
GIS/domain-backed process contract, profile-selected sequences, parameters and
epoch cycles. Canonry supplies the generation structure and algorithmic baseline:
shared working state, application/validation, fact validity and causal magic.
Keep all state in browser memory. Workers report progress and can be terminated;
there are no restart or recovery mechanisms. Completed results become one
undoable session operation after validation and a world-revision check.

## Development commands

Use `pnpm dev`, `make ci`, `make build` and `make test-browser`, as documented in
[README.md](README.md#local-development). No credentials, API or database are needed.
