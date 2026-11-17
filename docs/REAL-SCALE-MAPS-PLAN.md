# Real-scale maps plan

Working copy of an open plan. The last milestone moves its durable content into the
product contract, an ADR and the backlog, then deletes this file.

## Outcome

A creator can open a real-scale hex map from a world or regional map: outdoor ground
(forest, glen, canyon, trail), underground (caves), a town or village, or a building's
floors. The land is generated at real scale, so each hex is one thing and places stand
at their true size. The creator then builds on it with ordinary GIS editing tools:
moving a river keeps it one intact line feature, cave walls drawn on the map pick up
the rock they cut, roads form a named street network with addresses, and buildings sit
on plots with art. Interiors are mostly drawn by hand, and they still show the outside
data, especially magic prevalence.

## User requirements (owner, 2026-11-16, this session)

1. Plan map types for outdoor forest, small outdoor areas (canyon, cave, forest path,
   glen), small indoor maps (houses, inns, taverns), medium indoor maps (castles),
   towns with layout types and street maps, and villages/suburbs (street maps plus
   outdoors). They work at the scales in the owner's table. There is no map type per
   band. Design from how a creator makes a map for a purpose.
2. These maps are real scale, not averages, and always hex. Some are a different map
   type entirely: walls, decor and other placed objects. Town planning and street maps
   are their own kind, with real street maps and addresses.
3. **Correction:** the only parent→child agreement is that major landmarks on the
   parent appear on the child and roughly agree. No numerical accuracy, elevation
   syncing or anything like that.
4. **Correction (same day):** no hex lattice. The hex is a representation on the map for
   resolution, built from a triangle sub-lattice, which is why the lattice is triangular.
   Real-scale maps keep the shared triangular lattice class.
5. Manual authoring is introduced now, for real-scale maps only.
6. Replace the previous real-scale resolutions with the hex-size ladder below.
7. Auto-generate the land for all of these. Offer authoring tools for building on top
   of it: moving rivers, and drawing cave walls in a way that uses existing geology for
   special features.
8. The town map starts as land with whatever society features are generated there. It
   offers tools for building road networks and placing buildings, eventually with real
   building art. OpenAI-generated art is acceptable for now.
9. Inside (interiors) is largely manual only, but still includes the outside data we
   have, especially magic prevalence.
10. Authoring switches the map from its numerical in-depth representation to a 2D one.
    Manually authored features are only 2D GIS representations. Editing is normal GIS
    editing, not painting: dragging a river keeps it intact as a feature line.
11. Later, a markup/paint layer: a static overlay with zero map interaction.

## Standing boundaries from repository direction

- World and regional authoring and undo stay deferred (AGENTS.md, 2026-10-28). The
  lift in requirement 5 covers real-scale maps only.
- Generation, naming, storage and application behaviour are Rust. TypeScript is UI,
  view code and the local/remote facade (2026-11-14). The archived TypeScript authoring
  code is a behaviour reference only and is not restored.
- Presentation and authoring read published GIS storage only and must work without
  private generation resources (ADR 0015).
- One shared Rust engine runs in browser and LAN backend; no hybrid mode.
- Tests are pure-function/data-structure units and UI interaction tests only. No fixture
  simulation outcome tests, no fresh worlds to check a change, no numerical replay.
- Owner directions are marked in code with `owner-direction(...)` plus an
  `ownerDirections.architecture.ts` entry, in the same change that acts on them.

## Design (agent proposals unless marked)

### Map kinds

| Kind            | Holds                                                                                                                                                                                                                                        | Hex ladder use |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Ground map      | Real-scale outdoor land: relief per hex, edges (cliff, bank, step), water as channels and pools with banks and fords, cover as stands then single trees, rocks, trails, places at true size. An underground space on a ground map is a cave. | 1.5 m to 300 m |
| Settlement plan | A layer family on a ground map: named street network with class and width, plots, building footprints with use, occupants and address, wards, squares, gates. A village, suburb, town and city are the same kind at different density.       | 3 m to 100 m   |
| Structure map   | A building's levels (cellar, floors, roof) with walls, doors, windows, stairs, furniture and decor as true-metre shapes over a hex play grid. A castle is a ground map whose buildings open as structure maps.                               | 1.5 m, 3 m     |

World and regional maps keep their averaged cells unchanged. Every kind runs on the
same triangular lattice class (`crates/atlas-generation/src/lattice/triangular.rs`).

### Hexes from triangles (requirements 4 and 6)

The lattice's triangle corners fall into three classes, and every triangle has one
corner of each. Taking one class as hex centres groups the six triangles around each
centre into a hexagon, and those hexagons tile the map with every triangle in exactly
one hex. Scaled up, a hexagon whose side is n triangle edges holds 6n² triangles and
still tiles the lattice. A real-scale map therefore has two linked resolutions: the hex,
which is the play and display unit, and the triangles inside it, which carry the
generated detail (a stream across one corner of a hex, a wall along part of it).

Hex sizes, across flats: 1.5 m (5 ft), 3 m (10 ft), 10 m (about 30 ft), 30 m (100 ft),
100 m (330 ft), 300 m (1,000 ft). The creator picks the hex size, and the generation
detail setting does not change it. Detail sets how many triangles each hex edge is split
into. The ladder replaces the Local, Site and Interior cell areas in
`crates/atlas-generation/src/atlas/resolution.rs`. World and Region keep their existing
resolutions.

Proposal: lay the real-scale lattice out as an exact subdivision of the parent's
triangles, so every child triangle sits inside one parent triangle when context is
captured. This is geometric alignment only, with no numerical matching.

### What a real-scale map can express (2D GIS representation)

This is the map's capacity, independent of who fills it. Generation writes some of it;
authoring can write all of it; display, inspection, export and editing handle every layer
the same way whatever its source. A layer existing here does not mean anything generates it.

Only the ground is tied to the lattice. Everything above it is a free GIS shape in metres,
placed and rotated independently of triangles and hexes. Bottom to top:

| Layer               | Shape                                                      | Examples                                                                                                                      |
| ------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Ground              | Triangle detail published as rasters                       | Relief, exposed rock, soil and cover tone, magic prevalence                                                                   |
| Water               | Centrelines with width at each vertex; outlines where wide | Brook widening into a pool and narrowing at a ford; pond; wide river banks                                                    |
| Plots and fields    | Outlines                                                   | Fields, gardens, yards, building plots (beneath ways, so a path through a field shows)                                        |
| Ways                | Centrelines with width at each vertex and a class          | Trail, track, road, street, alley; a road pinching at a gate                                                                  |
| Structures          | Outlines; walls as lines with thickness                    | Houses turned to their street, bridges, curtain walls, fences                                                                 |
| Objects and clutter | Outlines with rotation                                     | Single trees, boulders, fallen logs, rubble, scree, wreckage, magic debris (glassed shards, salt plates), furniture and decor |
| Hex grid and marks  | Derived from the layers above                              | Water, ford, road, wall, building, cover, difficult ground                                                                    |
| Labels and key      | Points and text                                            | Names, numbered key entries                                                                                                   |
| Markup (later)      | Static overlay, no map interaction                         | Hand annotations                                                                                                              |

Each hex takes its play marks from how much of each layer covers or crosses it, so the marks
follow the shapes: a dragged river or a moved log pile re-marks the hexes it now touches. The
view offers the detailed map under a hex grid, and a fill mode where each hex shows one
colour. The lattice's triangles stand on a vertical edge (checked in
`lattice/triangular.rs`: the across-edge neighbour shares a vertical face), so hexes come
out pointy-topped; flat-top would need the lattice laid at a quarter turn.

### What generation fills in

Generation produces the land and, on a town, the society features generated there. It
publishes the ground layer and the shapes it derives: water lines and outlines (reusing the
existing continuous river drawing and meander migration, which carries values along a line,
so width can vary), ways from their cheapest triangle path, and on settlements the plots,
buildings and streets. The triangles carry ground detail under those shapes (a channel cut,
a levelled plot). Objects and clutter, furniture, decor and walls inside buildings are
authored; generation does not place them. Whether generation later scatters clutter is a
deferred proposal, not part of this plan.

### Controls taken from Arconis (`../arconis`, reviewed 2026-11-16)

Arconis (MIT, React on maxGraph) supplies interaction patterns; its canvas code does not run on
OpenLayers, so the patterns are rebuilt here, porting small self-contained pieces where they fit.

- **Creator layers on top of the fixed kinds.** The kinds above keep their draw order. Creator
  layers are named collections a creator makes ("GM secrets", "Phase two of the castle",
  "Party's camp") with show/hide per viewer, lock against pointer edits, a chosen layer that new
  shapes go into, move selection to a layer, merge down and delete. Hiding is a view choice and
  locking is shared. A GM-only layer is how secret doors and traps get a player version. [M1
  model, M5 controls]
