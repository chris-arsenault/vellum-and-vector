# GIS/domain-backed generation workflows

Current execution follows [ADR 0003](adr/0003-frontend-session.md): a browser worker
uses in-memory inputs and returns complete validated geography. No persistent
state, restart, recovery, backend or MCP is part of this product phase.

This is the generation direction for Vellum & Vector. The
[product contract](product-spec.md#10-procedural-generation-domains) defines
behavior; [ADR 0002](adr/0002-relational-spatial-storage.md) records application
boundaries. User requirements and explicitly agreed constraints govern changes
to the implementation choices described here.

## Reference parity requirement

The user's explicit requirement is **semantic algorithm parity**, not numerical
equivalence to Canonry. Compare the operations inside each process: the causes
it reads, transformations it applies, feedback it supplies, state it carries
between epochs and geography it produces. Preserve those mechanisms and their
causal relationships while adapting units, parameters and representations to the
atlas. A matching process name or a passing numerical fixture is not sufficient.

Matching output values, hashes, seed mappings, rounding and arrays is not an
acceptance target. Do not pursue such matching during metre conversion or treat
its absence as missing algorithmic work. Existing reference fixtures remain
regression aids. Numerical differences matter when they change a required
mechanism, physical meaning, creator control or useful geographic behavior.
Deterministic generation within the atlas remains required.

The source inventory below distinguishes present operations, concrete semantic
gaps and atlas adaptations. It supersedes the earlier emphasis on numerical
counterexamples as evidence of incomplete generation.

## Structure and reference

Use Canonry's generation structure and algorithms as the baseline: configured
process sequences operate on a shared working map, check required facts, apply
changes, validate results and update fact validity. Adapt that structure to the
atlas's TypeScript GIS/domain model.

Registered processes can perform GIS operations, initialize fields, evolve
terrain, propagate magic, change populations or generate features. They share
one application/validation contract. A map profile selects processes, their order,
typed settings and an epoch schedule. Repeated uses of an implementation have
distinct invocation identities.

Use ordinary TypeScript composition for reusable sequences, conditional work and
epoch loops. Implement actual physical, magical and GIS processes through the
common context and let their needs establish shared interfaces. Extend the
reference structure for a concrete map behavior that the simpler approach
cannot satisfy, with the reason recorded as an implementation choice.

## Shared working state

A run starts from pinned world/area revisions, a geographic footprint and located
space, inherited boundaries, relevant parent/neighbor inputs and its effective
profile configuration. Its private working state includes:

- Fields and numerical channels with coverage, resolution and units.
- Features, finer representations, entities and relationships.
- Networks, junctions, access connections and fixed crossings.
- Traits, authored protections and magical definitions.
- Historical states, forcing and accumulated consequences.

Keep working arrays, indexes and numerical scratch data in memory. Resource
references identify committed numerical inputs and retained historical results.
Processes share typed domain state directly.

The context provides scoped GIS/domain access: intersection, containment,
distance, sampling, resampling, network traversal and domain inspection. Include
declared neighboring influence when loading inputs. Later processes read the
altered working map. Each field and feature retains its CRS, space, extent,
resolution where applicable, units and relevant historical lineage.

The working map stays private while processes evolve it. Validation applies the
same stable identity, boundary, trait, authored-protection and connection rules
as ordinary authoring. Final publication establishes committed authority.

## Common process contract

| Contract element | Meaning                                                                                        |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| Identity         | Registered process and implementation version; invocation identity distinguishes repeated uses |
| Parameters       | Typed settings, defaults, units and validation                                                 |
| Working state    | Domain fields, features, networks and history read or changed                                  |
| Facts            | Required, produced and invalidated facts within the applicable scope and time                  |
| Scope            | Geographic extent, located space, boundary ownership and neighboring influence                 |
| Randomness       | Deterministic invocation/epoch seeds, with stable seeds for persistent structures              |
| Lifecycle        | Apply to working state, then validate the resulting domain behavior                            |
| Result           | Changed geography, fact validity, meaningful causes and diagnostics                            |

The target interface has this shape; concrete state/context types follow the
actual process needs:

```ts
interface GenerationProcess<Parameters> {
  readonly contract: ProcessContract<Parameters>;
  apply(state: GenerationState, context: ProcessContext<Parameters>): Promise<void>;
  validate(state: GenerationState, context: ProcessContext<Parameters>): Diagnostic[];
}
```

The runner resolves settings, checks required facts, applies the process,
validates its result and updates produced/invalidated facts. An invalid result
fails the run without publishing its partial geography. A long numerical process
can split work internally to report progress and observe cancellation.

## Profile configuration and parameters

A profile's versioned configuration identifies registered process invocations,
their order, typed settings, reusable sequences, applicable extent and epoch
schedule. World presets, mapped areas and explicit job parameters specialize
profile defaults. Template recipes can select a compatible configuration for a
placed instance.

Resolve settings from workflow parameters, current epoch variables and explicitly
selected prior domain consequences through typed TypeScript configuration.
Validate effective values and units when their inputs become available.
Conditional work must supply the facts required by the subsequent sequence.

| Context      | Applicable composition                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| World        | Initialize broad geography; evolve physical/magical epochs; derive present features and human geography |
| Region/Local | Resolve parent history, neighboring influence and fixed interfaces; evolve finer local state            |
| Site         | Resolve terrain/access; evolve settlement and construction; derive parcels, structures and connections  |
| Cave         | Resolve substrate, fractures, water and inherited epochs; evolve dissolution, collapse and deposits     |
| Interior     | Bind a located frame/access; lay out spaces; apply occupation/change episodes and derive furnishings    |

These are configurations of the same process model. An arbitrary registered
process participates through the common contract, including at several profiles
or several causal positions in one sequence.

## Epochs and causal feedback

An epoch loop initializes its working map once, then executes the configured body
for each epoch. Epochs have stable identities, duration where meaningful, parent
historical context and typed variable assignments. Reusable sequences can contain
nested loops when physical or human history needs them. Other cycles have
explicit initial state and an exit condition over completed results.

Before each epoch, resolve its variables from defaults, assignments and selected
prior consequences. Hold this context fixed while its processes alter the map.
Carry terrain, material history and stored magical influence forward. Reset
epoch-local forcing such as a heat buffer. Physical and magical processes
accumulate their own typed consequences, including erosion, deposited material,
stored cold and occupation history.

A landscape sequence follows Canonry's causal interleaving:

1. Apply geology and carry stored magical history with moved material.
2. Derive climate, apply heat/material feedback and refresh affected facts.
3. Apply drainage, erosion, ice response and necessary climate/drainage refreshes.
4. Apply cold/ocean influences at the positions where physical processes consume them.
5. Evolve coasts and retain the epoch's geographic consequences and causes.

Profiles provide changed forcing for each epoch, for example:

| Epoch          | Temperature offset (°C) | Sea-level offset (m) | Heat-source multiplier | Cold-source multiplier |
| -------------- | ----------------------: | -------------------: | ---------------------: | ---------------------: |
| Warm period    |                      +4 |                   +8 |                    1.2 |                    0.1 |
| Glacial period |                     -10 |                  -30 |                    0.3 |                    1.5 |
| Present        |                       0 |                    0 |                    0.6 |                    0.4 |

User-authored magical definitions configure sources, propagation, storage/decay,
interactions and effects in these processes. Keep natural background, applied
forcing and retained consequences distinguishable. Magic changes the physical
facts consumed downstream.

Child history starts from the applicable retained parent historical state and
forcing. Advance finer local processes through corresponding epochs while
preserving fixed spatial interfaces and parent-history mappings. Human eras
can reference physical epochs and supply their own durations and variables.
Ordinary present-day edits preserve completed history.

## Fact validity and selected generation

The configured order expresses causal dependencies. Required facts detect an
invalid order or a missing refresh. Fact validity includes world revision,
extent, located space, resolution and time. Identify stale or missing inputs
with the affected process, fact and scope.

Selected-domain generation uses valid retained inputs and the configured
producers/refreshes needed for its requested results. Existing valid geography
can satisfy prerequisites. Present and historical work identify their temporal
context explicitly. Processes preserve authored work and stable feature identity
through refinement and regeneration.

## Session execution and publication

The worker receives the current session snapshot, configuration, seed and scope.
Status, stage progress and failure diagnostics live in memory. Terminating the
worker cancels generation. Closing or reloading the tab discards the session.

Keep numerical workspace in memory. An interrupted attempt publishes no geography.
Completed epochs retain their ancestry and typed causal consequences. They do
not duplicate every intermediate field. An optional in-memory epoch/final callback
can present completed work without persisting execution frames.

At publication, check the world revision and field ownership, then replace session
geography as one undoable operation. If intervening edits changed the world, keep
the edits and report the out-of-date generation result. No automatic retry occurs.
Domain processes remain independent of the browser adapter.

## Behavior to establish

- Reuse an actual process at two map profiles and twice in a configured sequence.
- Compose GIS, magical and physical processes over shared working state.
- Produce accumulated consequences through warm/glacial/present epochs with
  changing variables, persistent state and reset forcing.
- Produce repeatable geographic consequences from the same in-memory inputs.
- Diagnose stale facts caused by incorrect ordering and execute the corrected sequence.
- Refine regional/cave history against retained parent inputs, fixed interfaces,
  stable feature identity and protected authored detail.
- Preserve a job's effective configuration when future profile settings change.
- Publish selected regeneration safely across cancellation, validation failure
  and concurrent authoring.

## Physical port and atlas adapter

This section describes the current implementation. The
[world-generation execution plan](#world-generation-with-physical-dimensions--execution-plan)
below replaces its mesh-density calibration; that rewrite has not started.

`packages/generation/src/canonry/` ports Canonry commit
`0f62584c114863ffadeb5e29e021f5fce6b37a61`. The physical kernel uses the original
equilateral triangle graph, 1024 elevation subunits per authored metre, seed salts,
material histories and epoch order. Its unsigned 64-bit hash uses exact 32-bit
word arithmetic in JavaScript. Domain-neutral source processes cover crust,
orogeny, volcanoes, impacts, support/flexure, margins, climate, drainage, erosion,
sediment, glaciers, coasts and final geographic classifications.

The atlas runs these registered processes through the shared runner. Native
steps update private numerical arrays; projection and feature extraction update
GIS state. Numerical checks cover ranges, landscape budgets, flow topology,
river coverage and grounding. GIS validation runs when spatial state changes,
at completed epoch boundaries and before publication. Authored samples are also
composed into the native workspace before physical consumers run.

The standalone `physicalProfile` retains Canonry's defaults. `atlasPhysicalProfile`
adapts them for the atlas rather than copying the game's frozen-world setting:

- Horizontal distances scale with mesh density against the reference seed's
  1,188,888 physical triangles; elevations remain metres. The atlas uses 42
  crustal provinces and four continental assemblies.
- The native snow threshold of 300 represents zero Celsius, with ten native
  climate units per degree. Epoch temperature settings remain Celsius and sea
  levels remain metres relative to the world's calibrated sea datum.
- The game's central warmth source and mandatory scattered warmth pockets are
  disabled. User-configured sources provide magical forcing. Sea-ice coverage
  is bounded by the ocean cold enough to freeze under the authored climate.
- Magical storage follows the native dominant source mapping when crust moves.
  Thermal forcing refreshes with climate; material feedback and elapsed storage
  advance once per epoch.

| Quality  | Content triangles | GIS field samples |
| -------- | ----------------: | ----------------: |
| Draft    |            16,384 |         192 × 192 |
| Standard |            65,536 |         384 × 384 |
| Fine     |           262,144 |         768 × 768 |

All qualities execute the physical processes and configured epochs. Generation
cost increases with numerical detail. Native scratch arrays are discarded before
the result leaves the worker; no intermediate state is stored.

Regional refinement imports parent crust and accumulated material histories. It
refines climate, drainage, erosion, ice and coasts without assembling a new set
of continents or replaying global plate movement. The native work boundary can
receive drainage outside the write extent, so an inland patch does not require
a fabricated ocean. Inherited ocean distances retain metre units. The authored
area boundary, protected samples and contracted network crossings stay fixed.
This uses current inherited material history; it does not reconstruct a separate
parent terrain snapshot for each historical epoch.

The optional offline `tools/canonry-reference` program reads the original C#
library to produce reference fixtures and `contracts.generated.json`. With the
pinned reference repository at `../the-canonry-game` and .NET 8 available, run
`make canonry-fixtures`. Fixtures compare mesh topology, hashing, default
parameters and numerical field hashes across initial geology, transport and a
complete two-epoch evolution. Ordinary app builds and CI consume committed
fixtures and need neither that repository nor .NET.

## Reference and implementation state

Read the corresponding Canonry bodies before adapting their structure:

- [Common lifecycle](https://github.com/chris-arsenault/the-canonry-game/blob/main/src/Engine.WorldGen/PhysicalGeneration/Pipeline/IMapGenerationLayer.cs)
  and [fact contract](https://github.com/chris-arsenault/the-canonry-game/blob/main/src/Engine.WorldGen/PhysicalGeneration/Pipeline/PhysicalGeographyLayerContract.cs).
- [Pipeline](https://github.com/chris-arsenault/the-canonry-game/blob/main/src/Engine.WorldGen/PhysicalGeneration/Pipeline/PhysicalGeographyPipeline.cs)
  and [seed/epoch context](https://github.com/chris-arsenault/the-canonry-game/blob/main/src/Engine.WorldGen/PhysicalGeneration/Pipeline/PhysicalGeographyGenerationContext.cs).
- [Epoch session](https://github.com/chris-arsenault/the-canonry-game/blob/main/src/Engine.WorldGen/PhysicalGeneration/PhysicalGeographyEvolutionSession.cs)
  and [physical/magical orchestration](https://github.com/chris-arsenault/the-canonry-game/blob/main/src/IceRemembers.Seed/PhysicalGeneration/IceRemembersWorldGenerationOrchestrator.cs).

The TypeScript runner applies registered processes to one working map in a browser
worker. The frontend publishes semantic field groups into session memory, retains
completed causes by area, and uses direct shared domain validation for edits.
World generation, located refinement, manual editing, templates, cancellation and
undo have browser journeys. The physical kernel is a source-traceable port;
atlas profile settings, GIS projection and user-configurable magic are explicit
adaptations. The cultural, political and built catalogs remain initial atlas
implementations. Earlier SQL migration and backend source are historical material
outside the current execution path.

## Completion work

The implementation follows Sulion plan `01c3a7d3-a35c-425c-b4c1-b9640d8bd670`.
The requested outcome is complete Canonry physical and magical generation in the
browser, including configurable epochs, impacts, glacial history and the Fire,
Aurora and Pressure examples. Backend and persistence remain outside this work.
The completed implementation milestones below establish process coverage, not
complete reference fidelity or satisfactory geographic output. The subsequent
investigation found generation, projection and display gaps documented below.

1. Physical history and configuration: expose event and landscape controls,
   epoch duration and ordering, and extract geographic features from the native
   fields. Check declining impacts and retained ice/erosion histories.
2. Configurable magic and causal integration: port fracture propagation, cold
   drainage and ocean rays; apply heat, ice, resistance and coastal feedback in
   the physical sequence. Presets use declarative source, propagation, effect,
   feature and interaction definitions. Retain and advect accumulated histories.
3. Workflow and publication: configure and combine those systems through the
   existing generation and magic surfaces, expose natural/final geography and
   history channels, run focused generation checks and ordinary CI.

Implementation choices: use the existing shared mesh and process runner; keep
working arrays transient. A configurable system has a bounded vocabulary rather
than executable user code. The reference's game-specific names and thresholds
are presets, not branches on system names. Existing manually placed effects
remain usable. Reference numerical scaling is retained during this port; metre
native algorithm conversion remains a separate backlog item. Cultural and built
generation are atlas processes rather than missing Canonry physical layers.

At each milestone, evidence is the resulting geography and focused behavioral
checks. Deployment uses the existing platform workflow without repeated live
walkthroughs or additional infrastructure.

The physical sequence now exposes meteor count/size, volcanic construction,
plate drift, glacier transport and coastal erosion. Epochs can be ordered, named
and configured independently; presets include repeated glacial cycles and the
four Ice Remembers epochs. Physical algorithms still take per-epoch activity
strengths as in Canonry. Duration records elapsed years and controls annual
local-source storage; it does not turn the geological model into a yearly solver.

`World.magicSystems` holds declarative systems. Source strategies select geothermal
maxima, cold/high terrain, deep-ocean basins or authored map sources. Propagation
strategies port Fire's priority-queue fracture transport, Aurora's coldward
accumulation and ice retention, and Pressure's standing rays, coastal rays and
wandering wakes. Radial propagation supports located variants. There are no
branches on system identities. Presets specify their feedback, feature thresholds,
hysteresis and interactions, including thermal war rims, steam fractures and
pressure/Aurora breaches. Configurations participate in the generation hash.

Each epoch advects accumulated activity, first occurrence, storage and coastal
history with Canonry's crust source map. Climate-phase fields alter heat and rock
before hydrology; post-glacial fields contribute coastal forcing and material
feedback carried into the following epoch. Final classification retains every
feature mask, natural geography, physical materials and a priority-selected
surface. An inland refinement has no fabricated pressure locus. A warm present
may have no active Aurora while preserving its glacial activity history.

The atlas publishes lakes as geographic polygons and extracts named peaks,
craters, volcanoes, calderas, cirques, fjords, moraines, gorges, waterfalls and
magical landmark regions alongside its river network. Landmark points identify
connected regions; numerical masks retain their full extent. Completed session
generations retain epoch and magical definitions when current settings change.

## Generation and display findings (2026-10-18)

The core physical operations and all three magical propagation mechanisms are
implemented. End-to-end semantic parity remains incomplete because specific
classification, causal timing and feature-grouping operations are missing or
changed, as recorded below. Different numerical results do not establish missing
operations. Output measurements assess geographic consequences; implementation
comparison establishes whether the semantic operations are present.

The investigation read the original specification in
`.sulion-paste/world_atlas_creator_design.md`, relevant generation and rendering
bodies in the local Canonry reference, and the atlas generation, projection and
display code. Existing reference captures were inspected; they were not newly
generated comparison runs. The original specification requires geographically
meaningful current maps and refinement. A history slider and a 3D renderer are
not prerequisites for that behavior.

### Observed generation behavior

Read-only diagnostics at application commit
`7f4635adcc37e4cfd2b6a07318ea6e1a2fe506f6` used seed **104729**, default
parameters and the default Formation / Cold age / Present epochs.

For the default **4,000 km × 3,000 km** world at **Standard** quality with
physical and magical generation:

| Measurement                                                |     Result |
| ---------------------------------------------------------- | ---------: |
| Maximum native elevation inside the world rectangle        |   971.84 m |
| Maximum native elevation across the generated content disk | 1,469.53 m |
| Native peaks / ridges / passes inside the world            |  0 / 0 / 0 |
| Native peaks / ridges / passes across the content disk     | 3 / 10 / 5 |
| Exported crater / gorge / waterfall features               |  4 / 4 / 3 |
| Exported river / lake features                             |     17 / 5 |

The few surviving peaks and ridges are outside the world rectangle. The mapping
in `canonry/atlasWorkspace.ts` fits a circular native domain around the rectangular
world using its diagonal; generation therefore spends part of its domain outside
the atlas extent. The measurements establish a consequential extent mismatch,
but do not establish its best correction.

A separate **100 km × 100 km**, Standard, **physical-only** run traced the maximum
elevation inside its world rectangle through the configured process sequence:

| Stage                                                  | Maximum elevation |
| ------------------------------------------------------ | ----------------: |
| Initial flexure, after initial geological construction |           2,177 m |
| First epoch, after plate advection                     |           1,373 m |
| First epoch, after mass wasting                        |           1,247 m |
| Final classification, after three epochs               |             871 m |

That trace locates relief loss within generation, before GIS projection. It does
not prove whether transport, support, erosion, profile adaptation or their
combination is mathematically wrong. Do not infer a root cause from those maxima
alone. Current peak classification requires 1,250 m elevation and ridge
classification requires 1,000 m, alongside other criteria; this run cannot produce
either at its final elevation. Lowering classification thresholds alone would
not resolve the loss of relief.

The corresponding 100 km square with magic ended at 952.25 m, also with no native
peaks or ridges. It retained impact-rim, gorge and waterfall cells in both the
native arrays and published raster. Resolution and raster projection therefore
do not explain all missing detail. Results vary with extent, quality and magic;
these measurements are examples, not a claim about every seed.

### Known algorithm and unit limitations

- `canonry/atlasProfile.ts` scales selected distances and step counts against
  the reference triangle count and adjusts two height-per-step parameters.
  World extent does not participate in that profile calculation. Horizontal
  metric meaning is introduced separately through `metresPerStep` in the
  workspace. This is not consistent physical dimensional treatment throughout
  the algorithms. Elevations already use 1,024 fixed-point subunits per metre.
- `canonry/geography.ts::measureSlopes` stores neighboring elevation differences
  without dividing by horizontal distance. `canonry/flowGraph.ts::contributingArea`
  accumulates triangle counts, which `canonry/fluvial.ts` uses directly in its
  erosion calculation. Converting output distance and discharge channels later
  does not make those calculations independent of sampling density or extent.
  These lattice-based calculations also occur in the reference. They establish
  work needed for the atlas's metric model, not an omitted reference algorithm.
- `canonry/atlasSequence.ts` omits initial construction and all epoch geology
  passes for inherited regional refinement. It imports current parent material
  history rather than reconstructing parent terrain at each epoch. Refinement
  currently does not supply missing local geological construction merely because
  it uses a finer mesh.
- Sea-ice behavior, atlas climate/profile settings and configurable magic contain
  deliberate adaptations. These require behavior checks in the atlas context;
  source provenance alone does not validate them.

### Feature geometry and display limitations

- `geographicRegions.ts` exports most named landforms as one point per connected
  cluster. Its crater extraction uses impact-center flags. Canonry's
  `PhysicalGeologicalFeatureIdentification.cs` identifies connected basin/rim
  membership and anchors a crater at its deepest excavation. The atlas does not
  carry crater shape or gorge/ridge geometry into corresponding editable features.
  Raster masks retain some extents, but generic point markers do not show them.
- `frontend/src/presentation.ts` gives categorical landform, surface and material
  codes a continuous numerical colour ramp. Its elevation rendering combines
  relief with water and ice, without the reference's surface and river composition.
- `frontend/src/mapEngine.ts` draws landform points as generic circles and rivers
  at a fixed width. Canonry's `PhysicalMicrogeographyPainter.cs` draws categorical
  terrain, ridge/cliff/coast/pass edges, filled channels and deltas, river spines
  and distinct feature marks. Those are functional cartographic differences.
  The reference also uses percentile-based elevation colours; the atlas's fixed
  elevation ramp suppresses contrast in the observed low-relief output.

### Bounded source inventory

Reference checkout: `../the-canonry-game` at
`0f62584c114863ffadeb5e29e021f5fce6b37a61`, matching the port's pinned commit.
The comparison follows `PhysicalGeographyEvolutionSession` and
`IceRemembersWorldGenerationOrchestrator`, including final classification and
`PhysicalGeologicalFeatureIdentification`. The separate non-epoch
`PhysicalGeographyPipeline.CreateDefault` has a different schedule; it must not
be mistaken for a missing phase in the reference's multi-epoch orchestrator.

The physical source has **54 layer classes and 55 contracts**. `MassWastingLayer`
supplies both ordinary and post-fluvial contracts. All 55 have executable native
implementations and appear in `physicalSchedule` with an epoch. A one-epoch
schedule contains 149 invocations: 23 initial geology, 21 epoch geology, 10 climate,
25 hydrology, 6 glaciation, 26 post-glacial reconciliation, 2 coastal, 1 history
and 35 final-state steps. Repeated climate, drainage and ice passes are present.

The following table enumerates implementation coverage. Names in its first
column are C# classes with the `Layer` suffix omitted; TypeScript paths are under
`packages/generation/src/canonry/`. These implementations contain the physical
operations, including material transport, orogenic construction, impact
excavation/rims/ejecta, water-budget lakes, erosion/deposition and ice response.
All rows receive the atlas profile adaptations; the additional execution changes
are described after the table. Exact numerical equivalence is not required.

| Reference class             | Native TypeScript implementation                               |
| --------------------------- | -------------------------------------------------------------- |
| AtmosphericFlow             | `atmosphere.ts::atmosphericFlow`                               |
| Bathymetry                  | `geography.ts::bathymetry`                                     |
| CoastalDetail               | `coastalDetail.ts::coastalDetail`                              |
| CoastalErosion              | `coastalEvolution.ts::coastalErosion`                          |
| ContinentalDomain           | `provinces.ts::continentalDomains`                             |
| ContinentalMarginEvolution  | `continentalMargins.ts::continentalMarginEvolution`            |
| ContinentalSuture           | `sutures.ts::continentalSutures`                               |
| CrustalSupport              | `support.ts::crustalSupport`, with and without ice load        |
| DeltaFormation              | `deltas.ts::deltaFormation`                                    |
| DrainageConditioning        | `drainageFlood.ts::drainageConditioning`                       |
| DrainageGuidance            | `flowGuidance.ts::drainageGuidance`                            |
| ExternalCoastalForcing      | `coastalEvolution.ts::externalCoastalForcing`                  |
| Floodplain                  | `floodplains.ts::floodplains`                                  |
| FlowRouting                 | `routing.ts::flowRouting`                                      |
| FluvialErosion              | `fluvial.ts::fluvialErosion`                                   |
| FractureNetwork             | `fractures.ts::fractureNetwork`                                |
| Geothermal                  | `geothermal.ts::geothermal`                                    |
| GlacialDeposition           | `glacialEvolution.ts::glacialDeposition`                       |
| GlacialErosion              | `glacialEvolution.ts::glacialErosion`                          |
| GlacialLandform             | `glacialLandforms.ts::glacialLandforms`                        |
| GlacialMeltwater            | `glacialEvolution.ts::glacialMeltwater`                        |
| GlacialRunoff               | `glacialEvolution.ts::glacialRunoff`                           |
| IceFlow                     | `iceFlow.ts::iceFlow`                                          |
| ImpactCratering             | `impacts.ts::impactCratering`                                  |
| LakeBasin                   | `lakes.ts::lakeBasins` and `lakeStage.ts`                      |
| LandIce                     | `landIce.ts::landIce`                                          |
| LandformClassification      | `landforms.ts::landformClassification`                         |
| Landmass                    | `geography.ts::landmasses`                                     |
| LandscapeInitialization     | `surface.ts::initializeLandscape`                              |
| LithosphericFlexure         | `support.ts::lithosphericFlexure`                              |
| MantlePlumeRoot             | `plumes.ts::mantlePlumeRoots`                                  |
| MarineSedimentation         | `continentalMargins.ts::marineSedimentation`                   |
| MassWasting                 | `massWasting.ts::massWasting`, ordinary and post-fluvial modes |
| Moisture                    | `climate.ts::moisture`                                         |
| OceanConnectivity           | `ocean.ts::oceanConnectivity`                                  |
| OceanCurrent                | `currents.ts::oceanCurrents`                                   |
| OceanDistance               | `geography.ts::oceanDistance`                                  |
| OrogenicConstruction        | `orogeny.ts`, `orogenicComponents.ts`, `orogenicShape.ts`      |
| PhysicalEpochHistory        | `validation.ts::epochHistory`                                  |
| PhysicalGeographyValidation | `validation.ts::validatePhysical`                              |
| PlateAdvection              | `advection.ts`, `transportPlan.ts`, `transportHistory.ts`      |
| Precipitation               | `climate.ts::precipitation`                                    |
| RiverChannelGeometry        | `channelGeometry.ts::riverChannelGeometry`                     |
| RiverNetwork                | `rivers.ts::riverNetwork`                                      |
| Runoff                      | `climate.ts::runoff`                                           |
| SeaIce                      | `seaIce.ts::seaIce`; atlas selects `atlasSeaIce.ts` instead    |
| SedimentTransport           | `fluvial.ts::sedimentTransport`                                |
| TectonicEpoch               | `margins.ts::tectonicEpoch`                                    |
| TectonicMargin              | `margins.ts::tectonicMargins`                                  |
| TectonicProvince            | `provinces.ts::tectonicProvinces` and `provinceSites.ts`       |
| TectonicUplift              | `uplift.ts::tectonicUplift`                                    |
| Temperature                 | `climate.ts::temperature`                                      |
| VolcanicConstruction        | `volcanism.ts::volcanicConstruction`                           |
| WarmthSource                | `warmth.ts::warmthSources`                                     |

This investigation read every physical layer's `Apply` body and the native
implementations, with detailed helper comparison for the landform classifier,
fluvial erosion and mass wasting. It did not exhaustively compare every private
helper in all 54 C# classes. The existing reference fixture tests passed, but
their numerical comparisons are not the user's parity criterion or a prerequisite
for adapting these operations to metres.

For world generation, the atlas preserves the multi-epoch physical sequence.
Its declared differences include profile/density scaling, different climate and
land-ice targets, disabled central warmth/pockets, per-epoch impact and volcanic
controls, authored-sample restoration and the sea-ice wrapper. Regional generation
additionally skips the 23 initial-geology and 21 per-epoch geology invocations.
Open-boundary drainage and inherited fields are atlas extensions. These are
specific changes to execution and inputs, not missing meteor or ice-age modules.
Per-layer validation is consolidated in `layerValidation.ts`; it is not a literal
port of every reference layer's `Validate` body.

### Magic semantic operations

The source has **15 magic/domain layer classes**. All their implementation
bodies and the shared region classifier were read alongside the atlas code.
The same core source-selection, propagation, feedback and history operations
are present for Fire, Aurora and Pressure. The table separates those mechanisms
from specific missing behavior. Seed mixing, rounding, thresholds and exact
field values are not semantic omissions by themselves.

| Reference layer                      | Semantic operations in the atlas                                                                                                                                   | Status or material gap                                                                                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FireField                            | Select geothermal maxima with spacing; seed sources; propagate intensity through a priority queue with fracture-dependent traversal cost                           | Present. Core identity exists as source data and a feature rule; omission of a duplicate native flag is a representation difference. The separate high-intensity magma-chamber classification is missing. |
| FireClimateFeedback                  | Replace the previous heat contribution, alter temperature and melt ice; retain forcing for later climate consumers                                                 | Present. The final invocation has different causal timing, described below.                                                                                                                               |
| MagicRockResistance                  | Harden or weaken geological rock from magical intensity before physical erosion consumes resistance                                                                | Present; generalized to configurable system effects.                                                                                                                                                      |
| AuroraField                          | Derive cold/altitude input; route accumulation toward colder neighbors; retain some in ice; derive intensity and apply activity strength                           | Present. Different arithmetic does not establish a missing propagation operation.                                                                                                                         |
| PressureField                        | Select a deep-ocean basin locus; trace standing rays and coastal rays with reflections; trace wandering wakes and mark rogue impacts                               | Present. Inland scopes permit no locus. Locus identity exists in source/feature data without a duplicate native flag.                                                                                     |
| MagicAdvection                       | Carry accumulated magical activity and first occurrence using the crust source mapping                                                                             | Present. Coastal first-occurrence data is missing because it is never recorded. Configurable stored influence is an addition.                                                                             |
| MagicHistory                         | Accumulate activity and record first occurrence per system across configured epochs                                                                                | Present. Shared epoch execution replaces the separate reference magic-epoch counter; absence of that duplicate counter is not a missing history operation.                                                |
| PressureCoastFeedback                | Read adjacent-ocean pressure, waves and currents; apply coastal forcing; accumulate its history                                                                    | Present, except recording the first epoch of coastal influence is missing.                                                                                                                                |
| NaturalSurface                       | Classify physical land/water, ice, fluvial features, relief and climate through the reference decision ladder                                                      | Present. Fixed atlas defaults versus reference profile settings are a configuration difference.                                                                                                           |
| FireFeature                          | Classify core vents, thermal veins, hot springs, hydrothermal vents, basalt flats and thawed halos; grow connected regions from seeds through retention predicates | Present. Zero activity can still publish a core from selected source data, so inactive-source feature suppression is incomplete. Magma chambers are the separate missing classification noted above.      |
| AuroraFeature                        | Classify fields, light wells, frost prisms and melt lines using causal predicates and connected retention                                                          | Present.                                                                                                                                                                                                  |
| PressureFeature                      | Classify the locus, crush zones, wake scars, interference lattice and rogue impacts                                                                                | Present.                                                                                                                                                                                                  |
| MagicInteraction                     | Derive thermal war rims, steam fractures and pressure/Aurora breaches from overlapping causes                                                                      | Present, but the rules belong to the Pressure definition; disabling it also disables the Fire/Aurora interaction.                                                                                         |
| FinalSurface                         | Preserve individual feature masks and choose a dominant surface by precedence                                                                                      | Present. Different default priorities are configuration differences, not an omitted selection operation.                                                                                                  |
| IceRemembersMicrogeographyValidation | Check generated magic state and update dependency facts                                                                                                            | Reference-specific checks/facts are absent from the atlas magic actions. This is an execution-contract difference, not evidence of a missing terrain-generating mechanism.                                |

The configurable examples contain **all 18 significant magic feature kinds**
(6 Fire, 4 Aurora, 5 Pressure and 3 interactions). A magma chamber is an additional
physical feature flag in the reference, not one of those 18 kinds. Its missing
classification must therefore remain explicit despite the complete feature-kind
list.

The final feedback order is a semantic difference: the reference finalizes
physical climate, drainage, ice and classification, then reevaluates Fire and its
heat feedback, Aurora, Pressure and feature classification. The atlas evaluates
final Fire/heat before final drainage and ice, and post-glacial systems after
physical validation. That changes which physical operations consume refreshed
magical forcing. Describe and resolve the intended causal relationship; do not
try to repair it by chasing identical output arrays.

The earlier numerical Aurora counterexample has been removed from the parity
assessment. Both implementations contain input, coldward routing, accumulation,
ice retention, activity scaling and saturation. A numerical difference between
them is not evidence that one of those semantic operations is absent.

### Geographic extraction comparison

`PhysicalGeologicalFeatureIdentification` is outside the 54 physical layer
classes. It identifies four kinds and retains their triangle membership. The
atlas changes selection or grouping for three kinds and exports a different
representation for all four:

| Kind         | Reference                                                                             | Atlas                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Peak         | Connected peak cells, anchored at highest elevation                                   | Same clustering/anchor principle, exported as a point without membership geometry                                 |
| Crater       | Connected impact-basin/rim cells, at least 48 members, anchored at deepest excavation | Connected impact-center flags, no equivalent minimum, anchored at highest in-scope elevation, exported as a point |
| Lake         | Native water-body membership, at least 96 cells, anchored at lowest floor             | GIS polygons assembled from sampled raster cells, without the reference size filter or anchor                     |
| River system | Upstream-connected membership from mouths with discharge at least 60,000              | Separate line reaches between junctions; no corresponding river-system membership object                          |

The atlas also adds point extraction for volcanoes, calderas, cirques, fjords,
moraines, gorges, waterfalls and configured magical regions. These additions do
not implement the reference's retained membership automatically. River width,
floodplain and delta fields exist in the physical kernel, but their geometry is
not represented by a fixed-width river reach alone.

### Recommended order

**Convert the generation algorithms to declared world units next**, as requested
in [backlog item 1](backlog.md). This recommendation does not assume that every
process is already complete or correct. The conversion should include comparison
with the actual reference bodies and correction of demonstrated algorithm gaps
in each process being changed. Preserve deterministic process order and causal
state; retain meaningful metre-based elevations already present.

The bounded comparison above must remain the starting inventory. The physical
port is not missing whole event or epoch modules; its atlas scaling and domain
mapping need work. Magic and extraction have separately identified differences
that metre conversion will not fix. Carry these as explicit work rather than
assuming generation parity and assigning all remaining defects to display.

Distances and areas must derive from mesh geometry in world units; slopes must
use rise over physical run. Erosion, transport, runoff and their parameters need
consistent declared dimensions. Declare per-epoch quantities explicitly rather
than implying a yearly physical solver. Compare representative extents and
qualities so detail changes sampling rather than the meaning of a parameter.

Then resolve domain coverage and relief preservation using stage measurements,
carry meaningful landform geometry through extraction/projection, and render the
physical categories and networks recognizably. Domain coverage belongs with the
metric workspace work where their geometry overlaps. Metre conversion alone
will not recover discarded feature geometry or implement missing cartographic
display behavior. Backend, persistence, MCP and migrations remain out of scope.

## World generation with physical dimensions — execution plan

Sulion plan: `c024ba6d-9344-47a2-b9ac-10a6c3faf42a`.
State: execution authorized for all M0–M4 by the user's subsequent request.
Implementation is local; deployment is outside this plan. Expand milestones just
before execution and keep their changes and evidence in this document.

### Outcome and agreed scope

For the same world seed, extent and physical settings, Standard and Fine describe
the same physically sized geography. Fine increases sampling and resolves smaller
detail; it does not systematically shrink rivers, mountain belts, craters,
glaciers, coastal features or magical influence. Defaults should give broadly
Earth-like dimensions with substantial geographic variation.

User requirements come from the 2026-10-18 conversation: size and dimension aware
generation rather than an output conversion; preserve semantic algorithm parity
rather than numerical equivalence; implement this first for **top-level world
generation only**. The five-part direction immediately preceding this request
establishes the work: physical profile, world-space causes, dimensional operators,
physical river sizing and terrain wavelengths. The
[product contract](product-spec.md#3-vocabulary-and-conceptual-separation) already
separates extent, profile, quality and cartographic scale; these are not new
product modes.

The world physical and configurable magical processes, extraction and consumers
of their changed quantities are in scope. Regional/local/site/interior generation
and inherited drainage are not being redesigned. Make necessary shared-call and
unit-contract compatibility changes without implementing regional refinement.
Political/cultural generator redesign remains backlog item 3; new cartographic
toolsets and cosmetic styling remain separate work. Existing world human/built
consumers must continue to read valid quantities and must not introduce a
quality-dependent size conversion.

Keep the browser worker, one shared process state, deterministic epochs, in-memory
session publication, authored protection and undo. No backend, persistence, MCP,
recovery, new deployment machinery or automatic resource caps.

### Implementation choices and boundaries

These choices are the proposed implementation of the agreed direction. Revise a
choice when source inspection or representative output supports a simpler complete
solution; do not treat an agent-selected mechanism as another user requirement.

- **Physical profile and sampling are separate inputs.** Define distances,
  heights, areas, volumes, fluxes and dimensionless strengths explicitly. Counts
  intentionally requested by the creator remain counts; implicit feature density
  uses physical area and spacing. World extent can affect broad layout, but must
  not multiply every feature's dimensions to make the same miniature landscape
  fit any rectangle. Choose plausible physical distributions, not one fixed size
  per feature or a quota of visible landforms.
- **Retain triangular topology where it serves the algorithms.** Supply actual
  world positions, represented cell areas, neighbor distances and edge geometry.
  Cover the declared footprint with a physically defined surrounding work area;
  stop fitting a circular game world onto the rectangle by its diagonal. Local
  coordinate origins may keep numerical geometry precise; physical calculations
  must use metres rather than raw lattice coordinates. Existing fixed-point
  metre elevations may remain if useful; changing their representation is not
  the objective.
- **Resolve seeded causes in world space.** Plate sites, assemblies, impacts,
  plume roots and fracture origins must not be selected from a quality-dependent
  list of triangle IDs. Use deterministic world-space candidates and physical
  spacing; derive source strengths from the same geological causes. Sample those
  causes on the requested mesh. Derived systems such as geothermal source
  selection still follow their causes; do not replace them with arbitrary dots.
- **Replace mesh-step meaning inside each operation.** Distances used by slopes,
  influence, transport, smoothing, fetch and propagation must remain physical
  when sample density changes. Material accounting distinguishes thickness from
  volume; water accounting distinguishes precipitation depth from discharge.
  Numerical iterations are solver work, not extra elapsed geological activity.
  Keep dimensionless activity controls where appropriate. Declare per-epoch
  amounts versus annual rates; this does not introduce a yearly Earth simulator.
- **Preserve broad terrain; resolve finer wavelengths.** Noise and other spatial
  variation use world-coordinate wavelengths and physical amplitudes. Finer
  sampling adds supported detail without choosing a differently sized base world.
  Do not require unresolved features to occupy an entire terrain cell. Retain
  their physical width, extent or support geometry alongside sampled fields.
- **Publish useful physical facts for later refinement.** Retain world-coordinate
  cause/feature identities, water-body and basin relationships, river topology,
  elevation/datum, catchment area, discharge and channel dimension profiles through
  the existing domain representation. Internal numerical node indices are not
  cross-scale feature identities. Do not build a second generation engine,
  speculative refinement framework or parallel authoritative map representation.

Exact Earth-like defaults and empirical channel coefficients are engineering
choices to calibrate against resulting geography, not settled constants in this
plan. A world seeded anew need not reproduce the old atlas or the C# output.
Qualities must retain physical scale and recognizable broad causes; small drainage
paths can change as finer terrain becomes available. Matching every vertex or
array across resolutions is not an acceptance condition.

### Source and ownership map

Use the pinned reference bodies identified in the bounded source inventory above
as the semantic baseline, particularly the evolution session and the physical/
magical orchestrator. Read relevant helpers before changing a process, not only
its registered name. Reuse the common application/fact contracts and epoch order.

| Area                               | Current source and planned responsibility                                                                                                                                                                                                                                        |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Physical geometry and parameters   | `canonry/mesh.ts`, `atlasWorkspace.ts`, `atlasProfile.ts`, `profile.ts`, `context.ts`, `field.ts`, `atlasParameters.ts`: replace triangle-count calibration and implicit dimensions                                                                                              |
| Geological causes and construction | `provinceSites.ts`, `provinces.ts`, `sutures.ts`, `margins.ts`, `uplift.ts`, `orogeny.ts`, `orogenicComponents.ts`, `orogenicShape.ts`, `plumes.ts`, `volcanism.ts`, `impacts.ts`, `fractures.ts`, `noise.ts`: world-space causes, physical distances and wavelengths            |
| Water and fluvial geography        | `geography.ts`, `drainageFlood.ts`, `flowGraph.ts`, `flowGuidance.ts`, `routing.ts`, `rivers.ts`, `lakes.ts`, `lakeStage.ts`, `fluvial.ts`, `channelGeometry.ts`, `floodplains.ts`, `deltas.ts`: physical gradients, catchments, water budgets and channel dimensions            |
| Other physical evolution           | `advection.ts`, `transportPlan.ts`, `transportHistory.ts`, `massWasting.ts`, `support.ts`, `continentalMargins.ts`, `climate.ts`, `atmosphere.ts`, `currents.ts`, `warmth.ts`, ice/glacial and coastal modules: distance/area aware evolution and retained histories             |
| Configurable magic                 | `magicSources.ts`, `magicPropagation.ts`, `magicOcean.ts`, `magicFeedback.ts`, `magicFeatures.ts`, `magicState.ts` and domain magic definitions/presets: physical source spacing, influence distances, storage meaning and dimensional feature predicates                        |
| Publication and consumption        | `atlasChannels.ts`, `atlasProjection.ts`, `atlasFeatures.ts`, `geographicRegions.ts`, `atlasProcesses.ts`, `atlasSequence.ts`, `atlasWorkflow.ts`; domain feature/field consumers and relevant frontend reads/rendering: preserve dimensions without post-generation size repair |

Except where noted, module names in this table are under
`packages/generation/src/canonry/`. Shared types and entry points remain scoped
to their existing domain/generation/frontend boundaries. Backend source is not
part of this dependency graph.

### M0 — Physical world geometry and parameter contract

Sulion phase: `b8cba060-1bb2-4ed6-9b0a-b0c3cbea5b68`. State: completed.

Scope: implement metric mesh geometry, footprint/work-area separation and a
physical world profile independent of Standard/Fine. Classify dimensional inputs,
outputs and parameters for all 55 physical contracts and 15 magic layers in the
existing inventory, with each assigned to M1, M2 or M3. Include embedded constants,
counts, categorical size filters and numerical iteration controls. Preserve
meaningful existing units and update shared callers where signatures change.

Acceptance: identical physical settings produce identical parameter meanings
under different qualities. Mesh spacing and areas describe the requested world,
including a non-square footprint, without relocating the boundary or cropping
the world to a fitted game disk. Every world-process dimensional dependency has
an explicit conversion owner; no unclassified per-cell size assumptions are
silently carried forward as complete.

Evidence: geometry/coverage checks, profile inspection and focused area/distance
checks at two qualities and differently sized extents. This milestone establishes
the foundation; it does not claim the remaining operators are already corrected.

#### M0 execution

Expansion `308d9374-df20-4776-b45f-e942ec9a7494`:

1. Metric mesh and profile (`2ae3361e-0d28-46e1-aec3-d886469f135c`): retain
   triangular adjacency, add physical geometry and world-footprint coverage,
   remove quality-dependent profile calibration, and update workspace callers.
   Primary files: `mesh.ts`, `worldMesh.ts`, `atlasProfile.ts`, `atlasWorkspace.ts`.
2. Inventory and geometry checks (`ab44c27d-d045-4490-a049-f8396997a1f5`): assign
   dimensional process families to later phases, test area/distance/coverage and
   profile independence, and typecheck the affected consumers. M0 does not claim
   unconverted operators are already functional in physical units.

Dimensional ownership: M1 owns geological site selection, spatial noise,
construction footprints and geological size filters; M2 owns gradients,
catchment/flow, lake budgets, fluvial/channel/floodplain/delta dimensions; M3 owns
material transport, smoothing, climate/current fetch, ice and coastal evolution,
all magical influence/storage/feature predicates and remaining classifications.
M4 owns publication units, physical-size extraction, identity and consumption.
The 55 physical contracts and 15 magic layers in the inventory above remain the
complete review list, including their helpers and embedded constants. Elevation
storage remains fixed-point metres; scalar/categorical channels remain explicitly
dimensionless. Amounts per epoch remain distinct from annual hydrology rates.

### M1 — World-space geological causes and terrain

#### M1 execution

Expansion `8cd1dc17-d933-42f6-8422-c6bcd0d57a3f`:
`953a00b0-a58e-4f70-894b-190c56d2c8b9` implements world-space plate/event
candidates, geological footprints and physical influence; `667c1ffd-eecb-40d7-a31e-1670d145a213`
checks identical cause positions/radii and meaningful construction at different
meshes. Reuse existing construction/transport histories, recording event geometry
for extraction. M0 geometry/profile checks and generation typecheck passed.

Sulion phase: `9677f66d-35b4-4209-8ae0-05234e294e68`. State: completed.
Depends on M0.

Scope: move geological event/site selection to world-space candidates and stable
cause identities. Express continental transitions, mountain construction widths,
rift shoulders, plume/apron/cone dimensions, crater excavation/rim/ejecta radii,
fracture structure and terrain variation in physical dimensions. Preserve
construction and material-history semantics. Any geological spacing that uses
area or reach must consume the M0 geometry rather than triangle density.

Acceptance: the same world settings keep broad assemblies, plate sites and
geological events at their intended locations and physical scale across Standard
and Fine. Mountain and crater dimensions do not halve as linear sampling density
doubles. Fine reveals additional supported terrain structure. Changes to actual
world dimensions have physically meaningful consequences rather than uniformly
stretching every geological feature.

Evidence: world-space cause inspection plus representative construction footprints
and wavelength measurements at matched settings. Assess relief after downstream
evolution in M3; initial construction alone is not completed terrain behavior.

### M2 — Catchments, discharge and channel dimensions

Sulion phase: `9a157445-4c4f-4b2f-86fc-6e944a5dac29`. State: completed.
Depends on M0 and M1.

Scope: compute physical gradients and contributing area; turn precipitation and
runoff into water volume/flow before routing, lake support, river selection and
erosion consume them. Replace cell-count discharge thresholds, minimum reach/lake
size and channel expansion steps with physical criteria. Derive river width and
depth from discharge with slope/substrate influences and broad calibrated
variation. Carry longitudinal dimension profiles. Express bank relief, floodplain
reach, delta dimensions and fluvial transport/accounting consistently. Remove
the output-only discharge repair in `atlasProjection.ts` and `atlasFeatures.ts`.

Acceptance: changing cell size does not change the water supply of the same
catchment merely by changing its cell count. Major rivers keep comparable
physical dimensions across qualities; river initiation and lake support describe
the same physical quantities. Narrow channels retain their real dimensions even
where terrain cells cannot resolve both banks. Extra detail can add supported
tributaries without making the main network a smaller copy.

Evidence: a known-area runoff case, connected flow/lake checks and matched-world
catchment/discharge/channel measurements. Use multiple cells to represent the
same physical case rather than expecting matching array values or identical
small drainage paths.

### M3 — Physical epochs and configurable magic

#### M2 execution

Expansion `2fc2fbc1-f195-4722-8747-1fb7e284dd06` completed catchments/water budgets
(`1d614a4b-ab92-4f4e-9e30-1b9b95f79403`) and fluvial/channel dimensions
(`ba179ff0-aa34-4e06-86f0-5e44d3118d1f`). A 10,000 km² catchment with 500 mm/year
runoff produces the same discharge at two meshes. River width/depth remain metres
below terrain cell size. Lake budgets and sediment accounting now use physical
area/volume before routing; publication no longer repairs flow with a cell multiplier.

#### M3 execution

Expansion `d7888bad-9de5-48f6-9335-7f63a1931532`:

1. Physical epochs (`3284db76-0a60-4542-adaa-a712fa103e32`): physical transport,
   flexure reach, climate/current travel, ice flux, coasts and classification.
2. Configurable magic (`f68e9add-0b68-457b-ae80-1de455ef2014`): physical source
   spacing, fracture loss per kilometre, area-based cold accumulation/retention,
   ocean ray/wake distance and width, feature predicates and editable presets.
3. Coupled checks (`40d3a8df-8d80-463c-bac2-ebfe621d9401`): warm/glacial/present
   physical history, repeated ice ages with magic, material budgets and shared callers.

The profile now declares physical defaults directly; no quality/count conversion
table remains. Flexure uses a metre-length Helmholtz smoothing solve instead of
giving a fixed iteration count a hidden physical radius. This retains regional
support spreading and local surface relief while allowing finer numerical sampling.
Sediment ledgers are m³, slopes are rise/run, ice thickness is metres and ice flux
is m³/year using an explicit transport time. Extensively transported material is
weighted by represented area, rather than treating each triangle as equal material.
Floating volume budgets use relative numerical tolerances, not integer equality.

The existing causal order is retained: climate-phase magic feeds temperature,
drainage and ice; post-glacial systems use formed ice and force subsequent coasts.
No extra final history or epoch activity is introduced. The old 100 km “world”
integration fixtures were miniature landscapes; continental-scale fixtures now
exercise the same physical defaults. An all-ocean result validly skips land ice.

Sulion phase: `214632cc-692e-4514-b33c-273acc45296e`. State: completed.
Depends on M0–M2.

Scope: complete the M0 dimensional inventory through plate/material transport,
hillslope response, support/flexure, continental margins, climate/moisture,
ocean currents, glacier/ice transport and grounding, coasts and classification.
Use physical travel/influence distances, gradients and represented areas; keep
depths, volumes and fluxes distinct in erosion/deposition budgets. Convert all
configured magic strategies and predicates, including fracture traversal costs,
coldward accumulation/retention, ocean rays/wakes, source spacing and forcing.
Update editable example presets and only necessary parameter labels/defaults.
Preserve repeated causal refreshes, epoch state and declared activity semantics.

Acceptance: every world process in the inventory uses consistent declared
dimensions. More mesh cells do not introduce extra material, water, magical
source density, influence reach or epoch activity merely through cell/step counts.
Fine does not systematically erase relief or shrink influence zones. Impacts,
volcanism, warm/glacial/present history and the three configurable magic mechanisms
still affect geography through their original semantic operations. Resolve
causal-order changes explicitly rather than treating different numbers as a defect.

Evidence: focused distance/transport and material/water budget checks plus a
representative coupled world through its epochs at Standard and Fine. Retain
existing correctness controls; do not add a physical simulation service, new
recovery machinery or reference-hash acceptance gate.

### M4 — Publish dimensional world geography

Sulion phase: `b305fe35-069c-4d3d-8cfa-beb6c63b9e5b`. State: completed.
Depends on M0–M3.

Scope: publish physical quantities, extent/membership, cause identities and river
dimension profiles through the existing fields/features/networks. Replace
mesh-index feature identity and count-based extraction filters where they defeat
world-scale coherence. Keep small-feature dimensions available without expanding
them to cell size. Adapt existing reads, exports, manual world edits and rendering
only where necessary to consume the corrected units and geometry; this is not a
palette, CSS or cartographic-tool redesign. Confirm that current world-stage
human/built consumers and existing child entry points remain compatible, without
redesigning those generators.

Acceptance: generated dimensions survive publication and are the same facts used
by inspection, drawing and export. Standard/Fine outputs at the same world extent
retain comparable feature scales and recognizable major geography. Different
world extents no longer reuse the same miniature landscape with relabeled units.
Determinism, authored protection, cancellation, atomic session publication and
undo continue to work.

Evidence: representative same-world Standard/Fine comparisons and a smaller and
larger world extent, inspecting real widths/areas/lengths and the existing map
surface. Choose a small set of contrasting seeds/landscapes during phase
expansion; no exhaustive seed sweep or repeated live-deployment walkthrough.
Run focused domain/generation checks and the relevant existing browser journey;
broaden checks only for changed behavior or unresolved failures. Record useful
timings and any geographic limits in this document/chat, not a separate report.

### Execution guidance and deferred decisions

The geometric representation, physical defaults and numerical tolerances are
implementation choices. M0 establishes whether the current triangular topology
is sufficient; modify its domain construction if necessary before considering a
replacement. Later calibration must evaluate geographically meaningful cases,
not lower thresholds or alter checks solely to make a result pass. Existing C#
fingerprints may need to become isolated reference-port checks as the active
algorithms change; do not preserve old game-unit behavior to satisfy them.

No user-owned decision currently blocks M0. Regional boundary fluxes, tributary
refinement and parent-history reconstruction are deferred to later regional
work. Their future design consumes the world-coordinate identities, dimensional
fields and network geometry retained here; it must not require unscaling a
world mesh or recovering physical widths from rendering pixels. Performance
targets can guide measurement but do not authorize caps or a new execution host.

#### M4 execution

Expansion `f7428db2-11f8-4048-8859-06ab82f92b1f` covers dimensional publication
and consumers, then representative completion checks. Its corrective sub-plan
`bf35a12e-977a-4f95-a342-059e0e31f774` addresses findings from three independent
reviews of geology, hydrology, magic and publication.

Published channels declare physical dimensions; river station profiles retain
width, depth, discharge and contributing area. Nodes use the elevation profile,
and network reaches retain downstream discharge. Resolved river drawing uses
physical station widths; the existing minimum screen glyph remains readable.
Fault influence widths remain geological attributes, not drawn stroke widths;
browser inspection caught and corrected that unit-consumption error.
Crater, volcano and caldera footprints come from causal event radii. Connected
gorges, glacial landforms and magical regions publish their geographic extents,
rather than a point standing in for their entire area.

Existing input geography is associated across resampling by kind, layer, magic
rule and spatial correspondence. Directed river endpoints and sampled line
distances prevent matching crossed rivers merely because their bounds overlap.
Exact cause identities take precedence. Existing names, relations, authored
details, protected geometry and boundary interfaces survive. When a retained
river anchors regenerated tributaries, their endpoints and elevation profiles
use the retained junction. This association is approximate for changing regions;
it does not reconstruct regional history or redistribute tributary flow to force
agreement with a retained river's earlier discharge.

The reviews exposed physical operations that the first conversion had missed:

- Sediment deposition and cold retention attenuated once per cell. Both now
  attenuate over physical travel distance. Hillslope transport uses physical
  activity with numerical substeps and a volume-per-contour-width limit.
- Coast erosion occupied one cell regardless of spacing. It now integrates a
  physical active band and deposition reach. A matched straight coast eroded
  5.883 and 5.850 billion m³ at two mesh densities, instead of approximately
  halving its affected volume. Fractional band coverage uses cell-distance
  approximation, not exact polygon clipping.
- Ocean smoothing crossed land and heat propagation lost local/upstream mixing.
  Masked smoothing and physical-travel mixing restore these operations.
- Coastal roughness amplitudes are metres; plume wander remains bounded per
  epoch rather than multiplying displacement by the epoch index.
- Magic retains physical coastal source bands, geothermal neighborhood maxima,
  beam-width wakes, magma chamber flags and coastal first-activity epochs.
  Independent system interactions remain active when the example container
  system is disabled. Editable presets expose the physical influence controls.
- Marine deposition could overspend its final remaining budget through floating
  allocation error. It now debits actual deposited volume and preserves exports.
- Tiny or narrow valid footprints could contain no lattice centroid. Only in
  that case, the same mesh is translated onto a covered anchor; its physical
  spacing and halo stay unchanged. A 1 km square has 1/1/6 content cells at
  Draft/Standard/Fine. Narrow footprints and disconnected components can remain
  undersampled; alignment does not add resolution or shrink physical features.

Focused checks include known-area runoff, physical sediment attenuation,
conservative hillslope spreading, coast volumes, ocean barriers/mixing, magic
distance/width behavior and preserved network junctions. Hillslope spreading at
two meshes measured 3.613 and 3.694 km, with relative volume error below 9e-15.
Finite sampling still shifts unresolved boundaries and sampled geothermal maxima;
additional samples do not promise vertexwise equality or reveal sub-cell terrain.

For seed 104729, a 4,000 × 2,000 km world through all three epochs and configured
magic systems produced the following matched comparison. Both qualities completed
and passed the physical publication and scale checks; the combined test took
about six minutes while other checks also ran.

| Quantity                | Standard |     Fine |
| ----------------------- | -------: | -------: |
| Maximum river discharge | 672 m³/s | 601 m³/s |
| Maximum river width     |    118 m |    100 m |
| Maximum river depth     |   2.47 m |   2.45 m |
| Terrain relief          |  2,911 m |  2,857 m |
| Land coverage           |    21.1% |    21.6% |
| Published river reaches |    1,060 |    1,482 |

Crater cause IDs and radii were identical. These are plausibility and physical
scale observations, not numeric parity targets. The earlier isolated timing was
about 55 seconds for Standard and 282 seconds for Fine; Fine remains expensive.
The unit suite also exercises other seeds, rectangular extents and contrasting
warm/glacial histories. Existing child entry points and authored thermal feedback
remain compatible; these checks do not claim regional refinement is implemented.

Completion checks: 96 unit/integration tests passed, including the full
Standard/Fine comparison; workspace typechecks and lint passed (two existing
nonblocking lint warnings). Production frontend build passed with its existing
large-chunk warning. The browser world/refinement/manual-edit/template/session
journey passed in about 2.8 minutes; its former 90-second wait expired while named
generation processes were still advancing, so the test now allows their observed
runtime. A separate continental landscape browser journey passed in 17 seconds,
and its screenshot confirmed that fault influence widths no longer cover terrain
with oversized strokes. Temporary test servers stopped on completion. No backend,
database, infrastructure or deployment changes were needed.

This plan does not close the broader product backlog. Regional boundary fluxes,
tributary refinement and history reconstruction remain deferred as agreed.

### Continuous river centreline publication

The physical mesh remains the drainage solver, but its triangle-centre edges
are not the published river geometry. `riverPaths.ts` removes cell-scale stair
steps along the dominant upstream/downstream path, keeping each relaxed node
inside its original triangle. All reaches use the same junction position.
Headwaters and water outlets remain fixed. Cubic segments follow the resulting
channel, with control points constrained to the convex union of each pair of
adjacent drainage triangles. This prevents smoothing across an unrelated valley
or watershed. The main stem shares its tangent through confluences; tributaries
join without being forced to turn upstream.

Curves are sampled with a geometric error tolerance, and elevation, width,
depth, discharge and catchment-area profiles are interpolated along their
directed source spans. The existing feature, network, clipping, inspection and
export paths consume this one geometry. Flow targets, water budgets, erosion
and authored geometry are unchanged. This removes lattice artifacts; it does
not invent finer terrain or implement physical meander migration.
