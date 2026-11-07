# GIS/domain-backed generation workflows

Current execution follows [ADR 0003](adr/0003-frontend-session.md): a browser worker
resolves scoped catalog inputs and opens immutable numerical resources directly.
Initial generation displays independent epoch previews and publishes validated
record batches. Explicit map saves retain completed geography; execution state
does not restart or recover. There is no backend or MCP in this product phase.

When society feedback moves a map's physical shore, publication refreshes its
named seas from that shoreline and reuses matching place identities. Other maps
retain their captured geography.

## Geographic regional refinement

Selected region subjects retain their original source and arbitrary hierarchy.
An explicit refinement action links a finer geographic area to that subject,
using its nearest refined ancestor as a starting point. The child is a separate
map sharing coordinates and completed history, with independent elevation and
coastlines. It does not preserve parent height samples or require numerical
reconciliation. Creation captures local feature, network, drainage, landmark,
magic and society records. Each geographic record belongs to the new map; a
separate place identity relates it to the source. Numerical inputs have map-owned
descriptors pinned to immutable resource bytes. Replacing a parent's resource
does not change those captured inputs, and creating a child does not copy scalar
arrays. Refinement builds the world's physical field on the child's own triangular
lattice (`canonry.initialize`), then runs `refinement.begin`, the regional schedule,
the world's projection and feature extraction (`canonry.project`,
`canonry.features`), the regional identity, magic-map and place steps, and
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

Regional terrain uses a fixed physical scale ladder calibrated from the default
world's usable land and approximate regional subdivision. Each successive level
uses finer cells and suggests smaller subjects. A map captures its own level when
created, so resolution does not depend on live parent geography. Quality changes
sampling density at that level; selection does not fit cell size to a budget.
The policy declarations live in `packages/domain/src/regionalScale.ts`. Rectangular
sampling frames and coastal context add samples beyond the selected land area.
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
Existing saved regions capture their composed detail once when opened, retaining
their finer geometry and surface patches. Zoom never opens another map or exposes
the surrounding world.

Captured source drawings and surface patches become initial context rather than
authored constraints on the child. Conversion preserves a saved map's own
drawings and protections. Numerical import keeps material amounts distinct from
influence and scales captured amounts by represented area. Height, temperature
and vector components remain signed.

The regional surface has a compact continuous chart, including selections across
the cylindrical seam. A stable captured subject determines its coastal
neighborhood; repeating refinement does not repeatedly expand that frame.
Published field coverage and the map's frame describe this surface, rather than
clipping it to the starting outline. Mapped ways split at the chart edge while
retaining one feature identity and their network junctions. Physical queries,
class reads and display interpolation locate canonical coordinates in that chart.

Regional terrain, water, living cover, magic and places develop in a fixed coupled
schedule (`packages/generation/src/regional/schedule.ts`, recorded in
[ADR 0008](adr/0008-regional-refinement-is-conditioned-amplification.md)): context once,
three rounds in a declared order (relief derived from the network, then water and access,
then climate and magic on the shared media, then the living landscape and places), one
refresh of derived reads and one extraction. A round is not an epoch; nothing replays world
history. The network is grown once and the relief is re-derived from it each round through
the media as they are then; working structures (the network, the evidence, seats and their
footprints, proposed places, magic materials) persist and evolve, and the shared media are
natural copies of the captured present plus a ledger of tracked contributions, so a round
updates an influence instead of adding it again.

A world process enters refinement only with a recorded verdict: included, modified,
replaced or left off. Three rules apply to every included process. A world locator that
places a budgeted count per area is replaced by the captured source, because a budget
that floors at one would invent a source on every map. Bands are re-derived every round,
so every effect is a derivation term or a ledger total, never an in-place addition.
Thresholds stated in cells, flow units or epochs are restated in physical units.

Established features enter through a cause registry. Each established-feature kind
declares the hooks it needs (`read`, `influence`, `support`, `caps`, `restore`,
`conjoin`, `respond`), and the schedule calls them at fixed points; a new kind of
established feature is a registry entry, not a new schedule call. Evidence is ordered by
identity, so a repeated refinement reads it identically.

