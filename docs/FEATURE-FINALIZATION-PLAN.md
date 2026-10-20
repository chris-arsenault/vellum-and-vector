# World macro landscape finishing

Status: implementation authorized for all phases, 2026-10-20. Ecology is pushed
on main as `64774d6`. Feature finishing remains local. Integrated visual review
has not met the macro composition outcome; M5 remains open. The preceding fixes
were committed and pushed as `b455ba5`.

Current request: complete the structural and feature design rather than stopping
at another gap assessment. This revision is planning only. The structural repair below
supersedes the earlier proposal to publish an evolved base plus procedural
profiles. Older implementation notes describe work performed, not accepted
visual behavior or instructions to retain that representation.

## Outcome and user direction

Compose the generated world into interesting, coherent geography at the scale
people explore on the map. Work on whole mountain ranges, river networks,
coastlines, reef bodies, biological landscapes and magical regions, then adjust
terrain and numerical fields to support those compositions.

The user clarified the mechanism after reviewing the first proposal:

- Rivers should be reshaped as networks viewed from the macro world scale, with
  underlying terrain modified to fit. Intermediate mesh coordinates are not
  fixed controls.
- Apply this lens to all feature families. Believability alone is insufficient;
  the landscape should be interesting.
- Mountain passes must connect through the range, with connected valley
  approaches. Selected peaks can be raised and surrounding forms filled out.
- Reef bodies should be mostly connected, with accidental holes repaired.
- Include the recent biological features: coherent biome mosaics, forest and
  wetland systems, animal habitat, disturbance patterns and persistent magical
  ecology, with their underlying values reconciled to the finished landscape.
- This remains final shaping after generation, not another physical simulation
  or a change to the epoch algorithms. Execution of all phases is authorized.

These instructions supersede the earlier agent-derived restriction that final
shaping could only fit existing relief and could not create bends or alter peak
heights without additional epoch physics. Generated causes, large geographic
structure and feature identity remain inputs. Cell geometry, exact local heights,
small disconnected masks and awkward intermediate paths are revisable.

Preserve all configured epochs and Canonry's semantic process work. Numerical
equivalence is not a goal. Use physical metres; changing approximation density
must not resize the finished geography. Preserve authored protection where it
exists under the current domain contract.

Scope is top-level world generation. No backend, persistence, MCP, new editor,
child generator redesign, new political/cultural model, caves/interiors or
backlogged landmark injection. The separate [cartography plan](CARTOGRAPHY-PLAN.md)
owns navigation, layer controls and display performance. This plan provides
coherent final geometry and fields.

## Structural repair

Execution resumed 2026-10-20. R0 implements and checks the shared regional fit,
adaptive terrain support and ordinary finished-field reads using saved geography.
R1 then moves every producer and consumer, including independent channel layouts;
R2 checks integrated geography and cost. The existing epoch mesh remains unchanged.

R0 implementation: `macroFit.ts`, `macroSampling.ts` and final `sampledDetail.ts`
elements. A saved 500 km Standard region materialized in 5.7 seconds after sharing
nodal evaluations (initially 36.6 seconds): 13,438 broad samples, 44,524 narrow
elements, 18 MB serialized. Cold/warm 258×258 height reads took 0.128/0.115 seconds.
Direct tests cover a connected fit, fixed surroundings, retained drops and a
four-metre-wide channel without widening the global mesh. Actual terrain views
still show the old composition's disconnected cuts; R0 establishes the field
representation, not acceptable feature design. R1 must replace those mechanisms.

### Outcome and decisions

Refinement produces finished geography. Rendering, inspection, contours,
inheritance and export read that geography without interpreting the operations
that created it. Terrain detail must survive publication without a globally
fine grid or a list of deformations evaluated for each pixel.

User requirements: preserve the configured epochs and semantic generation work;
compose interesting whole feature systems; use physical dimensions independent
of detail setting; preserve authored geography. The latest correction is to
discard unused intermediates rather than retain them for hypothetical provenance.
These requirements do not prescribe a new solver, storage scheme or history UI.

Recommendation: finish into the existing numerical field model, using its
adaptive sampling and interpolation for localized terrain detail. Keep vector
networks and region geometry as final product data. Other fields retain sampling
appropriate to their physical variation; adding terrain detail must not allocate
every ecological, climate and magic channel on the finest terrain layout.
Existing layer resources already support separate field layouts.

Adaptive output is an implementation proposal, not a claim that its cost is
already acceptable. Its existing topology balancing, interpolation preparation
and channel allocation can themselves be expensive. Resolve that on real mixed
geography before migrating all producers. Do not recreate the earlier global
adaptive physical simulation: the epoch working mesh is outside this repair.

R0 found that isotropic adaptive support alone is unsuitable for narrow channels:
the saved Standard network has 60,750 km of centerline and requires approximately
six million longitudinal cells at half channel width, before banks or balancing.
The revised output uses adaptive samples for broad terrain and final nodal values
on narrow quadrilateral strips. The strips are finite elements, containing only
positions and final channel values, with ordinary point-location/interpolation.
They contain no lower/raise/replace operations, old terrain or generation recipe.
This changes an agent-selected representation, not the required terrain or river
dimensions. Shared-height fitting, local detail and all family coverage remain.

### Pipeline and data lifetime

1. Complete the configured epochs using the existing working state.
2. Read their present geography and assemble connected feature systems.
3. Compose their macro arrangement and compatible terrain/field targets.
4. Fit and sample the finished regional surfaces once, resolving shared
   interfaces and transitions into surrounding geography during generation.
5. Reconcile dependent present-day fields and publish composed vectors, regions
   and numerical fields. Generate existing human geography from the final fields.
6. Release the fitting workspace. Display and queries locate and interpolate
   final field data through the ordinary field reader.

| Retain in the product                                                              | Lifetime / reason                                                                       |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Finished numeric fields, units, quantities, coordinate frames and sampling layout  | Current map display, inspection, edits, inheritance and export                          |
| Composed feature geometry, network connections, needed dimensions and water levels | Actual map features and geographic relationships                                        |
| Stable feature identity and authored/protected state                               | Existing edits, selections and references must survive reshaping                        |
| Current generation configuration and existing history consumed by the product      | Keep the established behavior; add no refinement journal or per-cell lineage            |
| Normal renderer interpolation/tile caches                                          | Existing derived display machinery; disposable rather than another geographic authority |

Old elevations, duplicated pre-fit channels, construction profiles, masks, path
searches, component memberships and operation ordering are worker scratch. Keep
them only until their last fitting/classification/publication consumer finishes.
Do not attach them to published fields or keep copies to explain the result.
Existing authored field overlays retain their editing semantics; they are not
the procedural profile chain being removed.

### Actual structural gaps and affected boundaries

- `macroTerrain.ts` keeps native originals and a projected base while accumulating
  profiles. Some scratch is necessary during construction; it must end there.
- `atlasProjection.ts` publishes both final sampled values and `landscapeBase`.
  `grids.ts` / `landscapeField.ts` then redirect reads to the old base and replay
  profiles. There are two routes to a finished value, with different costs.
- `landscapeProfiles.ts` performs spatial searches, support/exclusion predicates
  and ordered blending per query. Indexing those operations does not remove the
  underlying repeated work.
- `generationJobs.ts` carries that recipe into split layer resources; the
  special inheritance path in `atlasWorkflow.ts` carries it into later runs.
  Replace both with final fields, including partial-domain runs that leave
  physical geography unchanged. Do not coarsen untouched terrain to a new job's
  working grid or repeatedly apply finishing to it.
- `CompletedBoundary.state.surface` and current publication assume one layout
  for all channels. Resolve this boundary using existing field resources so
  narrow terrain detail does not multiply unrelated arrays.
- `numericTiles.ts`, field statistics, contours, water queries, feature inspection
  and exports must use the same final field interface. Keep composed vector
  curves; extracting them again from coarse samples would undo the improvement.
- `generateAtlas` already removes `state.physical` before returning from the
  worker. Preserve that behavior; do not claim the entire native workspace is
  currently published. Remove the recipes/bases that do escape through fields.
  Use ordinary transferable buffers where worker ownership ends, without backup
  snapshots or new recovery behavior.

### Milestones

**R0 — Establish the final field on real mixed geography.** Reuse a saved region
containing a mountain crossing, valley/river junction and shore, with ecological
and magical fields present. Exercise the shared arrangement and screened-Poisson
fit specified below. Select local sampling from feature widths, relief and
world-map use. Materialize the finished terrain through existing adaptive
fields. Check narrow features, continuous patch boundaries, protected areas,
water interfaces and agreement between field reads and composed vectors.
Measure sample count, memory, cold/warm tile sampling and individual queries.
If suitable detail causes excessive topology, arrays or interpolation cost,
report that specific representation failure before converting more families.

**R1 — Complete producer, consumer and publication migration [depends on R0].**
Replace the independent-strip/add-only algorithms with the system composition
specified below for every finishing family. Write final geometry/values through
the selected field boundary. Reconcile slopes, water, bedrock/materials, ecology and configured
magic using the finished geography. Migrate layer splitting, domain-only
regeneration, statistics, contours, renderer, inspection, human generation and
exports. Remove procedural-profile fields, old-base exceptions, duplicate
published arrays and obsolete tests from the domain/runtime contract. Keep
construction helpers generation-local only where they still simplify real work.
No runtime recipe fallback or parallel terrain mode remains.

**R2 — Verify complete behavior and cost [depends on R1].** Check a complete
Draft and Standard world outside the browser, including worker result delivery
and retained memory, then reuse their fields for display and query checks.
Compare with the ordinary field path and the recorded profile implementation;
report any remaining cost rather than inventing runtime caps or quotas. Detail
settings must retain physical sizes. Use focused regressions for algorithms and
shared-field behavior; browser fixtures verify consumption, not epoch simulation.
Complete M5's visual review across all families using these finished worlds.
Structural completion alone does not establish visual composition quality.

