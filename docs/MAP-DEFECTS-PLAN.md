# Map defects from the 2026-11-16 owner review — working plan

Working copy for Sulion plan `5c9c7528-0352-4486-ad6c-dd75d60f12bd`. The owner
reviewed world and refined-region maps and reported the defects below. This file
records each defect's code-proven cause, what remains unverified and the remedy, so
implementation covers every item rather than the most recent. Implementation waits
for the owner's go-ahead and does not interrupt the running performance work. When
the plan closes, durable mechanisms move to the generation guide, an ADR or the
backlog, and this file is deleted.

Each section separates **Read** (seen in code, with location), **Inferred** and
**Unverified**. Line numbers are as of 2026-11-16.

## Shared causes and order

- Sections 4 and 5 share the town definition: road traffic is computed from the
  same population-minus-support figure that puts towns on mountains. Fix 4 first.
- Sections 1, 3 and 5 all touch way routing and drawing in `field/people/ways.rs`,
  `travel.rs` and `place_country.rs`; do them as one pass over that code.
- Section 7's blocky edge comes from section 6's raster density; its colour and
  contour fixes are independent.
- Section 2 is frontend plus one read-only host call, independent of the rest.
- Section 6 touches publication, which the running performance work measures;
  schedule it after that work lands.

## 1. Refined-region roads, settlements and POIs outside the map bounds

Screenshot: named settlements and wiggly roads in the empty area beyond the child
map's edge.

**Read**

- The child footprint is the selection's bounding box plus 10% per side
  (`crates/atlas-host/src/regional_capture/footprint.rs:43-58`). The child lattice
  extends 4 cells beyond it (`atlas/workspace.rs:135-139`); those cells are `Halo`
  (`lattice/triangular.rs:166-177`) but `area()` still counts them.
- Parent people layers (population, built-up, ruins) are copied into every cell,
  halo included (`field/inheritance/mod.rs:188-191`, `inheritance/people.rs:12-31`).
- Movement is limited to `habitable` cells, which must be `Content`
  (`field/people/work.rs:23-26`), so halo people never move and keep parent density.
- Town detection (`field/people/classifier.rs:80-84`) and ruin detection (121-131)
  test only population; neither calls `habitable`. A town found in the halo becomes a
  place at the halo cell's position (`places.rs:198`, `place_land.rs:106-110`).
- Travel cost (`field/people/travel.rs` `Travel::step`) has no inside/outside test,
  so routes between places cross halo cells and the road follows them.
- Nothing clips on publication: the regional publisher only wraps the world seam
  (`features/publication.rs:55-57`); the presentation clip runs only for areas that
  do not own their geography (`features/composition/presentation.rs:23`), and a
  refined child owns it.
- Parent landmarks and magic sources are captured whole when their extent touches the
  footprint (`regional_capture/context.rs:70-80,97-111`) and published at their own
  point, which may be outside.
- For comparison: rivers are clipped to `scope.footprint`
  (`atlas/state/rivers/drawing.rs:30-80`); copied parent features are clipped to the
  rectangle (`regional_capture/records.rs:24-33`); catalogue POIs only use `Content`
  cells (`field/poi/places.rs:25,99`).

**Unverified**

- That halo cells actually receive non-zero population from parent sampling (the
  captured fields are clipped to the footprint, `regional_capture/fields.rs:153-158`).
- The halo explains records within about 4 cells of the edge. Records farther out
  would need a second cause.
- `settle_seats` writes working-frame coordinates without seam wrapping
  (`field/refinement/seat_features.rs:88-93`) for regions crossing the world seam.

**Owner direction (2026-11-16):** a refined map has no outside. Nothing exists,
travels or is published beyond its bounds.

**Remedy: the outside is not addressable (owner 2026-11-16)**

Handled only in the numerical lattice and map representation, nowhere else. No
checks in processes, detectors, travel, capture or publishers.

Today the strip is ordinary addressable cells told apart by a mask
(`lattice/triangular.rs`, `Membership`): `len()` counts them, `neighbor()`,
`cell_at()`, `address_cell()` and `window_cells()` return them, and bands store them.
The code compensates with 74 `membership()` checks in 59 files, while 488
`0..mesh.len()` loops visit every cell. Any process that forgets a check leaks past
the edge; towns and roads are the visible cases.