The exterior of the frame is the parent's ground. The halo carries the parent's country;
frame-edge exits sit wherever the exterior is no higher, at the parent's height, and exit
roots owe a fall cost so water runs down to the low exits. Spill routing treats the
exterior as an outlet at its own height. Calibration and conditioning blurs are taken
over the frame's cells only.

The captured country's character enters as the world's structural grain, strain, glacial
reworking and volcanic construction. The world's columns interfinger across their parent cells,
and the belt's folds, continuous along the grain, strip the column on their axes: deep rock crops out
there, troughs keep what lay on top, and each round's cuts uncover more. The drainage network is a geodesic tree over the land
rooted at the established waters (the connected sea, open frame edges starting with their
remaining fall to the sea, captured lakes at their level, the floors of the parent's closed
basins) and descending a cost field of process terms: climbing the captured base, crossing
the grain, the rock exposed in the column, open fractures
and warded ground cost; captured courses, the parent's channel raster and a river seat's
ground are cheap; the ground around known summits and cones is dear; gathered water makes
its channel cheaper and the country is routed again through it. Ground heterogeneity decides
only between routes those terms leave equal, most on plains. Relief is derived from that
tree: each cell rises above its receiver by a concave channel profile or a material
hillslope gradient, capped inside a seat's footprint, amplified so that the relief blurred
to the parent span is the captured base; hillslopes are coupled sideways; ice accumulates
where the lapsed climate and the recorded history allow, hollows cirques behind lips,
deepens troughs and leaves moraines; present ice flows down its own surface while the
recorded glacier follows the network; cones add their construction.
Spill routes resolve basins and flats. Sheet runoff becomes a channel where the terrain
gathers it: the channel threshold is a reference runoff in the map's own samples, scaled
by a bounded slope factor, applied with the strip test and headwater pruning. Those
channels form the drainage network; which of them are named rivers is decided by the
river significance rule at the map's scale. Because relief comes from the network, a
channel lost to transmission loss leaves a dry valley with its incision kept. Closed
depressions without a cause fill. The parent's closed basins are kept whole, and hollows
dammed by a slide or a fan that are deep and wide enough to hold a lake stay. Lake supply
balances precipitation and runoff against evaporation and seepage; shores follow the water
stage against continuous terrain; ocean outlines use connected sea membership. The footprint
rule applies to mapped shores as well as names; unresolved ponds remain numerical water
context. Floodplain coverage follows local channel margins.

Established features are terms in the processes: an inherited summit is a divide node the
channels route around and moves to the realized summit of its massif; a captured river's
course is a corridor the network follows, its discharge enters across the frame edge, and
the stem that follows it carries the river's name, identity and the course itself as
evidence for the next refinement; a captured lake is the base level its tributaries rise
from. A known settlement's footprint caps the hillslope relief around it in the form the
network gives that ground, a river seat draws its channel, and a seat still on unusable
ground moves to the best usable ground within reach that keeps its situation. New villages
are proposed once at the network's events, compete for hinterland over the travel cost of
the present surface, and take their support in the last round or are dropped. Each round
the weakest half of the unsupported candidates gives way, a bounded number of times,
until the remaining places are supported, so the outcome does not depend on the order of
elimination. Seats and summits are re-sited from their captured positions and this map's
own products are regenerated on every refinement, so a repeated refinement reproduces itself.

The derived relief is worked by the processes that act on real ground: the crests between
neighbouring catchments carry a crest term so ridgelines branch; drainage divides are
written into the ridge band and a pass is the low point along a divide, so the world's
landform classifier reads them; ridges above a crest strength are held fixed in hillslope
smoothing; hillslopes above their angle of repose shed material that the network carries,
settling along the captured base gradient, dropping at lake entries and leaving its load
at the shore roots; drainage loses water to the ground along its length; valley floors are
the flat ground a channel reaches from its cells.
The coast develops on that surface from the fetch each shore cell faces: exposed shores cut
back, sheltered shallows fill, and rivers meet the sea as deltas or estuaries by their load
and the shore's exposure. Ice is routed over the surface, thins as it descends and melts where
the lapsed climate does not hold it; its erosion is booked once and its melt enters the runoff.

