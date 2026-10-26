# GIS/domain-backed generation workflows

Current execution follows [ADR 0003](adr/0003-frontend-session.md): a browser worker
uses in-memory inputs and streams validated output with transferable numerical
buffers. Initial generation also displays sampled epoch previews. No persistent
state, restart, recovery, backend or MCP is part of this product phase.

## Geographic regional refinement

Selected region subjects retain their original source and arbitrary hierarchy.
An explicit refinement action links a finer geographic area to that subject,
using its nearest refined ancestor. The regional sequence reads ancestor fields
and retained drainage, builds conditioned relief and connected water, adapts local
climate, and presents habitats and inherited magic without executing world epochs.
No region label or nesting depth selects another map type.
Seam-spanning regions retain short periodic field neighbors and travel distances.
Their mapped ways split at the chart edge while retaining one feature identity
and a shared network junction.

Inherited magic quantities distinguish material amounts from sampled influence.
Regional propagation reads retained sources and history; it does not locate new
sources, renew material stocks or replay ocean impulses. Retained landmarks keep
their signatures and identities. Society allocates rural residents by territorial
overlap and keeps located residents at their known seats. Finer opportunities
resolve existing local-town allocations; unmet works remain demands. Routes retain
their wear, highways, shipping and door meanings without running another era.

Ordinary map authoring uses linked feature representations and surface overlays.
Procedural inputs omit those drawings, leaving terrain, drainage, material stocks
and society unchanged. Publication restores the independent map edits. Rendering
and exports compose the mapped result, scoped by geographic ancestry, while
history and undo retain the original context. Shared two-dimensional anchors stay
attached without imposing numerical river profiles or frozen physical samples
on a creative edit. Replaced fine procedural representations remain under their
drawings; removing a source feature hides its mapped representation.

Preflight checks the original mapped snapshot before separating procedural
inputs. Structural feature changes protect their original and current local
geometry and surrounding footprints; surface painting protects its patch
footprint. Geographic generation that intersects either in the same located
space is unavailable, with an explanation naming the drawing and owning map.
Names and presentation styles do not restrict generation. Untouched descendants
and neighboring regions remain eligible, while existing finer drawings keep
their precedence. Naming overrides follow newly generated geometry and attributes
rather than retaining an obsolete shape. Undo or restoring the original structural
feature drawing removes its restriction without a separate lock registry. A drawing is never
treated as a newly reconstructed terrain, drainage or population simulation.

## Geographic publication

Published geography uses primary points, courses or areas according to its
source. Peaks and channel drops are located points; volcano centers retain cone
footprints. Gorges follow actual drainage through their classified extents.
Magic source/site complexes retain surrounding classified footprints. Fire
courses use conductive propagation links; Pressure wakes retain traced paths,
and interaction courses use their participating systems. Mask-only regions and
transition bands stay areas. A label or polygon boundary does not stand in for a
missing physical path. Existing identities and names survive anchor corrections
where the generated identity remains the same.

Located society works keep their specific kind and medium. Resolved intensive
activity can publish its modeled extent, explicitly distinct from a surveyed
parcel. Unresolved works and structures remain sites with modeled reach as an
attribute. Events can retain known affected community extents without inventing
hazard paths. World-scale demands remain unlocated aggregate forcing under
ADR 0005; extra discovery controls do not materialize them as works.

Optional feature footprints compose separately from primary geometry. Browser
reads, editing, measurement, spatial discovery, templates and export preserve
those roles under one identity and respect profiles and located spaces. The
shared type catalogue supplies the map's hierarchical feature controls and the
Atlas Features registry, including authored magic sources and unknown custom
types. Continuous fields retain independent display controls. Registry discovery
can open existing finer geography; it does not generate that geography.