Sulion: root `23486bd1-9654-4c3b-a8eb-5c68ed7b4a9c`; this prerequisite is
`8ca38ced-2c1a-4164-b7a4-9c3153413761`, under M5's integrated-review expansion.
Planning step `9e0881f3-d790-4be4-8b40-f8e3c57173a7`; future R0
`df7b96a0-317c-4b39-833b-3d9dd4f024bc`, R1
`61b8db5b-1a5c-4b34-8bc2-99ab52b6c88d`, R2
`2b2c1e5d-fc5f-4b56-bda9-19873e8fe0cb`. Implementation steps remain pending.

## Feature improvements: concrete design gaps

These are gaps in the **finishing implementation**, not a claim that the epoch
generators lack the corresponding physical processes. The existing inventory
below remains the required coverage. Merely baking the present profiles would
make their evaluation cheaper while retaining their weak composition.

| System                                                 | Current gap                                                                                                                                                                                                   | Improvement to design                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Regional structure and character                       | Families act in sequence, with no joint regional arrangement. Local operations can compete or repeat the same motif.                                                                                          | Compose each connected landscape from existing relief, geology, drainage, climate and magic. Establish dominant/secondary forms and shared interfaces before fitting. Derive this context during generation; do not retain another explanatory world model.                                                                  |
| Ranges, ridges, peaks, slopes and foothills            | Peaks are selected mainly by height and spacing, then linked to nearby higher peaks. Raising strips along those links does not compose a range.                                                               | Build a connected crest/spur and valley arrangement from the actual belt. Rank summits by prominence and regional role. Fit flanks, shoulders and foothill transitions as a whole, with rounded/rugged/asymmetric character conditioned on geology.                                                                          |
| Passes, valleys, plains and basins                     | A path can reach its saddle and still look like an isolated cut. Floors use sectional quantiles rather than a connected drainage/valley structure.                                                            | Pair valley systems across divides, share grades at junctions/spills, and fit complete approaches. Compose broad floors, narrows and shoulders together; preserve genuinely closed basins and broad drainage gradients.                                                                                                      |
| River networks, channels, floodplains and deltas       | Dominant-stem relaxation and per-reach noise help locally. Collision repair can restore mesh routes; valley fitting remains per reach. Delta fitting is a generic floor adjustment.                           | Compose trunk and tributary hierarchy, spacing, junction angles and longitudinal grades across catchments. Integrate variable valley confinement and alluvial floors. Design mouth/lobe structure from sediment and receiving water; do not invent an extra distributary simulation where the generator supplies no network. |
| Gorges, waterfalls and rapids                          | Narrow channel fits and concentrated existing drops do not compose walls, entrances, lips, plunge/toe transitions or connections to broad valleys.                                                            | Shape these as stretches of the same valley system, using inherited knickpoints and confinement. Fit adjoining terrain as well as the channel. No independently placed waterfall event or backlogged landmark injection.                                                                                                     |
| Craters, volcanic complexes, lava and ejecta           | Surviving rim arcs and a cone bump leave bowls, aprons, flank drainage and overlapping structures weakly integrated. Generic lava/ejecta axes do not produce coherent lobes.                                  | Fit a surviving complex: deformed bowl/cone, incomplete rim/caldera, breaches, apron/lobes and surrounding drainage. Enhance readable present relief without resurrecting erased events or requiring every historical event to be visually dramatic.                                                                         |
| Faults, sutures, rifts, geothermal and plume regions   | Moving a trace and replacing nearby height does not distinguish a scarp, linear valley, paired rift shoulders or buried/submarine boundary.                                                                   | Give connected structures their appropriate regional terrain/material expression; coordinate crossings, shoulders, vents and sources with adjacent drainage and relief.                                                                                                                                                      |
| Coasts, islands, lakes, shelves, trenches and currents | Shore corner rounding and generic axial fitting preserve little regional coastal character. A single sectional axis is weak for curved margins and island groups.                                             | Compose along connected shore/margin structures, with physical cross sections and transitions. Coordinate bays, headlands, cliffs, depositional shores, straits, lake inlets/spills and shelf/slope/trench bands. Maintain water connections while changing shape.                                                           |
| Glacial troughs, cirques, fjords, moraines and outwash | Each classified region receives a quantile floor fit; ice masks are closed and thickness redistributed. This does not compose a connected glacial system.                                                     | Connect troughs, branches, headwalls, hanging approaches, sills and former ice-margin deposits. Fit ice tongues/fronts and grounding to the same relief, retaining separate snowfields and meaningful open-water passages.                                                                                                   |
| Reefs and regional holes                               | `reconstructRegion` preserves every original positive cell and adds cells. It cannot remove debris or relocate a body. A hole's area is insufficient to identify a useful lagoon/channel.                     | Compose bodies along suitable shelf/coast structure, allowing contraction and redistribution as well as joins. Retain water connections and purposeful lagoons/passages; fit substrate and suitability with the resulting bodies.                                                                                            |
| Biomes, woodland, open country and wetlands            | Repeated threshold closing/exchange is not a forest/open-country design. It offers little edge hierarchy or wetland-chain structure; sparse initial woodland limits visible results.                          | Compose cores, secondary groves, ecotones, clearings and disturbance mosaics within actual habitat. Align wetland chains with final lowlands/water. Move communities, cohorts and relevant resources together without an extra growth epoch.                                                                                 |
| Fauna, aquatic habitat and organic resources           | Redistributing density inside a reachable region preserves support but does not establish coherent habitat cores and connections. Resource history should not dictate the visual design.                      | Shape habitat density from the composed cover/water systems and actual barriers. Keep appropriate resources with soil/sediment context. Do not manufacture historical tracks, extra births, burial or maturation.                                                                                                            |
| Configurable magic and altered ecology                 | Source growth, axial corridors and closing are generic; fronts and interactions currently share essentially the same closing operation. Intensities can change without a distinct macro landscape expression. | Design sources, branching corridors, regions, actual interaction boundaries and gradients as different spatial behaviors. Couple only configured heat/material/ice/ecological effects to final geography. Preserve inherited altered communities without expanding retained trace/provenance data.                           |

Two common deficiencies cut across the table: closing is mostly **add-only**,
and fitting is mostly **independent strips or sectional targets**. More smoothing,
more noise or finer sampling does not supply the missing system-level decisions.
Equally, do not turn every field label into a new feature generator: some classes
are derived conditions on the finished landscape.

## Feature design: compose systems, then fit their shared landscape

The following is the recommended design, replacing the independent-strip and
add-only-mask mechanisms above. It is an agent design proposal within the user's
stated outcome, not a claim that these algorithms are already implemented or
their performance established. It makes the decisions needed for implementation;
it does not require another requirements interview or a separate design phase.

### 1. Compose a connected arrangement before changing height

Construct temporary graphs from the final epoch: ridges and saddles, drainage
and receiving waters, shore and shelf boundaries, surviving geological complexes,
ice systems, habitat and configured magical structures. Use existing causal
fields to identify their support. Simplify incidental mesh corners while keeping
real junctions, outlets, barriers and surviving feature identities. A global PCA
axis is not the representation for curved or branching systems.

The graphs share interfaces. A pass belongs to a divide and two valley approaches;
a river mouth belongs to a river and a receiving shore; a breached crater belongs
to a surviving rim and its drainage. These are single shared positions/heights,
not separate approximations subsequently smoothed together. Authored protections
are fixed constraints. Ordinary generated vertices can move within their causal
landscape; their original cell coordinates are not fixed anchors.

Process connected regions with an overlap wide enough to contain their flanks
and transitions. Watershed outlets, crest continuations and shores crossing a
region boundary are agreed before fitting either side. Regions are work units,
not visible rectangular partitions or new persistent domain objects.

Choose hierarchy from the generated geography: dominant crest and secondary
spurs, trunk valleys and tributaries, headlands and embayments, habitat cores and
edges. Derive dimensions from existing physical widths, drainage area, relief,
rock resistance, sediment, ice and configured magic. Low-frequency seeded
variation can vary those dimensions and asymmetry; it does not supply the
structure by adding independent noise to every feature. Interesting geography
comes from contrasting broad/narrow, high/low and dominant/subordinate forms,
not from making every historical event a dramatic landmark.

### 2. Resolve overlaps as geography, not drawing order

Resolve the meaning of each intersection before producing height targets:

- A river crosses a ridge through its inherited breach or valley; move the
  crest around that opening and share the channel grade. Do not raise the crest
  through the river and subsequently cut a second independent strip.
- A pass connects two actual valley approaches through a shared saddle. A gorge
  is a confined section of that valley. A fjord is a drowned glacial trough.
  Their floors and connections come from one system, with different sections.
- A surviving volcanic or impact complex reshapes its interior and flanks while
  sharing existing breaches and outlets with drainage. Do not seal a real outlet
  by completing a decorative ring or recover an erased crater from its history.
- Sea/lake level, river endpoints and substrate agree. Keep true closed basins;
  do not connect every depression to the ocean. Keep important straits, lagoon
  entrances and habitat corridors by connectivity, not hole area alone.
- Magic proposes only effects declared by its configuration. An already-melted
  ice boundary constrains the glacial composition; a configured material effect
  constrains rock/soil targets. Neither repeats the epoch's forcing afterward.

At a conflicting protected interface, adapt the generated form around it. If two
generated targets disagree, revise their shared junction or geometry before the
fit. Do not hide a contradictory river/crest arrangement by averaging heights.

### 3. Fit one terrain adjustment during generation

The concrete fitting recommendation is a regional screened-Poisson adjustment
on the final sampling layout. This is a height-fitting operation, not erosion,
another epoch, or a general-purpose simulation framework.

Each composed system supplies target heights and cross-slope differences over
its full footprint: valley floor, walls and shoulders; ridge, flanks and
foothills; crater bowl, rim and apron. Those targets describe the arranged
landform, rather than taking a quantile from each old cross section. Shared
interfaces have already been resolved. Outside the changed region, adjustment
is zero; the transition collar preserves surrounding relief.

