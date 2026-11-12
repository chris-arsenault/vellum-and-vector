# GIS/domain-backed generation workflows

Current execution follows [ADR 0003](adr/0003-frontend-session.md): a browser worker
resolves scoped catalog inputs and opens immutable numerical resources directly.
Initial generation displays independent epoch previews and publishes validated
record batches. Explicit map saves retain completed geography; execution state
does not restart or recover. There is no backend or MCP in this product phase.

## Geographic regional refinement

Selected region subjects retain their original source and arbitrary hierarchy.
An explicit refinement action links a finer geographic area to that subject,
using its nearest refined ancestor as a starting point. The child is a separate
map sharing coordinates and completed history, with independent elevation and
coastlines. It does not preserve parent height samples or require numerical
reconciliation. Creation captures local feature, network, drainage, landmark,
magic, place and way records. Each geographic record belongs to the new map; a
separate place identity relates it to the source. Numerical inputs have map-owned
descriptors pinned to immutable resource bytes. Replacing a parent's resource
does not change those captured inputs, and creating a child does not copy scalar
arrays. Refinement builds the world's physical field on the child's own triangular
lattice (`atlas.initialize`), then runs `refinement.begin`, the regional schedule,
the world's projection and feature extraction (`atlas.project`,
`atlas.features`), the regional identity, magic-map and place steps, and
`atlas.names`, all through the shared runner. It runs none of the world's epoch
schedule and replays no physical or human history.
Preparation reads metadata; resource loading selects the target map's needed
present channels. Complete-map reads page owned identities directly and include
unconnected network junctions; narrower reads follow declared dependencies.
Spatial partitioning does not build every display scale. Geometry overviews are
stored when that scale is requested, and cold window reads batch their derived writes.
Refinement reports its own sampling, terrain, water, landscape,
magic and place stages.
No region label or nesting depth selects another map type.
Selection uses physical shores and named geographic and social polygons. Suitable
natural regions rank ahead of tiny patches or whole continents. Long, thin coastal
belts also receive compact candidates. Oversized polygons
also offer coastal subdivisions around roughly spaced centres, moved toward nearby
settlements. This is a single geographic heuristic, without equal-area balancing
or an exact district count. Keeping a region does not move its neighbours' proposed
boundaries. Whole landmasses and smaller named regions remain choices.

A refined map takes its cell size from a fixed physical ladder: its captured
refinement level and chosen detail select the rung, and the map's frame decides
only how many cells that makes. The same ladder sizes the selections offered at
each level, so a suggested region holds about the default world's cell count.
`packages/domain/src/regionalScale.ts` owns the ladder. Rectangular sampling
frames and coastal context determine the area being sampled.
Setup shows approximate spacing and sample count before generation.

Child maps use a rectangular working frame around the subject, including nearby
land and sea. This frame may extend beyond the source map's footprint; the
surrounding geography can develop independently. Generation publishes only map-owned
features and fields; it does not write finer detail onto parent feature records.
The selected outline does not constrain generated feature geometry. Generation
can change its own map's records beyond that outline; cross-map writes remain
invalid regardless of where their geometry lies.
Later generation pages all of the map's own feature records, including geometry
beyond the starting outline. Presentation and export preserve that geometry.
Presentation, inspection, registry and export read the open map's geography.
Current saved maps reopen their own geography and captured context. Older map
formats are unsupported. Zoom never opens another map or exposes the surrounding world.

Captured source drawings and surface patches become initial context rather than
authored constraints on the child. Numerical import keeps material amounts distinct from
influence and scales captured amounts by represented area. Height, temperature
and vector components remain signed.

The regional surface has a compact continuous chart, including selections across
the cylindrical seam. A stable captured subject determines its coastal
neighborhood; repeating refinement does not repeatedly expand that frame.
Published field coverage and the map's frame describe this surface, rather than
clipping it to the starting outline. Mapped ways split at the chart edge while
retaining one feature identity and their network junctions. Physical queries,
class reads and display interpolation locate canonical coordinates in that chart.

Regional development uses the same selected feature definitions and process runner as
world generation. Features choose shared algorithms, a regional specialization, or
captured formation that should not be replayed. The coordinator in
`regional/sequence.ts` orders those contributions; `regional/schedule.ts` implements
the local operations. [ADR 0008](adr/0008-regional-refinement-is-conditioned-amplification.md)
records the ownership boundaries. Disabling a feature removes its operations from
both policies rather than leaving a second regional implementation active.

Initialization, local material development and derived refresh have separate
responsibilities. Initial detail realization runs once. Later work retains its
Ground and lets shared operations cut, deform, transport and bury it. Local work
spans are development controls, not new world epochs or human eras. Refresh reads
current state; it cannot replenish inventory, deposit material or age history.
Opaque Command and Query objects carry executable dependencies. Map operations, native
steps and nested domain operations use the same dispatcher and map-owned invalidation
revision. Selected feature entries install queries; regional atmosphere, shoreline distance
and water strategies replace the shared query implementations while keeping their consumers.
Commands remain explicitly ordered. Queries resolve other selected queries; development
and elapsed evolution require explicit exposure or duration. Ocean budget initialization
and reconnection history are commands, separate from current shoreline calculation.

Domain field declarations supply one numerical vocabulary. Working bands, resource
publication and captured inputs retain those names, encodings and vertical datum.
Sampling changes spatial resolution and represented area; material columns and their
cargo retain a common donor. Inspection formats raw quantities for people, and geometry
calculations use their declared units through `MapScale`. Neither creates a second stored
version of the ground. New quantities join this schema rather than introducing aliases
between generation and storage.

Captured Ground includes finite beds, loose cover, facets, contacts, material history
and hosted cargo. Local network and relief calculations read the material actually
reached, including cover over older rock. The initial network uses captured terrain,
structure and established geography as influences. Relief moves retained packages
through Ground displacement and exposes material through excavation. There is no
parent-blur fit or restoration of parent heights after erosion. Once initialized,
the same incision, mass-wasting, sediment, ice, coastal and groundwater owners used
by world generation operate on the child.

Regional drainage supplies captured inflow to shared conditioning, lake, routing and
river owners. All downstream consumers read the common routing and water fields.
The current ocean connection follows current terrain; neither an old coastline nor
an inherited lake mask determines all later water. Atmospheric context outside the
frame can affect the child without fixing its river crossings or shore positions.
The working frame bounds computation, not geographic agreement with another map.
Rain, melt and groundwater return compose one surface-water quantity. Shared routing
applies current intake demand and sink losses against available water before passing it
downstream. Ecology resolves current channel geometry, floodplains and deltas before
responding to inundation; local rainfall does not gate flooding from an upstream river.

Climate retains captured temperature, precipitation and wind as atmospheric inputs.
Altitude response and continentality retain the world's atmospheric dimensional
frame through MapScale; a smaller child frame does not amplify cooling per metre.
Current relief changes lapse, slope exposure and cold pooling; the shared wind and
snow-partition rules derive local conditions. Shared environmental contributions,
including current heat, fog and vegetation cooling, replace their captured values;
fog drip remains separate from terrain-driven precipitation. Shared runoff reads current
cover and Ground permeability. Climate does not reconstruct soil depth, refill soil
water or impose an ice floor. Ocean distance follows current internal shores, with
captured external maritime context entering at the frame boundary.

Ecological inheritance includes published functional groups, saplings, seed banks,
soil water, nutrients, animal groups and surface and buried carbon. Local response
uses the shared vegetation, soil, toxicity, animal and organic-material kernels.
The configured ecological settings and current magical effects remain inputs.
Development exposure lets the communities respond to resolved local conditions
without advancing canopy age or fossil thermal maturity. New sediment can bury
organic matter, and shared cargo handling carries its retained charge. Final habitat
classification does not repeat succession, burial or water supply.

Magic inherits actual reservoirs and source identities once. Current field evaluation
uses shared locators, propagation, warding, meetings and eligibility against the
child's media. Captured intensity is no longer a maintained floor, and old doors
cannot override present access conditions. Explicit local material response uses the
same Ground operations as world generation. Refresh does not replenish sources or
replay historical deaths, lake drying, tenure growth or ocean impulses. Material
remnants can remain exposed after the influence that made them is absent.

