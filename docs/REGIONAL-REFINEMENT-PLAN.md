# Regional refinement and direct map authoring

Status: working design, 2026-10-23. Planning only; no implementation authorized
by the request that created this document. All milestones remain pending.

Sulion root: `6bda9dba-ba6b-468a-a463-4dea05f96155`.

## Outcome and authority

Develop a selected region into recognizable finer geography. A river omitted
from the World map becomes an important regional feature; smaller settlements,
tributaries and landforms appear in plausible locations. The region elaborates
its parent rather than becoming a newly evolved world in a smaller rectangle.
Creators then modify located 2D map layers directly, without reconstructing a
physically consistent simulation underneath every edit.

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
- **Current authorization:** create and track the design durably; do not execute
  the plan. Creating this record does not authorize code changes or publication.
- **Prior user correction:** World and Region are distinct semantic creation
  profiles, with different feature spaces and design criteria. Zooming into the
  World map must not disclose regional features. Source: user turn
  `01a1624c-599c-7bf1-9637-19d90755e636 / 18661021`, available through
  `sulion-retrieve turn`.
- **Project boundary:** browser memory, TypeScript, React/OpenLayers and worker
  generation remain the active architecture. No backend, persistence, MCP,
  recovery or restart mechanisms; see [ADR 0003](adr/0003-frontend-session.md).
- Preserve geographic location, stable identities, authored work and coherent
  connections. Keep creation profiles, geographic extent, numerical detail and
  display zoom separate. Finer development stays sparse and geographically
  anchored; this is not an infinite zoom-generation ladder.
- Preserve distinct Fire, Aurora and Pressure mechanisms. The separate
  [four-pillar workshop](FOUR-PILLAR-INTEGRATION-PLAN.md), Sulion
  `4cdb5d6a-442b-4f36-9fd2-e9371a64d70d`, retains its own design-only authority.
  This plan does not authorize its proposed climate, ecology or history changes.

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

## Proposed design

### Inheritance expresses what is known

Resolve parent and neighboring context into three kinds of information:

- **Established facts:** known places, identities, receiving waters, important
  cross-area connections and already completed events.
- **Broad constraints:** terrain form, watershed organization, substrate,
  climate, ecological character, magic and society distributions.
- **Unresolved detail:** smaller ridges, valleys, tributaries, habitats,
  settlements, routes and local sites that the parent never established.

Existing mapped places deserve stronger location protection than aggregate or
latent estimates. An inherited mountain range establishes its broad form and
character, not every ridge. A known river constrains drainage and connectivity,
not every bend. Do not convert uncertain coarse samples into exact fine truths.
Use approximate physical conditions at interfaces where useful geography needs
them; no exact aggregate matching or universal boundary solver is proposed.

### Regional processes construct detail without advancing time

The provisional sequence is context resolution → terrain/drainage construction
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
using the existing bounded profiles and allowing skipped levels where supported.
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
sections 2.2, 6, 9, 11 and 12, [ADR 0001](adr/0001-spatial-authority.md), and ADR 0003's
child numerical boundary rule. Unified simulation/editing semantics, exact field
preservation and physical reconciliation cannot simply be carried forward as
acceptance criteria for the new map-authoring model.

Keep geographic identity, spatial coherence, authored protection and browser
execution. Determine the narrower contracts that still serve those outcomes.
This planning request does not edit those authority documents; M0 records the
settled changes when later authorized. It also does not revive archived adaptive
or continuous-field rewrites, backend plans or abandoned numerical targets.

## Milestones

All milestones are pending. Dependencies describe future work, not authorization
to begin it. Expand one milestone just before authorized execution, in this same
document. Implementation-specific checks may change when a simpler design meets
the user outcome.

### M0 — Settle refinement and authoring contract

Scope: resolve inherited facts versus estimates, map/procedural authority,
structural-edit classification, lock extent, descendants and shared edges.
Identify the exact specification changes and minimal retained context needed.

Acceptance: concrete examples explain revealing a river, creating a tributary,
materializing a town, moving a river, editing a shared crossing, changing only
styling, and developing a child of an authored region. Unresolved proposals stay
distinct from user requirements; no numerical reconstruction is presumed.

Evidence: review those creator scenarios and the relevant source bodies; revise
the working design and applicable architecture contracts under the authorization
then in force. No runtime implementation is part of this milestone.