For height adjustment `d`, minimize the sparse quadratic
`sum(a_i * (d_i - t_i)^2) + sum(b_ij * (d_j - d_i - g_ij)^2)`.
Here `t` is the target adjustment and `g` its desired difference between adjacent
samples. In unchanged terrain, `t` and `g` are zero, preserving the existing
landscape. Weights account for sample spacing and footprint support. Fix authored
anchors and agreed interface heights; set downstream channel grades before this
two-dimensional fit. Along cliffs, gorge walls and waterfall lips, use their
explicit cross-section targets rather than a smoothing penalty across the drop.
Represent the drop over a finite physical distance, not a mathematical jump.

Solve locally with preconditioned conjugate gradients, initialized coarse to
fine through the existing sampling hierarchy. Keep matrices implicit over
neighbor links. This method is a recommendation for the concrete need to fit
shared targets continuously; do not build a reusable solver platform around it.
Stop numerical convergence at the useful height/width precision of the output,
not floating-point equivalence. Validate the reconstructed field, not just sample
values: beds remain below water, grades descend, shores meet levels, and narrow
forms survive interpolation. Add local support where a real feature requires it.

R0 must exercise this fit together with actual adaptive sampling and field reads.
If fit convergence, required density or interpolation preparation dominates the
mixed region, report the measured failure before migrating more producers. Do
not spend hours improving an unsuitable numerical mechanism or silently replace
the required composition with a cheaper smoothing pass.

### 4. Algorithms and visible outcomes for every family

**Ranges, peaks, foothills and passes.** Use descending-height component merges
to estimate summit prominence and identify the saddles joining summits. Combine
that hierarchy with the existing tectonic/ridge support to select the main crest
and subordinate spurs; remove redundant short twigs without disconnecting real
divides. Compose crest curves and adjacent valley curves together. Give the
range a relief envelope, with a few dominant peaks, subordinate summits and
geology-conditioned flank asymmetry. Fit complete flank sections into foothills,
retaining supported roughness instead of creating equally high parallel ribs.
Pair valley heads across an actual saddle for each retained pass; its approach
curves join those valleys and its floor rises to the saddle then descends.
The result should read as a range with routes through it, not raised lines with
unrelated cuts.

**River networks and alluvial landscapes.** Retain the drainage graph and real
terminal lakes/ocean connections. Decompose into dominant stems by contributing
area. Compose trunks before tributaries using constrained spline fairing: penalize
abrupt curvature, favor the inherited broad valley corridor, and constrain
confluences and clearance from neighboring branches. Make bend wavelength depend
on channel/valley dimensions and confinement; broad alluvial reaches can bend,
confined reaches follow the valley. A tributary joins a trunk with a compatible
tangent rather than independently displacing its endpoint. Resolve collisions
inside the permitted macro corridor, including local graph routing if necessary;
do not restore the entire mesh polyline as the default repair. Preserve drainage
connectivity and divide membership.

Fit a monotone longitudinal bed with shared junction elevations using weighted
isotonic regression of inherited grades, keeping real terminal levels and
knickpoints. Compose broad valley floors, narrows, asymmetric banks, terraces and
floodplain transitions around that network. Use sediment-supported delta extent
to compose a mouth apron and lobe outline tied to receiving water; use existing
distributaries if supplied, without inventing a new distributary simulator.
Plains and basins share their outlets and broad floor gradients with this system;
closed basins retain their spill threshold and closure.

**Gorges, waterfalls and rapids.** Detect their stretches from inherited slope,
resistant-rock boundaries and confinement, preserving the causal generation.
Within the same valley arrangement, narrow the gorge floor, fit walls and rim
shoulders, and transition to the upstream/downstream valley. Concentrate an
existing knickpoint's drop at its supported lip, with a short steep reach and
toe transition; distribute gentler supported drops into rapids. Fit the adjoining
walls and downstream bed. Do not insert a waterfall event, extra erosion epoch
or arbitrary plunge-pool landmark because a feature was mentioned in discussion.

**Impacts, volcanoes, lava and ejecta.** For each surviving complex, sample its
present radial relief by angular sectors and fit a low-frequency irregular
outline. Compose supported bowl/cone, partial rim/caldera, flanks and apron as
one relief target; retain breaches shared with drainage. Use existing resistance,
erosion and overlapping-event support to vary sectors instead of restoring a
perfect circle. Form lava/ejecta lobes from their connected existing footprints
and source-to-margin paths, splitting at existing obstacles and following relief.
Taper lobe thickness into surrounding ground. A drowned or mostly erased remnant
can remain subtle; event history alone does not authorize a new mountain.

**Faults, sutures, rifts and geothermal structures.** Simplify connected traces
without moving their junctions independently. Classify their current expression
from displacement, strain and relief: scarp, linear valley, paired rift shoulders,
or primarily material/submarine structure. Fit the corresponding asymmetric
cross sections and transition at segment junctions. Share river crossings with
drainage and vents with their actual heat/source support. Do not make every
boundary a raised ridge or give a buried suture an invented surface scar.

**Coasts, islands, lakes and marine relief.** Compose connected shore curves
with constrained spline fairing and signed-distance bands. Preserve river-mouth
anchors and functional strait/inlet connections; allow unsupported tiny fragments
and accidental holes to contract as well as expand. Derive regional section
types from relief, exposure, sediment and substrate: cliff/headland, embayment,
depositional shore, lake basin and island group. Fit coast-normal sections, with
shared transitions, rather than applying uniform corner rounding. Follow curved
continental margins for shelf, slope and trench targets, including their ends
and island interruptions. Reconcile existing current corridors to the final
connected ocean and bathymetry; retain their broad transport direction without
adding a new circulation simulation. No seabed feature is treated as dry relief.

**Glacial systems.** Link classified cirques and tributary troughs to main troughs
and receiving fjords/outwash. Compose U-shaped sections, headwalls, tributary
hanging heights, supported sills and moraine arcs from the inherited ice system.
Margins follow that system rather than a PCA axis. Fit present ice tongues and
grounding to the resulting bed; redistribute existing ice within supported cold
terrain and preserve separate snowfields and open-water routes. No new advance,
retreat or melt epoch is simulated during finishing.

**Reefs.** Extract branches along suitable shelf/depth bands, join nearby bodies
through supported substrate, and remove unsupported thin debris. Use a
connectivity graph for lagoon entrances and open-water passages; constrain those
connections while regularizing the reef boundary with a signed-distance field.
Fill incidental enclosed holes, retain real lagoons, and permit contraction or
relocation instead of permanently preserving every original positive cell.
Move reef cover with its shallow substrate target and recheck temperature, ice,
depth and water support. The result should read as reef bodies with meaningful
openings, rather than a perforated threshold mask.

**Biomes, forest, open country, wetland and disturbance.** Build a suitability
field from final relief, water, climate and actual communities. Select connected
cores from existing supported cover, connect nearby cores where suitable, then
regularize boundaries by minimizing disagreement with suitability plus boundary
length at the configured physical scale. Keep water, rock, major elevation
changes and supported disturbance gaps as boundary constraints. This permits
both removal and addition. Assign broad biome transitions from the same support,
with coherent ecotones; forests have cores, groves and edges rather than uniform
closing. Compose wetlands along connected lowlands, lake margins and floodplains.
Fire, damage, recovery and persistent altered ecology follow their existing
disturbance/source structures, not a fresh independent noisy outline.

Remap communities, cohorts, canopy, soil and relevant resources together through
local donor/receiver transfers. Conserve existing living stocks over the affected
suitable system; retain supported age variation. Restrict transfers by habitat
and reachability, keeping any genuine habitat-loss handling explicit. Do not
create a mature forest, new growth, burial or resource maturation to strengthen
a picture. Scarce initial woodland may remain scarce, but should form readable
patches instead of incoherent speckle.

**Fauna, aquatic habitat and organic resources.** Derive habitat cores from the
composed vegetation/water systems. Connect cores through least-cost suitable
corridors, respecting sea/land separation, cliffs and existing aquatic routes.
Redistribute existing density by accessibility, food and prey support so cores
and connections are represented in the actual field. Keep aggregation at the
map's ecological scale; do not invent animal tracks or extra births. Move soil
and sediment-bound resources with the relevant terrain/cover remapping while
leaving genuine historical deposits in their supported context.

**Configurable magic and altered ecology.** Keep all presets on the same
configured roles and effects. A source uses connected local maxima and an
anisotropic distance falloff within supported substrate. A corridor uses a
branching graph between existing source/transport concentrations, with widths
and intensity shared at junctions. A region uses supported cores and boundary
regularization that can contract as well as join. A front is a contour/band of
the configured effect or opposing-field balance, followed along its boundary;
it is not a closed blob grown from the same mask as a region. An interaction
uses actual overlap or opposing gradients of its configured participants, not
generic dilation. These roles share physical dimensions across detail settings.

Compose the associated intensity, stored quantities, material, heat/ice and
ecological expression together using only declared effects. Magic's terrain and
substrate proposals participate before terrain fitting. Reconcile support after
the fit and remap existing quantities; do not apply their epoch forcing again.
Persistent altered communities can outlive the current source. A preset's visual
difference must result from its configured geography/effects, without preset-name
branches or a separately retained explanatory trace.

### 5. Complete execution order and evidence

1. Retain the complete epoch output as input; identify and simplify the connected
   systems and shared interfaces once. Cache searches only while consumers need
   them.
2. Compose major relief and geological complexes jointly with drainage, coast
   and glacial systems. Compose configured magical terrain/material effects at
   this point. Resolve interface conflicts, then fit and sample the shared terrain.
3. Reconcile water, slope, substrate and material fields. Compose reefs, biological
   cover and magical ecological expression on that finished support; place habitat
   density and resources using those systems. Field quantities and polygons come
   from the same composed arrangement.
4. Publish finished field resources and feature geometry, run existing human
   generation against them, and discard graphs, fit targets, old bases and masks.
   A pixel/query reads a field; it does not revisit this procedure.