Established geography enters through the cause registry. Captured courses guide
initial organization and provide inflow; summits, lakes, settlements and landmarks
provide local context. Their named identity persists while location and extent can
be refined. Existing settlements and works participate in local realization through
the shared Ground and current routing. The inherited people live one pass on the
finer land in each development round, and new local places and ways are read from
their layers by the world's classifiers, as described under [Society](#society);
refinement lives no human era.
Newly accepted disaster events apply their catalogue's initialization Command once.
Their captured material aftermath is then ordinary evolving Ground. Continuing place
influences are current queries, so a later refresh neither erases active water withdrawals
nor repeats historical material changes.

Shared projection and extraction publish terrain, water, habitats, magical classes,
places and ways at the child's scale. Smaller patches can remain field coverage
without gaining a named outline. Regional identities relate those records to their
captured subjects, and a descendant captures the child's result through the same
resource contract. Regenerating physical geography uses the map's pinned inputs
and does not read live parent or sibling terrain.

Verification separates contracts from geographic judgment. Pure tests exercise
input ownership, material operations and real composition/dispatch with supplied
inputs. Saved completed parents support regional harness diagnosis without rerunning
unrelated world history. Terrain, surface materials, water, recognizable inherited
influences and useful local geography require inspection of actual child maps.
Sample equality, aggregate budgets and matching coastlines are not acceptance gates.

Ordinary map authoring uses linked feature representations and surface overlays.
Procedural inputs omit those drawings, leaving terrain, drainage, material stocks
and people's layers unchanged. Publication restores the independent map edits. Rendering
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

Works people raised keep their specific kind and medium and publish as located
sites where a map's cells can hold them. Farm country shows as the published
farmland, pasture and built-ground layers and has no outlined areas. Works and
events name the place they stand at, and ways the places they join.

Optional feature footprints compose separately from primary geometry. Browser
reads, editing, measurement, spatial discovery, templates and export preserve
those roles under one identity and respect profiles and located spaces. The
shared type catalogue supplies the map's hierarchical feature controls and the
Atlas Features registry, including authored magic sources and unknown custom
types. Continuous fields retain independent display controls. Registry discovery
can open existing finer geography; it does not generate that geography.

### Magic systems

