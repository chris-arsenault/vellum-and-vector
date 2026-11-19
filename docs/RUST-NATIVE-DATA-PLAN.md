# Rust-native data plan

Working copy of an open plan. The last milestone moves its durable content into an ADR
and the backlog, then deletes this file.

## Outcome

Generation, record storage, parent→child capture, publication and GIS storage hold data in
Rust-native and GIS-native forms: numbers stay numbers, identities are fixed-width values,
catalogue members are ordinals, geometry crosses boundaries as native or WKB geometry, and a
map's layers are layers in storage rather than entries in a JSON document. Strings remain
for names, labels and other text a person reads; JSON remains for entities with no schema
worth defining. The Kesworcester refinement chain (world → country → district → city) runs
end to end on the result, and its step times are recorded against the baseline below.

## User requirements (owner, 2026-11-19, this session)

1. Address every finding of the Kesworcester performance work in one plan; do not
   concentrate on one of them.
2. Use numeric representations where appropriate, and do not convert them to strings and
   back.
3. Avoid strings, JSON included, wherever possible.
4. Work in GIS-native concepts: not JSON blobs of layers, but layers.
5. These are artefacts of the original TypeScript implementation; fix them for a
   Rust-native implementation.
6. Break the build and the tests while doing it. Do not make micro patches to keep CI green;
   this is a large-scale change.
7. These are not hard rules. Some strings are needed, and JSON is appropriate for entities
   that do not warrant their own schema.

Carried from the parent performance plan and standing direction:

- `execution.rs` keeps its query/command paradigm (owner-direction 2026-11-12).
- The local atlas harness is Rust and uses neither JavaScript nor GeoJSON (owner,
  2026-11-19).
- Results may change for performance; numerical equivalence is not a goal (owner,
  2026-11-19).
- Architectural changes are built in place of the old structure, with the fine details
  the old code handled kept in a checklist (see the M0 inventory).

## Findings this plan addresses

From profiles and code reading on 2026-11-19 (Kesworcester 15 km city, 45k–130k buildings):

| # | Finding | Where |
|---|---------|-------|
| F1 | Every map's layers live in one JSON document (`map.revisions.descriptor jsonb`, ~3 MB, ~1,000 layers), rewritten whole for each raster group and read whole by queries | `atlas-gis/src/postgres_maps`, `map_store` |
| F2 | Feature geometry crosses into PostGIS as GeoJSON text, then is parsed, validated and snapped per row in PL/pgSQL after Rust already validated and snapped it | `postgres_maps/records.rs`, `schema.sql` `map.canonical_geometry` |
| F3 | Feature attributes and relations are a `jsonb` bag per feature, indexed by JSON paths and a GIN index | `map.features.data` |
| F4 | Inspection samples copy every raster band (~900) into every cell, each as a CBOR attribute row | `publication/samples.rs`, `map.samples` |
| F5 | Identities are strings: map, revision and feature ids are UUIDs carried as text; semantic ids are made from a JSON-encoded `[kind, key]` | `identity.rs`, every table |
| F6 | Closed catalogue members (feature kind, layer, area, actor, domain, cause) are strings on every record | `features/records.rs` `Feature` |
| F7 | The generator's working feature store is SQLite rows of whole-feature JSON text; 37 read sites across world, regional and town steps parse JSON on every read | `atlas-host/src/record_store` |
| F8 | Parent→child capture edits numerical resource descriptors as `serde_json::Value` by key and moves features one at a time through clip, magic-source scan and JSON store | `atlas-host/src/regional_capture` |
| F9 | The generation service replies through `serde_json::Value`; observations keep whole-town JSON (55 MB at maturity) in the job's in-memory event list | `atlas-host/src/native_jobs*` |
| F10 | The town's street graph is rebuilt from the whole town in every step; occupied ground is cloned per step | `atlas/town/development.rs`, `processes/town/*` |
| F11 | The town economy keys sources by formatted strings and sorts and maps by them each round | `atlas/town/providers.rs`, `town/influence.rs`, `processes/town/economy.rs` |
| F12 | Hot numeric loops read bands element by element through `BandState::get` returning `io::Result`; rock cargo access hashes and allocates per cell; regional place effects, water evolution, coastal forcing and fluvial erosion dominate regional rounds | `storage/band.rs`, `rock/cargo.rs`, regional steps |

Baseline (Kesworcester city, 15 km, from the district): regional work 2,660 s; town rounds
1,190 s for 45,268 buildings; publication 1,000 s (rasters 448 s, records 344 s).

## Decisions

Agent-derived (revisable with evidence; reasons in each milestone):

- Identities are 128-bit UUID values in Rust, PostGIS (`uuid`) and SQLite (16-byte blob);
  text appears only at the presentation edge.
- Closed catalogue members are Rust enums or catalogue ordinals; their labels are looked up
  for display.
- A layer is a row with typed columns, and each vector layer's declared attributes are typed
  columns of its features. Undeclared attributes stay in one `jsonb` column.
- Stored geometry is WKB that Rust has already validated at the map's precision; storage
  checks validity once without a GeoJSON round trip.
- Inspection reads band values from the published rasters. Samples keep only what rasters
  do not hold.
- The generator's record store is typed and indexed. Whether it stays in SQLite or moves to
  memory backed by the block cache is decided in M5 from measurement.

Provisionally kept as JSON (each confirmed or replaced in M0): people memory entities,
history entry detail, edit payloads, saved navigation and settings, magic configuration,
and open feature attributes.

## Milestones