R0 proves the shared fit and publication on a saved mixed region, including
mountain/valley/shore interfaces, biology and magic. R1 replaces the old mechanisms
for **all** families above and all consumers; the mixed region is not a reduced
product milestone. R2 includes whole-world visual review and cost, not merely a
passing test suite. Earlier M0–M4 code completion does not waive this coverage.

Use fast direct fixtures for branched ranges with real passes, a catchment with
confluences and a knickpoint, a breached crater, curved coast/strait, connected
glacial troughs, a reef with a true lagoon entrance, a constrained cover mosaic,
and each configured magic role. Assert actual connectivity, field/geometry
agreement and quantity behavior. Reuse completed world fields for before/after
views at world and regional scales. Check whether hierarchy and connections are
legible, whether surrounding terrain supports them, and whether families retain
distinct forms. Passing topology checks does not prove those visual outcomes.
Run complete generation only at integration points where epochs/publication or
overall cost need checking, not for each curve or boundary change.

The unresolved implementation risks are adaptive output density, fit convergence,
reconstruction of narrow/steep forms, and support conflicts between families.
These are specific R0 measurements and integration checks, not missing user
requirements. If one invalidates the recommendation, name the failure and propose
the smallest replacement while preserving the complete composition outcome.

## Current implementation and reuse

Reviewed source bodies establish the following boundaries:

| Source                                                                                                                                                                                  | Existing behavior and intended reuse                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/generation/src/canonry/atlasSequence.ts`, `sequence.ts`, `schedule.ts`                                                                                                        | Configured physical epochs and present-day extraction order. Retain the epoch processes; insert finishing before publication and human generation.                                         |
| `atlasProcesses.ts`, `atlasSampling.ts`, `physicalMetric.ts`                                                                                                                            | Physical process adapters, field projection and continuous sampling of the working mesh. Extend this boundary rather than adding a renderer-only terrain.                                  |
| `orogeny.ts`, `orogenicComponents.ts`, `orogenicShape.ts`                                                                                                                               | Connected tectonic belts, physical cross sections, strain, construction and inherited influence. These supply range structure.                                                             |
| `impacts.ts`, `volcanism.ts`, `continentalMargins.ts`, `massWasting.ts`, `hillslopeFlux.ts`                                                                                             | Actual terrain construction, excavation, deposition, margin evolution and slope relaxation during epochs. Reuse their causes and material constraints.                                     |
| `fluvial.ts`, `channelGeometry.ts`, `floodplains.ts`, `deltas.ts`, `riverPaths.ts`                                                                                                      | Causal erosion and transport; present-day channel dimensions and masks; connected vector paths. Final channel/floodplain/delta classification currently does not reshape elevation.        |
| `glacialEvolution.ts`, `glacialLandforms.ts`, `coastalEvolution.ts`, `seaIce.ts`                                                                                                        | Ice erosion/deposition and coastal change occur during epochs. Final glacial labels and ice classes are not a general terrain fitting operation.                                           |
| `landforms.ts`, `naturalSurface.ts`, `physicalMaterial.ts`                                                                                                                              | Existing landform, surface and material vocabularies. Preserve their meaning while deriving their extents from the finished field.                                                         |
| `geologicalFeatures.ts`, `geographicRegions.ts`, `geographicContours.ts`, `atlasFeatures.ts`                                                                                            | Named features, contouring and publication. Craters/volcanoes currently publish event-radius disks; calderas use a fixed radius fraction. Magic places are connected-component polygons.   |
| `packages/domain/src/magicSystems.ts`, `magicPresets.ts`; generation `magicSources.ts`, `magicPropagation.ts`, `magicBeams.ts`, `magicOcean.ts`, `magicFeedback.ts`, `magicFeatures.ts` | Shared configurable systems; source/propagation/history fields; thermal, ice, resistance and coastal feedback; hysteretic feature masks. Extend these contracts, not preset-name dispatch. |
| `packages/generation/src/mapPeople.ts`, `mapBuilt.ts`                                                                                                                                   | Existing cultural origins, culture fields, political extents, settlements and roads. Generate these downstream from finalized physical geography.                                          |

Paths without a directory in the table are under
`packages/generation/src/canonry/`. The product authority is
[the product specification](product-spec.md), particularly sections 10–11 and 15,
and [generation workflows](generation-workflows.md). This inventory describes
current outputs, including field-only features, rather than assuming every
English name denotes a separate terrain generator.

Before this implementation there was no common final shaping pass. Epochs do real physical work;
the end largely recomputes fields, classifies, extracts, projects and validates.
Recent shoreline fixes align river endpoints and water footprints, but do not
fit an entire channel bed, mountain range or surviving crater to continuous
terrain.

### Biological source and integration boundary

The biological inventory below was checked against revision `2e2d763` in the
existing ecology worktree
`/home/sulion/workspaces/vellum-and-vector/05f468c8-96e8-4cd6-b716-724e8475911b`.
Those changes landed on `main` as `64774d6` before refinement implementation,
as explicitly requested. Implementation uses the landed contracts.

Reviewed source bodies: `docs/ECOLOGY-PLAN.md`,
`packages/domain/src/ecology.ts`, `geographySurfaces.ts`, `magicSystems.ts`, and
generation `ecologyState.ts`, `ecologyFeatures.ts`, `ecologyProcesses.ts`,
`ecologyEnvironment.ts`, `ecologyGroups.ts`, `ecologyVegetation.ts`,
`ecologyMovement.ts`, `ecologyAnimals.ts`, `ecologyMagic.ts` and `ecologyCarbon.ts`.
They establish the functional-group, publication, movement and inherited-state
contracts used below. Finishing reuses them without changing the ecological
epoch model or introducing individual species.

## Mechanism: compose feature systems, then fit the landscape

The recommended mechanism is hierarchical graph deformation for networks,
regional shape operations for areas, and terrain/field fitting to the composed
result. This is a procedural finishing model, not a claim that the epochs
physically simulated every final bend or enhanced summit.

1. **Read the scene at several physical scales.** Group cells and extracted
   objects into ranges, valley systems, catchments, volcanic complexes, coast
   segments, ice systems, reef bodies, biome mosaics, habitat and magic regions.
   Retain causes and identities. Sampling edges do not define their shapes.
2. **Compose broad structure first.** Adjust principal axes, junctions, region
   extents and feature hierarchy at world/region scale before adding smaller
   bends, spurs or boundary variation. Coastlines and major divides are strong
   geographic context; intermediate path coordinates are soft inputs.
3. **Improve the complete arrangement.** Connect intended corridors, repair
   fragmentation, establish dominant and secondary forms, and introduce
   geographically conditioned variation. Coordinate adjacent feature systems
   so a raised summit does not block the pass being composed beside it.
4. **Fit terrain and values to that arrangement.** Change elevation, valley
   floors, shoulders, reef substrate, material extents, water, ice support and
   ecological fields together as appropriate. The influence must extend far enough to integrate
   the feature, rather than cutting a narrow decorative trench across unrelated
   terrain. Physical dimensions and landscape character supply scale and style,
   rather than freezing the existing local samples.
5. **Reconcile dependent geography and publish.** Update drainage geometry,
   water levels/depths, slopes, materials, ice support and feature classes as
   affected. Queries, contours, display inputs and exports describe the same
   final world. Generate existing human outputs afterward.

Connectivity is an intended property of a feature system, not a demand that every
region become one blob. Reefs can contain lagoons and tidal passages; ranges can
contain isolated massifs; a basin can be closed. Distinguish useful openings and
independent bodies from sampling debris before joining or filling them.

### What makes the composition interesting

Use hierarchy, contrast, connected structure and variation: dominant summits
among lesser peaks, broad valleys opening into narrows, occasional strong river
bends among straighter reaches, reef chains with deliberate openings, and magic
regions with readable cores, corridors and fronts; forest cores opening into
woodland and clearings; and wetland chains following lowlands. Condition these
decisions on regional geology, relief, discharge, deposits, climate, ecological
history, coast and configured magic.

Do not apply the same motif everywhere, maximize every peak, make every river
sinuous, connect every island, or fill every hole. No feature quotas or single
scalar beauty score. The intended arrangement and before/after macro views must
justify the transformations. Finishing can add compositional variation without
inventing another geological event or replaying history.

### Algorithm roles

- **Networks:** simplify to meaningful trunks, branches and junctions; use
  hierarchical constrained graph relaxation to reposition them, then synthesize
  multiscale correlated displacement along their curves. Penalize accidental
  crossings, abrupt joins, crowding and incompatible terrain displacement.
  Splines represent the composed geometry; smoothing alone does not supply its
  composition.
- **Regions:** use connected-component analysis, distance transforms, morphology
  with kernels measured in metres, and geodesic reconstruction. Connect suitable
  nearby components along low-cost corridors; close accidental gaps and fill
  unintended holes. Protect meaningful openings and reject bridges across
  incompatible depth, coast, ice or material boundaries.
- **Relief:** fit crest, valley, floor, rim and shoulder profiles around composed
  axes and regions. Use smooth regional deformation with physical support
  extents; deliberately change heights and positions where the composition
  benefits. At shared controls, fit compatible heights and gradients before
  constructing the surface. Preserve intentional steep edges and falls.

These are proposed algorithm combinations, not established implementation
results. Physical scales and deformation strengths need representative examples.
Do not hide that judgment behind a general-purpose solver or arbitrary metric.

### Terrain authority, dependencies and history

Keep one final geography shared by publication, field reads, contour extraction,
rendering and export. The earlier evolved-base-plus-runtime-profiles proposal
failed integrated cost review and is superseded by Structural repair above.
Procedural targets may be generation scratch; they are not published terrain.

Deformations may change peak heights, saddle grades, valley floors, shorelines
and region values. They must join surrounding terrain and reconcile
bedrock/material interfaces, water levels/depths and ice support. Avoid a global
fine grid, a general solver framework or a renderer-only alternative terrain.

Plan interacting structures before fitting: ranges, passes and adjacent valleys;
rivers and lake/coast connections; reefs and lagoons; magic regions and affected
ice/coast; forests, open habitat and wetlands. One family cannot blindly overwrite another. Recompute affected
present-day derivatives with existing process contracts; whole coarse-field
recomputation is acceptable when simpler than elaborate local invalidation. Do
not replay epochs or run until the world converges.

Retain the causal structure needed for finishing until publication: belts and
faults, event context, network connectivity, ice/deposit context and magic
sources/history. Keep only useful compact in-memory data, not persistent
intermediate jobs or complete per-cell histories.

Keep completed epoch history. Record finishing as a present-day procedural
transformation through the existing causal mechanism, rather than claiming an
enhanced summit came from a newly simulated eruption. No additional persistence,
recovery framework or history UI is required.

## Physical feature algorithms

Every row contributes to the complete outcome; related rows can share operations.
Dimensions and variation scales are physical metres, not sample counts.

| Feature system                                    | Macro finishing algorithm and intended result                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mountain ranges and ridges                        | Build crest/spur and adjoining valley graphs from the connected belt. Relax their arrangement together, strengthening the main spine, varying secondary branches and removing accidental serration. Fit asymmetric flanks over a regional footprint. Produce recognizable range structure rather than equal peaks in a row.                                                                                      |
| Peaks                                             | Rank summit groups by prominence and regional role. Select spatially varied dominant summits, optionally raise them and strengthen their shoulders; retain lesser and worn summits. Blend adjustments through the range so peaks do not become isolated spikes.                                                                                                                                                  |
| Passes                                            | Pair appropriate valley approaches across the crest graph. Use minimax-elevation/least-cost path search to select a crossing, then fit a saddle and grade-constrained approaches on both sides. Verify a continuous terrain corridor through the range, not just a point labeled pass. Coordinate neighboring peak/ridge changes around it.                                                                      |
| Slopes and hills                                  | Compose shoulders, spurs and toes between crest and valley structures; use profile deformation and slope relaxation to fill out their forms. Maintain regional contrasts between rounded and rugged relief.                                                                                                                                                                                                      |
| Plains                                            | Form coherent low-relief regions with broad drainage gradients and transitions into foothills; remove accidental bumps and pits without turning every plain into a level sheet.                                                                                                                                                                                                                                  |
| Valleys                                           | Compose the valley graph alongside its rivers and passes. Broaden selected floors, shape narrows and shoulders, and connect tributary approaches. Modify terrain to fit the system rather than preserving each original cell-centre route.                                                                                                                                                                       |
| Basins                                            | Compose a coherent floor, surrounding relief and spill control. Repair accidental internal fragmentation while preserving genuine closed basins and existing water-budget semantics.                                                                                                                                                                                                                             |
| Faults, sutures and tectonic boundaries           | Relax causal line networks while retaining junctions and regional direction. Strengthen coherent scarp or linear-valley expression where appropriate; distinguish buried/submarine contacts from exposed land relief.                                                                                                                                                                                            |
| Rift valleys                                      | Compose paired shoulders and an axial valley as a regional structure, coordinating cross-drainage, lakes and later erosion. Avoid disconnected strings of depressions.                                                                                                                                                                                                                                           |
| Crater basins, rims and ejecta                    | Use event identity and surviving relief to compose a deformed bowl, incomplete rim arcs and apron. Fit low-frequency asymmetric rim variation and integrate breaches, rivers, deposits and overlapping structures. Enhance readable remnants without restoring erased events into pristine circles.                                                                                                              |
| Volcanoes and calderas                            | Compose complexes as dominant cones/shoulders, subsidiary forms, calderas and flank valleys. Adjust radial-sector profiles and depression geometry for coherent silhouettes, preserving asymmetry, erosion and water connections.                                                                                                                                                                                |
| Lava plains and basalt aprons                     | Join suitable material patches into coherent lobes/aprons with irregular toes and terrain-controlled openings. Fit terrain and material contacts together, retaining volcanic regional context.                                                                                                                                                                                                                  |
| Mantle plumes and geothermal vents                | Compose source clusters and influence regions around existing sources. Use regional prominence and spacing to distinguish primary centres and lesser vents; align thermal/material footprints with the finished landscape.                                                                                                                                                                                       |
| River networks and confluences                    | Preserve directed connectivity and discharge while deforming main courses, junction positions and tributaries hierarchically. Use multiscale correlated bend synthesis and network-wide relaxation for varied branching, reducing mesh directions, crowded parallel lines and awkward joins. Major divides and receiving waters constrain the arrangement. No migration or cutoff simulation is added to epochs. |
| Channel bed, banks and width                      | Fit shared junction/outlet elevations with constrained downstream profiles, monotone cubic interpolation and explicit supported drops. Sweep variable cross sections along composed paths and reshape adjoining valleys. Preserve discharge-based physical dimensions.                                                                                                                                           |
| Floodplains                                       | Compose connected valley-floor regions around the finished network. Repair fragmentation, vary confinement/width, and fit graded alluvial surfaces and transitions to higher ground.                                                                                                                                                                                                                             |
| Deltas                                            | Compose connected depositional lobes and supported distributary arrangements from mouth, discharge, sediment and receiving-water context. Shape shallow terrain and passages together; avoid disconnected fans of parallel strokes.                                                                                                                                                                              |
| Lakes and spillways                               | Compose coherent basin/shore shapes and islands, retaining meaningful inlets, straits and spillways. Fit floors/shores, then derive water extent and depth from consistent levels and connectivity.                                                                                                                                                                                                              |
| Gorges                                            | Compose confined stretches within the valley network, with deliberate entrances, exits and changes in wall relief. Fit floors and walls into adjoining broad valleys.                                                                                                                                                                                                                                            |
| Waterfalls and rapids                             | Strengthen appropriate existing knickpoint structures into coherent lip/drop/toe transitions, coordinated with channel, gorge and surrounding relief. Distinguish localized falls from extended rapids. No independently placed landmark waterfall or new causal event.                                                                                                                                          |
| Glacial U-valleys and cirques                     | Compose connected troughs, tributary junctions and headwall bowls using inherited ice context. Shape shoulders, hanging valley approaches and outlet lips while integrating later river cuts.                                                                                                                                                                                                                    |
| Fjords                                            | Compose connected drowned troughs and branches, coordinating steep sides, mouths, islands and supported sills with water and land geometry.                                                                                                                                                                                                                                                                      |
| Moraines and outwash plains                       | Connect till ridges and outwash aprons into readable former-margin systems with meaningful drainage breaches. Shape deposits and adjoining terrain together rather than publishing scattered cells.                                                                                                                                                                                                              |
| Glaciers and snowfields                           | Compose contiguous ice bodies, tongues and upper accumulation areas over finished relief; retain appropriate separate snow patches. Adjust thickness/support and margins consistently with existing climate and ice context.                                                                                                                                                                                     |
| Ice shelves and grounding lines                   | Repair fragmented shelf bodies and fit coherent fronts/grounding transitions over the composed coast/seabed. Preserve supported inlets and openings.                                                                                                                                                                                                                                                             |
| Sea ice, pack ice, permanent margins and polynyas | Region reconstruction removes accidental speckling and holes while retaining meaningful open water, thermal openings and ice passages. Reconcile temperature, water and ice fields with the composition.                                                                                                                                                                                                         |
| Coastlines, islands and exposed shelves           | Compose coast segments and island groups with multiscale boundary deformation and topology-aware region operations. Preserve important mouths/straits; adjust coastal terrain so the water-level contour matches the composed shore.                                                                                                                                                                             |
| Coastal cliffs and depositional shores            | Compose stretches of cliff, embayment and low depositional shore from regional exposure/material context. Fit transitions along the coast rather than alternating classes at every sample.                                                                                                                                                                                                                       |
| Continental shelves, slopes, rises and seabed     | Compose broad bathymetric profiles by margin type, coordinating coast, submerged structural relief and deposits. Remove accidental fragmented bands while retaining regional variation.                                                                                                                                                                                                                          |
| Ocean trenches                                    | Relax convergent-margin axes into coherent long structures; strengthen and vary asymmetric seabed cross sections without introducing unrelated trenches.                                                                                                                                                                                                                                                         |
| Current channels                                  | Reconstruct coherent current corridors and intensity fields around final bathymetry; remove isolated category fragments. This shapes a flow field rather than implying new seabed-erosion physics.                                                                                                                                                                                                               |
| Reefs                                             | Group suitable patches into coastal bodies/chains. Apply metre-scale closing and geodesic reconstruction to bridge suitable gaps, fill accidental holes and suppress debris. Preserve lagoons, navigable openings and depth barriers. Fit shallow substrate, material and suitability extents where needed so geometry and depths agree. No coral-growth simulation is required.                                 |

### Complete classification coverage

The table covers all 17 current landform codes: Plain, Slope, Valley, Basin,
Ridge, Peak, Pass, Seabed, UValley, Cirque, Fjord, Moraine, OutwashPlain,
ImpactBasin, ImpactRim, Gorge and Waterfall.

The main-checkout baseline has 28 natural surface names: Tundra, Open field, Ridge, Glacier, Moraine,
Lake, Fjord, Exposed shelf, Shelf, Ocean, Reef, Pack ice, Sea ice, Ice shelf,
Polynya, Snowfield, Polar barrens, Wet tundra, Cold steppe, Scree field,
River valley, River channel, Floodplain, Delta, Gorge, Waterfall, Current channel
and Trench. Climate surfaces are reclassified from final climate/water/ice and
material fields; they do not each require a terrain sculptor. Scree follows
slope failure and deposition rather than a painted steepness mask alone.

The 12 material labels are Exposed bedrock, Scree, Permafrost, Tundra soil,
Snowpack, Glacial ice, Shelf sediment, Deep marine sediment, Reef stone,
Geothermal crust, Moraine till and Basalt. Reconcile their contacts, thickness
and exposure with final erosion, deposition, heat and ice. A label such as Reef
stone does not establish that a biological growth process exists.

The reviewed ecology work adds 12 surface names: Grassland, Savanna, Woodland,
Temperate forest, Boreal forest, Rainforest, Marsh, Swamp, Desert, Barren,
Altered woodland and Altered wetland, for 40 combined surface names. Its separate
17-class biome vocabulary and numerical communities receive their own finishing
treatment below; a plain remains a relief class and can support forest cover.

The 11 physical flags are GeothermalVent, PermanentSeaIce, PermanentIceMargin,
FireCore, MagmaChamber, DeadGodLocus, MantlePlume, ImpactCenter, VolcanicCone,
VolcanicCaldera and LavaPlain. All have treatment above or below, with one
exception: `DeadGodLocus` is declared but no producer was found in the current
generation source. The active pressure source/locus uses the magic fields.
Do not add a second dead-god generator to make a legacy flag meaningful.

Current named natural vectors are river, lake, crater, volcano, caldera, fault,
peak, cirque, fjord, moraine, waterfall and gorge. Other features currently live
only in fields. Finalization must handle them too; naming every connected plain
or ice patch is not required.

## Magic: compose the same macro structures

Apply source/branch hierarchy, coherent regions, fronts and meaningful openings
to every existing magic rule. Use shared configurable geometry roles and scales,
not dispatch on preset names. Existing sources and history guide the composition;
individual threshold-mask boundaries may move. Update affected intensity,
feature, thermal/material/ice fields together rather than painting a new outline
over old values. Preserve disabled-system behavior and independent cross-system
interactions.

| Existing rule                              | Macro composition and field reconciliation                                                                                                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fire:core` — Fire core                    | Organize connected influence around existing primary/lesser source centres with a readable core-to-edge intensity structure. Align heat, resistance and ice openings.                                   |
| `fire:vein` — Thermal vein                 | Compose a branching fracture-guided corridor network with dominant trunks and varied branches; join awkward fragments and integrate heat/material boundaries with relief.                               |
| `fire:spring` — Hot spring                 | Compose wet geothermal clusters around water support, with coherent thermal extents and meaningful outlets. Keep source water and terrain consistent.                                                   |
| `fire:vent` — Hydrothermal vent            | Compose seabed vent groups and influence patches around geothermal centres, aligned to finished bathymetry and thermal fields.                                                                          |
| `fire:basalt` — Basalt flat                | Compose coherent low-relief heat/material regions and, where volcanic construction supports it, basalt lobes and contacts. The present rule tests heat and slope rather than proving basalt deposition. |
| `fire:halo` — Thawed halo                  | Compose continuous irregular thaw transitions around heat structures, repairing sampling holes while preserving colder islands and water/ice connections.                                               |
| `aurora:field` — Aurora field              | Compose ice-associated regions with primary cores, connected influence and deliberate breaks, reconciling intensity and ice support.                                                                    |
| `aurora:well` — Light well                 | Compose a focal magical basin/cirque and its influence, strengthening its relationship to the surrounding valley/ridge network.                                                                         |
| `aurora:prism` — Frost prism               | Compose prominent magical summit/crest groups with lesser surrounding forms; coordinate peak shaping with actual relief and snow/ice. No crystal-growth simulation is implied.                          |
| `aurora:melt` — Melt line                  | Compose readable fronts through the intensity/ice/temperature band, joining accidental fragments and aligning fields. The current Aurora preset does not itself configure ice melt.                     |
| `pressure:locus` — Deep pressure locus     | Compose deep-ocean influence around source identity, with a readable central region and outward structure fitted to bathymetry.                                                                         |
| `pressure:crush` — Crush zone              | Compose connected pressure corridors/regions with varied concentrated cores and edges; reconcile pressure and associated coastal influence.                                                             |
| `pressure:wake` — Ancient wake             | Compose historical traces into coherent deformed sweeps with meaningful breaks; retain age and separation from present source/coast geometry.                                                           |
| `pressure:lattice` — Interference lattice  | Compose intensity/noise and propagation-supported regions into a readable network of intersections/openings, without claiming a wave-phase simulation exists.                                           |
| `pressure:rogue` — Rogue wave impact       | Compose coastal contact/scar systems around existing rogue activity; integrate their relief/material expression with the coast.                                                                         |
| `pressure:war` — Thermal war rim           | Compose coherent Fire/Aurora interaction bands, focal intersections and varied fronts. This rule can operate with Pressure disabled; preserve that behavior.                                            |
| `pressure:steam` — Steam fracture          | Compose connected branching corridors where Fire, Pressure and fracture support meet; align thermal/material expression and surrounding terrain.                                                        |
| `pressure:breach` — Pressure aurora breach | Compose ocean/ice interaction regions and actual openings where configured fields support them; reconcile ice/water boundaries rather than retaining disconnected mask holes.                           |