The shared media are re-derived from the capture each round. The fracture set is the
captured value, opened further where captured strain is high and the material band is
weak, plus the ledger; material resistance and seepage read it. Geothermal heat is
re-derived from the captured value plus opened fractures and cone proximity, and Fire
sources read it. Insolation, cold pooling and wetness are unpublished per-cell arrays;
ocean distance is captured.

Climate re-derives each round from the captured copies under the developed relief:
temperature by lapse, aspect and cold pooling where a gentle floor lies below the surface
around it; snow re-split from precipitation by the world's seasonality rule; wind deflected
by the relief through the world's terrain rule; captured precipitation, moisture and runoff
scaled by each slope's exposure to the deflected captured wind, so windward slopes are
wetter and lee slopes drier; moisture and wetness on the present surface; runoff changed
by the present cover against the captured cover (cleared ground sheds more, grown ground
holds more) and increased by meltwater. Soil develops under the living landscape
once the ecology has begun and is not re-written by the climate after that.

The living landscape is the world's ecology engine hosted on the regional field: prepared
once from the captured state in the context step with its history memory reset to the
first derived geography, responding each round over a fixed span of horizons under the
regional climate, the magic systems' living effects and the country's fire causes, with
its soil water capped by the soil's capacity and its history remembered between rounds.
Preparation reads the capture without noise: conifer share from captured temperature,
saplings from a young canopy, seeds from presence, and soils and carbon as captured. The
fire causes are magic heat, the driest fuelled ground in each block and settlement edges,
each with a stable keyed draw, beside the engine's own background ignition. Cover under
new sea, lake or ice dies and its litter goes to the soil; authored forest polygons and
fixed channels hold. Cover binds the next round's hillslopes and runoff. Surface classes
use the raster's shared class-boundary evaluator; habitat outlines come from the world's
ecological extractor judged at the map's scale, with its margin and small-gap rules;
smaller patches remain field coverage.

Topographic prominence locates summits and their joining cols above a prominence floor
read at the parent's span; a summit is named by the world's prominence-and-isolation rule
at the map's scale (see [Geographic significance at every scale](#geographic-significance-at-every-scale)),
so a regional map names its major peaks and a finer map the lesser ones. Measured
opposing flanks identify ridges and valleys; connected mountain relief becomes range
footprints. Waterfalls require sharp channel-profile breaks.

Each magic system inherits its captured channels and sources once when refinement begins.
Origins the world places by a budget per area (geothermal, deep-ocean, death, dead-lake,
tenure, kept-line) keep the captured source. Point sources (veins, loci, placed sources and
forges) arrive as sites on the cell under each parent peak of the captured field. Captured
heat and melt are marked as already applied. From then on the world's engine locates and
propagates every system each round against the present media through its own carrier.
Fire separates held and spent material, exposure and release, with fractures carrying vein
heat while fallen and forge deposits remain local. Aurora charge drains toward cold traps
and is read from its ice and ground reservoirs against the present cold. The Pressure
field is copied from the capture and not retraced. Greenwood spreads through connected
vegetation, while groundwater leaches buried charge toward supported spring breaks. Salt
beds dissolve into brine, follow drainage, crust in captured closed basins and supply
wind-carried dust; exposed beds harden or collapse, and Fire consumes their material in the
first round only. A captured Hallowed ward does not spread again, only its located sources
do; wards displace other magical fields to their rims and the ground inside resists
cutting. Veil develops strain where systems compete and pairs coherent tears into doors at
extraction; the parent's captured doors stand as established evidence beside them. Each
round the systems are evaluated against the present media in the lore's order, with the
captured intensity held along the frame edge where the parent's country continues, and
their ground effects are declared as that evaluation's totals through the ledger: hardened
rock as the change from the captured intensity, confluence soils against the natural soil,
the hallowed spill, the Veil's wild relief, door chill and pools, and salt's glass and
desiccation against the natural ground. Toxicity, the ice held by charge above its relict
floor and the door rings' grass and saplings are floors written on their own bands. The
applied heat is the forcing the rivers carry downstream. A resolvable relief change
reroutes water within the round. These operations develop the captured present without
another physical epoch or human era. The child publishes its developed grain for its own
refinement.

