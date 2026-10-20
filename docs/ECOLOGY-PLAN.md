# Living biomes and ecological epochs

## Contract and sources

The 2026-10-20 request authorizes implementation of evolving biomes, vegetation,
coarse animal life and interactions with existing climate, water, geology and magic.
Individual species are outside scope. Forest → swamp → oil illustrates compounding
consequences; it is not the center of the requested model. Browser-session ownership,
determinism, located geography and authored protection remain required.

Research informing the implementation:

- [Red Blob Games](https://www.redblobgames.com/maps/terrain-from-noise/#biomes)
  illustrates climate/moisture lookup classifications and their limitations.
- [WorldEngine's biome model](https://github.com/Mindwerks/worldengine/blob/master/manual/biomes.rst)
  uses a modified Holdridge temperature/humidity classification with annual
  averages. Its documented placement model classifies environments; it does not
  supply the succession and burial history required here.
- [LPJ-GUESS functional types](https://web.mgeo.lu.se/lpj-guess/education/docs/pft.html)
  represents vegetation as mixtures of groups sharing functional characteristics.
- [Baudena et al.](https://arxiv.org/abs/2304.06445) models plant competition,
  disturbance and fire/vegetation feedback without individual species.
- [USGS coal overview](https://pubs.usgs.gov/circ/c1143/html/text.html) describes
  waterlogged preservation, peat, burial and coalification.
- [USGS Carboniferous petroleum system](https://pubs.usgs.gov/bul/b2211/b2211.html)
  distinguishes terrestrial, mainly gas-prone organic material from oil-prone
  aquatic material and mixed source rocks. Burial, heat and time matter.

The local Canonry reference's `PhysicalGeographyEvolutionSession.cs` and
`NaturalSurfaceLayer.cs` were read. Reuse its shared working map, ordinary process
contracts and interleaved causal phases. Ecology is an atlas extension, not a claim
of numerical equivalence or an existing Canonry vegetation simulation.

## Revised core model — 2026-10-20 user clarification

The user explicitly prioritizes growth, migration, change, interactions with
physical geography and corruption/change by magic within an epoch. Ecological
processes should have causal depth comparable to ice and hydrology. Epochs must
support different ecological regimes, with consequences carried forward.
The initial local cover-response implementation below does not meet that scope.

Use the existing spatial mesh and process contracts, with these connected stages:

1. Soil development, water availability and nutrient recycling respond to climate,
   seasonal stress, drainage, sediment, erosion, litter and glacial disturbance.
2. Grass/shrub, broadleaf, conifer, wetland and magically altered functional groups
   establish from living populations and seed banks. Distance, terrain, water and
   wind control dispersal; suitable empty land cannot create a mature forest
   without a colonization path. Young and mature woody cover remain distinct.
3. Establishment, competition for light/water/nutrients, maturation, mortality and
   litter production alter those populations. The resulting cover determines the
   biome; it is not a prescribed target fraction.
4. Grazers, browsers, predators and aquatic consumers move through connected
   habitat toward food and refuge, consume resources, reproduce and suffer
   starvation/predation. Movement conserves represented biomass before those
   biological gains/losses. Water, ice, slopes and toxic habitat affect passage.
5. Fuel, drought, ignition, wind and wet barriers control fire spread. Flooding,
   glacial advance/retreat, erosion and construction disturb living communities.
   Regrowth depends on surviving soil, populations and seed sources.
6. Magic can transform vegetation and leave inherited cold/drought adaptations
   and toxic/corrupted habitat. Altered vegetation can reproduce and spread;
   changing palatability, animal movement, decay and water use creates physical
   consequences. Direct effects remain configured on ordinary magical systems.

Per-epoch ecological forcing controls seasonality, rainfall, productivity,
disturbance, migration and recovery. Existing temperature, ice, hydrology and
magic activity remain causal inputs. Presets demonstrate wet expansion, dry/fire
periods, cold retreat and recovery, rather than painting a desired biome.
Split ecological response around physical evolution so vegetation affects water
and erosion and later responds to altered water, ice and substrate in the same
epoch. Use analytical cohort/resource responses and physical travel-time fronts;
do not iterate every year of geological history or impose arbitrary runtime caps.

[LPJ-GUESS/LSM](https://gmd.copernicus.org/articles/15/6709/2022/) motivates
functional-group competition, establishment/mortality, canopy shading and coupled
soil water/nutrients. [Coupled Madingley/LPJ-GUESS](https://gmd.copernicus.org/articles/18/9633/2025/)
motivates functional animal groups, consumption and dispersal. These are mechanism
references, not a claim to reproduce those scientific models or their calibration.
The current ice balance, ice transport, glacial erosion/deposition, runoff,
drainage and magical propagation implementations were read for the integration.

Nested execution: `ac194487-761a-4c5e-92a1-51524021082c`, under M2's
Inspectable ecological geography phase. This preserves the existing plan while
correcting its inadequate core model.

- `4b29b89a-ce36-45fd-b20b-1e244b0a44e3`: ecological state and epoch forcing.
  Shared schema/vocabulary, numerical cohorts and resource fields, epoch controls,
  and declarative magical traits. Implemented; consumer typecheck established the
  initial contract before process refinements.
- `60ab5d2a-1de6-44f0-9131-408377eec3fb`: spatial ecological processes.
  `ecologyGroups`, `ecologySoils`, `ecologyEstablishment`, `ecologyMovement`,
  `ecologyGrowth`, `ecologyAnimals`, `ecologyDisturbance` and `ecologyMagic` implement
  actual operations. Focused checks cover propagule-limited colonization, barriers, conserved
  migration, young/mature succession, resource limits, fire spread and inherited
  magical changes. Local-target expectations were revised where they assumed
  ubiquitous flora or spontaneous animals.
- `9656232e-6185-4b35-924e-87c5801ae11d`: integration and representative behavior.
  Ecology advances for half the epoch before incision and half after glacial
  reconciliation. Water reroutes after each response. Rainfall forcing scales
  total precipitation, not only an incidental baseline component. Contrasting
  ecological regimes, history, inheritance and presentation use the existing atlas
  publication and browser workflows.

Retain existing organic pools only as downstream consequences. Do not expand
petroleum geology during this revision. Prior tests are evidence for the initial
implementation, not acceptance of this revised ecological model.

## Initial model — superseded where the revised contract differs

Implementation choices, revisable with evidence:

- Store tree, grass and wetland plant cover; productivity; herbivores, predators
  and aquatic consumers; surface organic carbon; buried terrestrial and aquatic
  carbon; coal, oil and gas; burial depth and thermal history in numerical fields.
  Biomes describe actual cover and water conditions separately from landform.
- Use analytical growth/turnover responses to epoch duration in years. Do not run
  millions of annual steps. Carry the altered state into the next epoch.
- Waterlogging uses present drainage, water depth, slope and moisture. Submergence,
  freezing, drought, erosion and fire cause mortality. Grazing and predation feed
  back on vegetation and animal abundance; aquatic production feeds aquatic life.
- Vegetation changes interception/evapotranspiration and erosion resistance during
  subsequent physical passes. Existing magical heat changes viability, burning and
  burial temperature. Add declarative growth, fire and preservation effects to the
  existing magic-system contract; allow feature rules to inspect ecology fields.
- Preserve plant and aquatic carbon separately. Anaerobic wetlands retain peat;
  productive lakes/shelves accumulate aquatic carbon. Actual sediment gain buries
  organic material; erosion exhumes it. Heat and geological time mature the mixed
  source into coal, oil and gas. These fields describe in-place source potential,
  not discovered reserves or a petroleum migration/trap simulation.
- Use one effective buried horizon per cell, with mass-weighted depth and thermal
  exposure. This is a map-scale approximation; it does not resolve stratigraphy.
- Numerical fields use existing remeshing, plate transport, inheritance and
  projection. Manual woodland polygons seed and protect located cover. Publish
  biome fields and forest/wetland features through existing spatial reconciliation.
- Existing physical history uses years (default 1,000). Coal/oil formation normally
  needs much longer durations and burial; no automatic conversion based on age alone.

## Milestones and Sulion mapping

Root: `029f8f3c-1c7b-405e-81f5-383e41d153eb`.

### M0 — Research and model contract

Phase `dae3e3c3-acb1-4bd6-a740-5901c5baa178`. Read generator, epoch, material,
magic, authoring and display contracts; select the model above. Source review is
the evidence. No backend or new simulation framework is needed.

### M1 — Evolving ecological geography

Phase `19055093-46a3-43fa-8454-294ba3dc6e0f`; depends on M0. Implement the
functional groups, succession, trophic feedback, disturbance, carbon burial and
maturation in ordinary atlas processes. Integrate physical feedback, magic,
inheritance, remeshing and material transport. Behavioral tests must distinguish
forest/wetland succession, dry decay versus wet preservation, insufficient burial
or time, aquatic versus terrestrial sources, heat, grazing and disturbance.

#### Execution steps

Expansion `89b02234-1d6c-4ab7-b780-053d8415c15a`.

1. Ecological state and succession (`43ce992c-22a8-4ff5-a676-e28613943c32`).
   Add shared biome vocabulary and numerical ecological state in `packages/domain`
   and `packages/generation/src/canonry/ecology*.ts`. Implement plant functional
   cover, trophic responses and carbon pool transitions. Verify with controlled
   environmental sequences, mass balance and timescale tests.
2. Physical and magical integration (`8128ee92-51d9-4030-a324-3e2464880e84`),
   depends on step 1. Interleave ecology with `atlasSequence`, use existing
   authored composition and material transport, and extend declarative magic.
   Verify runoff/erosion feedback, inheritance, remeshing and magic-driven changes.
   Shared typecheck/lint must cover both steps before completing them.

### M2 — Atlas presentation and integration

Phase `47556d17-3f14-4db0-aacc-ba6c38463dad`; depends on M1. Publish usable
biome and resource fields, forest/wetland features and causal epoch history.
Expose ordinary creator controls and magic effects. Display meaningful biome
colors and names. Check representative generation, domain protections, frontend
consumers, typecheck, lint and build. Extend existing usage/generation documentation.

#### Execution steps

Expansion `f8519b86-67a3-483b-8201-97baf78da5bf`.

1. Inspectable ecological geography (`33d066c1-eab1-4373-adae-74dc41ce1ca4`).
   Wire built-in ecology layers, field publication, forest/wetland extraction,
   biome color lookup and categorical legends into existing atlas components.
   Expose vegetation and grazing parameters and magic effect labels. Verify
   publication, OpenLayers expressions, categorical sampling and feature identity.
2. Representative map validation (`8327f2f3-1c32-4f2a-ada9-b2b08b971138`),
   depends on step 1. Run real world generation and focused browser journeys,
   unit suites, typecheck, lint and production build. Document timescales,
   feedback and effective-horizon limits in the generation guide.

## Current state

The revised functional ecology, epoch controls, physical and magical feedback,
field publication, categorical cartography and authored protection are implemented
in the current workspace. The nested core revision supersedes the initial local
cover-response implementation. The generation guide describes the resulting
behavior and its fidelity limits, including two biological responses per epoch,
coarse feeding/nutrient constraints and one altered functional group per cell.
Implementation and the GIS integration follow-up are complete.

## GIS integration follow-up

The user's follow-up authorizes repairing the GIS/display gaps identified in the
review. Plan `446c0ab8-1060-4014-a0f1-68d820eabadc` covers publication/identity and
legend correctness, land-biome polygons and styling, then integrated checks.

Magic-only generation publishes current ecological channels and replaces obsolete
generated ecological polygons while retaining terrain and protected geography.
Ecological source tags participate in the existing spatial identity association.
Authored biome samples govern both classification and extracted polygons.
The categorical legend queries composed fields and finer coverage. Remaining
open-land biomes publish through the same polygon path, and default vector colors
and GeoStyler rules share the biome palette. The browser journey uses the actual
polygon extractor on controlled communities, then selects, edits, protects,
refines and exports those features. Full generation also exercises a subsequent
magic-only transformation and publication.