The original physical effects are heat, ice melt, rock resistance and coastal
forcing. The reviewed biology work also supplies vegetation growth, fire,
organic preservation, ecological alteration, plant cold/drought tolerance,
animal toxicity and seed dispersal effects, plus ecological fields in feature
conditions. Macro composition must include these existing effects and their
inherited results, not treat biological magic as a future subsystem.
Entirely new effects such as crystal growth, magical seabed compaction
or steam-explosion physics remain a user-owned extension to that vocabulary.
They are not prerequisites for finishing current systems and should not be
silently added to epoch algorithms.

## Biological landscape algorithms

Compose biological systems at the same macro scale as ranges and rivers:
recognizable forest masses and open-country mosaics, connected wetland systems,
habitat cores and corridors, and distinctive altered landscapes. Fit their cover,
soil, water and biomass values to the composition. The result should add regional
structure and interest while preserving genuine clearings, dry islands, refugia,
barriers and disturbance legacies. Joining every patch into one uniform biome
would discard the model's useful variation.

### Complete biological inventory

The 17 biome classes are Unclassified, Ocean, Freshwater, Ice, Barren, Desert,
Tundra, Grassland, Savanna, Woodland, Temperate forest, Boreal forest, Rainforest,
Marsh, Swamp, Altered woodland and Altered wetland. Water and ice classes follow
final physical geography; Unclassified is not a new landscape to populate.

Five plant functional groups supply the living communities: grass/shrub,
broadleaf, conifer, wetland and altered vegetation. Woody groups have young and
mature cover. Seed banks, canopy age, soil depth/water/nutrients, productivity,
fire and damage history, inherited magical adaptation and toxicity are part of
the state, not optional coloring inputs.

Current ecological extraction publishes eight feature kinds: `barren`, `desert`,
`tundra`, `grassland`, `savanna`, `forest`, `marsh` and `swamp`. Forest subtypes
and altered woodland share `forest`; altered wetland shares `swamp`, retaining
their biome attributes. Preserve that contract and stable spatial identity.
Animal populations and migration are fields, not existing animal-route vectors
or individual creatures. This plan does not assume otherwise.

| Biological feature system                                | Macro finishing algorithm and intended result                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Biome mosaic and transitions                             | Build a region adjacency graph from actual communities. Use suitability-constrained region merging, geodesic reconstruction and distance-based transition bands to replace speckled boundaries with large, varied regions and readable ecotones. Fit functional cover values and derive biome labels from those values; respect climate, relief, wetness and population barriers.                                                     |
| Woodland, temperate forest, boreal forest and rainforest | Compose dominant forest bodies, secondary groves, fingers along suitable valleys and openings on exposed or disturbed ground. Use connected-component graphs, low-cost links through suitable reachable habitat, metre-scale closing and controlled hole preservation. Fit canopy-density gradients rather than making a solid uniform canopy. Preserve broadleaf/conifer character and distinct young/mature stands.                 |
| Grassland and savanna                                    | Compose open-country expanses and tree/open-ground mosaics with coherent edges against forest and desert. Use regional cover redistribution, multiscale boundary variation and retained disturbance/grazing context; keep purposeful clearings and scattered woody groups rather than closing every opening into forest.                                                                                                              |
| Tundra, desert and barren regions                        | Compose coherent climatic/exposure bands and refugia, coordinating elevation, moisture and ecological damage. Use constrained component merging and boundary reconstruction while preserving appropriate isolated vegetation and rock/ice breaks. No automatic greening of empty but unreachable land.                                                                                                                                |
| Marsh, swamp and wetland chains                          | Grow/reconstruct connected regions along final floodplains, deltas, lake margins and low-gradient drainage. Fit broad lowland relief and shallow-water/soil-water conditions where needed; retain open channels, dry islands and wooded/open-wetland contrast. Wetland polygons must agree with actual hydrological support.                                                                                                          |
| Succession, young/mature stands and disturbance patterns | Segment canopy age, sapling/mature cover, fire activity and ecological damage into connected stand and recovery mosaics. Coherently remap these fields with community deformation and retain meaningful scars/fronts. Do not mature saplings, erase disturbance or advance simulated recovery merely to tidy the map.                                                                                                                 |
| Grazers, browsers, herbivores and predators              | Derive habitat cores and a cost-distance connectivity graph using finished vegetation, food/prey, relief, water, ice and toxicity. Compose coherent biomass-density regions by constrained redistribution within reachable habitat and carrying support. Preserve represented biomass during redistribution and keep the herbivore total consistent with grazers plus browsers; no hidden births or crossings of impassable barriers. |
| Animal movement and migration                            | Reconcile the aggregate migration-flux field with final habitat connectivity. Any corridor geometry derived for finishing is a habitat connection, not a recovered historical trajectory: the current model stores flux rather than complete tracks. Keep disconnected refugia distinct and do not run an extra migration epoch.                                                                                                      |
| Aquatic production and fauna                             | Reconstruct productive and populated water regions along connected rivers, lakes, deltas and shelves, respecting depth, ice and toxicity. Remap density within compatible connected water bodies as shores/channels move; preserve meaningful deep, frozen or depleted gaps. Aquatic biomass cannot be smoothed across dry land.                                                                                                      |
| Altered woodland/wetland and inherited magical traits    | Compose distinctive altered cores, branching spread regions, fronts and resistant refugia using both living altered communities and inherited traits. Reconcile altered cover, saplings, seeds, cold/drought adaptation and toxicity with habitat. Retain established altered regions after the initiating source disappears; do not clamp their extent to today's magic-intensity mask.                                              |
| Soil resources, production and water feedback            | Remap soil depth, available water/nutrients and productivity with final land cover and relief. Reconcile infiltration and evapotranspiration as present-day derived quantities. Use ecological support to resolve incompatible patches, preserving depleted/poor-soil regions instead of independently blurring each field.                                                                                                           |
| Organic pools, burial and resource fields                | Carry soil/peat/aquatic carbon and buried terrestrial/aquatic source, coal/oil/gas, burial-depth and thermal-exposure fields with their appropriate soil/sediment context. Preserve represented stocks under spatial remapping and inherited maturity. Do not make hydrocarbons the center of finishing or create extra burial, heat exposure or geological time for visual composition.                                              |