Named magic places are judged by the world's magic-place significance at the map's scale;
local peaks within one site complex do not create separate places. Class coverage
remains a field even when no named outline qualifies. The physical footprint rule
also applies to new lakes and non-source sites; unresolved water and magic remain
field context, while captured source places remain available. Regional refinement
does not place new global sources, renew historical stocks or replay ocean
impulses. Known places and completed society history remain context. Smaller
settlements, local ways and physical sites come from regional terrain and useful
locations, without demographic allocation gates or another society era. Each settled place
takes its fields and pasture from its hinterland, ranked by farming suitability and travel
decay, and declares their clearance on the tree cohorts each round as the difference to the
cleared target, so the engine grows on cleared ground and the fields stay cleared without
ratcheting; an abandoned seat clears nothing. At extraction every settled place sends its
residents to the market seat and a smaller share to its nearest larger neighbour; the flows
are traced over the present surface with captured roads as worn ground and door ends as free
edges, in repeated passes over the ground the previous pass wore, so later ways bend into
earlier ones, and each way is published at the class its own flow earns. A way crossing a
channel fords it, read geometrically against the drainage tree's links (which join channel
cells across a vertex); a road over a sizeable river crosses by a bridge; a settled place
with a falling channel within reach turns a mill; every settlement inside a captured
control polygon carries that control. Regenerating society alone uses this map's current
surface and preserves terrain; physical refinement starts from its pinned inputs. Neither
path reads live geography from another map.

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

### Magic systems

