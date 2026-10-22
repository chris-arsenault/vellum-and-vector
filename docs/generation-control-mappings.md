# Generation control mappings

Implemented and verified locally, authorized 2026-10-22 by “execute all phases of the
plan.” Execution uses the restored baseline at `5f89906`. Geography was reviewed at `66eded2` and magic
reviewed against the in-progress working tree at HEAD `48f3ea7`, including the
new magic source authority and product contract. Update this document in place.
The requirements are established. The vocabulary and coefficient vectors below
are now implemented, with bounded calibration described in the execution record.

## Requirements and scope

Give creators substantially fewer, meaningful decisions about the visible map.
Remove process on/off mappings. Use geographic outcome language rather than
generation internals. Categories and magnitudes are both appropriate when their
differences describe recognizable outcomes; universal magnitude scales are not
a requirement.

Several mechanisms may contribute to one outcome. Their shared outcome explains
the grouping; sharing a process family does not. Conversely, independent
coefficients do not each warrant an independent creator decision. Keep
independence where it matters to the map a creator wants to make.

This covers mappings for initial generation, including current climate and
ecology. It does not redesign wizard order, screens, layout, CI, generators or
the engine. Content inclusion is distinct from appearance and is not counted as
curation. The current execution request authorizes implementing these mappings;
the separate society workshop remains design work.

### Execution record

Sulion execution plan: `32793e88-f2e6-46fa-881b-cb8dd5d22d94`.

1. Bindings and curated geography: implemented. Existing feature configurations
   now carry owned native profile overrides, terrain-history anchors and living
   landscape baselines. Seven geography decisions and two human decisions replace
   the earlier switch bundles. Focused draft/history checks cover native
   coefficient ownership, dimensional validity and selection-order independence.
2. Distinct magic controls and omission: implemented. Fire has four decisions,
   Aurora three and Pressure four. Eleven small model checks pass, including all
   eight inclusion combinations, stale forcing, zero coastal threshold and
   participant-correct interactions and a causal Fire-omission/Aurora check.
   The previously timed-out interaction check passes on the restored baseline
   in 84 ms; no timeout changed.
3. Application integration: implemented. Twenty-two relevant browser journeys
   pass in Chromium, including narrow screens, explicit inclusion, typed recipe
   delivery and region inheritance. An additional inclusion check confirms that
   enabling one system after excluding the whole magic feature leaves the others off.
   Initial drafts receive the reference geography choices; authored magic
   recipes remain intact until an outcome is
   selected. Inclusion is separate from system-specific outcomes.
4. Geographic verification and documentation: completed. Six generated and
   published worked compositions pass at seeds 73 and 104729, using 4000 × 3000 km
   and 3000 × 2000 km respectively. Humid maritime maps exceed dry plains in
   rainfall and tree cover; broad continents retain more land than the island
   composition; glaciated worlds retain greater glacial erosion. Three additional
   model checks exercise the direction of all eleven magic mappings, and eleven
   omission/causal checks cover inclusion, forcing and Aurora's changed inputs
   when Fire is absent. All 524 unit/contract tests pass; typecheck and lint pass
   with the two existing warnings. The full generation suite passed all 39 checks
   before the final woodland calibration. All affected generation checks were
   then rerun: both worked-composition cases and the world-to-region workflow
   pass with the final vectors. The four curated browser cases also pass again.
   Production frontend builds pass through the browser test setup. No CI workflow
   or deployment configuration changed. Commit and push follow separate user
   authorization.

Browser prerequisite branch: `08ea5a94-8383-4516-a5c7-ccb09980b23a`.
Twenty-one Firefox browser checks pass; the remaining check records an OpenLayers
WebGLHelper-constructor error. A direct canvas probe confirms headless Firefox
cannot create WebGL here, while Chromium can. The headed Firefox wrapper cannot
run because `xvfb-run` is absent. Verification uses the existing default Chromium
browser; no application rendering change or test suppression is justified by this
environment limitation. The default Chromium run passed all 22 checks in 53.9 s.

Living-landscape calibration branch: `8f029799-ca62-4771-9e38-d3cc968faa62`.
Relative wet-versus-dry checks initially passed while the wet maritime example
still averaged only 1.65% tree cover. That did not justify “Humid woodland.”
Increasing growth and reducing browsing alone produced 9.2% canopy and remained
grass-dominated. Coordinating those inputs with existing soil recovery produced
29.0% mean tree cover and 41.8% forest cells at seed 73. The intermediate mosaic
vector produced 10.8% mean canopy, with 25.9% of land above the model's woodland
threshold and 12.2% above its forest threshold. These are measurements, not
imposed coverage quotas. Updated vectors replace the original proposals below;
no ecology algorithm or biome classification threshold changed.

At the second extent/seed, humid woodland averages 14.5% canopy, with 29.2% of
land above the woodland threshold and 17.7% above the forest threshold. This
variation is retained, not normalized to a quota. The young post-glacial
compositions remain nearly barren after their 200-year recovery, as anticipated
by the existing ecology limitation. Dry examples produce about 68–74 mm/year
mean precipitation and negligible vegetation; they do not guarantee river mouths
or deltas. Standard/Fine resolutions and a broad seed distribution were not
calibrated by this work.

Implementation decisions within the design's boundaries:

- Feature-owned native configuration exposes only coefficients used by these
  mappings, without creating individual display labels or numerical controls.
  The existing workspace initializer consumes the resolved overrides.
- Three-point history curves bind to the existing clock by ordered position.
  With the default three epochs they reproduce the tables exactly; longer clocks
  interpolate the anchors, while a one-epoch clock uses the present anchor. No
  epoch is inserted, renamed or deleted by choosing an outcome. This resolves the
  unfinished arbitrary-clock binding without inventing another history selector.
- Explicit numerical history edits materialize the current effective values and
  clear the corresponding curated regime. They remain exact authored inputs,
  rather than being silently overwritten on the next preparation.