- `TriangularLattice` addresses map cells only. `len()` is the map cell count,
  cell indices run over map cells, `neighbor()` across the map edge returns `None`
  (the existing edge case), and `cell_at()`, `address_cell()` and `window_cells()`
  never return an outside cell. Bands hold map cells only.
- Boundary support becomes a separate structure owned by the lattice: the outside
  ring's geometry, its adjacency to edge map cells and its read-only boundary values
  (captured from the parent, or world padding). Only numerical kernels that need an
  edge condition read it, through an explicit API; nothing else can name an outside
  cell.
- Outside records then have nowhere to exist: a place, landmark or magic source whose
  point lies outside has no cell, so it is not in the child. Routes cannot step out
  because no neighbour exists there.
- NoData cells (closed poles) get the same treatment.
- The 74 scattered `membership()` checks become unnecessary and are removed.

**Inventory (read, 2026-11-16).** The outside cells take part in the simulation
today:

- They are ordinary unknowns in smoothing and multigrid (`metric/operator.rs`).
- Water outlets are `boundary(cell)`, which is the outer halo ring, not the map edge.
- Rain on halo cells adds to rivers inside the map (`water/year_routing.rs:136-141`).
- Crust moves through them (`transport/overlap.rs`, `transport/plan.rs`).
- The `Sampler` catches probes just past the edge on them.
- Inheritance writes them.

Only three functions select outside cells on purpose: `refinement/topology.rs`
`frame_edge`, `refinement/network.rs` `descends` and `refinement/basins.rs`
`connected_sea`. About 60 `membership()` checks exist only to skip them. `NoData`
never occurs in practice, and `block_live`/`block_count` have no callers.

**Design**

- `TriangularLattice` keeps its site arithmetic private and exposes a dense
  content-only numbering through a two-way table (cell → site, site → cell or none),
  numbered in site order. `len()` is the map cell count; `neighbor()` returns `None`
  across the map edge; `cell_at`, `address_cell` and `window_cells` return map cells
  only; `area()` and `content_area()` merge; `Membership` leaves the public API.
