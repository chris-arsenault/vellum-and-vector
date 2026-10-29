# Native GIS operations and published derivations

Planning contract, 2026-10-29. Sulion root: `2c11c2d4-6c67-4fcf-9c74-4c4a4414073f`.
Execution authorized 2026-10-29 ("execute all phases of the plan").

## Outcome and scope

Map use (pan, zoom, click, double-click, panel open, commit) answers from stored,
indexed products and native GEOS/SQLite operations. Work that depends only on
generated or published data runs once per input revision, either when the data is
written or on first use, and its result is stored in the catalog. No product is
recomputed on every pan, page or click. Hand-written
geometry is replaced by the GEOS or R-tree operation that already exists in the
stack.

Scope is the 18 findings of the 2026-10-29 audit (G1–G9, U1–U9 below). The audit's
"smaller items" (`terrainWater.ts` per-pixel water test, `presentationCatalog.ts`
attribute discovery, per-commit `count(*)`) are out of scope unless a milestone
removes them as a side effect.

Non-goals: no backend, server persistence, recovery machinery or new storage
service; everything stays in the browser catalog (SQLite in OPFS, GEOS WASM). No
change to generation science, to region semantics settled in `1cc1720`, or to
saved-map formats beyond what new stored products require.

## Requirements and corrections

| Source                      | Requirement                                                                                                                                                                                                           |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User, 2026-10-29            | Fix all 18 findings.                                                                                                                                                                                                  |
| User, 2026-10-29            | Use the GIS system's algorithms rather than custom ones.                                                                                                                                                              |
| User correction, 2026-10-29 | Lazy calculation and caching are fine as long as each product is calculated once: computing on the first pan and storing the result is valid; computing on every pan is not. Supersedes "compute at generation time". |
| User correction, 2026-10-29 | Do not measure performance with scratch builds, temporary ports or timing harnesses; a slowness report is the premise. Run things only for an actual hotspot trace.                                                   |
| User correction, 2026-10-29 | Regions are indexed polygons; a click queries the index. Never require or derive full coverage.                                                                                                                       |
| Repository rules            | Browser-only session, no backend (ADR 0003); main branch only; `make ci`, frontend vitest and Chromium `make test-browser` per milestone.                                                                             |

ADR 0003's lazy derivation of pieces and overviews already meets the
once-and-stored rule and stays. ADR 0003 gains one sentence when M4–M6 land:
derived read products are stored once per input revision and never recomputed
per read.

## Findings

Hand-written spatial algorithms (G):

| #   | Location                                                                                                              | Replacement                                                                                                                    | Runs               |
| --- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| G1  | `frontend/src/numericTiles.ts:65,125`, `rasterTiles.ts:71` per-pixel `intersectsCoordinate` and linear overlay `find` | Prepared GEOS tile-vs-footprint test (whole tile in/out), prepared point coverage only for edge tiles; overlay chosen per tile | every tile         |
| G2  | `frontend/src/mapInteractions.ts:161-184` double-click linear scan of regions/areas                                   | Catalog point query (R-tree + GEOS `covers`)                                                                                   | per double-click   |
| G3  | `packages/domain/src/regionGeometry.ts` `snapRegionCut` brute-force nearest segment                                   | `GEOSClipByRect` to the snap window + `GEOSNearestPoints`                                                                      | per drawn line     |
| G4  | `frontend/src/spatialAnalysis.ts:58,100` distance/intersects against everything                                       | Index candidates by expanded bounds, GEOS on candidates                                                                        | per analysis       |
| G5  | `packages/domain/src/networkTopology.ts:131,157,312` linear node scans, hand linear referencing                       | STRtree / R-tree lookups; `GEOSProjectNormalized`                                                                              | per network commit |
| G6  | `packages/application/src/nearestPosition.ts:41` nearest-segment scan                                                 | `GEOSNearestPoints`                                                                                                            | per route command  |
| G7  | `packages/generation/src/canonry/provinceTerritories.ts:27` sampled nearest-site areas                                | `GEOSVoronoiDiagram` (sites plus wrap copies), clip, `GEOSArea`                                                                | generation         |
| G8  | `packages/generation/src/societyPopulation.ts:59` linear nearest community (also ignores cylinder wrap)               | STRtree nearest with wrap copies                                                                                               | generation         |
| G9  | `packages/generation/src/societyNaming.ts:83,121` bounds filter over all communities                                  | STRtree query                                                                                                                  | generation         |

