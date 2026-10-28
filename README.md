# Vellum & Vector

A web atlas for creating fictional worlds progressively, from continents and
regions to settlements, caves and interiors. Creators combine procedural
generation, direct editing and reusable templates within one geographically
connected world. The current application runs entirely in the browser.

The [product contract](docs/product-spec.md) defines the behavior. Project
implementation guidance lives in [AGENTS.md](AGENTS.md), with decisions in the
[spatial ADR](docs/adr/0001-spatial-authority.md),
[frontend session ADR](docs/adr/0003-frontend-session.md), which supersedes the
earlier backend and persistence direction, and
[coupling ADR](docs/adr/0004-coupling-through-each-systems-medium.md) for how
society, magic, climate and geology shape one another.

Open product work is tracked in the [backlog](docs/backlog.md). Files named
`docs/*-PLAN.md` are the working copies of plans still open; a closed plan's
file is deleted once its durable content has moved. Durable documentation
describes mechanisms and leaves parameter values to the code, per the
[documentation rules](AGENTS.md#documentation).

## Map workflow

Start with the generation workflow: define the world, then choose land and
materials, water/climate/life, magical influences, and people/places. Each feature
has its switch and operative settings together. Direct navigation preserves the
draft; **Use defaults & review** skips ahead when the defaults suit the map.
Select **Blank world** to create an empty atlas; its context panel offers starting-landscape generation.

World size and latitude are independent. **Latitude frame** places any map as a
northern band (10° to 70°), two hemispheres or a full globe; latitudes use an
equal-area spacing, and a full globe wraps air and ocean east to west. **Rainfall
regime** chooses Dry, Mixed (Earth-like) or Wet worlds; the raw `rainfall`
setting scales moisture supply between those anchors. See
[latitude climate](docs/generation-workflows.md#latitude-climate).

Feature choices change geography; layer visibility changes display. Coupled
operations such as glacial sculpting appear as one choice. Rivers and incision
remain independent. Dependency messages link to their providers and offer explicit
repairs. One shared epoch selector connects physical, ecological and magical
controls, and a human era can bind to a physical epoch so that it runs inside
it. Review shows resolved choices and output layers; execution traits and
causal order sit behind **Execution details**.

Advanced JSON configuration edits the same feature-owned recipe. Applying JSON
regenerates compatibility fields without starting generation. Invalid field text
and unapplied JSON block launch. Effective run inputs remain in the session.

Physical epochs evolve competing plant groups, young and mature trees, seed banks,
soil resources and grazing, browsing, predatory and aquatic animals. Colonization
and migration follow reachable routes; ice, waterlogging, drought, fire and magic
change the communities inherited by later epochs. Configure **Ecological regime**
beside Living ecology for the selected shared epoch, or start with the
wet/dry/cold/recovery cycle preset in **Edit shared history**.
**Biomes and life** exposes the resulting fields and selectable land-biome regions;
the Biomes overlay uses named categories and is visible by default. Organic deposits
and their later burial remain downstream consequences. See the
[ecology model](docs/generation-workflows.md#ecology-and-organic-geology).

The editor's context panel follows the selection. Click a feature to read its
properties, origin and relationships; settlements also show their residents,
livelihoods and retained history. **Inspect** returns to feature selection.
**Atlas → Features** searches existing geography across the world.

Choose **Regions** to explore a smaller geographic subject. Use an existing
boundary, trace a custom outline, or combine a dividing line with rivers, shores
and the current boundary. Each tool explains its map interaction. Keep the
outline as a named region, then select **Refine this region** to add finer
geography. A feature's **Use boundary as region** action enters the same flow.
Point features instead offer selection of a surrounding geographic region.

Regional detail controls terrain spacing. Optional settings hold the detail seed
and inclusion of inherited magical geography, settlements and routes. Refinement
retains completed history and connected parent geography. Choosing a region alone
does not generate detail. Regions can nest to any useful geographic depth, without
fixed ranks or changing into city, site or interior map types. Use the breadcrumbs
and region hierarchy to move between them. A blank map offers starting-landscape
generation separately from regional refinement.

Double-click or press Enter to finish an outline or dividing line. Escape cancels
the unfinished selection. Hold Space to pan, or choose **Pan** for drag navigation.
Manual feature editing, drawing, field painting, templates and undo are deferred;
their implementations remain in the repository for a later design.

Open **Map → Appearance** to switch between the **Surface**, **Topographic** and
**Relief** base maps. Surface, the default, paints natural and magical surface classes under the
hillshade with a legend in the terrain appearance panel; generated magic places draw
with a colour and mark per feature rule, so a hot spring, a vent and an Aurora field
are distinguishable without switching presets. Living landscapes a magic system makes
through its own forcing appear as surface classes and named biome regions: Fire's
ember groves and thaw meadows, Aurora's rime forests and glow-lichen barrens, and the
fog heath and moss forest on a coast facing a Pressure upwelling front.
The compact drawer floats over the map and closes when you finish. **Map → Layers**
holds visible features and overlays. **Add overlay** opens a separate floating
chooser with searchable theme groups. **All fields**
includes diagnostic channels. Checked fields stay in the overlay stack even when
hidden; uncheck them in the chooser or use Remove to take them out of the stack.
Active rows provide visibility, opacity and move-up/down buttons. Expand a row for
its legend, or use its settings icon to edit the palette, scale and range in place.
Biome legends show category names and colors. **Features** shows a compact
hierarchy with counts and color swatches. Collapse groups or filter by name;
show empty layers when preparing to author them.
Each feature layer's **Style** button opens contextual appearance controls. Vector styles
include common color, width and label settings; **Advanced symbol rules** opens
GeoStyler. Fields support color ramps, linear or signed logarithmic scaling, and
display ranges. Missing coverage is transparent, while measured zero remains visible.
The **Adjust terrain appearance** icon beside the base choices controls lighting,
exaggeration and contour interval.
These display settings do not change the geography. Satellite appearance is deferred.

**Map → Views** holds saved compositions. Views retain the geographic subject, base,
field overlays, vector styles and cartographic finishing together. **Save map view** creates a separate
composition; opening it restores its subject and appearance. Use **Save map** to
retain the world and its saved views across reloads.

For a drawn map, choose **Map → Appearance → Drawn map** on the current map
or a region selected through **Regions**. Choose an ink-and-wash or monochrome
treatment and a physical, political, cultural or infrastructure subject. Terrain
illustrations use existing relief, water and woodland geography. The selected
region supplies the map footprint and ancestry; choosing a region or changing
the drawing never generates finer geography.

Political maps distinguish sovereign territory from optional control and claims.
Generated shared borders use a common rounded depiction, and land washes stop at
physical shorelines. Biomes combine distinct washes with tree, grass, reed, dune
or rock motifs; named landmarks and sites have their own symbols. Fault traces
are optional geological detail rather than ordinary atlas linework.
Under **Map → Layers**, **Social distributions** adds independent cultural, language
and religious hatches and population dots. Several distributions can coexist on the same map.
Per-feature label and symbol authoring is deferred with the manual editing tools.

**Map → Sheet** supplies a title, frame, legend, compass and scale.
**Download map PNG** renders the same composition at the chosen image dimensions
entirely in the browser. Export does not include selection highlighting or editor
controls. The raster investigation presentation remains available for numerical
fields and advanced GIS symbol rules.

## Architecture

The application is written in TypeScript. React and OpenLayers provide the editor;
shared TypeScript modules define world data, commands, validation and procedural
generation. The [browser workspace](docs/adr/0003-frontend-session.md) owns local
geography and executes scoped domain operations. Generation runs in a Web Worker
with progress and cancellation. There is no backend, authentication, server
database or MCP.

| Responsibility | Direction                                                                               |
| -------------- | --------------------------------------------------------------------------------------- |
| Editor         | React, OpenLayers, explicit geographic refinement and responsive manual tools           |
| Domain         | Shared TypeScript types, spatial identity, constraints and versioned commands           |
| Generation     | Shared working map, registered processes and causal epoch sequences in a browser worker |

Every area has a geographic parent, footprint and coordinate frame. Features keep
their identity as finer representations are authored. Layer views compose the
same geography. Interior floors retain explicit spatial identity and located
entrance connections.

### Procedural generation

The physical generator ports [The Canonry Game's implementation at
0f62584c](https://github.com/chris-arsenault/the-canonry-game/tree/0f62584c114863ffadeb5e29e021f5fce6b37a61/src/Engine.WorldGen/PhysicalGeneration)
to TypeScript. It retains the native triangular mesh, fixed-point elevations,
material transport, physical processes and multi-epoch order. The atlas adapter
projects completed geography into metric GIS fields and retains authored inputs.

The [generation system](docs/generation-workflows.md) follows Canonry's structure
in TypeScript: configured processes operate on shared GIS/domain working state,
check required facts, apply their changes, validate them and update fact validity.
The common contract covers typed parameters, spatial scope, deterministic seeds
and application/validation for GIS and domain processes.

Map profiles configure which processes run, their order and workflow parameters.
A process can be reused at different levels or several positions in a sequence.
Epoch loops carry altered state forward and bind changing variables such as
temperature, sea level, source activity or population pressure. Physical and
magical nodes interleave at their causal positions. Cultural, political, site
and cave generation use the same structure with their inherited context.

Cancellation discards the worker's unpublished output; initial geography already
delivered remains marked incomplete. If you edit the world during generation, the edits are kept
and the outdated result is rejected. Generate again from the current geography.
Child fields inherit parent geography and retain its boundary band while finer
numerical work occupies the interior.

## Implementation state

Create a world, generate its geography, inspect features and causes, select nested
geographic regions, refine their detail, and compose map layers and sheets.

Choose **Save map** in the editor to store the current world in this browser.
Saving again updates that world's saved copy. **Saved maps**, available in the
editor and on the new-world screen, reopens a save without regenerating it and
replaces that world's current session copy. Saves include numerical geography,
world map views, completed causes, history and undo. Finish generation before
saving its output.

Unsaved changes and independent templates disappear on reload, and closing the
tab stops generation. Saves belong to this browser and site origin; clearing
site data removes them. There is no autosave or generation recovery. Explicit
GIS and template exports download local files.

Physical generation includes continental assemblies and sutures, plate advection,
mountain construction, volcanism, impacts, flexure, continental margins, ocean
currents, atmospheric transport, water-budget lakes, capture drainage, rivers,
sediment, grounded glaciers, coasts and landforms. Reference fixtures compare
the TypeScript numerical output with the original C# implementation. Atlas profile
and unit adaptations are described in the [generation design](docs/generation-workflows.md#physical-port-and-atlas-adapter).
Cultural prevalence, political territory/claims/control and basic settlement,
site and interior layouts remain atlas-specific processes.

`backend/`, `db/`, `infrastructure/backend-prototype/` and their prototype scripts
remain historical source outside the active workspace and build. Do not run
their deployment or migration commands for this frontend.

## Local development

Use the Node version in `.node-version`, the pinned pnpm version in
`frontend/package.json`, and the
[Ahara TypeScript standards](https://github.com/chris-arsenault/ahara-standards/blob/main/standards/typescript.md).
From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Vite serves the frontend on its printed local URL. No environment file, runtime
configuration script, credential or container is required.

```sh
make ci
make build
pnpm --dir frontend exec playwright install chromium
make test-browser
```

The browser tests start and stop their own temporary Vite server. The production
build is `frontend/dist/` and includes its generation worker.

Scenarios that require the deferred manual authoring UI retain their bodies and
assertions with the `@deferred-authoring` tag. The standard Playwright configuration
excludes that tag until editing design resumes. Active inspection, region,
presentation and save journeys use supplied geography rather than drawing test
setup through deferred tools. Remove the Playwright exclusion when manual
authoring resumes so these retained scenarios run again.

Use `BROWSER=firefox pnpm --dir frontend test:browser` to run Firefox. On Linux,
the command uses headed Firefox under Xvfb because headless Firefox cannot create
the WebGL context required for raster layers. Install `xvfb` and `xauth` for local
Linux runs; Ahara's Playwright CI container already includes them. Chromium and
WebKit keep their default headless execution.

Use small deterministic inputs to test algorithm changes first. The normal Vitest
suite exercises actual reconstruction, contour topology, conservative remeshing,
physical processes, configurable magic and publication. Expectations include
analytical solutions, known geometry and budgets, parameter effects and causal
history; they do not require generating a world first. For example:

```sh
pnpm test packages/domain/src/fieldContours.test.ts
pnpm test packages/generation/src/canonry/atlasPublication.test.ts
pnpm test packages/generation/src/canonry/adaptiveGeology.test.ts
pnpm --dir frontend test src/rasterTiles.test.ts
```

When the shared integration check exposes a defect, reproduce it on constructed
cells and call the relevant algorithm directly. A unit test's setup must specify
the coast, ridge, river, ice stock or population it needs. It must not run a
generator, a physical schedule or a seed sweep to find those preconditions.

`pnpm test:generation` is opt-in and generates a shared small Draft world using
the SQLite/GEOS execution adapters and file-backed numerical storage.
Independent checks reuse it for physical history, water and rivers, ecological
publication, all seven magic systems, society, naming, and authored protection.
Reuse that result across assertions; add a shared fixture only when different
preconditions require one. There is no fixed generation quota or time limit on
development work. Fine verification requires separate authorization.

Browser tests import `test` from `frontend/tests/uiTest.ts`. Every journey receives
the small generation fixture automatically, and a real generation worker throws
before it can start. Fixture grids have 256 cells; a form may display larger
world dimensions without generating them. Raster fields are opt-in when needed
for the UI behavior under test. Geometry, magic, ecology and society algorithms
belong in constructed Vitest cases. Worker publication, storage, cancellation
and save/reopen checks also use small supplied geography and arrays.

These boundaries are enforced by the unit test setup, standard ESLint restricted
imports, and `frontend/src/testPolicy.test.ts`. The policy checks shared generation
setup and verifies that direct, aliased and dynamic generator
attempts cannot enter routine tests. Do not bypass the guards or extend timeouts
to accommodate generated setup.

The browser suite checks production rendering, navigation and layer switching
with small supplied worlds. Browser tests own `test-results/`; any
local diagnostic output from node tests belongs in ignored `.artifacts/`.

## Deployment

CI uses Ahara's shared workflow for TypeScript checks, coverage, browser tests
and frontend deployment on `main`. `platform.yml` declares the `typescript` and
`terraform` stacks and has no `migrations` entry. The active Terraform root uses
Ahara's website module to serve `frontend/dist` at
<https://maps.ahara.io> through private S3 and CloudFront, with DNS and TLS.
Ahara's OpenGraph origin serves the HTML shell with literal site metadata and
`/og-image.png`; it has no database query configuration. Geography and authoring
run in the browser. It declares no application API, database or Cognito client.

Generation logs its inputs and elapsed stage messages to the browser console,
including validation, worker transfer and publication. **Generation jobs** shows
the current stage; failed jobs retain that stage and the error.

The project registration in `ahara-infra` provisions the standard deployer role
and repository Actions secrets (`OIDC_ROLE`, `STATE_BUCKET`, `PREFIX`). Deploy
that registration before the initial product push. Later pushes to `main` use
the shared CI workflow to test, build and deploy the frontend automatically.
The earlier combined backend Terraform and its registration remain preserved
under `infrastructure/backend-prototype` as disabled source files. User data
stays in the tab; publishing data or using a hosted presentation service requires
explicit authorization.

## License

Project code is under the [MIT license](LICENSE). Source currently present under
`backend/vendor` retains its [provenance](backend/vendor/README.md).