- **Markup above everything**, belonging to no layer, with its own short bar (pen, marker,
  arrow, box, erase), one count and one Clear. This is the later markup overlay (requirement 11);
  M9 records it in the backlog.
- **Scale and measurement**: a scale bar, a Measure tool for temporary distances, metres or
  feet as a viewer preference, geometry fields that take arithmetic and unit suffixes
  (`240 cm`, `*2`), and a grid that snaps at the hex size. [M1 display, M5 editing]
- **Placement and editing**: keep the tool in hand to place many of one thing; alignment and
  equal-gap guides while dragging; Alt-click steps down through stacked shapes; select same
  kind; copy and paste style; duplicate; lock single objects; rotate and scale handles on a
  selection. [M5]
- **Property panel** for the selection: position, angle and size first, then the kind's own
  attributes (a river's width along its line, a building's use and address), then appearance
  and named values. Controls that don't apply are left out. [M5]
- **Command palette** with one name, one shortcut and one rule per action, doubling as the
  shortcut sheet; **History** listing undo steps by what they did ("Move river Elder Brook").
  [M5]
- **Find and filter** by name, kind and tag with highlight and fly-to; **jump points** for
  places to return to; an **opening view**. [M5, useful earlier for big towns]
- **Context ring** on right-press (optional), with fixed compass positions per thing pressed.
  Proposal only, after M5 if the panel and palette prove too slow.

### Generated, then authored (requirement 10)

A real-scale map is first a generation state on its triangular lattice. Its published GIS
layers include a hex layer aggregated from the triangles (terrain, cover, floor fill per
hex), vector
features and the context rasters that tools read: rock, magic prevalence and water.
The first manual edit makes the published GIS layers the map's authority. Generation
no longer rewrites that map, and its numerical working state is not needed again.
Authored features are GIS features with identity, kind, attributes and relations.
Editing moves vertices and reshapes geometry under that identity. Snapped junctions
(a river and its bridge, a street and its side street) move together. Tools that need
context, such as cave walls reading rock, read the published context layers, not
private generation resources.

### Parent context (requirement 3)

The child captures parent context as starting conditions for its own generation:
relief, rock, water, cover, magic, people and places. Major landmarks (ADR 0006 kinds)
are the only obligation. Where a major landmark falls inside the child's frame, it
appears there and roughly agrees with the parent's. Nothing is conserved, fitted or
reconciled.

## Sub-plans and verification

Each milestone M0–M8 is its own Sulion sub-plan under the root. A sub-plan's steps are coarse;
each is expanded to files and changes at the sub-plan's start (plan-phase), after re-reading the
outcome, boundaries and this document. Sub-plans run one at a time in milestone order. The next
starts only after the previous one's review is resolved and its commit is made.

Every sub-plan ends with the same two steps:

1. **Independent review.** A fresh read-only subagent, not a fork, so its reading isn't
   anchored on the implementer's. Its brief: this milestone's section and the owner requirements
   above, verbatim; the commits and files the sub-plan changed; and nothing of the implementer's
   own conclusions. It returns MET, PARTLY or NOT MET for each acceptance item and each
   requirement the milestone touches, with file:line evidence. It judges by running behaviour:
   the UI tests the milestone added, and for generation milestones the real-scale maps produced
   from the saved world and its regions, looked at as maps. It never generates a new world and
   never accepts green tests alone. It also checks the standing boundaries: behaviour in Rust,
   presentation and tools reading published GIS only, world and region maps unchanged and
   read-only, owner-direction marks present, only unit and UI tests added. Blocking findings are
   fixed in the same sub-plan and the reviewer re-checks them. Accepted deviations are recorded
   under the milestone in this document.
2. **Commit.** Touched tests, lint and typecheck, then the whole frontend suite once. Local
   commit only; the plan pushes once, at the end.

M9 runs on the root: a final independent review of the whole outcome against the owner
requirements, the durable-documentation move, the routine suites once, and the single push.

## Milestones

### M0 — Real-scale contract and hex ladder

Scope: a new ADR for real-scale maps (kinds, hexes as a representation aggregated from
the shared triangular lattice, the landmark-only agreement, authoring on real scale only,
the 2D GIS switch, the ladder). Update AGENTS.md and the product contract where they state
the authoring deferral without the real-scale exception, and extend the lattice rule's
wording from "world or region" to every map. Replace the Local, Site and Interior
resolutions with the hex ladder and the triangles-per-hex-edge detail rule, and add
owner-direction marks and list entries. No architecture-check exception is needed. Remove the placeholder site and interior layouts in
`atlas/people/built.rs` ("The Wayfarer's Rest" grid and two-room interior) or leave them
explicitly retired for M1.
Acceptance: documents and code state one consistent rule; the ladder is the only real-scale
resolution source; architecture checks pass.
Evidence: lint, typecheck, `make test-architecture`, units for the ladder.

Result (2026-11-16): ADR 0016 written and indexed; AGENTS.md, CLAUDE.md, README, product
contract, generation guide and ADR 0003 carry the real-scale exceptions. `resolution.rs`
holds `HexSize`, `triangles_per_hex_edge` and `real_scale_span`; `cell_area_km2` and
`cell_span` refuse real-scale profiles. Two owner marks and list entries; unit test
`real_scale_hexes_are_built_from_triangles_whatever_the_detail`. Placeholder layouts removed
from `built.rs`. Independent review: all acceptance items MET after its document findings
were fixed; it confirmed the span formula and pointy-top orientation against the lattice.
Accepted deviation, left for M1, which owns the real-scale map record: the profile special
cases in `atlas/sequence/people.rs` ("site"/"interior"), the `structures` presentation entry
for site and interior, the Site/Interior exemption in `generation_configuration.rs`,
`generation_review.rs` refusing a real-scale frame, and the interior semantics in
`atlas/configuration/mod.rs` and `features/context.rs`. Environment: no cmake or emcc here;
Rust checks use `CARGO_TARGET_DIR=/home/sulion/repos/vellum-and-vector/target` (prebuilt
GEOS) and the TypeScript typecheck uses the main checkout's ignored engine build.

### M1 — Real-scale map creation and its 2D representation [depends on M0]

Scope: the shared triangular lattice at real-scale span, laid out so hex centres fall on
one corner class; hex membership of each triangle and the hex aggregation used for
publication; the real-scale map record (kind, hex size, detail, frame, parent, located
space); creation from a point or outline on a world, regional or real-scale map, with hex
size from the ladder and an extent sized to a few hundred hexes across; capture of parent
context; the landmark check; library and breadcrumb navigation. The full 2D layer model
above, independent of generation: every layer's shapes and attributes, lines with width
per vertex, rotated outlines, draw order, hex marks from shapes, rendering in OpenLayers
with the hex grid and fill view, inspection and export, feet/metre display.
Acceptance: a creator opens a ground map from a region and sees a hex grid in the right
place with captured context layers; explicit navigation back to the parent. A supplied map
holding one shape of every layer (a widening stream, a pinched road, a rotated house, a
scatter of logs) draws in order, marks its hexes and exports.
Evidence: units for hex membership (each triangle in exactly one hex, 6n² per hex), frames
and hex marking from shapes; UI tests on a fixture map with supplied shapes.
Regional nesting decision (2026-11-16, agent): left unchanged. Regions keep nesting as today
and a real-scale map opens from any world, regional or real-scale map, so no existing
behaviour changes. The owner can still choose to stop nesting later.

#### M1 execution steps

Path facts (survey 2026-11-16): the child kind is set only at `regional_capture.rs:129`
(`profile = "region"`); the span at `generation_frame.rs:128-137` and
`generation_review.rs:117-130`; the sequence by `generation_request.rs:143,169` and
`configuration/mod.rs:184-202`; the descriptor in `publication/descriptor.rs:44-61`;
`RegionGeometry` is polygon-only; no sequence publishes only captured context;
`browser_fixture` publishes supplied records without a sequence. `SpatialKernel` lives in
`atlas-map`, implemented in `atlas-gis`, so hex marks computed there serve publication and
later editing alike.

1. Hex geometry in `atlas-map` — pointy hex grid in world coordinates (address, centre,
   corners, polygons covering a footprint), hex marks from shapes through the spatial
   kernel, and the outline of a line with a width at each vertex. Generation keeps only
   the lattice adapter (`lattice/hexes.rs`). Verify: units.
2. Contracts — `RealScaleChoice {kind, hexSize, hexesAcross}` on `RefinementRequest`;
   `realScale` on the child's map ownership; a `realScale` block on `MapDescriptor` (kind,
   hex size in metres and feet, hex radius and origin, triangles per edge, creator layers);
   `make contracts`. Verify: build, typecheck.
3. Capture — a real-scale footprint: a rectangle of the chosen hexes across, 4:3, centred on
   the selection's interior point, inside the parent chart; profile `local` (ground) or
   `interior` (structure); no regional-ladder check. Verify: units on the footprint.
