# GIS presentation

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