The seven magic systems are first-class world effects and processes. Their physical
motivations, media, feedback and interference follow
[product specification 10.3](product-spec.md#103-magical-generation--the-seven-systems)
and the [magic source authority](../AGENTS.md#magic-source-authority), without importing
named setting lore. The systems share the process structure where it serves them and use
system-specific operations where their behavior requires it. Society's reads of magic and
the coupling between the pillars are decided in
[ADR 0004](adr/0004-coupling-through-each-systems-medium.md).

Magical places are extracted once after the optional human history, before final naming.
Human history reads the numerical fields and material stocks directly. Regional refinement
uses the same extraction process before carrying captured identities onto its geography.

### Society

`world.societies[areaId]` retains aggregate communities, joint population groups,
connections, completed eras, political relationships, works, events and magic practice
resources. Registered human-era processes evolve population and migration, cultural
contact, works/practices and political reach. Culture, language and religious membership
remain separate from sovereignty, administration, control and claims. Settlements and
roads consume that state.

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
Regional refinement retains completed history and known place identities without
subdividing population budgets or rerunning old eras. The inspector exposes population
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

Use Canonry's generation structure and algorithms as the baseline: configured
process sequences operate on a shared working map, check required facts, apply
changes, validate results and update fact validity. Adapt that structure to the
atlas's TypeScript GIS/domain model. Canonry is compared by mechanism: the causes a
process reads, the transformations it applies, the feedback it supplies, the state it
carries between epochs and the geography it produces. Its numerical values, hashes,
seed mappings and rounding are not targets, and its parameters are retuned or replaced
freely for the atlas. Generation within the atlas is deterministic.

This structure governs initial world generation. Independent regional maps build the
same physical field on their own lattice and run the regional schedule described
above in place of the world's physical schedule, epoch runner and society working
state, sharing the numerical and spatial primitives and publication infrastructure.

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
the physical world, the surface grid and its topology, society and the projection
tables. One block cache per worker keeps blocks
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
settings; the society coefficients those bundles move are atlas parameters
with declared defaults, read once per cycle into the society workspace
(`societyProfile`). Adjust opens the advanced panel on the underlying settings
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

A landscape sequence follows Canonry's causal interleaving:

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
can reference physical epochs and supply their own durations and variables.
Ordinary present-day edits preserve completed history.

### Magic in the epoch sequence

`World.magicSystems` holds the configured systems. Each declares its origins (sources
located from physical geography, history, people or authored records), its stocks and
the carriers that move them, and the propagation its medium implies. Meetings between
systems are a separate list of confluences (`packages/domain/src/magicConfluences.ts`).
A confluence that names a system the world lacks is valid and never holds.
Configurations participate in the generation hash.

Each epoch advects accumulated activity, first occurrence, storage and coastal
history with Canonry's crust source map. Climate-phase systems (Fire, Pressure)
alter heat, moved water and rock before hydrology; post-glacial systems (Aurora,
Greenwood, Salt, Veil) act after ice responds, Aurora through the charge its ice holds,
carrying ice persistence into the following epoch; every evaluation re-applies the
shared forcings. Society-phase systems (Hallowed) are made of what people did: each
society cycle, inside a round or in the present, the environmental refresh records
tenure, walked ways and the dead on the mesh, evaluates society-phase systems and
re-evaluates any system whose stocks people drew or deposited (cores cracked at a
forge, seed planted, sap cleared), then reclassifies. A world without a human era
never runs it. Final classification retains every feature mask, natural geography and
physical materials. The surface class of a cell is the class with the largest coverage,
with rule priority breaking ties, and a second surface records the runner-up where it
holds a substantial share. An inland map has no fabricated pressure locus. A warm
present may have no active Aurora while preserving its glacial activity history.

### Rock and relief

Every cell holds a short column of rock on the field's own bands: the top layer is what the
surface is, the lowest is a basement that never runs out. Erosion strips from the top, deposition
and eruption add to it, and the surface's resistance follows whatever is exposed while keeping what
has been done to it. Each kind and its facts come from one catalogue
(`packages/generation/src/rock/rockCatalogue.ts`), and a lint rule keeps other generation code from reading
or writing the rock bands. Buried sediment turns to rock by its setting. A bed too thin to be what a
cell's ground is only adds to the rock already there, so a film of ash does not change the map's rock.

What a map shows is where the worn surface cuts through the rock beneath. Continental platforms start with
kilometres of alternating beds. Rock under a belt or along a suture turns to its next form by how deep and
how hot it lies, never by chance, so neighbours with one history stay alike and nothing bakes at the surface.
A belt's crests bring up far more rock than they stand high, by its structure and not by each summit's
height, so exposed rock falls into zones along the belt: the deepest and highest grade in its core, younger
beds toward its front. Melt in an arc cools as a batholith below a volcanic shell and shows only once
erosion has taken the shell.

Plates move in many small steps. Each cell follows where its material has come from across the
whole move and takes the height and rock of that place when the move ends, so a move carries relief
instead of averaging it away. Ground with too little arriving is new crust and keeps the shared
value. Where plates converge, some crust ends up under other crust and no cell takes up the rock that
stood on it. That rock rides to where its crust went and stacks there across a thrust sheet's width,
so a collision piles rock up, and only part of what rode on a sinking slab comes back. Continent
floats: where it rides up on ocean, the ocean goes down under it and the continent keeps its area, and
only continent meeting continent is shortened. Sinking ocean pulls its plate after it, so an ocean keeps
closing until no ocean is left at the contact. An ocean province that reaches what it sinks beneath is
renewed at its plate's far side, so a plate keeps moving as a conveyor. Continents that meet shorten until
they lock and weld into one plate along a seam weaker than either; what drove them together ends there.
A continent's interior is hard to break, so when later pull from sinking ocean tears a welded plate it
tears along the seam, and the pieces and their shares of the old belt leave with whatever pulls them. Ocean-bearing parts of a plate
can tear under the same pull, so a merged plate gains new edges around its land and the old edges end up
inside it. Plates travel furthest in the first epoch and less in each later one, far enough early on for
oceans to close, separately from how strongly an epoch builds. On a bounded map a plate slows as
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
so ridges rise where they stand. As a sheet climbs its beds tilt and the surface planes across them,
which exposes rock in bands along the belt. Rifts keep their tilted, alternately dropped fault blocks
from pass to pass in the same way. Crust that subducting ocean returns as arc crust feeds a belt's
roots, as continental crust piled up in a collision does; a belt with no continent builds an arc on
its ocean crust, and root crust the plates carry away from any convergent belt settles where it lies.
Each pass's crust adds to what earlier passes left, and crust too thick to hold itself up flows outward
through the continent under its own weight, more of it the thicker the column stands. Crust holds that
thickness only while being squeezed: once a collision ends, the old belt's root settles out under the
land around it, and wear that cuts past the rock on a belt thins the root itself, so old belts sink to
broad raised ground while their deep rock comes to the surface. A world's first
forming stands in for the drift before it, so its belts begin with crust already shortened by their
strain and go through the same roots and flow, which leaves older high ground for later ranges to stand on.
Interior stress reaches a plate's old sutures and province seams and works a zone of crust around
them. Seams are properties of the crust and travel with it, so each pass works the same ones. A plate's
strongest push, from convergence at its edges or more gently from an ocean ridge, carries through its
whole interior, and thickens and raises older rock along its seams, spending root crust the plate's belts
have left and otherwise the zone's own shortening. Close to a rift through a continent, extension takes
over from that squeeze, and the seams there thin and sag.

Processes and materials meet through a shared vocabulary of modes: abrasion, plucking, shear and solution.
A material holds facts, a mode says how facts answer its attack, and a process says how it acts, as a mix of
modes, without knowing what any material is. A cell is a stack. An action goes down through it, spending
itself on loose cover first and then on each layer of rock by what that layer gives up, while cover, open
fractures and wards bear on it. World and region read the same stack, and a region's cone aprons join it as
a modifier. Streams, solution, ice and slopes are processes in `packages/generation/src/processes`. Each
owns its settings and says how they read at another map's scale, one ledger writes what comes off and
lands, and the sequence says when each runs. `MATERIALS-AND-PROCESSES-ARCHITECTURE.md` at the repository
root holds the reasoning.

Rock decides erosion. A river grinds, so strength is what resists it, and ice plucks along joints, so columnar
basalt goes before massive gneiss of lesser strength. A cell's height is the mean of its ground, so a valley
in a coarse cell lowers that mean and exposes deeper rock only in proportion to the share of the cell it
covers, while the valley's own depth stays on record as incision.
Streams too small to map wear every sloping cell, without a valley on record, so land falls toward its
rivers. Weak rock lets valleys widen and takes more of a cell; strong rock keeps them narrow. Land that
has relief to wear therefore leaves hard rock standing, while hard rock on ground already worn to grade
stays low, as a shield does.

Slopes fail on the same terms at every scale: the step between two cells climbs one hillslope, however
wide the cells are, so a coarse map's steep flanks shed as a fine map's do. Hard rock holds a steeper
step and gives up less when it goes, open joints lower the angle a slope holds, burning loosens what roots
held, porous rock takes water
into the ground before it runs off, and water dissolves soluble rock wherever it runs.

Each magic system changes the column once per epoch through its own medium. A system's share of the
ground picks fixed patches of it, so its rock forms bodies that hold the share and build on the same
ground each pass. Fire hardens rock along veins, seals spent conduits and throws core debris; Aurora
rots rock open to the sky, and charge grows crystal on the bed under ice; Pressure crushes shore and
sea floor; Greenwood's roots open rock, its springs lay tufa and its water takes soluble rock; Salt
lays beds that can be buried and uncovered; Hallowed turns warded ground to kept stone that nothing
else alters; Veil shuffles the column under a tear. Meetings make their own rock. Each system's stock
is held or lost according to the rock it lies in. What each makes shows only as far as later processes
leave it exposed, and it erodes, fails and holds water by its own properties.

A region continues all of this: where the parent thrust the ground, its folds come from the parent's
sheets, place across them and dip.

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
strengths, retaining material conservation, historical maxima and new-crust rules.

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
stream over block runs held in bands. Society demands capture their eligible medium
before applying changes, then stream the forcing across those cells. Local work
queries traverse the sampling topology without collecting the entire surface.

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
composed into the native workspace before physical consumers run. Per-layer
validation is consolidated in `layerValidation.ts`.

The standalone `physicalProfile` retains Canonry's defaults. `atlasPhysicalProfile`
adapts them for the atlas rather than copying the game's frozen-world setting:

- Geological causes use world metres and sampling-independent initial sites.
- Native climate units map to Celsius through a declared freezing point and
  scale. Epoch temperature settings remain Celsius and sea levels remain metres
  relative to the world's calibrated sea datum.
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
  spreads retained continental shortening into roots behind the belt. The belt's
  cross-section shapes that distribution; evolution cannot manufacture
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
size or detail. Numerical boundary support adds halo cells.

All qualities execute the physical processes and configured epochs. Generation
cost increases with physical extent and numerical detail. Scratch bands and the
scratch file are discarded before the result leaves the worker; no intermediate
state is stored.

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
unequal area budgets, starting away from each other, with the largest few favoured
so a world tends towards a few main continents and smaller ones. Correlated growth
follows province adjacency, without prescribed regional centers. An oceanic plate
takes its share of the world's water before continents grow, so the land sits
together around open ocean. Plates form around continents: each assembly starts on
one plate with the ocean around it, so plate edges mostly run through ocean and a
continent moves as one until it collides or rifts.
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

Independently owned regional maps dispatch to `regional/workflow.ts`, which
composes the world's registered initialization, projection and extraction with the
regional schedule described above.

The optional offline `tools/canonry-reference` program reads the original C#
library to produce reference fixtures and `contracts.generated.json`. With the
pinned reference repository at `../the-canonry-game` and .NET 8 available, run
`make canonry-fixtures`. Ordinary app builds and CI consume committed
fixtures and need neither that repository nor .NET.

### Latitude climate

The climate steps keep Canonry's names, order and feature ownership. Their
bodies implement a latitude-organised climate in place of the reference's
radial frozen-world climate; the coefficients are declared in code.

- `ocean-currents`: belt-driven drift turned along coasts into gyres
  (`oceanGyres.ts`). Western boundaries are intensified and upwelling forms on
  subtropical eastern boundaries. A sea-surface anomaly is carried along the current
  from its source latitudes. Eddy mixing applies only where opposing drifts meet, so
  a cell boundary forms a front instead of a step.
- `temperature`: a global mean plus the epoch offset, a latitude profile and a lapse
  rate, plus the sea-surface anomaly and external heat. Crustal heat warms only
  geothermal vents. Hydrothermal heat carried by currents feeds sea ice and reefs,
  not air temperature. A seasonal half-range grows with latitude and continentality.
- `atmospheric-flow`: Hadley, Ferrel and polar cells by latitude, with terrain
  deflection, belt speed, crest exposure, lee shelter and gap channelling
  (`windTerrain.ts`).
- `moisture-transport`: air columns marched downwind in one ordered pass
  (`airColumn.ts`). They gather moisture over the sea and rain out with distance and
  uplift; pressure-belt rainout comes from `belts.ts`. Marine heat, maritime
  character and magical heat travel with the air; air relaxes toward part of the
  magical forcing beneath it with travel, and that heat spreads across the wind.
- `precipitation`: column precipitation with the epoch multiplier, in mm/year up to a
  ceiling, split into rain and snow by the share of a sinusoidal year below freezing.
  The equatorial convergence spreads to stand in for the rain belt's seasonal
  migration; subtropical subsidence dries the subtropics and caps uplift rain there.
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
The Ocean surrounded choice is shown unavailable. Configurations with an explicit
legacy longitude choice retain that choice.

The setup's Latitude frame choice offers a northern band, both hemispheres
and pole-to-pole coverage. It does not change the map boundary. Pole-to-pole
cylinders retain local terrain and the same metre-scale noise up to their
north/south edges. Those faces close drainage and reflect transported material
locally; they do not merge longitudes into a single point or provide a shortcut
through a spherical pole. The connected ocean starts in the deepest basin. Physical
transport lengths stay in map kilometres; only the front-mixing width is capped in
degrees of latitude, so a small full-globe map keeps distinct belts. A numerical
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

## Reference and implementation state

Read the corresponding Canonry bodies before adapting their structure:

- [Common lifecycle](https://github.com/chris-arsenault/the-canonry-game/blob/main/src/Engine.WorldGen/PhysicalGeneration/Pipeline/IMapGenerationLayer.cs)
  and [fact contract](https://github.com/chris-arsenault/the-canonry-game/blob/main/src/Engine.WorldGen/PhysicalGeneration/Pipeline/PhysicalGeographyLayerContract.cs).
- [Pipeline](https://github.com/chris-arsenault/the-canonry-game/blob/main/src/Engine.WorldGen/PhysicalGeneration/Pipeline/PhysicalGeographyPipeline.cs)
  and [seed/epoch context](https://github.com/chris-arsenault/the-canonry-game/blob/main/src/Engine.WorldGen/PhysicalGeneration/Pipeline/PhysicalGeographyGenerationContext.cs).
- [Epoch session](https://github.com/chris-arsenault/the-canonry-game/blob/main/src/Engine.WorldGen/PhysicalGeneration/PhysicalGeographyEvolutionSession.cs)
  and [physical/magical orchestration](https://github.com/chris-arsenault/the-canonry-game/blob/main/src/IceRemembers.Seed/PhysicalGeneration/IceRemembersWorldGenerationOrchestrator.cs).

The TypeScript runner applies registered processes to one working map in a browser
worker. The workspace publishes semantic field groups through immutable resources, retains
completed causes by area, and uses direct shared domain validation for edits.
The physical kernel is a source-traceable port; atlas profile settings, GIS projection
and user-configurable magic are explicit adaptations. The cultural, political and
macro-settlement generators use the aggregate society state described above;
site/interior layouts retain their own processes.

## Geographic significance at every scale

Publication recognizes coherent places before evaluating their significance.
The domain judgments in `worldSignificance.ts` combine physical extent with
breadth, occupation, relief, contrast, network role or supported authority as
appropriate to each kind. They do not impose a feature quota or named coverage.
Resolution controls evidence precision; zoom does not reveal a hidden local
catalog.

Every map applies the same judgments at its own scale. A map holds about the same
number of cells at every refinement level, so a finer map is the same kind of map
of a smaller country. Its scale factor is its cell span over a World cell's at the
same quality, exactly one on the World map. Lengths and breadths scale with the
factor; areas, catchments and discharges with its square; heights, depths and
drops with its square root. Large connected areas split only through the
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

World founding claims require reachable communities. A successor needs a viable
population with an institutional or connected regional base. Territorial extent
follows supported population and terrain travel costs, leaving unsupported land
unclaimed. Competing continuous cost margins establish shared frontiers. Claims
can survive retreating control. Continental political subdivisions retain their
parent territory and sovereign identity and use subordinate outlines.

Published area geometry serves drawing, indexed selection and export. Generated
travel-cost frontiers do not receive a second display-only border relaxation.
Site and course influence footprints remain context rather than selectable
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

A magic-only generation refreshes living fields and ecological polygons while
retaining existing terrain and completed epochs. Obsolete generated ecological
regions are replaced; authored/protected features stay authoritative. The shared
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
combination; people, culture, religious and practice affiliations distinguish
demographic groups.

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
language/era provenance survive later population changes and republication,
and a work is labelled by its own name rather than by its kind and a town name.
