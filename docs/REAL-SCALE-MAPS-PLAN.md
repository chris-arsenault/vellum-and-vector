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

The owner directed on 2026-11-16 to generate the world a check needs. Verification world:
`frontend/.artifacts/verify/` (persistent browser profile with the saved "Verification
world", 4,000 × 3,000 km Draft, seed 42; driver `drive.mjs`), reused by every later check.
No region was kept: the first region attempt took whatever outline the click offered without
checking its size and was stopped; real-scale maps open straight from the world. A driver
region step must check the outline's size first.

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

### M3 — Generated underground [depends on M2]

Scope: underground spaces from rock, fractures, water and magic: passages, chambers,
levels, shafts and entrances located on the surface.
Acceptance: a cave under karst rock reads as dissolved passages; under other rock it reads
as fissures or lava tubes; entrances sit on the ground map.
Evidence: units; visual review.

### M4 — Generated settlement [depends on M2]

Scope: the town map starts as land plus the society features generated there: buildings
where people live, lanes and streets from the ways in, plots and fields, wards. Streets are
a named network; buildings carry use, occupants and an address numbered along their street.
Layout type is an outcome of the settlement's own story (ways, river, seat, walls, era) and
a creator choice.
Acceptance: a generated village and a town on a real map have named streets, addressed
buildings and fields that read as a place.
Evidence: units for network, plotting and numbering; visual review.

### M5 — Real-scale authoring foundation [depends on M1]

Scope: the generated→authored switch; Rust authoring commands over GIS features (create,
reshape, move, delete, attribute edit) with identity, validation and topology through the
shared spatial adapter; snapped junctions; undo and history for real-scale maps; OpenLayers
draw, modify and snap interactions; save through the existing explicit save and LAN
retention. World and regional maps stay read-only.
Acceptance: dragging a river's vertices on a ground map keeps one river feature with its
attributes, and its bridge stays on it; undo restores it; the map reloads with the edit.
Evidence: units for commands and topology; UI tests for draw, modify, undo and save.

### M6 — Land and cave tools [depends on M3, M5]

Scope: river and stream drawing and reshaping with width along the line, hex terrain and
cover painting as hex-layer edits, paths and trails, placing, rotating and scattering clutter
and single objects (one log, or a rubble spread over an outline), cave wall drawing that reads published rock and magic context for
special features (flowstone in karst, seams on Fire veins, rime on Aurora ground).
Acceptance: the owner's examples work: moving a river; a drawn cave wall that shows the
rock it cuts.
Evidence: units; UI tests.

### M7 — Town tools [depends on M4, M5]

Scope: street network builder (classes, junctions, names, renumbered addresses), building
placement on plots with use and occupants, building art as map assets generated through
OpenAI for now, find-by-address.
Acceptance: a creator lays out a new street off a generated one, places an inn, gets its
address and art, and finds it by address.
Evidence: units; UI tests with the art service stubbed.
[DECISION, blocking M7 art] Where art generation runs: LAN backend with a brokered key
only, or browser mode with a key the creator supplies.

### M8 — Structure maps and interior tools [depends on M5]

Scope: structure map created from a building footprint, inheriting frontage, door and
address; levels with stairs and trapdoors as connections; walls, doors, windows, furniture
and decor as shapes over the hex grid; outside context shown (magic prevalence, the magic
features at the site, the parent's place record); connections to caves and other maps.
Acceptance: the inn from M7 opens to a ground floor and cellar the creator draws, the
cellar trapdoor connects to a cave, and the inn shows the local magic prevalence.
Evidence: units; UI tests.

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