- Society inventories, practice costs and damage events remain proposals in
  `SOCIETY-GENERATION-PLAN.md`. Existing contact-region predicates are retained;
  these controls do not claim they simulate those social operations.

Earlier proposals exposed generation-oriented dimensions without establishing
useful visible outcomes. A later revision then reduced too aggressively,
particularly by flattening magic into a single global preset. Fewer controls is
not the sole measure of good curation. Reuse the useful numerical work while
preserving meaningful distinctions in the map. The previous
`9ec8d93` rainfall and ice assumptions are superseded by the current bindings
described below.

## Implemented decision set

Seven decisions describe physical and living geography; culture and politics
each add an independent appearance decision. Fire, Aurora and Pressure get
eleven distinct system-specific mappings in section 8. Both
the single global imprint and the later generic six-dimension template are
withdrawn. The current inventory has twenty outcome decisions. That is an
observed inventory, not a count target for future design: preserve useful choices
and remove generator trivia rather than force a total.

| Decision                            | Alternatives                                                                               | Visible meaning                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Land and sea                        | Broad continents / Broken continents / Island world                                        | Large interiors versus a fragmented, maritime map                                  |
| Terrain                             | Wide plains / Rolling hills / Mountain ranges / Glacier-carved                             | The dominant relief, valley form and inherited surface                             |
| Shoreline                           | Smooth sweeps / Inlets and headlands / River-mouth flats                                   | Simpler outlines, intricate shores, or depositional coastal lowlands               |
| Climate coverage                    | Northern lands / Two hemispheres / Pole to pole                                            | Which latitude-organized climatic zones appear on the map                          |
| Warmth                              | Cooler / Earth-like / Warmer                                                               | Snowlines, cold regions and growing conditions shift within that coverage          |
| Living landscape                    | Dry and sparse / Seasonally open country / Wooded mosaic / Humid woodland                  | The character of vegetation and its relationship to water and disturbance          |
| Distinctive landmarks               | Rare / Scattered / Prominent                                                               | How often volcanic districts and crater landforms interrupt the background terrain |
| Fire, Aurora and Pressure           | Distinct source, propagation, terrain and history decisions for each system; see section 8 | Preserve each system's physical identity and specific consequences                 |
| Cultural pattern, where applicable  | Distinct centers / Overlapping regions / Broad mixture                                     | Separate cultural concentrations versus overlapping prevalence                     |
| Political pattern, where applicable | Broad territories / Regional states / Many small territories                               | The scale and density of territorial boundaries                                    |

Names in this table are creator vocabulary. Internal terms such as sediment
retention, conductance divisor and ecological recovery occur only in the mapping
specification. They do not become additional choices. Settings for solver
iterations, sampling density, validation and biome classification remain internal.

The initial-draft reference combination is Broken continents, Rolling hills,
Smooth sweeps, Northern lands, Earth-like, Wooded mosaic and Scattered landmarks.
For applicable human domains, use Overlapping regions and Regional states.
Magic preserves its authored recipe until a particular outcome is selected.
These defaults apply to new drafts. Imported authored recipes keep their values.

## Current climate and ecology that the design uses

Source bodies reviewed for this revision include:

- [Latitude and rainfall implementation results](LATITUDE-RAIN-PLAN.md#results-2026-10-21-executed-on-the-users-request-execute-all-phases-of-the-plan),
  [public parameters and anchors](../packages/generation/src/atlasParameters.ts),
  [profile bindings](../packages/generation/src/canonry/atlasProfile.ts) and
  [latitude mapping](../packages/generation/src/canonry/latitude.ts).
- [Climate](../packages/generation/src/canonry/climate.ts),
  [native physical coefficients](../packages/generation/src/canonry/profile.ts)
  and [land ice](../packages/generation/src/canonry/landIce.ts).
- [Revised ecology model](ECOLOGY-PLAN.md#revised-core-model--2026-10-20-user-clarification),
  [ecology forcing and integration](../packages/generation/src/canonry/ecologyProcesses.ts),
  [soil and water](../packages/generation/src/canonry/ecologySoils.ts),
  [plant growth](../packages/generation/src/canonry/ecologyGrowth.ts),
  [disturbance](../packages/generation/src/canonry/ecologyDisturbance.ts),
  [water crossings](../packages/generation/src/canonry/ecologyCrossing.ts) and
  [functional groups](../packages/generation/src/canonry/ecologyGroups.ts).
- [Magic recipes](../packages/domain/src/magicPresets.ts),
  [magic effects](../packages/domain/src/magicSystems.ts),
  [ecological transformation](../packages/generation/src/canonry/ecologyMagic.ts)
  and [human generation](../packages/generation/src/mapPeople.ts).
- [Magic source authority](../AGENTS.md#magic-source-authority),
  [product contract 10.3](product-spec.md#103-magical-generation--fire-aurora-and-pressure)
  and the [society adaptation](SOCIETY-GENERATION-PLAN.md#magic-sources-and-evidence)
  supersede earlier generic magic proposals. They distinguish implemented
  geography, reference motivations and proposed social operations.
- [Existing default epochs](../frontend/src/atlasState.ts) and the
  [shared sequence](../packages/generation/src/canonry/atlasSequence.ts).

The relevant implemented behavior is:

1. Latitude coverage is independent of map dimensions. Equal-area latitude
   spacing is available. Full-globe climate can wrap east–west while terrain,
   rivers and editor geometry stay planar. Regions inherit the world frame.
2. Insolation, elevation, maritime transport and ocean surface anomalies shape
   temperature. Prevailing winds, rain belts and uplift shape precipitation.
   The selected baseline temperature is not the temperature of every cell.
3. The shared rainfall anchors are Dry `0.07`, Mixed `1`, Wet `2`.
   Rainfall scales column moisture supply and the precipitation baseline,
   not the former orographic coefficient or all rain output. The current ceiling
   is 4000 mm/year. Per-epoch ecological rainfall remains an additional multiplier.
4. Plant moisture uses precipitation relative to potential evaporation:
   `min(1, annual precipitation / max(.25, .3 + .045 × temperature°C))`.
   Column relative humidity is not substituted for plant-available water.
5. Seasonal temperature range varies with latitude and continentality. Ecological
   seasonality scales that range relative to its neutral value of `.3`; it also
   affects drought and soil water. Seasonal wind reversal and monsoon weather are
   not simulated.
6. Vegetation grows from living groups and seed banks, competes for resources,
   matures and dies. Soil, canopy age and damage persist. Wind-borne seeds,
   ocean rafting and animal crossings connect islands, with group-specific
   distances and waiting times. Newly formed or disturbed islands need arrivals;
   suitable climate alone does not instantly supply a mature forest.
7. Floods on suitable floodplains/deltas kill susceptible cover and seedlings,
   remove seed, and supply nutrients. Fire depends on fuel, drought and wind.
   Grazers, browsers, predators and aquatic consumers respond to food and habitat.
8. Ice extent now follows mass balance and local conditions, not the former land
   coverage quota. Glaciation strength changes growth; ecological time is not
   a replacement for native physical pass strength.
9. Magic can affect growth, fire, adaptation, dispersal, toxicity and alteration
   through the existing effect contract. The shipped Fire/Aurora/Pressure recipes
   do not currently configure ecological alteration. Upwelling already supports
   aquatic productivity without another creator control.

These mechanisms are present in source. That does not establish calibration of
the combined choices proposed here. The latitude/rainfall work also records
remaining post-glacial barren ground and substantial equatorial grassland; the
new labels are geographic intentions to evaluate, not certified biome outcomes.

## Mapping conventions

Lowercase identifiers denote existing public scalar settings. A dagger (†)
denotes an existing native profile coefficient, now bound through its owner's
typed `configuration.profile`. Twenty-eight native coefficients are bound this
way. They do not acquire separate creator controls or display attributes; the
workspace consumes them through the existing initializer, not a new generator.

All choices resolve from one immutable reference vector: the current atlas
defaults and applicable registered system recipes at `66eded2`. Unlisted
coefficients retain those defaults. Do not multiply already customized results
or let selection order decide the outcome.

Values below are the implemented vectors. Checks establish the bounded outcomes
in the execution record, not universal results across climates, seeds or scales.
Length values are metres unless a row says km. They start from the current
reference extent of 4000 × 3000 km; response at other map sizes and seeds remains
unmeasured. There is no new size restriction or automatic scaling rule.

The tables specify discrete alternatives. Interpolation between unrelated
categories is not proposed. Classification thresholds, numerical ray counts and
solver iterations stay fixed. Actual material and water budgets remain binding.

## 1. Land and sea

| Mapping target                        | Broad continents | Broken continents | Island world |
| ------------------------------------- | ---------------: | ----------------: | -----------: |
| `continents`                          |                2 |                 4 |           10 |
| `provinces`                           |               24 |                42 |           70 |
| `landFraction`                        |              .68 |               .48 |          .28 |
| `seaLevel`, m                         |              -60 |                 0 |          +60 |
| `ContinentalAssemblySeparationDepth`† |              .20 |               .38 |          .50 |
| `ContinentalWarpStrength`†, km        |              100 |               180 |          260 |

One decision owns assembly, fragmentation and exposure because together they
describe the land/water distribution seen on the map. This deliberately absorbs
the earlier separate land–sea balance control. It does not claim that crust
fraction equals final land coverage or that ten assemblies yield ten islands.

The cost of that reduction is that every unusual arrangement/exposure pairing
is not a separate curated choice. The underlying typed recipe remains capable
of representing different supported values; this does not restore a parallel
catalogue of creator controls.

## 2. Terrain

This decision coordinates relief with the valleys and deposited surfaces that
belong to it. It absorbs structural relief, fluvial dissection, sediment
retention, floodplain dimensions and the glacial-inheritance mapping.

| Mapping target                         |   Wide plains | Rolling hills | Mountain ranges | Glacier-carved |
| -------------------------------------- | ------------: | ------------: | --------------: | -------------: |
| `plateDrift`                           |           .15 |            .6 |             1.2 |             .7 |
| `InteriorReliefStrength`†              |           .06 |           .14 |             .25 |            .16 |
| `ElevationVariationStrength`†          |           .06 |           .12 |             .16 |            .12 |
| `EpochTectonicElevationStep`†          |            60 |           160 |             320 |            160 |
| `InitialOrogenicConstructionStep`†     |           400 |          1600 |            3600 |           2200 |
| `EpochOrogenicConstructionStep`†       |           150 |           500 |            1400 |            600 |
| `OrogenicProminenceMinimum/Maximum`†   |      350/1000 |      350/1000 |        800/2200 |       500/1400 |
| `OrogenicRootBudgetMinimum/Maximum`†   |      400/1200 |      800/2400 |       1600/4400 |      1000/2800 |
| `MaximumOrogenicSurfaceReliefPerPass`† |           400 |          1000 |            1600 |           1200 |
| `erosion`                              |           .25 |            .7 |             1.5 |             .7 |
| `FluvialEquilibriumGradient`†          |         .0012 |         .0008 |           .0004 |          .0008 |
| `SedimentTransportFraction`†           |           850 |           760 |             650 |            760 |
| `MaximumSedimentDepositionPerPass`†, m |            30 |            18 |              12 |             20 |
| `FloodplainMaximumWidth`†, km          |            25 |            15 |               8 |             15 |
| `glaciers`                             |            .3 |            .5 |              .7 |            1.2 |
| Tectonic activity, three epochs        |  [.15,.1,.03] |    [.6,.3,.1] |     [1,.65,.25] |     [.7,.3,.1] |
| Ice activity, three epochs             | [.25,.25,.25] | [.25,.25,.25] |   [.25,.25,.25] |      [.2,1,.3] |

Prominence is dimensionless in the native implementation; root budget is crustal
thickness. Higher sediment capture means more deposition, despite the native
`SedimentTransportFraction` name. Floodplain slope/relief eligibility and minimum
river discharge remain fixed. Plains do not mean no mountains or no incision;
ranges still feed lowland rivers and plains. Cold mountains may carry glaciers
under any terrain choice.

Use the existing three epoch identities, Formation / Cold age / Present. They
are internal history inputs, not wizard stages. The ordinary terrain choices
use a neutral temperature offset and sea-level offset in all three epochs, with
1000-year durations. Their middle epoch retains its existing stable ID even
when no extra cold excursion is assigned.

Glacier-carved modifies that same skeleton:

| Historical input                       |       Formation | Cold age |         Present |
| -------------------------------------- | --------------: | -------: | --------------: |
| Effective global reference temperature | Selected warmth |    -12°C | Selected warmth |
| Sea-level offset, m                    |               0 |      -60 |               0 |
| Duration, years                        |            1000 |     1000 |             200 |
| Ecology rainfall modifier              |               1 |       .8 |               1 |
| Ecology productivity modifier          |               1 |       .4 |             1.2 |
| Ecology fire modifier                  |               1 |       .2 |               1 |
| Ecology migration modifier             |               1 |       .5 |             1.5 |
| Ecology recovery modifier              |               1 |       .5 |             1.5 |

The cold reference is a global baseline, not a uniform cell temperature. Encode
it as `epoch.temperature = 15 + (-12 - selected temperature)`. Neutral epochs
store `15`. Sea-level offsets add to Land and sea's present level.

The shorter recovery period is part of the visible young landscape: bare
deposits, younger canopy and incomplete recolonization can survive into the
present. It does not accelerate geological erosion. The intended pattern is
glacially shaped valleys and deposits where ice actually formed; it does not
force fjords or glaciers into every climate or every coast.

## 3. Shoreline

| Mapping target                | Smooth sweeps | Inlets and headlands | River-mouth flats |
| ----------------------------- | ------------: | -------------------: | ----------------: |
| `CoastalDetailStrength`†      |           450 |                 1500 |               350 |
| `CoastalDetailScale`†, km     |           100 |                   45 |               100 |
| `CoastalDetailWarp`†, km      |            10 |                   35 |                 8 |
| Margin amplitude multiplier†  |            .4 |                  1.3 |               .35 |
| `coastalErosion`              |           1.2 |                   .5 |               .35 |
| `CoastalDepositionFraction`†  |           700 |                  500 |               850 |
| `CoastalDepositionReach`†, km |            25 |                   15 |                35 |
| `DeltaMaximumRadius`†, km     |            20 |                   30 |                45 |

The amplitude multiplier applies once to passive/convergent/rifted/transform
defaults of 62/88/74/34 metres. Smooth sweeps combine broader, weaker detail
with stronger reworking. Inlets retain stronger, finer initial detail under
weaker reworking. River-mouth flats favour retention and spreading of delivered
sediment while reducing small-scale shoreline displacement.

This is a visible-outcome grouping of construction and reworking, replacing
their earlier compulsory split. It does not change inland incision settings or
invent sediment. Delta supply, wave-energy and slope eligibility stay fixed.
River-mouth flats can be sparse on dry or steep terrain. They are not a promise
of sand, beach composition or blanket coastal wetlands.

## 4. Climate coverage

| Mapping target       | Northern lands | Two hemispheres | Pole to pole |
| -------------------- | -------------: | --------------: | -----------: |
| `southLatitude`      |             10 |             -70 |          -90 |
| `northLatitude`      |             70 |              70 |           90 |
| `latitudeProjection` |              1 |               1 |            1 |
| `wrapLongitude`      |              0 |               0 |            1 |

These use the current frame alternatives and equal-area mapping. Northern lands
cover tropical margins through northern cold zones; Two hemispheres includes
the equator and mirrored latitude belts; Pole to pole includes both polar caps.
Coverage never derives from map kilometres. Full-globe wrap is climate-only.

The typed configuration still supports other valid edge latitudes. This mapping
does not remove that capability or make regions choose their own frame.

## 5. Warmth

| Mapping target                     | Cooler | Earth-like | Warmer |
| ---------------------------------- | -----: | ---------: | -----: |
| `temperature`, global reference °C |      5 |         15 |     23 |

This remains independent of coverage because a complete globe may be colder or
warmer. At the current insolation strength, the annual-mean latitude contribution
is about +14°C at the equator and -28°C at a pole before altitude, transport,
ecology and magic. Thus Cooler does not assign 5°C to every cell, and Warmer still
retains a latitude gradient.

Do not also multiply vegetation by the former thermal productivity table.
Existing plant suitability, evaporation, snow partition and ice respond to the
changed climate. Those mechanisms provide the correlated consequences.

## 6. Living landscape

| Mapping target                          | Dry and sparse | Seasonally open country | Wooded mosaic | Humid woodland |
| --------------------------------------- | -------------: | ----------------------: | ------------: | -------------: |
| `rainfall`, moisture-supply anchor      |            .07 |                       1 |             1 |              2 |
| `vegetation`, productivity multiplier   |             .8 |                      .9 |           1.5 |            2.5 |
| `grazing`, carrying-capacity multiplier |             .8 |                     1.4 |            .5 |             .1 |
| Ecology seasonality                     |             .3 |                     .65 |            .3 |             .2 |
| Ecology fire                            |             .5 |                       2 |             1 |            .35 |
| Ecology productivity baseline           |              1 |                       1 |             1 |              1 |
| Ecology rainfall baseline               |              1 |                       1 |             1 |              1 |
| Ecology migration baseline              |              1 |                       1 |             1 |              1 |
| Ecology recovery baseline               |              1 |                       1 |             2 |              3 |

Dry and sparse preserves the newly calibrated Dry anchor. It does not use the
obsolete .2 arid value. Seasonal open country and Wooded mosaic intentionally
share annual moisture supply: their contrast comes from seasonal stress,
disturbance and herbivory rather than claiming that all open land is dry.
Humid woodland increases available moisture and growth while lowering recurring
disturbance and browsing pressure.

This replaces separate rainfall, cover/productivity, grazing, fire, recovery
and migration choices. Migration stays neutral except for the explicit glacial
history. Woodland outcomes coordinate soil recovery with growth and reduced
browsing: rain alone did not restore a canopy on repeatedly scoured soil in
the reference maps. The ecological groups, wind/current crossing
distances, founder rules, nutrient limits and biome thresholds do not change.

The intended outcome is conditional on geography. Humid cold land can support
boreal communities; humid tropical land can support rainforest; low wet ground
can support marsh/swamp. None is painted from the selected label. Ice-covered,
newly disturbed or isolated ground may remain sparse. Seasonal open country
does not claim seasonal monsoon circulation or simulated seasonal rain.

Final forcing is composed, not overwritten:
`productivity = vegetation × epoch ecology.productivity`;
the ecology epoch fields equal the selected baseline multiplied by any explicit
terrain-history modifier. Native precipitation uses the public supply anchor
and the additional epoch rainfall multiplier. Grazing remains its public
carrying-capacity multiplier; it is not an imposed animal population.

## 7. Distinctive landmarks

| Mapping target            | Rare | Scattered | Prominent |
| ------------------------- | ---: | --------: | --------: |
| `volcanism`               |  .25 |        .7 |       1.3 |
| `MantlePlumeCount`†       |    1 |         2 |         4 |
| `impacts`, initial budget |    1 |         3 |         7 |
| `impactSize`              |    1 |         1 |         1 |

The shared meaning is the prevalence and prominence of distinctive volcanic and
crater sites in the background landscape. This is deliberate artistic curation,
not a claim that volcanism causes impacts. It absorbs the earlier two controls.
It never becomes volcanic/impact/both/none, and every level retains both
mechanisms.

Keep plume radius, crater-radius distribution and placement spacing at current
defaults. Use `ImpactPrimordialShare`† = 1000 and zero epoch impact multipliers,
so the initial budget is not multiplied by the current minimum-event rule.
Volcanic epoch activity is [1,.4,.1] across the existing three epochs. Native
cone/apron/caldera magnitudes use their existing public scalar binding exactly
once. Background mountain construction remains owned by Terrain.

Placement constraints may reduce actual counts. New construction also disturbs
soil and vegetation through the current ecology; lowland cover is not separately
erased by this mapping.

## 8. Fire, Aurora and Pressure

### Source authority and withdrawn proposals

The 2026-10-22 [magic source authority](../AGENTS.md#magic-source-authority) and
[product contract 10.3](product-spec.md#103-magical-generation--fire-aurora-and-pressure)
govern this section. They supersede the earlier generic six-dimension template,
universal Living response menu and 17-magic/26-total decision counts. The control
inventory must follow the three systems' actual behavior; no fixed count or
identical set of controls is required.

Reference bodies reviewed in the preceding investigation were the local
Canonry lore bible section 7, the Three Fires entry, physical generation design
sections 8–11, and the relevant Fire, Aurora, Pressure and feedback/interaction
layer bodies. Lore supplies motivations; code establishes implemented geography.
Do not import named gods, peoples, places, artifacts, historical events or the
reference's global ice age.

The current three are first-class authored world effects with distinct media,
state, propagation and consequences. Shared contracts remain useful, and
system-specific operations are permitted where needed. Future systems remain
open; adding one must not require reducing these three to interchangeable
source/effect combinations or building a speculative universal spell framework.

The numerical groups below reuse existing parameters and earlier candidate
values. Model checks establish their directional effects on the physical fields;
they do not introduce new default recipes.
Retain each system's current recipe unless a creator explicitly chooses a
supported alternative. Settings controlling source identity and causal phase
are not arbitrary style knobs.

### Fire: cores, connected veins, heat and hardened terrain

| Proposed outcome decision | Alternatives                                   | Mapping group and reason                                                                           |
| ------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Core-site prevalence      | Isolated / Scattered / Plentiful               | Source threshold, separation and source budget determine the distribution of geothermal core sites |
| Thermal reach             | Near veins / Across districts / Across regions | Conductive propagation determines how far connected thermal geography extends                      |
| Heat and thaw             | Mild / Pronounced / Intense                    | Coordinate heat, melting and fire exposure rather than changing unrelated ecological traits        |
| Hardened terrain          | Subtle / Pronounced / Strong                   | Rock hardening changes the resistance consumed by erosion and the resulting landform imprint       |

| Target                            | First alternative | Middle alternative | Last alternative |
| --------------------------------- | ----------------: | -----------------: | ---------------: |
| Core-site sourceThreshold         |               650 |                500 |              400 |
| Core-site maximumSources          |                24 |                 48 |               96 |
| Core-site sourceSpacing, km       |               120 |                 90 |               60 |
| Thermal-reach baseCost            |                12 |                  6 |                2 |
| Thermal-reach conductanceDivisor  |                16 |                 26 |               40 |
| Heat-and-thaw heat coefficient    |               .09 |                .36 |              .72 |
| Heat-and-thaw iceMelt coefficient |              .125 |                 .5 |                1 |
| Heat-and-thaw fire coefficient    |                .2 |                 .8 |                1 |
| Hardened-terrain rockResistance   |               225 |                900 |             1800 |

Each group owns only its named targets. Many localized cores and a few
long-reaching vein networks remain distinct combinations. The geothermal
source fallback means Isolated is not a promise of an exact source count.
Heat and water can support vegetation indirectly; no generic fertility,
adaptation, blight or transformation coefficient is added to Fire.

Geographic source intensity is not an extractable core inventory. Mines,
transport, controlled release, depletion, burns and works belong to the proposed
social adaptation, with separate state where implemented. Do not infer unlimited
fuel from an intensity field or extinguish the geothermal source when a stock of
cores is consumed.

### Aurora: coldward accumulation, ice reservoirs and softened terrain

| Proposed outcome decision | Alternatives                                              | Mapping group and reason                                                                         |
| ------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Charge-bearing terrain    | Limited / Widespread / Extensive                          | Cold/elevation source input changes where charge enters the existing coldward accumulation       |
| Ice-capture pattern       | Local reservoirs / Intermediate / Continued coldward flow | Ice capture versus onward transport changes concentration along the actual cold-gradient network |
| Softened terrain          | Subtle / Pronounced / Strong                              | Rock weakening changes weathering and erosion response                                           |

| Target                                | First alternative | Middle alternative | Last alternative |
| ------------------------------------- | ----------------: | -----------------: | ---------------: |
| Charge-bearing terrain baseInput      |               280 |                360 |              420 |
| Ice-capture iceRetention              |               600 |               1200 |             1800 |
| Ice-capture coldRetentionDistance, km |                 4 |                 10 |               18 |
| Softened-terrain rockResistance       |              -130 |               -520 |            -1040 |

Keep the current logScale and accumulationArea unless their geographic purpose
is separately established. Greater iceRetention here reduces capture for the
same ice thickness; it is not a direct percentage of ice coverage or crystal
storage. The source envelope and capture pattern remain independent. Aurora
follows cold geography; it does not automatically create that cold or become
an offensive cooling beam.

Charge in the geographic field, physically retained accumulation, stored
numerical intensity, crystal charge and readable ice-memory are distinct.
Crystal collection, repositories, reader capacity and perception are proposed
social operations, not outputs already established by the current scalar fields.
Aurora does not receive a generic fertility or hostile-ecosystem selector.

### Pressure: deep source, ocean paths, coastal stress and old wakes

| Proposed outcome decision | Alternatives                           | Mapping group and reason                                                                      |
| ------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------- |
| Ocean influence extent    | Nearby / Basin-spanning / Far-reaching | Ray, coastal and wake travel lengths plus beam width shape the footprint over connected ocean |
| Coastal stress            | Subtle / Pronounced / Severe           | Scale the existing coastal-forcing effect with its real ocean, wave and current inputs        |
| Ancient wake prevalence   | Sparse / Scattered / Frequent          | Change the number of historical wake starts, not the numerical angular sampling               |
| Rogue-impact prevalence   | Sparse / Scattered / Frequent          | Change coastal impulse starts while retaining their specific Pressure cause                   |

| Target                              | First alternative | Middle alternative | Last alternative |
| ----------------------------------- | ----------------: | -----------------: | ---------------: |
| Ocean-extent rayDistance, km        |              1200 |               2200 |             3600 |
| Ocean-extent coastalRayDistance, km |               400 |                700 |             1100 |
| Ocean-extent wakeDistance, km       |               600 |               1000 |             1600 |
| Ocean-extent beamWidth, km          |                12 |                 18 |               24 |
| Coastal-stress coastalForcing       |               .25 |                  1 |                2 |
| Ancient-wake wakeSources            |               130 |                260 |              520 |
| Rogue-impact coastalSources         |               100 |                200 |              400 |

The deep-ocean locus remains one geographically selected source. Do not invent
a separate source-prevalence slider for it. Retain the current coastalThreshold,
waveAmplification, currentAmplification and standing rayCount for these choices.
Bathymetric reflection and overlap remain causal operations; a reflection/focusing
control requires its own justified mapping rather than a label over source count.

The earlier design incorrectly treated every ocean source count as numerical
sampling. In current magicOcean.ts, wakeSources seeds historical wake paths and
coastalSources seeds rogue coastal impulses; those are distinct from rayCount's
angular resolution. The proposed prevalence controls use that actual distinction.
Counts are budgets, not guaranteed geographic feature counts.

These histories are not queues of new disasters to replay during every society
era. Coastal engineering can change ocean paths and exposure. Practitioners'
deep access, carried charge, communication and directed force are separate
social adaptation work; they are not supplied by a generic mana reservoir.

### History, ecology, interactions and future systems

History choices must preserve each system's meaning. The previous generic
retention/storage table is withdrawn as a ready-made selection for all three.
Current numerical stored influence can feed later intensity, and cumulative
activity can advect with geology. Neither implies mined fuel, crystal capacity,
readable memory or retained practitioner charge. Any proposed persistent forcing
needs a system-specific physical explanation.

Existing per-system magicActivity curves bind to authored epoch identities.
Renaming, insertion, removal and reordering retain the corresponding owned records.
Changing a system's geographic outcomes preserves all systems' activity curves.
No generic ancient/steady/rising history selector is introduced. Do not insert
epochs or reinterpret elapsed years as native physical pass counts.

Ecology responds to actual heat, ice, water, rock, disturbance and other effects
supported by the particular system. The withdrawn Native/Scorched/Flourishing/
Adapted/Transformed/Blighted matrix is not a supported identity menu for Fire,
Aurora and Pressure. The existing declarative ecological coefficients remain
available for a separately justified future system or explicit adaptation;
schema support alone does not establish such an effect for these three.

Preserve the specific interference mechanisms in the product contract:
Fire/Aurora interference, carried Pressure dissipation near Aurora-crystals,
and destructive Fire/Pressure contact. The current geographic predicates for
thermal contact rims, steam fractures and Pressure/Aurora breaches are evidence
of combined conditions, not proof that all suppression, practice costs and
destructive events are implemented. A generic cooperative/hostile choice would
invent unsupported behavior.

Future systems can add their own state, causal operations and publications
through existing shared contracts. They need their own meaningful geographic
mappings. They are not required to use one of these three identities, and the
current three are not required to fit a universal ecological effect menu.

### Independent system inclusion

At initial world creation, Fire, Aurora and Pressure must each be independently
present or absent. Selecting which systems exist is a content decision, not a
substitute for the outcome mappings above. It is compatible with removing
process-switch catalogues from the curated parameter design.

| Absent system | No new contribution from that system                                           | Ordinary geography retained                           |
| ------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------- |
| Fire          | Core/vein magic, heat, melting, hardening and Fire-dependent contact phenomena | Natural geothermal conditions, climate, water and ice |
| Aurora        | Coldward charge, magical rock weakening and Aurora-dependent contact phenomena | Natural cold, ice, water and erosion                  |
| Pressure      | Magical ocean/coastal forcing, wakes and Pressure-dependent contact phenomena  | Natural ocean currents, waves, coasts and hydrology   |

The remaining systems respond to their changed inputs. Removing Fire may leave
more ice available to Aurora; that is expected causal change, not a failure.

The omission contract is:

1. An absent system has neutral initialized active state and contributes no new
   source, forcing, active retained charge or system-owned feature. Its former
   record container must not create a missing-fact failure for the other systems.
2. Disable through the existing enabled setting while retaining valid identities
   and cross-system definitions. Deleting a definition can invalidate references
   or remove unrelated interaction definitions housed inside it.
3. Interactions depend on their actual participants and substrate. Fire/Aurora
   contact must remain possible with Pressure disabled, although today's Pressure
   recipe contains that rule. Interactions requiring an absent participant do
   not occur. Existing code preserves independent rules in disabled containers;
   that behavior must survive future organization changes.
4. Source-location, propagation, physical and ecological feedback, history,
   classification and publication must all respect the same inclusion decision.
   Clearing intensity in one phase is insufficient if another contributor leaks
   forcing or uses stale active state.
5. Keep ordinary physical processes and shared providers needed by other systems.
   Do not silently reactivate a system or disable natural ocean/ice behavior.
6. Absent since creation differs from present dormancy. Dormancy can retain
   historically meaningful consequences; zero source activity is not necessarily
   zero stored influence. Existing-map history editing is outside this plan's
   primary scope and must not be conflated with initial inclusion.

### Omission repair and verification

The 2026-10-22 review found that magicCoastalFeedback did not filter by enabled.
With coastalThreshold zero, a disabled system can contribute wave/current terms
and the positive minimum forcing even after its active intensity is cleared.
Default Pressure's positive threshold does not exercise this case. Implementation
closed the contributor-level gap. Thermal and rock feedback, source location,
propagation, history and advection also honor inclusion. Classification rejects
absent participants even when a rule would otherwise match zero intensity.

The focused cold-propagation test passed. During the design review, the existing
magicDimensions.test.ts case preserving an independent interaction under a
disabled container timed out at the configured 30-second limit on the in-progress
working tree. The failure cause was not established, and it is not evidence that
the interaction assertion passed or failed. On the restored baseline that check
passed in 84 ms. No timeout increase, CI repair or runtime cap was used.

Require small model checks for all eight Fire/Aurora/Pressure inclusion
combinations: none, each single system, each pair, and all three. Cover neutral
absence, finite valid state, required facts, remaining-system execution,
participant-correct interactions and no new disabled-system contributions.
Include coastalThreshold zero, all-off natural geography, and Fire/Aurora with
Pressure disabled. Then use representative initial-world checks for published
geography; eight long browser-generation journeys are not required.

### Execution disposition

- The eleven system-specific mappings are implemented. Small geographic model
  checks exercise core prevalence, conductive reach, thermal/rock feedback,
  charge-bearing terrain, ice capture, ocean extent, coastal stress, wakes and
  rogue impulses. They retain current numerical ray resolution and recipe history.
- Contact predicates remain geographic conditions. Core inventories, crystal
  collection, carried Pressure and practitioner costs remain in the separate
  society workshop; those state models are not controls over implemented fields.
- The lifecycle omission fix and all eight inclusion combinations are covered,
  including real land/ocean adjacency at zero coastal threshold. Natural heat
  density, water and currents remain intact. Fire omission changes Aurora's
  actual heat and ice inputs. The old timeout did not reproduce on the baseline.
- Non-magical bundles retain the documented tradeoffs: exposure is coordinated
  with land arrangement, valley mechanics with relief, and water supply with
  vegetation/disturbance. Coverage/warmth and culture/politics remain independent.
  The current result is twenty outcome decisions (eleven magical); this records
  the inventory and is not an imposed count target.

## Cultural and political patterns

| Cultural target                        | Distinct centers | Overlapping regions | Broad mixture |
| -------------------------------------- | ---------------: | ------------------: | ------------: |
| `cultureCount`                         |                3 |                   6 |             9 |
| One human era, years                   |               50 |                 200 |           800 |
| Era mobility                           |              .25 |                   1 |           1.5 |
| Approximate influence width / map span |             .188 |                .300 |          .517 |

Use `physicalEpoch=null` and `politicalCapacity=1` for these human eras.
The current cultural spread is
`.15 + .15 × sqrt(sum(era years × mobility) / 200)` times map span. These
choices coordinate origin count and overlap scale; they do not merely rename
few/many origins. They describe prevalence fields, not exclusive borders or
simulated migration routes.

| Political target | Broad territories | Regional states | Many small territories |
| ---------------- | ----------------: | --------------: | ---------------------: |
| `polityCount`    |                 3 |               7 |                     14 |

Politics has a narrower supported mapping: territory is essentially nearest-
center reach clipped to land. It does not implement a historical empire,
diplomacy or cultural-border model. That limits the honest choice to the visible
scale of partitions. Cultural and political patterns remain independent.

Built geography stays available through its existing content scope. The current
layout has a fixed maximum of eight settlements plus connecting roads; it has
no defensible density mapping. Do not add a fake sparse/dense choice or relabel
its availability switch as curation. This limitation is not authorization to
remove built generation or implement a settlement simulator.

## Composition and feature ownership

| Decision              | Sole responsibility in the resolved vector                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Land and sea          | Assembly, province count, crust fraction, present sea level and continental warp                                                        |
| Terrain               | Relief, incision, fluvial retention, floodplain width, ice history and recovery interval                                                |
| Shoreline             | Coastal detail, coastal erosion/deposition, potential delta radius                                                                      |
| Climate coverage      | Edge latitudes, projection and climate-only wrap                                                                                        |
| Warmth                | Present global reference temperature                                                                                                    |
| Living landscape      | Moisture supply, productivity, grazing and baseline ecology forcing                                                                     |
| Distinctive landmarks | Volcanic construction, plume count, impact budget and event allocation                                                                  |
| Magical geography     | Distinct Fire, Aurora and Pressure source, propagation, feedback and history mappings; inclusion and interaction ownership in section 8 |
| Cultural pattern      | Cultural origins and human era spread                                                                                                   |
| Political pattern     | Polity count                                                                                                                            |

These are mapping responsibilities, not new process implementations. Several
feature owners can contribute to one decision using the existing contracts.
A newly registered scalar does not automatically create a primary choice.

Keep physical and ecological mechanisms participating across the geography
alternatives. The displayed choice is not a feature-enabled vector. Resolve
existing declared dependencies for the selected content: routing, sediment
budgets, fractures, geothermal state, ice state, ecology and coastal evolution
remain shared inputs as applicable. No reconstruction of the backend or new
workflow interpreter is proposed.

Explicit composition handles overlap:

- Effective epoch sea level = Land and sea level + Terrain's historical offset.
- Effective global thermal baseline = Warmth + correctly encoded epoch offset.
  Latitude, altitude, transport, ecology and magic then supply local effects.
- Living landscape supplies ecological baselines; Terrain supplies only the
  named historical modifiers and durations. Productivities multiply once.
- Magic changes the existing forcing fields at its registered causal phase; it
  never rewrites the selected climate or terrain parameter vector.
- Changing the shoreline cannot reset inland incision. Changing the living
  landscape cannot reset land assembly. Selection order has no effect.
- Feature dependencies follow actual referenced data. Explicit content exclusions
  that contradict a required effect remain conflicts, not silent reactivation.

## Worked compositions

### Maritime woodland

Broken continents + Rolling hills + Inlets and headlands + Northern lands +
Earth-like + Humid woodland + Scattered landmarks.

This resolves, among other fields, to 4 assemblies, .48 starting crust,
temperature baseline 15°C, rainfall supply 2, vegetation 2.5, grazing .1,
ecological seasonality .2, fire .35, soil recovery 3 and erosion .7. Valley deposition cap is
18 m and potential floodplain width 15 km. Shore detail is 1500 at 45 km scale,
coastal erosion .5 and coastal deposition fraction 500.

Coastal temperatures and exposure remain wind/current dependent. Wet lowland
can develop wetland cover, while hills carry a different community. The choice
does not set forest percentage or guarantee a particular biome on each island.

### Formerly glaciated islands

Island world + Glacier-carved + Inlets and headlands + Two hemispheres +
Warmer + Wooded mosaic + Rare landmarks.

Present global reference temperature is 23°C and sea level +60 m. The cold
epoch stores `15 + (-12 - 23) = -20`, producing a global baseline of -12°C
before local contributions. Its sea-level offset -60 m gives absolute sea level
0 m relative to the same datum. The present ecology has only 200 years after
the cold episode, with migration/recovery ×1.5 and productivity ×1.2.

The warm present does not erase inherited glacial terrain. Remote or recently
disturbed islands may remain open, with downwind/down-current colonization and
younger vegetation. Not every inlet is a fjord, and no blanket current ice cover
is imposed.

### Dry plains with deposited coasts

Broad continents + Wide plains + River-mouth flats + Northern lands +
Warmer + Dry and sparse + Rare landmarks.

The dry anchor remains .07, not .2. Terrain supplies weak cutting, capture 850,
deposition cap 30 m and potential floodplain width 25 km. Shoreline supplies
deposition fraction 850 and potential delta radius 45 km. Water and sediment
availability still constrain those potential surfaces: this is not an arid map
with artificial wetland corridors or guaranteed deltas.

## What changed and what remains unresolved

The reduction is deliberate: land arrangement plus exposure becomes Land and
sea; relief plus valley mechanics plus glacial legacy becomes Terrain; shoreline
construction plus reworking becomes Shoreline; rainfall plus ecological forcing
becomes Living landscape. Those bundles are implemented with their documented
expressiveness tradeoffs. Magic's global preset, subsequent identical per-system template
and generic ecological identity menu are withdrawn. Section 8 follows the
specific Fire, Aurora and Pressure contract. Independent geography that creators
need, such as coverage versus warmth and culture versus politics, stays separate.
Ten, seventeen and twenty-six are not acceptance targets.

The earlier candidate vectors were never accepted. Useful coefficients have
been reused above; separate internal axes and obsolete values are not preserved
as competing current designs. In particular, do not restore process bundle
menus, a universal low/moderate/high rule, a separate control for every coefficient,
the .2 Dry anchor, the old ice quota or the assumption that every world starts
with four epochs.

All mapping vectors are executable through feature-owned recipes and the
existing workspace. Typed profile overrides, history bindings and independent
inclusion are implemented. Calibration covers two seeds/extents at Draft detail
and focused system models. It does not establish results over a broad seed
distribution, every combination or Standard/Fine resolutions. Further tuning
should use representative map outcomes rather than form-editing assertions.

Specific unsupported promises remain: beach grain composition, imposed biome or
ice percentages, detailed political history, species-level biodiversity,
settlement density, new oil reserves on demand, and instant mature forests on
new islands. Current coal/oil-related fields depend on organic inputs, burial,
thermal exposure and time; no resource-richness slider is invented here.

Application bindings, curated controls and domain checks changed on the user's
execution request. No generator algorithm, wizard ordering/layout, CI settings or
deployment changed. Verification includes published numerical fields and feature
geometry, rather than form-editing checks alone.
