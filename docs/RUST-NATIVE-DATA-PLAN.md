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

#### M0 expansion

Sulion: phase `7377ad2c`.

1. Inventory below, reviewed against the cited sources.
2. Guard test `crates/atlas-gis/tests/rewrite_guard.rs` fails until M11 removes it.

#### Representation inventory

Verdicts: **N** numeric value, **T** typed Rust value or typed columns, **G** GIS-native
layer or row, **J** kept as JSON (reason given), **X** removed.

| Site | Current | Verdict | Details the old code handles | Milestone |
|------|---------|---------|------------------------------|-----------|
| Map, revision, entity ids (all tables, APIs) | UUID text | N (uuid / 16 bytes) | Semantic ids are UUID v5 in the world's namespace; parent ids map to child ids in capture | M1 |
| Feature ids | UUID v5 text from JSON `[kind, key]` | N | Stable across regeneration for the same kind and key; contracted ids keep protected features | M1 |
| Feature kind, layer, area, actor, domain, causes (`features/records.rs`) | strings per record | T (catalogue ordinals, enums) | Catalogue in `publication/catalogue.json` names kinds and layers; causes reference POI ids | M1 |
| `maps.descriptor` / `map.revisions.descriptor` | whole description as TEXT / jsonb | G (revision row + `layers`, `feature_types`, `bands`, `spaces` tables) | Descriptor validation (`MapDescriptor::validate`); expected-revision and authored checks at finish; edits rewrite it | M2 |
| `map_feature_catalog.values_json/columns_json/attributes_json/relations_json` (SQLite) | JSON text | T (typed columns) + J for open attributes | JSON-path indexes for `fromPlace`, `toPlace`, `atPlace`; search text | M2 |
| `map.features.data` (PostGIS) | jsonb with attributes, relations, catalog | T + J (open attributes only) | GIN on relations; JSON-path indexes on place attributes | M2 |
| Feature relations | jsonb array per feature | G (`relations` rows) | Relation kinds: worked by, access from, fronts, operating ties | M2 |
| Feature geometry write (PostGIS) | GeoJSON text → `map.canonical_geometry` PL/pgSQL | G (WKB from Rust's validated reduction) | Validity and non-collapse at precision; SRID 0 | M2, M4 |
| `map.samples.data` / `map_samples.data` | CBOR with one attribute per raster band | X for band values (read rasters); T for sections | Category labels per value; display units; edited overlay patches | M3 |
| Publication batches (`PublicationBatch`, `codec::Samples`) | per-record JSON / CBOR assembly | T (typed binary rows) | Batches with cooperative yields in the browser | M4 |
| `map.history.data`, `map.entities.data`, `map.edits.data`, `map.saved.data` | jsonb / blobs | J (history detail, people entities, edit payloads, navigation are open-ended) | Edits hold features before and after | — (kept) |
| `map.history_features` | text ids | N (uuid) | — | M1 |
| `map.assets` | text ids, location | N for ids; location stays text (file path) | Illustration flag | M1 |
| Generator record store (`record_store/features.rs`, `networks.rs`) | SQLite rows of whole-record JSON text | T (typed, indexed store) | Revisions counter per run; selection by area, layer, kind; network nodes and reaches | M5 |
| `generation.records`, `generation.catalogs`, `generation.geography` (PostGIS) and SQLite mirrors | jsonb / JSON text | T for records; J for catalog document until M5 shows its fields are fixed | A child's capture reads its parent's retained records | M5, M6 |
| Numerical resource descriptors in capture (`regional_capture/fields.rs`) | `serde_json::Value` edited by key | T (`numerical_resource::Descriptor`) | Array aliasing to parent resources; footprint rewrites | M6 |
| Parent feature capture (`regional_capture/records.rs`) | per-feature clip, magic-source list scan, JSON store | T | Place ids, area ids, protected flags, network reaches | M6 |
| Generation API replies (`native_jobs::Jobs::answer`) | `serde_json::Value` | T | Configuration documents are edited by the frontend and harness | M7 |
| Observation events (`native_jobs` event list) | preview JSON bytes kept in memory | T + retained files | Resumed jobs restart their cursor | M7 |
| Town observation (`preview::town::Overview`) | whole-town JSON | T (binary retained file) | Stage, phase, round labels for pictures | M7 |
| Town access network (`town/access.rs`) | rebuilt per step | T (held, updated) | Walks, links, entrances, ground costs | M8 |
| Economy source ids (`atlas/town/providers.rs`) | formatted strings, string-keyed maps | N (integer ids) | Alternatives sharing one identity compete per site | M8 |
| Occupied ground (`atlas/town/development.rs`) | cloned per step | T (updated) | Premises and works grounds marked | M8 |
| Band element access in kernels (`storage/band.rs`) | per-element `io::Result` | T (block and slice views) | Paged bands under the block cache's budget | M9 |
| Rock cargo store (`rock/cargo.rs`) | hashing and allocation per access | T | Parcel identities and densities | M9 |
| Checkpoint archive (`checkpoint.rs`) | bands binary, values CBOR | kept | — | — |
| Map files and rasters (GeoTIFF assets) | binary | kept | — | — |

### M1 — Identities and catalogue ordinals [depends on M0]
Scope: F5, F6. UUID values for map, revision, feature and entity ids; semantic ids
computed from typed parts without JSON; feature kinds, layers, areas, actors, domains and
causes as enums or catalogue ordinals inside generation and storage.
Acceptance: no identity or catalogue member is formatted and parsed as text between
generation and storage; names and labels are still text.
Evidence: source review; unit tests of id derivation and catalogue lookup.

#### M1 expansion

1. `atlas_map::Id`: a 128-bit identity, compared and hashed as a number, written as UUID
   text only at the serde/TypeScript edge and as 16 bytes in storage. `MapRef` and every
   map, revision, area and entity id use it.
2. Semantic ids: `identity::semantic_id(world, kind, key)` hashes typed parts (no JSON
   encoding) into an `Id`; feature ids, place ids, relation targets and history feature ids
   are `Id`.
3. Catalogue kinds move to M5. Their only consumer is the generator record, and M5 changes
   that record's representation. Magic kinds (`system:rule`) come from configuration, so the
   record kind is a catalogue ordinal or a configured magic rule, not one closed enum. The
   feature-type id (`json!([layer, kind, subtype])` text in `publication/catalogue.rs`)
   moves to M2, where feature types become rows.
4. atlas-map and atlas-generation build on every target. atlas-gis and atlas-host stay
   broken until M2 and M7 rewrite them; fixing their stores for `Id` first would be done
   twice.

Result (2026-11-19): ids are `Id` from the generator's records to `atlas-map`. Semantic ids
hash fixed-width typed parts (`identity::area_record_id`, `roster::landmark_id`, history
entry ids). These text keys remain, each a key rather than an identity:
- POI place keys (`Place.id`), from which feature ids are hashed; a place standing for an
  existing feature keys on that feature id's text.
- River lineage keys (`riverId`), which mix drainage course keys with feature ids.
- Magic point keys and fault keys.
- Naming seeds and languages, which the naming library takes as text.
Open attributes that hold ids (`fromPlace`, `toPlace`, `atPlace`, `polityId`,
`settlementId`, `carriedOnto`, people groups) still serialise as UUID text inside
`attributes` until M2 and M5 make them relations and typed columns.

### M2 — GIS-native map storage [depends on M1]
Scope: F1, F2, F3 in both PostGIS and the browser SQLite store. Layer and feature-type
tables replace the descriptor document; features carry typed declared-attribute columns,
an open `jsonb` column and WKB geometry; relations are rows; revisions and heads use UUID
keys; the map description returned by the API is assembled from rows.
Acceptance: publishing writes no layer document and no GeoJSON; a layer, its features and
their relations are queryable as rows; the map API returns the same information.
Evidence: PostGIS integration test; source review of both stores.

#### M2 expansion

Revised decision: one `features` table per store, not one table per vector layer. Its
common fields are typed columns, and declared layer properties are typed by
`layer_properties` rows. A table per layer would put about 40 dynamic schemas in each store
and make every query generic across them, with nothing gained for the registry and viewer
queries this milestone serves.

1. Shared row shapes (`atlas-gis/src/rows.rs`). These split a `MapDescriptor` into rows and
   assemble it again:
   - the revision row: identity, world, name, primary space, profile, state, parent,
     region scale, bounds, footprint WKB, and real-scale settings as `jsonb`, since authoring
     choices are open-ended;
   - `spaces`, `layers` (source columns, attribution, catalog path, presets, examples,
     geometries, default style as `jsonb`), `bands`, `categories`, `feature_types` and
     `layer_properties`.

   A feature row holds typed id, space, layer, type, kind, name, entity and map-only
   columns, plus geometry and footprint WKB, causes, open `attributes` and the registry's
   derived `catalog` values as `jsonb` (their columns vary by layer). Relations are rows.
2. PostGIS: `uuid` keys; the tables above; geometry arrives as WKB that `NativeMapGeometry`
   has already validated and reduced, inserted with `ST_GeomFromWKB` under the existing
   validity check. `map.canonical_geometry` and GeoJSON reads go. Adding layers inserts
   layer rows only; finishing updates the revision row; an edit replaces the revision's
   settings and feature-type counts.
3. SQLite: the same shape, with 16-byte blob ids and rtree bounds.
4. Readers assemble the descriptor from rows. Feature, registry, settlement, inventory,
   library and copy queries join `feature_types` and `relations` instead of descending into
   the descriptor document.
5. atlas-gis authoring, protocol, navigation and map files take `Id`.

Evidence: a unit test of descriptor rows round-tripping; the PostGIS publication test in
`tests/map_contract.rs` against the local atlas database; source review of both stores.

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