**Magic clarification — 2026-10-22:** Fire, Aurora and Pressure are first-class
world effects and processes. Preserve their physical motivations, media,
feedback and interference without importing named setting lore. Read
[product specification 10.3](product-spec.md#103-magical-generation--fire-aurora-and-pressure)
and [magic source authority](../AGENTS.md#magic-source-authority) before extending
them. Future magic systems remain open through the shared process structure;
extension must preserve the current three's specific behavior. The representation described in the
implementation history below remains existing code, not a requirement to express
every behavior through a generic vocabulary or avoid system-specific operations.
Society's reads of magic and the coupling between the pillars are decided in
[ADR 0004](adr/0004-coupling-through-each-systems-medium.md).

**Society delivery — 2026-10-23:** `world.societies[areaId]` retains aggregate
communities, joint population groups, connections, completed eras, political
relationships, works, events and magic practice resources. Registered human-era
processes evolve population and migration, cultural contact, works/practices and
political reach. Culture, language and religious membership remain separate from
sovereignty, administration, control and claims. Settlements and roads consume
that state instead of the former capped placeholder selection.

World publication contains major centers and their routes, political territories,
population and affiliation fields, and major historical events. World settlements
carry their site class, reason and fortress flag and the work kinds their unit
demands of its country. At World a work is a demand rather than an earthwork at
a point: an intensive demand (clearance, burning, hunting, conservation,
irrigation, tapping, quarrying) acts over the unit's cells of its medium, a
structural demand (dam, harbour, pass, weir) carries an amount and a unit and
does nothing until a finer profile realizes it; the natures and units are
declared in `societyWorkNatures` and the rule in
[ADR 0005](adr/0005-scale-contract.md). Settlements, ruins,
waterworks, transport sites, land use, magic practice sites, institutions and
historical events have distinct layers and concrete feature kinds. A selected
creation profile also limits scene features and detailed geometry, so
materializing a Region does not expose its local features on the World map.
Creator authoring can shape the refined geography.

Local society queries use the existing sampling topology. Earthworks transfer
elevation changes to the existing native mesh without resampling untouched terrain;
Pressure pathways retrace when connected ocean cells change. This avoids both
unrelated coast drift and needless propagation while preserving actual coastal
changes and Aurora's temperature/ice dependencies.

Specialized population and work edits synchronize their retained society records.
Ordinary mapped geometry and surface edits do not alter those records.
Refinement subdivides population catchments and retains completed history and
feature identities; it does not rerun old eras. The inspector exposes population
composition read across the groups by culture, tradition, language and livelihood,
with the groups themselves folded into a table and edited one at a time, beside
support and practice resources, while generation controls supply era
duration, mobility and political capacity, and bind an era to a physical epoch:
an era bound to an epoch before the present runs inside it as a mobile round
whose cold-age works persist. Its camps are latent sites the present prefers;
one publishes as a World ruin only where it met the World's own settlement rule
or where the present finds its ground marked by a sealed vein or a drowned weir
line (a ruin field). Existing geographic
inputs and focused work refreshes support this subsystem. The cross-pillar
coupling decisions are recorded in
[ADR 0004](adr/0004-coupling-through-each-systems-medium.md).

The settled eras run as cycles whose length follows the pace of change: each
cycle spans the years in which the world's people would change by a fixed
share at the current logistic rates, bounded below by a settled decade and
above by a long lifetime, with wider bounds for a mobile round. A long history
therefore costs about as many cycles as a short one, and the end-of-history
water, dam and geography extraction runs once, when the last settled era ends.
The default history is one ice-age round followed by three settled eras with
rising political capacity, enough for the land to fill and kingdoms to
consolidate; the era form changes names, durations and variables. Towns draw
on their hinterlands: each catchment's town-dwellers are allocated among the
few centres within reach of it by the centre's current size, a seat, harbour
or pass, and travel cost, with a local share kept in the catchment's own chief
town and its latent small towns; centres draw their share as real migration,
bounded by the food their own catchment holds, so one town in a region becomes
the city of its hinterland. Ways are made by use: every connection remembers
its yearly travellers, from migrants, from hinterland town-dwellers walking the
least-cost path to their centre and from market traffic between its towns, and
a worn way costs less to travel for every later process. At World a land or
river way publishes as a track or a road by that wear, whatever the rank of
its ends, with a floor that keeps every major settlement and every capital's
regional capitals connected; a worn sea way publishes as a shipping lane that
hugs the shallow coast; and a strong polity raises a straight, named highway
along its seat's busiest road where the line between the two ends crosses
open, low country. Road geometry follows river banks and valley floors, pays
for forest, sodden ground and river crossings, and finds saddles through the
slope term. `pnpm --dir frontend inventory:society` prints a generated world's
demographic and route measures headlessly.

The current module contracts, feature-owned recipes, validity model and output
registration are described in [Generation modules and recipes](generation-modules.md).

Curated generation controls map a creator's outcome choice to the coefficients
that produce it: physical and living map outcomes, independent cultural and
political patterns, and distinct Fire, Aurora and Pressure controls that follow
the magic source authority and product contract above. Each control is declared
once with its alternatives and the values each alternative sets, in
`frontend/src/cartographicDraft.ts` for the physical and living controls and in
`packages/generation/src/magicCartography.ts` for the magic controls; those
declarations are the record of the values. All three systems support
independent inclusion.

This is the generation direction for Vellum & Vector. The
[product contract](product-spec.md#10-procedural-generation-domains) defines
behavior; [ADR 0002](adr/0002-relational-spatial-storage.md) records application
boundaries. User requirements and explicitly agreed constraints govern changes
to the implementation choices described here.

**Current replacement plan — 2026-10-19:**
[Fixed sampling replacement](#fixed-sampling-replacement-current-direction-2026-10-19)
restores a fixed metre-aware triangle workspace while retaining all causal epochs,
physical processes and configurable magic. Continuous scalar publication and
OpenLayers tiles retain the display work. The adaptive rewrite's global support
refinement and remeshing are retired from the active world path because their
measured cost did not deliver useful map quality. Scope is top-level world
generation and display; editor development and lower-level generation are excluded.

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
validates its result and updates produced/invalidated facts. If execution or
output validation fails, it records diagnostics, invalidates the process's
affected facts and continues when the working map still satisfies its existing
invariants. Processes with unavailable prerequisites are skipped without
consuming stale buffers. Completed work remains in place; failed processes do
not establish fresh output facts.

The result retains structured diagnostics with the process, invocation, epoch
ancestry, error code, message, stack where available and whether output was
omitted, skipped or retained with a warning. The worker streams these diagnostics
to the job inspector while running; they remain inspectable after completion or
failure. Recoverable errors do not open an error dialog or discard valid results.
Invalid configuration or inherited geography, cancellation, worker termination
and failures that leave the working map unsafe to publish still stop the run.
A long numerical process can split work internally to report progress and
observe cancellation.

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

### Initial-world configuration

The new-world wizard resolves one versioned JSON recipe before creating and
generating the world. `generationRecipeSchema` validates the seed, quality,
domains, feature-owned parameters and complete physical/ecological,
human and magical settings. `atlasParameterDefinitions` owns creator parameter
defaults, limits, units and display labels; the existing nested domain schemas
continue to own ecological and magical settings.

`prepareAtlasGeneration` binds those inputs to the configured causal sequence,
checks actual registry contracts and produces ordered diagnostics. The reviewed
configuration travels to the worker and must match the resolved inputs. Complete
settings participate in configuration identity and remain inspectable in the
in-memory run record. JSON editing updates only the wizard draft.

A new world includes cultural, political and built geography by default. The
People & places step shows each of those capabilities as its own group: its
inclusion, its curated pattern, the starting count the generator reads and,
below them, the human era schedule the cultural and political histories run
on. The advanced panel shows the same fields for one capability at a time, and
the step hides its own copy while that capability is being adjusted there.

The workflow edits version 2 `features`: `physical.impacts` omits the impact
capability, `physical.river-incision` omits cutting while retaining river output,
and `physical.glacial-sculpting` owns erosion, deposition and glacial relief
together. Shared routing, ocean and material providers have explicit dependencies;
they are capabilities rather than a permanent bulk of required support processes.
The older `processes` object remains a compatibility input. The resolver maps its
operation IDs to feature ownership and rejects conflicting coupled selections.

Feature-owned cartographic descriptors compose existing settings and selections
into curated choices for land, landscape and human geography. Independent
choices preserve unrelated inputs; advanced departures appear as Custom. Exact
controls and rich history/system editors remain available on request, with closed
forms unmounted. The former feature catalogue, stage/family metadata and full
execution inspector are removed. `projectGenerationSetup` supplies editable
controls, inherited restrictions and diagnostic owner IDs without copying the
execution contract into the UI. One canonical draft owns shared epochs, ecology
regimes, configured magic and cultural eras.
Review and worker launch use the same source identity and prepared configuration.
Invalid input and unapplied JSON stay visible and block launch. See
[generation modules](generation-modules.md) for the interfaces.

Native adapters distinguish initialized absent event histories from facts
produced by an omitted process. Structural water, material, ice and spatial
validation still runs. Native and outer fact validity update together. Fresh
regions reuse the wizard with fixed parent histories and supported local
processes. Inherited facts are identified from supplied channels and initialized
material, with scope and unit checks, rather than importing every possible fact.
Authored elevation without geological fields receives inert geothermal input and
zero absent event histories; applying present magic does not invent past events.
Existing-map regeneration retains its established entry point and process set.

### Epoch execution

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

Fire, Aurora and Pressure settings shape their sources, activity and retained
consequences. Preserve fracture-carried geothermal Fire, coldward Aurora
accumulation and ice retention, and the deep-ocean Pressure locus with ocean
propagation and coastal stress. Keep natural background, applied forcing and
retained consequences distinguishable. Magic changes physical facts consumed
downstream; these fields do not by themselves implement social use or its costs.

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

Keep numerical workspace in memory. Completed epochs retain their ancestry and
typed causal consequences without duplicating every intermediate field. The
epoch/final callback samples an independent display grid before generation
continues; transferring that preview never detaches live workspace arrays.

Plate advection transports carried fields one at a time through reusable scratch
space. It resolves category provenance before updating source fractions and
strengths, retaining material conservation, historical maxima and new-crust rules.

World-to-display interpolation builds compact typed weights in batches rather
than retaining JavaScript sample objects for every display cell. Repeated physical
projections reuse the working surface's channel buffers. The browser adapter yields
between process stages so the worker returns to its event loop during a run.
Individual processes still operate on the shared in-memory geography; this is
not disk-backed generation or a saved execution state.

Regular-grid contour extraction releases sampled-point and crossing caches as it
advances between rows. The contour edges remain available for polygon assembly;
shared crossings retain canonical endpoint order when recomputed.

The worker prepares field publication and sends numerical resource descriptions,
then transfers each backing buffer once, preserving shared views and topology.
World records arrive in batches. The editor installs available fields and records
progressively during initial generation. Completion carries no geography payload.
An interrupted initial delivery remains marked incomplete. The adapter uses no
acknowledgements, persistence, restart or recovery, and generation processes do
not know about browser messaging.

Regeneration still assembles the same delivered output before replacing session
geography through its existing publication operation. Check world revision and
field ownership. If intervening edits changed the world, keep
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

- Geological causes use world metres and sampling-independent initial sites.
- The native snow threshold of 300 represents zero Celsius, with ten native
  climate units per degree. Epoch temperature settings remain Celsius and sea
  levels remain metres relative to the world's calibrated sea datum.
- The game's central warmth source and mandatory scattered warmth pockets are
  disabled. User-configured sources provide magical forcing. Land and sea ice
  form where the latitude climate is cold enough, without coverage quotas.
- Each mantle plume's head moves 56–80 km per epoch along one heading, and that
  epoch's cone forms at the new head. Older cones go dormant and leave a chain.
  Fracture conductance moves with the plates, and 60 % of its excess over the
  floor heals each later epoch, so cooled conduits stop venting.
- Crust-bound magical amounts follow every internal material transport. Thermal
  forcing refreshes with climate; material feedback and elapsed storage advance
  once per epoch.
- Continental ancestry and current mechanical membership are separate. Persistent
  regional driving and contact resistance move and rotate plates. Accumulated
  extension can disconnect a plate into independently driven fragments; compressed
  continental contacts can weld without merging their material origins. Geological
  intervals have their own units, independently of ecological and societal years.
  Motion and boundary geometry update throughout each interval.
- Formation sets the water budget: each formation flood covers the share of the
  world that is not continental crust, so the land fraction a cartographer asks
  for is the land the first flood leaves. Once history begins, the inventory stays
  fixed through the final present pass. Grounded ice removes its water-equivalent
  volume from the ocean and melting returns it; floating sea ice does not. Explicit
  epoch water-level offsets apply separately. The eventual exposed land fraction
  can change as crust moves and basin capacity changes. A child inherits its
  parent's datum and never moves it. Rivers grade to the sea and never cut below it.
- A collision belt has a polarity: its hinterland is the side of the boundary
  holding more continental mass. The foreland rises to the crest within a
  narrower front; the hinterland carries the crest and a plateau shoulder that
  spreads retained continental shortening into roots behind the belt. Root
  capacity and prominence shape that distribution; evolution cannot manufacture
  continental material to reach a requested summit height. Surface construction
  adds relief above the supported column. The terrain choice sets construction
  budgets and plateau shape; Mountain ranges is the default.
- Ice mass balance follows climate: the lapse rate already in the temperature
  field carries altitude, and the separate altitude bonus is zero except under
  the Glacier-carved terrain choice. Terrain selection preserves the shared
  clock's temperature, ice, water forcing and elapsed times. The default clock
  includes a cold age independently of terrain selection.

Detail presets specify physical area per terrain cell in km². The creation
profile selects the physical scale; world dimensions determine how many cells
are required. `resolution.ts` owns the presets and workload calculation shared
by setup and generation. Setup shows live estimates for every preset and warns
above the default world's Standard workload. This warning does not limit map
size or detail. Numerical boundary support and authored refinement can add cells.

All qualities execute the physical processes and configured epochs. Generation
cost increases with physical extent and numerical detail. Native scratch arrays
are discarded before the result leaves the worker; no intermediate state is stored.

Continental deformation and crust transitions follow the characteristic province
size, so a larger world retains broad, irregular land masses. Candidate placement
covers the complete rectangular domain. Continent and province totals remain
creator choices. Impact, plume and fracture budgets express prevalence per
reference world area. Fire core budgets follow land area, Pressure loci and wake
budgets follow ocean area, and coastal impulse budgets follow shoreline length.
Their footprint widths, spacing, travel distances and physical feedback retain
metre units. Climate coverage remains an explicit latitude-frame choice.

Initial province sites are independently distributed, allowing unequal blocks
and locally clustered boundaries. Continental assemblies grow from anchors with
unequal area budgets. Correlated growth follows province adjacency, without
prescribed regional centers or exclusions between material origins. Mechanical
territories are initialized independently: one plate can carry oceanic and
continental provinces, and one material origin can span multiple plates.
Province contacts
come from their Voronoi topology, including neighbors across the cylindrical seam,
so a narrow shared boundary does not disappear between area samples. The crust
budget can still bring regions into contact, and later history can join or divide
landmasses; assembly totals are not a count of separate continents.
Uniform world-space samples estimate the
unwarped territory areas independently of terrain sampling; whole-block selection,
warping and crust transitions make the resulting continental fraction approximate.
Finite cell overlap transports material columns and histories. Newly exposed gaps
receive young oceanic crust; convergence consumes oceanic material and retains
continental overlap for roots. Exports through open boundaries are accounted for.
Rift strain and cooling travel with their material and alter physical support.
Active boundaries and rifts use
distance to the shared site bisector in the warped coordinate frame, keeping
closely spaced sites from marking distant interiors as active margins.

Marine margins retain transported highs, troughs and sills. Cooling, rift
subsidence, flexural loads and supplied sediment alter their depths; distance
from the current coast does not replace their crust with a standard floor profile.
Actual oceanic consumption supplies volcanic construction on the overriding side,
separately from plume chains. Constructed rock moves and loads the crust after
activity stops. Shelf exposure, basin opening and closure can therefore change
connections without drawing a new coastline template.

Regional refinement imports parent crust and accumulated material histories. It
first realizes the relief its parent left latent (`canonry.refine-relief`,
[ADR 0005](adr/0005-scale-contract.md)): the parent's gradient across one of its
cells sets how rugged the child's texture is and which way its ridges run, the
texture is added below the parent's cell at the child's wavelengths, each parent
cell keeps its mean height, and the inherited boundary band is untouched. It then
refines climate, drainage, erosion, ice and coasts on that surface without
assembling a new set of continents or replaying global plate movement. The
native work boundary can receive drainage outside the write extent, so an
inland patch does not require
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
adaptations. The cultural, political and macro-settlement generators now use the
aggregate society state described above; site/interior layouts retain their
existing processes. Earlier SQL migration and backend source are historical material
outside the current execution path.

## Completion work

The implementation history below follows Sulion plan `01c3a7d3-a35c-425c-b4c1-b9640d8bd670`.
Its generalized magic design is superseded by the 2026-10-22 correction above;
the implementation descriptions remain evidence of what was built.
The requested outcome is complete Canonry physical and magical generation in the
browser, including configurable epochs, impacts, glacial history and the Fire,
Aurora and Pressure systems. Backend and persistence remain outside this work.
The completed implementation milestones below establish process coverage, not
complete reference fidelity or satisfactory geographic output. The subsequent
investigation found generation, projection and display gaps documented below.

1. Physical history and configuration: expose event and landscape controls,
   epoch duration and ordering, and extract geographic features from the native
   fields. Check declining impacts and retained ice/erosion histories.
2. Configurable magic and causal integration: port fracture propagation, cold
   drainage and ocean rays; apply heat, ice, resistance, coastal, living (quickening,
   stillness) and ocean (upwelling, sea surface, fog) feedback in the physical
   sequence. Presets use declarative source, propagation, effect,
   feature and interaction definitions. Retain and advect accumulated histories.
3. Workflow and publication: configure and combine those systems through the
   existing generation and magic surfaces, expose natural/final geography and
   history channels, run focused generation checks and ordinary CI.

Implementation choices at that stage: the shared mesh and process runner used
transient arrays and represented the three systems through a bounded declarative
vocabulary. The earlier rule treating their identities as presets and forbidding
branches on system names is withdrawn. Preserve shared process contracts where
useful, and implement specific behavior where the authored systems require it.
Existing manually placed effects remain usable; this documentation correction
does not migrate runtime data. The numerical-scaling notes here describe the
initial port; later sections record metre conversion. Cultural and built
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
wandering wakes. Radial propagation supports located variants in the current
implementation. Definitions currently specify feedback, feature thresholds,
hysteresis and interactions, including thermal war rims, steam fractures and
pressure/Aurora breaches. Configurations participate in the generation hash.

Each epoch advects accumulated activity, first occurrence, storage and coastal
history with Canonry's crust source map. Climate-phase fields (Fire, Pressure)
alter heat, moved water and rock before hydrology; post-glacial fields (Aurora)
act through the charge their ice holds and carry ice persistence into the
following epoch; every evaluation re-applies the shared forcings. Society-phase
fields are made of what people did: each society cycle, inside a round or in the
present, the environmental refresh records tenure, walked ways and the dead on
the mesh, evaluates society-phase systems and re-evaluates any system whose
stocks people drew or deposited (cores cracked at a forge, seed planted, sap
cleared), then reclassifies. A world without a human era never runs it. Final
classification retains every
feature mask, natural geography, physical materials and a priority-selected
surface. An inland refinement has no fabricated pressure locus. A warm present
may have no active Aurora while preserving its glacial activity history.

The atlas publishes lakes as geographic polygons and extracts named peaks,
mountain ranges, valleys, craters, volcanoes, calderas, cirques, fjords,
moraines, gorges, waterfalls and magical landmark regions alongside its river
network. Landmark points identify connected regions; numerical masks retain
their full extent. Completed session generations retain epoch and magical
definitions when current settings change.

Named relief reads the final surface. Peaks are summits with at least
`PeakMinimumProminence` of topographic prominence. Ranges are connected land
above `MountainElevation`, or above `HillElevation` with `MountainLocalRelief`
across `ReliefRadius`. Valleys are runs of published rivers whose flanks stand
`ValleyMinimumDepth` above the channel for `ValleyMinimumLength`. A fjord is a
glacially eroded ocean cell with land on opposite flanks within
`FjordMaximumHalfWidth`; scoured open shelf is seabed. Moraines are terminus
till of at least `MoraineMinimumGlacialDeposition`; U-valleys are drainage
lines with `UValleyMinimumGlacialErosion`; cirques are strict ice-thickness
maxima on mountain land, so a level ice-sheet plateau has none. A crater is mapped only
while its rim stands `ImpactVisibleRelief` above both its floor and the
surrounding plain.

Regions larger than a few times their least named size split along catchment
units: river reaches between confluences with the catchments draining into
them, so pieces meet at drainage divides. Pieces of one region tile it exactly.
Enclosed gaps smaller than a region's least named size join it unless they hold
water or another named region.

Major landmarks ([ADR 0006](adr/0006-landmarks-are-injected-causes.md)) run
inside the epoch loop. `physical.landmarks` carries the counts of landscape and
magic landmarks a world is owed and contributes `landmark.emplace` after each
epoch's impacts and `landmark.maintain` before its history. At a top-level run
the emplacement pass draws a seeded roster for the shortfall between the counts
and the records already in the extent, each entry a kind and the epoch it forms
in; at that epoch the kind's siting rule scores the physical field (plains for a
cone, a plateau beside a large river for a canyon, a large river above base
level for falls, a long fall of the land for a scarp, a heat maximum for a
wellspring, deep ice for a vault, deep water for a locus, a wet wood for a
heartwood, a dead lake in a dry basin for a pan), the best separated anchor is
taken, measures are fitted to the site and the mesh, and the record is written to
`world.landmarks` at the present-day position the remaining drift gives it.
Records already present are walked back through the drift of the epochs still to
come and re-formed. A landscape kind writes its causes: a mountain is
constructed rock with resistant core, heat, fractures and volcanic activity; a
canyon is resistant rims with a channel cut as incision and a river captured
along a corridor; a ring structure is a dome of alternating resistance or an
impact; an escarpment is a fault trace with the two sides offset; a falls is
caprock and a step on a river. A magic kind writes a kept source record of its
system into `world.magic`, which the system's own evaluation picks up.
Maintenance measures each kind's signature from whole cells and applies the
smallest correction through the same quantities, booking relief in
`LandmarkMaintenance` and raising a source's strength to the cap its system's
activity allows. Extraction re-measures at present, names each landmark once
from the geography's vocabulary, publishes one `landmark` feature per record
under the record's id (geology layer for landscape kinds, magic layer for magic
kinds) with target and measured signature, drops detected landforms standing on
a landscape landmark's claimed cells, and keeps the landmark's fault trace out
of the faults layer. The great falls is latent at World: its step is held cell to
cell and its lip, plunge pool and gorge belong to regional refinement. A child
run re-forms its parent's landmarks and sites none.

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
| SeaIce                      | `seaIce.ts::seaIce`                                            |
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
Its declared differences include profile/density scaling, disabled central
warmth/pockets, per-epoch impact and volcanic controls, hotspot tracks with
fracture healing, authored-sample restoration and the latitude climate described below. Regional generation
additionally skips the 23 initial-geology and 21 per-epoch geology invocations.

#### Latitude climate

The climate steps keep Canonry's names, order and feature ownership. Their
bodies implement a latitude-organised climate in place of the reference's
radial frozen-world climate.

| Step                                  | Atlas operation                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ocean-currents`                      | Belt-driven drift turned along coasts into gyres (`oceanGyres.ts`). Western boundaries are intensified. Upwelling forms on subtropical eastern boundaries. A sea-surface anomaly is carried along the current from its source latitudes. Eddy mixing over 250 km applies only where opposing drifts meet, so a cell boundary forms a front instead of a step.                             |
| `temperature`                         | Global mean + epoch offset − 28 °C × P2(sin latitude) − 6.5 °C/km lapse, plus sea-surface anomaly and external heat. Crustal heat warms only geothermal vents, by up to about 3 °C. Hydrothermal heat carried by currents feeds sea ice and reefs, not air temperature. A seasonal half-range grows with latitude and continentality.                                                     |
| `atmospheric-flow`                    | Hadley, Ferrel and polar cells by latitude, with terrain deflection, belt speed, crest exposure, lee shelter and gap channelling (`windTerrain.ts`).                                                                                                                                                                                                                                      |
| `moisture-transport`                  | Air columns marched downwind in one ordered pass (`airColumn.ts`). They gather moisture over the sea and rain out with distance and uplift; pressure-belt rainout comes from `belts.ts`. Marine heat, maritime character and magical heat travel with the air. Air relaxes toward half the magical forcing beneath it over 300 km of travel, and that heat spreads 60 km across the wind. |
| `precipitation`                       | Column precipitation with the epoch multiplier, in mm/year up to a 4 m ceiling, split into rain and snow by the share of a sinusoidal year below freezing. The equatorial convergence spreads over 15° to stand in for the rain belt's seasonal migration; subtropical subsidence dries 20–35° and also caps uplift rain there.                                                           |
| `land-ice-mass-balance` and `sea-ice` | Ice extent follows mass balance and cold rather than a coverage quota. Epoch glaciation scales growth. Melting scales with the deficit. Current, wave exposure and local variation move the sea-ice edge by a few degrees only, so polar seas well below freezing freeze.                                                                                                                 |

**World frame.** The initial latitude frame is inherited by regions and places
the map between equator and poles independently of its physical size. An
equal-area projection or even-degree spacing maps northing to latitude.

Map boundary is a separate world setting. Cylinder, the new-world default,
joins east and west for crust, terrain, transport, drainage, climate and display.
The triangular world lattice has reciprocal short links across the seam;
geographic noise and reconstructed samples share the same period. Extracted
geometry is cut into chart pieces, retaining network junctions and directed river
profiles. The editor repeats the metre chart and normalizes edits into it.
Nothing retains open edges. Ocean surrounded remains unavailable pending an
ocean-rim condition that survives the physical epochs. Existing configurations
with an explicit legacy longitude choice retain that choice.

The setup's Latitude frame choice offers a northern band, both hemispheres
and pole-to-pole coverage. It does not change the map boundary. Pole-to-pole
cylinders retain local terrain and the same metre-scale noise up to their
north/south edges. Those faces close drainage and reflect transported material
locally; they do not merge longitudes into a single point or provide a shortcut
through a spherical pole. The connected ocean starts in the deepest basin. Physical
transport lengths stay in map kilometres; only the front-mixing width is capped
at 6° of latitude, so a small full-globe map keeps distinct belts. A numerical
patch without a world frame sits at the mid latitude.

**Rainfall regimes.** The `rainfall` setting scales moisture supply (column
saturation and the precipitation baseline), not rain output. Its Dry (0.07),
Mixed (1) and Wet (2) anchors live in one table, `rainfallRegimes`, read by the
setup choice and the Arid and Wet world presets. Each anchor is fitted to its own
outcome: Dry stays desert and steppe and no wetter than the former arid preset;
Mixed gives about 2 m at the equator, 1–1.6 m on tropical margins, under 0.35 m
in the dry belt and about 1 m on westerly coasts; Wet is at least 1.4 times Mixed
everywhere. Ecology reads plant water as the aridity index, precipitation over
potential evaporation (0.3 + 0.045 m/year per °C), not column humidity.
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

`PhysicalGeologicalFeatureIdentification` sits outside the physical layer
classes and retains triangle membership for named features. The atlas publishes
GIS geography using summit prominence, surviving causal crater footprints,
water-body polygons and connected river reaches. River reaches retain their
station profiles; they do not imply a separate whole-river-system identity.
Additional landforms and magical places use their supported site, course and
area geometry. Field-only geography remains distinct from named features.

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
- **Historical metre-plan choice, superseded by the continuous-terrain plan:
  retain triangular topology where it serves the algorithms.** Supply actual
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

### Inland work-area drainage

Open rectangular meshes describe a finite planar work area. If an epoch leaves
no connected ocean in that area, priority flooding uses its boundary as the
external drainage outlet. Ocean-connected drainage remains the default whenever
an ocean is present; subsequent epochs recompute the roots. This preserves sea
level and terrain instead of creating water to satisfy the solver. The reference
disk retains its closed-world requirement. This numerical drainage boundary is
separate from the inherited parent-boundary fields used by refinement.
Cylinder has no east/west outlet; pole-to-pole coverage also closes the polar
faces. These boundaries retain the existing approximate physical metre chart,
without introducing spherical geodesic transport.

## Continuous terrain and adaptive generation — replacement plan

State: execute the complete **top-level world generation and display** replacement.
The user's 2026-10-19 scope correction supersedes the earlier agent expansion into
editors and lower-level map generation. Sulion root:
`4aa8fb20-3d26-40a8-939a-ddf9a8bca02b`.

### Outcome and boundaries

Generate one physically scaled world with the existing geological, hydrological,
climatic, glacial, coastal, magical and human/built semantic operations. Display
its evolved terrain continuously, with useful physical detail around meaningful
features, coherent layer geometry and view-resolution rendering.

Complete the world generator and map display together. Do not stop at a terrain
demo or ship a second world engine. Preserve the existing epoch order, causal
feedback, feature identities, authored input protection and configurable magic.

**Excluded:** editor development, regional/site/interior generation, template,
routing-tool, analysis or export redesign, new river simulation, deliberate
landmark injection, political/cultural generator redesign, backend, persistence,
MCP, deployment machinery and style changes. Make existing-consumer compatibility
fixes only when the changed world output requires them. World units and outputs
must remain usable for later lower-level work.

**Numerical equivalence is not a target.** Preserve semantic operations and
plausible map behavior. Quantity and topology checks protect real geography;
they do not justify engineering-grade accuracy, unbounded numerical tuning or
repeated expensive worlds without a concrete unresolved question.

### Implementation direction

- Retain the TypeScript generation modules, existing process runner, browser
  worker, session publication and React/OpenLayers presentation.
- Use adaptive numerical support and shared continuous reconstruction instead
  of the fixed microtriangle world mesh and nearest-cell raster publication.
  Quality changes sampling, not physical feature dimensions or elapsed history.
- Refine causes and evolving relief where physical support is needed. Mountains,
  craters, volcanoes, shores and valleys remain products of the existing processes.
  Do not add an independent river-bed lowering or bank-shaping model to drawing.
- Waterfalls and gorges remain emergent consequences and detections of physical
  and magical evolution. Landmark injection was delivered afterwards as
  [ADR 0006](adr/0006-landmarks-are-injected-causes.md) and does not change
  this rule: a sited landmark injects causes and holds a measured signature.
- Render the committed field with standard OpenLayers view-resolution tiles.
  Terrain, lake geometry, relief and thematic layers must describe the generated
  world. Panning and zooming do not run new generation.
- Preserve categories as categories and scalar fields as scalar fields.
  Transfer conserved physical quantities appropriately across adaptive support.
- Keep expensive generation checks headless. Reuse completed output for overview
  and close display checks; browser journeys use small fixtures. Alert the user
  promptly if a conversion exposes a design mismatch or disproportionate cost.

Research that informed the representation choice:
[adaptive fields](https://basilisk.fr/src/grid/tree-common.h),
[coarse/fine water operations](https://basilisk.fr/src/saint-venant.h),
[continuous terrain research](https://perso.liris.cnrs.fr/eric.galin/Articles/2013-river-networks.pdf),
and [terrain display LOD](https://hhoppe.com/proj/geomclipmap/).
These inform spatial machinery, not permission to replace Canonry's generators
with a river-first terrain generator.

### World process coverage

The following assigns **all 55 current physical contract IDs** to milestones.
It is registration coverage, not a fresh claim that every implementation already
has semantic parity. For each operation, read its current implementation and
corresponding pinned Canonry body/helpers while porting, preserve its input causes,
transformation, feedback, retained history and outputs, and record any intentional
adaptation in this document. A process name, empty invocation or generic noise
replacement does not establish preservation.

| Owner                                  | Existing physical contracts to migrate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M2, geology (17)                       | `tectonic-provinces`, `continental-sutures`, `tectonic-margins`, `continental-domains`, `tectonic-uplift`, `landscape-initialization`, `orogenic-construction`, `mantle-plume-roots`, `volcanic-construction`, `impact-cratering`, `mass-wasting`, `crustal-support`, `lithospheric-flexure`, `fracture-network`, `geothermal`, `plate-advection`, `tectonic-epoch-activity`                                                                                                                                              |
| M3, water and sediment (12)            | `runoff`, `drainage-conditioning`, `lake-basins`, `drainage-guidance`, `flow-routing`, `river-network`, `ancestral-fluvial-erosion`, `post-fluvial-mass-wasting`, `sediment-transport`, `river-channel-geometry`, `river-floodplains`, `river-delta-formation`                                                                                                                                                                                                                                                            |
| M4, remaining physical evolution (24)  | `continental-margin-evolution`, `marine-sedimentation`, `coastal-detail`, `ocean-connectivity`, `ocean-distance`, `bathymetry`, `landmasses-and-shelf-groups`, `ocean-currents`, `warmth-sources`, `temperature`, `atmospheric-flow`, `moisture-transport`, `precipitation`, `land-ice-mass-balance`, `ice-flow`, `glacial-erosion`, `glacial-deposition`, `glacial-meltwater`, `glacial-runoff`, `external-coastal-forcing`, `coastal-erosion-and-deposition`, `sea-ice`, `glacial-landforms`, `landform-classification` |
| M5, coupled history and validation (2) | `physical-epoch-history`, `physical-structural-validation`                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

M5 additionally owns the complete configurable magic mechanism set: automatic and
placed sources; Fire fracture propagation and thermal/rock feedback; Aurora cold
routing, accumulation and ice retention; Pressure ocean rays, reflections, coastal
rays, wakes and rogue effects; storage, decay, first-occurrence and coastal history;
crust advection; feature growth/classification; cross-system interactions;
natural/final surface classifications; and existing placed forcing operations.
Preserve configurable variants, disable/enable behavior, source timing and
per-epoch activity. Use the earlier 15-reference-layer inventory as source
navigation, not as evidence that its historical gap statuses are still current.

The remaining world boundaries are `atlasWorkflow`, `atlasSequence`,
`atlasWorkspace`, `atlasProjection`, geographic extraction, the existing
`mapPeople`/`mapBuilt` world layers, worker/session publication and map tiles.
Editor and lower-level consumers are dependency context, not additional milestones.

### Milestones and acceptance

#### M0 — Shared world terrain contract

Record physical coordinates, adaptive-field ownership, reconstruction, publication
and the complete world process inventory. Preserve semantic algorithms rather
than array/hash/rounding equivalence. Existing source review and contract work is
retained; broaden no further into editor or lower-level generation requirements.

#### M1 — Adaptive support and continuous operators

Implement lookup, physical cell/face geometry, gradients, reconstruction and
appropriate quantity transfer. Focused coarse/fine, rotated-plane, narrow-feature
and categorical checks establish the representation. Do not create new landscape
behavior to satisfy an interpolation test.

#### M2 — Geological generation

Migrate all 17 assigned geological operations: world-space causes, crust,
tectonics, impacts, volcanism, fractures, support, mass wasting and material/history
advection. Preserve construction and later erosion/deformation. Actual relief,
not a crater or mountain label alone, must survive into the displayed field.

#### M3 — Hydrology and sediment

Migrate all 12 assigned operations with physical catchments, discharge, dimensions,
lake budgets, routing, incision, sediment, floodplains and deltas. Preserve topology
and receiving waters. Use the existing evolved terrain; no separate river simulator,
extra channel-carving stage or independently placed gorge/waterfall is required.

#### M4 — Climate, oceans, glaciers and coasts

Migrate all 24 assigned operations and retain orographic, oceanic, ice-load,
erosion/deposition, meltwater and coastal feedback. Focused cold/warm, wet/dry and
coarse/fine checks establish retained causal effects.

#### M5 — Magic and complete epoch coupling

Preserve all configurable Fire, Aurora and Pressure mechanisms, placed forcing,
interactions, history, storage, advection and physical feedback. Complete the
existing interleaved initialization, repeated epochs and finalization sequence.
The complete-world check must finish structural validation; a completed epoch log
is insufficient.

Evidence: one complete top-level world with repeated cold/warm epochs and all
existing world domains, plus focused causal magic variants and physical cases.
The previous requirement for multiple expensive full-world seeds was an agent
acceptance choice, not a user requirement; focused contrasting cases supply that
additional causal coverage without repeating an entire planet unnecessarily.

#### M6 — World publication and displayed layers

Finish geographic extraction and publish typed adaptive fields through the
existing worker/session path. Preserve current world-level cultural, political,
built and magical output. Eliminate nearest-cell world raster projection and
raster-strip lake/region outlines. Existing authored protection, cancellation and
stale-publication checks remain compatibility checks.

No editor improvements, child-profile work, template/routing-tool changes,
analytics or GIS export expansion are required for completion.

#### M7 — Continuous map display

Replace whole-field image stretching with OpenLayers tiles evaluated from the
shared field. Preserve current colors and interactions. Coasts, lake shores,
mountain relief, craters, volcanoes and valleys must show their actual generated
shape at overview and close extents. Thematic fields retain scalar/category
meaning. No zoom-dependent generation or extra landscape shaping is allowed.

Evidence: focused tile seams/category/patch checks, one existing fixture browser
journey, and geographic review of the same completed world at several extents.
Reuse generated output; do not regenerate worlds through browser journeys.

#### M8 — Finish and retire the active old world path

Check that the top-level world entry point uses the adaptive engine with no
legacy lattice/projection/display fallback. Retain useful reference fixtures and
the backend prototype. Run the applicable default tests, typechecks, lint/build
and complete-world check. Update current generation documentation and close the
corrected plan only after world generation and display work together.

Deployment is outside this request.

### Adaptive execution (superseded by the fixed sampling replacement)

M0–M8 are complete for top-level world generation and display. The active world
path uses adaptive SI control volumes, shared curvature-aware Hermite reconstruction,
typed publication and view-resolution OpenLayers tiles. Physical/magical epochs
and all existing world layers are retained. The failed terrain review led to the
reconstruction, physical slope and underwater presentation corrections below.
The experimental extra river carving and bank formula have been removed.

The execution notes below retain work history. Their earlier mentions of all
editors, child profiles, every consumer or mandatory river-profile machinery are
superseded by this corrected contract and are not further implementation scope.

M8 source inspection confirms that fixed triangle constructors remain reference-test
fixtures, with no active old world lattice/projection/display path. Existing editor
behavior and the backend prototype are preserved. Editor development, lower-level
generation and deployment were excluded from this plan.

The 4,000 × 2,000 km five-epoch run completed physical/magical history and final
structural validation in about 26 minutes, then exposed a lake-contour join defect.
A small reconstructed-shore fixture reproduced it. Shared contour-face stations
now prevent independently refined cells from choosing different crossings.
The complete publication/display check uses a 2,000 × 1,000 km world with the same
five epochs, processes, parameters and Draft detail. This changes the test extent,
not generation behavior or fidelity, and avoids repeating the largest history as
a debugging loop. The large-world structural result remains relevant evidence.

Algorithm changes use small deterministic tests as their first feedback loop.
`fieldContours.test.ts` covers exact-level vertices, disconnected islands, holes,
coarse/fine joins and fragmented label fields, checking geometry and coverage.
`adaptiveGeology.test.ts` includes an independent four-cell analytical diffusion
solution and material/history transfer cases. `atlasPublication.test.ts` supplies
small evolved states directly to lake/landform/event extraction, channel projection
and physical/magical refinement; no epoch generation is needed to test those
boundaries. Magic feedback tests use the adaptive mesh. Tile tests check the same
terrain painter used by OpenLayers without a browser or world generation.

The smaller five-epoch integration run completed physical history in about eleven
minutes but failed during landform polygon assembly. Sixteen small reconstructed
label cases reproduced self-touching/retraced contour walks in milliseconds per
case. The existing GIS engine now nodes and polygonizes that linework; face
selection samples the same field. Those cases check interior/exterior coverage as
well as validity. Full-world runs remain integration evidence, never a substitute
for reproducing a local algorithm defect. The commands are in README's development
section; no custom test runner or documentation-freshness assertions are involved.

After that correction, the five-epoch run completed geological extraction and
cultures, then exposed a separate political-contour support error. A 75 ms territory
case with a numerical halo reproduced it. Political boundaries now trace the full
field before clipping to the world; a stencil around owned interior samples cannot
bound a Voronoi field that remains positive in that halo. Single- and three-polity
regressions verify closure, world clipping and located polity coverage. The final
display review uses a single-epoch all-domain world, rather than repeating physical
history to verify an extraction correction. The five-epoch all-domain test remains
available explicitly; its last full run failed before this political fix.

The initial single-epoch all-domain world completed in 247.82 seconds with 132,079 adaptive
cells and 128 channels, including natural and magical features, three polities and
eight settlements. The ignored `frontend/.artifacts/generation/completed-world.bin` contains
its published field and features. Overview and feature images use the same terrain
painter as OpenLayers. That initial review exposed cell-shaped slope shading and
weak recognizable feature relief. Small reconstruction and physical-relief tests
using analytic inputs and the saved output isolated the failures described below.
Feature counts alone were not treated as visual acceptance.

Before the M7 corrections, normal CI passed 168 tests in 15.77 seconds, with shared
package tests run once. This established the fast regression loop and publication
corrections; it did not establish satisfactory terrain presentation.

M7 correction: the C0 bilinear/bubble reconstruction allowed slope jumps at cell
faces. Shared bicubic Hermite values and derivatives now constrain coarse/fine
faces; a quartic interior correction retains each measured height while vanishing
with its first derivatives at the edges. Monotone face slope limits and bounded
cell values prevent invented extrema. Point queries and bulk reconstruction use
the same patches; clipped extrema bound that same polynomial with Bernstein
controls. No renderer-only terrain, added noise or extra landscape shaping is used.
Local normalized quadratic fits recover corner curvature and mixed derivatives;
linear estimates alone biased curved surfaces and created repeated centre humps.
A direct curved-surface regression catches that defect. Sparse stencils fall back
to their fitted plane. Discrete quantities retain their category/extensive semantics
in both point reads and clipped extrema, including metre-valued lake stages.

The weak relief also exposed an incorrect physical parameter from the metre
conversion: `MassWastingStableGradient = 0.0072` treated slopes of about 0.4 degrees
as unstable. The baseline is now 0.7 rise/run, approximately 35 degrees, with the
existing material-resistance variation. This is the appropriate scale for the
model's rock/talus failure operation; [USGS talus examples](https://pubs.usgs.gov/of/1993/0278a/report.pdf)
give approximately 35 degrees. The earlier test requiring a gentle Gaussian hill
to spread was an agent assumption and has been replaced by an actually unstable
slope at two resolutions. A separate test requires gentle relief to remain intact.
The conservative transport algorithm and its physical reach/budgets are retained.

Direct generated-cone/crater cases now check relief before/after relaxation and
after material advection, including event location. Geological events already move
with the material; no extra relocation model was needed. Ocean hillshade now reads
the actual floor rather than suppressing all submerged relief. Lake surfaces stay
flat. Image review extents use event radii, so a 73 km crater is not judged from a
60 km-wide crop of its interior.

The world with corrected physical defaults completed all-domain generation and
publication in 267.11 seconds, with 131,974 adaptive cells and 128 channels. Its
overview and feature extents were reviewed, then redrawn with the final curvature
fit without regenerating history. A newly active volcanic island retains a summit
near 658 m where the earlier over-relaxed counterpart stayed submerged. Historical
event footprints can still be eroded or submerged; the renderer does not restore
pristine cones/craters over evolved terrain. Landmark preservation remains backlog
item 9. Draft output retains its finite sampling detail.

Final checks: normal CI passed 174 tests in 16.10 seconds, with lint, formatting,
workspace typechecks and Terraform formatting passing. The production build and
existing fixture browser workflow passed; the final browser journey took 37.9 s.
An interrupted browser invocation produced no test verdict and left an orphaned
preview process; that owned process was stopped before the successful rerun.
A subsequent category-extrema predicate correction passed its focused field suite.
No five-epoch all-domain rerun or Standard/Fine world matrix was used to debug these
local changes. Earlier coupled physical-history evidence and focused epoch/magic
cases remain the basis for epoch behavior.

Completed field data and terrain images live in the ignored
`frontend/.artifacts/generation/` directory. Browser tests clear `test-results/`, so
these reusable generation inputs are kept outside it. This is test output, with
no product persistence, recovery host or backend change.

### Adaptive M0 execution — shared contract and migration decisions

Sulion expansion `3aa87351-3837-4f7b-b87c-12b335954cc7`, anchored to
`46f83e56-f843-46dc-b44f-3d6e821633f0`.

1. **Fix semantic and spatial authority contract**
   (`e5c7ae6a-61c8-4d1a-b010-17f93df085dd`). Read the current field, mesh,
   projection, region extraction and domain field/worker contracts; record the
   emergent-feature correction and the shared data contract below. Verify by
   tracing the four M0 examples through generation, publication and authoring.
2. **Resolve migration dependencies and examples**
   (`e7a9d96d-b992-4522-a41b-127cd628b9ab`). Reconcile all 55 physical IDs and
   magic actions with the existing ownership table, including direct array users
   and exported prototype callers. Identify shared spatial operators before
   changing individual physical mechanisms. Source review establishes this
   design milestone; it does not establish implementation of later milestones.

Implementation decisions from the actual source contracts:

- Keep the existing process functions, registry and epoch orchestration. Replace
  their numerical spatial substrate: variable neighbor ranges, physical shared
  faces and cell measures replace three-neighbor triangle slots. A loop rewrite
  alone does not establish correctness: constant-cell arithmetic, counts,
  directional traversal and transport weights must be adapted in each family.
- Domain numerical fields support adaptive leaf data and regular authored patches.
  Both use the same scoped sampling, composition, integration and editing APIs.
  Regular grids remain a valid brush/template input, not a second world generator
  or a mandatory uniform raster through which generated terrain must pass.
- Adaptive data uses a serializable quadtree, leaf geometry and reciprocal
  variable-degree adjacency with shared-face lengths. Physical algorithms carry
  cell values and declared quantities; terrain reconstruction shares edge values
  across coarse/fine boundaries. Categorical fields use explicit discrete queries.
- Fields carry present evolved values. Geological sources seed initial physical
  construction, while subsequent operations update that state. Extracted gorge,
  waterfall and ridge geometry is derived from physical state and can guide
  resolution; it cannot reapply an un-eroded feature after evolution.
- Refinement transfers intensive quantities using physical measures, extensive
  quantities by apportioned support, and discrete categories by explicit ownership.
  Index-valued routing and derived fluxes must be recomputed after topology changes.
  Plain interpolation of those indices is forbidden. Quantities such as lake stage
  also require their domain relationship, not independent smoothing of each cell.
- Construction/remeshing happens at causal boundaries before dependent climate,
  drainage and transport passes. A shared transfer invalidates derived facts and
  those passes rebuild them. Do not remesh independently inside each domain or
  turn extra numerical work into extra geological elapsed time.

Concrete contract examples:

- An impact crossing patches is one world-space source. Adaptive samples resolve
  its initial bowl/rim/ejecta; later incision and deposition change those samples.
  Queries and tiles reconstruct the evolved surface, never the pristine impact.
- A river entering a lake shares its reach identity, bed profile and receiving
  body. Discharge is routed across the connected topology; the body's stage and
  terrain determine the shore. Neither topology nor shore is derived from painted
  raster rectangles.
- A protected authored stroke is a scoped patch of the same field. Physical
  sampling respects it, reconstruction and tiles show it, boundary validation
  constrains it, and undo restores the same prior geographic state.
- A material or polity ID is discrete at a query point; prevalence is a scalar
  distribution. Render antialiasing may cover pixels fractionally but does not
  interpolate category IDs or turn cultural overlap into exclusive territories.

M0 source review: the physical contract registry has 55 IDs, each assigned once
above. `PhysicalField` is typed arrays plus a mesh, event/fault causes and budget
totals; most process bodies depend on fixed three-neighbor slots. `GridSurface`
currently owns regular-grid overlays and the frontend materializes them at base
resolution. M1 supplies shared adaptive operators; M2–M5 migrate all those physical
and magic consumers; M6 replaces the mandatory base-grid materialization and
remaining authoring/human consumers; M7 replaces field-sized image presentation.
No implementation milestone is complete on the strength of this source review.

### Adaptive M1 execution

Sulion expansion `01762f8b-bf7a-49b7-bd0a-ac2d7b2b0756`, anchored to
`58041cc4-d5f0-4267-9ec9-19d2ff0db507`.

1. `1a4fadc9-da4c-41a1-b7c3-cd4ee9dc56e4`: implement serializable adaptive
   topology, leaf lookup and reciprocal physical face adjacency in domain modules.
   Verify partition area, boundary coverage and coarse/fine shared-face measures.
2. `366d3821-6b3f-452b-9c6f-ac0e68f53f32`: implement shared-edge reconstruction,
   gradients, category sampling and physical transfer between nested topologies.
   Verify linear-field reproduction, continuity and conservation through refinement.
3. `b577bbf4-22f3-4af2-995e-351a602331a8`: exercise a localized narrow feature,
   rotated fields, nonuniform interfaces and representative topology sizes. Use
   focused domain tests and typechecks, recording actual results here. The
   algorithms remain shared domain code; production generation cutover is M8.

M1 implementation: domain adaptive topology uses reciprocal variable-degree
faces, 2:1 cell grading, physical measures and tree lookup. Reconstruction shares
corner/edge values at nonconforming interfaces and retains physical interior
samples; categories remain discrete. Transfer integrates overlap and gradients
to conserve intensive integrals and extensive totals. Generated-field data can
retain adaptive samples directly, with footprint clipping and scoped evaluators.

An ungraded initial topology spread narrow relief into an overly coarse adjacent
cell. The focused narrow-feature case exposed it; standard 2:1 grading fixed it
without broadening the feature or loosening the geometric assertion. Field-shaped
construction stays with its owning physical operation in M2/M3, rather than
introducing independently placed gorge/waterfall primitives into M1.

The five focused cases cover variable-degree reciprocity/area, rotated-plane
reconstruction and coarse/fine continuity, conservative transfer/categories,
narrow feature support, and clipped fields/category queries. A representative
4,000 km × 2,000 km topology with a locally refined corridor used 15,532 cells
and 3.34 MB of topology arrays and built in about 0.25 s. This measures topology
construction only, not full generation performance. Domain typecheck and focused
lint passed; 87 other domain/generation checks passed during the shared run.

### Adaptive M2 execution

Sulion expansion `36671812-61ae-40e6-aa52-2b3a80b4c6a3`, anchored to
`b725cb8a-545e-4fe4-bcf2-cfb7b85d1f4c`.

1. `8266b407-5d3c-48f0-a5c8-7a44b3a7f6ea`: generalize physical spatial access
   to variable-degree cells, local size and physical shared-face geometry; add
   adaptive world workspace construction. Preserve the existing physical bodies
   and registry rather than introduce another generator. Convert common neighbor
   traversal together; semantic/weight conversions remain with each owning family.
2. `47f6b52c-8419-4e52-9f51-3092217a5978`: review and convert the assigned 17
   geological bodies and helpers, including source construction, physical distances,
   area-weighted components, transport and support. Remove fixed four-target
   advection assumptions and conserve material during spatial transfer. Refine
   physical state at declared causal boundaries with proper invalidation.
3. `ecda9086-205b-491a-bd0d-d5a51079e4e1`: check geological consequences,
   construction/evolution, material budgets, source scales and adaptive interfaces.
   Read the corresponding Canonry bodies/helpers and retain meaningful regression
   checks. Full coupled-world acceptance remains M5/M8.

M2 implementation retains the existing 17 process bodies and sequence. Province
warping, continental composition, relative plate motion, convergence/rifting,
finite crustal deformation, prominence ranking and shortening distribution remain
causal inputs to relief. Component statistics now weight physical area; influence
and suture contact searches use physical shortest distances. Airy support and
load/rebound retain their material interface, with conservative finite-volume
screened diffusion replacing equal-cell flexure. Hillslope transfer uses shared
faces, stable gradients, material budgets and physical substeps. Fractures steer
in world space with the existing novelty/strain/branching mechanisms, rather than
choosing lattice headings. Geothermal feedback still consumes those fractures,
plate boundaries, impacts and plume activity.

Impact and volcanic causes request local support before excavation/construction;
they are evaluated at the added physical samples. Remeshing conserves represented
material/history, keeps provenance discrete and resets index-valued diagnostics
for the already scheduled reconciliation. It never restores pristine event
relief. Plate advection now transports translated control-volume footprints by
overlap, including coarse/fine crossings, rather than scattering one coarse
column at its centre. The adaptive workspace is wired into the existing runner;
publication and display remain transitional until M6–M8.

Five focused adaptive geology cases cover support conservation, remeshing evolved
material/provenance, hillslope transfer, footprint advection and collision/rift
consequences. The complete draft initial geological sequence (4,000 × 2,000 km,
seed 104729) passes with 19,222 cells and physical impact/volcanic relief and fault
geometry. Its first measured run took 71.6 s: repeated overlap searches cost
31.1 s for volcanic remeshing and 34.6 s for impact remeshing. Reusing the same
geometric transfer calculation across channels reduced the complete pass to
7.6 s. Hillslope transport itself took 2.2 s, so replacing that solver is not
justified by this case. The user was alerted when the initial cost exposed this
design risk. Focused tests, generation typecheck and adaptive/physical lint pass.
Full multi-epoch, water/ice/magic and display acceptance remains outstanding.

### Adaptive M3 execution

Migrate the existing 12 water/sediment operations and their consumers of physical
geometry. Preserve priority flooding, lake volume/stage/spill budgets, drainage
capture, runoff/discharge, Strahler connectivity, incision, sediment deposition,
channel dimensions, floodplains and deltas. Continuous paths must remain inside
their drainage corridor and describe terrain modified by those processes.

1. Replace remaining global-spacing/count assumptions with actual travel
   distances and local/shared-face measures. Review the reference bodies while
   retaining each physical operation and budget.
2. Couple adaptive valley support and continuous paths to incision/routing;
   preserve confluences, lake/coast interfaces and emergent drops. Rebuild routing
   after remeshing at an existing causal reconciliation boundary.
3. Check branching/coarse-fine flow, closed/spilling lakes, sediment conservation,
   physical channel profiles and rotated corridor geometry. Keep full histories
   headless, with final cross-family acceptance at M5/M8.

M3 cost correction: the first river-supported world grew from 19,222 to 377,875
cells; refinement/reconciliation took 30.5 s and incision 24.0 s, before the global
finest-cell hillslope clock dominated subsequent work. Alerted the user rather
than continuing to force that integration scheme. Refine sharp drops at the
waterfall scale rather than applying that scale to every slope meeting the much
lower gorge-gradient threshold. Retain broad valley support. Replace the global
explicit clock with conservative implicit shared-face exchanges, preserving
rock-dependent stable gradients, source transport budgets and geological time.
This changes numerical integration, not the hillslope mechanism or product scope.

The corrective sub-plan is `f82a6759-a218-4701-9d8c-fd816a42c460`. It is complete:
implicit exchanges solve the thresholded shared-face material flux with finite
source budgets, preserving each configured geological pass. A queue revisits only
faces whose neighboring heights changed; there is no global finest-cell clock
or runtime cap. The existing physical-reach and material-conservation checks pass.
The world-sized first geology/river/sediment sequence now completes in 52.8 s at
207,442 cells: refinement/reconciliation 17.3 s, incision 12.0 s, post-fluvial
hillslope transport 3.9 s and ocean currents 13.1 s. Ocean transport is M4 work.

M3 implementation also separates the reference's heavy-tailed cheap-corridor
cost from physical flood height. Dijkstra propagation uses actual segment lengths
through a seeded world-space resistance field; flood height remains the minimum
physical spill surface, with ranks ordering flat drainage. This retains preferred
branching corridors without adding one vertical epsilon per refined sample.
Runoff, catchment and lake losses remain area-weighted. Reach lengths, sediment
residence, channel/floodplain expansion and delta extent use physical travel.

Adaptive river paths cross shared-face portals, with each curve bounded by its
own control volume. Confluences share positions/tangents; receiving-water endpoints
meet water level on the same continuous terrain evaluator. Valley support is
refined before incision and all drainage indices/lake budgets are rebuilt there,
without rerunning geological time. Sharp-drop support uses the waterfall gradient,
not the lower gorge threshold. No independent gorge or waterfall primitive was
introduced. Six focused cases cover corridor continuity, receiving shore, runoff
conservation, flat conditioning, closed/spilling lake budgets and incision/drop
consequences. Publication/extraction and final terrain-profile agreement remain
part of M6–M8 integration, rather than another uniform raster projection here.

### Adaptive M4 execution

Keep all 24 assigned physical operations and the existing causal schedule. Replace
remaining equal-distance/area assumptions, including initial sea coverage,
ocean/shelf distances, current and atmospheric transport, orographic gradients,
ice balance/flow and coastal erosion. Use existing physical influence lengths;
refinement must not create additional elapsed climate or glacial activity.

1. Convert ocean connectivity, shelf/marine structure and atmosphere/current
   transport to physical area, travel and shared-face geometry. Preserve currents,
   geothermal mixing/cooling, wave fetch, wind bands, rain shadows and runoff.
2. Convert ice support/flow, erosion, deposition, meltwater, coastal forcing and
   derived landforms. Preserve load/rebound and subsequent water reconciliation.
3. Check wet/dry and warm/cold contrasts, coarse/fine transport, ice retreat and
   material accounting. Reuse the measured world scene; full magic/history and
   application publication/display remain M5–M8.

Coupled review must also resolve physical source support for fractures: their
paths now steer in world space, but painting a source into an unresolved coarse
cell still broadens its conductance. Prepare the actual path, refine its support,
then apply the source at the added physical samples before geothermal feedback.
This is an M2 integration miss to finish in M5, not a reason to drop fracture
feedback or accept a visual-only curve. Final continuous terrain/profile
constraints and their authoring/query agreement remain explicit M6–M8 work.

M4 sampling correction: a predicted-cold/roughness policy grew the draft to
602,797 cells and the test process reached about 2.9 GB RSS before publication.
Alerted the user and removed that broad trigger. Climate temperature alone does
not request detailed physical terrain. Actual grounded ice-flow paths request
support immediately before scour; thickness transfers conservatively and ice
routing is rebuilt without repeating accumulation. Coastal support remains
before its construction and scheduled climate reconciliation. Full coupled
spatial-fact reconciliation remains part of M5 acceptance.

M4 implementation uses physical area for ocean and ice coverage, weighted
shortest paths for shore/shelf/ocean distance, local gradients and travel for
precipitation and atmospheric fetch, and characteristic upwind interpolation
with source floors/cooling for ocean heat. Screened diffusion assembles only
participating cells and conserves each disconnected component independently.
Coastal exposure/erosion uses actual shared-face segments and local strip
coverage. Ice curvature/advance uses physical faces/distances; ice flux,
grounding, scour, deposition, meltwater, runoff and retained history keep their
existing causal bodies. Landform neighborhoods sample the continuous field at
their physical radius rather than counting the mesh's neighbors.

Six focused cases cover area-based connected ocean, coarse/fine heat and cooling,
independent basins, physical ice flux/scour/retreat, coastal strip conservation
and floating frozen-lake ice without bed scour. The coastal physical fixtures
now use adaptive work cells; their convergence assertions were retained.
The focused physical suite has 65 passing cases. Generation typecheck and physical
lint pass. The world-sized geological/river/sediment/glacial transition completes
in 228.1 s at 358,546 cells, including actual ice-loaded support and warm retreat.
Grounded-flow refinement added 24,300 cells instead of the earlier broad cold
policy. This is a substantial headless runtime; remeshing, flexure and current
solves remain costs to measure in complete M5 worlds. No M5–M8 completion is claimed.

### Adaptive M5 execution

Sulion expansion `77de2eef-c5c7-4206-8953-387428348fc7`, anchored to root M5.

Retain all configurable magic mechanisms and causal interleaving; test semantic
effects rather than reference hashes. Fix the discovered fracture-support miss
before claiming complete coupling. Keep one shared state and the existing worker.

1. Prepare/refine physical fracture sources before applying conductance. Convert
   automatic/placed magic sources, physical propagation and beams, history,
   storage, advection, feature growth and interactions to the adaptive geography.
   Preserve independent configured variants, timing, enable/disable and feedback.
2. Reconcile spatial facts after topology changes without duplicating physical
   growth or elapsed epochs. Check the complete 55-process schedule, feedback and
   structural validation against the shared numerical state.
3. Run focused magic causal checks and full headless worlds with different seeds
   and histories. Measure cost/memory; alert when a mechanism/design needs revision.
   Complete publication, authoring, renderer and retirement remain M6–M8.

M5 source and spatial conversion is implemented; coupled-world validation remains
open while independent M6 integration proceeds. Fractures retain their planned
world-space network during support refinement. Ocean magic integrates continuous
headings and physical beam footprints, with configured rays, reflection, decay
and wakes retained. Cold transport uses local travel and extensive retained
activity; thermal/rock/coastal feedback and advected history remain interleaved.
Remeshing rebuilds lake levels from retained inventory rather than independently
interpolating level and depth. The focused physical suite has 67 passing cases;
the complete five-epoch headless run completed all five epochs in 2,596 seconds,
then failed final grounded-ice support validation. The failure is unresolved;
this run does not establish complete coupling. It loaded the earlier remeshing
implementation, so it does not measure the subsequent transfer optimizations.

### Adaptive M6 execution

1. Publish adaptive topology and evolved physical samples directly through the
   shared evaluator. Remove the experimental extra river carving and bank formula;
   no new physical shaping model is required to finish world generation.
2. Complete world-level geographic extraction and preserve existing human/built
   world layers. Pass typed output through the existing worker/session publication.
3. Editor development, lower-level profiles and analytics/export expansion are
   excluded. Existing authored-protection and publication checks remain useful
   compatibility checks, not new product work.

M5 acceptance remains required while independent consumer/display work proceeds.
Its final grounded-ice support failure needs a focused reproduction before another
complete world run. No M5 completion is recorded.

The ice-history failure has a small reproduction: separately limited intensive
transfer made grounded historical flux exceed total historical flux after a split.
Refinement now inherits recorded maxima from their parent support, matching the
meaning of a historical observation; it does not interpolate independent new
extrema. Grounding is recomputed after remeshing and authored-floor restoration.
Structural validation remains unchanged. The complete-world rerun is still required.

Coupled-cost blocker (`c896975a-7436-4741-9c1f-d5e6d6b282c2`): the first full
five-epoch Draft run exceeded thirteen minutes with about 2.3 GB process RSS.
A three-second live Node CPU profile located the work in the screened-diffusion
solve called by ocean-current direction smoothing. The run was stopped. Replace
Jacobi-only conditioning with a symmetric aggregation multigrid V-cycle while
CG still solves the same fine physical equation to the same residual tolerance.
Connected aggregates and Galerkin coarse operators preserve independent basins;
this is numerical acceleration, with no reduced transport reach, epochs or
physical activity. This follows the established aggregation/Galerkin mechanism
described in the [PETSc solver manual](https://petsc.org/main/manual/ksp/).
The logged coupled run will be repeated after focused operator checks.

### Fixed sampling replacement (current direction, 2026-10-19)

The user rejected the adaptive rewrite's cost and a proposal that reduced the
multi-epoch generator. Restore one fixed triangle sampling mesh per run. Preserve
all physical operations, evolving epoch state, metre-aware parameters and the
three configurable magic systems. Continuous publication and display must read
the evolved geography rather than expose nearest-cell polygons or add cosmetic
terrain. Dynamic global refinement is no longer required. The earlier adaptive
plan below records history, not a requirement for the active generator.

Scope remains top-level world generation and display. There is no backend,
editor, child-generation or landmark-injection work in this replacement. Runtime
improvement is measured; it does not authorize budgets or omitted processes.

Sulion root `045cca39-e0ba-4f46-b1be-5d864d9ed1d6`:

1. Restore fixed sampling and continuous publication for the full generator.
2. Repair demonstrated terrain/drainage defects with focused algorithm cases.
3. Update detail labels and check complete Draft/Standard worlds and display.

Phase 1 expansion `eea3c53a-63db-4b3a-9d3b-97755d57c92a`:
construct a fixed workspace and reusable interpolation weights; reconnect every
process, magic and geographic output; then exercise short complete histories.
Regular field publication is an implementation choice, not a new product
requirement. It must preserve categorical reads and continuous physical values.

Phase 2 expansion `07b361f6-6cd6-4588-8986-0fe530a82bb8`: restore Canonry's
outlet-rank progress comparison on conditioned flats, then inspect evolved terrain
and geographic extraction. A focused flat-routing case fails with the parent-only
bonus and passes with rank progress. Profiling the fixed world identified nearest
triangle search as the largest remaining cost; an exact lattice calculation
replaces neighborhood scanning inside the numerical boundary. Brute-force nearest
site comparisons, planar interpolation and cross-face continuity check this choice.

The fixed field shares centre, face and vertex values. Face averages preserve
connections between adjacent classified cells; vertex averages join incident fans
without discontinuities or invented extrema. Continuous channels reuse prepared
weights for publication, while categories retain discrete identities. Retained
magic inventory is published from density times the destination sample's area.
Classified-region contours follow these linear fans directly, avoiding adaptive
root searches on a fixed linear field. Boundary-aware contour selection checks
the complete interpolation support, including neighboring cells added around a
region. Interpolation preserves constant fields at contour thresholds. Lake
contours retain floor/stage and body membership, including the numerical halo
before clipping to the world.

Existing child generation remains on its prior path; this replacement does not
redesign it. Focused tests cover metre planes, shared faces, nearest-site lookup,
connected and disconnected region extraction, publication units and magic
inventory dimensions. The fixed world geology/glacial transition check takes
about two seconds of test execution. Full world timing and visual review remain
separate from the fast algorithm suite.

Phase 3 expansion `3356bd6f-e90e-4aa2-af81-df51c2e0daca`: complete three-epoch
Draft and Standard worlds with all domains and Fire/Aurora/Pressure; check existing
authored/inherited compatibility; check labels, display interaction and required
repository checks. Headless 4,000 × 3,000 km runs with seed 104729 completed in
41.7 seconds at 435 MiB peak RSS (Draft) and 75.5 seconds at 657 MiB (Standard),
including final publication. The earlier adaptive Draft with those settings took
449.1 seconds at 4,315 MiB. These are local Node measurements, with some concurrent
test load, not browser runtime guarantees. Every run retains the full three-epoch
schedule and all configured magic. Standard's headless run completes without OOM.

Visual review confirms that relief, water, geological events and river networks
are present, but coastal drainage still includes excessively parallel stretches
and Draft cannot resolve small terrain. Fixed sampling addresses the runtime and
memory failure; it does not establish that those remaining geographic quality
problems are solved. Do not hide them by pruning rivers to a quota or adding
display-only terrain. Further quality work must address the physical causes or
the map's scale-aware presentation explicitly.

River correction (`631863c8-fbac-4df6-8e46-6ad82decf7d5`, 2026-10-20): world
river vectors now require a basin with at least 350 m³/s annual mean discharge,
while retaining the qualifying basin's smaller tributaries. This restores a
distinction between substantial mapped basins and their headwaters. The physical
25 m³/s basin threshold remains unchanged: raising it also removed smaller
channels used by waterfall detection. Complete runoff routing, physical channels,
erosion and landform detection remain independent of world vector qualification.
River symbols distinguish measured channel widths at continental zoom and use
the longitudinal physical width profile when zoomed in.

On completely flat terrain, routing uses the immediate flood-parent direction.
Long-range direction smoothing had cut across the flood's least-resistance
corridors. Small cases at two sampling densities reproduce that loss and check
that the selected paths retain those corridors without changing water levels.
Varying terrain retains lookahead, capture and inherited-valley guidance. The
same complete Standard world now publishes 193 river reaches rather than 1,481;
its waterfall and gorge outputs remain present. The overview loses the excessive
coastal comb, although individual bends can still expose coarse sampling. This
is a qualification, routing and display correction, not evidence that every
remaining river-shape limitation is resolved.

Water-boundary repair (`00fb900c-c121-44e3-b8b5-e39e1b1d4cb8`): the fixed
world's regular scalar grid approximates the physical field between publication
samples. Reconstructing a second shoreline from that grid moved it away from
the physical river mouths. Completed fields now carry the physical ocean extent
as geometry; river clipping and both raster renderers use that boundary. Lake
inlets and raster water likewise use the published lake polygon. Explicit terrain
overlays still expose authored islands. Small curved-coast and island cases check
this through physical generation, scalar publication, field validation and tile
sampling, including nonzero sea level and intentionally coarse publication.
Fixed-world lake extraction also intersects floor and body-membership contours
directly on the physical fans. A local resampling grid had missed a shallow wet
cell and left one inlet disconnected. The complete Standard check now accounts
for every terminal reach: 11 ocean mouths, 30 lake inlets and two map-edge outlets.

Geological event and fault coordinates now use the continuous physical motion
field rather than independent nearest-cell velocities. Fault segments receive
additional support before movement so their geometry follows the deformation.
The material transport and epoch schedule remain unchanged. Faults have their
own optional `Fault traces` layer with a dashed symbol; physical map views leave
it off by default. Surface landform extents stop at the ocean, while fjords retain
their marine extent. This separates subsurface geological traces from the
topographic surface without removing their physical effects or history.

### Adaptive M7 execution

Sulion expansion `c5d32e35-ec91-45f2-ba6b-d2c4a40021bf` runs against the shared
field contract while world publication and complete generation checks stay open.
This scheduling overlap does not waive M6 acceptance or authorize a partial cutover.

1. Replace whole-field image creation and `ImageStatic` with OpenLayers'
   `ImageTile` source and ordinary canvas tile layer. Evaluate the committed field
   at tile pixel positions and derive hillshade using neighboring world positions.
   Reuse current colors and map interactions. Field reads retain typed samples and
   authored patch resolution; they do not copy a world into JSON number arrays.
2. Check neighboring tile edges, footprint clipping, categorical queries, zoom,
   edits and picking using fixtures and one small worker path. Complete physical
   histories stay headless; no new history or facts are generated by panning.

The field-backed tile path is implemented. `ImageStatic`, whole-world canvas
encoding and copied JSON sample arrays are removed from frontend presentation.
Tile pixels and hillshade query the shared evaluator, including authored overlays;
one-pixel gutters sample neighboring geography. Sixteen focused checks pass for
tile partition equivalence, discrete materials, clipping, small patches, strokes,
publication and undo. Frontend typechecking passes. Interior reconstructed vertices
are bounded by their contributing samples to prevent invented brush peaks; planar
and coarse/fine continuity checks still pass. All 111 package tests pass, and the
existing browser terrain/culture/politics/magic authoring workflow passes against
the tile renderer (36 seconds; fixture generation). The temporary test server is
stopped. This does not establish real-world relief fidelity. The complete headless
world and its display at multiple extents remain required for M7/M8 acceptance.

## Ecology and organic geology

Physical generation now runs atlas ecology processes on the same numerical map as
climate, drainage, erosion, ice and magic. The biome field describes living cover;
`landform` continues to describe relief. A plain can carry forest or grassland.
The **Biomes and life** layer contains cover, productivity, functional animal
biomass and organic source fields. A categorical Biomes overlay is visible by
default. Forests, woodland, swamps, marshes, grassland, savanna, desert, tundra,
barren land and the magical biomes (Ember grove, Thaw meadow, Rime forest,
Glow-lichen barrens, Fog heath, Moss forest) also become selectable polygons.
Default vector colors follow the
biome palette. GeoStyler starts with biome-specific rules, so editing symbols
retains the classification. Categorical legends use composed coverage, including
authored patches and finer field parts, rather than hidden base samples.

Four functional plant groups compete: grass/shrubs, broadleaf trees, conifers and
wetland plants. Woody groups have separate young and
mature cover. Temperature extremes, drought, waterlogging, light, soil depth and
available nitrogen affect establishment, growth and mortality. Broadleaf and
conifer groups have different cold, heat and waterlogging responses. Soil depth,
water, nutrients, seed banks and disturbance damage persist between epochs.
Growth changes the community; biome names classify the resulting cover.

Initial worlds receive geographically varied founders. Subsequent establishment
requires surviving plants, viable seeds or a reachable colonization front.
Dispersal takes physical travel time and responds to terrain, wind speed and
direction, waterborne transport and configured migration strength. Ice
interrupts colonization.

Propagules also cross the sea (`ecologyCrossing.ts`). Grass and wetland groups
travel with the wind; tree groups raft on currents. Arrival waits
`interval × exp(effective distance / reach)`, where the carrier shortens
distances downwind or down-current and islands act as stepping stones. Nearby
downwind islands colonize within decades, upwind and remote islands much later,
and a very remote island gains grass long before trees. Suitable climate alone
cannot recreate an extinct forest on an isolated island that no crossing reaches.

Grazers, browsers, predators and aquatic consumers migrate toward reachable food
and refuge before reproduction, starvation, consumption and predation alter
their biomass. Terrestrial animals occasionally found a small population on
unoccupied land with forage across the sea. Aquatic populations require connected
water and production; they do not appear spontaneously in a newly flooded
isolated cell.

Erosion and glacial advance strip soil and seed banks. Fire ignition depends on
fuel, drought and the epoch's fire regime; fire spreads through connected fuel
with wind speed and wet barriers affecting travel. Floodplains and deltas flood
more often with stronger seasons and runoff. Floods kill young plants and part of
the mature cover by group sensitivity, scour seed and leave nutrients, and their
yearly frequency adds growth mortality, so flooded ground favours wetland and
grass. Below the fronts' presence threshold a group is locally extinct and
returns only by dispersal. Volcanic construction and impacts also remove
vegetation. Regrowth depends on the remaining substrate and sources.
Plant litter supports soil development and nutrient availability. Roots and soil
affect infiltration and evapotranspiration, which feed runoff, local cooling and
downwind moisture. Cover increases resistance to river erosion and hillslope
movement. Ecology responds both before incision and after glacial evolution;
drainage refreshes after each response.

Configure **Ecological regime** inside each physical epoch: rainfall, seasonal
contrast, productivity, fire, migration and soil recovery. Rainfall scales physical
precipitation as well as ecological water availability. Seasonal contrast estimates
winter cold and summer drought. The **Ecological cycles** preset supplies wet
expansion, a dry fire age, cold retreat and refugial recovery. These controls
change processes rather than requesting a particular biome. Existing climate,
ice, hydrology and per-system magical activity also shape each epoch.

Magic acts on the living landscape through each system's own medium, never through a
generic altered plant group. `quickening` speeds growth, decomposition and succession
and names Ember groves and Thaw meadows; `stillness` holds charged cold and names
Rime forests and Glow-lichen barrens; a Pressure front's fog names Fog heath and
Moss forest. `vegetationGrowth`, `fire`, `organicPreservation`, `seedDispersal` and
`animalToxicity` scale growth, burning, preservation, migration speed and habitat
toxicity by configured system intensity, independently of the system's name. Toxic
habitat changes forage and animal passage. Magical feature conditions can inspect
living cover, soil water, toxicity and animal biomass.

A magic-only generation refreshes living fields and ecological polygons while
retaining existing terrain and completed epochs. Obsolete generated ecological
regions are replaced; authored/protected features stay authoritative. The shared
geographic identity matcher associates ecological polygons after resampling, so
matching regions retain their names and relationships when contours move.
Protected biome samples also govern polygon classification.

Names use the standalone `@atlas/name-forge` runtime in `packages/name-forge`.
The atlas owns its configuration in `packages/generation/src/namingCultures.ts`:
five spelling traditions loosely inspired by English, Italian/Iberian, Nordic,
Arabic and Japanese place names. Character Markov chains trained on place names
provide most settlement names, with occasional curated compounds. Geographic
names combine a generated stem with an English geographic descriptor. These
corpora and grammars are independent of Ice Remembers' naming configuration.

The naming vocabulary describes GIS features: `biome` with the classified biome
type as its subkind, `ocean`, `river`, `lake`, `landform`, `settlement`, `polity`,
`culture` and configured magical places. Existing ecological feature kinds such
as `forest` and `wetland` retain their rendering and geometry contracts; the naming
adapter maps them to `biome` and carries `attributes.biome` as the naming subkind.
The Oceans and seas layer partitions the shared sea outline into named marine
regions. Broad expanses remain distinct where their connecting passages narrow
substantially; shallow sills support this distinction, while minor seafloor relief
and changes below the sampling scale do not create more names. Smaller adjoining
basins and shelf-dominated regions use the Sea descriptor. Detection follows the
physical mesh across the cylindrical seam and does not use plate or province
boundaries. Region extents partition the existing sea outline, preserving its
shoreline and islands. The existing naming and authored-protection rules apply.

Names depend on the world seed and stable geographic key, using a separate random
stream. Seeded geographic naming traditions cover physical geography even without
society generation. Initial languages reference those same traditions. Population
groups record per-language `languageShares`: overlapping `knowledge` and exclusive
naming `use`, each expressed as a fraction of the group's residents. Use totals at
most one; the remainder is unspecified. Simple authored input can still list known
languages and one `namingLanguage`; omission defaults to the first known language,
while explicit null means unspecified use. Explicit shares are authoritative;
the language list and primary naming language summarize them. Migration carries
the shares with people, and merging groups preserves weighted language counts.
Human-era contact
shifts usage through all occupied connections without removing multilingual
knowledge or changing population totals. Political control does not overwrite
resident languages. Isolation can change cultural identity while retaining language.
Language contact updates shares without splitting groups by every language
combination. Exact individual multilingual correlations are not retained; people,
culture, religious and practice affiliations still distinguish demographic groups.

The Languages layer publishes both overlapping `language:<id>` knowledge and
exclusive `languageUse:<id>` shares. Empty communities have no language-use signal.
The field is a projection of population groups, not an independent simulation.
Current knowledge, use and per-cycle usage history are inspectable. Population
authoring can select one naming language or edit individual knowledge and use
percentages. Raising one use share beyond the available remainder proportionally
reduces other use shares; knowledge stays at least as high as use.

New settlements choose one whole naming tradition from their founding population's
usage mixture, retaining the language and founding era. Polities use their seat's
language. The final `atlas.names` pass names new geographic features after human
eras, weighting language use by represented population within their extents.
Water names sample their banks or coasts at the map's sampling resolution.
Geography without local speakers uses the seeded geographic tradition.
Source-map, protected, authored and already established names remain unchanged;
language shifts do not rename existing places. Refinement carries naming provenance
and the geographic identity matcher preserves it when contours move. All models
are trained in memory from bundled samples, so the Web Worker requires no model
fetch or filesystem access. There is one atlas naming config.

That config combines expanded place-name corpora with order-three and order-two
Markov chains, larger culture-specific root/ending lists and regional qualifiers.
Most names use Markov chains; compounds and qualified forms supply additional
variation. Feature kind and subkind participate in each feature's naming seed.
Vocabulary revisions do not move the initial geographic traditions.

Society works receive names at construction from the local naming-language mix,
with several readable terms for each work kind (for example Forge, Foundry or
Smithy). The work kind remains in the feature attributes. Work names and their
language/era provenance survive later population changes and republication;
the map no longer labels every work as its internal kind followed by a town name.

Epoch durations are in years. Analytical cohort responses and graph travel times
avoid annual iteration over geological ages. Each epoch has two coupled biological
responses; it does not resolve seasonal weather, every fire, population cycles or
the full succession sequence inside a long epoch. Coefficients are atlas-scale
approximations, not calibrated ecosystem predictions. Animal feeding and soil
nitrogen are coarse resource constraints, not complete energy or nutrient budgets.
Magic shapes the same four groups through quickening, stillness and fog rather
than through a lineage of its own. Authored woodland and sampled fields
remain geographic authorities. Refinement inherits the existing community without
replaying its age. Completed causes record biome transitions, fire-affected cover,
animal biomass and migration. Numerical state follows existing
material transport, adaptive transfer, inheritance and atomic publication.

Organic geology remains a downstream consequence. Waterlogging preserves litter
as peat and aquatic organic sediment; actual sediment gain buries it. Erosion,
burial temperature and geological time change the source pools into coal, oil and
gas potential. Source transformations conserve represented carbon. Each cell has
one mixed buried horizon; there is no stratigraphic column, petroleum migration,
reservoir/trap simulation or recoverable reserve estimate. A forest-to-swamp-to-
buried-source history is one supported consequence among many ecological histories.
