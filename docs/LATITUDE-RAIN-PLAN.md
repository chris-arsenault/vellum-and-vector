# Configurable latitude frames and tropical rainfall

Planning requested by the user on 2026-10-21 ("create a plan to address the
rain gaps as you mentioned and include making sure latitude is appropriately
configurable"). Only planning is authorized; implementation, commit and push
need a later request. Follows [CLIMATE-PLAN.md](CLIMATE-PLAN.md) and the
uncommitted heat-artifact fixes made after commit `3b5f87f`. Sulion root: see
[Sulion mapping](#sulion-mapping).

## Outcome

Worlds of any size can take any of several latitude frames, among them a
northern band (10° to 70°), two hemispheres (−70° to 70°) and a full globe
(−90° to 90°). Each frame gets a correctly placed equator, belts and poles.
Their tropics are wet, their subtropics dry and their mid-latitude west coasts
moist, at magnitudes close to Earth's. The biomes follow: rainforest near the
equator, savanna on the tropical margins, deserts around 20–30°, and forest in
the storm tracks. The rainfall regime stays configurable. Dry worlds stay arid,
Mixed is Earth-like, and Wet is wetter than Earth, each by its own calibrated
outcome.

## Requirements and decisions

User requirements (2026-10-21):

1. Support several world configurations, "-70-70, full globe, the current 10-70
   etc", at various world sizes.
2. "the latitude should not be a direct mapping to km/size". The user chose a
   **non-linear projection**: latitude is derived from north distance through
   a projection rather than linearly.
3. A full-globe world **wraps east–west for climate only**: air and ocean
   transport cross the east/west edges; terrain, plates, rivers and the editor
   stay planar.
4. Address the rain gaps: a wider equatorial rain belt, Earth-like rainfall
   magnitudes and a stronger subtropical dry belt, with rivers and erosion
   checked against the wetter climate.
5. Tests: unit and integration tests for numerical and process items, no long
   browser tests, and no 20-minute runs during development. The Standard/Fine
   scale suite runs only on request.
6. Wetness stays configurable through the existing arid / normal / wet options.
   "we should make the wet wetter but we should not transform the arid into a
   semi wet world. the system should be appropriately parameterized." Each
   regime is calibrated to its own absolute outcome. Raising normal to Earth-like
   rain must not raise arid with it.

Agreed boundaries that stay fixed:

- The planar engineering CRS (ADR 0001): projection affects only the latitude a
  map position stands for, never geometry, distances or display.
- Edge latitudes as generation settings owned by `physical.climate`, initial-only
  and inherited by regions (CLIMATE-PLAN M0).
- Canonry step order and feature ownership; deterministic fixed-point output;
  browser-memory sessions.

Agent-derived choices (revisable on evidence):

- **Projections:** `equal-area` (sin latitude linear in north distance, i.e. a
  Lambert cylindrical frame) and `equirectangular` (today's linear frame).
  Mercator is excluded: it is unbounded at the poles.
- **Default projection:** equal-area for new worlds. On a full globe it keeps
  polar caps from taking a third of the map. Existing worlds keep their generated
  results; a regenerated world uses the setting it is given.
- **Frame presets:** "Northern band", "Two hemispheres", "Full globe" and
  "Custom" in the world/climate setup. A preset only fills the edge, projection
  and wrap settings.
- **Rainfall regimes:** one table defines the Dry, Mixed and Wet anchors of the
  continuous `rainfall` setting. The cartographic choice and the atlas presets
  read it; today the cartographic choice and the "Arid world" preset each
  hard-code 0.2. Mixed means Earth-like. An atlas "Wet world" preset is added
  beside "Arid world".
- **Regime mechanism:** the setting scales moisture supply (ocean column humidity
  and the precipitation baseline), not rain output. Rain then stays tied to how
  much water the air carries, and the belt contrast comes from rainout. The
  anchor values are fitted to the regime targets in M4, not chosen in advance.
- **Wrap setting:** a boolean, `wrapLongitude`, defaulting to on for the full
  globe preset and off otherwise. It applies only when the map spans the world's
  full width. A region of a wrapping world takes the world's edge climate as its
  inflow boundary instead of wrapping itself.

Provisional assumptions:

- Physical transport lengths (air-column rainout, sea-surface relaxation and
  mixing, continentality) stay in map kilometres. Small maps with wide latitude
  ranges compress the belts into fewer kilometres. M1 checks that each length
  still leaves belts distinguishable on the smallest supported map and caps any
  length that does not.
- The fixed annual-mean circulation stays. A wider equatorial belt stands in for
  the seasonal migration of the rain belt. Monsoon wind reversal is not modelled.

Non-goals: spherical geometry, area or distance distortion in physics, wrapping
terrain, plates, rivers or the editor, seasonal or monsoon circulation.

## Current state (read 2026-10-21, uncommitted tree)

- `latitude.ts::latitudeAtY` maps world northing linearly between
  `LatitudeSouth` and `LatitudeNorth` over `WorldExtentY`. Size and span are
  already independent settings, but the mapping is linear.
- The edge settings (`atlasParameters.ts`) accept −90 to 90, with north ≥ south.
  `physicalApplicability.ts` marks them initial-only and inherited. There is no
  projection or wrap setting and no frame preset. `reference.topology` is the
  literal `"planar"` (`packages/domain/src/schemas.ts`).
- Hemisphere handling: `circulation`, `beltSpeed`, `coastalFlow` and upwelling
  use the latitude's sign, and insolation, seasonality and belts are symmetric.
  No test generates a southern-hemisphere or equator-crossing world.
- Air columns (`airColumn.ts`) start at upwind map edges with `boundaryAir`
  (saturated over sea, half-saturated over land). Ocean `upstreamNeighbors` stop
  at the map edge. Nothing wraps.
- Rain (`belts.ts`, `airColumn.ts`, `climate.ts`):
  - The equatorial boost uses a 7.5° half-width (`spread = width / 4`).
  - Subtropical subsidence lowers rainout to 0.25, and the equator raises it to
    2.2.
  - Precipitation, runoff input and lake input are each clamped to 1,000 mm/year
    (`climate.ts` precipitation and runoff, `lakeStage.ts`).
  - Default-world land means: 0.56 m at 10°, 0.39 m at 30°, 0.53 m at 40°.
    Earth: about 1.5 m, 0.25 m and 1 m.
  - Raising `ColumnSaturation` to 1,100 lifted all bands together and erased the
    20° desert belt, so it was reverted.
- Wetness options:
  - The `rainfall` setting (`atlasParameters.ts`) is a 0–5 multiplier,
    default 1. `atlasProfile.ts` multiplies both `PrecipitationBaseline` and
    `ColumnRainEfficiency` by it, so it scales rain output linearly everywhere.
  - The cartographic "Rainfall regime" choice (`physicalCartography.ts`) offers
    Dry 0.2, Mixed 1 and Wet 2. The atlas presets have only "Arid world" (0.2).
  - Per-epoch ecology rainfall (`RainfallMultiplier`) multiplies on top.
  - Under the 1 m ceiling, Wet clips across the tropics, so it is barely wetter
    than Mixed where rain is already high.
  - Because the setting is linear, recalibrating Mixed upward about threefold
    would make Dry about three times wetter than today. Requirement 6 forbids
    that.
- Rainfall consumers already read metres per year:
  - ecology `environment` and `soilWater`;
  - `atlasProjection` precipitation;
  - runoff to discharge through `depthRateToDischarge`, which feeds river
    selection (`RiverAccumulationThreshold`, `RiverMinimumBasinDischarge`),
    channel widening, fluvial erosion, lakes and flood severity (`Runoff / 400`).

## Milestones

### M1 — Latitude frame: projections, presets and southern worlds

Scope:

- Add a `latitudeProjection` setting (`equal-area` | `equirectangular`) beside
  the edge settings, with the same ownership, initial-only status and
  inheritance. `latitudeAtY` inverts the projection. Add `northingAtLatitude`
  for tests and for presets that place features.
- Add the frame presets to the setup flow (unit-tested mapping, no new browser
  journey; update an existing journey only if its selectors change).
- Audit the transport lengths against the smallest supported map with a full
  globe, and cap any length that merges belts. Express caps as a share of the
  local km-per-degree if needed.

Acceptance (behaviour):

- Under equal-area, a world's middle northing falls at the latitude whose sine
  is midway between the edges' sines (0° for −90..90). Equirectangular keeps
  today's values.
- On a −70..70 world, the southern half mirrors the northern: easterly trades,
  westerlies and polar easterlies, subtropical gyres turning counter-clockwise
  in the south, and eastern-boundary upwelling on both sides of the equator.
- Regions inherit the frame and projection; a region's latitudes equal its
  parent's at the same world position.

Evidence: unit tests for projection round-trips, edge cases (equal edges,
±90° poles, a frame crossing the equator) and hemisphere mirroring of wind,
belts and gyres on synthetic meshes. One draft integration world per frame,
kept to a few minutes in total. Extend `setupProjection.test.ts` for inheritance.

### M2 — Climate-only east–west wrap

Scope:

- When `wrapLongitude` is set and the map spans the world width, link each
  upwind or upstream boundary cell to the nearest cell on the opposite edge at
  the same northing, for air columns and ocean drift.
- Closed zonal loops reuse the two-pass treatment that `sourceOrder` already
  gives gyres.
- Regions of a wrapping world keep edge inflow.

Acceptance:

- On a wrapping full-globe world, air entering at the east edge carries the
  moisture and heat of air leaving the west edge, so no meridian shows a
  boundary step in humidity, temperature or rain.
- With wrap off, the boundary behaviour is unchanged.

Evidence: unit tests on a synthetic zonal channel (a steady state with no edge
step, conservation around the loop), plus the full-globe integration world from
M1 checked for edge continuity.

### M3 — Rain belts and Earth-like rainfall magnitudes

Scope:

- Give the equatorial convergence its own half-width (about 15°) to represent
  seasonal migration. Strengthen subtropical subsidence.
- Raise the precipitation, runoff-input and lake-input ceilings from 1,000 to
  about 4,000 mm/year. Recalibrate column saturation and rain efficiency to the
  targets below.

Targets (land zonal means on the default draft worlds, ±30 %):

| Belt                   | Target                             |
| ---------------------- | ---------------------------------- |
| 0–10°                  | 1.8–2.5 m                          |
| 10–20°                 | 1.0–1.6 m                          |
| 20–30° (dry-belt core) | ≤ 0.35 m                           |
| 40–55° west coasts     | 0.9–1.5 m, wetter than east coasts |
| ≥ 65°                  | ≤ 0.4 m                            |

Acceptance:

- On a −70..70 world, rainforest dominates forest within 10° of the equator.
- On a 10–70 world, savanna or rainforest makes up a clear share of 10–20° land.
- Deserts peak at 20–30°.
- The existing climate assertions still hold: monotonic temperature, the
  subtropical dip, westerly coasts wetter than east coasts, no wind streaks, and
  the 60° front.

Evidence:

- `belts.test.ts`: the belt shape, including the 15° convergence width.
- `airColumn.test.ts`: rain above 1 m on a windward tropical coast, no longer
  clipped at 1 m.
- The climate generation file: the targets above, with output written to
  `test-results/`.

### M4 — Rainfall regimes: Dry, Mixed and Wet

Scope:

- Move the `rainfall` setting from scaling rain output to scaling moisture
  supply.
- Define the shared regime table and point the cartographic choice and the atlas
  presets at it. Add the "Wet world" preset.
- Fit each anchor to the targets below, with Mixed as the M3 calibration.

Targets (land on the default draft 10–70° and −70..70 worlds):

| Regime | Outcome                                                                                                                                                                                               |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dry    | Land mean ≤ 0.3 m and no band above 0.6 m; desert, barren and grassland cover most land; no rainforest. No wetter than today's arid preset in any band.                                               |
| Mixed  | The M3 belt targets.                                                                                                                                                                                  |
| Wet    | Every band at least 1.4× Mixed. Tropics 3–4 m without clipping over most tropical land. The 20–30° belt is still the driest band but carries savanna or woodland, not desert. Rainforest reaches 20°. |

Acceptance:

- The setting changes rainfall monotonically between the anchors.
- All three regimes keep the belt order: equatorial wet, subtropical dry,
  storm-track wet, polar dry.
- Per-epoch ecology rainfall still multiplies on top of the regime.

Evidence:

- A unit test that the regime table feeds both the cartographic choice and the
  presets.
- A unit test of the air column that moisture supply, not output, carries the
  setting.
- A regime test in the climate generation file: three draft worlds at the
  targets above. Today's arid profile is recorded once, before the change, as
  the Dry ceiling.

### M5 — Hydrology and erosion under the wetter climate

Scope: check and recalibrate the runoff consumers for rain up to 4 m/year,
covering the Wet regime:

- river thresholds and channel widening;
- fluvial erosion strength;
- lake overflow;
- flood severity (`Runoff / 400`);
- glacial snow input.

Acceptance:

- River counts and maximum discharge on the default Mixed world stay within the
  ranges the existing generation tests assert.
- The Wet regime gives more and larger rivers without flooding most lowland.
- The Dry regime still has rivers fed from its wettest uplands.
- Wet tropical basins carry the largest rivers.
- Erosion does not deepen valleys beyond the existing relief assertions.
- Flood frequency stays at or below 0.5 per year.

Evidence:

- Unit tests for runoff and flood severity above 1 m.
- The touched generation files: `ecology`, `islands`, `climate` and
  `adaptiveGeology`, run one file at a time.
- The Standard/Fine scale test is reported as unverified unless the user asks
  for it.

### M6 — Documentation and close

Update the parity table and the "Latitude climate" section of
`docs/generation-workflows.md`, plus the README descriptions of the latitude
frame, projection, wrap and rainfall regime settings. Run
`make ci`. Record the evidence here.

## Results (2026-10-21, executed on the user's request "execute all phases of the plan")

**M1, latitude frame.**

- `latitudeProjection` (equal area by default, even degrees optional) and
  `wrapLongitude` are integer choice settings. Their labelled choices render as
  selects in tuning and the development panel.
- The cartographic "Latitude frame" control offers the northern band, two
  hemispheres and a full globe.
- `latitudeFrameSettings` lists the initial-only frame settings once.
- Unit tests cover the projection round trip, the 30° three-quarter point on a
  full globe at three world sizes, region inheritance, and hemisphere mirroring
  of wind, belts and gyres.
- Integration: on the two-hemisphere world, trades and westerlies mirror across
  the equator, and sea temperature is symmetric within 4 °C. The full globe has a
  warm equator, and both poles freeze.
- Deviations:
  - The length audit capped only front mixing, at 6° of latitude. A 3° cap
    narrowed the default world's mixing to 150 km and brought back the 60° step,
    so it was rejected.
  - The full globe exposed a separate defect. Canonry's sea-ice resistances
    (current 22 °C, waves 18 °C, noise ±15 °C) kept an exposed −8.7 °C polar sea
    at 1.7 % ice. The Atlas profile now uses 2 °C, 2 °C and ±3 °C, and the
    northern polar cell went to 69 % ice.

**M2, wrap.**

- `longitudeWrap.ts` redirects air and ocean links that leave the world's width
  to the opposite edge. `linkDistance` measures them the short way round, and
  the first version's 2,000 km seam distance drained the crossing air.
- Air columns take a second pass on wrapped worlds.
- On the full globe, the rain change across the seam is 1.4 times the interior
  difference. With wrap off it is 3.82 against 2.01, which fails the check.

**M3, rain belts.**

- Changes:
  - convergence half-width 15°;
  - subtropical subsidence 1.1 over 10°;
  - storm track 1.2;
  - polar subsidence 0.7;
  - `ColumnSaturation` 1,650;
  - the 4 m ceiling applies to precipitation, runoff, lake input, glacial runoff
    and layer validation;
  - uplift rain is capped by the belt factor.
- Mixed results:
  - 1.93 m at 0–10° and 1.1 m at 10–20°;
  - 0.30 m in the dry belt;
  - westerly coasts above 0.63 m and wetter than east coasts;
  - rainforest outnumbers temperate and boreal forest within 10° of the equator.
- Consequential change: ecology plant water is now the aridity index,
  precipitation over potential evaporation (0.3 + 0.045 m/year per °C). Before,
  it took the lower of that index and column relative humidity. Heavy rainout
  drained the column to 0.45 relative humidity exactly where rain was 1.9 m, so
  the equator grew grass. The biome classifier case for rainforest moved from
  1.0 m to 2.0 m of rain.

**M4, regimes.**

- `rainfallRegimes` (Dry 0.07, Mixed 1, Wet 2) feeds the cartographic choice and
  the Arid and Wet presets. The setting scales `ColumnSaturation` and the
  precipitation baseline.
- Dry stays within 15 % of the recorded former arid preset in every band.
- Wet is at least 1.4 times Mixed everywhere and reaches 2.7–3.0 m in the
  tropics.
- Revised check: the plan asked for Wet's 20–30° belt to carry savanna or
  woodland. At 0.56 m and 18 °C it carries grassland, because the ecology's tree
  thresholds, not rainfall, decide that. The test now requires Wet's desert
  share there to be at most half of Mixed's (27 % against 53 %).

**M5, hydrology.**

- Unit tests: runoff above 1 m, glacial runoff to the ceiling, and flood
  frequency of at most 0.5.
- Regime test: Wet has at least as many rivers as Mixed and larger ones, Dry
  keeps rivers, Wet floods less than half its land, and the largest Mixed river
  on the two-hemisphere world peaks within 30° of the equator.
- The default generation suite, 14 files, passed in 265 s with three workers.

**M6, close.**

- Documentation: the latitude-climate section of `docs/generation-workflows.md`
  and the README authoring section.
- Checks:
  - `make ci` passes in 61 s, with 88 files and 509 tests and the existing lint
    warning.
  - `make test-browser` passes in 134 s.
  - The Standard/Fine scale suite was not run and is unverified.
- Known limitations:
  - Equatorial land is still mostly grassland by count, with rainforest second.
  - Post-glacial barren ground still dominates 40–50° land.

## Deferred decisions

- **Default projection for new worlds.** Owner: the user; affects M1. The
  agent recommends equal-area, and M1 implemented it. Trigger: the user prefers
  the earlier linear look for the northern-band preset.
- **Smallest supported map per frame.** Owner: agent. Settled by the M1 audit:
  front mixing is capped at 6°, so no setup warning was added.

## Sulion mapping

Root plan `a284cfea-3f41-4251-ac65-26be3a027045`. Phases 1–6 map to M1–M6 in
order. The Sulion phase titles kept their original labels when the regime
milestone was inserted, so phase 5 "M4 Hydrology" is M5 here and phase 6
"M5 Documentation" is M6.
