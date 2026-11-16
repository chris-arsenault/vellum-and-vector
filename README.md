# Vellum & Vector

A web atlas for creating fictional worlds progressively, from continents and
regions to settlements, caves and interiors. Creators generate independent maps
that share coordinates and completed world history. Manual editing and templates
remain deferred. Generation and storage run together in the browser or on a LAN backend.

The [product contract](docs/product-spec.md) defines the behavior. Project
implementation guidance lives in [AGENTS.md](AGENTS.md), with decisions in the
[spatial ADR](docs/adr/0001-spatial-authority.md),
[execution-host ADR](docs/adr/0015-finished-maps-and-execution-hosts.md) for finished
maps and browser/backend ownership, and
[coupling ADR](docs/adr/0004-coupling-through-each-systems-medium.md) for how
society, magic, climate and geology shape one another. The
[documentation index](docs/README.md) lists every durable document.

Open product work is tracked in the [backlog](docs/backlog.md). Files named
`docs/*-PLAN.md` are the working copies of plans still open; a closed plan's
file is deleted once its durable content has moved. Durable documentation
describes mechanisms and leaves parameter values to the code, per the
[documentation rules](AGENTS.md#documentation).

## Map workflow

Start with the generation workflow: define the world, then choose land and
materials, water/climate/life, magical influences, and people/places. Each feature
has its switch and operative settings together. Direct navigation preserves the
draft; **Review defaults** skips ahead when the defaults suit the map.
Select **Blank world** to create an empty atlas for geographic selection and presentation.
Initial generation belongs to **New world** and never appears in the editor sidebar.

World size and latitude are independent. **Latitude frame** places any map as a
northern band, two hemispheres or a full globe; latitudes use an
equal-area spacing, and a full globe wraps air and ocean east to west. **Rainfall
regime** chooses Dry, Mixed (Earth-like) or Wet worlds; the raw `rainfall`
setting scales moisture supply between those anchors. See
[latitude climate](docs/generation-workflows.md#latitude-climate).

Feature choices change geography; layer visibility changes display. Coupled
operations such as glacial sculpting appear as one choice. Rivers and incision
remain independent. Dependency messages link to their providers and offer explicit
repairs. One shared epoch selector connects physical, ecological and magical
controls. Geology always runs; magic and people are selectable. People live a
loose pass inside every physical epoch and the settled human eras after the
last one. Review shows resolved choices and output layers.

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
the Biomes overlay uses named categories. Every map opens with its feature layers
off; turn layers on under **Layers** or choose a layer preset. Organic deposits
and their later burial remain downstream consequences. See the
[ecology model](docs/generation-workflows.md#ecology-and-organic-geology).

The editor's right sidebar follows this workflow:

| Current task      | Sidebar content                                                                        | Next action                                     |
| ----------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Explore the map   | Map name, area and previously chosen regions                                           | Choose a region or click a feature              |
| Inspect a feature | Feature information, origin and relationships                                          | Use its boundary or choose a surrounding region |
| Inspect a region  | Extent, current detail and child regions                                               | Refine this region or choose a smaller one      |
| Choose an outline | Existing-boundary, custom-outline and dividing-line tools with instructions            | Preview and keep the region, or cancel          |
| Refine a region   | Inherited context, detail setting, optional variation settings and generation feedback | Generate detail or return to the region         |

World setup, manual authoring and library workspaces are outside this sidebar.
Boundary tools appear during outline selection. Refinement opens a modal over the
map with only editable settings. **Saved maps** (browser) or **Server maps** (backend)
also lists the host's generation jobs, including server jobs started on another device.

Click a feature to read its
properties, origin and relationships; settlements also show their residents and
the peoples among them, their country and its use, their realm, their history
through the eras and where their ways lead. **Inspect** returns to feature selection.
**Registry** searches the open map's published geography.

**Inspect place** explains a clicked place: the map colour and its class,
the biome and any magic system behind it, and the mapped features that cover the
place, each with its causes. The stored values of each cell size stay folded
underneath.

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
and region hierarchy to move between them.

Double-click or press Enter to finish an outline or dividing line. Escape cancels
the unfinished selection. Hold Space to pan, or choose **Pan** for drag navigation.
Manual feature editing, drawing, field painting, templates and undo are deferred for
World and Region maps; their implementations remain in the repository for a later design.
Real-scale maps add their own GIS authoring ([ADR 0016](docs/adr/0016-real-scale-maps.md)).

Open **Appearance** to switch between the **Surface**, **Topographic** and
**Relief** base maps. Surface, the default, paints natural and magical surface classes under the
hillshade with a legend in the terrain appearance panel; generated magic places draw
with a colour and mark per feature rule, so a hot spring, a vent and an Aurora field
are distinguishable without switching presets. Living landscapes a magic system makes
through its own forcing appear as surface classes and named biome regions: Fire's
ember groves and thaw meadows, Aurora's rime forests and glow-lichen barrens, and the
fog heath and moss forest on a coast facing a Pressure upwelling front.
The compact drawer floats over the map and closes when you finish. **Layers**
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

**Views** holds saved compositions. Views retain the geographic subject, base,
field overlays, vector styles and cartographic finishing together. **Save map view** creates a separate
composition; opening it restores its subject and appearance. Browser mode uses
**Save map** to retain the world and its views across reloads. Server mode saves automatically.

For a drawn map, choose **Appearance → Drawn map** on the current map
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
Under **Layers**, **Social distributions** adds independent cultural, language
and religious hatches and population dots. Several distributions can coexist on the same map.
Per-feature label and symbol authoring is deferred with the manual editing tools.

**Map → Sheet** supplies a title, frame, legend, compass and scale.
**Download map PNG** renders the same composition at the chosen image dimensions
entirely in the browser. Export does not include selection highlighting or editor
controls. The raster investigation presentation remains available for numerical
fields and advanced GIS symbol rules.

## Architecture

React and OpenLayers provide the TypeScript UI and map views. One Rust engine owns
configuration, generation, naming, publication and storage behavior. It runs as WASM
in a browser worker or natively on the LAN backend, with progress and cancellation.
Both modes publish self-contained GIS maps through the same facade. Viewing,
inspection and export do not read private numerical generation resources.

| Responsibility | Direction                                                                               |
| -------------- | --------------------------------------------------------------------------------------- |
| Editor         | React, OpenLayers, geographic selection, refinement and inspection                      |
| Domain         | Rust spatial identity, constraints and operations; generated TypeScript contracts       |
| Generation     | Shared Rust working state, registered processes and causal sequences on the chosen host |

Every area has a geographic parent, footprint and coordinate frame. Features keep
their identity as finer representations are authored. Layer views compose the
same geography. Interior floors retain explicit spatial identity and located
entrance connections.

### Procedural generation

The physical generator works on a triangular mesh with fixed-point elevations, moves
material between stocks through one ledger, and runs its processes over repeated
epochs. The atlas adapter projects completed geography into metric GIS fields and
retains authored inputs.

In the [generation system](docs/generation-workflows.md), configured processes operate
on private numerical and domain working state: each checks that a selected step wrote what it needs,
applies its changes and validates them. The common contract covers typed parameters,
spatial scope, deterministic seeds and application/validation for GIS and domain
processes.

Map profiles configure which processes run, their order and workflow parameters.
A process can be reused at different levels or several positions in a sequence.
Epoch loops carry altered state forward and bind changing variables such as
temperature, sea level, source activity or population pressure. Physical and
magical nodes interleave at their causal positions. Cultural, political, site
and cave generation use the same structure with their inherited context.

Cancellation discards unpublished output; initial geography already delivered remains
marked incomplete. Regeneration replaces the current revision atomically and rejects
an outdated result. Refinement creates an independent child from captured parent context.
Its coast and elevations may change; later parent changes leave existing children intact.

## Implementation state

Create a world, generate its geography, inspect features and causes, select nested
geographic regions, refine their detail, and compose map layers and sheets.

In browser mode, choose **Save map** to retain the completed map, presentation
settings and navigation. **Saved maps** reopens it without regeneration. On the
server, completed worlds and regions appear automatically in **Server maps**;
presentation and navigation preferences also save automatically. Private captured
inputs remain on the same host for later refinement; viewing reads only the published GIS map.

Browser saves belong to this browser and site origin; clearing site data removes them.
Closing the tab stops browser generation. Server maps are shared by home devices,
and server jobs continue when a browser disconnects or closes progress. Find ongoing
jobs in **Server maps → Server generation jobs** and completed maps in the library.
Completed jobs also offer **Open map**. **Cancel generation** stops a running job.
Server logs include start, stop, elapsed duration and completed epoch durations.
Stopping the backend ends running jobs; there is no generation recovery. GIS and
map-image exports download local files.

Physical generation includes continental assemblies and sutures, plate advection,
mountain construction, volcanism, impacts, flexure, continental margins, ocean
currents, atmospheric transport, water-budget lakes, capture drainage, rivers,
sediment, grounded glaciers, coasts and landforms. Atlas profile
and unit adaptations are described in the [generation design](docs/generation-workflows.md#physical-port-and-atlas-adapter).
Cultural prevalence, political territory/claims/control and settlement layout remain
atlas-specific processes.

The old C# and TypeScript backends, migrations and deployment scripts are removed.
`crates/atlas-map` defines the finished-map contract. `crates/atlas-gis` owns
GEOS/SQLite and PostgreSQL/PostGIS storage and queries, independently of generation.
The TypeScript viewer reads this GIS component through the data-storage facade;
the Rust feature-extraction stage in `atlas-generation/src/publication` reads numerical
generation outputs and publishes GIS layers and rasters to it. `crates/atlas-host` wires the
components and their job lifecycles. See the [subsystem boundary](docs/adr/0015-finished-maps-and-execution-hosts.md).
`packages/map`, `packages/atlas-context` and `packages/transport` expose the frontend
facades. See [LAN installation](docs/lan-backend.md) for packaging and database setup.

## Local development

Use the Node version in `.node-version`, the pinned pnpm version in
`frontend/package.json`, and the
[Ahara TypeScript standards](https://github.com/chris-arsenault/ahara-standards/blob/main/standards/typescript.md).
From the repository root:

```sh
pnpm install --frozen-lockfile
make wasm-engine
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

`crates/atlas-map` owns independent published-map values, `atlas-generation` owns the
generator and publisher, `atlas-names` owns naming, `atlas-gis` owns GIS storage and
queries, and `atlas-host` supplies application composition for both hosts.
`packages/map` and `packages/atlas-context` expose the map and job interfaces. Computational
TypeScript values are generated from Rust with `make contracts`.

Native development uses Rust and CMake. The browser build uses Emscripten 6.0.10,
Rust nightly with `rust-src`, and `wasm-bindgen-cli` matching `Cargo.lock`. Activate
the Emscripten SDK before building. It compiles the Rust standard library with
shared-memory support for WasmFS's OPFS worker, using one wasm32 target.
`make test-rust` runs native explicit-input contracts and compile-fail architecture
examples. Existing Playwright scenarios exercise the production WASM engine using
supplied GIS maps. Run `make browser-fixture` before those local scenarios;
the browser CI matrix is disabled. The standalone wasm-bindgen test runner is not a CI gate: its
Emscripten test binaries currently contain duplicate closure exports and cannot run.
The test sources remain available; the existing browser fixture rules still apply.

Run `make wasm-engine` before direct frontend development or focused TypeScript tests.
It builds the optimized browser engine and its bindings into `packages/engine/dist`.
`make typecheck`, `make test` and the workspace build include that build; CI builds it
before its TypeScript checks. Rebuild after changing the Rust browser boundary.

Both hosts link GEOS and SQLite directly. Browser workers mount OPFS at `/atlas`;
Rust reads and writes its separate map and generation stores through WasmFS.
Browser hosting requires cross-origin isolation headers for the filesystem worker.

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

The normal Vitest suite holds pure-function, data-structure, contract and
publication-rule unit tests; none generates a world. For example:

```sh
pnpm --dir frontend test src/mapRasterSamples.test.ts
cargo test -p atlas-generation --test storage
```

The TypeScript generator, its tests and its development harness are preserved in
[the reference archive](archive/typescript/README.md), outside normal CI and application
imports. The old `test:generation` and `harness` commands are retired from the active
workspace. Reference checks are optional; no archived generator is an application fallback.
Fine workload verification still requires separate authorization.

Browser tests import `test` from `frontend/tests/uiTest.ts`. Every journey receives
the small generation fixture automatically, and a real generation worker throws
before it can start. Fixture grids have 256 cells; a form may display larger
world dimensions without generating them. Raster fields are opt-in when needed
for the UI behavior under test. Geometry, magic, ecology and people algorithms
belong in constructed Vitest cases. Worker publication, storage, cancellation
and save/reopen checks also use small supplied geography and arrays.

These boundaries are enforced by the unit test setup, standard ESLint restricted
imports, and `frontend/src/testPolicy.test.ts`. The policy verifies that direct, aliased and dynamic generator
attempts cannot enter routine tests. Do not bypass the guards or extend timeouts
to accommodate generated setup.

The browser suite checks production rendering, navigation and layer switching
with small supplied worlds. Browser tests own `test-results/`; any
local diagnostic output from node tests belongs in ignored `.artifacts/`.

## Deployment

CI uses Ahara's shared Rust/TypeScript workflow and frontend deployment on `main`.
Its existing Rust hook builds the browser artifact once after cache restoration,
before TypeScript checks. Architecture checks run with the ordinary frontend suite.
There are no separate browser build or browser matrix jobs.
`platform.yml` declares the `rust`, `typescript` and `terraform` stacks and has no
`migrations` entry. The active Terraform root uses
Ahara's website module to serve `frontend/dist` at
<https://maps.ahara.io> through private S3 and CloudFront, with DNS and TLS.
Ahara's OpenGraph origin serves the HTML shell with literal site metadata and
`/og-image.png`; it has no database query configuration. This public frontend selects
pure browser execution. It declares no application API, database or Cognito client.

Generation logs its inputs and elapsed stage messages to the browser console,
including validation, worker transfer and publication. **Generation jobs** shows
the current stage; failed jobs retain that stage and the error.

The project registration in `ahara-infra` provisions the standard deployer role
and repository Actions secrets (`OIDC_ROLE`, `STATE_BUCKET`, `PREFIX`). Deploy
that registration before the initial product push. Later pushes to `main` use
the shared CI workflow to test, build and deploy the frontend automatically.
The retired backend Terraform is removed. The replacement backend package uses the same
frontend with the native service and the TrueNAS database. Its CI/CD and Komodo setup is
described in the [LAN guide](docs/lan-backend.md). Open <http://192.168.66.3:4123/> on the
home LAN to use backend storage and computation across devices.
It has no public route. Publishing user data or using a hosted
presentation service requires explicit authorization.

## License

Project code is under the [MIT license](LICENSE), except the Rust naming port in
[`crates/atlas-names`](crates/atlas-names/LICENSE) and its archived TypeScript source,
which carry the PolyForm Noncommercial 1.0.0 license.
