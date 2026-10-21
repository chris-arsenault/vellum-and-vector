# Latitude climate and atmospheric dynamics

Planning requested by the user on 2026-10-21 ("setup a plan to address all 5"),
following the climate review of `55cc813`. Only planning is authorized:
implementation, commit and push each need a later request. Sulion root: see
[Sulion mapping](#sulion-mapping).

## Outcome and scope

Generated worlds get climates organised by latitude, with physically ordered
consequences:

1. A latitude frame with an equator and poles. Insolation sets temperature, and
   the prevailing-wind bands are anchored to latitude.
2. Pressure belts: a wet equatorial convergence band, dry subtropical belts, and
   storm-track precipitation in the westerlies.
3. Moisture and heat that travel along the wind and rain out with distance and
   uplift. This replaces the 180 km barrier trace and the any-direction ocean
   distance.
4. Ocean currents that depend on latitude and are driven by wind, so warm and
   cold currents carry heat to and from coasts.
5. Wind speed, with terrain blocking, channelling and sheltering.
6. Biomes colonise across water and suffer flood disturbance. Plants and
   animals reach islands by wind, ocean currents and occasional crossings, and
   river floods kill, scour and fertilise vegetation.

Biomes, ice, rivers and ecology respond through their existing consumers. Magic
is coupled as follows:

- Upwelling feeds aquatic productivity.
- Magical heat travels downwind.
- Cold magic and coastal magic are recalibrated against the new climate.

The user requirements are the six capabilities and the magic and ecology
couplings above, all from 2026-10-21 requests. These boundaries are agreed in repository instructions and stay fixed:

- browser-memory sessions and the existing Web Worker;
- Canonry's causal step order and feature ownership;
- deterministic fixed-point generation;
- authored protection;
- regional refinement inheriting from the parent world.

Non-goals:

- a general circulation model or time-stepped weather;
- spherical geometry or reprojection of the planar world CRS;
- per-epoch orbital or axial-tilt variation (epoch temperature offsets remain);
- new persistence, services or recovery machinery;
- individual species or taxa distribution. Ecology keeps its plant functional
  groups and animal biomass groups.

## Current state (review evidence)

Source read at `55cc813`:

- **Wind.** `canonry/atmosphere.ts`. `windDirection` alternates zonal bands along
  mesh y, `CirculationBands = 5`, starting from a seed-random phase. Wind is
  stored as a unit vector (`WindX`/`WindY`) with no speed. `traceAirMass` walks
  upwind up to 180 km and records the highest barrier and the first ocean cell
  reached.
- **Temperature.** `canonry/climate.ts::temperature` has no latitude term. It
  sums baseline, epoch offset, elevation lapse (about 14 °C per 1000 elevation
  units), a coastal bonus that only adds warmth (up to 12.5 °C over 700 km),
  geothermal heat, current heat, `Warmth`, external/magic heat and an
  evapotranspiration term. `atlasPhysicalProfile` disables the heart warmth
  source and the warmth pockets.
- **Moisture and rain.** Moisture comes from distance to the nearest ocean in any
  direction, plus noise, thaw and one-cell upwind ET recycling, minus the
  barrier. Precipitation adds orographic lift from the one-cell upwind slope and
  upwind-ocean evaporation, then subtracts a second barrier term.
- **Ocean heat.** `canonry/currents.ts` seeds heat from geothermal sources only.
  Current directions come from noise potential, basin shape and a rotational
  term.
- **Ice.** `canonry/landIce.ts` and `canonry/seaIce.ts` allocate ice to a fixed
  coverage quota. The atlas sets land ice to 14 % of land area; sea ice has its
  own target and is limited by `IceMarginTemperature`. With a latitude gradient,
  the quota would put ice on tropical high ground and cap polar ice.
- **Seasonality.** `canonry/ecologyEnvironment.ts` applies one ecology-wide
  `seasonality` forcing (default 0.3, ±7.5 °C) to every cell.
- **Wind consumers.** Fire spread (`ecologyDisturbance.ts`), dispersal
  (`ecologyEstablishment.ts`) and the published `windEast`/`windNorth` channels
  (`atlasChannels.ts`).
- **World frame.** A planar metre CRS. The default draft is 4,000 × 3,000 km
  (`frontend/src/generationDraft.ts`). Mesh coordinates are local, with
  `mesh.origin` giving the world position.
- **Feature ownership.** Steps are owned by `physical.ocean-circulation`
  (`ocean-currents`, `warmth-sources`) and by `physical.climate` (`temperature`,
  `atmospheric-flow`, `moisture-transport`, `precipitation`; settings
  `temperature`, `rainfall`, `seaLevel`). Both are defined in
  `physicalFeatures.ts` and marked `inherited`.
- **Documentation.** The parity table in `docs/generation-workflows.md` (around
  line 550) maps these steps to Canonry layers. The "Adaptive M4 execution"
  section requires physical distances, area weighting and no extra elapsed
  activity from refinement.

## Decisions

### User requirements

- Capabilities 1–5 above (2026-10-21, "setup a plan to address all 5").
- Capability 6 and the magic and ecology couplings (2026-10-21, "yes, update
  the plan"). This followed the user's question about how biomes reach an
  island and whether flood or fire can eradicate them.

### Agreed decisions

- **Latitude mapping of the planar world** (user accepted the recommendations,
  2026-10-21). A world-level `latitude` setting group holds the latitudes of the
  south and north edges, in degrees from −90 to 90. Latitude is linear in world
  y. Defaults span 10°N to 70°N: a fantasy scale of about 67 km per degree on a
  4,000 × 3,000 km world. Rejected alternatives: Earth scale derived from
  height (a default world covers about 27°), and a centre latitude plus a scale
  value.
- **Execution timing** (user, 2026-10-21). Only planning proceeds for now.
  Execution waits until the concurrent generation-contracts work (`7eaba1d5`)
  is finished.

### Agent-derived implementation choices (revisable)

- **Replace Canonry climate bodies in place.** The climate step bodies are
  rewritten under the same step IDs and feature ownership. There is no
  dual-mode code. The standalone `physicalProfile` gets the same model with
  neutral defaults. The parity table in `docs/generation-workflows.md` records
  each divergence. _Reason:_ the request changes the algorithm. Keeping both
  models doubles test and calibration cost for no current consumer.
- **Latitude comes from world coordinates.** It is computed from
  `mesh.origin + mesh.y` against the world's edges, never the region's bounds.
  Regional refinement therefore reproduces its parent's latitude. Plate drift
  moves crust through latitudes across epochs with no extra machinery.
- **Circulation cells follow latitude.** Each hemisphere has three cells:
  trades, westerlies and polar easterlies. The meridional component reverses
  across the equator. `CirculationCellTurn` and `CirculationWander` keep their
  roles. A cells-per-hemisphere profile value replaces `CirculationBands`.
- **Insolation sets temperature.** An annual-mean insolation curve replaces the
  flat `TemperatureBaseline`. The existing `temperature` setting becomes the
  global-mean offset, so presets keep their meaning. A per-cell seasonal
  amplitude from latitude and continentality scales the ecology `seasonality`
  forcing instead of replacing it.
- **Ice extent follows temperature, not a quota.** The `LandIceCoverage` and
  `SeaIceCoverage` targets become calibration checks on the default world, not
  allocation quotas. _Reason:_ without this, polar cold cannot produce polar
  ice, which defeats item 1.
- **Ordering.**
  - The wind field (M1, M2) comes before ocean currents (M3), because currents
    are wind-driven.
  - Currents come before advective transport (M4), because air picks up heat and
    moisture from sea-surface temperature.
  - Belts and storm tracks (M5) adjust uplift and subsidence inside that
    transport.
  - Existing step IDs keep their positions in `climateSteps`. New work stays
    inside those steps or adds steps under the same owning features.
- **Transport mechanism.** A wind-ordered upwind sweep with a fixed iteration
  count over the existing mesh. It uses physical distances and cell areas and
  conserves the column budget. It is bounded per cell and has no time-stepping.
  The exact scheme is chosen in the M4 expansion against the performance budget.
- **Diagnostics.** A zonal-mean and transect diagnostic, run in tests on the
  measured world scene, provides evidence for every milestone. It is a test
  helper, not a product feature or report file.

### Provisional assumptions (checked in the noted milestone)

- Region workspaces carry world-CRS origins, so latitude reproduces across a
  region boundary (M0).
- Fixed-iteration transport fits the existing worker budgets at Draft, Standard
  and Fine without new memory peaks. The prior 2.9 GB RSS incident sets the
  ceiling (M4).
- Existing climate consumers need only recalibration, not interface changes:
  runoff, ice, sea ice, ecology, fire and dispersal (M1–M5).
- Adding a world setting fits the feature-owned configuration path being
  consolidated by the active "Complete generation feature contracts" plan
  (`7eaba1d5`). M0 coordinates with that plan's current state before editing
  shared registry or frontend files.

### Deferred

- **ADR for the latitude frame.** Settled at M6: no ADR. Latitude is two
  climate generation settings read from world northing. It changes neither the
  world CRS, nor exports, nor authoring, so `docs/generation-workflows.md`
  documents it.
- **How strong water crossings and floods are.** Owner: agent, offered to the
  user for tuning after M7. Values were chosen from first principles and the
  synthetic tests, not from inspected worlds:
  - plant reach 150–400 km, base interval 20 years;
  - animal reach 120 km, base interval 50 years;
  - up to 0.5 floods per year, with sensitivities from 0 (wetland) to 0.3
    (conifer).

## Milestones

### M0 — Latitude frame and climate diagnostics

- **Scope:**
  - Add a world latitude setting, owned by `physical.climate`, and show it in the
    setup UI with its climate group.
  - Add a pure `latitudeAt(world, x, y)` and a per-cell `Latitude` field.
  - Inherit both into regions.
  - Add a diagnostic helper: zonal means of temperature, precipitation and wind,
    plus windward/leeward transect contrasts.
- **Required behavior:** authors set or accept the edge latitudes. Latitude is
  identical for the same world point in the world run and in a region run.
- **Evidence:** unit tests for the latitude mapping and region inheritance; a
  settings round-trip; a baseline diagnostic of the current model, recorded for
  later comparison.

#### M0 execution steps

Evidence read at `9ec8d93`:

- `createWorldSnapshot` sets `world.reference.domain` to
  `rectangle([0, 0, width, height])`, with axes east, north, up.
- `createAtlasWorkspace` builds the profile from `atlasPhysicalProfile(parameters)`.
- The regional modal (`RegionalGeneration.tsx`) starts from the parent's
  parameters. `parameterInactiveReason` already freezes inherited geology
  parameters.

1. **Latitude frame.** Add the `southLatitude` and `northLatitude` climate
   parameters (defaults 10 and 70, range −90 to 90), owned by
   `physical.climate`. In a region they are inactive and inherited.
   `atlasPhysicalProfile` and the workspace copy the edge latitudes and the
   world's north–south extent from `world.reference.domain` onto the profile.
   `latitudeAt(map, profile, i)` interpolates from world y. This uses
   `mesh.origin + mesh.y`, so remeshing needs no extra field. Profiles without a
   world frame fall back to the mesh bounds.
   - Verify: unit tests for latitude across a world mesh and a child mesh at the
     same world point; south/north validation; inherited-parameter
     inactivation.
2. **Climate diagnostics.** `frontend/src/climate.generation.test.ts` generates
   the default 4,000 × 3,000 km draft world. It reports zonal land means of
   temperature, total precipitation, eastward wind and ice by latitude band. The
   M0 baseline is recorded here; later milestones add assertions to the same
   file.

**M0 result.**

- **Step 1** is complete. `canonry/latitude.test.ts` covers world and region
  latitude and edge validation. `setupProjection.test.ts` checks that the
  latitude settings are inactive in regions.
- **Step 2 baseline** (seed 104729, physical domain, draft):

  | Band | Land mean temperature | Precipitation | Eastward wind | Ice | Dominant cover   |
  | ---- | --------------------- | ------------- | ------------- | --- | ---------------- |
  | 10°  | 24.4 °C               | 0.56 m        | +0.26         | 2 % | Grassland/barren |
  | 20°  | 26.4 °C               | 0.61 m        | +0.27         | 0 % | Grassland/barren |
  | 30°  | 25.9 °C               | 0.57 m        | −0.52         | 1 % | Grassland/barren |
  | 40°  | 26.4 °C               | 0.60 m        | +0.87         | 0 % | Grassland/barren |
  | 50°  | 24.1 °C               | 0.64 m        | −0.91         | 0 % | Grassland        |

  Temperature is flat across latitude, and precipitation varies little. The
  wind alternates by band from a random phase.

- **Report location:** `frontend/test-results/climate-profile.txt` (ignored).

### M1 — Insolation temperature, latitude circulation and cold-driven ice [depends on M0]

- **Scope:**
  - Insolation-based mean temperature and seasonal amplitude.
  - Latitude-anchored three-cell winds with correct hemisphere directions.
  - Land and sea ice driven by temperature.
  - Ecology seasonality scaled per cell.
- **Required behavior:**
  - Zonal-mean temperature falls from equator to pole.
  - Ice, tundra and boreal forest appear poleward on default settings.
  - Trades blow east-to-west and westerlies west-to-east at their latitudes.
  - Cold and warm presets shift the gradient rather than flattening it.
- **Implementation checks:** removal of the quota; band directions per
  hemisphere; regional consistency.
- **Evidence:** diagnostic zonal profiles; biome-by-latitude counts on the
  measured world; existing ecology and ice tests recalibrated with the reason
  recorded.

#### M1 execution steps

1. **Temperature from latitude**
   (`climate.ts::temperature`, `insolationTemperature`, `seasonality`).
   - Temperature is now baseline + epoch offset −
     `InsolationTemperatureRange` (28 °C) × P2(sin latitude) − lapse + existing
     heat terms. P2 averages to zero over a sphere, so the existing `temperature`
     setting remains the global mean.
   - The additive coastal bonus is removed. Coastal influence moves into the
     new `Seasonality` field (seasonal half-range in °C), which grows with
     sin² latitude and with distance from the coast.
   - The atlas lapse rate changes from 14 to 6.5 °C/km, the standard
     environmental rate. At 14 °C/km, a latitude gradient on top made mid- and
     high-latitude uplands implausibly cold.
   - `snowShare` replaces the linear rain/snow split with the share of a
     sinusoidal year spent below freezing.
2. **Wind cells by latitude** (`atmosphere.ts::circulation`). Each hemisphere
   has three cells: easterly flow toward the equator in the Hadley and polar
   cells, westerly flow toward the pole in the Ferrel cell. The meridional part
   peaks mid-cell. The wander noise uses world coordinates at a fixed 420 km
   scale, so a region reproduces its parent's winds.
3. **Ice from temperature** (`landIce.ts`, `seaIce.ts`).
   - Land ice holds where mass balance ≥ `MinimumIceBalance`. Epoch glaciation
     strength scales growth only, so ice-free epochs keep existing cold-climate
     ice but grow none.
   - Melting scales with the balance deficit, so relict ice clears in warm
     epochs.
   - Sea ice forms where the cold index (temperature after current and wave
     resistance) is below `SeaIceFormationTemperature` (−3 °C).
   - The coverage quotas and `atlasSeaIce` are removed.
4. **Ecology consumers** (`ecologyEnvironment.ts`, `ecologySoils.ts`).
   - Summer and winter use the per-cell `Seasonality`, scaled by the epoch's
     seasonality relative to the neutral 0.3. Maps where climate has not run
     keep the previous uniform range.
   - **Defect fixed:** nutrient recovery added at most about 0.005 per epoch
     regardless of duration, so glacially scoured ground could not
     re-fertilise. Nutrients now approach the founder level plus organic
     recycling, with a time constant of 300 years ÷ (warmth × recovery).

**M1 result** (`frontend/src/climate.generation.test.ts`, seed 104729, draft,
default epochs at 5,000 years each):

- **10–70° world:**
  - Land mean temperature falls 28.1 → 24.9 → 18.8 → 13.2 → 4.8 °C from the
    10° band to the 50° band.
  - Wind is −0.80/−0.92 in the trades and +0.78 to +0.85 in the westerlies.
  - Ice covers 0 % of land below 40°, 4 % at 40° and 18 % at 50°.
  - Rainforest, temperate forest and savanna occupy the 10–30° bands.
- **40–85° world:**
  - Ice covers 63 % of land at 60° and 100 % at 70°.
  - Tundra appears at 60° and above, and polar easterlies blow at 60–80°.
- **Limitation:** the 45–55° band remains largely barren. In the Cold age, 87 %
  of that land was under ice, and 41 % is still ice-covered at the end of the
  Present epoch. Ecology grows vegetation once per epoch, so ground that thaws
  late in the final epoch has not yet had its regrowth pass. This is a
  causal-order consequence rather than a defect. Boreal forest needs longer
  post-glacial time; M7 revisits colonisation.
- **Recalibrated tests:** `adaptiveClimate.test.ts` now checks that ice covers
  exactly the cells with a positive balance, replacing the 14 % quota check.
  `refinement.test.ts` uses the native sea-ice step.
  `latitude.test.ts` covers maps without a world frame, which are placed at the
  mid latitude.

### M2 — Wind speed and terrain interaction [depends on M1]

- **Scope:**
  - A wind-speed field, with zonal strength varying by belt.
  - Barrier blocking and deflection along ranges, gap channelling, and lee
    shelter.
  - A published `windSpeed` channel.
  - Fire and dispersal use speed.
- **Required behavior:**
  - Lee sides of ranges have lower speed than windward sides.
  - Passes and valleys aligned with the flow channel it.
  - Wind direction bends around high barriers instead of crossing them
    unchanged.
- **Evidence:** transect and synthetic-ridge tests; fire-spread test showing a
  speed effect.

#### M2 execution steps

1. **Terrain-steered direction and speed** (`atmosphere.ts`).
   - The circulation direction is computed first. Terrain is the elevation above
     sea level, smoothed over 40 km (`prepareMetricSmoother`).
   - **Deflection.** Where wind blows up a steep, high barrier, the upslope
     component is removed in proportion to barrier height (full at 1,500 m) and
     steepness. This turns the flow along the contours.
   - **Speed.** Speed is the belt speed times its within-cell profile:
     - Belt speeds: trades 7 m/s, westerlies 9 m/s, polar easterlies 5 m/s.
       Speed falls toward the calm cell boundaries.
     - Land roughness factor: 0.75.
     - Exposure on ridge crests: up to +50 % with relief above the 150 km
       regional mean.
     - Lee shelter from the upwind barrier trace: up to −60 % for a 1,000 m
       barrier.
     - Gap channelling: up to +50 % where terrain rises at least 300 m on both
       sides across the flow within 25 km.
   - The new `WindSpeed` metric field is published as the `windSpeed` channel
     (m/s) on the climate layer.
   - Verify: a synthetic-ridge test shows the lee slower than the windward side
     and the flow deflected along a high ridge. A synthetic gap test shows the
     gap faster than open ground.
2. **Speed consumers** (`ecologyDisturbance.ts`, `ecologyEstablishment.ts`).
   Fire travel and seed dispersal along the wind scale with speed relative to a
   7 m/s reference. Verify: a fire-spread test where higher speed reaches
   farther downwind.

**M2 result.**

- **`windTerrain.test.ts`:**
  - Hemisphere belt directions are correct.
  - The lee of a 2,500 m ridge is below 70 % of the upstream speed.
  - The eastward component on the windward slope falls below 60 % of the
    upstream value.
  - A 40 km gap runs more than 15 % faster than open ground.
- **`ecologyEpoch.test.ts`:** a 14 m/s headwind stops fire spread that a
  3.5 m/s wind allows.
- **Changes from the design:**
  - Gap walls are sampled from unsmoothed height, because 40 km smoothing erased
    gaps of that width.
  - Samples beyond a regional work extent count as no wall. The adaptive sampler
    returns NaN there, and the regional generation test caught it.
- **Default world** (land means): 4.6, 3.3, 3.9, 6.2 and 5.6 m/s in the 10–50°
  bands.
- **Suites:** 357 package tests, 475 frontend unit tests and 33 generation
  tests pass.

### M3 — Wind-driven, latitude-aware ocean currents [depends on M2]

- **Scope:**
  - Current directions from wind stress, forming gyres.
  - Sea-surface temperature from latitude, carried by currents, so poleward flow
    is warm and equatorward flow is cold.
  - Coastal upwelling where flow runs offshore.
  - Geothermal heat remains an additive source.
  - An upwelling nutrient term in `AquaticProductivity` (`ecologyGrowth.ts`),
    which today depends only on warmth and light.
- **Required behavior:**
  - Western-boundary currents warm the coasts beside them.
  - Eastern-boundary currents and upwelling cool and dry their coasts.
  - Sea ice follows cold sea-surface temperature.
  - Upwelling coasts have higher aquatic productivity and aquatic fauna than
    non-upwelling coasts at the same latitude.
- **Evidence:** synthetic-basin gyre test; coastal sea-surface-temperature
  contrast at equal latitude on the measured world; aquatic productivity
  comparison at the same latitude.

#### M3 execution steps

1. **Gyre directions** (`currents.ts`).
   - The open-ocean drift follows the latitude circulation belts (`circulation`).
   - Near coasts, a land mask smoothed over 300 km gives the coast normal. Flow
     turns along the coast in the gyre's sense:
     - Subtropical gyres (|latitude| < 45°): poleward on western boundaries,
       equatorward on eastern boundaries.
     - Subpolar gyres: the reverse.
   - Strength is boosted on western boundaries (western intensification).
   - The noise potential and the rotation about the map centre are removed. The
     existing depth/noise strength and smoothing remain.
2. **Sea-surface temperature anomaly.**
   - `SeaSurfaceAnomaly` (native units, signed) is the equilibrium surface
     temperature carried along the current minus the local one. Upstream
     temperatures are weighted by `exp(−distance / 600 km)` up to 1,500 km
     upstream. Upwelling then cools the result.
   - `Upwelling` (per-mille) is greatest on subtropical eastern boundaries where
     the flow runs equatorward along the coast.
   - Ocean-cell temperature adds the anomaly, so sea ice responds. Geothermal
     `OceanCurrentHeat` keeps its existing meaning and consumers.
   - **Moved to M4:** carrying the anomaly onto land needs air transport, so
     "currents warm the coasts beside them" is checked on land there. M3 checks
     sea-surface temperature, sea ice and productivity.
3. **Upwelling productivity** (`ecologyGrowth.ts`). Aquatic productivity is
   multiplied by `1 + 1.5 × upwelling`.
4. **Verify:**
   - A synthetic rectangular basin at 10–60° shows a poleward western-boundary
     current with a warm anomaly, and an equatorward eastern-boundary current
     with upwelling and a cold anomaly.
   - Aquatic productivity is higher at the upwelling coast than at the opposite
     coast at the same latitude.

**M3 result.**

- **`oceanGyres.test.ts`:**
  - At 30°, 50 km offshore: the western-boundary flow is poleward
    (y > 0.3), stronger than mid-basin, and +4.5 °C warm. The eastern boundary
    runs equatorward with upwelling above 0.3 and a negative anomaly.
  - At 55°, both boundary currents reverse.
- **Default world:** shelf water with upwelling above 0.3 has more than 1.2×
  the aquatic productivity of still shelf water.
- **Changes from the design:**
  - The 300 km land-mask smoothing cost 3.3 s per Fine pass, so coast normals now
    come from a Dijkstra ocean-path distance to the coast.
  - The per-cell 1,500 km upstream walk took 11.6 s per Fine currents pass. It is
    now an O(n) upstream-ordered, exponentially weighted sum, run twice so that
    closed gyre loops carry heat around.
  - Relaxation is 1,200 km.
  - These changes brought the per-pass time from 11.6 s to 2.3 s, and the
    Standard/Fine world-scale test back under its 600 s limit; it had timed out
    at 643 s. M2's 150 km regional smoothing was dropped for the same reason:
    crest exposure now uses height above the 40 km terrain.

### M4 — Advective moisture and heat transport with rainout [depends on M3]

- **Scope:**
  - Replace `traceAirMass` and the any-direction ocean exposure with
    along-wind column transport.
  - Sources: evaporation from ocean (by sea-surface temperature), lakes and land
    ET.
  - Sinks: rainout from orographic uplift and distance.
  - Heat advection, so maritime and continental temperature regimes emerge.
  - Magical heat (`ExternalHeatForcing`) is one of the transported heat sources,
    so a heat source warms the land downwind of it. The existing replacement of
    each pass's magic contribution (`magicFeedback.ts`) stays exact, with no
    double counting across climate passes.
  - Remove the double rain-shadow subtraction.
- **Required behavior:**
  - Precipitation falls with distance downwind of the coast.
  - A placed heat-magic source raises temperature downwind more than upwind.
  - Ranges wring out windward rain, and the lee shadow lasts beyond 180 km in
    proportion to range height.
  - Continental interiors are drier and more seasonal than coasts at the same
    latitude.
- **Implementation checks:** column budget conserved across refinement;
  Draft/Standard/Fine runtime and memory within current budgets.
- **Evidence:** ridge and continent transect tests; coarse/fine agreement;
  worker timing at each quality.

#### M4 execution steps

1. **Downwind column march** (`airColumn.ts`).
   - **Order.** `windOrder` sorts cells so each follows its single upwind
     source. A closed wind loop starts from boundary air at the cell that
     entered it last. This is one O(n) pass with no iteration count, which
     replaces the planned fixed-iteration sweep.
   - **Over the sea.** The column relaxes toward 85 % of saturation over
     400 km. Saturation grows about 4.5 % per °C. The column also takes the
     sea-surface anomaly and maritime character over 300 km.
   - **Over land:**
     - Uplift removes `1 − exp(−rise / 4000 m)` of the column as orographic
       rain.
     - Distance rains out the rest over 1,000 km, while evapotranspiration
       recycles moisture into the column.
     - Marine heat decays over 1,000 km and maritime character over 800 km.
   - **Magic.** External magical heat enters the passing air: a 0.5 share,
     decaying over 300 km downwind.
2. **Climate wiring** (`climate.ts`).
   - `moisture-transport` runs the march. It sets `Moisture` as relative
     humidity (×1000, ocean 1000) and adds the carried air heat to land
     temperature.
   - It recomputes `Seasonality` from advective continentality
     (1 − maritime character), replacing ocean distance.
   - It stores column precipitation for `precipitation`, which keeps the
     baseline, epoch rainfall multiplier and rain/snow split.
   - The old barrier subtraction, any-direction ocean exposure and
     upwind-ocean evaporation terms are removed. `traceAirMass` remains only for
     lee shelter of wind speed.
3. **Verify.**
   - A synthetic west-to-east continent with a central range, run through
     `atmosphericFlow`, `moisture` and `precipitation`, must show:
     - precipitation falling inland from the coast;
     - a windward maximum;
     - a lee shadow below half the windward value that persists more than
       180 km past the crest.
   - A placed heat source warms downwind land more than upwind land.
   - On the default world, interior land is drier and more seasonal than coastal
     land at the same latitude.
   - Draft and Standard timings are compared with M3.

**M4 result.**

- **`airColumn.test.ts`**, on a synthetic continent with a 3,000 m range:
  - Rain falls from coast to interior, peaks on the windward slope, and drops in
    the lee below half the windward value.
  - 300 km past the crest, rain remains below 80 % of the inland upwind value.
  - A 20 °C magical heat source warms land 200 km downwind by more than 0.5 °C,
    and land 200 km upwind by less than 0.1 °C.
  - The interior's seasonal range exceeds the coast's by more than 1.3×.
- **Change to M2:** terrain blocking is capped at 60 % of the upslope
  component. Full blocking turned the windward air along the ridge, so it
  never rose and produced no orographic rain.
- **Recalibration:** the M1 world assertion on rainforest plus savanna at 10°
  is lowered from 15 % to 10 % of band land. Under advective transport, that
  band's land sits downwind of the continent in the easterly trades and is
  drier than under the former uniform moisture formula.
- **Timing:** the march is one O(n) pass (`sourceOrder`) with no iteration count.
  The full generation suite, including the Standard/Fine world-scale test,
  completes within its limits.

### M5 — Pressure belts and storm tracks [depends on M4]

- **Scope:** latitude-derived convergence and subsidence in the transport
  uplift term. That gives a wet equatorial band, dry subtropical belts, and a
  storm-track precipitation band in the westerlies whose strength depends on the
  temperature gradient.
- **Required behavior:**
  - On the default world, zonal-mean precipitation peaks near the equator,
    dips at about 20–35°, and rises again in the westerlies.
  - Deserts concentrate in the subtropical belt and in rain shadows.
  - West coasts in the westerlies are wetter than east coasts at the same
    latitude.
- **Evidence:** diagnostic precipitation profile and biome-by-latitude counts.

#### M5 execution steps

1. **Belt rainout** (`belts.ts::beltRainout`). This multiplier scales both the
   column's rain efficiency and its rainout rate in `marchAirColumns`. Air
   under subsidence therefore keeps its moisture and exports it downwind,
   while rising air drops it.
   - Equatorial convergence: +1.2 at 0°.
   - Storm track: +0.9 × |sin 2φ| centred at 50°.
   - Subtropical subsidence: −0.75 at 30°.
   - Polar subsidence: −0.5 at 90°.
   - Floor: 0.15.
   - Centres follow the circulation cell boundaries.
2. **Verify.**
   - A unit check of the factor's ordering: equator > storm track > 1 >
     subtropics.
   - On the default 10–70° world, the zonal land-mean precipitation dips at
     20–30° relative to both the 10° band and the westerlies.
   - Desert and barren share is highest in the subtropical bands.
   - Ocean-facing west coasts in the westerlies receive more precipitation than
     east coasts at the same latitude.

**M5 result.** Default 10–70° world, land means:

- Precipitation is 0.58, 0.53, 0.43, 0.59 and 0.77 m in the 10° to 50° bands.
- Desert appears in the 20–30° bands (115 and 100 cells), and the polar bands are
  dry (0.16–0.29 m).
- The world test checks:
  - the 30° band is below 0.85× both the 10° and 40° bands;
  - desert share is higher at 20–30° than at 40°;
  - 35–55° land with open ocean 150 km to the west gets more precipitation than
    land with ocean 150 km to the east.
- `belts.test.ts` checks the factor's ordering and hemisphere symmetry.
- **Limitation:** precipitation keeps the existing per-mille scale, which caps
  at 1 m/year. The wettest bands therefore read lower than Earth's tropics.
  Rescaling would change every precipitation consumer and is outside this plan.

### M6 — Integration, calibration and documentation [depends on M5]

- **Scope:**
  - Calibrate the presets (cold, arid and the rest).
  - Recalibrate cold magic. Its sources (`magicSources.ts` cold terrain) and its
    propagation toward colder ground with ice retention (`magicPropagation.ts`)
    now meet a polar gradient and ice driven by temperature instead of a quota.
  - Recalibrate coastal magic feedback against the new current strength and
    wave exposure.
  - Check magic heat forcing, epoch history, regional refinement and the
    published channels together.
  - Update `docs/generation-workflows.md` (parity table and climate section),
    `docs/generation-modules.md` and the README if settings change.
  - Write the ADR if the deferred decision is accepted.
- **Required behavior:** full world and region generation in the browser show
  the latitude climate. Undo and world-revision publication are unchanged. All
  presets run. On a default world, cold magic concentrates poleward and in
  high ground, and it retains in ice.
- **Evidence:** `make ci`; `make test-browser`; one generated world and one
  region inspected in the editor; magic preset runs compared before and after
  recalibration.

**M6 result.**

- **`magicClimate.generation.test.ts`** (default world, Aurora preset):
  - Mean Aurora history by band: 59, 70, 251, 414, 816 and 2,005 from 10° to
    60°.
  - Glaciated cells average 787 against 599 for ice-free cells.
  - Coastal forcing history remains present.
  - Cold-magic sources keep their meaning (`baseInput` 360: power where ground
    is colder than about 6 °C), so the preset was not recalibrated. No "before"
    run exists to compare against, because the old flat climate placed cold
    magic on peaks only.
- **Preset test:** balanced, cold, arid and Ice Remembers all generate. Ice
  rises from balanced to cold to Ice Remembers, and arid precipitation is below
  0.6× balanced.
- **Docs:** the parity table and a new latitude-climate section in
  `generation-workflows.md`; the magic note in `generation-modules.md`.
- **Checks:** `make ci` passes; its two lint warnings are pre-existing, in
  `magicSystems.ts` and `TemplateDrawing.tsx`. `make test-browser`: 40 passed.
  The regional generation test passes, and the editor inspection was deferred
  to after M7 so one inspection covers both.

### M7 — Biome colonization and disturbance [depends on M6]

Current behavior, read at `55cc813`:

- **Island colonisation.** `initializeEcology` seeds every land cell once.
  After that, plant spread (`ecologicalFront` via `dispersePlants`) and animal
  migration (`migrateAnimals`) admit no ocean cells. Land that forms later, and
  land that has been wiped out, is never colonised across water.
- **Floods.** Flood extent only raises wetness. Only permanent drowning kills.
- **Fire.** Fire already kills and spreads with the wind, but it removes at most
  40 % of the seed bank per event.
- **Seed banks.** A seed bank decays toward zero within about 20–80 years once
  its cover is gone.

Scope:

- **Plants cross water.** Plant groups get long-distance dispersal across
  water:
  - Wind-borne seed travels downwind over the sea. Its reach depends on wind
    speed (M2) and falls off with distance.
  - Floating propagules raft along ocean currents (M3).
  - Group traits set which mechanisms apply: grass and wetland groups disperse
    far by wind; trees disperse mainly by rafting.
  - Arrivals add to the seed bank and then establish through the existing growth
    and suitability code.
- **Animals cross water.** Terrestrial animal groups make rare crossings that
  become less likely with distance, and they need established forage to persist.
- **Floods are disturbance events.** Flood frequency and magnitude come from
  river discharge and seasonal precipitation (M4–M5), along existing
  floodplains and deltas. A flood kills seedlings, saplings and part of the
  mature cover, and the effect varies by group: wetland tolerant, trees partial.
  It scours or buries soil and seed bank, and it deposits nutrients. A severe
  repeated flood can eliminate a group locally, and the existing seed-bank decay
  completes the loss.
- **Fire stays as it is.** Fire keeps its current model, with wind speed from
  M2.

Required behavior:

- An island that emerges or is wiped out after initialization is recolonised
  over later epochs.
- Islands downwind or down-current of a source are colonised sooner and more
  fully than upwind or isolated islands at equal distance.
- Very remote islands remain sparse or lack tree groups.
- Frequently flooded floodplains favour wetland and fast-establishing groups and
  hold younger canopy.
- A group can be eradicated locally by flood or fire combined with seed-bank
  loss, and then returns only by dispersal.

Evidence:

- Synthetic-archipelago tests for colonisation order and distance falloff.
- A flood-disturbance test on a synthetic river.
- An eradication-then-recolonisation test across epochs.
- Ecology integration tests recalibrated, with each reason recorded.
- One generated world with a volcanic island inspected in the editor.

#### M7 execution steps

1. **Water crossings** (`ecologyMovement.ts::waterCrossing`).
   - A Dijkstra search starts from occupied land and runs across ocean cells. It
     records an effective over-water distance for land reached only across
     water.
   - Each water edge is divided by a directional factor
     `max(0.2, 1 + alignment × strength)`:
     - wind-dispersed groups use wind direction and speed relative to 7 m/s;
     - rafting groups use current direction and strength.
   - Expected arrival is `interval × exp(distance / reach)`.
   - **Plants** (`dispersePlants`) start their front at that arrival time, so
     colonisation then proceeds through the existing growth code.
     - Grass and wetland groups travel by wind (reach 400 and 300 km).
     - Broadleaf, conifer and altered groups raft (reach 250, 150 and 200 km).
     - Base interval: 20 years.
   - **Animals** (`evolveAnimals`) found a small population (1 % of capacity)
     on unoccupied land with forage, when the crossing arrives within the
     epoch. Reach is 120 km; base interval 50 years.
   - Verify: a synthetic archipelago test.
     - The downwind island is colonised and the upwind island at equal
       distance is not.
     - A remote island gets grass but no trees within the epoch.
     - Grazers cross to a near island.
2. **Floods** (`ecologyDisturbance.ts::floodEcology`).
   - `FloodFrequency` (floods per year) is floodplain or delta intensity ×
     seasonal-range and runoff factors.
   - Each epoch, the disturbance kills seedlings and saplings and removes part of
     the mature cover by group tolerance. It also scours seed and soil, and
     deposits nutrients.
   - Growth mortality adds frequency × group flood sensitivity, so frequent
     floods favour wetland and grass and keep the canopy young.
   - Seed-bank decay finishes a local eradication.
   - Verify: a corridor test where the flooded half ends with more wetland,
     less tree cover and younger canopy than the dry half. An eradication test
     where an island loses its trees to floods, then regains them only once a
     crossing reaches it.
3. **World check.** A default-world generation in which islands that emerge
   after initialisation (volcanic or newly exposed) carry plant cover by the
   final epoch.

**M7 result.**

- **`ecologyCrossing.test.ts`:**
  - Grass reaches the island 150 km downwind in under 100 years, less than half
    the time it takes to reach the island 150 km upwind.
  - The island about 1,000 km downwind gets grass within 500 years and
    broadleaf trees only after 500 years.
  - Grazers found a population on the near island.
  - On the flooded half of a mainland: tree cover is below 0.7× the dry half,
    wetland cover is higher and canopy is younger.
  - Flood eradication leaves an isolated island below 0.01 broadleaf cover after
    the floods stop. The same island regains more than 0.1 when a mainland
    crossing can reach it.
- **`islands.generation.test.ts`** (island world: 10 continents, 0.3 land
  fraction): landmasses with no land at the first epoch boundary carry plant
  cover on 9 of 9 cells by the final epoch. The sample is small; the test
  requires more than half.
- **Changes from the design:**
  - The crossing search relays through land at no cost, so islands act as
    stepping stones.
  - Growth now treats cover below the fronts' 1e-5 presence threshold as
    absent. Before, infinitesimal residual cover regrew from the seed floor,
    which prevented local eradication.
- **Suites:** 367 package tests, 485 frontend unit tests and the generation
  suite (15 files, 36 tests) pass.
- **Not done:** visual inspection of a world and a region in the running
  editor. The browser journeys drive world and regional generation through the
  editor, but I did not view rendered maps.

## Sulion mapping

Root `6b5c6587-f612-467b-af69-e288abc921c3`.

| Milestone | Phase ID                               |
| --------- | -------------------------------------- |
| M0        | `49a4cae3-7411-4d38-b037-bec63b92c348` |
| M1        | `60456d41-47bb-488d-94d7-f60d93383a20` |
| M2        | `302ddd7e-d6ce-40b8-9c52-c439d41137f0` |
| M3        | `72b8de2d-26d8-492d-92bd-8c9bc1917a31` |
| M4        | `803c8070-26da-4231-9897-8e088ccd4bee` |
| M5        | `e43739b3-7c47-4293-b3f6-905b517a84a5` |
| M6        | `30cdf76c-7e07-4c32-a7f5-7b3397e1cd23` |
| M7        | `fc02b18e-7df8-4a02-9c32-f2dcd0c8693e` |

## Current state

M0–M7 are implemented and verified locally on 2026-10-21, as recorded in each
milestone's result. Nothing is committed or pushed. Remaining:

- visual inspection in the editor;
- user tuning of the crossing and flood strengths, if desired;
- the precipitation scale limit noted under M5.
