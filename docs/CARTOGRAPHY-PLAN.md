# GIS presentation

Current work: [Compact layer controls — 2026-10-20](#compact-layer-controls--2026-10-20).
The implementation below shipped, but its controls and navigation performance
did not meet the user's usability expectations. Its completed checks establish
functional wiring, not acceptance of the map experience. Preserve that history;
the repair contract below replaces its UI and performance implementation choices.

## Original implementation — 2026-10-19

User direction, 2026-10-19: implement the conversation's packaged layer controls,
vector styling, topographic and relief bases, and independently styled continuous
field overlays. Satellite appearance is deferred. Local implementation and checks
are authorized; publication is not requested.

## Boundaries and choices

Keep the browser session and shared geography authoritative, as in ADR 0003.
Rendering styles never regenerate or modify physical fields. Retain drawing,
selection, snapping, authored protection, presets and session map views.

Use ol-ext LayerSwitcher for actual OpenLayers layers and GeoStyler for vector
symbols. Use DataTile numerical tiles with WebGLTile style expressions for
raster presentation. This is an implementation choice supporting interactive
palettes and shading without rebuilding colored image tiles. Keep the existing
field interpolator and fictional metric projection. No new service or storage.

Sources: `frontend/src/mapEngine.ts`, `mapInteractions.ts`, `rasterTiles.ts`,
`LayerPanel.tsx`, `useScene.ts`; product specification sections 7 and 13.
Assumption to check: DataTile/WebGLTile handles the existing field composition,
water coverage and arbitrary footprints without seams or missing-data artifacts.

## M0 — GIS presentation

Sulion root: `155f7894-8b72-43a7-84cc-9392bdb75078`.
Milestone: `b8d29728-5335-4489-babc-af950da9b2b1`.
Execution branch: `62acada2-fd5e-4268-a947-c7569fb2daea`.
Steps: `e860941f-c9d2-406d-b637-11d5ae8bd79c` (vectors),
`dcf69ee3-adf8-4863-817a-b646861d2493` (rasters),
`ef255f0c-5098-42bf-85a3-63182fc899bb` (integration).

Acceptance: creators manage actual vector layers through packaged controls,
edit vector symbols, switch topo/relief, combine multiple continuous overlays,
read their ranges/units and restore complete session views. Geometry editing
and geographic identity continue to work. Satellite remains absent.

Execution:

1. Separate logical vectors into OpenLayers layers, install ol-ext and GeoStyler,
   preserve interaction targets, and connect styles to session view state.
2. Sample numeric tiles and add topo/relief styles, independent field overlays,
   palettes, ranges, logarithmic scaling, missing-data masks and legends.
3. Exercise actual browser rendering and controls, focused numerical/interaction
   checks, typecheck, lint and build. Update usage documentation.

Shared checks establish the integrated milestone; step implementation alone is
not completion. Use existing browser fixtures for UI checks and numerical
fixtures for tile data, rather than another full-world generation run.

Current state: complete locally. Actual vector layers, packaged controls, symbol
editing, numeric raster rendering, complete session views and usage docs are in
place. The 183 Vitest checks pass. All 12 browser journeys passed across the suite
and focused reruns, including rendered base/overlay changes, invalid range repair,
opacity/order restoration, vector symbol edits and existing geographic authoring.
Typechecks, lint and build pass. Lint retains existing warnings in magicSystems
and TemplateDrawing; build reports large chunks. GeoStyler loads on demand.
Test-owned servers were stopped. No publication, commit or push was requested.

The control's hidden checkbox styling required a native-input CSS adaptation for
visible, accessible controls. OpenLayers expressions do not include logarithms;
numeric tiles therefore carry a signed-log band alongside the original values.
Terrain tiles carry their sample spacing for hillshade at varying tile resolutions.
The packaged opacity readout needs synchronization for keyboard changes. Separate
base, field and feature control lists preserve their rendering boundaries while
allowing ordering within overlays and features. Numerical sources retain the
existing coarse-to-fine composition and authored patch evaluator. Satellite remains
deferred; no service, persistence or generation algorithm was added.

## Map experience repair — 2026-10-20

### Outcome, authority and boundaries

Creators navigate and read a generated world with the responsiveness and compact
controls expected of a modern web map. Choosing a base map, adding an overlay,
reading its legend and adjusting its appearance must not require navigating a
giant list of fields and feature layers.

User requirements: the 2026-10-20 feedback rejects the existing list, reports
2–3 second redraws on default Draft pan/zoom, and identifies AllTrails and usable
web maps as the experience benchmark. Earlier direction requires topo/relief,
independent continuous overlays and feature styling; satellite remains deferred.
[Product specification](product-spec.md) sections 7.2 and 13 require composed
views, scale-aware presentation, stable feature identity and immediate authoring
feedback. [ADR 0003](adr/0003-frontend-session.md) keeps the product browser-only.

The subsequent user request authorizes execution of all milestones locally.
Commit, push and deployment of this repair are not requested. The water/geology
repair landed as `b455ba5`; its physical water coverage and geological semantics
are part of this implementation's baseline.

Preserve manual editing, selection, snapping, authored protection, undo, custom
layers, view presets and session compositions. Preserve access to every useful
field, including population and magical fields when those data exist. This repair
does not add missing generators, alter physical history, introduce persistence,
add services, or generate geography during navigation.

### Current evidence and reuse

The deployed bundle inspected on 2026-10-20 was `index-D0rXMVvU.js`. A real default
4000 × 3000 km Draft world, seed 104729, was generated in Chromium and exercised
through three zoom gestures. Main-thread traces recorded repeated tasks around
140–200 ms and individual tasks of 871 and 894 ms. These are blocking-task
measurements, not end-to-end navigation latency. The diagnostic included fixed
waits and screenshots; their elapsed times are not performance results. Hardware,
GPU mode, settled-render timing and repeatability still need a controlled baseline.

Source review identifies concrete work to attribute, rather than a complete root
cause: `numericTiles.ts` synchronously samples 258 × 258 pixels per requested tile;
`rasterLayers.ts` creates separate numeric sources for topo and relief;
`atlasReads.ts` composes and intersects all features in the located space for a
viewport read. OpenLayers already provides caching and source spatial indices;
the repair should feed and reuse those facilities instead of bypassing them.

| Existing boundary                                                          | Reuse and intended change                                                                                                           |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `LayerPanel.tsx`, `LayerBrowser.tsx`, `RasterPanel.tsx`, `cartography.css` | Replace the list with compact controls and contextual appearance editing.                                                           |
| `mapEngine.ts`, `mapInteractions.ts`, `MapCanvas.tsx`                      | Retain OpenLayers, projection and interaction identity; avoid redundant map/source updates.                                         |
| `numericTiles.ts`, `terrainWater.ts`, `rasterLayers.ts`, `rasterStyles.ts` | Retain shared field evaluation and numerical WebGL styles; prepare tiles away from input handling and share terrain samples.        |
| `atlasReads.ts`, `useScene.ts`, domain composition and session publication | Index composed features by located space and revision; update affected representations without recomposing the world on navigation. |
| `vectorStyles.ts`, `SymbolEditor.tsx`, session view schemas                | Preserve symbols and saved compositions; improve cartographic hierarchy and expose advanced styling contextually.                   |
| Existing browser journeys and ignored generation artifacts                 | Reuse interaction checks and completed real geography; add measurements for the actual navigation workload.                         |

### Recommended design and revisable choices

Keep OpenLayers. Replace ol-ext LayerSwitcher as the product layer interface;
remove its dependency and CSS if no remaining consumer needs them. Use the
existing React/UI components for the small product surface instead of selecting
another generic GIS layer-tree package. Keep GeoStyler available as a lazy advanced
feature editor if it remains useful; ordinary appearance changes should not
require opening its full rule editor. These are implementation recommendations,
not new user requirements or reasons to retain an unsuitable package.

The map keeps most of the screen. A Layers button opens a compact drawer:

- Topographic and Relief are visual choices with previews and a clear selected state.
- Active overlays show a name, useful legend, visibility and access to opacity/style.
- Add overlay opens a searchable, thematic catalogue with readable names, units and
  availability. Advanced diagnostic channels stay discoverable without dominating
  the default screen. There is no arbitrary cap on simultaneous overlays.
- Feature visibility is grouped by meaningful themes. Expand a theme when needed;
  do not expose every empty layer by default. Existing custom layers remain accessible.
- Selecting a layer reveals its appearance controls. Keep advanced rules separate
  from common color, width, opacity and range adjustments. Provide keyboard and
  touch access, including reorder controls that do not require dragging.

Cartography is part of this work: terrain and water colors, contour density,
river/road hierarchy, readable labels and restrained overlays should produce a
legible map at world, regional and close scales. Style changes must use existing
geography. Coordinate with the water/geology repair rather than masking physical
defects with display-only geometry.

Recommended raster path: an in-memory render worker prepares requested numeric
tiles from the shared evaluator; OpenLayers consumes asynchronous DataTile results
and retains its native tile/GPU caches. Install field data once per changed field,
not once per tile; do not detach authoritative session buffers. Topo and relief
share terrain samples and change presentation without resampling geography.
Cache by field revision, requested bands and tile coordinates/resolution, excluding
style-only parameters. Keep existing imagery visible while newly requested detail
arrives. Ignore obsolete replies after edits or world changes and dispose unused
sources/workers. Start with ordinary worker lifecycle and OpenLayers caching; add
overview preparation or further cache machinery only when measurements justify it.

Recommended vector path: maintain composed representations in the appropriate
OpenLayers VectorSource, using its spatial index for viewport candidates. Cache
composition by the relevant world/area/feature dependencies; use exact geometry
tests only when required after extent filtering. Preserve OL feature instances
and stable IDs across navigation, style changes and unrelated edits. Invalidate
affected geometry after edits, refinement, regeneration and undo. Where existing
commands lack affected extents, invalidate the changed source rather than inventing
a general change-tracking subsystem.

Assumptions for M0: the identified CPU work is material to the reported lag;
OpenLayers remains suitable; worker transfer and preparation costs are affordable.
The implementer resolves these through profiling and a small proving case before
expanding the design. Reorder performance work based on measured contribution.
No map-engine migration is presumed; evidence that one is necessary requires a
separate recommendation before expanding scope.

### Milestones and acceptance

The execution record below tracks the completed milestones and the integrated
checks. The numerical targets remain measurement goals, including recorded misses.

**M0 — Establish performance baseline and map design**

Scope: reconcile current source and concurrent edits; capture a replayable default
Draft world and a representative refined area using existing ignored test artifacts;
attribute sampling, geometry composition, React/control updates, tile uploads and
rendering costs. Specify the drawer states and cartographic treatment against real
geography, including a narrow viewport. Local previews are sufficient; do not
publish project data to a hosted presentation service.

Acceptance: reproducible pan, zoom, revisit, base-switch and overlay-toggle cases
separate first visual response from final visible-tile completion. Record browser,
viewport, device pixel ratio, GPU mode, scene size, cache state, sample count,
p50/p95, long tasks and memory/transfer costs. Include an initial settled scene,
new extents and revisits so startup work is not confused with navigation. A
concrete screen design replaces the list and retains all required operations.

Proposed optimization goals: first visual feedback within about 100 ms; cached
navigation settling within 250 ms at p95; newly exposed Draft detail within
500 ms at p95 on the documented reference environment. These are agent-proposed
measurement goals, not an approved SLA, runtime cap or hard CI gate. Report misses
and environmental variability; do not reduce geography, hide layers, or change
thresholds solely to declare success.

**M1 — Replace the layer-list experience** [depends on M0]

Scope: implement the visual base picker, active overlays, thematic catalogue,
contextual styles, legends and cartographic hierarchy. Integrate existing presets
and session views. Remove obsolete list controls after their consumers migrate.

Acceptance: a creator can choose a base, find/add two continuous overlays, read
their units/ranges, reorder them, change a feature symbol, and restore a saved
composition without scrolling through all channels or empty layers. The map stays
usable with the drawer open and on a narrow screen. Compare actual world/regional
screens for legibility, label collisions and visual hierarchy; UI assertions alone
do not establish the result. Preserve feature and field accessibility.

**M2 — Prepare and reuse raster data efficiently** [depends on M0]

Scope: implement the measured raster-path repair, async tile delivery and shared
terrain sources. Keep numerical coverage, missing data, ocean/lakes, authored
patches, signed-log overlays and coarse-to-fine composition correct.

Acceptance: costly sampling no longer blocks pointer handling; changing topo to
relief or a palette reuses field samples; revisiting tiles reuses cached results.
Local edits, undo and regeneration replace affected data without stale tiles or
global resampling for a style change. Verify seams, masks and geography against
small analytical cases and the real scene. Measure fresh extent, revisit,
multi-overlay and high-DPI cases, including worker transfer and memory costs.

**M3 — Index and update visible features incrementally** [depends on M0]

Scope: use source indices, cached composition and incremental map updates rather
than rebuilding scene geometry on every viewport change. Preserve located spaces,
representation dependencies and scale-dependent presentation.

Acceptance: pan/zoom does not recompose every world feature; unrelated edits retain
existing map features and selection. Refined geometry, crossings, labels, snapping,
hit detection, modifications and undo remain correct. Profile world and refined
views; verify edge-of-viewport queries and dependency invalidation explicitly.

**M4 — Verify the integrated map experience** [depends on M1, M2, M3]

Scope: repeat M0 cases on the integrated build and review appearance at the same
extents. Exercise default Draft, a refined area and several overlays; use a larger
existing scene to check scaling without making another full generation the normal
feedback loop. Check Chromium, Firefox and WebKit, retaining Firefox's working
Xvfb test setup.

Acceptance: report before/after input feedback, settled-render latency, long tasks
and memory with their limits. Confirm ordinary map navigation stays responsive
while data loads, and rendering remains aligned with authored/generated geography.
Existing draw/move/reshape/sculpt, selection/snapping, presets, saved views and
undo journeys pass. Typecheck, lint and build pass. Functional tests and visual
review both support completion; a screenshot hash change is insufficient. Keep
raw artifacts ignored and findings in this plan/chat, without a separate report.
Commit, push and hosted verification occur only when authorized for this repair.

### Tracking and next action

Sulion root: `d548a960-2009-4742-aefd-caec91b8bdb6`.

| Milestone | Sulion phase ID                        | State     |
| --------- | -------------------------------------- | --------- |
| M0        | `0f328621-1f01-421e-ac11-1c2794d02a61` | completed |
| M1        | `4c5b11cc-682e-48d3-ae79-58e1c136acf4` | completed |
| M2        | `ead47755-ca89-415a-819c-5020cddf7d52` | completed |
| M3        | `c49c5a31-8066-4bbb-a799-65e741ca5693` | completed |
| M4        | `143c8b41-6983-4cff-b502-f1159419f1bf` | completed |

All five milestones have been executed locally. The UI and rendering changes are
implemented and checked; the M4 record retains the missed performance goals and
unverified hardware-GPU behavior. The subsequent user request authorizes commit
and push of this repair. Hosted deployment remains unverified.

### M0 execution

Expansion: `ff61b9e7-fc7c-4902-9634-11aab1d3405e`.

1. Measure real scene navigation (`912c6c21-c2cd-4395-b6f2-737a9c004161`).
   Add an opt-in Playwright performance page using the actual map engine, raster
   sources and saved generated geography. Measure render events, cold and cached
   navigation, long tasks and memory. Keep test pages outside normal builds.
2. Resolve map design and repair order (`7b824e72-5c9b-490b-ae03-8dc97ede0758`).
   Record baseline and drawer states here. Use existing generated Draft and Standard
   artifacts; preserve the landed water and fault repairs. M1 follows with a
   compact drawer over the map, leaving the map visible while controls are open.

M0 results: the opt-in performance page replays the existing fixed Draft artifact
(149 × 112 numerical samples, 2170 features, all published field channels).
Chromium, 1500 × 1000, DPR 1, ANGLE Vulkan SwiftShader: cold subextents settled
in 2969–5104 ms; cached subextents in 741–783 ms. First render was 501–687 ms.
Base switch took 810 ms and adding two overlays 467 ms. Eight navigation samples
are a baseline, not a robust percentile population; M4 increases repeated samples.
Raw observations and a map image are in ignored `.artifacts/navigation`.

Concrete design: the map occupies the former atlas column. Atlas and Layers
buttons in its header open one 340 px drawer, with a close button and independent
scrolling. Layers opens with two preview cards (Topo/Relief), followed by active
overlay cards. Each card has its own legend, visibility, opacity and accessible
move-up/down buttons; its appearance button reveals only that layer's settings.
Add overlay opens a search and theme filter, with diagnostics under Advanced.
Feature themes are collapsed sections; only layers with data appear normally,
with a Show empty layers option preserving access to authoring/custom layers.
The selected feature's style offers common color/width/labels plus Advanced rules.
On narrow screens the drawer becomes a bounded bottom sheet and retains a visible
map above it. Existing Atlas and authoring operations remain accessible.

### M1 execution

Expansion: `a9be8f44-c1c2-4f2d-855f-d9338faa2486`.

1. Build compact controls (`321f583b-ea3a-4768-9abe-954593095a07`): move Atlas/Layers
   into a dismissible map drawer; implement preview base choices, active overlay
   cards and an explicitly opened catalogue. Preserve all field availability.
2. Integrate styles (`45e471f0-3699-4a39-8f24-d2f561eb7007`): thematic feature
   visibility, common symbol controls and advanced GeoStyler, contextual raster
   controls and complete views. Verify existing GIS journeys against the new UI,
   including keyboard reorder, multiple legends, style edits and narrow layout.

M1 results: the exposed ol-ext controls and dependency are removed. Desktop and
600 px layout checks pass; base switching, two-field composition, native opacity,
button reorder, session restoration, advanced symbols and magic-history fields
pass in Chromium. Desktop screenshot reviewed locally; the drawer uses light
controls over a larger map and collapses features by theme. Terrain colors and
water/route contrasts are softened, with decluttering enabled for feature labels.
Whole-suite and real-world visual review remain part of M4.

### M2 execution

Use one lazily started render worker per map, shared across numeric sources.
Register each immutable grid once, transfer tile results, and release obsolete
registrations when sources leave the map. OpenLayers owns tile/GPU caching.
Topo and relief use the same terrain layer/source and only change style variables.
Only selected overlay sources are materialized; the catalogue retains all channels.
Verify numerical values/masks, stale-result rejection, shared registration and
source reuse; repeat the real navigation case before judging performance.

Expansion: `3742c5fd-3498-4332-b967-64c1ff2deee7`; steps
`fd98225e-2d24-49b1-b5c6-bca85ecd59a4` and `81af7ac2-780e-4b7e-85cf-e7c9a529cdec`.
Results: 15 focused numerical/lifecycle checks and all three layer browser journeys
pass with actual worker delivery. Base switching dropped from 810 to 117 ms in
the reference case. First navigation frames remain 436–477 ms and cold detail
3416–4853 ms; this is not sufficient performance. Continue with M3 and reprofile
the integrated result before choosing any further raster preparation machinery.

### M3 execution

The UI will load composed geography once per area/world revision and let existing
OpenLayers VectorSource indices choose visible geometry during navigation. Cache
composition and area membership for unchanged features across revisions, including
following-relationship dependencies and area geometry context. Keep bounded scene
reads indexed for analysis callers. Preserve OL feature instances; avoid setting
identical styles/properties or rebuilding area boundaries on viewport events.
Verify following/detail invalidation, located spaces, candidate query edges, edits
and undo, then repeat the same real navigation measurements.

Expansion: `e746d866-65d9-4fe4-90ee-17ac30e80d09`; steps
`cee45e5e-ddf3-4804-848a-19bc167e25f5` and `698c019a-9a7e-4229-ab9f-4ef042434894`.
Results: dependency/area/floor/undo checks pass. All five cartographic browser
journeys pass across the suite and focused rerun; the wider viewport required
moving one hard-coded test vertex inside the mapped world, retaining validation.
Reference first frames are 30–40 ms and cached views 143–312 ms. Cold final detail
remains 2703–4235 ms. CPU sampling no longer identifies feature-composition work
in navigation; the next profile is dominated by native/program time and tile
upload, with repeated terrain shader work a concrete optimization candidate.

### M4 execution

1. Repeat and attribute integrated measurements, including first frame vs settled
   detail. Optimize the demonstrated cold-render work and record remaining limits.
   The shader repeatedly fetches neighboring elevations to calculate gradients;
   evaluate preparing those same finite differences with worker tile data while
   retaining the original field samples, masks, resolution and adjustable lighting.
2. Review real Draft/Standard and regional views, multi-overlay and high-DPI cases;
   verify viewport responsiveness and memory/transfer limits with more samples.
3. Run complete domain/frontend checks and Chromium/Firefox/WebKit journeys,
   reconcile usage and this working record, and close only after required behavior
   is established. No commit, push or hosted publication is requested.

Expansion: `7e85a06c-6d35-40bd-b499-acfa0b4b1a0f`; steps
`c0351f03-e352-49ab-babb-b525cad9e4b6`, `8a3752b6-fc5c-449b-bb56-e848df04cb31`
and `73f0a8c2-8575-4efc-947d-2986ed3e4b61`.

The shader now consumes worker-prepared masked central differences rather than
repeatedly fetching neighboring heights per fragment; source heights and physical
coverage remain unchanged. Analytical slope and raw-band equivalence checks pass.
The original six terrain bands are retained alongside two gradients; lighting and
exaggeration remain style-only changes. Real map review also reduced the visual
weight of geological outlines, retaining the layer and its geometry. Common
feature appearance now includes native draw-order selection and geometry-specific
width/radius controls, with advanced rules still optional.

Repeated reference measurements (32 Draft navigation cases, including 28 cached
revisits): first frames 50–61 ms; cached settling 103–169 ms; base switch 79 ms;
two overlays 440 ms. Cold subextents still take 2155–3866 ms. The Standard scene
(297 × 223 samples, 2636 features) gives 52–62 ms first frames and 108–162 ms
cached settling, with cold subextents 3544–7156 ms. The first cold case includes
new shader/tile preparation. These are Chromium SwiftShader observations, not
desktop-GPU guarantees; the proposed 500 ms cold-detail goal remains missed.
Native coarse imagery stays visible and the interaction thread no longer performs
sampling or full-world scene composition during navigation. Do not describe final
detail as instantaneous or hide this limitation when handing off.

Nearest-rank percentiles for the documented DPR 1 Draft comparison:

| Measurement                     | Before p50 / p95 | After p50 / p95 | Samples before / after |
| ------------------------------- | ---------------- | --------------- | ---------------------- |
| First navigation frame          | 525 / 687 ms     | 53 / 60 ms      | 8 / 32                 |
| Cached settling                 | 769 / 783 ms     | 149 / 165 ms    | 4 / 28                 |
| Recorded main-thread long tasks | 379 / 850 ms     | 144 / 182 ms    | 37 / 76                |

Long-task populations cover the complete measured navigation/base/overlay sequence
and are not per-gesture latency. The three cold extents in each run are too few
for a useful tail-percentile claim; retain their ranges above instead.

Each scene registered its grid once: approximately 17.1 MB of Draft channel data
and 67.8 MB for Standard; synchronous structured-clone sends took 24 and 73 ms.
Main-heap samples include JSON replay-fixture overhead and exclude worker/GPU
allocations, so they do not establish production memory usage or a memory ceiling.
Raw measurements, profiles and editor screenshots stay in ignored artifacts.
The performance page changes view coordinates directly and excludes deliberate
wheel debounce/animation; browser journeys exercise the actual pointer controls.

DPR 2 exposes a larger software-rendering limit: eight navigation cases give
112–137 ms first frames; four cached revisits settle in 277–528 ms, and three
cold subextents take 10.0–22.6 seconds. Base switching takes 247 ms and adding two
overlays 1988 ms. A separately timed 258 × 258 terrain tile takes 55 ms to sample
and 8 ms to prepare gradients. The CPU profile is dominated by native/program,
tile upload and canvas compositing, rather than scene composition. These results
miss both cached and cold-detail goals at high DPI. Do not treat the software-GPU
limits as proof of hardware-GPU behavior or reduce physical detail to conceal them.
High-DPI main-heap sampling reached 1.2 GB with the replay fixture; worker/GPU
allocations remain unmeasured. Production memory and hardware acceleration need
separate observation before making performance guarantees.

Actual inherited Draft generation and publication of a 200 × 200 km region also
passed. With temperature and flow overlays present, navigation first frames take
17–24 ms and cached views settle in 305–329 ms. Initial regional rendering takes
10.0 seconds, and the first uncached closer view takes 23.7 seconds. These are
additional target misses; worker-side adaptive sampling and multi-layer cold
rendering have not been separately attributed in this regional case. The replay
fixture initially omitted its field's located-space ID, preventing inheritance;
correcting that metadata resolved the check without changing generation code.
That first region was predominantly ocean; a separate coast/river region is used
for the final geographic visual review.

The coast/river region also passed inherited generation and publication. Its
first navigation frames take 22–31 ms; six cached revisits settle in 310–323 ms.
Initial rendering takes 10.5 seconds, with two cold closer views taking 22.4 and
2.5 seconds. The local topographic view was reviewed after removing overlays;
the parent shoreline, river geometry and new regional terrain remain visible.

Eight actual wheel gestures with temperature and flow overlays give 143–167 ms
first frames and 238–341 ms settled renders, including native wheel debounce and
animation. This also misses the proposed 100 ms feedback goal; it must not be
conflated with the 53/60 ms direct-view-change measurements above.

Final source review found another cache invalidation issue: `cloneSnapshot`
creates new generated-grid wrappers while retaining their immutable numerical
arrays. Comparing only wrapper identity would reload terrain after unrelated
session commands. Repair branch `3bff59a8-3d15-4041-b8be-ad94f9e26a04` compares
sample inputs and relevant metadata instead. An actual snapshot-cloning check
establishes source reuse; changed arrays still replace the source. Overlays with
copied numerical patches retain conservative invalidation. No domain cloning or
generation semantics changed.

Final checks: all 226 tests in 45 files pass. The 13 browser journeys pass in
Chromium and Firefox across the complete suites and focused repair reruns;
WebKit passes all 13 in one run. After the final cache correction, all eight
affected Chromium editing/layer journeys pass again. Checks cover draw, move,
reshape, sculpt, located interiors, snapping, undo, custom layers, presets,
session views, feature symbols, field ranges, legends and narrow-screen controls.
Typecheck, lint, normal production build and diff checks pass. Existing lint
warnings remain in `magicSystems.ts` and `TemplateDrawing.tsx`; build warnings
remain for large chunks, including lazy GeoStyler. Normal builds exclude the
performance page. Test-owned servers and browser containers are stopped.

OpenLayers remains the GIS renderer and interaction engine. Worker preparation,
shared native tile sources and indexed feature composition improve the measured
navigation path without reducing geography. Cold-detail and high-DPI software
rendering still miss the proposed goals; hardware-accelerated performance remains
unverified. These limits remain open performance work, rather than functional
test failures or reasons to claim the intended experience is guaranteed.

## Compact layer controls — 2026-10-20

User feedback identified selector density as the next problem: oversized base
cards, form spacing and counts on separate lines left only a few visible rows.
Sulion plan: `34efb232-8c8e-414f-af14-14dc17f39a23`.

Use the existing floating panel with a compact header and preset/base toolbar.
Feature layers form an initially expanded native disclosure hierarchy, with
24 px desktop rows, inline counts, color swatches and contextual styling actions.
Search reveals matching groups. Empty layers remain optional. Scoped CSS resets
prevent general form/detail styles from adding margins or block-level counts;
the rest of the editor retains its existing typography and controls. Touch input
gets larger rows. Overlay search, legends and opacity/order controls are denser.

The real saved Draft scene (2170 features) was reviewed at a 1920 × 1080 CSS
viewport with DPR 2, producing 3840 × 2160 output. All 18 built-in layer rows fit
inside the panel without scrolling, including empty layers and expanded groups.
This is a layout observation, not a runtime cap or a restriction on custom layers.
Local screenshots remain in ignored navigation artifacts. No rendering,
generation, geographic identity or storage changes are part of this follow-up.

The 13 Chromium browser journeys pass. The three layer-control journeys pass
again in Chromium, Firefox and WebKit after the final compact terrain-button
change, covering terrain settings, narrow layout, overlays, keyboard opacity,
ordering, advanced symbols and session-view restoration. Typecheck, lint,
production build, formatting and diff checks pass with the existing warnings.
Run `ATLAS_PERFORMANCE=1 ATLAS_CONTROLS=1 ATLAS_DPR=2 pnpm --dir frontend test:browser`
to repeat the real-scene density review without repeating navigation measurements.
Test-owned servers and containers are stopped. The subsequent user request
authorizes commit and push of this follow-up; hosted deployment remains unverified.