Use-time recomputation (U):

| #   | Location                                                                            | Recomputed                                                                          | Trigger                                                                   | Stored product                                                                                                               |
| --- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| U1  | `frontend/src/useScene.ts:72` → `geometryDerivations.ts:132,151`                    | clip, piece union, simplify of every large feature                                  | every pan (scene keyed on exact viewport)                                 | simplified feature tiles on a fixed grid per detail level, built on first request                                            |
| U2  | `displayFeatures.ts:51` → `ensurePieces`, `writeOverviews`; `whole()` session cache | whole-feature simplify per tolerance (pieces/overviews are already once-and-stored) | evicting memory cache; pieces prepared before the visibility test         | stored whole-feature simplification per tolerance; pieces prepared only for visible features                                 |
| U3  | `frontend/src/drawnGeography.ts:13`, `illustration.worker.ts:41-58`                 | border noding/smoothing, land−water, coast buffers, marks                           | every scene change in drawn mode                                          | drawn products per map area, built on first drawn view                                                                       |
| U4  | `registryCatalog.ts:114,348,370,73,315`                                             | whole-world registry rebuild; facets, columns, unindexed sort per request           | scope switch, writes, each page                                           | area-independent registry rows, facets, columns and sort keys built once, refreshed for affected rows                        |
| U5  | `featureCatalog.ts:220` `presentRows`                                               | composition (overlays, buffers, simplify)                                           | any commit (key includes world revision); region picks compose all layers | composed geometry per (feature, area) stored on first read, invalidated by affected records only; polygon-only region lookup |
| U6  | `fieldSummaries.ts:64,101` via `workspaceRasterSummary.ts:44`                       | category/range legends                                                              | every raster request                                                      | legend per (area, field, channel)                                                                                            |
| U7  | `featureCatalog.ts:187` `candidates`                                                | recursive spatial CTE per 128-row page                                              | every display page                                                        | one bounds row per feature covering its refinements and followers                                                            |
| U8  | `settlementCatalog.ts:16,108`                                                       | seven `json_each` scans, unindexed `OR json_extract`                                | per settlement click                                                      | community index                                                                                                              |
| U9  | `frontend/src/workspaceRasters.ts:59-71`                                            | decode all footprints, patch selection                                              | every raster request                                                      | raster references per area                                                                                                   |

## Decisions

Agent-derived (revisable within the outcome):

1. **Derive once, store in the catalog.** Each product is computed on first use (or
   at write time when that is simpler) and stored in SQLite, keyed by its inputs.
   An evicting in-memory cache does not count as "once": a product it can drop and
   recompute is stored instead. Writes only mark the products of affected records
   dirty, following the existing `registry_dirty` pattern; they do not derive.
   Publication and commit time do not grow.
2. **Invalidation by affected records, not world revision.** Stored products carry
   the record revision they were derived from; a commit marks only affected
   products dirty. A rename no longer invalidates geometry.
3. **Scene reads use a fixed tile grid.** Tiles are keyed `(area, level, x, y)`;
   the level follows the display tolerance's power of two, matching
   `quantizeWindow`. The scene query becomes the set of tiles covering the
   snapped window; the frontend keeps the `AtlasFeature[]` interface by joining
   tile fragments under feature identity (as seam fragments already are). A tile
   is built the first time it is requested and stored; levels below the area's
   deepest useful level overzoom. Switching rendering to OpenLayers `VectorTile` is not
   needed for the outcome and stays out unless the join proves to be the cost.
4. **Native index primitives first.** M0 adds the GEOS operations listed above to
   `GeometryKernel`/`GeosSpatial`/`SpatialOperations`, so domain, application and
   generation code calls them through the existing `spatial` adapter.

Assumptions (checked in the named milestone):

- GEOS `STRtree` callbacks are callable from the WASM module via function pointers
  (M0). If not, generation and domain lookups use an in-memory SQLite R-tree.
- Stored tile and composition products fit browser storage, since only viewed
  tiles and read features are stored (M4/M6). Check with the catalog size of the
  shared world fixture after a scripted set of views, not a timing run.
- `GEOSCoverageSimplifyVW` is not needed for U3; drawn borders keep their
  smoothing, computed once per area (M7).

No user-owned decision blocks M0–M4.

## Milestones

