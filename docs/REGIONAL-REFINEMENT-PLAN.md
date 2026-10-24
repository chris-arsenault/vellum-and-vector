# Regional refinement and direct map authoring

Status: updated 2026-10-24. Independent regional selection and hierarchy are
implemented. The user has authorized committing and pushing this delivery;
B–E remain planning-only.

Sulion root: `6bda9dba-ba6b-468a-a463-4dea05f96155`.

The four remaining sibling Sulion subplans below retain their shared design and
boundaries, outcomes, dependencies and pending delivery phases. The original parent milestones remain
acceptance coverage, not a second implementation queue.

## Outcome and authority

First let the creator select meaningful nested regions on demand, using geography,
social boundaries and authored dividing lines. Then develop a selected region
into recognizable finer geography. A river omitted
from the World map becomes an important regional feature; smaller settlements,
tributaries and landforms appear in plausible locations. The region elaborates
its parent rather than becoming a newly evolved world in a smaller rectangle.
Creators then modify located 2D map layers directly, without reconstructing a
physically consistent simulation underneath every edit.

This plan covers subdivision and fractal refinement of the existing geographic
map type only. A child remains the same map type as its parent. City-layout,
interior, POI/site and forest-interior maps are different products with unsupported
data and generation needs; none is included here. A town symbol or forest area
on the geographic map remains in scope; generating its internal map does not.

### User requirements and existing boundaries

- **Current design request:** regional generation should refine and fractalize
  existing geography, using semantically similar processes but potentially
  entirely different algorithms. The US → Arizona → Verde River / Flagstaff
  example describes increasing geographic significance and detail, not a
  requirement to reproduce those real places.
- **Current editing direction:** the complex world model supports procedural
  generation; ordinary creator edits target the 2D map layer. Retain useful
  linkage and translation without requiring the edited world to remain suitable
  for continued simulation. Locking an edited region was raised as a possibility,
  not a settled requirement.
- **Current authorization:** implement independent selection/navigation subplan A
  on existing geography, then commit and push that delivery. B–E remain
  planning-only.
- **Delivery organization:** split the work into focused subplans so a few can
  progress at a time, each delivering a high-quality creator experience. This
  reorganizes planning; it does not authorize implementation or agent delegation.
- **Independent first delivery:** regional selection and a rough recursive
  hierarchy must be useful on the existing map before the rest of refinement is
  delivered. The current Cartographic map mode plan is an immediate consumer;
  neither selection nor that presentation needs new terrain generation.
- **2026-10-24 correction:** hierarchical subdivision comes first. Regions follow
  geography or social constructs and may combine rivers, shorelines,
  coordinate-aligned segments and user-defined polylines. Rectangular selection
  is not the region model. Offer reasonable regions for the current zoom without
  predetermining every region. Support recursive containment such as World →
  North America → United States → Arizona → Yavapai County. These examples do
  not prescribe a fixed set of region kinds or a fixed depth.
- **2026-10-24 clarification:** nesting terminology is illustrative, not an enum,
  required sequence or algorithm selector. Support arbitrary nesting depth until
  the existing map type reaches a useful minimum geographic size. Fractalization
  retains that map type; it does not transition to city, interior, POI/site or
  forest-interior maps. The minimum size is to be designed, not invented as a
  number in this plan, and reaching it must not switch map types automatically.
- **Prior user correction:** World and Region are distinct semantic creation
  profiles, with different feature spaces and design criteria. Zooming into the
  World map must not disclose regional features. Source: user turn
  `01a1624c-599c-7bf1-9637-19d90755e636 / 18661021`, available through
  `sulion-retrieve turn`.
- **Project boundary:** TypeScript, React/OpenLayers, browser sessions and worker
  generation remain the active architecture. Preserve the existing explicit local
  map saves in IndexedDB adopted on 2026-10-24; this plan adds no separate storage
  path, backend, MCP, generation recovery or restart mechanism. See
  [ADR 0003](adr/0003-frontend-session.md).
- Preserve geographic location, stable identities, authored work and coherent
  connections. Keep hierarchy depth, semantic region kind, creation profile,
  geographic extent, numerical detail and display zoom separate. Recursion must
  not be limited by named ranks, a fixed level count or the number of creation
  profiles. Refinement stays within the existing map type. Finer development remains
  sparse and geographically anchored; zoom alone does not generate it.
- Preserve distinct Fire, Aurora and Pressure mechanisms as decided in
  [ADR 0004](adr/0004-coupling-through-each-systems-medium.md). This plan does
  not authorize changes to that coupling.

### Agent proposals, not additional user requirements