4. Frame, span and sequence — `real_scale_span` for the frame and review; a real-scale
   sequence: initialize, refinement begin/clear/context/relief, refresh, classify, project,
   features, names (M2 extends it); remove the dead "site"/"interior" special cases.
   Verify: a real-scale job runs in the browser on the numerical fixture parent.
5. Publication — real-scale layers `plots` and `objects`; footprints for lines with widths;
   the published `hexes` layer with marks from every layer and the dominant ground class;
   descriptor block; GeoJSON export carries hexes. Verify: units on marks; fixture export.
6. Frontend — "Open a real-scale map" on a map: click a point, modal with kind, hex size,
   size, detail, seed and name; hex grid and fill view; draw order by kind; scale bar,
   measure, metres/feet; creator-layer show/hide; parent/child navigation. Verify: UI tests.
7. Fixture and UI tests — `browser_fixture` supplies a real-scale ground map with one shape
   of every layer (widening stream, pinched road, rotated house, scattered logs); UI tests
   open it, check order, hex grid and fill view, measure, metres/feet, layer hide, export;
   one `@generation` test submits a real-scale request.

#### M1 results and deviations

Independent review (2026-11-16): code-level checks all pass; hex alignment confirmed from code
(lattice origin = frame centre = published hex origin; spacing = across-flats / 3n with no
column or row rounding on non-wrapping frames). Fixed after review: width outlines ran on every
map and could fail publication (now real-scale only, skipped when widths and vertices
disagree); hex frame and origin used plain bounds across a cylinder seam (now the compact
descriptor bounds); region tools were offered on real-scale maps (now disabled); no Rust limit
on hexes across (now 10–200); review showed per-detail spans the frame ignored (a real-scale
map now keeps the detail it was opened at); the default creator layer reads "Base layer";
the setup applicability entry for structures names real-scale profiles.

Accepted deviations, each with its owning milestone: the dominant ground class per hex
waits for real-scale cover (M2); the creator-layer lock and editing controls are authoring
(M5); the hex ladder's metres, feet and uses are repeated in `frontend/src/realScale.ts` for
the setup form (view vocabulary; the request carries only the generated `HexSize` label);
a native job
request saved before this change does not load (current-format rule); the breadcrumb bar now
right-aligns its map links because the panel buttons covered them.

The owner directed on 2026-11-16 to generate the world a check needs, then (same day) to
make the harness and local world a real thing and generate natively, with the browser for
UI only. Verification world: the local atlas ([docs/local-atlas.md](local-atlas.md)), a
kept 1,000 × 750 km Draft world, seed 42, generated natively in about a minute; real-scale
maps open straight from it with `make local-real`. The earlier browser profile, its driver
and the 4,000 × 3,000 km browser world are deleted.

Real run (browser engine, 100 m hexes, 50 across, Draft, opened on land from the world):
completed and published in 800 s. Capture, the real-scale sequence, the hex layer, the grid
over the map, the scale bar and the parent link all work. Two findings carried to M2:
(1) the land is the parent's 28 km cells enlarged into a few flat blocks with straight
cliff-like walls between them, so real-scale ground generation is the whole of M2's work;
(2) every process step takes about a minute whatever it does, and publication of 36 raster
layers about 2.5 minutes, so a fixed per-step cost dominates; find and fix it in M2.

### M2 — Generated ground [depends on M1]

Scope: real-scale land from captured context, published into the M1 representation:
relief and edges, exposed rock, water as lines with varying width and pools with banks and
fords, cover by hex size, trails from the people's ways, places at true size. Fill the POI catalogue's true-size slot
(one entry writes it today) for kinds that appear at real scale, and the account slot used
for the map key.
Acceptance: on a real map, a forest map at 100 m and a glen at 1.5 m read as real places:
streams with banks, clearings, trails and named places at plausible size. Judged on the map.
Evidence: units for each step's pure functions; visual review of generated maps.

#### M2 ground — steps (coordinator)

Baseline (M1 run): the land was the parent's 28 km cells enlarged into flat blocks with
straight walls. Causes read from code: categorical parent values (rock kinds, cover) were
copied from the nearest parent raster cell, so contacts followed the parent grid; relief
synthesis scaled its noise and amplitude to the parent span (28 km) on a 5 km map, and its
amplitude follows each cell's rock response, which jumped at those straight contacts; the
first real-scale sequence skipped the development rounds that cut valleys and streams.

1. Irregular contacts: categorical captured values meet along deterministic warped
   contacts (`reconstruction/mod.rs` `contact_donor`), for every captured map. Verify: unit
   `tests/contacts.rs`.
2. Relief synthesis on a real-scale map varies at the map's own size at most
   (`adaptive_relief.rs`; unchanged for regions, whose frames span many parent cells).
3. Real-scale maps run the full regional development sequence (`real_scale()` in
   `atlas/regional/sequence.rs`), so runoff, courses, incision, hillslopes and sediment
   shape the fine land; rivers keep their per-vertex widths, which publication turns into
   banks on real-scale maps.
4. Each hex publishes its `ground`: the surface class covering most of its triangles
   (`product/hexes.rs` `ground_classes`); the fill view colours unmarked hexes by it.
5. Performance blocker, fixed. Profiled natively with perf in a container (owner's
   direction): 96–97% of samples in `Adjacency::smooth` (`field/refinement/base.rs`), whose
   sweep count grows with (σ / child step)², with σ tied to the parent span (media 0.5×,
   captured base 0.15×, character 0.6×); the `refinement.media` query is rebuilt by most
   steps. Fix: when σ is at least the frame's longer side, smoothing goes straight to the
   level the sweeps converge on (the weighted mean of value ÷ rate, which each sweep
   conserves); regions take the unchanged path. Native re-measure: 100 m × 50 hexes 300 s
   (was ~800 s), 1.5 m × 30 hexes 130 s (was unbounded). Remaining: `refinement.context`
   12 s at 100 m (σ just under the frame), parent capture 12 s, publication tail 51 s.
6. Failure found during profiling, fixed: "Cargo must arrive with an occupied material bed"
   (`rock/columns.rs:148`). Rock beds and their cargo took different donors once contacts
   bent; the bend now lives in the grid's one nearest-donor lookup (`Grid::sample_index`), so
   every categorical import of a child cell comes from one donor.
7. Open, not pursued now (owner 2026-11-16: no performance work, especially for browser
   generation): a 300 m, 80-hex (24 × 18 km) map failed on submission in the browser with
   "Uncaught [object WebAssembly.Exception]"; natively it runs. Unverified theory from a
   native trace: the browser engine runs out of its 2 GB memory. No change was kept.
8. Full 100 m run failed after `refinement.places` with "Band index out of range": the cave
   step read the surface raster mask by lattice cell (`atlas/state/caves.rs`); it now tests
   land on the water column like place finding. The cave layers lacked publication
   bindings (`publication/geographies.rs`). Natively the job then completes with caves,
   names and the settlement step.
9. Regression from this work, fixed: world generation failed natively with "Layer does not
   support map profile" because bindings for real-scale-only layers belong to features a
   world also runs; documents now install only layers their profile carries
   (`atlas-host/src/generation_document.rs`).
10. Outside this plan, reported to the owner: a 4,000 × 3,000 km Draft world, seed 42, fails
    natively at HEAD with "Rivers: Geometry collapses at its declared precision", while the
    same world generates in the browser.
11. First local-atlas run (native, 100 m hexes, 50 across, Draft, centred on the town
    Ajarma): completed in 480 s. Published 2,171 hexes, 4 rivers, 4 roads and 23 streets,
    99 buildings with 99 yards, 853 fields, 1 square, 3 wards and a wall; 897 raster layers.
    Findings: no caves and no underground space; the hex layer's catalogue counts 0 hexes
    while 2,171 are published.
12. The Ajarma map's river was a flat-floored trench about 1 km wide and 150 m deep along
    the parent's straight river legs, filled as lake (573 of 2,171 hexes). The stage
    pictures showed it already at "Initial regional detail", before any development round.
    Cause: `place_inherited_valleys` gave every cell of the inherited valley the parent's
    full cut depth. Fix: the cut tapers from the course outward with the same volume
    (`refinement/valleys.rs` `shares`), so the valley has sloping sides and drains.
13. Carried geometry was the parent's straight legs between cells 14 km apart. Fix: one
    smooth bend scaled to the parent's span (`water/import_geometry.rs` `bent`) applied to
    the carried river network, the captured river courses and, once at the start of
    regional development, every captured record (places, ways, waters, outlines;
    `regional_initialization.rs`), so a town stays on its river and its roads still meet it.
    Open: the captured way network (nodes and reaches) is not bent.
14. Settlement: main streets stopped at the trench and only 99 of about 4,000 homes found
    plots. Fix: a place grows rounds of short side lanes while people wait for homes
    (`town/plan.rs`, `town/lanes.rs` `grow`; a city whose ways in stop short houses 6,628 of
    20,000 without growth and over 90% with it). Fields were one grid of identical
    rectangles; now blocks of varied size around scattered seeds, cut back from ways, with
    strips running back from the way near a place and enclosures and pasture further out
    (`town/fields.rs`), at real size (blocks about 220 m, strips about 22 m).