### Coupling and reconciliation

Run biological composition after physical and magic structure is composed, with
ecological context available while selecting valley, coast and magic shapes.
Reconcile the resulting cover/water/soil feedback before final publication; use
present-day consistency operations rather than replaying growth, maturation,
colonization, fire, predation or burial for another period of history.

Use the spatial correspondence from feature deformation to remap related living
and resource quantities together. Cover fractions remain normalized; canopy age
is weighted by its canopy, and inherited traits remain attached to altered
communities. Respect authored forests, protected features and fixed ecological
samples. Avoid a maturity or biomass gain caused solely by interpolation.

The macro pass can expand, contract and join biological shapes within their
regional ecological context, coordinating local terrain/water changes with that
composition. It must preserve the epoch model's actual barriers and history:
coherent forest design does not authorize colonizing an unseeded island, and a
coherent wetland outline cannot conceal dry ground beneath it. When final
physical changes remove habitat, make the present-state reconciliation and any
loss explicit rather than fabricating a compensating ecological epoch.

Reclassify biomes from finished communities, republish ecological polygons and
attributes, then reevaluate magic rules that read ecological channels. Preserve
all 18 existing magic-rule behaviors and independent interactions. Reconcile
those classifications without repeatedly applying biological magic as a fresh
transformation or entering a repeat-until-stable feedback loop.

## Existing human features

Generate cultural origins and culture fields from finalized habitability and
travel geography. Generate polity sovereignty/control/claim extents using their
existing semantics, with valid polygons and world clipping; overlapping claims
remain legitimate. Place settlements on supported terrain outside unsuitable
water/ice, and route roads using finalized slopes and existing crossing rules.
If finalization is moved after those processes, regenerate affected placements
and routes rather than merely snapping their drawings.

Do not force every cultural or political boundary onto a mountain or river.
This is downstream consistency, not the separately backlogged cultural and
political generator redesign. Building, room and interior feature kinds belong
to lower-level generation and are outside this world-only plan.

## Evidence and design risks

The first evidence must show that the macro arrangement improves. Use small
synthetic landscapes and saved representative world regions with before/after
views at the same extent and scale. Demonstrate a complete mountain crossing,
peak hierarchy, a reshaped river network and coherent reefs with useful
openings, plus coherent forest/grassland mosaics, hydrologically supported
wetlands and inherited altered regions. A smooth line or passing terrain
invariant alone is not proof of an interesting landscape.

Focused algorithm checks cover graph connectivity/crossings, pass approach
grades, shared river elevations, intentional falls, region reconstruction,
protected openings, water/ice support, field alignment and physical scale
stability. Test these behaviors directly, not documentation strings or repeated
full-world browser generation.

Biological fixtures must include a forest with deliberate clearings, a wetland
chain crossed by a connected river, distinct young and mature stands, a
water/ice migration barrier, aquatic populations separated by land, and an
altered community whose original source has disappeared. Check component
structure and macro views alongside normalized cover, stock-preserving remaps,
cohort/trait consistency and absence of invented historical animal tracks.
Reuse the existing ecology tests where applicable; do not retest every epoch
algorithm as a prerequisite for this planning update.

For integrated inspection, generate representative Draft and Standard worlds
outside the browser, measure time/memory and finishing cost, and reuse outputs
for visual review. A short browser check verifies display consumption. No
runtime cap, feature quota or universal beauty metric is authorized.

Assumptions to resolve in M0:

- Hierarchical network deformation and regional shape operations improve whole
  compositions rather than replacing mesh artifacts with repetitive procedural
  motifs. Check several regional characters, not one attractive river example.
- Terrain fitting can support the composition without unacceptable displacement
  of adjacent features. If not, revise the composition or fitting method and
  show the conflict before expanding the machinery.
- Graphs and region operations can work on compact feature-scale data rather
  than a globally dense reconstruction. Measure representative work.