1. Use a dedicated regional sequence of conditioned detail processes. Reuse the
   common process contract and worker rather than inventing another engine.
2. Separate procedural input/context from editable map representations within
   the current session model. Keep one atlas and shared identities, not two
   competing user-facing worlds or independent copies of every layer.
3. Reveal retained detail before synthesizing unresolved detail. Preserve broad
   geography and important connections without fixing every parent sample.
4. Let structural map edits make the affected mapped area unavailable for
   automatic geographic generation. Names and styling do not do this. This is
   the recommended initial simplification; exact scope and descendant behavior
   remain open for M0.
5. Judge results by recognizable, useful geography and creator behavior. Exact
   numerical parity, a matching process list, or explanation metadata cannot
   substitute for those outcomes.
6. Resolve candidate regions locally from existing geographic/social boundaries
   and authored cuts. Use the viewport's world-space scale to suggest useful
   extent, let the creator choose or adjust the outline, and materialize only
   selected areas. Candidate selection does not require generating finer terrain.

## Reviewed starting point and reuse

These are source observations, not evidence of working regional refinement.
They were reviewed on 2026-10-23. Concurrent society, language and cartography
work is present in this checkout; re-read affected bodies before implementation
and preserve that work rather than recreating or overwriting it.

| Source                                                                                                                                                                                                                    | Observed behavior and implication                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [atlasWorkflow.ts](../packages/generation/src/atlasWorkflow.ts), [atlasSequence.ts](../packages/generation/src/canonry/atlasSequence.ts)                                                                                  | Child generation samples parent fields and skips initial geological construction, but physical generation still enters the epoch sequence with incision, sediment, glacial and coastal passes. Replace that regional path; individual ecology/society guards already avoid some elapsed work.  |
| [atlasWorkspace.ts](../packages/generation/src/canonry/atlasWorkspace.ts), [atlasPublications.ts](../packages/generation/src/canonry/atlasPublications.ts)                                                                | Regional workspaces inherit channels and restore fixed boundary/authored samples. Published numerical products survive; the physical scratch workspace is discarded. Inventory actual retained inputs before proposing more state.                                                             |
| [atlasFeatures.ts](../packages/generation/src/canonry/atlasFeatures.ts), [drainage.ts](../packages/domain/src/drainage.ts), [drainageRefinement.ts](../packages/domain/src/drainageRefinement.ts)                         | Retained channel reaches include downstream links, discharge and catchment profiles, including channels filtered out of mapped rivers. Child creation can expose them, but clipping retained reaches is not new tributary or valley generation. The retained network is not every runoff cell. |
| [societyInheritance.ts](../packages/generation/src/societyInheritance.ts), [societyPublication.ts](../packages/generation/src/societyPublication.ts), [societyMapScope.ts](../packages/generation/src/societyMapScope.ts) | Society retains completed history and latent records. Current work distinguishes located urban population from area-distributed rural population and filters World publication by semantic importance. Preserve those mechanisms and reassess their regional behavior.                         |
| [composition.ts](../packages/domain/src/composition.ts), [SceneIndex.ts](../frontend/src/SceneIndex.ts)                                                                                                                   | Existing feature identities, finer representations and profile-aware reads are reuse candidates. Regional detail must remain absent from World reads even after it exists.                                                                                                                     |
| [featureIntents.ts](../packages/domain/src/featureIntents.ts), [fieldIntents.ts](../packages/domain/src/fieldIntents.ts), [sessionAuthoring.ts](../frontend/src/sessionAuthoring.ts)                                      | Feature edits validate physical/network contracts and can synchronize society; brushes author numerical field patches. Separate ordinary map editing from that simulation obligation while retaining useful editing and undo mechanisms.                                                       |
| [RegionalGeneration.tsx](../frontend/src/RegionalGeneration.tsx), [RefinementPanel.tsx](../frontend/src/RefinementPanel.tsx)                                                                                              | The region flow reuses the general generation wizard. It needs regional controls and inherited-context presentation instead of another world-history setup.                                                                                                                                    |

The initial review did not reproduce the reported bad regional map. It establishes
the structural mismatch, not a measured explanation for a particular output.