15. Local atlas additions: a picture of the land after each stage, `--until` to stop after
    one (half a minute to judge the land before development), `raster` and `history`
    commands, one map per name.
16. Open: a 300 m × 80-hex map (24 × 18 km) took 53 minutes natively (three development
    rounds of about 14 minutes each); Draft 100 m × 50 (5 × 3.75 km) takes about 8. The
    slowest steps took 8–10 times as long for about 2.6 times the triangles. This matches
    the smoothing cost found earlier: sweeps grow with the square of the parent span over
    the triangle size, and the shortcut applies only when the parent span is at least the
    frame, true at 5 km and false at 24 km. Not timely for normal server use; fixed after
    the land is right (owner 2026-11-16: no performance work on something not yet useful).
17. The 24 km map near Goshi Volcano published caves: 238 caves, 187 lava tubes, 51
    fissures, 299 shafts, 364 entrances in an underground level. Two faults, fixed: caves
    read the lattice's margin outside the frame, so entrances sat on and beyond the map's
    edge (`atlas/state/caves.rs` now reads the map's own triangles only); with no settlement
    in the frame, fields fell back to the map's centre as a place and covered the map with
    about 4,000 blocks and a ring of strips (now a block is worked as often as its farmed
    share says, scattered, never in strips; `town/fields.rs`).

#### M2 places: true size and key — steps

1. True sizes in the catalogue (`field/poi/true_sizes.rs`, bound from each entry's
   `true_size` slot). A place drawn as a point (a site, a work, a settlement) takes a
   real-world reference size with a long tail (least, typical, largest in metres), or
   its own facts where it has them: a summit's prominence, a crossing's river width, a
   settlement's people. A place drawn from its cells (cover, landforms, magic coverage,
   lakes, wetlands) takes the extent those cells cover on this map. A kind with no
   bodily size states why (`Slot::NotApplicable`). One record is one place except falls,
   which keep their member count. Verify: units on the long tail, cell extent, crossing
   and settlement sizes.
2. Map-key account (`account` slot, same module): a short plain sentence on why the place
   is here, from its origin's statement when it has one, its river width or people where
   they matter, else its kind's reason. Publication writes `account` as "what, size, why"
   from the entry name, variety, true size and that sentence. Verify: unit on the size
   phrase.
3. Real-scale publication: a point place whose true size is at least about a hex across
   publishes an outline of that size as its footprint; every place carries `keyNumber`,
   numbered in reading order (north to south by hex row, then west to east). Verify:
   units on the outline and the reading order.
4. Frontend: a "Map key" list in the real-scale panel (number, name, account) read from
   published features only. Verify: tsc, eslint, vitest.

Result (2026-11-16, steps 1–4 implemented, not yet judged on a generated map): every
catalogue entry fills both slots. Compass deviation and interference lattice are
`NotApplicable` (field effects with no body). Open: a true-size outline lies east to west
(no bearing is recorded for a place); the key text states metres whatever the viewer's
units; a settlement's footprint is its built ground from people, before M4's plots.

#### M2 ground detail — steps

Path facts (survey 2026-11-17, corrected in review): published river `widths` come from the
reach store's `channel_dimensions` (`water/channel_geometry.rs`), whose coefficients are
relative measures resolved by the field's `MapScale`. That scale is built from the world's
reference domain on every map, children included (`atlas/workspace.rs`,
`generation_frame.rs`), so width was about 9,000·√(Q / world span): 9·√Q m on the 1,000 km
local atlas and 4.5·√Q on the 4,000 km reference world, whatever the bed. An earlier note
here gave 127·√Q, wrongly taking the child's frame as the span. Discharge is mean m³/s
(`ledger::depth_rate_to_discharge`). The generation state did not know its map was
real-scale: `Scope.real_scale` now carries the captured `RealScaleMap` (set in
`atlas-host/src/generation_frame.rs`), and the field's scale is marked real-size from it
(`MapScale::at_real_size`).

Design: one pure process family, `processes/ground/` (labelled settings in `settings.rs`,
one module per step, explicit inputs in metres), with state adapters in
`atlas/state/real_scale_{water,ground,trails}.rs`. Five commands on the common interface
(`registration/ground.rs`) join `real_scale()`. Pools and rock run right after
`atlas.features`. Trails, crossings and cover follow `real-scale.settlement`, so they see the
town's streets and bridges.

1. Channels at real size — on a real-scale map `channel_dimensions` sizes every channel cell
   with the one relation in `processes/ground/channels.rs`: width = a·√Q with `a` a rock-family
   fact in the rock catalogue (`RockFamily::channel_width_per_root_discharge`: loose 4.5, broken
   4.0, sedimentary 3.5, ice and metamorphic 3.0, igneous 2.8) for the top bed of the cell's
   section (`queries::bed_family`); depth = Q / (width · 0.7·Q^0.1). The drawn rivers,
   catalogue fords and bridges, trails, caves and incision all read those widths. Verify:
   `channels.rs` and `channel_tests.rs` units.
2. `real-scale.pools` — a new POI kind `pool` (water group, `field/poi/pool.rs`, true size
   and account filled) published at a new `Moment::Ground`. It finds pools on the drawn
   channels: slack where the stretch's gradient (4 widths) is below 0.35 of its reach's (40
   widths), at confluences, and on the outside of bends tighter than 3 widths, with pools at
   least 5 widths apart. A pool is 2.5 × 1.5 widths and twice the channel depth, published in
   `lakes`. Verify: `pools.rs` units on explicit beds, bends and junctions.
3. `real-scale.rock` — triangles with loose cover under 0.3 m or a slope over 0.7 (repose)
   join into `outcrop` polygons (union of triangles, with the commonest rock), and long
   narrow bands steeper than 1.4 into `cliff` lines with height. These go in `geology`. An
   outcrop marks its hexes `rock` (`atlas-map` `mark_shape`). A hex more than half rock takes
   the ground "Exposed rock" (`product/hexes.rs` `hex_ground`). Verify: `exposure.rs` units,
   `hex_ground` unit.
4. `real-scale.trails` — least-cost walks (Dijkstra over the triangles) from settlements,
   cave entrances, springs, peaks, waterfalls, magic practice sites, mines and buildings
   farther than 20 m from any way. Each walk runs to the nearest way or settlement, nearest
   first. Cost per metre is 1 + (grade/0.15)² + 2·tree cover + 3·wetland. Water multiplies it
   by 40, or by 3 where the channel is shallower than 1 m. A laid trail's triangles cost 0.4,
   and a later trail is cut where it meets an earlier one (`joins`). Width runs from 1 m to
   2 m with the number of trails walking it. Trails are `trail` in `roads`, in the roads
   network. Verify: `trails.rs` units on a small lattice.
5. `real-scale.crossings` — every road, street, track or trail meeting a drawn channel, and
   no bridge or ford within 10 m plus 2 widths: shallower than 1 m gives a `ford` point
   (`transportSites`). Deeper gives a `bridge` (`structures`) on roads and streets, spanning
   the channel and its abutments. Both relate `crosses` to the river and `carries` to the way,
   with true size and account. Verify: `crossings.rs` units on explicit lines.
6. `real-scale.cover` — on maps with hexes of 10 m or less, Poisson-disc scatter per
   triangle from its shares. Trees come from tree cover, shrubs from scrub surfaces, boulders
   from exposed rock and scree, reeds from wetland. Spacing and density are declared per
   kind; sizes follow a long tail between the catalogue's own least, typical and largest
   (`catalogue.json` `sizes`, `true_size`); nothing is placed on ways, water or buildings. Objects layer kinds
   `tree`, `shrub`, `boulder`, `reeds`. Verify: `cover.rs` units on spacing, density and
   sizes.
7. Catalogue and view — `catalogue.json` gains `outcrop`, `cliff`, `pool`, `shrub`, `reeds`.
   `realScaleStyles.ts` adds the `rock` mark colour and per-kind colours for plants and
   stones. Verify: tsc, eslint, prettier.

Results (2026-11-17, implemented, not run on a generated map by direction): 21 new
`processes::ground` units and the `hex_ground` unit pass. `cargo test -p atlas-generation
--lib` passed before review; after it, only the town agent's in-progress
`town::plan` test fails. Also passing: `atlas-host --test real_scale`, the sequence, place-size and
publication tests, the architecture checks and clippy on `atlas-generation`. Workspace
clippy stops on other agents' in-progress `atlas-map` and `atlas-host/tests/structure_maps.rs`.

Review fixes (2026-11-17):

- **Channels.** The separate drawn-river rewrite step is gone. The water model sizes channels
  at real size itself (step 1), so catalogue crossings take their size and key text from the
  real width.
