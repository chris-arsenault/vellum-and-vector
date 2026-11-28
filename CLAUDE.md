# Vellum & Vector

## The fundamental rule

**Owner direction — 2026-11-27.** Districts, cities, streets and the world must all be
the result of chaotic interactions: processes execute multiple times and feed forward
and back into each other, producing very different results even when input differences
are small.

Read every other instruction, ADR, plan phase and memory in the light of this rule; it
governs when a narrower one seems to ask for something else. It forbids constructing a
result, such as one process that lays streets on a grid with grid spacing as its
variable. It does not forbid tables of numbers: a table of grid spacings per template is
right when each value is one part of a formula inside processes that run repeatedly and
feed back. Before designing or changing generation, run the four checks in
[AGENTS.md](AGENTS.md#the-fundamental-rule): more than one process, results crossing
between rounds, a loop that amplifies early differences, and a small input change that
gives a visibly different result.

**Chance comes from one place.** A rule that weighs its options and takes the best, or
cuts a field at a level, is constructed. Write a rule as many small steps that chance
takes part in, and take that chance from `crates/atlas-generation/src/chance.rs`: its
"What to reach for" table names the piece for a choice, a spread, a line, a patchy share,
a size, or a level that wanders over eras. `chance/examples.rs` there is the pattern for a
rule and for the many-rolls check that proves it, and
`cargo +stable test -p atlas-generation --lib gallery_of_chance -- --ignored --nocapture`
draws every piece in a second. Before reporting a rule done, list where chance enters it
and what each draw changes on the map. CI fails a file that adds a draw or a noise call
of its own.

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
[process coupling ADR](docs/adr/0011-processes-couple-through-keys-and-a-ledger.md),
[people ADR](docs/adr/0012-people-live-on-the-lands-layers.md) and
[plate travel ADR](docs/adr/0013-plates-travel-far-apart-from-strength.md) and
[real-scale maps ADR](docs/adr/0016-real-scale-maps.md) and
[GIS-native storage ADR](docs/adr/0017-gis-native-storage-and-rust-native-data.md) and
[cities ADR](docs/adr/0018-cities-refine-into-city-and-district-maps.md) record
implementation direction. User requirements and explicitly agreed boundaries govern revisions
to agent-derived choices in those documents and in open plans. The
[documentation index](docs/README.md) lists every durable document.

## Project overview

A web atlas with a Rust engine and TypeScript frontend for progressively generating fictional
worlds, with shared geographic identity, causal epoch history, configurable magic,
overlapping thematic layers and located templates.

## Code layout

| Path                                     | Current contents                                                        |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| `frontend/src`                           | React/OpenLayers editor, browser workspace client and generation worker |
| `frontend/tests`                         | Browser UI wiring tests on fixture worlds                               |
| `packages/transport`                     | Local/remote GIS and generation facades                                 |
| `packages/engine`                        | Generated WASM artifact and browser initialization binding              |
| `archive/typescript`                     | Unused TypeScript reference generator, tests and development harness    |
| `crates/atlas-names`                     | Name generation (PolyForm Noncommercial license)                        |
| `infrastructure/terraform`               | Frontend-only Ahara website hosting                                     |
| `packages/map`, `packages/atlas-context` | Finished-map values and separate map/generation service contracts       |
| `crates/atlas-host`                      | Job lifecycle, private input retention and native/browser composition   |
| `crates/atlas-generation`                | Numerical generation and finished-map extraction/publication            |
| `crates/atlas-gis`                       | Independent SQLite/PostGIS storage, GIS queries and map files           |
| `crates/atlas-map`                       | Published-map and spatial contracts                                     |
| `docs/adr`                               | Current spatial, generation, storage and platform decisions             |

## Architecture patterns

The migration follows [ADR 0015](docs/adr/0015-finished-maps-and-execution-hosts.md):
pure browser or pure LAN backend, separate map and generation schemas, one shared
Rust native/WASM engine. Active TypeScript is limited to UI, view code and local/remote
facade/platform bindings. Rust owns application, naming, publication and storage behavior.
Presentation reads only published GIS storage. The old generator
and its tests are archived outside normal CI. The browser workspace keeps records in SQLite/RTree with GEOS and
numerical resources in OPFS; **Save map** keeps a map across reloads, and unsaved
changes disappear on reload. The
[generation workflow design](docs/generation-workflows.md) defines the common
GIS/domain-backed process contract, profile-selected sequences, parameters and
epoch cycles. Steps declare the bands they need and write, and processes shape land
through declared contracts ([ADR 0011](docs/adr/0011-processes-couple-through-keys-and-a-ledger.md)).
Workers report progress and can be terminated; there are no restart or recovery
mechanisms. A new map, world or refined region, shows its output as it is published;
regeneration's revision becomes current only after validation and a check that the
map's current revision has not changed.

## Development commands

Use `pnpm dev`, `make ci`, `make build` and `make test-browser`, as documented in
[README.md](README.md#local-development). No credentials, API or database are needed.
Checks that need a generated map run natively on the [local atlas](docs/local-atlas.md)
(`make local-up`, `make local-world`, `make local-real`) against its one kept world, never
by generating in a browser.