The previous design cited [feature-based terrain
modeling](https://perso.liris.cnrs.fr/apeytavi/website/publication/hal-01257198/)
and [Priority-Flood](https://rbarnes.org/sci/2014_depressions.pdf). These inform
terrain representation and spill connectivity respectively; neither supplies
macro composition itself. The combinations above are engineering proposals,
not a claim to have ported an established complete method.

If a family becomes a prolonged tuning exercise, report the concrete composition
or fitting failure and recommend the narrower design change. Do not spend hours
chasing numerical accuracy or turn the project into a river simulator.

## Milestones and Sulion mapping

Root: `23486bd1-9654-4c3b-a8eb-5c68ed7b4a9c`. See execution notes for current progress.
Existing phase IDs are retained; their interpretation is revised below to the
user's macro direction. No partial-release milestone substitutes one family for
the complete outcome.

### M0 — Shared finalized field and mixed-feature proof

Scope: prove macro composition first on small mixed landscapes, then establish
the minimum shared field representation needed to publish those results.

Acceptance: a pass connects valley approaches on both sides; selected peaks gain
hierarchy; a river network is reshaped beyond its mesh route; reef fragments
become coherent bodies while meaningful openings survive. Terrain and values
follow those changes through shared field reads. A small ecological example
must also demonstrate forest/open-ground composition and wetland support so
the shared representation is not designed solely around bare terrain.

Evidence: before/after macro views, direct connectivity/field checks and small
query/memory measurements. No epoch algorithm changes.

Sulion phase: `dbd17513-acff-4603-9528-5dac67f5d821`.

### M1 — Structural relief, impacts and volcanism [depends on M0]

Scope: complete composition and terrain fitting for structural relief, basins,
faults, impacts, volcanic complexes and seabed structure.

Acceptance: ranges have varied hierarchy and connected valley/pass systems;
impact/volcanic complexes have coherent regional forms and integration with
neighboring geography. Preserve historical character and erased events.

Evidence: family fixtures and before/after structural macro views.

Sulion phase: `19fd9d9a-3064-4f3d-9511-0cd9eaeed54a`.

### M2 — Water, ice, coasts and sediment [depends on M0, M1]

Scope: complete river/lake, glacial, frozen-surface, coast, reef and depositional
composition, including gorges/waterfalls integrated with broader terrain.

Acceptance: networks/regions have coherent macro forms; channels, passes, water
connections and meaningful openings function in actual terrain. Reefs are
composed bodies rather than fragmented masks. Values agree with shapes.

Evidence: network/region fixtures and mixed-feature macro views, with direct
water, ice and terrain consistency checks.

Sulion phase: `ded3c6ff-5e3b-46dc-a9b6-31f2134f152a`.

### M3 — Configurable magic finalization [depends on M0, M1, M2]

Scope: all 18 rules, source hierarchy, corridor networks, coherent regions and
interaction fronts, with corresponding field/terrain reconciliation.

Acceptance: readable macro magic structures use common configurable mechanisms,
preserve historical/disabled-system behavior and integrate with the landscape.
Shape changes are reflected in associated values.

Evidence: role/rule fixtures and mixed-system macro views; no new epoch physics.

Sulion phase: `5c153242-9dee-4c25-b688-91589e5c8d44`.

### M3b — Biological landscape finishing [depends on M1, M2, M3]

Scope: the complete biological inventory above, including biome mosaics,
forest/open-country and wetland systems, cohort/disturbance patterns, animal and
aquatic habitat, persistent altered communities and coupled ecological fields.
Use the ecology implementation landed on main as `64774d6` and its reviewed
contracts. Ecology integration was explicitly requested before implementation.

Acceptance: biological geography is coherent and interesting at world scale;
purposeful openings, refuge populations, ecological barriers and succession
legacies survive. Region geometry, cover, cohorts, biomass, soils, water and
magical traits agree. No extra ecological epoch, species model or resource
generation is introduced by finishing.

Evidence: biological before/after macro views and direct field/connectivity
checks, including inherited alteration without an active source and conserved
biomass during redistribution within reachable habitat.

Sulion phase: `6df409db-84c6-4bf1-bb32-572f2c7de9d8`.

### M4 — Reconciliation and complete publication [depends on M1, M2, M3, M3b]

Scope: complete derivative/material/ecological classification updates, physical
and ecological named features and existing downstream human outputs; coordinate
shared fields with cartography. Reconcile ecology-dependent magic rules.

Acceptance: terrain, features, display fields, queries and exports describe the
same composed world. Human placements/routes use final geography; epoch history
and stable feature identity remain intact. Biome/forest/wetland polygons and
inspection values reflect the finished communities, and historical carbon or
animal movement fields are not replaced with invented decorative patterns.

Evidence: focused pipeline fixtures and sampling comparisons at final features.

Sulion phase: `1698acc1-5f0d-4aff-9cdb-9918d52443ad`.

### M5 — Integrated behavior and cost [depends on M4]

Scope: complete-inventory integration, world-scale visual inspection and
generation/query cost measurements.

Acceptance: coherent and interesting arrangements across all families, with
regional variety and functioning connections. Report remaining visual or
performance limitations honestly; river-only improvement is not completion.

Evidence: focused algorithm suite, saved direct world runs, before/after map
views and a short display-consumption check.

Sulion phase: `9b51bb76-9764-431c-8450-b4624c9a2cd8`.

## M0 execution

Expansion `442e2555-31ee-44e6-ae3b-c0042e104d6e`:

1. Integrate the existing ecology commit into this checkout, retaining the newer
   map controls. Files: the existing `2e2d763` changes and the overlapping
   `frontend/src/vectorStyles.ts`. Verify domain/frontend typechecks and focused
   ecology/cartography tests. Step `e43cca81-f3fe-408b-891a-5c5c64564e36`.
2. Implement compact macro composition operations on actual physical state:
   connected region reconstruction, network deformation, shared terrain fitting
   and authored constraints. Keep existing publication consumers. Verify direct
   algorithm fixtures. Step `81203b1a-9135-424f-8a22-56b2933df2dd`.
3. Demonstrate the mixed mountain/pass, river, reef and ecological compositions
   on small landscapes with local before/after images and field/connectivity
   assertions. Step `dd9d2a64-86d0-4005-aa4e-d9cc4aab83bf`.

Ecology integration completed and pushed on main as `64774d6`. Its single
vector-style conflict retains geology styling and ecological biome colors.
`make ci` passes, including 263 tests. This supersedes the earlier source-only
integration boundary: the real biological implementation is now available here.

## M0 evidence and M1 execution

M0 is complete: five direct fixtures cover a connected pass with matching public
field reads, varied summit emphasis, off-mesh river reconstruction with a
descending bed, a preserved lagoon, and stock-preserving woodland composition.
The fixtures run in about one second. A local generated before/after montage
at `.artifacts/macro-finishing.png` was inspected; it exposed boundary overgrowth
in regional closing, which was corrected. Typecheck and focused lint pass.

The shared final field currently uses the existing published base plus compact
profiles; epoch arrays remain the construction input. M4 must reconcile all
physical constraints and consumers, including authored protection and water
geometry, before the complete feature is accepted. M0 is not final-world evidence.

M1 expansion `f41e941d-0d43-4efb-8f22-656398e2bd29`:

1. Compose range spines/pass approaches, fitted surviving event footprints,
   fault corridors and regional floors/margins. Files: `macroRelief.ts`,
   `macroEvents.ts`, `macroAxis.ts`, `macroStructures.ts`, shared field profiles,
   and geological publication. Step `42f03499-f94d-42bd-9a11-78bcde3510a9`.
2. Verify surviving/erased events, supported shelf shapes and connections using
   direct fixtures and shared field reads; preserve historical cause identity.
   Step `8553615e-6891-4ded-a3c7-453fce79291c`.

Regional axis fitting requires geographic support masks: a shelf wrapped around
land must not carve through that land. Profiles now accept an existing GIS
footprint for this concrete constraint, rather than adding another simulator.

M1 implementation now includes connected crest profiles, valley-to-valley pass
cuts, summit hierarchy, irregular surviving event footprints/rim arcs, volcanic
complexes, fault corridors, rift/lava/ejecta regions, floors, margins and trenches.
Three structural fixtures cover a surviving irregular crater, an erased event
and shelf support that leaves adjacent land intact. Broader visual inspection
and real-world cost measurement are shared with M5 rather than replaying epochs
at each family boundary.

## M2 execution

Expansion `4c6be178-0d98-4b99-9649-9c10ec3bb085`:

1. Compose connected water and ice geography: shared shorelines, constrained
   river curves and inherited drops, glacial/depositional floors, reef and ice
   regions. Files: `macroWater.ts`, `macroRivers.ts`, `macroDrops.ts`,
   `macroNetwork.ts`, `macroIce.ts`, and water publication/sampling.
   Step `f82170f3-46cc-4d8e-ab1f-e6d30a2ec54f`.
2. Verify crossings, shore/field agreement, supported drops and ice volume on
   direct fixtures. Step `369a9d12-70d6-4451-80db-ca5ec72c63c6`.

## Current state

Ecology is pushed on main as `64774d6`. M0 through M4 have implementations and
direct checks; their integrated macro quality remains subject to M5. All
remaining work is authorized. Preserve unrelated concurrent changes.

M3 expansion `44b59d14-a10b-4a6b-8866-d2d3a5a4fa41`:

1. Add shared source/corridor/region/front/interaction roles and metre scales to
   feature rules, compose each role, and move associated fields with its region.
   Preserve independent interactions and apply only moved forcing differences.
   Step `7e617183-eb02-4b11-a939-1d3e1637dd01`.
2. Verify configured roles, inherited traces and disabled-owner interactions on
   direct fixtures. Step `3bd81e8e-3498-4989-849e-e24c30752a9c`.

M3b expansion `1a74be75-7913-44e0-bc3a-54707b8ee8ac`:

1. Compose woodland/open-country, wetland, altered and disturbance mosaics with
   actual communities and soil resources. Keep canopy-weighted ages and traits
   together. Redistribute represented fauna within occupied reachable habitat;
   retain aggregate migration history. Step `a03cf72d-36da-48d0-be17-b608bfdaf210`.
2. Verify cohorts, inherited alteration, resource stocks, terrestrial/aquatic
   barriers and explicit habitat loss. Step `fb248e02-00fe-4574-8645-f5dc0bd3803c`.

Buried carbon and thermal maturity stay with unchanged sediment context: relief
deformation moves that context vertically and does not represent new burial or
heating. Community exchange carries surface soil/peat resources; it does not
move coal or oil with a forest outline.

M4 expansion `3f2e16ac-5f27-453e-8a1c-1d4161065ea3`:

1. Reconcile final slopes, water, bathymetry, ice support, materials, ecological
   magic and authored footprint exclusions. Publish passes and river-associated
   features from composed coordinates. Step `d8beb1de-a0ed-471d-aaaa-db65732aba87`.
2. Verify shared field queries after layer splitting, structured cloning/schema
   transfer, protected areas and named feature publication.
   Step `47037b39-a32a-410c-9263-00f31f4d9e0f`.

Layer publication splits channels into independent resources. Those resources
must retain a shared pre-composition elevation/bedrock base so geology and water
queries can evaluate the same profiles even without a public elevation channel.
`landscapeBase` supplies those shared arrays; sampled public channels hold final
values for existing numerical consumers. Compact profiles preserve subcell fits.

M4 prerequisite `63d4390d-046e-4cd6-8216-6205f75a19f7`: Standard generation
failed in an ecological epoch before finishing. A direct grazing fixture
reproduced negative grass cover from subtracting a converted, exhausted carbon
budget. Consume a bounded fraction of the original cover instead. Ecological
diagnostics now identify the failing cell/value. This preserves consumption
semantics without loosening validation.

Integrated renders rejected hard regional support edges and absolute quantile
fitting of bathymetry: both introduced artificial terraces. Regional construction
and bathymetric fits now use bounded relative adjustments around their existing
relief, with smooth metre-scale footprint transitions. Plains and inherited
valley floors use partial absolute fitting; river beds and supported drops retain
their explicit longitudinal controls. These are revisions to the proposed
profile mechanism, not changes to the epoch algorithms or product outcome.

M5 expansion `3d1f2628-02e3-4765-b712-00189bf34a9e`:

1. Inspect saved Draft and Standard fields and feature families, then correct
   demonstrated integration defects. Step `22c2117c-7a68-40d9-8246-d7c82a3da3e4`.
2. Measure representative generation/display behavior and finish required checks.
   Step `dbf5e747-539c-4fc0-984d-a87f7e42742a`.

A Standard field comparison found dry cells with more than three metres of
apparent drainage head increasing from 494 to 4,023 after fitting. Terrain moved
but its cached drainage head did not, creating false marshes. Preserve the head
relative to dry terrain and retain fixed surface levels in water bodies. This is
present-state reconciliation, not an additional drainage/erosion epoch.

### Integrated review: outcome still unmet

The implemented families run together, but this is not completion of the agreed
macro outcome. The saved Standard comparison still shows disconnected-looking
cuts across a range, weak whole-range composition and little broad change in
the biological and magical landscape. The first crater/volcano examples also
demonstrate why an event label is insufficient visual evidence: several surviving
events are submerged or heavily eroded. Retain those histories without claiming
they demonstrate a dramatic present-day landform.

The river review exposed two concrete implementation errors. One conflict
previously retracted every network, and sampling the native route without its
corners could still cross another reach at zero deformation. Repairs now affect
local reaches, retain route corners, and round restored paths where safe. A
dominant-stem pass positions confluences before tributary fitting. The saved
Standard network then passes the proper-crossing check. A connected pass must
also pass through its selected saddle, not find a cheaper way around it.

These fixes do not establish whole-landscape quality. Independent compact
corridor fits and regional mask closing are an insufficient composition strategy
for the range example. Recommend composing and fitting each connected feature
system regionally, with shared ridge/valley constraints and transitions into its
surroundings, rather than continuing to tune individual cuts. Keep the existing
epochs, feature inventories, magic configuration and biological state. Reassess
this mechanism before more parameter tuning or new representation machinery.

Direct default-size runs at seed 104729 completed all three epochs and human
generation: Draft 78.96 s (finishing 10.35 s), Standard 259.03 s (finishing
31.32 s). Instrumented peak RSS was 2,818 MiB and 3,948 MiB respectively; these
are observed process peaks, not a browser-memory guarantee. No full world was
run through the browser. Saved fields provide direct visual and algorithm input.

The actual 258-pixel numeric terrain sampler took about 0.20 s before profiles
and 1.7–1.9 s afterward. Reducing temporary allocations helped little; profile
evaluation remains a material display cost. Human placement now reuses finished
heights already evaluated at the exact public samples instead of fitting every
profile again for each process; a Standard land-cell selection fell to 0.65 s.
Full-run totals above precede that local improvement. Do not represent them as
a measurement of the latest complete run or infer a new end-to-end speedup.

M5 remains open because the visual outcome and representation cost need a
design correction. Passing algorithm and pipeline checks is insufficient to
close it. Finishing work is local and uncommitted; only ecology was published.