- **Carried places.** `captured_place` keeps the captured facts but takes the bent shape,
  footprint and `representative` from the working record (`carry::located`).
  `bend_record` bends the `representative` too.
- **Bend guard.** A record bends again when `carriedOnto` names another map.
- **Bend, then clip.** The network bends a course and then clips it to the frame
  (`ImportGeometry::clipped`), with stations read along the bent course. Captured courses
  drop positions outside the frame instead of clamping them (`Bend::cell`). Captured records
  are re-clipped to the frame after the bend, and those taken wholly outside are removed;
  contracted features keep their shape.
- **Pools.** A junction makes a pool only within 2 widths of its piece, and pool ids name
  the piece.
- **Caves.** Chamber outlines are clipped to the frame (`shape::clip_ring`).
- **Real-size thresholds.** On real-scale maps these existence thresholds are real sizes
  (`significance::physical`): pass col rise 20 m; ridge, valley and gorge course 300 m with
  15 m relief; plateau, dome, cirque and moraine area 5 ha with 15 m relief; lake area
  2,000 m², or 300 m² when 3 m deep or feeding 0.1 m³/s; waterfall drop 3 m or breadth 15 m;
  great fall 20 m; peak prominence 15 m least, 30 m in a range, 60 m alone, 30 m for a sea
  mark, 100 m for a horn's col.
- **Thresholds left relative.** Fjord, volcano, crater and exceptional ice thresholds, and
  magical course length. These landforms either outsize a real-scale frame or arrive carried
  from the parent. Placement spacing and reach in cells are resolution, not size.

Tests added (all pass): one parent point lands on the same child cell for the network
lookup, a captured course, a bent record and a carried place, on a real lattice from
`Bend::new`. Further tests cover the once-per-map guard, clipping instead of clamping, the
same-kind clip, real-size channels, the catalogue bed fact, per-piece junctions and ids,
the chamber clip and `physical`.

Deviations and open items: real-scale fords and bridges are way structures, like the town's bridges, not
catalogue places, so the key does not number them. A deep crossing on a track or trail gets
no structure. Shrub cover is read from surface classes, since no shrub share exists. Without
a magic workspace there are no scrub or scree shares. The rock and cliff thresholds, trail
costs and cover densities are judged only by units; on a generated map they are unverified,
including how much of a coarse map turns to outcrop and how long trails take in the browser
engine.

### M3 — Generated underground [depends on M2]

Scope: underground spaces from rock, fractures, water and magic: passages, chambers,
levels, shafts and entrances located on the surface.
Acceptance: a cave under karst rock reads as dissolved passages; under other rock it reads
as fissures or lava tubes; entrances sit on the ground map.
Evidence: units; visual review.

#### M3 execution steps

Path facts (survey 2026-11-16): a cell's rock section to depth is `Ground::section`
(top/bottom in native units, catalogue facts per kind: solubility, jointing, resistance,
family); groundwater routes cell to cell (`GroundwaterView::targets`, `recharge`) and the
surface flow has `routing.targets`; fractures are `Scalar::FractureConductance`; volcanic
ground is `Scalar::VolcanicConstructionHistory`; Fire's `vein` and `basalt` rules and
Greenwood's `sinkhole` rule are readable per cell; a published feature's space comes from
its layer, and the GIS store refuses a feature whose layer is in another space.