- `BoundarySupport` is owned by the lattice: one entry per edge crossing (map cell,
  edge, ghost position, lengths, slot), with read-only ghost values per channel by
  slot. On regions, inheritance fills ghosts from the parent; on worlds the stated
  rule is clamp-to-edge (the edge cell's own value).
- Consumers:
  - Water outlets, ocean seeds, metric smoothing and gradients already treat a missing
    neighbour as an edge; they move onto the map edge unchanged. Regional inflow
    already arrives through `BoundaryRivers`; halo rain is dropped.
  - `descends` and `connected_sea` read ghost values.
  - The `Sampler` clamps to the edge.
  - Crust entering from outside is the edge cell's column (zero-gradient inflow);
    crust leaving is carried out as now.
- Old checkpoints hold lattice-length bands and will not load. That follows the
  owner direction of 2026-11-15, "old data either works in the current format or
  does not load; no migrations".

**Order:** failing guard test (`len() == content count`, no neighbour off the map,
`cell_at` outside is `None`) → dense numbering and `BoundarySupport` → port the
three deliberate readers, `Sampler` and transport inflow → remove the skip-only
checks → update ADR 0003's live-block claim and the generation guide.

**Done.**

- `lattice/triangular.rs` numbers map cells only, through a two-way site table.
- `lattice/boundary.rs` holds `BoundarySupport`: crossings point at ghost sites
  covering the frame padding, each ghost owned by its nearest edge cell; ghost
  elevation is captured from the parent on regions and clamped on worlds.
- Ported: `descends`, `connected_sea`, the `Sampler`, climate wrap, inheritance and
  crust transport. Crust arriving across the edge is booked as inflow
  (`TransportShares::inflow`, crust budget `*_imported`, ground flow Sea → Load), not
  as the edge cell's retained ground.
- 79 `membership()` lines removed; `refinement/courses.rs` no longer clamps outside
  points onto the edge.

**Open:** `cell_at` maps points inside the bounds but past the outermost centroids
onto the nearest map cell within two spacings. Region footprints are rectangles, so
this matters only for non-rectangular charts. Edge effects (outlets, inflow crust,
zero-flux smoothing on the map edge) are unseen on a generated map.

## 2. Refinement creates the child map before generation

Owner requirement: refining a region first creates the child map and drops the
user into it, then offers the refinement controls, so the user sees what will be
refined. This was the earlier behaviour.

**Old flow (read, `6c45f11` and `e372683`, 2026-10-26/28)**

`refineSelectedRegion` (`archive/typescript/frontend/src/useRegions.ts:113-131`)
created the child area from the same rectangle plus 10%, switched the view to it and
opened `RegionalGeneration` beside the child map; Generate ran on that existing child.
Refining an already refined region opened its child.

**Current flow (read)**

- `e59323a` (Rust migration, 2026-11-14) replaced this with a generation wizard
  carrying only a `RegionSelection`; `d0c7579` (2026-11-15) turned it into a modal
  over the parent map (`frontend/src/App.tsx:219,289-309`).
- "Refine this region" (`PublishedRegionsPanel.tsx:49`) builds the selection; the
  size shown is the selection's bounding box, not the real footprint, which is 1.2×
  wider and taller (`App.tsx:161-169`).
- The child area is created only inside the job's capture step
  (`crates/atlas-host/src/regional_capture.rs:106-188`), which rejects an existing
  child id. The child map record is built at publication
  (`publication/descriptor.rs:22-70`); the app opens the child on its first publish.

**Owner direction (2026-11-16):** create the real child map, open it, and show the
refinement modal over it. Not a preview substitute.

**Design (read, no new job type or facade method)**

- "Refine this region" runs the existing Refine job, which stops after its capture
  step. It stores and publishes the captured document as the child map: the parent's
  geography clipped to the true footprint, at the parent's sample density. A
  `creates_child` flag on the prepared job (`browser_job.rs`,
  `native_generation_job.rs`) skips generation. Publish reads the starting records
  that capture wrote.
- The app opens the child on publish, attaches it to the region and shows the
  `RegionalGeneration` modal over it. Generate runs the existing Regenerate action on
  the child: its configuration comes from the parent's last run and the child's real
  bounds, which also fixes the wrong size the modal showed.
- Refine on a region that already has a child opens that child with the same modal.
- `AttachChild` (`atlas-map regions/state.rs`) accepts a newer revision of the same
  child, so the region follows the refined revision.
- The owner direction of 2026-10-24 that initial generation streams its output
  stays. A child whose only revision is its capture has not been generated, so its
  first refinement publishes progressively, as a new region did before, replacing the
  capture revision. Later regenerations stay atomic.
- Marks: keep the 2026-11-15 modal direction; add the 2026-11-16 direction ("when
  refining a region, create the child map first, drop the user into it, then offer the
  refinement controls"); update `frontend/tests/regionalGeneration.test.ts`.

**Done** as designed. Additional points:

- Map stores accept a streamed revision over an existing head; the host's
  `finished_map::progressive` decides (a new map, or the first generated run of a
  map). Restarting an interrupted stream restores the head it replaced, in both
  stores.
- Regenerate on a refined child opens the refinement modal over it
  (`App.tsx` `childSelection`), so Generate also re-attaches the parent's region.

**Open:**

- The Playwright test (`frontend/tests/regionalGeneration.test.ts`) and the
  first publish of an all-inherited child are unverified until CI builds the browser
  engine (no Emscripten locally). The PostGIS restart path is untested locally.
- A region whose stored child points at an older revision, from before this change,
  opens that revision.
- The cancel-and-reopen check left the browser test; closing the modal leaves the
  user on the child, and Regenerate reopens it.

## 3. Regular wiggle on roads and some rivers

Screenshots: roads drawn as a constant-wavelength sine wave, the same on open flat
land as anywhere else; some rivers show it too.

**Read**

- Roads are shortest paths over the triangle mesh (`metric/search.rs:25`, three
  neighbours per cell); a route is its cell list. `field/people/ways.rs` `drawn()`
  joins cell centres and smooths them with `course()` (`ways.rs:29-46`): two passes
  of quarter-point corner cutting.
- On a regular triangle mesh, consecutive triangles alternate orientation, so their
  centres lie on two offset rows. Any route zigzags with one cell's period and a fixed
  amplitude. Corner cutting turns the zigzag into a smooth sine wave; it does not
  remove it. The frontend only styles the published line.
- `course()` was ported from the archived TypeScript (`landWays.ts`, bdade3f), which
  already ran on the triangle mesh; the Rust migration carried the defect over.
- Rivers (`field/river_drawing/paths.rs`) get three relaxation passes (`paths.rs:82`)
  that average neighbours along the course, which cancels the zigzag. Relaxation skips
  cells next to sea or lake, water cells and headwater first cells
  (`paths.rs:115-124`), so those stretches keep the zigzag.

**Unverified**

- Which rivers in the owner's maps wiggle. Candidates: the skipped coastal, lake and
  headwater stretches above, and the meander model (`river_drawing/floodplain.rs`,
  `meanders.rs`), which sets one bend length per stretch from peak discharge and could
  give a repeated bend size.

**Remedy**

- Done: `ways.rs` `straightened()` applies a [1, 2, 1]/4 average to the cell-centre
  chain before corner cutting, which cancels the two-cell zigzag exactly.
- Rivers: the zigzag rivers in the owner's screenshots run on land cells covered by
  spurious ice lakes (section 7), fixed there. Still open: `relax` keeps land cells
  next to water and headwater first cells unrelaxed, so short stretches at mouths
  and sources can zigzag; check the meander bend length on a real map after the
  lake fix.

## 4. Settlement clusters on mountain tops

Screenshot: about ten closely spaced towns on a high massif near the summit, joined
by a straight road down the ridge, with few towns in the lowland around it.

**Read**

- Town definition: `field/people/classifier.rs:79` sets a cell's town people to
  population minus the cell's own land support, floored at zero. A cell joins a town
  zone when that exceeds 5% of its people. On a mountain, support is near zero, so
  nearly every resident counts as a townsperson. In fed lowland, population is close
  to support, so almost nobody counts. The definition ranks poor ground above good.
- Imports raise room to grow (`field/people/land.rs:103`: support + imports), but the
  classifier subtracts only local support. Imported food therefore turns into "town".
- Terrain terms: slope enters only crop yield (`field/people/yields.rs:101`). Herd and
  wild yield have no slope or cold term. Elevation is never read directly. Slope is a
  difference between neighbouring cells, so the same massif is gentler on the world
  lattice than on a region (inferred from `field/geography.rs:92-99`).
- Regions: each parent cell's headcount is re-shared only inside that cell's child
  footprint, weighted by support (`field/refinement/people.rs:41-91`). Region passes
  use `Facts::kept` with `grows: false` (`field/people/facts.rs:38-43`), and `grow`
  returns before starvation (`field/people/land.rs:91`). People a parent mountain cell
  held at world-scale slope stay on the steeper child relief and never thin out.
- Town threshold on regions: `least_town` = max(40, world threshold × (child/parent
  span)²) (`field/refinement/people.rs:197-199`). It scales with cell area. Zones are
  population peaks found by climbing to the highest of three lattice neighbours, so
  one mountain population breaks into many small peaks that each pass the threshold.
  No other spacing mechanism exists.
- Only parent-named seats get a terrain check on regions (`field/refinement/seats.rs`
  `usable_seat`, slope ≤ 0.12 and ≥ −5 °C). Towns found on the region itself get none.

**Inferred, unverified**

- The straight ridge road may come from Fire's hearth-keeping craft, which sets
  `climbing` to 0 (`field/people/crafts.rs:163-164`) and so removes the rise cost and
  grade limit (`field/people/travel.rs:130-137`). Whether that craft is practised on
  this massif is unchecked.
- Saved-world check (one question): for the cluster towns and some lowland towns,
  compare `settlementPopulation` with `communityPopulation`, `farmedKm2` and
  `grazedKm2`. Cluster towns with settlement ≈ community and almost no farmed or
  grazed land, against lowland towns with settlement far below community, confirm
  the inverted definition and the held regional headcount.

**Remedy (done)**

- Towns are people above the travel-reach average density around them
  (`era_places.rs` `surrounding_density`, `classifier.rs` `dense_zones`). Cells climb
  to their people peak; peaks under one rise of that background form one town,
  anchored on its densest cell.
- Herd yield falls with slope (`yields.rs`); cold already enters through `season`.
  Wild yield is unchanged: gathering, game and fish have no clear slope dependence.
- Owner direction 2026-11-16: the only parent→child obligation is that major
  landmarks appear and roughly agree. Regional passes therefore run as ordinary
  settled passes (`Facts::settled`): people grow, starve and move; no total is kept.

**Open:** slope is a one-cell gradient, so all slope-based yields read gentler on
coarser lattices. This affects every slope consumer and is not specific to towns.

## 5. Roads are disconnected fragments, not a network

Screenshot (world map): short road pieces near settlements, many towns without a
road, few chains between towns, a few long straight lines.

**Read**

- `field/people/country.rs:153-199` grows a travel-cost territory around each living
  place (out to 4× travel range, `place_country.rs:107`) and makes one way per pair of
  touching territories. Publication does not split, clip or filter the lines further.
- `place_country.rs` `kept()` (67-87) drops way A–B whenever a third place C is
  cheaper from both A and B, usually a small place between them.
- Traffic is counted per pair, not per journey: travellers = 0.5 × the smaller
  `town_people` × a cost falloff (`place_country.rs:116-117`). A→B through-traffic is
  never added to the A–C and C–B legs that replaced it.
- `kind()` (32-42): below 0.25 × `road_traffic` (default 1000,
  `atlas/parameters.rs:57`) a way is a `Path`, which is not drawn (`ways.rs:246`).
- `reachable()` (43-66): a place with no visible way gets only its single cheapest way
  promoted to `Track`. The result is spurs to nearest neighbours rather than chains.
- Regions: the town threshold shrinks to as low as 40 people (`least_town`), but
  `road_traffic` stays 1000 (`field/refinement/people.rs:246`,
  `atlas/application/region.rs:59`). Regional towns rarely produce 250 travellers, so
  nearly every regional way is a hidden path.
- Shared cause with section 4: traffic uses `town_people`, the inverted
  population-minus-support figure. Fed lowland towns have small `town_people`, so
  their ways carry few travellers and disappear.

**Inferred, unverified**

- River cells cost 0.5 and river-to-river steps skip climbing (`travel.rs:51-54,130`),
  so land ways follow rivers. Those stretches may be hidden under river lines,
  leaving only the pieces near towns visible. Layer order not checked.
- Sea cells also cost 0.5, so coastal pairs become straight sea lanes, possibly the
  "few long straight lines".
- Whether adopted parent places resolve as published endpoints on regions
  (`ways.rs:233-247` keeps a way only when both ends are published).

**Remedy (done)**

- `place_country.rs` `journeys`: every pair of places within reach sends travellers
  along its cheapest route through the way network; each leg carries the sum. A
  direct way no cheapest route uses carries no one and is dropped, except that each
  place keeps its cheapest way so `reachable` can still show it as a track.
- The regional road threshold scales with the regional town threshold
  (`refinement/people.rs`).
- Town definition fixed first (section 4); traffic reads it.
- Land ways may keep riding river cells: valley roads follow rivers, and the cheap
  river cost models towpaths and boats. Not changed.

## 6. Surface base map renders as blurry squares

World and regional maps; much worse than before the Rust migration. One screenshot
also shows a horizontal seam of blocky artifacts.

**Read**

- Class channels are captured from the nearest lattice cell
  (`field/projection/sampling.rs:78-84`) on a raster at lattice cell span
  (`atlas/initial.rs:49-53`).
- Publication fixes the map raster at 2 display pixels per sample
  (`publication/sampling/mod.rs:33-35`, from `e59323a`, 2026-11-14). Class sampling
  (`reconstruction/classes.rs:140-208`) picks a weighted majority of the four
  surrounding samples; pixel centres at 0.25 and 0.75 make each sample a 2×2 square.
  Class colours are baked into bands at that density (`publication/sampling/tile.rs`).
- The frontend loads that single GeoTIFF with `interpolate: true` for terrain
  (`frontend/src/publishedRaster.ts:37-45`), so zooming magnifies 2×2 squares and
  blurs their edges.
- Before the migration (`7f48a4d` and earlier, now
  `archive/typescript/frontend/src/numericTiles.ts:195-227`), a worker built
  256-pixel tiles at screen resolution for every zoom; class came from smooth class
  reconstruction per screen pixel, and the shader chose colour from the class code.
  The source had a 1-pixel gutter.
- Regional cells were earlier cut from 262,144 to 65,536 for render speed
  (`ea1eabd9` phase 6), which doubles the sample size on regions.
- The other session's uncommitted changes to `publication/samples.rs` and
  `publication/fields/metadata.rs` only batch GEOS calls and do not touch this.

**Unverified**

- The horizontal seam. Candidate: OpenLayers' GeoTIFF source has no gutter, so
  linear sampling at 256-pixel TIFF tile edges could seam; that would usually show on
  both axes. Needs a look at a real map with `interpolate: false`.

**Correction (owner 2026-11-16):** the squares are a lack of interpolation, not
pixel density. Read: rectangular maps capture fields on a regular sample raster
(`Layout::Raster`, `atlas/initial.rs`). On that layout:

- Continuous fields were bilinear (`reconstruction/mod.rs` `sample_mapped`). Bilinear
  height has a constant slope inside each sample square, so hillshade drawn from it
  came out one flat shade per sample.
- Classes took the single winner of the four corner samples
  (`reconstruction/classes.rs` `raster`), so each sample was one flat colour.

The adaptive layout already reconstructs with smooth Hermite patches, including
per-class membership patches; the raster layout had no equivalent.

**Remedy (done):** `reconstruction/cubic.rs` adds a Catmull-Rom 4×4 window. Raster
continuous fields use it, clamped to the four surrounding samples so it adds no peaks
or pits. Raster classes take the strongest cubic membership, so boundaries curve
between samples. Publication density is unchanged.

**Open:** the horizontal seam is unverified on a real map.

## 7. Ice fields hide everything on the topo map

Screenshot: pale-blue ice fills over land, blocky at the edges, hiding contours and
terrain. "Still" refers to earlier attempts.

**Read**

- The topo base map draws only the terrain layer (`frontend/src/PublishedMapLayers.ts:75`).
  Ice is one band, `min(IceThickness_m / 1000, 1)` (`publication/sampling/tile.rs:113`).
- `terrainStyle` scales it by 1.5, clamps it and blends the land colour fully to
  `#e2ede8` (`frontend/src/rasterStyles.ts:129-136`). From about 667 m of ice
  upward, the elevation colour is entirely replaced.
- Contours draw only where the water band is below 0.5
  (`frontend/src/terrainContours.ts:68-73`), so ice classed as water (sea ice, ice
  shelf) gets no contours.
- Earlier fixes: `d3c9e32` (2026-10-24) removed ice from brightness and drew contours
  over ice, but kept the full colour replacement from `976f81d`. `5ad6111` changed
  sea-ice surface classification only and does not touch the topo ice band.

**Inferred**

- The brightness term `0.55·light − 0.4` on near-white `#e2ede8` clips sunlit slopes
  to white, so relief shows only on shadowed slopes.
- The blocky edge comes from the same 2-pixel-per-sample raster as section 6,
  sharpened by the ×1.5 clamp. How much is the ice field's own lattice-scale shape is
  unverified.

**Correction from execution (read):** the screenshot's ice areas are drawn in the
lake colour (`#a1c8ce`, water band 2), not the land-ice colour. They are lakes:

- Lake detection fills hollows in the rock bed (`field/water/drainage.rs:55-97`,
  `water/lakes.rs:44-58`, `water/lake_stage.rs:127-198`) and never reads ice; the
  `lake-basins` step declares no ice input (`atlas/native/definitions.rs`).
- Glacial erosion may cut to the water level minus 0.9 × ice thickness
  (`field/glaciers/surface.rs:72-87`, `processes/ice.rs:67-77`), so thick ice carves
  closed basins that the lake step then floods. Lake cells keep a thin spread ice
  cover (`field/glaciers/growth.rs`), which is the mottle.
- The ice code already treats ice on a lake bed as grounded when 0.9 × ice is at
  least the water depth (`Surface::grounded`, `surface.rs:54-63`); the water column
  ignores it.
- Rivers are not drawn on water cells (`water/network.rs` `order_at`); the
  zigzag rivers inside these areas run on cells a lake polygon covers, so they
  inherit this defect.

**Remedy**

- Done: `terrainStyle` tints ice partially (half strength, full from 500 m) over the
  hypsometric colour; contours and hillshade stay visible on land ice.
- Done: water ponds only where ice would float. `StageInputs::held_by_ice` (the
  grounding fraction × ice thickness, the rule `Surface::grounded` states) raises the
  floor in the lake mask (`water/lakes.rs`) and in stage membership
  (`water/lake_stage.rs`); the `lake-basins` step declares its ice input.
- Lake outlines step along cells where the membership outline is tighter than the
  level contour (`field/geographic_contours.rs` `lake_footprint`); separate
  publication issue, recorded here.
