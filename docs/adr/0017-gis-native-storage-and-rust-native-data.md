# 0017 — GIS-native storage and Rust-native data

The owner's 2026-11-19 direction: numbers stay numbers and are not converted to text and
back; strings and JSON are avoided wherever a schema exists; maps are stored as GIS
layers, not as JSON documents of layers. These were artefacts of the original TypeScript
implementation. Strings remain for text a person reads, and JSON for entities that do not
warrant a schema.

## Identities

Maps, revisions, worlds, areas, spaces, features, entities and operations are 128-bit
`atlas_map::Id` values. PostGIS stores them as `uuid`, SQLite as 16-byte blobs; byte order
matches numeric order. Semantic identities are UUID v5 of a fixed-width key in the world's
namespace (`atlas_generation::identity`), never of a formatted string. Text appears at the
presentation edge, where an `Id` serializes as UUID text. Layer, kind and type ids,
numerical resource and field keys, POI place keys and river lineage keys stay text keys.

Identities carry no order. Anything read in an order (history entries, record scans)
stores that order explicitly.

## Map storage

A published map is rows in both stores (`atlas-gis/src/rows.rs` shared by
`postgres_maps` and `map_store`): the revision, its spaces, layers, bands, categories,
feature types and declared layer properties. Raster groups add layer rows; nothing
rewrites a map document. Closed enums are integer codes.

Features are typed columns with WKB geometry that Rust has already validated at the map's
precision, plus relation rows and two open values: undeclared attributes and the
registry's derived values. Registry column labels are rows of the map, written once per
layer. A building's or plot's street is its `fronts` or `accessFrom` relation. PostGIS
receives features, samples, relations and retained records by binary `COPY`.

Every published channel is a raster layer with a `value` band; channels the viewer does not
draw are attribute layers over the same GeoTIFF assets. Inspection, a building's outside
magic and cave walls read band values from those rasters through a point reader that
decodes only the tile under a position (`atlas-gis/src/raster_values.rs`). Samples are
typed columns (window, span, centre, measure, activity) with their description sections as
one open value; they hold no band values. Rasters hold 32-bit floats, so a value read from
them carries that precision.

## Generation records and capture

The generator's working records stay in SQLite as the durable copy that checkpoints,
recovery and child capture copy and reopen. Each table is held decoded in memory with the
indexes the generator selects by (area, layer, kind; reach feature and end nodes), and rows
are written through as CBOR. Reads clone a value and never decode a row. Retained inputs
store CBOR records with integer kinds.

Parent-to-child capture handles numerical resource descriptors as the typed
`Descriptor`, clips features in batches against the child's footprint, and identifies
placed magic sources by id. Descriptors carry no summaries nobody reads.

## Generation service

Generation calls reply with typed values; presentation and review stay open documents. An
epoch's preview is written as CBOR to the job's directory, which keeps the newest few; the
observation event names the epoch and a separate call returns the bytes. The job's event
list therefore does not grow with a town's size. The browser worker's previews travel with
their events, as they never cross a network.

## Towns

A town keeps its streets noded for access until a street's points or widths change. The
walking and occupied grounds are held across the town steps of one development and marked
with what each step added, over a walled terrain read again only when the field, drawn
water, fortifications or walls change. Economy sources are keyed by a typed, ordered
`SourceId`.

## Consequences

- Stores are not migrated. A database or saved browser catalogue from before this change
  is replaced, not read; saved browser inputs of the old shape are refused.
- The frontend reads the same shapes: identities as UUID text, inspection as cells and
  band values, previews decoded by the transport.
- Remaining numeric hot paths (coastal erosion's per-cell rock column reads, water
  evolution, fluvial erosion) are recorded in the [backlog](../backlog.md).