Design: one process, `processes/caves`, reads the real-scale map's own ground and writes one
underground located space under the ground map. Each land cell's host is the first bed within
cave reach whose catalogue facts open it: soluble rock dissolves (along the groundwater's own
routing, so passages branch toward springs), volcanic igneous ground or Fire's basalt keeps
lava tubes (one stem down the surface flow), fractured hard rock opens fissures and Fire's
vein opens thermal passages (both along the component's long axis). Greenwood's sinkhole
ground dissolves whatever the rock. Chambers sit at passage confluences and fracture
intersections; levels are depth bands below the surface; shafts sit where a dissolved branch
begins under the surface; entrances (cave mouths, sinkholes, tube skylights) are where a
passage meets the ground. Each connected host component is one named cave.

1. Process — `processes/caves/` (`host.rs` host from beds and facts, `network.rs`
   accumulation, branches, stem and axis on explicit graphs, `shape.rs` smoothing, chamber
   outlines and levels, `settings.rs` labelled controls). Verify: units on explicit inputs.
2. State adapter and registration — `atlas/state/caves.rs` reads the field into the process
   input and writes features (`caves` layer: cave, passages by form with `widths`, chambers,
   shafts; `caveEntrances` layer: entrances with a relation to their passage); command
   `refinement.caves` in `regional/work.rs` and `registration/regional.rs`; the coordinator
   adds it to `real_scale()` before `atlas.names`.
3. Publication — `caves`, `caveEntrances` and `caveHexes` in `layers.rs` REAL_SCALE_ONLY and
   `catalogue.json`; an underground space (`<primary>:underground`, floor `underground`) in
   the descriptor when the map has caves; underground layers publish in that space; features
   take their layer's space; `caveHexes` marks hexes from cave shapes. Verify: units on the
   space and marks.
4. Frontend — a Level choice (surface or underground) in `RealScaleControls.tsx` when the
   descriptor has an underground space; the canvas shows the chosen space; cave layers in
   `realScaleOrder` and `realScaleStyles.ts`. Verify: tsc, eslint, vitest.

### M4 — Generated settlement [depends on M2]

Scope: the town map starts as land plus the society features generated there: buildings
where people live, lanes and streets from the ways in, plots and fields, wards. Streets are
a named network; buildings carry use, occupants and an address numbered along their street.
Layout type is an outcome of the settlement's own story (ways, river, seat, walls, era) and
a creator choice.
Acceptance: a generated village and a town on a real map have named streets, addressed
buildings and fields that read as a place.
Evidence: units for network, plotting and numbering; visual review.

#### M4 execution steps

Path facts (survey 2026-11-16): a real-scale child holds the parent's settlement points and
roads clipped to its frame as generated records in its own area (`regional_capture/records.rs`),
with their story attributes (`settlementPopulation`, `settlementRole`, `siteKind`, `history`,
`namingCulture`; roads carry `roadClass`, `strategic` and an "A–B" label). People, farmland and
pasture shares are inherited layers on the triangles (`human/catalogue.rs`). Records are written
through `map_records::generated` and `State::write_feature`; the vocabulary of kinds is
`publication/catalogue.json`; names come from `atlas-names` work terms through `MapNaming`.
The real-scale sequence (`atlas/regional/sequence.rs::real_scale`) belongs to the coordinator,
so the process is registered and the coordinator adds its invocation.

1. Process `real-scale.settlement` in `atlas/town/`, registered by
   `atlas/dispatch/registration/town.rs` with a `layout` setting (`story` or a forced layout),
   joined to assembly and the regional catalogue. Verify: build.
2. Story and layout (pure): size from the settlement's people; layout from its ways, river or
   pass site, seat role, strategic roads and how many eras it has been a town; a forced setting
   wins. Verify: units.
3. Ground raster (pure): the plan's working grid marking water, steep and outside ground from
   the triangles, and owning streets, squares and plots so shapes never overlap. Verify: units.
4. Network (pure): main streets grow from the ways entering the frame through the seat (or a
   through-way along the contour when none enters); lanes fill between them by layout (organic
   branching, grid, radial rings, linear back lanes, walled ring with gates); bridges where a
   main street crosses narrow water, ending at wide water; widths per vertex with a pinch at gates.
   Verify: units.
5. Plots, buildings, uses and addresses (pure): plots front streets on both sides, nearest the
   centre first, until the settlement's households and trades are housed; one building per plot
   turned to its street; uses by size and role (temple, hall, market hall, inn, tavern, smithy,
   mill, trades, warehouse, keep, houses); addresses odd on the left and even on the right from
   the end nearest the centre; fields beyond the built edge until the frame's farmland and pasture
   shares are met. Verify: units for slots, numbering, demand and assignment.
6. Wards (pure grouping by sector between main streets, inside and outside a wall) and
   publication: named streets (`roads`/`street` with `widths` and `roadClass`), the square,
   yards and fields (`plots`), buildings, bridges, wall and gates (`structures`), wards
   (`settlements`/`ward`), names from the settlement's naming culture. Verify: units, clippy,
   architecture checks; the coordinator runs the real-map check.

### M5 — Real-scale authoring foundation [depends on M1]

Scope: the generated→authored switch; Rust authoring commands over GIS features (create,
reshape, move, delete, attribute edit) with identity, validation and topology through the
shared spatial adapter; snapped junctions; undo and history for real-scale maps; OpenLayers
draw, modify and snap interactions; save through the existing explicit save and LAN
retention. World and regional maps stay read-only.
Acceptance: dragging a river's vertices on a ground map keeps one river feature with its
attributes, and its bridge stays on it; undo restores it; the map reloads with the edit.
Evidence: units for commands and topology; UI tests for draw, modify, undo and save.

#### M5 execution steps

Path facts (survey 2026-11-16): presentation reads vectors through `features` queries, never
the GeoJSON vector assets; the browser keeps a temporary working catalog and **Save map**
copies revisions into the saved catalog (`map_store/copy.rs` skips revisions it already
holds); the LAN store lists heads, so a server map is retained without Save (owner mark
2026-11-15); `mark_of`, `mark_shape` and `fill` live in generation publication, which
`atlas-gis` must not import; the catalogue has no bridge kind; region navigation already
shows the facade pattern (`map_protocol/navigation.rs`, `RpcMapNavigation`).

Design: an authored map keeps its map id and revision, so children, saves and navigation keep
pointing at it. Each edit rewrites the touched feature rows of that revision in one
transaction, recomputes their footprints and the marks of every hex the old or new shapes
touch, and appends an undo step holding the features before and after. Undo and redo apply
a step's other side through the same path. The descriptor's `realScale.edits` counts edits;
a non-zero count is the generated→authored switch, and publication refuses to replace an
authored map. The browser's Save replaces the saved copy of an authored revision; the LAN
store writes edits straight to PostGIS.

1. Contracts in `atlas-map` — `authoring` module: the edit commands (create, reshape,
   transform, duplicate, delete, attributes, paste style, lock, creator-layer add, rename,
   lock, move to, merge down, delete), steps and outcome; `realScale.edits` and creator-layer
   `locked`; mark rules and footprints moved from generation into `hexes.rs`; a bridge kind in
   the catalogue. `make contracts`. Verify: build.
2. Pure command logic in `atlas-map` — applying a command to loaded features: validation
   (real-scale only, layer shape, frame, widths, locks, catalogue type), widths carried along
   reshaped lines by linear reference, affine transforms with rotation, junction relations
   (a bridge spans the water and carries the way it crosses; a line end joins the line it
   is snapped to) and their following when a host line moves. Verify: units.
3. Storage in `atlas-gis` — an edit store over SQLite and PostGIS (edit-step tables, feature
   rewrites, descriptor update), the orchestration that loads targets, dependents and hexes
   and writes the change with re-marked hexes, undo/redo/history, the editing call protocol,
   footprint-aware feature bounds, authored replacement on browser save, the publication
   refusal. Verify: units on an in-memory store.
4. Hosts and facades — `BrowserWorkspace.edit`, LAN `api/maps/editing`, `MapEditing` in
   `@atlas/map`, RPC and HTTP transports, the worker service and context wiring.
   Verify: typecheck.
5. Frontend authoring — an Edit tool set on real-scale maps only: select (Alt-click steps
   down), vertex modify, draw by layer and kind with keep-tool, snapping to ways, water and
   the hex grid, move with alignment guides, rotate and scale handles, delete, duplicate,
   select same kind, copy/paste style, lock; a property panel (position, angle, size, then
   the kind's attributes with widths per vertex; fields take arithmetic and units); creator
   layer controls; a history list with undo and redo; a command palette doubling as the
   shortcut sheet; Regenerate disabled once authored. Verify: lint, typecheck, units of the
   pure helpers.
6. Fixture and UI tests — a bridge on the trail over the burn in `browser_fixture`; UI tests
   for draw, modify (drag a vertex of Glen burn: one feature, widths kept, bridge on it),
   undo, history, layers and save across reload.

#### M5 results and deviations

Steps 1–6 implemented in the working tree (2026-11-16), not yet reviewed or committed. Checks:
`crates/atlas-gis/tests/authoring.rs` (8 units: drag keeps identity, widths and the bridge;
inserted vertex width; snapped join follows; validation, locks and read-only world maps;
regeneration refused; layer commands with undo; save replaces the saved copy), clippy, frontend
typecheck, lint and unit suite, architecture checks, and `tests/realScaleAuthoring.test.ts`
(the acceptance drag, undo, redo, Save and reload; draw, angle and size fields, layers,
lock, merge down, the command palette and Ctrl+Z). The `@generation` scenario in
`tests/realScale.test.ts` fails on generation-dependency alerts from the in-progress real-scale
sequence, not on authoring.

Review fixes (2026-11-16): `finish` refuses a regeneration over a map authored while it ran;
Save replaces the saved copy of every authored map it copies, children and parents included;
hexes and other non-drawable layers refuse edits; locked layers refuse attribute edits, moves
into them, drawing into them and undo/redo over them; followers and crossings over a new or
reshaped line re-read their junctions; edits need the map's head revision; hex snapping uses
hex centres; a bridge's `rotation` follows its way; owner marks quote the owner's words;
pure shape units in `crates/atlas-gis/tests/authoring_shapes.rs` and `atlas-map`.

Deviations: the PostGIS edit store compiles but has no integration run here (no container
runtime); find and filter, jump points and an opening view are not built (the Arconis list tags
them M5, the milestone scope does not name them); GeoJSON vector assets written
at publication are not rewritten by edits, since presentation and export read feature records;
children of an authored map keep pointing at the same revision because edits keep it.

### M6 — Land and cave tools [depends on M3, M5]

Scope: river and stream drawing and reshaping with width along the line, hex terrain and
cover painting as hex-layer edits, paths and trails, placing, rotating and scattering clutter
and single objects (one log, or a rubble spread over an outline), cave wall drawing that reads published rock and magic context for
special features (flowstone in karst, seams on Fire veins, rime on Aurora ground).
Acceptance: the owner's examples work: moving a river; a drawn cave wall that shows the
rock it cuts.
Evidence: units; UI tests.

#### M6 execution steps

Path facts (survey 2026-11-17): published samples carry each channel either under its own
raster layer (`raster:<channel>`, band `value`) or as a band of the `inspection` layer, so the
rock under a point is `RockLayerKind0` and magic coverage is `magic:<system>:coverage[:<rule>]`;
rock solubility lived only in the generation rock catalogue; a map without caves publishes no
underground space or cave layers; hexes refused every edit (`shape_of` is `None` for them) and
the edit path queried the primary space only (M8 made it space-aware during this work).

Design: the tools are Rust edit commands and attribute edits over published features; the
frontend only draws, picks and sends them. Water and ways use the M5 Create/Reshape path with a
starting width from a chosen size; per-point widths are edited in the panel or by a width
handle beside each point. A placed object is `Place` (an outline of its kind's real size,
turned and scaled); a scatter is `Scatter` (Poisson-disc points from a seed inside the drawn
outline, each object its own feature, one undo step). A hex accepts only `SetAttributes` of
`ground` (a surface class) and `cover` (open, light, heavy, blocking); re-marking writes only
`fill` and `marks`, so the classes stay. Cave walls are lines in a `caveWalls` layer in the
underground space; drawing the first one adds the space, the wall and cave-hex layers and a
copy of the surface hex grid in the same step (undo closes it again). A wall drawn or moved
reads the published samples along it: the rock classes it meets, flowstone where a class is
`soluble` (published on rock categories by the cave process's own dissolution rule), seams
where Fire's vein coverage is above zero, rime where Aurora's coverage is.

1. Contracts in `atlas-map`: `EditCommand::Place` and `::Scatter`; `Category.soluble`;
   `underground.rs` (the underground space shared with generation, the authored wall and
   cave-hex layers, `opened`); `authoring/objects.rs` (object sizes and outlines, seeded
   Poisson-disc points), `authoring/placing.rs` (Place, Scatter, hex classes),
   `authoring/context.rs` (wall context from samples); `caveWalls` in `shape_of` and `mark_of`.
   Verify: units for spacing, repeatability, outlines and context on explicit samples.
2. Generation: rock categories publish `soluble`; the `caveWalls` layer (underground,
   real-scale only) and the `caveWall` and `cart` kinds in the catalogue; a unit checks the
   authored layer kinds read exactly as publication names them.
3. Store in `atlas-gis`: `authoring/caves.rs` (opening the underground on a first wall,
   reading samples along a wall); hex layers among a command's readable targets; hexes the
   change creates are marked with it; a space the change opens reads as empty. Verify:
   `tests/authoring_land.rs`.
4. Frontend: a Land tools bar and palette entries with shortcuts (R river or stream, T trail
   or path, O object, S scatter, W cave wall, H hexes); size choices for water and ways;
   object kind, turn, scale, spacing and seed; hex selection by click, Shift-click and box with
   a ground and cover panel; width handles in Edit points; the cave wall's rock and features in
   the property panel; the view moves to the Caves level after the first wall; the canvas
   remounts when the map gains a located space.
5. Fixture: the glen has its own supplied field (limestone west of x 55, granite east, Aurora
   coverage in the north-east, a Fire vein cell), published as samples through the normal
   finished-map path. UI tests in `frontend/tests/realScaleLandTools.test.ts`.

#### M6 results and deviations

Steps 1–5 implemented in the working tree (2026-11-17), not yet reviewed or committed. Checks:
`atlas-map` units (scatter spacing and fill, seed repeatability, object outlines, wall context
on explicit samples in both published forms); the generation unit that authored cave layers
name their kinds as publication does; `crates/atlas-gis/tests/authoring_land.rs` (7 units:
place, scatter spacing/repeat/one-step undo and the spacing refusal, hex ground and cover kept
through re-marking and restored by undo, hexes refusing every other edit, the first wall
opening the underground and marking its grid, limestone/granite walls with flowstone, seams and
rime and a moved wall reading again, undo closing the underground and redo reopening it);
workspace clippy; contracts regenerated; frontend typecheck and ESLint;
`frontend/tests/realScaleLandTools.test.ts` (draw a river with sizes and a point width, move
it as one feature with its widths; set two hexes' cover and ground, box-select, undo; draw a
path that joins Drovers' trail; place a cart and scatter rubble, undo the scatter; draw a cave
wall from the surface, land on the Caves level and see Limestone and flowstone).

Deviations: width handles are built but have no UI test (the panel's point widths are
tested); the glen fixture gained an underground space from M8's inn cave during this work, so
the UI test does not exercise opening the underground (the store units do); the history names
a drawn wall by its kind id ("Draw caveWall"), as M5 names every unnamed shape; the
`caveWalls` layer is published empty on generated maps that have caves, so walls drawn there go
into it without opening anything.

Review fixes (2026-11-17): redo of a first cave wall re-marks the reopened grid (hex re-marking
reads the step's own layout); a map publishes its authoring choices on `realScale.authoring`:
ground classes (its surface legend and exposed rock, with colours), cover classes (with tints)
and latent layers (a ground map without caves publishes its cave-wall layer as latent), so the
hex panel offers only published classes, Rust refuses any other, and the fill view draws ground
and a cover tint; hexes belong to no creator layer, and undo/redo do not hold features of a
layer the step itself opens or closes; object outlines and line starting widths come from the
catalogue's true size (`"sizes"` in `catalogue.json`, published as `trueSize` on feature types),
and the authoring size table is gone; a wall cuts the bed at its depth (its own `depth`, else
the nearest generated cave's, else the first rock bed under the loose cover), read every metre
along it (finer where the samples are); the TypeScript cave-wall layer, width presets and cover
list are gone. Open: the ground process keeps its own across ladders for tree, shrub, boulder and
reeds (`processes/ground/settings.rs`); the catalogue sizes repeat those values.

### M7 — Town tools [depends on M4, M5]

Scope: street network builder (classes, junctions, names, renumbered addresses), building
placement on plots with use and occupants, building art from the art shipped with the app
for each use, find-by-address.
Acceptance: a creator lays out a new street off a generated one, places an inn, gets its
address and art, and finds it by address.
Evidence: units; UI tests.
Owner 2026-11-17: there is no art-generation tool; building art is generated with OpenAI
during development and shipped as assets, outside this plan's work.

#### M7 execution steps

Path facts (survey 2026-11-17): generated streets are `roads`/`street` features with
`widths`, `roadClass` and `settlement`, each starting at the end nearest the settlement's
centre (`town/network.rs`); buildings carry `use`, `occupants`, `storeys`, `household` or
`business` (the keeper, also the feature's name), `address`, `addressNumber`, `street`,
`streetId`, `ward` and a `fronts` relation to their street; yards carry the same address keys
and are named by their address line (`town/records.rs`). Generated names come from
`atlas-names` work terms (`street`, `lane`, `inn`, `household`…) in the settlement's
`namingCulture`. `atlas-gis` must not depend on `atlas-names` (architecture check), so naming
is supplied to the map store by the host.

Design: the settlement vocabulary generation lays towns with (sizes by people, street classes
and widths, building uses with footprints, occupants and storeys, plot sizes, setback, fill,
house numbering) moves to `atlas-map/src/town/`; generation re-exports it, so one rule serves
both. Two commands, `DrawStreet` and `PlaceBuilding`, read the authorable features around them
and the map's settlements (`EditTargets::Around`). The map store then names unnamed new
streets and buildings through a `TownNames` host service and renumbers every street the
change touches, in the same undo step. Addresses run odd on the left and even on the right
from a street's first point; a building takes the number of the plot its centre stands in.

1. Shared vocabulary in `atlas-map/src/town/` (`mod.rs`, `uses.rs`, `addresses.rs`), with
   address parsing and street-name matching; generation's `story.rs`, `network.rs`,
   `uses.rs`, `plots.rs` and `addresses.rs` re-export it. Verify: atlas-map units, generation
   town units.
2. Commands in `atlas-map/src/authoring/town.rs` and `frontage.rs`: a street's ends within a
   hex of a way move onto it and the way gains a vertex there (junction); a side street begins
   at its junction, else at the end nearer the settlement's centre; width from class at the
   settlement's size. A building fronts the street of the empty plot it is placed in, else the
   nearest street within 40 m, turned to it at the use's fitted footprint on a plot of its own
   (clipped at the map's edge); it refuses to stand on another building. Verify: units.
3. Store completion in `atlas-gis/src/authoring/town.rs`: naming, refronting moved, new and
   orphaned buildings and plots, renumbering touched streets; `EditOutcome.created` lists what
   an edit made. Verify: `crates/atlas-gis/tests/town_tools.rs`.
4. Find by address: `ReadCall::FindAddress` (`atlas-gis/src/map_protocol/addresses.rs`) over
   published features; `MapReader.findAddress` in `@atlas/map` and the transport. Verify: unit,
   typecheck.
5. Host naming: `atlas-host/src/town_names.rs` implements `TownNames` with `atlas-names`; the
   browser workspace and LAN service pass it to editing calls. Verify: unit.
6. Frontend: Town tools (Draw a street, Place a building) with class, use and optional name;
   the building panel (`RealScaleBuilding.tsx`: use, occupants, storeys, keeper, address, the
   shipped art for its use or a placeholder); the shipped art index
   `frontend/public/building-art/manifest.json` (no images are shipped yet); Find address in
   the editor, which selects the match and centres the view; palette entries and shortcuts L,
   B and F. Verify: lint, typecheck, `buildingArt.test.ts`.
7. Fixture and UI tests: a "Supplied village" child of the island (`browser_fixture/town.rs`:
   High Street and Mill Lane, four addressed houses, an empty inn site);
   `frontend/tests/realScaleTownTools.test.ts`.

#### M7 results and deviations

Steps 1–7 implemented in the working tree (2026-11-17), not yet reviewed or committed. Checks:
atlas-map units (numbering after an insert, address parsing, street-name matching, classes,
uses, fitted footprints, side-street orientation, plot sizes), generation town units (27 pass
after the move), `crates/atlas-gis/tests/town_tools.rs` (8 pass: junction vertex with its
width, renumbering, a lane joining High Street with class width and a name and its undo, an
inn on the empty plot taking 4 High Street and moving the house beyond it to 6 and back on
undo, a smithy fronting Mill Lane on a plot clipped at the map's edge and refused where a
house stands, a moved house readdressed to Mill Lane, a deleted plot renumbering the next,
find by number and street, by street alone and by a street's first word), the host naming
unit, clippy on the touched crates, `make contracts`, architecture checks, frontend
typecheck, lint, `buildingArt.test.ts`, and both UI tests in `realScaleTownTools.test.ts`
(lane drawn off High Street, named and joined at a new vertex; inn placed with its address and
art placeholder, the next house renumbered; Mill Lane then the inn found by address; undo;
palette entries and the L, B and F shortcuts).

Deviations and open points: a street's ends join the ways they meet by a shared vertex on
the way and a `joins` relation; the way is not cut into two features, so a named street
keeps one identity and one run of numbers. Only a drawn street's ends join; a street crossing
another in its middle does not make a crossroads. The building-use list and street classes
are repeated in `frontend/src/realScaleTown.ts` for the choice lists (view vocabulary; Rust
validates both). No art is shipped, so the manifest is empty and every use shows the
placeholder without asking for a file. Found by the UI test, outside M7: pressing Escape on
the canvas while editing runs the region tools' cancel (`publishedRegionInteractions.ts`),
which switches the map tool to Inspect and closes the editor.

Review fixes (2026-11-17), M4 and M7, each with a unit test that failed before it:

- Settlement (M4): lanes grown to house waiting people start only where a street's frontage is
  open and stop at plots; a lane's line and both edges are tested, its ground reaches half a
  cell past its edges and ends, and it takes the mouth from the street it leaves, so no street
  runs through a building (the 20,000-person city test asserts none). Growth has no round cap:
  it goes on while people wait and a lane can be laid; people left are published as
  `unhoused` on the settlement record. A special building with no place leaves its people to
  ordinary homes. Drawn channels at their published widths, and lakes and pools by outline,
  are water on the plan grid. Fields keep clear of every way on the map, marked on the grid,
  with or without a settlement. The layout controls are declared once in
  `atlas/town/settings.rs`; the shared vocabulary (bridge span included) stays in
  `atlas_map::town`.
- Town tools (M7): a new plot records the street it fronts and its building is addressed
  there; a building on an existing plot is fitted to it; a new plot is cut back from water,
  ways and other plots; the store refuses a placed, moved or reshaped building on water, a
  way, another building or another plot, and a street through a building or across water wider
  than its settlement bridges; a drawn street gets a bridge over narrower water. A moved
  street is checked but gets no new bridge. Renumbering keeps the numbers of plots on locked
  layers and numbers the rest around them. The art direction is an owner mark on
  `buildingArt.ts`.

### M8 — Structure maps and interior tools [depends on M5]

Scope: structure map created from a building footprint, inheriting frontage, door and
address; levels with stairs and trapdoors as connections; walls, doors, windows, furniture
and decor as shapes over the hex grid; outside context shown (magic prevalence, the magic
features at the site, the parent's place record); connections to caves and other maps.
Acceptance: the inn from M7 opens to a ground floor and cellar the creator draws, the
cellar trapdoor connects to a cave, and the inn shows the local magic prevalence.
Evidence: units; UI tests.

#### M8 execution steps

Path facts (survey 2026-11-17): a `structure` real-scale request captured profile `interior`
and then ran the whole real-scale ground sequence (relief, water, caves, settlement), so it
generated land inside a building. Located spaces are bound one-to-one to layers (the GIS store
refuses a feature whose layer is in another space), so each level needs its own layers.
Authoring read and re-marked the primary space only. Town buildings carry `use`, `storeys`,
`address`, `street`, `ward`, `settlement` and a `fronts` relation to their street, but no
frontage attribute. The parent's catalogue copies of `structures`, `objects` and `hexes` list
every vocabulary kind, so a structure map can copy them without importing generation.

Design: a structure map is made by the host that owns the catalogue from the building's
published record (`atlas-host/src/structure_maps.rs`, `EditingCall`-side `openFloors`), with
no generation job: its only generated content is the shell, a pure function of the footprint
(`atlas-map/src/structure/shell.rs`). The frame is the footprint plus two hexes at 1.5 m; the
ground floor is the building's own located space and keeps the plain layer ids; every other
level is a space `<primary>:level:<n>` (floor `level:<n>`) with layers `<id>@<n>` named
"Structures · Cellar". The map's descriptor parent is the ground map, so it lists as its
child, and `realScale.site` records the building. A second Open floors returns the same map.
Real-scale structure requests through generation are refused at capture.

1. Shell and levels (pure, `atlas-map/src/structure/`): counter-clockwise footprint, the
   front wall is the edge nearest the fronted street (else the longest), one outer wall per
   edge on every level as a line with a 0.6 m thickness, the street door across the middle of
   the ground floor's front wall with an `in` relation to it, levels −1 (cellar) to storeys−1,
   hexes per level marked by the walls. Verify: units in `structure/tests.rs` and
   `atlas-host/tests/structure_maps.rs`.
2. Authoring across spaces (`atlas-gis/src/authoring/`): queries read every space holding
   the requested layers; junctions stay in a feature's own space; each space's hex layer is
   re-marked from that space's shapes; `Draft.spaces` / `EditSide.spaces` carry a change of
   spaces and layers that undo restores (shared with M6's cave opening). Layer families strip
   an `@<level>` suffix; `wall` in `structures` is a line (`shape_of_kind`).
3. Level and connection commands: `AddLevel { below }` (copies the neighbouring level's outer
   walls, new hexes), `RemoveLevel { spaceId }` (never the ground floor; takes its features),
   `Connect`/`Disconnect` (stair, ladder, trapdoor, door: `leadsTo` held by both ends on
   different levels; `connectsTo` with target `<map id>#<feature id>` checked against the
   other map by the store). Catalogue kinds `window`, `stair`, `ladder`, `trapdoor`, `decor`;
   real sizes for placing them. Verify: units with undo.
4. Outside context: `ReadCall::Site` (`atlas-gis/src/map_protocol/site.rs`) reads the parent's
   building record, the samples under the footprint (the nearest ancestor in the same space
   that publishes samples) and the magic-layer features within 150 m; `site_context` averages
   each system's published coverage band (`magic:<system>:coverage`, as a band or a raster
   layer of its own). Verify: units on explicit samples.
5. Frontend: Open floors in the Building panel; level choice (top floor first) in the view
   and Show / Add floor above / Add cellar below / Remove in the editor; a Connections panel
   for connection kinds with Go to (same map: level and centre; other map: opens it at the
   feature's level); "Outside this building" in the real-scale panel; walls draw as lines.
   Verify: tsc, eslint, vitest on touched files.
6. Fixture and UI tests: the glen gains "The Rowan Inn" (two storeys, fronting the drovers'
   trail) and "Rowan passage" in its underground; `tests/realScaleStructures.test.ts`.

#### M8 results and deviations

Steps 1–6 implemented in the working tree (2026-11-17), not yet reviewed or committed. Checks:
`atlas-map` units (`structure/tests.rs`, 7), `atlas-host/tests/structure_maps.rs` (5: shell
with front wall, door and marked hexes; levels from storeys; add and remove levels with undo;
stair and cave connections with refusals; outside context on explicit samples), the existing
authoring units (`authoring`, `authoring_shapes`, `authoring_land`), clippy on `atlas-map` and
`atlas-host`, contracts, architecture checks, frontend typecheck, eslint and vitest on touched
files, and `tests/realScaleStructures.test.ts` (2 passed on a rebuilt engine and fixture).

Deviation from the brief, agent decision: a structure map is not produced by a generation
job. Its generated content is the shell only, computed in Rust from published GIS, so the
catalogue host builds and publishes it directly; this also makes Open floors immediate and
lets the UI test open real floors instead of a supplied reply. Open: the reciprocal link on
the cave side (a parent feature does not list the trapdoors that reach it); doors and windows
are outlines placed on walls without cutting the wall line; level names are fixed by number.

Review fixes (2026-11-17): deleting a stair or removing its level lets go of the landing in
the same undoable step (`atlas-gis/src/authoring/links.rs`), and Disconnect lets go of a link
whose target, on this map or another, is gone; walls are lines to the junction code (a drawn
wall's end joins the wall it meets and follows it); the connection rule lives in Rust
(landings on another level; on another map caves and a building's doors, stairs and
trapdoors) and the connect list is a Rust query (`ReadCall::Connections`); shell settings,
level names and connection kinds are declared once in `atlas-map/src/structure/structure.json`
and exported to the view as `structureVocabulary`; saving a ground map keeps its floors maps
and saving a floors map keeps its parent (`map_store/copy.rs`); in the browser, new or edited
floors are the ground map's unsaved changes (its saved view records them, `structureSave.ts`),
so the creator is prompted to Save. Units in
`atlas-host/tests/structure_maps.rs` (10) and a save-and-reload UI test.

### M9 — Close-out [depends on M0–M8]

Move durable content into the ADR, product contract and generation guide; add the markup
layer (requirement 11) and other deferred items to the backlog; delete this file.

## Deferred proposals (not requirements)

Hexcrawl presentation for world and regional maps; GM-only features (secret doors, traps);
print at 1 inch per 5 ft hex; virtual tabletop export of walls and doors; templates
(product contract 12.4) once structure maps exist.

## Sulion mapping

Root plan `9f50c933-d3c7-4341-b8f9-ca78efa7c2fe`. Phases: M0 `0ac779f6`, M1 `9c51f7b7`,
M2 `c1bba505`, M3 `96dfd830`, M4 `912c3ee4`, M5 `83168f59`, M6 `ef86cd2a`, M7 `3061e1a0`,
M8 `d0374b0f`, M9 `b00e8074`.

Sub-plans: M0 `ef117bfc`, M1 `e5fb308e`, M2 `7f2f5ef9`, M3 `c5327b29`, M4 `1c98af77`,
M5 `5fda49be`, M6 `1efeed9a`, M7 `f589e3e5`, M8 `27bdbe5c`. M9 has no sub-plan.

## Current state

M0 committed (`4645641`). M1 in progress (sub-plan `e5fb308e`): steps 1–7 implemented in the
working tree (hex geometry in `atlas-map/src/hexes.rs`, lattice adapter, contracts, capture,
span and `real-scale` sequence, publication of widths, plots, objects and the hex layer,
frontend presentation, open flow, fixture glen map, unit and UI tests). Next: run the UI
tests on a rebuilt engine, a real-scale generation in the browser on the fixture parent, then
the independent review and commit.

Build environment (this machine): native Rust needs
`PATH=/nix/store/9xdayymn5yh1c98hg12d13d3ir0sxd4x-cmake-4.4.4/bin:$PATH`; the browser engine
also needs `source /home/sulion/repos/vellum-and-vector/.artifacts/emsdk-toolchain/emsdk_env.sh`
before `make wasm-engine`.