The seven magic systems are first-class world effects and processes. Their physical
motivations, media, feedback and interference follow
[product specification 10.3](product-spec.md#103-magical-generation--the-seven-systems)
and the [magic source authority](../AGENTS.md#magic-source-authority), without importing
named setting lore. The systems share the process structure where it serves them and use
system-specific operations where their behavior requires it. The coupling between the
pillars is decided in [ADR 0004](adr/0004-coupling-through-each-systems-medium.md), and
people's use of magic in
[ADR 0012](adr/0012-people-live-on-the-lands-layers.md).

Magic fields are evaluated again at the end of each human era from the land as people
left it, and magical places are published after the last era, before final naming.
Regional refinement uses the same extraction process before carrying captured identities
onto its geography.

### Society

People are layers on the land's own mesh, beside the ground: population, farmland,
pasture, built-up ground and standing (the works and wealth a built place has
gathered), each a value per area of ground, with the remains that built places
leave. An identity column rides in the population: a bounded stack of layers,
newest first, each naming a tongue, a faith, a custom, an allegiance and a craft
by tradition code, with the people who hold it, how hard it has set and its age.
The map holds no society record. A run registry remembers what each tradition
code is and which crowd is which named place; neither is the source of where
people are or what they hold.
[ADR 0012](adr/0012-people-live-on-the-lands-layers.md) records the model.

One owner in `packages/generation/src/human` holds the bands and changes them
only through registered operations: lay, move, convert, overlay, inherit, harden,
wear, bury, re-expose and carry. The layer catalogue states each kind's facts:
what drowning, scouring, shaking, burning, neglect, starving and lying fallow
take from it, what stays on the ground as remains, and how far a place's
standing holds it. Whatever acts on the layers states its action as a mix of
those modes, so neither side names the other. When plates move, the owner
carries a cell's layers, remains and identity column together.

People live in passes. One pass puts land under crops and herds where hunger is
felt, grows people into what feeds them, moves them along the travel surface
toward room and toward the crowds they can reach, builds where they stay and
records the years lived on the ground. Each step is one aggregate act sized by
the years the pass stands for and reads what the step before left. Action at a
distance uses one operator: what a cell can reach of an amount spread over the
land, less with every costly step. A crowd's pull, a town's hunger and the
country's spare food are all reaches, and spare food is divided among the
hungers that reach it.

The same pass runs with different facts. Inside every geological epoch the
land's cumulative records are read before the epoch's processes and again
after; what was laid down, stripped off or struck in between buries, bares or
wrecks the layers, water over a cell buries it and ice scours it. People then
live one loose pass without farming or building. Ways and kept lines are
forgotten when an epoch begins; nothing else is deleted between epochs. After
the last epoch each human era is lived on the finished land as several settled
passes with farming, food carried over distance and building, scaled by the
era's mobility. An era bound to an epoch before the last is not lived as a
settled era.

Processes and people meet through shared questions, the answer keys in
`packages/generation/src/coupling/answers.ts`. The land answers what a cell
feeds under crops, under herds and left wild, what it supports as used, and
what it costs to cross. The rules of a pass are questions too: what a blow
takes, who is free to move, who builds, how fast things are forgotten, how
readily an allegiance gives way and who counts as present. Built ground answers
the question physical processes already ask about what binds the ground. No
physical process names a human band.

Places are read from the layers after each era, as peaks are read from
terrain. A town is where more people live than their own land feeds, and its
zone is every such cell from which people thicken, cell to cell, up to the same
densest cell. The place registry matches zones to the places already known: a
zone on a known place's ground is that place, and a place no zone continues is
abandoned and publishes as the ruin of itself. A place's hinterland is the land
that reaches it most cheaply. A way runs between two neighbouring places through
the cheapest crossing of the border between their hinterlands. Its travellers
follow the smaller place's size and the cost of the way: enough make a road,
fewer a track, and a way mostly over water is a lane. Travellers wear the ground
of their way, which later travel finds cheaper. A realm keeps up the most
travelled land ways out of its seat as highways. The place catalogue publishes
settlements, ruins and ways; a settlement record states its site, its zone and
hinterland with their farmed and grazed land, the reason it is there, its people
at the end of each era and the share of them holding each tongue, faith, custom
and realm.

Identity is lived each era after the land pass. Founding peoples begin at
separate origins. The born hold what their parents hold; neighbours take up one
another's tongue, faith and custom in proportion to their numbers and the travel
between them; a people cut off from the heart of a tongue or custom begins a
daughter of it; and what people hold ages and sets, hardest where a place has
standing. An overlay names only the traditions it changes, so a faith spreads
without replacing a tongue, and the older layer stays beneath. A realm is an
allegiance with a seat at a known place. Its hold spreads from the seat along
the travel surface, people within it take the allegiance up as an overlay, a
town beyond every realm's reach founds its own, and a realm with no seat left
ends.

Cultural regions and territories are read from the column. Each tongue, faith
and custom publishes as the share of every cell's people who hold it, so regions
overlap and follow no border. A realm publishes sovereignty where its allegiance
is the most held, control where it is firmly held and a claim on every cell
where anyone still holds it. Population density and the people the land
supports as used publish as fields, and the layer bands publish with them.

Dams, events and frontiers are read from the land and its places at the end of
each era. Every living place without a dam tries one on the strongest river
cell of its own ground; the water is worked out again with the dams marked, and
a dam stands only where it makes a lake the map can show. A dam whose people
have gone fails. A famine is recorded where a town's worth of people died on a
place's ground within the era, a disaster where an avalanche, flood or tsunami
struck it by the chance its ground gives, and a siege where a place passed from
one realm's hold to another's. A hazard takes from the layers what the layer
catalogue says they give up. A way whose two ends different realms hold is a
frontier, and the places at its ends keep that line. Irrigation, harbours,
forges, archives and shrines are sited by their catalogue entries from the
ground near living places. After the last era the map's lakes and rivers are
read again from the water as people left it.

A craft is the magic system a people know how to work, held in the identity
column beside tongue, faith, custom and allegiance. It is learned only on ground
the system's medium reaches, carried wherever its holders go and practised only
on the medium: the practised share of a cell is the share of its people who hold
the craft times the share of its ground the medium holds. On that share the
craft answers a shared question as a breaking responder: the rule the asking
process obeys is set aside and the craft's own answer stands. Fire's
hearth-keeping holds its own growing season and lets no climb cost a way;
Aurora's reading lets nothing be forgotten; Pressure's diving holds the sea off
the shallows beside the divers' shore; Greenwood's tending binds its people from
moving and building and lets hunger and hurt take no one; Salt's raking keeps a
sworn allegiance from giving way and counts a place's remembered dead as
present; Hallowed's vow lets nothing be harmed inside and lays what it turned
away on the ground beside it; Veil's door-keeping makes a door kept at both ends
a step between two far places. No pass or process holds a case for a system.
Ground where a craft is practised over enough of a cell publishes as a place of
that craft. Magic fields are evaluated again at the end of each era from the
land as people left it, without supplying or ageing any stock, and magic is
published again after the last era.

A refined map inherits its parent's layers and named places. In each development
round its people first meet the round's water and ice, then live one pass in
which they farm, build and move on the finer land while their number stays the
parent's. At the end the parent's settlements and ruins are known places on the
ground the parent's cell covered, and every other crowd is read by the world's
classifier and published by the same catalogue entry. A finer map shows smaller
places, down to a hamlet, while rank is still judged against the World town
size. Ways and hinterlands come from the same reading; a ford or bridge stands
where a way steps over a river, and mills stand at living places. The child's
records name the same traditions as the parent's. Its cultural and political
regions, its ruins and its events are the ones the parent recorded.

A creator's edit to a settlement's groups or population is reconciled on the
settlement's own record. A drawn territory, event or work stands as drawn; apart
from a drawn dam, which holds water, it does not act on the land or its people
when the map is generated again. Generation controls supply each era's duration,
mobility and political capacity. The cross-pillar coupling decisions are recorded
in [ADR 0004](adr/0004-coupling-through-each-systems-medium.md).

Settlements, ruins, waterworks, transport sites, magic practice sites and
historical events have distinct layers and concrete feature kinds. A selected
creation profile also limits scene features and detailed geometry, so
materializing a Region does not expose its local features on the World map.

### Controls and module contracts

The current module contracts, feature-owned recipes, validity model and output
registration are described in [Generation modules and recipes](generation-modules.md).

Curated generation controls map a creator's outcome choice to the coefficients
that produce it: physical and living map outcomes, independent cultural and
political patterns, and distinct controls for each of the seven magic systems that
follow the magic source authority and product contract above. Each control is declared
once with its alternatives and the values each alternative sets, in
`packages/generation/src/physicalCartography.ts` and `terrainCartography.ts`
for the land controls, `domainCartography.ts` for the living landscape and the
people controls, and `magicCartography.ts` for the magic controls; those
declarations are the record of the values. Every system supports independent
inclusion.

The [product contract](product-spec.md#10-procedural-generation-domains) defines
generation behavior; [ADR 0003](adr/0003-frontend-session.md) records application
boundaries. User requirements and explicitly agreed constraints govern changes
to the implementation choices described here.

## Structure and reference

Configured process sequences operate on a shared working map. Each step checks that a
selected step earlier wrote what it needs, applies its changes and validates what it
wrote. Generation is deterministic within a run of one version of the code, and output
may change whenever the generator does.

This structure governs initial world generation. Independent regional maps build the
same physical field on their own lattice and run the regional schedule described
above in place of the world's physical schedule, epoch runner and human eras,
sharing the numerical and spatial primitives and publication infrastructure.

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

Resource references identify committed numerical inputs, which open as immutable
bands over their chunks. Every numerical value of a run is a band in a coverage:
the physical world with people's layers, the surface grid and its topology and the
projection tables. One block cache per worker keeps blocks
resident within its budget and spills them to scratch beyond it; process lifetimes
release bands the state no longer reaches. Processes share typed domain state directly, independently of React,
database connections and browser messaging. Completed history retains causal
results rather than copies of numerical scratch.

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

The interface has this shape; concrete state/context types follow the
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
output validation fails, it records diagnostics and fails the job before final
publication. Processes mutate shared working state, so an exception cannot be
treated as an omitted product while retaining its partial changes. Processes
with unavailable prerequisites are skipped without consuming stale buffers.

The result retains structured diagnostics with the process, invocation, epoch
ancestry, error code, message, stack where available and whether output was
failed, skipped or retained with a warning. The worker streams these diagnostics
to the job inspector while running; they remain inspectable after completion or
failure. Warnings may accompany successful generation; execution errors cannot.
Invalid configuration or inherited geography, cancellation and worker termination
also stop the run.
A long numerical process can split work internally to report progress and
observe cancellation; when it does not, the host terminates the worker after a
short grace period and discards its unpublished staging.

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
| Region/Local | Capture the parent's present and completed history; develop finer present geography in rounds           |
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
defaults, limits, units and display labels; the nested domain schemas
own ecological and magical settings.

`prepareAtlasGeneration` binds those inputs to the configured causal sequence,
checks actual registry contracts and produces ordered diagnostics. The reviewed
configuration travels to the worker and must match the resolved inputs. Complete
settings participate in configuration identity and remain inspectable in the
in-memory run record. JSON editing updates only the wizard draft.

A new world includes cultural, political and built geography by default. The
People & places step shows each of those capabilities as its own group with
its inclusion and the outcome choices declared for it, built like the land and
landscape choices: the age of the world (which era the settled history ends
in), the cultural pattern (starting cultures and how far contact carries
them), the political pattern (starting polities and how far a seat holds),
towns and cities (the World town size and how far a city draws its
hinterland) and roads and travel (the traffic that makes a road, market
travel and a polity's highways). Each alternative sets a bundle of feature
settings; the people coefficients those bundles move are atlas parameters
with declared defaults. Adjust opens the advanced panel on the underlying settings
and the era schedule.

The workflow edits version 2 `features`: `physical.impacts` omits the impact
capability, `physical.river-incision` omits cutting while retaining river output,
and `physical.glacial-sculpting` owns erosion, deposition and glacial relief
together. Shared routing, ocean and material providers have explicit dependencies;
they are capabilities rather than a permanent bulk of required support processes.
The recipe's `processes` map is also accepted; the resolver maps its operation IDs
to feature ownership and rejects conflicting coupled selections.

Feature-owned cartographic descriptors compose existing settings and selections
into curated choices for land, landscape and human geography. Independent
choices preserve unrelated inputs; advanced departures appear as Custom. Exact
controls and rich history/system editors remain available on request, with closed
forms unmounted. `projectGenerationSetup` supplies editable
controls, inherited restrictions and diagnostic owner IDs without copying the
execution contract into the UI. One canonical draft owns shared epochs, ecology
regimes, configured magic and cultural eras.
Review and worker launch use the same source identity and prepared configuration.
Invalid input and unapplied JSON stay visible and block launch. See
[generation modules](generation-modules.md) for the interfaces.

Native adapters distinguish initialized absent event histories from facts
produced by an omitted process. Structural water, material, ice and spatial
validation still runs. Native and outer fact validity update together. Fresh
regions use dedicated regional preparation and execution, with completed parent
history retained as context. In the world pipeline, inherited facts are identified from supplied channels and initialized
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

A landscape sequence interleaves its causes:

1. Apply geology and carry stored magical history with moved material.
2. Derive climate, apply heat/material feedback and refresh affected facts.
3. Apply drainage, erosion, ice response and necessary climate/drainage refreshes.
4. Apply cold/ocean influences at the positions where physical processes consume them.
5. Evolve coasts and retain the epoch's geographic consequences and causes.

Profiles change each epoch's forcing: a temperature offset, a sea-level offset and
multipliers on heat and cold sources. A warm period is warmer with higher seas and
stronger heat sources; a glacial period is colder with lower seas and stronger cold
sources. The epoch presets in code declare the values.

Each system's settings shape its sources, activity and retained consequences; the
mechanisms are in [Magic in the epoch sequence](#magic-in-the-epoch-sequence) and
product specification 10.3. Natural background, applied forcing and retained
consequences stay distinguishable. Magic changes physical facts consumed
downstream; these fields do not by themselves implement social use or its costs.

Regional maps run no epochs: refinement develops the captured present, as described
under [Geographic regional refinement](#geographic-regional-refinement). Human eras
follow the last physical epoch and supply their own durations and variables.
Ordinary present-day edits preserve completed history.

### Magic in the epoch sequence

`World.magicSystems` holds the configured systems. Each declares its origins (sources
located from physical geography, history, people or authored records), its stocks and
the carriers that move them, and the propagation its medium implies. Meetings between
systems are a separate list of confluences (`packages/domain/src/magicConfluences.ts`).
A confluence that names a system the world lacks is valid and never holds.
Configurations participate in the generation hash.

Each epoch advects accumulated activity, first occurrence, storage and coastal
history with the crust's source map. Climate-phase systems (Fire, Pressure)
alter heat, moved water and rock before hydrology; post-glacial systems (Aurora,
Greenwood, Salt, Veil) act after ice responds, Aurora through the charge its ice holds,
carrying ice persistence into the following epoch; every evaluation re-applies the
shared forcings. Society-phase systems (Hallowed) are made of what people did: the
owner of people's layers records tenure, walked ways, kept lines and the dead on the
mesh, and at the end of each human era the magic fields are evaluated again from
those records and the land as people left it. No stock is supplied or aged during
the human eras. Final classification retains every feature mask, natural geography and
physical materials. The surface class of a cell is the class with the largest coverage,
with rule priority breaking ties, and a second surface records the runner-up where it
holds a substantial share. An inland map has no fabricated pressure locus. A warm
present may have no active Aurora while preserving its glacial activity history.

### Rock and relief

Geological references motivate interacting ingredients. The Rocky Mountains include
[Pryor fault blocks](https://www.nps.gov/bica/learn/nature/2-mountain-building.htm) with tilted
beds, steep eroded fronts and gentler resistant dip slopes; these motivate signed bedding and
directional failure. The [Appalachian history](https://www.nps.gov/articles/000/shenandoah-valley-geology.htm)
connects marine deposition, collision, separation, erosion and valley filling, motivating
preserved material through successive epochs. Research on
[Himalaya–Karakoram–Tibet](https://www.usgs.gov/publications/multi-stage-crustal-thickening-surface-uplift-and-collision-western-himalaya-karakoram)
describes multiple stages of thickening, motivating persistent broad support beneath later
localized deformation rather than a prescribed plateau shoulder.

The [Mogollon Rim and Verde Valley study](https://asu.elsevierpure.com/en/publications/incision-history-of-the-verde-valley-region-and-implications-for-/)
links weak-bed exposure, escarpment retreat, basalt-buried channels and renewed incision after
drainage integration. It motivates exposed-support failure and connected deposition followed
by re-exposure; it does not establish one universal origin for escarpments.
[San Francisco Mountain](https://www.usgs.gov/volcanoes/san-francisco-volcanic-field/science/geology-and-history)
motivates repeated localized volcanic construction, while
[Red Butte and other inverted volcanic landscapes](https://home.nps.gov/articles/000/volcanic-inverted-topography.htm)
motivate lava occupying lows and later protecting them during differential erosion. These are
physical references, not named presets or a requirement that every world contain every form.

Ground owns the field's geological material and placement. Each cell retains intact and incised
area shares, each with rock beds and finite loose cover above an unbounded basement. Layers keep
composition, clast strength, damage, directional fabric and formation/alteration ages. Signed bedding,
deposition age and consolidation describe the bed independently of its source. Reworking establishes
new bedding while retaining the source material. Erosion visits
the material it removes; deposition carries that material into its destination. Thin deposits
enter as beds and may later merge during column coarsening. Burial acts on each share's actual overburden and retained constituents, while
overlying construction initially entombs loose material as a weak substrate.

Ground queries expose the retained material snapshot. Numeric readers combine constituent facts
and average responses over occupied shares; classification can still ask for the dominant kind.
Runoff, slope stability and material resistance use those shared queries, so deposited or exposed
material affects their next read without a connection to the process that put it there.
Weathering spends captured climate forcing on the remaining substrate at settlement, attenuated
by each share's actual cover. Converted rock becomes loose material beneath that cover in bed order.

Elevation, mean sediment depth and exposed-rock summaries are read-only projections. Solvers
use owning operations for construction, displacement, wear and deformation. Live field and
Coverage readers provide bulk copies without writable aliases. Published and imported material
properties select one donor package together; placement may interpolate independently.

Columns have bounded capacity. Coarsening preserves the surface cap and rock basement but loses
fine internal ordering; only the largest two constituent identities remain in a mixed bed.
Intact and incised shares do not locate subcell contacts in three dimensions. Neighbor-face
queries use their overlapping exposed intervals, allowing existing slope failure to read weak
support beneath a resistant cap.

What a map shows is where the worn surface cuts through the rock beneath. Continental platforms start with
kilometres of alternating beds. Rock under a belt or along a suture turns to its next form by how deep and
how hot it lies, never by chance, so neighbours with one history stay alike and nothing bakes at the surface.
Uniform uplift translates existing columns; differential displacement bends their retained bedding.
Exposure changes through removal, transported packages or alteration.
Arc intrusion changes basement beneath retained overburden; later removal can expose it.

Plates move in deformation intervals. Each interval carries the existing relief and then builds
mountains at its active contacts before those contacts can weld shut. Selected slope failure and
load response settle before the next movement. The next interval carries
the newly built rock along with the older terrain. Ground resamples placement, beds, cover and
occupied facets together from retained arriving area. A sweep through actual contact altitudes
combines the material present at each interval; empty space contributes no rock. Bounded columns
coarsen the resulting contacts. This represents unresolved lateral mixing and can blur small features.
Only absent surviving coverage forms new ground. Actual convergent area overlap stacks
material at its receiver; categorical sampling never creates collision material. The source's local
motion transforms its retained bedding and fabric. A collision piles rock up,
and only part of what rode on a sinking slab comes back. Continent
floats: where it rides up on ocean, the ocean goes down under it and the continent keeps its area, and
only continent meeting continent is shortened. Sinking ocean pulls its plate after it, so an ocean keeps
closing until no ocean is left at the contact. An ocean province that reaches what it sinks beneath is
renewed at its plate's far side, so a plate keeps moving as a conveyor. Continents that meet shorten until
they lock and weld into one plate along a seam weaker than either; what drove them together ends there.
A continent's interior is hard to break, so when later pull from sinking ocean tears a welded plate it
tears along the seam, and the pieces and their shares of the old belt leave with whatever pulls them. Ocean-bearing parts of a plate
can tear under the same pull, so a merged plate gains new edges around its land and the old edges end up
inside it. Epoch duration and tectonic strength jointly determine travel. On a bounded map a plate slows as
its continent reaches the edge, so continents stay on the map while oceans can still pass off it.

Rock piled on the crust sinks by about its density over the mantle's, but a strong plate carries a
load narrower than its flexure length. Narrow ranges therefore stand high while broad high ground
sinks toward its support. Continent and ocean settle separately, because a margin breaks the plate:
deep sea floor does not pull down the edge of a continent beside it.

A convergent belt is its thrust sheets. A cell joins a sheet when the deformation front first reaches
it, and keeps its sheet, fault segment, place across the sheet and dip, all carried with the crust.
Each pass of shortening advances the front and closes the sheets up: the one at the boundary holds
its place and each beyond is drawn in under the leading edge of the one behind, younger rock beneath
older, up to what a thrust can carry before it locks. Leading edges climb in the same rock each pass,
so ridges rise where they stand. Sheet movement carries retained beds and transforms their axial fabric.
Per-bed slopes transform with horizontal movement and differential vertical displacement; the columns
remain a finite representation of contacts. Opening at province contacts displaces blocks according
to inherited inclination and material compliance. Crust that subducting ocean returns as arc crust feeds a belt's
roots, as continental crust piled up in a collision does; a belt with no continent builds an arc on
its ocean crust, and root crust the plates carry away from any convergent belt settles where it lies.
Each interval's crust adds to what earlier intervals left. A separate relaxation process lets
continental crust spread under its own thickness and the load of rock standing on it. It runs even
when mountain construction is inactive. Crust holds extra
thickness only while being squeezed: once a collision ends, the old belt's root settles out under the
land around it, and wear that cuts past the rock on a belt thins the root itself, so old belts sink to
broad raised ground while their deep rock comes to the surface. The rock a belt raises comes out of its
crust, so height is moved and not made. Water, warmth and frost turn rock into loose cover, slower under a
deep mantle, and that cover creeps downhill on any slope. Rivers cut by the water they gather, so wet ground
and epochs wear more than dry ones. They drop what they cannot carry only up to the grade their water
needs, and ice drops its load up to what a slope can hold. Waves wear coasts back to a platform below the
sea. Each process is declared with what it reads, asks and moves, as
[ADR 0011](adr/0011-processes-couple-through-keys-and-a-ledger.md) sets out. Each epoch is data: strength,
travel, span and forcing. The first epoch's height is carried as an area average; thresholding that
average cannot identify the fate of individual old mountains. A world's first
forming stands in for the drift before it, so its belts begin with crust already shortened by their
strain and go through the same roots and flow, which leaves older high ground for later ranges to stand on.
Interior stress reaches a plate's old sutures and province seams and works a zone of crust around
them. Seams are properties of the crust and travel with it, so each pass works the same ones. A plate's
loading retains the directions of its active contacts and resolves against inherited fabric and
material yielding. It thickens and raises older rock along its seams, spending the root crust that this
pass's shortening brought and the plate's belts did not take up: once that is spent a seam rises no
further, since a plate does not thin its whole body to feed one. Close to a rift through a continent, extension takes over from that squeeze, and the
seams there thin and sag. Crust holds a belt's extra thickness only on the sheets a live belt is
shortening; an older belt's root within a live boundary's reach, but not yet on its sheets, settles.

Sediment enters the sea at its river mouth, ice margin or connected shore. Sediment gravity flows
split down connected bed gradients and settle as their suspension declines; closed depressions
retain material locally. Deposition fills the lower occupied surface before covering higher ground.
Later uplift and wear read those actual beds, including their source history and consolidation.

Plumes and subduction arcs supply the same connected lava routing. Mobile head, yield resistance
and cooling determine where a pulse reaches; its solid deposits change subsequent routes. Lava
can fill a cut before coating intact ground. Random caldera carving is absent: this model does not
represent the reservoir withdrawal and failure needed to explain collapse.

Processes and materials meet through a shared vocabulary of modes: abrasion, plucking, shear and solution.
A material holds facts, a mode says how facts answer its attack, and a process says how it acts, as a mix of
modes, without knowing what any material is. A cell is a stack. An action goes down through it, spending
itself on loose cover first and then on each layer of rock by what that layer gives up, while cover, open
fractures and wards bear on it. World and region read the same stack, and a region's cone aprons join it as
a modifier. Streams, solution, ice and slopes are processes in `packages/generation/src/processes`. Each
owns relative settings resolved by the shared `MapScale`, one ledger writes what comes off and
lands, and feature operations say when each runs. Those operations reference executable steps directly,
so registration and selected execution use the same definitions. `MATERIALS-AND-PROCESSES-ARCHITECTURE.md` at the repository
root holds the reasoning.

Process-specific routing and solver helpers bind beside their consumer. Shared tools provide only
scratch storage. A sequential process reads fresh shared answers after its predecessor settles;
a simultaneous group captures its declared answers before any participant runs and refreshes them
at the next substep. Immediate writers, including coastal cutting and slope solvers, run separately.
Routed material keeps its source and destination through settlement; competition at one source does
not scale another source's deposits. Optional process observers report execution and settlement
boundaries on worlds and regions. The harness samples selected bands at a world coordinate, with
captured shared inputs and current answer explanations, without retaining a full field per process.

Rock decides erosion. A river grinds, so strength is what resists it, and ice plucks along joints, so columnar
basalt goes before massive gneiss of lesser strength. A cell's height is the mean of its ground, so a valley
in a coarse cell lowers that mean over its incised share while the intact cap survives beside it.
Later valley deposition remains on the cut floor. Widening pays for the additional intact material
removed before spending remaining work on deepening; merged valley profiles lose their horizontal alignment.
Streams too small to map wear every sloping cell, without a valley on record, so land falls toward its
rivers. A valley's share of a cell follows its catchment; what the water gets down through is the
ground's answer alone, so strength counts once. Land that has relief to wear therefore leaves hard rock
standing, while hard rock on ground already worn to grade stays low, as a shield does.

Resolved slope failure compares neighboring heights across their actual separation. An unresolved
hillslope length does not turn a gentle regional flank into a cliff. Hard rock holds a steeper
slope and gives up less when it goes, open joints lower the angle a slope holds, burning loosens what roots
held, porous rock takes water
into the ground before it runs off, and water dissolves soluble rock wherever it runs.
Directional shear and plucking also read signed bed inclination. An exposed weak foundation can
release its overlying cap as a finite slab; both enter the downslope material route. This approximates
bulk retreat without hidden cavities or unresolved overhang geometry.

Magic alters reached material through the ground owner. Surface reactions spend their reach through
actual cover; subsurface Fire follows a finite interval beneath it. Changed intervals retain their
formation ages and fabric, and untouched beds remain in place. Each system uses its own medium and
material response rather than adding opposing effects to one resistance value. Fire hardens veins
and seals a conduit when its supply ends; Aurora weakens exposed ground and grows crystal beneath
charged ice; Pressure crushes seabed and the adjacent shore; Greenwood opens ground and lays spring
deposits. Salt beds form when new stock deposits, so buried old stock cannot repaint the surface.
Hallowed leaves kept stone, including after society establishes a ward. Active protection limits
other reactions' reach; its disappearance does not remove the stone. Veil displaces coherent ground
and bends its retained beds. Meetings alter material through the same owning operations.

Altered material travels, buries and wears through ordinary geological operations after magic stops.
Finite solid charge belongs to its actual material package. Sparse cargo records identify the
origin/reservoir, host constituent and concentration; Ground splits, mixes, extracts and carries
them with the material. Fresh cover of the same mineral acquires no buried charge. The unbounded
basement marker cannot supply finite inventory. Dissolved and living stocks keep their own water
and ecological carriers. Depleted rock remains rock after its charge is spent.
Worked stockpiles retain custody during deliberate extraction. Ordinary erosion and
geological movement release that custody to the declared natural reservoir on the same material;
an abandoned stockpile does not become an inaccessible mineral identity. Ground owns this receipt
behavior without interpreting society or magic names.

Birth and renewal advance through elapsed source operations. Current-field refresh locates existing
sources, applies wards, updates the other fields and their meetings, then evaluates strain and
doors. It does not repeat births, melting, material reactions or history. Retention distinguishes
fresh activity from the existing Ground inventory, including inventory moved or extracted since
the field was evaluated. Disabling supply leaves ordinary material transport and decay available.
Human eras are lived on the land the last physical epoch left; an era's index does not select a
different physical history.

Groundwater retains water volume per area, receives recharge, routes by hydraulic head and returns
to soil and streams. Declared dissolved stocks follow those actual exchanges; discharge to the sea
removes freshwater charge with its carrier rather than leaving an orphaned aquifer stock.
Newly buried organic
matter can carry a share of sap into its retained bed; leaching transfers finite charge into water.
River litter carries carbon and magical cargo together, within the actual organic carrier's
charge capacity, so later decomposition can feed soil. Springs respond to dissolved concentration
and discharge; the significance of a named spring does not suppress weaker physical activity.
Clearance can release existing water and brine without creating either. Transported sap needs
suitable soil, water and subsequent growth to establish a living source.

Shelf charge rides marine ice with ocean currents. Ordinary sea ice reads its persistence, and
warm-water ablation can remove the carrier. Fire melt joins later runoff through the shared ice
operation. Marine contact supplies a receiving-shore view for meetings without extending Pressure's
ocean field across land. Coastal deposition spends available transported sediment; connectivity and
water loss determine whether an isolated basin dries.

Kept ground reads present maintenance and actual travelled routes, which fade when use ends.
Elapsed physical history ages that maintenance even between inhabited rounds. Ending a round
refreshes its protection and dependent fields without advancing material or inventing another year.
Ward rims use geographic width and partial sample coverage, and displaced fields require a suitable
receiving medium. River, wind and ice carriage read declared barriers. Doors require present stable
strain and usable endpoints; warding, stored charge or rupture can close them and invalidate travel
connections. Interference strain is a gradient over physical distance. Completed history records
actual significant wild-zone footprints; inspection distinguishes earlier surveys from the current
feature. Positive spatial overlap can carry identity forward, while disjoint or ended zones do not
acquire an invented trajectory.

Salt transfers consume reached host material before moving its stock. Dissolution can remove a
buried soluble seam while its cap settles; brine then precipitates new material. Wind instead moves
existing grains through surface saltation, retaining their material record. Its dust reservoir marks
mobile grains on the ground: settling changes their reservoir, and another hop moves actual loose
material. It does not create a fresh bed each time the same stock moves.

The Surface material field displays the dominant present exposed material through the existing
categorical map overlays. Loose cover, the represented soil skin, water and ice hide underlying
rock. Its colours depend on current material rather than magical activity or history records.

Magic-rock acceptance is semantic: for each of the seven systems, an early magical process must
be capable of leaving a visible trace in later epochs after that process stops running. Judge the
later map's terrain or material presentation without history inspection or an active magic overlay.
Later processes may move, bury, expose, reshape or destroy a remnant; neither permanent survival nor
every system appearing in one world is required. An inland Pressure crush zone or Greenwood remains
in a desert illustrates the question, not a prescribed landform to construct.

Reviewers must identify the visible remnant, explain its formation and subsequent reworking, and
establish that continued magical forcing is not sustaining it. History and numerical diagnostics may
help explain the cause, but cannot supply the missing visible evidence. Unit tests verify supporting
contracts and operations; passing tests, nonzero stocks, material counts or changed scalar values do
not satisfy this acceptance criterion. A system without demonstrated visible persistence remains
unverified.

### Regional interaction boundary

Captured Ground resources include sparse material cargo, persistent ground and offshore loads,
and named reservoir keys with custody-release identities. Import takes complete material records and cargo from the same donor,
remaps keys by name and owns independent mutable copies. Groundwater storage keeps its water-volume
meaning; transient flows regenerate. Resource references remain pinned to the captured parent state.
Material publication rejects unrepresentable cargo before it becomes a saved resource.

Regional execution uses shared physical, ecological and magical owners through the same selected
feature composition as world generation. Initial detail realization may excavate or displace retained
Ground; subsequent erosion and transport operate on that material. Current magic responds to retained
inventories without captured intensity floors or source renewal. A named door retains its identity
even when it cannot currently be traversed; an endpoint outside the child remains outside it.
Child geography may change independently. Captured atmospheric altitude and continentality
responses retain their world dimensional frame through `MapScale`; local terrain and wind
detail use the child's frame. Refresh replaces environmental contributions rather than
repeatedly adding heat, fog or vegetation cooling to captured temperature.

| Regional consumer                               | Shared producer or contract                                                                                                                                                                                          |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Terrain, escarpment springs and inherited folds | Ground intervals, finite extraction, groundwater emergence, yielding-plane geometry and continuity. Regional calderas, retreat and landmark conjunctions remain their terrain/POI work.                              |
| Coasts and changed-shore drainage               | Shared coastal sediment transport, current ocean connectivity and receiving-shore forcing. Regional routing supplies captured incoming discharge to the shared water owners.                                         |
| Climate and storm medium                        | Shared circulation and current environmental forcing replace captured contributions as local terrain and carriers change.                                                                                            |
| Ecology, peat and moraines                      | Shared local vegetation development, organic burial, carbon-bearing sediment, groundwater return and actual ice debris, without historical aging.                                                                    |
| Magic and named sources                         | Captured host cargo and fluid stores, source supply/location separation, coastal rays, geographic ward rims, distance-based strain and present door eligibility. No captured intensity floor may renew inventory.    |
| People and existing works                       | Inherited layers lived once per development round through the world's pass with people's number kept; places, hinterlands, ways, crossings and mills read by the world's classifiers and published by the catalogue. |

### Named relief

The atlas publishes lakes as geographic polygons and extracts named peaks,
mountain ranges, valleys, craters, volcanoes, calderas, cirques, fjords,
moraines, gorges, waterfalls and magical landmark regions alongside its river
network. Landmark points identify connected regions; numerical masks retain
their full extent. Completed session generations retain epoch and magical
definitions when current settings change.

Named relief reads the final surface. Detection distinguishes summit prominence,
mountain relief, incised river flanks, glacially enclosed marine inlets, deposited
moraines and ice-carved hollows. A crater must retain a rim above its floor and
surrounding plain. Publication additionally evaluates the geographic significance
described below, at the map's scale; a detected local landform need not become a
name.

Regions receive internal divisions only at continental extent for the map's scale.
Terrain, drainage and broad climate transitions guide those divisions on every
map. Small internal gaps can join a surrounding
landscape while physical water remains separate.

### Landmarks

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
cell. A Region places its captured landmarks on its own lattice through the landmark
cause and sites none ([ADR 0008](adr/0008-regional-refinement-is-conditioned-amplification.md)).

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

The worker receives configuration, seed, scope and a workspace connection. It
resolves generation inputs through the catalog and opens selected field channels
from immutable resources without sending samples through the catalog worker.
Status, stage progress and failure diagnostics live in memory. Terminating the
worker cancels generation. Closing or reloading the tab discards unsaved session state.

Numerical working storage belongs to the execution worker. A run owns its initial
state's working parts; a caller that needs that state afterwards builds another.
Completed epochs retain their ancestry and typed causal consequences without
duplicating every intermediate field. The epoch/final callback samples an
independent display grid before generation continues and sends it as detached
arrays; bands never cross a worker port.

Plate advection transports carried fields one at a time through reusable scratch
space. It resolves category provenance before updating source fractions and
strengths, retaining historical maxima and new-crust rules. Ground reconstructs placement and
complete material sections from the same retained areas, with finite cover and occupied-facet weights.
Each transfer reuses donor orientation calculations in temporary typed scratch.
Contact-aligned mixtures collect all contributing materials before projecting into
the column's constituent slots; they retain weighted properties and history.
Continental shortening and oceanic subduction use the same area-retention rule for
crust and surface material. Only convergent excess stacks at its receiving footprint.
Bed orientation follows each donor's continuous motion, rather than differences
between independently moving neighboring plates.
Fault traces are simplified and sampled at the terrain resolution before motion,
then simplified again where motion compresses their stations. Their identities
and histories remain attached. Motion reuses the interval's velocity field and
resolves travel against local speed.

World-to-display interpolation builds compact typed weights in batches rather
than retaining JavaScript sample objects for every display cell. Repeated physical
projections reuse the working surface's channel buffers. The browser adapter yields
between process stages so the worker returns to its event loop during a run.
Processes operate on the shared working geography through its coverages. Local
scratch bands are disposable and do not constitute saved execution state.

Regular-grid contour extraction releases sampled-point and crossing caches as it
advances between rows. The generation worker stores the directed contour graph in
indexed scratch tables and streams bounded line segments into native face assembly.
Shared crossings retain canonical endpoint order when recomputed. This bounds the
decoded edge graph and tracing buffers; the native overlay and final geometry still require memory
proportional to the feature being assembled.

Processes touch the lattice in three shapes, with one code path at every map size. A
local pass reads and writes a few bands at the same cell, block by block over pinned
native arrays. A stencil pass reads a cell's lattice neighbours through the band. A
connected pass walks the lattice through a frontier with per-cell reads and writes.
Connected numerical passes keep frontiers resident and sized by the frontier;
per-cell labels, ranks, marks and scratch channels are bands. Whole-world orderings
stream over block runs held in bands.

Frontiers and scratch structures (`packages/domain/src/hpc/`) hold their entries in
typed arrays only, with no per-entry objects, string keys, proxies or comparator
closures. They grow by doubling and are garbage-collected, never paged. A pop returns
the item; its key or fields are read through an accessor. Float keys are ordered
exactly through their bits, with negative zero equal to zero, and ties break by
ascending cell. A monotone frontier needs no decrease-key: a popped entry whose key no
longer matches the stored value is skipped. The set covers cell and record queues,
keyed and multi-key heaps with top-k selection, radix ordering, union-find, grouping by
label, bit sets, epoch stamps, typed lists, small integer sets and worklists.
`make test-architecture` flags substitute shapes in generation code; a site no structure
fits carries `// hpc-exempt: <reason>` on its line or the line before.

The worker finalizes immutable Zarr resources and publishes their references with
geographic records. Fields share masks and topology by reference. The catalog
installs validated batches progressively during initial generation; the editor
receives revisions and invalidations. An interrupted initial delivery remains
marked incomplete. Generation processes do not know about browser messaging.

Regeneration stages record batches in disposable SQLite storage before applying
them in one catalog transaction. Check world revision and field ownership. If
intervening edits changed the world, keep
the edits and report the out-of-date generation result. No automatic retry occurs.
Domain processes remain independent of the browser adapter.

## Physical kernel and atlas adapter

`packages/generation/src/world/` holds the physical kernel. It uses an equilateral
triangle graph, 1024 elevation subunits per authored metre, seed salts, material
histories and epoch order. Domain-neutral source processes cover crust,
orogeny, volcanoes, impacts, support/flexure, margins, climate, drainage, erosion,
sediment, glaciers, coasts and final geographic classifications.

The atlas runs these registered processes through the shared runner. Native
steps update private numerical arrays; projection and feature extraction update
GIS state. Numerical checks cover ranges and flow topology,
river coverage and grounding. GIS validation runs when spatial state changes,
at completed epoch boundaries and before publication. Authored samples are also
composed into the native workspace before physical consumers run. Per-layer
validation is consolidated in `layerValidation.ts`.

`physicalProfile` holds the defaults, and `atlasPhysicalProfile` adapts them to a map:

- Geological controls declare relative dimensions and resolve once against the
  map's frame through `MapScale`; initial sites remain sampling-independent.
- Native climate units map to Celsius through a declared freezing point and
  scale. Epoch temperature settings remain Celsius; sea-level offsets are map-span
  fractions resolved relative to the world's sea datum.
- The game's central warmth source and mandatory scattered warmth pockets are
  disabled. User-configured sources provide magical forcing. Land and sea ice
  form where the latitude climate is cold enough, without coverage quotas.
- Mantle plumes stay fixed beneath the moving plates. Each epoch builds a shield
  volcano over the plume, and the plate carries older ones away dormant, leaving a
  chain that records the plate's path. Each ocean plate always has at least one plume.
  Fracture conductance moves with the plates, and part of its excess over
  the floor heals each later epoch, so cooled conduits stop venting.
- Crust-bound magical amounts follow every internal material transport. Thermal
  forcing refreshes with climate; material feedback and elapsed storage advance
  once per epoch.
- Continental ancestry and current mechanical membership are separate. Persistent
  regional driving moves and rotates plates. Two continents meeting push back on
  each other; an ocean between plates sinks and lets them keep closing, so oceans
  shut and bring continents together. Accumulated
  extension can disconnect a plate into independently driven fragments; compressed
  continental contacts can weld without merging their material origins. Geological
  intervals have their own units, independently of ecological and societal years.
  Motion and boundary geometry update throughout each interval.
- Formation sets the water budget from the requested initial exposed land share,
  independently of continental crust allocation. Once history begins, the inventory stays
  fixed through the final present pass. Grounded ice removes its water-equivalent
  volume from the ocean and melting returns it; floating sea ice does not. Explicit
  epoch water-level offsets apply separately. The eventual exposed land fraction
  can change as crust moves and basin capacity changes. A child inherits its
  parent's datum and never moves it. Rivers grade to the sea and never cut below it.
- Ice mass balance follows climate: the lapse rate already in the temperature
  field carries altitude, and the separate altitude bonus is zero except under
  the Glacier-carved terrain choice. Terrain selection preserves the shared
  clock's temperature, ice, water forcing and elapsed times. The default clock
  includes a cold age independently of terrain selection.

Detail presets select a fixed ground area per cell; a world's dimensions decide
its cell count. `resolution.ts` owns the presets and workload
calculation shared by setup and generation. Setup shows live estimates for every preset and warns
above the default world's Standard workload. This warning does not limit map
size or detail. Numerical boundary support adds halo cells.

All qualities execute the physical processes and configured epochs. Generation
cost increases with numerical detail and process workload. Scratch bands and the
scratch file are discarded before the result leaves the worker; no intermediate
state is stored.

Continental deformation and crust transitions follow the characteristic province
size, so a larger world retains broad, irregular land masses. Candidate placement
covers the complete rectangular domain. Continent and province totals remain
creator choices. Impact, plume and fracture budgets express prevalence per
relative map area. Fire core budgets follow land area, Pressure loci and wake
budgets follow ocean area, and coastal impulse budgets follow shoreline length.
Their footprint widths, spacing, travel distances and dimensional feedback resolve
from relative declarations through `MapScale`. Physical fields and coordinates
remain measured data, with unit encoding handled by that same utility. Climate
coverage remains an explicit latitude-frame choice.

Initial province sites are independently distributed, allowing unequal blocks
and locally clustered boundaries. Continental assemblies grow around separated
nuclei with unequal area budgets. Cohesive growth follows adjacent provinces near
each nucleus; dispersed growth permits isolated fragments. Oceanic plates occupy
the remaining dense crust without favoring a map edge. Plates form around continents: each assembly starts on
one plate with the ocean around it, so plate edges mostly run through ocean and a
continent moves as one until it collides or rifts.
Province contacts
come from their Voronoi topology, including neighbors across the cylindrical seam,
so a narrow shared boundary does not disappear between area samples. The crust
budget can still bring regions into contact, and later history can join or divide
landmasses; assembly totals are not a count of separate continents.
Terrain selection changes inherited shortening and the processes that wear and
deposit material. It does not flatten the final height field. Continental motion
sets later plate drift and tectonic activity separately; moving plates still
reshape shores and build collision ranges. Continental organization and initial
ocean coverage are separate creator controls.
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

Independently owned regional maps dispatch to `regional/workflow.ts`, which
composes the world's registered initialization, projection and extraction with the
regional schedule described above.

### Latitude climate

The climate steps implement a latitude-organised climate; the coefficients are
declared in code.

- `ocean-currents`: belt-driven drift turned along coasts into gyres
  (`oceanGyres.ts`). Western boundaries are intensified and upwelling forms on
  subtropical eastern boundaries. A sea-surface anomaly is carried along the current
  from its source latitudes. Eddy mixing applies only where opposing drifts meet, so
  a cell boundary forms a front instead of a step.
- `atmospheric-climate` completes temperature, wind, moisture transport and precipitation
  together. Temperature starts with a global mean plus the epoch offset, a latitude profile and a lapse
  rate, plus the sea-surface anomaly and external heat. Crustal heat warms only
  geothermal vents. Hydrothermal heat carried by currents feeds sea ice and reefs,
  not air temperature. A seasonal half-range grows with latitude and continentality.
  Wind follows Hadley, Ferrel and polar cells by latitude, with terrain
  deflection, belt speed, crest exposure, lee shelter and gap channelling
  (`windTerrain.ts`).
  Air columns march downwind in one ordered pass
  (`airColumn.ts`). They gather moisture over the sea and rain out with distance and
  uplift; pressure-belt rainout comes from `belts.ts`. Marine heat, maritime
  character and magical heat travel with the air; air relaxes toward part of the
  magical forcing beneath it with travel, and that heat spreads across the wind.
  Column precipitation takes the epoch multiplier, in fractional
  mm/year, split into rain and snow by the share of a sinusoidal year below freezing.
  The equatorial convergence spreads to stand in for the rain belt's seasonal
  migration; subtropical subsidence suppresses background rainout. Water already
  condensed by mountains, storms or thermal lift still falls, interrupting dry belts
  where moist air encounters those regional influences.
- `land-ice-mass-balance` and `sea-ice`: ice extent follows mass balance and cold
  rather than a coverage quota. Epoch glaciation scales growth and melting scales with
  the deficit. Current, wave exposure and local variation move the sea-ice edge only
  slightly, so polar seas well below freezing freeze.

**World frame.** The initial latitude frame is inherited by regions and places
the map between equator and poles independently of its physical size. An
equal-area projection or even-degree spacing maps northing to latitude.

Map boundary is a separate world setting. Cylinder, the new-world default,
joins east and west for crust, terrain, transport, drainage, climate and display.
The triangular world lattice has reciprocal short links across the seam;
geographic noise and reconstructed samples share the same period. Extracted
geometry is cut into chart pieces, retaining network junctions and directed river
profiles. The editor repeats the metre chart and normalizes edits into it.
The Ocean surrounded choice is shown unavailable.

The setup's Latitude frame choice offers a northern band, both hemispheres
and pole-to-pole coverage. It does not change the map boundary. Pole-to-pole
cylinders retain local terrain and map-relative noise up to their
north/south edges. Those faces close drainage and reflect transported material
locally; they do not merge longitudes into a single point or provide a shortcut
through a spherical pole. The connected ocean starts in the deepest basin. Physical
transport lengths, including front mixing, resolve against the map frame. A numerical
patch without a world frame sits at the mid latitude.

**Rainfall regimes.** The `rainfall` setting scales moisture supply (column
saturation and the precipitation baseline), not rain output. Its Dry, Mixed and
Wet anchors live in one table, `rainfallRegimes`, read by the setup choice and the
Arid and Wet world presets. Each anchor is fitted to its own outcome: Dry stays
desert and steppe; Mixed gives Earth-like equatorial, tropical-margin, dry-belt and
westerly-coast rainfall; Wet is wetter than Mixed everywhere. Ecology reads plant
water as the aridity index, precipitation over a temperature-dependent potential
evaporation, not column humidity.

### River centrelines

The physical lattice is the drainage solver, but its triangle-centre edges
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
directed source spans. The feature, network, clipping, inspection and
export paths consume this one geometry. Flow targets, water budgets, erosion
and authored geometry are unchanged, so the smoothing removes lattice artifacts
without changing the terrain.

### Inland work-area drainage

Open rectangular meshes describe a finite planar work area. If an epoch leaves
no connected ocean in that area, priority flooding uses its boundary as the
external drainage outlet. Ocean-connected drainage is the default whenever
an ocean is present; subsequent epochs recompute the roots. This preserves sea
level and terrain instead of creating water to satisfy the solver. This numerical
drainage boundary is separate from the inherited parent-boundary fields used by
refinement. Cylinder has no east/west outlet; pole-to-pole coverage also closes the
polar faces. Transport uses the planar metre chart.

## Implementation state

The TypeScript runner applies registered processes to one working map in a browser
worker. The workspace publishes semantic field groups through immutable resources, retains
completed causes by area, and uses direct shared domain validation for edits.
The cultural, political and settlement publications read people's layers on the land, described
above; site/interior layouts retain their own processes.

## Geographic significance at every scale

Publication recognizes coherent places before evaluating their significance.
The domain judgments in `worldSignificance.ts` combine physical extent with
breadth, occupation, relief, contrast, network role or supported authority as
appropriate to each kind. They do not impose a feature quota or named coverage.
Resolution controls evidence precision; zoom does not reveal a hidden local
catalog.

Every map applies the same judgments at its own scale. A map holds about the same
number of cells at every refinement level, so a finer map is the same kind of map
of a smaller country. `MapScale` resolves all dimensional thresholds from the
actual frame, independently of sampling density. Declarations distinguish lengths,
areas, volumes and compound dimensions; nonlinear scaling is explicit. Large connected areas split only through the
continental partition, judged at the same scale. What a map does not name stays
latent on it: physical water, stored drainage reaches, cover and magic coverage.

Ecological families preserve broad forests and wetland complexes across ordinary
internal variation. Their outer margins reuse the existing categorical sampler;
the raster classifier, palettes and shading remain independent of naming.
Only continental domains enter geographic subdivision, using terrain and drainage
costs to form substantial connected provinces. Mountain systems also require
relief; a broad flat plateau does not qualify as a range.

Emergent summits use prominence and isolation; falls use drop and sustained flow.
Lake and marine names require a substantial waterbody or an exceptional physical
role. Physical ocean and lake geometry remains available even where no named
water region exists. Magical places retain each system's causal evidence and
actual propagation courses. Configured injected landmarks keep the guarantees
and identities in [ADR 0006](adr/0006-landmarks-are-injected-causes.md).

A realm is founded at a known place and holds the land its seat reaches along the
travel surface. Its territory is the land where its allegiance is the most held,
so land nobody lives on is unclaimed, and its claim is every cell where anyone
still holds the allegiance, so a claim survives retreating control. Continental
political subdivisions retain their parent territory and sovereign identity and
use subordinate outlines.

Published area geometry serves drawing, indexed selection and export. Site and course influence footprints remain context rather than selectable
regions. Existing saved maps are not reclassified when opened.

## Ecology and organic geology

Physical generation runs atlas ecology processes on the same numerical map as
climate, drainage, erosion, ice and magic. The biome field describes living cover;
`landform` continues to describe relief. A plain can carry forest or grassland.
The **Biomes and life** layer contains cover, productivity, functional animal
biomass and organic source fields. Local-condition surface coloring is independent
of named biomes. Significant forests, wetlands, grasslands, barren landscapes and
magical ecological complexes become selectable polygons, judged at each map's
scale; ordinary patches remain in the fields.
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
travel with the wind; tree groups raft on currents. Arrival time grows
exponentially with the effective distance over the carrier's reach; the carrier
shortens distances downwind or down-current and islands act as stepping stones.
Nearby downwind islands colonize within decades, upwind and remote islands much later,
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
Moss forest; Greenwood's `verdure` is its own medium in the living cover.
`vegetationGrowth`, `fire`, `organicPreservation`, `seedDispersal` and
`animalToxicity` scale growth, burning, preservation, migration speed and habitat
toxicity by configured system intensity, independently of the system's name. Toxic
habitat changes forage and animal passage. Magical feature conditions can inspect
living cover, soil water, toxicity and animal biomass.

Land, climate, water and life generate on every map; magic and people are the
selectable domains, and only a building interior has no geography. When a map is
generated again, obsolete generated ecological regions are replaced and
authored/protected features stay authoritative. The shared
geographic identity matcher associates ecological polygons after resampling, so
matching regions retain their names and relationships when contours move.
Protected biome samples also govern polygon classification.

Epoch durations are in years. Analytical cohort responses and graph travel times
avoid annual iteration over geological ages. Each epoch has two coupled biological
responses. Animal feeding and soil nitrogen act as resource constraints on the
cohorts. Authored woodland and sampled fields remain geographic authorities.
Refinement inherits the existing community without replaying its age. Completed
causes record biome transitions, fire-affected cover, animal biomass and migration.
Numerical state follows material transport, inheritance and atomic publication.

Organic geology is a downstream consequence. Waterlogging preserves litter
as peat and aquatic organic sediment; actual sediment gain buries it. Erosion,
burial temperature and geological time change the source pools into coal, oil and
gas potential. Source transformations conserve represented carbon. Each cell has
one mixed buried horizon. A forest-to-swamp-to-buried-source history is one
supported consequence among many ecological histories.

## Naming

Names use the standalone `@atlas/name-forge` runtime in `packages/name-forge`.
The atlas owns its configuration in `packages/generation/src/namingCultures.ts`:
five spelling traditions loosely inspired by English, Italian/Iberian, Nordic,
Arabic and Japanese place names. Character Markov chains trained on place names
provide most settlement names, with occasional curated compounds. Geographic
names combine a generated stem with an English geographic descriptor. These
corpora and grammars are independent of Ice Remembers' naming configuration.

The naming vocabulary describes GIS features: `biome` with the classified biome
type as its subkind, `ocean`, `river`, `lake`, `landform`, `settlement`, `polity`,
`culture` and configured magical places. Ecological feature kinds such
as `forest` and `wetland` retain their rendering and geometry contracts; the naming
adapter maps them to `biome` and carries `attributes.biome` as the naming subkind.
The Oceans and seas layer names significant marine regions from the physical sea
outline. Broad expanses remain distinct where their connecting passages narrow
substantially; shallow sills support this distinction, while minor seafloor relief
and changes below the sampling scale do not create more names. Smaller adjoining
basins and shelf-dominated regions use the Sea descriptor. Detection follows the
physical mesh across the cylindrical seam and does not use plate or province
boundaries. Named extents preserve the shoreline and islands without
requiring all water to belong to a named region. The naming and
authored-protection rules apply.

Names depend on the world seed and stable geographic key, using a separate random
stream. Seeded geographic naming traditions cover physical geography even without
people. A generated tongue is a tradition in the identity column, held by a share
of each cell's people. Taking up a realm's allegiance or a faith does not replace
the tongue a people holds, and a people cut off from the heart of its tongue
begins a daughter tongue.

The Languages layer publishes `language:<id>` and `languageUse:<id>` as the share
of each cell's people who hold the tongue; generation writes the same distribution
to both, and a cell without people has no signal. The field is read from the
identity column, not simulated separately. An authored settlement group records
per-language `languageShares`: overlapping `knowledge` and exclusive naming `use`,
each a fraction of the group's residents. Use totals at most one; the remainder is
unspecified. Simple authored input can still list known languages and one
`namingLanguage`; omission defaults to the first known language, while explicit
null means unspecified use. Explicit shares are authoritative; the language list
and primary naming language summarize them. Population authoring can select one
naming language or edit individual knowledge and use percentages. Raising one use
share beyond the available remainder proportionally reduces other use shares;
knowledge stays at least as high as use.

A place is named in the tongue most of its people spoke when it was first seen
and keeps the name and founding era. A new tradition, a realm included, is named
in the tongue of those who found it. The final `atlas.names` pass names new
geographic features after the human eras in a tongue spoken on their ground,
chosen with weight by the people who speak it along the feature's shape.
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

The naming config holds several readable terms for each work kind (for example
Forge, Foundry or Smithy). The work kind remains in the feature attributes.