### M0 — Representation inventory and guard
Scope: a checklist in this document of every string, JSON and blob representation that
crosses a module or storage boundary, each with a verdict (numeric, typed, GIS-native, or
kept as JSON with its reason), the details the current code handles, and its milestone. A
guard test fails while the rewrite is in progress.
Acceptance: every F1–F12 site and every table column has a verdict and an owning
milestone; the guard is in place.
Evidence: review of the checklist against `schema.sql`, `map_store/schema.sql`,
`features/records.rs`, `record_store`, `regional_capture`, `native_jobs`.

### M1 — Identities and catalogue ordinals [depends on M0]
Scope: F5, F6. UUID values for map, revision, feature and entity ids; semantic ids
computed from typed parts without JSON; feature kinds, layers, areas, actors, domains and
causes as enums or catalogue ordinals inside generation and storage.
Acceptance: no identity or catalogue member is formatted and parsed as text between
generation and storage; names and labels are still text.
Evidence: source review; unit tests of id derivation and catalogue lookup.

### M2 — GIS-native map storage [depends on M1]
Scope: F1, F2, F3 in both PostGIS and the browser SQLite store. Layer and feature-type
tables replace the descriptor document; features carry typed declared-attribute columns,
an open `jsonb` column and WKB geometry; relations are rows; revisions and heads use UUID
keys; the map description returned by the API is assembled from rows.
Acceptance: publishing writes no layer document and no GeoJSON; a layer, its features and
their relations are queryable as rows; the map API returns the same information.
Evidence: PostGIS integration test; source review of both stores.

### M3 — Inspection from rasters [depends on M2]
Scope: F4. Band values at a point are read from the published rasters through a Rust
GeoTIFF tile reader; samples keep their footprint and inspection sections only.
Acceptance: inspecting a cell shows the same band values as before; sample storage no
longer grows with the number of bands.
Evidence: inspection test on a fixture map; sample table size on the city map.

### M4 — Publication writes typed rows [depends on M2]
Scope: F1, F2 on the write path. Features, samples and history stream as typed binary rows
in large batches; raster groups add layer rows; no per-record JSON assembly.
Acceptance: publication builds no `serde_json::Value` per record and rewrites no layer
document.
Evidence: profile of the city's publication; PostGIS test.

### M5 — Typed generator record store [depends on M1]
Scope: F7. Features held with UUID ids, catalogue ordinals, native geometry, a spatial
index and typed plus open attributes; selections by layer, kind and area are index
lookups; checkpoints archive the store in binary.
Acceptance: no generation step parses JSON to read a feature; the 37 read sites use typed
access.
Evidence: source review; profile of a regional round and the settlement step.

### M6 — Typed parent→child capture [depends on M5]
Scope: F8. Resource descriptors handled as the typed `Descriptor`; features taken from the
parent's store in binary and clipped against one prepared region; magic sources excluded
by id set.
Acceptance: capture edits no untyped JSON documents; each feature costs one clip.
Evidence: source review; capture step time on the chain.

### M7 — Typed generation service and retained observations [depends on M0]
Scope: F9. Generation calls reply with typed values; observations write their town
fabric and preview grid to retained files and the event carries a reference; the harness
reads those files.
Acceptance: the job's event memory does not grow with town size; no JSON preview encoding
on the server's path.
Evidence: server memory during a city run; harness town pictures still drawn.

### M8 — Town network and integer keys [depends on M1]
Scope: F10, F11. The access network is held with the fabric and updated as holdings and
streets change; occupied ground is updated rather than cloned; economy sources and
endpoints are keyed by integer ids.
Acceptance: no step rebuilds the whole town's network; no formatted ids or string sorts
in the economy.
Evidence: profile of a late town round; town round times on the city run.

### M9 — Numeric hot paths in world and regional steps [depends on M0]
Scope: F12. Kernels read and write bands through block or slice views rather than
per-element `io::Result` calls; rock cargo storage holds its parcels without per-cell
hashing or allocation; each of place effects, water evolution, external coastal forcing
and ancestral fluvial erosion is profiled and its dominant cost addressed.
Acceptance: each listed step's dominant cost is addressed and measured on the chain.
Evidence: before and after profiles on the Kesworcester chain.

### M10 — Contracts, frontend and harness [depends on M2, M3, M5, M7]
Scope: regenerated ts-rs contracts; the UI reads layers, attributes and inspection in their
new forms; the browser workspace (WASM and SQLite) matches the native host; the Rust
harness report and pictures use the new APIs.
Acceptance: the UI's browse, inspect and edit journeys work; the harness reports a map.
Evidence: browser UI wiring suite; harness report on the city.

### M11 — Integration and measurement [depends on M1–M10]
Scope: remove the guard, run the suites once and repair them, create a new kept world, run
the Kesworcester chain, and record step times against the baseline. Durable content moves
into an ADR (GIS-native storage and numeric representation) and the backlog; this file is
deleted.
Acceptance: CI is green; the chain completes; times are recorded against the baseline.
Evidence: CI run; chain logs.

## Sulion mapping

Root plan `191f40bb-7ee3-428a-a891-404962c0bd68`. Milestone phases: M0 `7377ad2c`,
M1 `8104aa0e`, M2 `3ed3608d`, M3 `fbd7466a`, M4 `e15dc76f`, M5 `0cf2ff19`, M6 `1d349354`,
M7 `527472bf`, M8 `22fd5701`, M9 `df67b6d7`, M10 `0a302338`, M11 `b0570d3e`.

## Current state

Planned 2026-11-19. Next: M0.