On 2026-10-24, [areaConstraints.ts](../packages/domain/src/areaConstraints.ts)
still requires every child to advance to a later creation profile. Polygon and
multipolygon footprints already exist, but that ordering cannot represent the
requested recursive region hierarchy. Reuse the geometry and containment checks;
replace the assumption that depth and profile rank are the same. The relevant
older contract is [product specification 4](product-spec.md#4-geographic-hierarchy-and-creation-profiles).
The newer [scale contract](adr/0005-scale-contract.md) also needs to be read before
later refinement work; it records mechanisms decided since the initial review.

## Proposed design

### Hierarchical subdivision and region selection come first

A region is a located geographic area with a parent and a meaningful outline,
using the same existing geographic map type at every depth. Its name and any
description of its geographic, political or social meaning are optional metadata,
not a hard-coded taxonomy. Country, state and county are illustrative labels;
arbitrarily named or unnamed regions work the same way. Generation settings follow
geographic scale and available detail, not a label or numeric nesting depth.
Entering or selecting a child does not itself regenerate its interior.

Recursion stops at a useful minimum geographic size for this map type, not after
a fixed number of ancestors. The implemented selection contract is recorded in
[product specification 4.5](product-spec.md#45-geographic-region-selection).
The creator stays on the geographic map at that minimum.

Build a selected outline from a mixture of boundary segments:

- Existing shorelines, rivers, drainage divides, ridgelines or other useful
  geographic boundaries supported by the available map.
- Existing social territory, political or administrative boundaries where those
  facts exist. A thematic feature remains distinct from the mapped area using it.
- Creator-drawn polylines, including straight coordinate cuts and latitude-like
  divisions where the world's coordinate model supports them. A line can cut a
  parent or join existing segments; the resulting region has a closed polygonal
  footprint. The creator need not redraw the coast or river portion by hand.

The recommendation is a locally assembled boundary network using existing GIS
operations: choose relevant segments, join authored cuts, and resolve candidate
enclosed areas inside the current parent. Reuse a suitable existing polygon
directly. Use a geographic partition algorithm only where existing boundaries
do not define a useful outline; its exact choice remains design work. Do not
substitute arbitrary Voronoi cells, tiles or rectangles for meaningful geography.

Selection should start from the place under the pointer and the current map
scale. Prefer an existing region of useful size when present; otherwise propose
an outline from nearby geographic or social context. Preview it on the map and
let the creator choose a broader or narrower candidate, combine areas or adjust
segments before creating the child. A mixed outline can follow a river on one
side, a coast on another and an authored straight line on a third. The exact
interaction and candidate ranking are proposals, not a new mandatory wizard.

Zoom is a hint about a useful selection size, not a command to synthesize local
facts or disclose regional features on the World map. Selecting or developing
a candidate is a separate creator action. Suggestions use available geography
at its current fidelity; they do not require unpublished fine terrain to exist.

Only selected regions and necessary shared boundaries need to become committed
nodes. Do not predivide the world, generate every sibling, fill unused hierarchy
levels or require all children to cover their parent. Choosing a small area directly
must not require fabricating named intermediate ranks; committed children
still have one valid containing parent, and users can develop intervening areas
when useful. At each selected level the same operation can propose smaller
children, with a navigable ancestor path and stable existing region identities.

Where committed siblings form a subdivision, they share the same border geometry
rather than independently tracing almost-identical edges. Geographic and social
candidate schemes can overlap; choosing one does not silently duplicate ownership
of already refined layers. Rivers and other networks can cross the hierarchy.
Relating a boundary to a river must preserve that distinction, and map-edit locks
must not treat selecting an outline as deformation of the underlying world.

### Inheritance expresses what is known

Resolve parent and neighboring context into three kinds of information:

- **Established facts:** known places, identities, receiving waters, important
  cross-area connections and already completed events.
- **Broad constraints:** terrain form, watershed organization, substrate,
  climate, ecological character, magic and society distributions.
- **Unresolved detail:** smaller ridges, valleys, tributaries, habitats,
  settlements and routes that the parent never established, represented on the
  same geographic map rather than as separate site or interior maps.

Existing mapped places deserve stronger location protection than aggregate or
latent estimates. An inherited mountain range establishes its broad form and
character, not every ridge. A known river constrains drainage and connectivity,
not every bend. Do not convert uncertain coarse samples into exact fine truths.
Use approximate physical conditions at interfaces where useful geography needs
them; no exact aggregate matching or universal boundary solver is proposed.

### Regional processes construct detail without advancing time

The provisional sequence is subdivision/selection → context resolution → terrain/drainage construction
→ local environmental response → society/place development → map publication.
Terrain and drainage may need coupled local shaping rather than a single pass.
Choose that order from actual mechanisms during milestone design.

| Responsibility      | Regional operation                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Geology and terrain | Condition ridges, valleys, escarpments and surface character on broad relief, substrate and inherited geological consequences. Fractal or multiscale synthesis is an option, not the entire algorithm. Do not create another tectonic history or unrelated major mountains and craters.                                                                                                                        |
| Drainage            | Reveal retained channels, refine valley corridors and channel paths, then connect newly generated tributaries. Carry upstream water entering the region and respect receiving rivers/lakes; do not derive the whole river's water solely from local rainfall. Shape terrain and drainage together so the network belongs to the landscape.                                                                     |
| Climate and ecology | Downscale broad conditions through elevation, exposure, shelter, moisture and local hydrology. Develop coherent habitat patches from that context without replaying ecological age or erasing inherited biome character.                                                                                                                                                                                       |
| Magic               | Refine existing influences and opportunities using system-specific mechanisms and causal ordering. Preserve fracture-connected Fire, cold/ice-dependent Aurora and ocean-connected Pressure rather than giving each region unrelated replacement sources or replaying old impulses. New four-pillar behaviors remain with that workshop.                                                                       |
| Society and places  | Materialize suitable latent records and synthesize missing local occupation from inherited people, affiliations, political context and environmental opportunities. Preserve existing centers; allocate smaller settlements and rural occupation without duplicating population or replaying completed eras. Retain distinct settlements, ruins, infrastructure, land use, practices, institutions and events. |
| Map publication     | Produce a Region-specific feature set, representations, symbols and labels. World publication retains its major features and coarse geometry at every zoom. Zoom may style eligible features; it does not materialize a new semantic profile.                                                                                                                                                                  |

For every result, distinguish **revealed existing information**, **elaborated
existing geography** and **newly synthesized detail**. This is a generation
distinction, not a requirement for three UI modes or a lineage dashboard.
Retain enough context for subsequent finer development of untouched geography,
at arbitrarily nested geographic levels down to the map type's minimum useful
size. Refine the existing map type at every level, with scale-appropriate detail
settings. Do not dispatch to a different map type through a profile ladder.
Allow skipped geographic levels without dummy maps or automatically generated
siblings.
Determinism should follow world context, stable spatial/feature identity and
requested detail; avoid making unrelated details shift solely because an extent
is cropped differently. The minimum useful consistency guarantee remains M0/M2
design work, not a mandate for a global tiling framework.

### Direct authoring changes mapped representations

Procedural context feeds generation; generation publishes editable located map
layers and context for finer generation. Creator edits change those map layers.
They retain source associations and semantic identity where applicable, without
silently rewriting geological, hydrological or demographic simulation state.

Keep editable vector/network features and surface layers rather than flattening
everything into a bitmap. A relief brush may change a display surface without
reconstructing bedrock, erosion and climate. A moved river can remain an
identifiable river without solving an inverse erosion problem.

Separate basic map correctness—valid geometry, location, references, useful
shared endpoints and undo—from generated physical plausibility. The latter is
required of procedural output, not an obligation to reject every artistic edit.
Rendering, selection and downloads must agree on the edited map. Procedural
estimates must not be presented as newly recalculated facts after divergence.

The proposed first boundary is a mapped-area generation lock after structural
edits. Untouched areas remain eligible for procedural refinement; an authored
area can continue through manual development. Existing child maps and shared
crossings need an explicit, understandable rule before implementation. Do not
silently overwrite them or invent simulated consequences. Reusing selected map
edits as constraints for later generation is a possible later capability, not
an implicit promise to recover a complete simulation from any drawing.

### Specification changes to settle in M0

The current direction revises parts of [product specification](product-spec.md)
sections 2.2, 4, 6, 9, 11 and 12, [ADR 0001](adr/0001-spatial-authority.md), and ADR 0003's
child numerical boundary rule. Unified simulation/editing semantics, exact field
preservation and physical reconciliation cannot simply be carried forward as
acceptance criteria for the new map-authoring model.

Keep geographic identity, spatial coherence, authored protection and browser
execution. Determine the narrower contracts that still serve those outcomes.
This planning request does not edit those authority documents; M0 records the
settled changes when later authorized. The 2026-10-24 correction supersedes this
plan's earlier finite-depth assumption: named ranks and creation-profile lists do
not bound recursive geographic containment. The subsequent clarification limits
this recursion to fractalization of the existing geographic map type; unsupported
city, interior, POI/site and forest-interior map types are excluded. The zoom/profile distinction remains, with zoom now
explicitly guiding candidate selection size. This does not revive archived adaptive
or continuous-field rewrites, backend plans or abandoned numerical targets.

## Delivery subplans

All remaining subplans inherit the root requirements, user corrections and
same-map-type scope. B–E remain pending. Expand each imminent delivery phase before
implementation. Selection and hierarchy are delivered; their contract lives in
[product specification 4.5](product-spec.md#45-geographic-region-selection).

| Subplan                    | Creator outcome                                                                                       | Parent coverage               | Dependency needed for integration                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| B — Terrain and rivers     | Generate recognizable finer relief and connected water.                                               | M0/M1 generation contract; M2 | Delivered region identity, footprint and selection flow; agree its connection to refinement.                         |
| C — Living landscapes      | See climate, habitat and distinct magic respond to regional geography.                                | M3                            | B1 output contract for design; actual refined relief and water for delivery.                                         |
| D — Settlements and routes | Discover smaller mapped places connected to the living landscape.                                     | M4                            | B/C input contracts for design; actual refined geography and environment for delivery.                               |
| E — Direct map authoring   | Edit geographic features and surfaces directly, with understandable refinement consequences and undo. | M0/M1 map authority; M5       | Delivered region identity and B1 input/output agreement; existing generated geography supports initial editing work. |

### Sequencing and shared ownership

Selection and hierarchy are available independently. B can develop the physical
refinement experience while E develops direct editing. E's user-owned decision
about structural-edit locks does not block refinement of untouched regions.
Both consume the existing region identities and source map rather than inventing
a competing hierarchy or map model.

The first consumer is the separately tracked **Cartographic map mode**
plan, `51af6b95-6ff3-4e1e-9203-c4990e6c912e`, reviewed on 2026-10-24. That plan's
drawn-map presentation, coloured political-atlas experiment and later compositions
use existing atlas geography. Region selection supplies its geographic subject,
footprint and hierarchy. Saved layer compositions retain their selected region;
the cartographic renderer can consume that subject without waiting for refinement.

After B's geography inputs and outputs are settled, C and D can develop their
respective designs together. D's placement behavior can use existing inherited
environmental inputs while C progresses, but its delivered experience must be
checked against C's real regional landscape. This permits useful overlap without
claiming fixtures or agreement on types prove an integrated product.

M0/M1 are shared acceptance coverage rather than a separate architecture project.
B owns refinement inputs and generated geographic output. E owns map-edit
authority, undo and generation eligibility after edits. They agree the small interfaces they consume;
each writes its implementation once. C and D consume those boundaries and request
concrete additions when needed. Keep shared-file changes coordinated during any
future concurrent work; creating subplans does not assign editing ownership.

Every subplan includes real UI wiring, representative map review, focused checks,
useful controls and honest failure/cancellation behavior where relevant. Measure
interaction and generation costs where they affect the experience, without
inventing caps or weakening geography. Integration and usability cannot be left
entirely to parent M6. M6 checks the combined experience after those deliveries.
No deployment, separate verification report, extra backend or new map type is
introduced by the split.

### B: Terrain and rivers

Sulion: `cea5e9bb-a7c7-483f-91c4-3b6d8e50ae41`.

Outcome: an actual selected region gains coherent smaller landforms, valleys and
tributaries while remaining recognizable within its parent geography.

1. **B1 — Agree the regional geography inputs and output.** Consume the delivered region
   identity; inventory current fields, drainage and the scale contract. Specify
   inherited constraints, unresolved detail and the minimum publishable output.
   Agree with E how mapped overrides remain distinct from procedural inputs;
   do not make E's entire editing policy a prerequisite for untouched geography.
2. **B2 — Deliver coherent refined relief and drainage.** Construct landforms and
   drainage together on irregular footprints, including externally supplied
   river flow, receiving waters, new tributaries and river-aligned borders. Do
   not replay completed geological history or add unrelated major features.
3. **B3 — Finish the geographic refinement experience.** Connect region selection to
   useful refinement choices, progress, cancellation and publication. Inspect a
   river/relief region, its neighbor and a smaller recursive refinement, with
   focused connectivity, determinism and outside-scope preservation checks.

Done means the terrain and water visibly belong together and the creator can
generate them through the real UI. Retained minor channels must be useful rather
than merely copied; numerical parity or a matching process list is insufficient.
This track does not wait for settlement placement or a new environmental system.

### C: Living landscapes

Sulion: `28cabe93-883c-427c-beed-7a35ca92c585`.

Outcome: regional relief and water produce readable local climate and habitat
patterns, including distinct existing magical effects, on the geographic map.

1. **C1 — Agree environmental inheritance and visible scenes.** Consume B1's
   output contract and current ADR 0004/0005 mechanisms. Define broad-to-local
   environmental variation through representative dry, wet, cold and magical
   scenes; do not redesign the already agreed cross-pillar coupling.
2. **C2 — Generate connected regional living landscapes.** Elaborate climate,
   ecology and magic against refined relief and water. Preserve inherited age,
   existing sources and influences crossing the selected boundary. Absent systems
   do not acquire effects, and local refinement does not repeat old events.
3. **C3 — Finish environmental controls and map presentation.** Connect useful
   regional options, layers and inspection to actual B outputs. Review spatial
   agreement among habitat, water and system-specific magical geography, with
   focused inheritance/feedback and browser checks.

Done means the landscape communicates the result visually, rather than only in
fields, names or inspector prose. Forest areas remain geographic areas, not
forest-interior maps. C can be delivered and inspected before D's new places.

### D: Settlements and routes

Sulion: `0316fae6-8ad0-4ea5-87cb-a314ffb2cf92`.

Outcome: smaller mapped settlements, routes and land uses become significant
regional features grounded in inherited society and the refined environment.

1. **D1 — Agree inheritance and place-development behavior.** Distinguish known
   located centers from latent demands and population. Agree consumed B/C inputs;
   retain affiliations, political context, naming, identities and completed eras.
2. **D2 — Develop smaller places and their connections.** Materialize suitable
   settlements, routes and land-use geography. Allocate people without duplication,
   keep urban concentration distinct from rural distribution and preserve unmet
   demands when no suitable geographic opportunity exists.
3. **D3 — Finish the populated regional map.** Integrate choices, symbols, labels
   and inspection. Review a major center, smaller towns and their routes against
   the actual living landscape, including allocation, identity and World/Region
   separation checks. Do not rely on marker counts as a substitute for placement.

Done means a smaller town becomes useful and understandable on the regional map,
without replaying society eras or forcing every coarse estimate into a fixed
site. Existing settlements, ruins, infrastructure and other eligible geographic
features retain their distinct meanings. City layouts, POI/site maps and interiors
remain excluded.

### E: Direct map authoring

Sulion: `0ec4853b-4446-412e-b623-a1fee7b30799`.

Outcome: creators reshape rivers, move mapped settlements and paint surfaces
directly, with consistent selection and undo and understandable consequences for
later refinement. This work can begin on existing generated geographic maps.

1. **E1 — Settle map authority and post-edit refinement behavior.** Use the delivered region contract and B1
   contracts to resolve structural versus presentation edits, generation eligibility,
   existing descendants and shared crossings. The structural-edit lock remains
   a user-owned design decision; it becomes blocking only before encoding that
   behavior, not for another track's unedited generation.
2. **E2 — Deliver direct edits and undo on mapped geography.** Separate edited
   representations from procedural context and implement the settled boundary.
   River, settlement and surface edits must not reconstruct geological or
   demographic history. Preserve spatial references and meaningful connections.
3. **E3 — Finish editing feedback and recursive-map behavior.** Integrate tools
   and clear status; exercise shared borders, existing children and undo. Check
   rendering, selection and downloads against the edited map, and ensure untouched
   areas remain eligible for the agreed generation behavior.

Done means ordinary creative work feels direct and authored geography is neither
silently replaced nor presented as newly recomputed simulation state. Styling
and names remain ordinary edits. Later generation from arbitrary authored maps
is not promised unless the settled E1 design explicitly supports it.

## Parent acceptance coverage

H0 is delivered; M0–M6 remain pending. Their bodies retain the required outcome and
evidence from the original plan; execute work through the remaining subplans above,
not through duplicate parent expansions. The subplan dependencies supersede the
old wholly serial ordering: shared M0/M1 contracts are settled where consumed,
and authoring policy does not block unedited generation. Implementation-specific
checks can change when a simpler mechanism satisfies the same user outcome.

### H0 — Hierarchical subdivision and region selection

Delivered independently. The region view, selection, navigation and cartographic
subject contract is in [product specification 4.5](product-spec.md#45-geographic-region-selection).
Later generation consumes those identities and outlines without changing the
source-preserving selection behavior or imposing a named profile ladder.

### M0 — Settle refinement and authoring contract [remaining work in B1 and E1]

Scope: resolve inherited facts versus estimates, map/procedural authority,
structural-edit classification, lock extent, descendants and shared edges.
Identify the exact specification changes and minimal retained context needed,
using H0's recursive areas rather than a fixed-depth profile ladder.

Acceptance: concrete examples explain revealing a river, creating a tributary,
materializing a town, moving a river, editing a shared crossing, changing only
styling, and developing a child of an authored region. Unresolved proposals stay
distinct from user requirements; no numerical reconstruction is presumed.

Evidence: review those creator scenarios and the relevant source bodies; revise
the working design and applicable architecture contracts under the authorization
then in force. No runtime implementation is part of this milestone.

### M1 — Separate procedural context and mapped output [covered by B1/B2 and E1/E2]

Scope: establish the minimum in-memory ownership and translation boundary using
the existing domain, generation/publication, spatial reads and worker contracts.
Inventory and retain only inputs required by concrete refinement processes.

Acceptance: same-map-type children at arbitrary depth resolve the right procedural and mapped
context through the recursive hierarchy. A mapped feature can identify its generating context without an edit
being mistaken for a physical input. Untouched context supports regional work;
profile-aware reads preserve World/Region separation. Existing identity,
authorship, undo and worker result handling remain coherent.

Evidence: focused ownership/publication/read checks, including an edited feature
and an untouched neighboring area. Do not build a generic provenance framework.

### M2 — Generate regional terrain and drainage [depends on M1]

Scope: replace regional physical epoch replay with conditioned landforms,
retained-river elaboration and new connected tributaries. Resolve upstream input,
receiving water, coastline and neighboring continuity for selected irregular
footprints, including boundaries that follow a river or pass through a watershed.

Acceptance: the parent landscape stays recognizable while useful smaller relief
and drainage appear. The region includes externally supplied river flow and
connects tributaries correctly. Repeating refinement does not add elapsed history
or modify geography outside its scope. The same inputs remain deterministic.

Evidence: inspect a representative river/relief region and an adjacent refinement;
use focused drainage/connectivity and no-history-replay checks. Exact arrays,
hashes or Canonry numerical equivalence are not acceptance targets.

### M3 — Refine climate, ecology and magic [depends on M2]

Scope: generate local environmental variation from inherited climate, substrate,
water, ecology and distinct magical influences. Reuse supported feedback and
local shaping without replaying old events or importing unapproved workshop work.

Acceptance: local habitat and surface character follow actual regional geography
and each included magic system's medium. Absent systems do not acquire effects;
large inherited influences do not disappear or restart at the selected edge.

Evidence: inspect contrasting regional environments, including magical geography
where present; check focused inheritance and scoped feedback behavior. Re-read
the four-pillar draft and magic source authority before designing new behavior.

### M4 — Develop regional society and places [depends on M2, M3]

Scope: develop smaller settlement symbols, routes and land-use areas on the
existing geographic map using retained society and refined geography. Do not
generate city layouts, POI/site maps, interiors or forest-interior maps.
Preserve known centers and separate located urban
population from distributed rural population. Reuse current language/naming work.

Acceptance: a smaller town can become a significant regional feature while the
World map remains limited to major items. Places respond to water, terrain and
opportunity; people and affiliations are allocated without duplication or a new
historical replay. Latent records influence development without forcing every
coarse estimate into an immutable local site.

Evidence: review a populated region and focused population/identity/profile
checks. The supplied Arizona analogy guides the behavior, not mandatory counts,
real-world naming or a fixed settlement taxonomy.

### M5 — Edit map layers directly [depends on M1; integrated with M2–M4]

Scope: route ordinary map edits to mapped representations; implement the M0
decision on generation eligibility, authored descendants and shared interfaces.
Retain meaningful selection, relationships, spatial location and undo.

Acceptance: creators reshape a river, move a town and paint a surface without
triggering physical reconstruction. Styling remains ordinary presentation work.
The UI explains the actual effect on further generation, untouched areas remain
usable, and authored content is not silently replaced or shown as recalculated
simulation state. Undo restores the corresponding map and eligibility state.

Evidence: focused domain checks and browser authoring scenarios against generated
regional geography, including a pre-existing child and a boundary crossing.

### M6 — Integrate regional workflow and inspect geography [depends on M2–M5]

Scope: connect H0's selection and navigation to useful regional choices and
inherited context; join subdivision, generation, map editing and recursive finer
development in one creator flow. Retire superseded regional paths and guidance.

Acceptance: a creator selects a region, generates convincing finer geography,
edits its map and continues according to the settled generation boundary. World
and Region retain distinct feature spaces at all zooms. Untouched finer areas
can develop from their regional context without restarting world history. A user
can choose a useful region at the current zoom without prepartitioning its parent
or changing map type merely to create another child. The minimum-size endpoint
keeps the existing map type and introduces no unsupported map generators.

Evidence: inspect the full river/relief/town example, neighboring regions and an
authored region; run proportionate domain/browser regression checks. Measure
representative generation and interaction cost and report variability; no new
hard budget, runtime cap or reduced feature coverage follows from a target.
When the full plan eventually closes, move settled durable content into the
product contract, generation guide, ADRs or backlog as appropriate, then remove
this working plan file and references, following repository documentation rules.

## Open decisions and assumptions

| Item                                                    | Recommendation / uncertainty                                                                                                                                                                                      | Owner and decision point                                                           |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Generation after structural edits                       | Start with the affected mapped area locked. Whole-world locking is disproportionate; automatic inverse simulation is unnecessary. Layer-specific or constraint-driven continuation is a possible later extension. | User-owned workflow choice; settle in M0 before M1/M5 encode it.                   |
| Existing children and shared crossings                  | Preserve authored maps and their links without pretending procedural context changed. Exact behavior for children, neighbors and edits spanning areas needs concrete creator scenarios.                           | User-visible semantics in M0; implementation follows the settled rule.             |
| Further automatic development inside an authored region | Initially allow manual child development; do not promise procedural refinement from an arbitrary edited map. Determine whether this restriction fits the desired successive-refinement workflow.                  | User-owned scope choice in M0; affects M5/M6.                                      |
| Inherited detail sufficient for refinement              | Existing fields, drainage and latent society appear useful, but source graphs and below-sample geography are not necessarily retained. Add only demonstrated missing inputs.                                      | Technical investigation in M0/M1; regional behavior in M2–M4 tests the assumption. |
| Precise synthesis algorithms                            | Conditioned multiscale terrain and constrained drainage are starting proposals. Choose algorithms through representative geography rather than numerical parity.                                                  | Implementation design in M2, within the agreed product contract.                   |
| Four-pillar evolution                                   | Its design may change the world context consumed here. Consume the agreed implemented mechanisms; do not make this plan wait on every speculative addition or implement that workshop implicitly.                 | Reassess at M3 against its current authority and source bodies.                    |

The existing selection implementation resolves candidates from available source
boundaries and authored cuts, keeps sibling borders and stops at useful geographic
size. B must connect refinement to these selected views; it must not treat them
as already generated areas or infer new detail from their nesting depth.

## Sulion mapping and current state

| Subplan | Plan ID                                | Pending phase IDs, in order                                                                                                     |
| ------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| B       | `cea5e9bb-a7c7-483f-91c4-3b6d8e50ae41` | B1 `70b28aa8-acf6-4e7a-b8be-7d8cfce26b25`; B2 `bd48069c-1dc4-46c1-974c-8a02cde8349f`; B3 `762bf875-6425-41b4-b93e-96d99dbe6ec3` |
| C       | `28cabe93-883c-427c-beed-7a35ca92c585` | C1 `94249354-cd4f-4910-a64b-a2fc664827b6`; C2 `22863598-50c8-43a5-9538-a0ff72757b7b`; C3 `6f07843c-83fc-4d2a-8212-901046f2dfec` |
| D       | `0316fae6-8ad0-4ea5-87cb-a314ffb2cf92` | D1 `17e2b5fd-c65e-4ac1-bb96-9c91d905eba9`; D2 `54fda285-e864-4459-8e68-bf08d063e363`; D3 `0fb760b2-2ba5-42b5-bf88-4daa8978bab7` |
| E       | `0ec4853b-4446-412e-b623-a1fee7b30799` | E1 `49fbd6f0-2572-4062-8708-72315ae0863d`; E2 `3d89a17f-45f3-4a35-8e06-62b82067364a`; E3 `b8c18448-90cc-459f-81d0-8f238eb69f50` |

The root retains these acceptance milestones; child plans anchor to their listed
coverage. M6 stays on the root for the combined creator flow and final cleanup.

| Milestone | Phase ID                               | State     |
| --------- | -------------------------------------- | --------- |
| H0        | `dff66e05-b874-4d74-8434-77e1d64bee9d` | completed |
| M0        | `53b147e7-4e2b-4f51-820e-16ad21f68462` | pending   |
| M1        | `ba53eff6-343e-4b80-adc6-f9e51e257042` | pending   |
| M2        | `0cb6eac5-7ac9-42a4-92e3-d739f5e3e5d0` | pending   |
| M3        | `2fe47b1a-579b-4cda-9750-16d85d53fbdd` | pending   |
| M4        | `e5f1bc2e-e758-416f-9983-8638e4d3bfc4` | pending   |
| M5        | `cda68b41-8ec6-4873-828e-9fa9403257bb` | pending   |
| M6        | `2361d66b-2daf-463a-b36c-f1205f7833d6` | pending   |

Selection and hierarchy are implemented independently. The remaining 12 child
phases and M0–M6 remain pending. The root and B–E remain open for focused work.
Existing unrelated plans and working-tree changes retain their ownership.

Next action when requested: B1 can establish refinement inputs and output, while
E1 settles authoring policy using the delivered region contract.
Read `sulion plan current`, the shared requirements, the selected subplan body and
affected source bodies before any later expansion or execution. A planning-only
request still does not authorize starting those phases.
