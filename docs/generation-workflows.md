# GIS/domain-backed generation workflows

Current execution follows [ADR 0003](adr/0003-frontend-session.md): a browser worker
uses in-memory inputs and returns complete validated geography. No persistent
state, restart, recovery, backend or MCP is part of this product phase.

This is the generation direction for Vellum & Vector. The
[product contract](product-spec.md#10-procedural-generation-domains) defines
behavior; [ADR 0002](adr/0002-relational-spatial-storage.md) records application
boundaries. User requirements and explicitly agreed constraints govern changes
to the implementation choices described here.

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