### M1 — Separate procedural context and mapped output [depends on M0]

Scope: establish the minimum in-memory ownership and translation boundary using
the existing domain, generation/publication, spatial reads and worker contracts.
Inventory and retain only inputs required by concrete refinement processes.

Acceptance: a mapped feature can identify its generating context without an edit
being mistaken for a physical input. Untouched context supports regional work;
profile-aware reads preserve World/Region separation. Existing identity,
authorship, undo and worker result handling remain coherent.

Evidence: focused ownership/publication/read checks, including an edited feature
and an untouched neighboring area. Do not build a generic provenance framework.

### M2 — Generate regional terrain and drainage [depends on M1]

Scope: replace regional physical epoch replay with conditioned landforms,
retained-river elaboration and new connected tributaries. Resolve upstream input,
receiving water, coastline and neighboring continuity for selected extents.

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

Scope: develop smaller settlements, routes, land uses and sites using retained
society and refined geography. Preserve known centers and separate located urban
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

Scope: replace world-style regional configuration with useful regional choices
and inherited context; connect selection, generation, map editing and finer
development in one creator flow. Retire superseded regional paths and guidance.

Acceptance: a creator selects a region, generates convincing finer geography,
edits its map and continues according to the settled generation boundary. World
and Region retain distinct feature spaces at all zooms. Untouched finer areas
can develop from their regional context without restarting world history.

Evidence: inspect the full river/relief/town example, neighboring regions and an
authored region; run proportionate domain/browser regression checks. Measure
representative generation and interaction cost and report variability; no new
hard budget, runtime cap or reduced feature coverage follows from a target.

## Open decisions and assumptions

| Item                                                    | Recommendation / uncertainty                                                                                                                                                                                      | Owner and decision point                                                           |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Generation after structural edits                       | Start with the affected mapped area locked. Whole-world locking is disproportionate; automatic inverse simulation is unnecessary. Layer-specific or constraint-driven continuation is a possible later extension. | User-owned workflow choice; settle in M0 before M1/M5 encode it.                   |
| Existing children and shared crossings                  | Preserve authored maps and their links without pretending procedural context changed. Exact behavior for children, neighbors and edits spanning areas needs concrete creator scenarios.                           | User-visible semantics in M0; implementation follows the settled rule.             |
| Further automatic development inside an authored region | Initially allow manual child development; do not promise procedural refinement from an arbitrary edited map. Determine whether this restriction fits the desired successive-refinement workflow.                  | User-owned scope choice in M0; affects M5/M6.                                      |
| Inherited detail sufficient for refinement              | Existing fields, drainage and latent society appear useful, but source graphs and below-sample geography are not necessarily retained. Add only demonstrated missing inputs.                                      | Technical investigation in M0/M1; regional behavior in M2–M4 tests the assumption. |
| Precise synthesis algorithms                            | Conditioned multiscale terrain and constrained drainage are starting proposals. Choose algorithms through representative geography rather than numerical parity.                                                  | Implementation design in M2, within the agreed product contract.                   |
| Four-pillar evolution                                   | Its design may change the world context consumed here. Consume the agreed implemented mechanisms; do not make this plan wait on every speculative addition or implement that workshop implicitly.                 | Reassess at M3 against its current authority and source bodies.                    |

## Sulion mapping and current state

| Milestone | Phase ID                               | State   |
| --------- | -------------------------------------- | ------- |
| M0        | `53b147e7-4e2b-4f51-820e-16ad21f68462` | pending |
| M1        | `ba53eff6-343e-4b80-adc6-f9e51e257042` | pending |
| M2        | `0cb6eac5-7ac9-42a4-92e3-d739f5e3e5d0` | pending |
| M3        | `2fe47b1a-579b-4cda-9750-16d85d53fbdd` | pending |
| M4        | `e5f1bc2e-e758-416f-9983-8638e4d3bfc4` | pending |
| M5        | `cda68b41-8ec6-4873-828e-9fa9403257bb` | pending |
| M6        | `2361d66b-2daf-463a-b36c-f1205f7833d6` | pending |

The initial read-only source review and this working design are recorded. No
implementation milestone or execution expansion has started. Existing unrelated
plans and working-tree changes retain their ownership.

Next action: continue the M0 design discussion when requested, especially the
generation boundary after structural edits. Read `sulion plan current`, this
document and affected source bodies before any later expansion or execution.