**M0 — Native operations in the spatial adapter.** Add clip-by-rect, nearest points,
project/interpolate normalized, Voronoi, and an STRtree wrapper to
`GeometryKernel`, `GeosSpatial` and `SpatialOperations`. Acceptance: domain-level
unit tests exercise each through `spatial`. Evidence: `make ci`.

**M1 — Use-time GIS fixes in the editor** (G1, G2, G4) [depends on M0].
Tiles test the footprint once per tile; double-click enters a region or area via a
catalog point query; spatial analysis reads index candidates. Acceptance: no
per-pixel unprepared polygon test and no linear feature/region scan remains on
these paths; behaviour unchanged (existing tile, navigation and analysis tests,
new tests for edge tiles and nested double-click). Evidence: `make ci`, frontend
vitest, Chromium suite.

**M2 — Authoring snaps and network topology** (G3, G5, G6) [depends on M0].
Acceptance: snapping, route attachment, node identity and reach fraction return
the same results via GEOS/STRtree (existing tests plus wrap/edge cases).

**M3 — Generation spatial lookups** (G7, G8, G9) [depends on M0].
Acceptance: province areas from Voronoi cells, nearest community through STRtree
with cylinder wrap, naming influence through STRtree. G8's wrap fix may change
generated communities; generation fixtures are updated and the change noted.
Evidence: generation unit tests and the canonry fixture checks, not a full-world
run unless a fixture shows a difference.

**M4 — Stored composition** (U5, U7) [depends on M0].
Composed geometry per (feature, area) is stored on first read and marked dirty only
when an affected record changes. A bounds row covering each feature's refinements
and followers is maintained with the records, so `candidates` drops the recursive
CTE. Region picks query polygon features only. Acceptance: a second read of a
feature performs no composition overlay, including after an unrelated commit (test
via kernel call counting).

**M5 — Display simplification stored once** (U2) [depends on M4].
Pieces and overviews stay lazy and stored, but are prepared only for features that
pass the bounds visibility test. The `whole()` per-tolerance simplification moves
from the evicting memory cache to a stored product. Acceptance: repeated reads of
the same feature and tolerance perform no simplify.

**M6 — Tiled scene reads** (U1) [depends on M5].
Scene query keyed on snapped tiles; each tile is built on first request and
stored. Panning inside loaded tiles issues no catalog read; returning to a viewed
tile reads the stored tile. Acceptance: tile fragments rejoin to the same features
as today's window reads (fixture comparison); a pan within a tile does not change
the query key; a second request for a tile performs no clip or simplify.

**M7 — Drawn-mode products** (U3) [depends on M6].
Smoothed borders, land−water polygons, coast echoes and terrain/field marks are
built per map area on first drawn view and stored; the illustration worker only
assembles. Acceptance: a drawn-mode pan after the first performs no noding, union
or buffer.

**M8 — Registry built once** (U4) [depends on M4].
Registry rows area-independent with area lineage columns, built on first open and
refreshed only for affected rows; facets, columns and sort keys stored and indexed.
Acceptance: switching scope or paging performs no re-presentation.

**M9 — Field legends and raster references** (U6, U9).
Legends per (area, field, channel) and raster references per area stored on first
request. Acceptance: a repeated raster request performs no footprint overlay or
editor-world decode.

**M10 — Community index** (U8).
Community → society record, related features and polities indexed once (on first
settlement read or with the society record). Acceptance: opening a settlement runs
indexed lookups only.

Each milestone closes with `make ci`, `cd frontend && pnpm exec vitest run`, and the
Chromium browser suite (one worker), then commit and push on main.

## Sulion mapping

Root plan `2c11c2d4-6c67-4fcf-9c74-4c4a4414073f`. Milestones M0–M10 are phases 1–11
in order.

## Current state

All milestones implemented. Revisions to agent-derived mechanisms:

- G4: analysis snapshots are already bounded by the R-tree (`readAuthoring` with
  spatial layers or intersecting areas); no change.
- M6: the scene reads one window snapped like the raster window instead of a joined
  grid of tile fragments; fragments clipped at tile edges either overlap (doubled
  fills) or show seams. Clipped products are stored per (geometry, tolerance, window).
- M7: the drawn sheet reads its subject instead of the viewport, and the illustration
  worker stores its products per subject and scale in the catalog.
- Catalogs saved before geometry ids became AUTOINCREMENT keep removed composed
  geometry rows, since prepared geometry is cached by id.
