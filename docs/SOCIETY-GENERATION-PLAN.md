# Society generation — working design

Status: bounded society feedback repair implemented, 2026-10-23. The earlier
M1–M4 completion claim did not establish the agreed iterative behavior; the
correction below supersedes it. B1 remains deferred and excluded from delivery.
This document holds the design, research, open decisions and proposed milestones.

Sulion root: `e74959cf-4d0a-491a-b247-40fe6316d698`.
Repair plan: `1f6ee3d8-9ece-42d5-b31b-55477d263691`. Future four-pillar work
requires separate design.

### User correction — population evolution, 2026-10-23

The user rejected uniform settlement placement and population as an incorrect
implementation of the agreed model. Populations must evolve through repeated
interactions with their surroundings. Cosmetic variation in settlement placement
or population does not fulfill that requirement. The previous implementation
advanced an entire era's growth and migration once before environmental feedback;
the default single era never returned those consequences to population evolution.
Its accounting and publication checks were insufficient evidence of completion.

The repair retains the agreed aggregate boundary. Numerical catchments represent
support and possible movement destinations; they are not mandatory towns. Sparse
starting populations occupy suitable country. Each era repeats population change,
conservative migration, contact, works, distinct magical use, environmental
response, hazards, settlement occupation and political change. The changed state
feeds the next cycle, including finite resource exhaustion and changed access.

Current implementation choices, not additional user requirements:

- Use steps of at most ten years to resolve feedback within a human era. Divide
  the supplied duration exactly; do not repeat the whole era per step. Accumulate
  isolation, control tenure and political disruption across steps. Keep authored
  events once-only and allow separate generated disturbances in subsequent steps.
- Locate numerical catchments according to support and map scale, independently
  of requested culture or polity counts. Settlement concentration responds to
  local livelihoods, population density and reachable neighboring population.
  Establishment, abandonment and recovery retain identity and founding history.
- Settlement residents are a subset of the joint demographic groups. Publish
  actual settlement population separately from rural and catchment totals. Never
  publish an unoccupied candidate as a town. Refinement allocates rural residents
  by overlap and retains concentrated residents at their settlement location.
- Retain local population, support and occupation at each cycle for inspection.
  Aggregate births, deaths and transfers into one record per configured era.
  Completed history and protected facts remain intact on edits and refinement.
- Reuse environmental operations for new human time. Read current numerical river
  state during feedback; defer cartographic extraction until the era's end.
  Do not redesign or balance the other pillars to complete this repair.

Acceptance must include causal trajectories: a finite heat supply can support
growth and its exhaustion can cause decline in the same era; migration establishes
reachable places while barriers prevent settlement; loss and recovery of support
can abandon and reoccupy the same place. Check representative default maps and
their size distributions as well as conservation, determinism and authoring.
These are scenarios to verify mechanisms, not mandatory events in every world.

### Scope correction — 2026-10-23

The user explicitly directed delivery of society in a bounded context and rejected
starting four-pillar integration without its own design and goals. The earlier
claim that “execute all phases” authorized B1 was incorrect. B1 investigation
stopped before runtime changes; its execution expansion has been withdrawn.
Do not redesign or balance geology, physical generation, magic or ecology to finish
society. Backlog item 10 remains open for separately scoped work.

## Execution decisions — 2026-10-23

The instruction to execute all phases supersedes the earlier planning-only notes.
The following implementation choices resolve the workshop recommendations within
the accepted requirements; they remain revisable from implementation evidence.

- D1/D2: use located population groups with explicit demographic and affiliation
  combinations, including optional environmental traits. Counts refer to people;
  language/religious membership can overlap without adding people. Starting
  communities and environmental works are located authoring inputs. Present edits
  retain completed history; historical anchors are explicit causes.
- D3/D6: use existing ecological quantities, water/channel access and terrain
  connections. Human eras supply elapsed time, mobility and political capacity.
  Processes share state and retain causes through the existing worker runner.
- D4/D5: culture, language, faith and practices have independent identities;
  contact changes affiliation without requiring migration. Political reach,
  sovereignty, administration and claims remain distinct from those identities.
- D7: finer areas inherit represented people and their identities; refinement
  does not replay completed human eras. Located works retain geographic anchors.
- D8: implement the source-backed Fire core, Aurora crystal/memory and Pressure
  deep-access operations described below, with aggregate access, use and costs.
  These mechanisms do not import setting names or prescribe cultures' beliefs.

### M1 execution expansion

1. Add typed population state, ecological support and conservative movement over
   terrain connections. Reuse sampled geography and the retained channel network.
2. Wire initialization and elapsed population processes into the shared sequence;
   publish populated settlements with supporting conditions and history.
3. Verify accounting, blocked movement, authored starts, determinism and worker
   publication. Existing baseline: 11 people/process-binding tests passed.

Primary files: domain society types; generation society support, population and
publication modules; atlas workflow/module registration; focused generation tests.
Remaining milestones will be expanded at their start, preserving their full scope.

M1 expansion: `763c0c8e-abb2-4dd0-a892-d96bf909d826`, completed.
Evidence: nine population/module checks pass, including accounting, water-separated
communities, protected authored population, history retention and atlas publication;
TypeScript and focused lint passed. Settlement counts followed initialized
catchments instead of the previous eight-place limit. That did not establish
the required settlement evolution. Useful society defaults and causal feedback
belong to society delivery; cross-pillar redesign and balance remain B1 work.

### M2 execution expansion

1. Initialize independent cultural, language and religious identities in the
   population groups; carry all affiliations through migration. Add elapsed
   contact diffusion and geographic divergence without autonomous actors.
2. Publish prevalence fields and located institutions through existing bindings;
   preserve population totals and independent cultural/political selection.
3. Verify connected/isolated communities, multilingual membership, identity
   continuity and generated workflow publication. Primary files: society cultural
   processes/publication, human feature registration and focused tests.

M2 expansion: `f317b4d7-22d5-4556-8653-bd30f1424aec`, completed. Eight
cultural/process-binding checks and fourteen population/people/workflow checks
pass, including joint multilingual membership, isolation/ancestry and combined
cultural/built publication. Specific magical social practices follow in E1.

### E1 execution expansion

1. Represent located works and their maintained condition; apply water, terrain,
   land-use and animal effects to process state and refresh affected dependencies.
   Reuse physical routing, water boundaries and ecology at new human-era elapsed time.
2. Implement separate finite core supply/use, crystal charge/readers/memory access,
   and depth-limited Pressure practice; refresh their physical pathways and derive
   distinct triggered hazards, casualties, displacement and damaged works.
3. Publish inspectable works and consequences; check downstream water, ecological
   response, protected geography, finite resources, distinct interactions and
   retention of completed history. Broad magic/ecology repair stays in B1.

### M3 execution expansion

1. Carry polity seats, support, claims, sovereignty and effective control between
   human eras. Geographic reach uses the same traversable community graph as migration.
2. Let loss of support and damaged seats reduce control and produce successor
   identities; preserve populations, cultures and older claims. Recover viable ruins
   through surviving connections. Institutions modify aggregate reach and support.
3. Publish separate sovereignty, administration, control and claims; verify a stable
   case, disruption and recovery, then restore politics to the full-world test.

These mechanisms are implementation choices within M3, not new actor simulation requirements.

### M4 execution expansion

1. Reuse present society records on reruns; subdivide parent catchments by area
   during refinement, preserving joint groups and ancestry. Refinement does not
   run human eras again. Surface retained minor channels within child extents.
2. Synchronize settlement edits with domain society state. Provide readable
   composition, support, magic resources and historical causes in the inspector;
   expose era political capacity and physical regime alongside duration/mobility.
3. Verify protection, independent domain selection, inherited totals, and browser
   authoring. Located works/events and group attributes use existing feature editing.

### Bounded delivery

Population, affiliations, politics, works, events and practice resources live in
`world.societies`, indexed by area. The society processes consume the existing
geographic fields and retained drainage, carry aggregate state through human eras,
and publish settlements, routes, institutions and distinct political territories.
E1's focused refreshes support society-owned works; they are not a redesign of the
environmental generators or evidence of balanced interaction among all four pillars.

Present edits update retained society state without rerunning completed eras.
Child-area generation inherits people by catchment overlap and retains identities
and history. Era configuration, population groups, works and inspection use the
existing browser authoring workflow. Defaults and optional shaping remain the entry
points; there is no actor simulation or continuously advancing history.

## Outcome and authority

Replace placeholder human geography with an iterative, process-based geographic
generator comparable in abstraction to the existing ecology, physical and magical
generators. Carry population, demographic composition, cultural influence and
political geography through human eras, producing communities, routes, institutions,
settlements, territorial relationships and historical remains that creators can
inspect and shape. Societies alter water, terrain, ecology and the three authored
magic systems, and respond to their opportunities, hazards and lasting changes.

### User requirements

The 2026-10-22 request asks for significantly deeper population, culture,
demographic and political generation, combining iterative procedural generation
(including societal rise/fall and diffusion) with shaping. It asks for research
into comparable systems, including Dwarf Fortress and fantasy map makers.
The subsequent request authorizes establishing a plan for continued workshop.

The initial research response and plan proposed more simulation machinery than
the task needed. After reviewing existing process implementations, the agent
recommended the correction below. The user accepted it with “yes, revise the plan
with your corrected understanding.” Other mechanisms, examples and data shapes
remain proposals.

### Accepted correction — 2026-10-22

- Use aggregate geographic processes and retained state, with ecology as the
  closest implementation precedent. Historical consequences arise as successive
  processes change the same world.
- Retain population and demographic change, migration, cultural/language/religious
  diffusion, political expansion/consolidation/fragmentation, recovery and shaping.
- Remove annual accounting, detailed age-cohort simulation, household budgets,
  taxation, autonomous faction agendas, ruler selection, succession simulation
  and individual military campaigns from the proposed core. They are not needed
  to establish the requested geographic behavior.
- Keep institutions and political relationships as meaningful entities and
  geographic influences without giving each an autonomous decision-making system.
- Useful results should come from defaults. Generate starting populations and
  identities automatically; expose broad optional influences and direct shaping.
  Internal calibration is implementation work, not a prerequisite task for creators.
- This is a scope and abstraction decision, not a measured runtime or visual-quality
  claim. Default quality and useful parameter ranges still need implementation
  evidence. Reintroducing the removed simulation scope requires new user direction.

The earlier proposal treated annual economy and actor simulation as open design
choices. This correction replaces those choices while preserving the requested
societal behavior. It does not reduce the task to static labels or radial spreads.

### Accepted environmental feedback and magic correction — 2026-10-22

The user requested dams, cleared passes, reinforced bays, overhunting/conservation,
society interaction with magic, and environmental effects on societies including
avalanches, tsunamis, abundance and destructive magical events. They accepted the
two-way feedback proposal while rejecting its generic treatment of magic.

- People must change actual geography and ecology; physical and magical changes
  must affect population, settlement, access and political/cultural development.
- These processes may run during human eras after initial world generation.
  Fully interleaving them with geological history is not required. Completed
  physical epochs remain intact.
- The current Fire, Aurora and Pressure systems from `../the-canonry-game`
  are first-class world effects and processes. Read their motivations and mechanisms;
  do not substitute generic abundance, wards, arbitrary source modifiers or
  explosions. The previous magic proposal is superseded below.
- The user's subsequent clarification keeps future magic systems open and
  excludes imported named lore. The previous revision went too far by treating
  the three systems as a closed set and carrying setting content into requirements.
  Preserve concrete mechanisms through shared contracts and system-specific
  processes; future extensions must not flatten their behavior. Do not build a
  speculative extension framework as a prerequisite for the current systems.

The concrete operations and milestone checks below originated as proposals
implementing this direction. Society implementation was subsequently authorized;
a full economic, practitioner or historical actor simulation remains excluded.

### Accepted sequencing correction — 2026-10-23

Complete society generation before addressing backlog item 10 or the other
cross-system gaps. The user reversed the review's proposed prerequisite order:
establish a functioning society pillar alongside magic, physical processes and
geology, then perform their interconnection and balance pass.

- Deliver M0 → M1 → M2 → E1 → M3 → M4. B1 requires separate design and authorization.
- E1 remains part of society completion. Dams, passes, coastal works, land use,
  hunting/conservation, environmental hazards and distinct Fire, Aurora and
  Pressure interactions are not postponed to B1.
- [Backlog item 10](backlog.md), including the wider magic/ecology rework and
  ecological disturbance/default-quality gaps, belongs to the subsequent
  four-pillar pass. It is not a prerequisite for M1 or E1.
- Society should consume existing environmental state and implement the feedback
  it needs. Do not conceal environmental defects with compensating population
  multipliers or treat favorable society-only examples as proof of final balance.
  Useful society defaults remain required; whole-world balance is evaluated in B1.

This sequence supersedes the earlier review recommendation to repair the wider
ecology/magic gaps first. The later execution request covers society; the latest
scope correction explicitly excludes starting B1.

### Existing product boundaries

- [Product specification](product-spec.md), especially sections 7.3, 10.4–10.6
  and 11: overlapping cultures, languages and religions; distinct sovereignty,
  administration, claims and effective control; independent cultural/political
  selection; inherited identities and meaningful refinement.
- [ADR 0003](adr/0003-frontend-session.md): browser-session memory and worker
  generation. No backend, persistence, MCP, saved execution, restart or recovery.
- Completed history is retained generation context. Ordinary editing changes
  the present. This plan does not add continuously advancing time or an interactive
  historical timeline editor.
- [Generation workflows](generation-workflows.md) and [AGENTS.md](../AGENTS.md):
  deterministic processes share working state, declare dependencies, preserve
  authored protection and spatial interfaces, and publish validated results
  atomically. Read the Canonry reference before extending its process structure.
- One world owns entities and geography across scales. A culture is not a state;
  a political jurisdiction is not a generation patch.

## Pre-implementation inventory and reuse

Read during the 2026-10-22 research and plan setup:

| Source                                                                 | Observed behavior or role                                                                                                                                                                 | Design implication                                                                                                                   |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/generation/src/mapPeople.ts`                                 | Culture uses radial Gaussian prevalence; era years multiplied by mobility become one spread distance. Politics selects nearest centers, copies territory into control and buffers claims. | Replace the historical behavior, while retaining applicable publication and identity mechanisms.                                     |
| `packages/generation/src/mapBuilt.ts`                                  | Macro settlement generation selects at most eight suitable, separated points and connects roads.                                                                                          | Settlement existence, size and function should consume demographic and historical state. Site/interior layout is a separate concern. |
| `packages/generation/src/generationSettings.ts` and `atlasWorkflow.ts` | Human-era settings exist; diagnostics identify physical-epoch linkage and political capacity as compatibility metadata.                                                                   | Resolve meaningful era semantics instead of treating existing settings as implemented simulation.                                    |
| `packages/generation/src/process.ts`                                   | Shared state, process contracts, epoch sequences, deterministic randomness, causes and publication lifecycle.                                                                             | Integrate society operations into the existing runner; determine typed additions from actual processes.                              |
| `frontend/src/generationHumanEras.ts` and generation workflows         | Existing era configuration and worker/session entry points.                                                                                                                               | Extend the current creator flow rather than introducing a separate simulation application.                                           |

There is an older [R3 historical human geography plan](ATLAS-PLAN.md#r3--historical-cultural-and-political-geography-depends-on-r1-r2),
with Sulion execution record `3e4796e4-9859-48fd-89b7-4528d1ea1777`.
Its body describes finite demographic counts, conservative migration, separate
affiliations, supply frontiers and inherited history. It also refers to historical
API/MCP integration. Its implementation/completion claims have not been verified
against the current frontend and differ from the inspected active generators.
Preserve it as a possible source of mechanisms to inspect; do not revive its
backend architecture or assume its completed status establishes current behavior.

The continuous-field redesign previously described here was rolled back in
`5f89906`. Current generation uses sampled process state and contour/river
extraction; do not depend on the abandoned prepared-field interfaces or make
their replacement a society prerequisite. Re-read current interfaces before
implementation without freezing their storage shape into society concepts.

### Biome, drainage and coastline review — 2026-10-23

The following findings inform the proposed integration details in M1, E1 and M4.
They do not add a separate environmental remediation milestone before society.

| Current evidence                                                                                                                                                                                                                                                                           | Implication for society                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `965fd7f`: [biome rules](../packages/generation/src/canonry/ecologyBiomes.ts) and [feature extraction](../packages/generation/src/canonry/ecologyFeatures.ts) derive named regions from cover/environmental quantities and omit small patches.                                             | M1 derives supporting capacity, livelihoods and movement from ecological quantities, soils, water and animals. A missing biome polygon does not mean empty or unusable land. E1 changes ecological state before republishing descriptive regions.                          |
| `9f35037`: [retained drainage](../packages/domain/src/drainage.ts) and [river extraction](../packages/generation/src/canonry/atlasFeatures.ts) keep all generated channel reaches, including those filtered out of mapped rivers, with downstream links, discharge and catchment profiles. | M1/E1 use the channel network for water access and downstream consequences. It is not every runoff cell or a substitute for the hydrological processes. M4 must implement inheritance from this network; its presence alone does not establish working refinement.         |
| `666ef99`: [flow guidance](../packages/generation/src/canonry/flowGuidance.ts) changes downhill routing; [river paths](../packages/generation/src/canonry/riverPaths.ts) separately relax and curve mapped channels.                                                                       | Locate works against mapped geography and associate them with physical flow/topology. Moving a curve does not dam or divert water. Reach links are array indices, so works need geographic associations that survive regeneration and refinement rather than bare indices. |
| `39fcd5c` and `965fd7f`: [water footprints](../packages/generation/src/canonry/geographicContours.ts), river-mouth clipping and biome exclusions use generated water boundaries. Ocean membership distinguishes connected water from enclosed low ground.                                  | E1 refreshes water connectivity, shorelines, mouths and ecological exclusions together after works. Harbor access depends on connected water, not elevation below sea level alone. Preserve consistent boundaries across presentation and process consumers.               |
| [Ecology advancement](../packages/generation/src/canonry/ecologyProcesses.ts) skips inherited physical workspaces.                                                                                                                                                                         | E1 needs an explicit path for newly elapsed human-era ecological response. Reuse the process mechanisms while preserving the distinction between advancing time and refining completed history; removing the guard wholesale would replay effects.                         |

Backlog item 10 records ecological quality problems observed in a Draft world.
The review did not reproduce those measurements or establish the absence of all
indirect magic effects; existing disturbance algorithms do not establish useful
default behavior either. Preserve those issues for B1. During society development,
use representative controlled environmental inputs where needed to distinguish
society behavior from known input defects, and disclose limitations in generated
worlds. Do not tune society around the defects or declare the later balance done.

## Research and implications

### Existing atlas processes are the primary precedent

The complexity review read representative implementation bodies, not just process
names. It was a source review, not an exhaustive audit or runtime benchmark.

| Source                                                                                        | Observed mechanism                                                                                                                                                          | Society design implication                                                                                                 |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `canonry/ecologyVegetation.ts`, `ecologyGrowth.ts`, `ecologyMovement.ts`, `ecologyAnimals.ts` | Ordered soil/disturbance/dispersal/growth/animal response; aggregate competition and migration; elapsed-time growth functions rather than annual geological-time iteration. | Evolve populations and distributions through processes with explicit transfers, environmental response and retained state. |
| `canonry/fluvial.ts`, `glacialEvolution.ts`                                                   | Repeated erosion and routing, material transport, deposition and accumulated consequences.                                                                                  | Recompute accessibility and settlement attraction as geography changes; keep consequences across iterations.               |
| `canonry/magicPropagation.ts`, `magicFeedback.ts`                                             | Geographic propagation, feedback into physical conditions and retained influence across epochs.                                                                             | Derive cultural contact, political reach and lingering historical influence through geographic operations.                 |
| `canonry/atlasSequence.ts`                                                                    | Ordered processes refresh climate, drainage and ecology as upstream geography changes.                                                                                      | Compose society processes within the existing runner and declare the dependencies that need refreshing.                    |
| `canonry/atlasProfile.ts`, `domainCartography.ts`                                             | Internal defaults are mapped from broad creator choices.                                                                                                                    | Supply calibrated defaults; make detailed coefficients optional rather than required configuration.                        |

Paths above are relative to `packages/generation/src/`. Political splits and
successor identities add domain complexity beyond a scalar ecology field. That
does not justify adding autonomous historical actors or detailed economic simulation.

### External references

These sources were read during the preceding research turn. They establish the
described mechanisms, not a comprehensive audit of current game implementations.

Borrow specific mechanisms from these references within the accepted atlas
boundary. Worlds and Dwarf Fortress are not architectural targets for a full
history simulator. In particular, the earlier suggestion to take Worlds' faction
simulation as the central structure is superseded by the ecology precedent above.

| Reference                                                                                                                                                                       | Mechanism established by the source                                                                                                       | Proposed use and limit                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dwarf Fortress: [2013 population and refugee work](https://www.bay12games.com/dwarves/dev_2013.html), [2014 world activation](https://www.bay12games.com/dwarves/dev_2014.html) | Abstract populations coexist with historical figures; births, deaths, succession, foundation, reclamation and invasions change the world. | Retain communities and consequences across events; individual simulation everywhere is unnecessary for the initial proposal.                                                                                                  |
| Azgaar: [culture generation and expansion costs](https://github.com/Azgaar/Fantasy-Map-Generator/blob/master/docs/wiki/Culture-types.md)                                        | Competitive expansion accumulates biome, height, water, river and coastal costs modified by culture type.                                 | Geographic access is useful; exclusive cell assignment does not satisfy overlapping cultural distributions.                                                                                                                   |
| Worlds: [project description](https://drtardigrade.itch.io/worldhistorysim), [clan splitting](https://drtardigrade.itch.io/worldhistorysim/devlog/124184/clan-split-event)      | Population groups spread and diverge, form polities, and interact with faction preferences and administrative load.                       | Borrow aggregate spread and political fragmentation; do not adopt its actor simulation. Cities, religions and substantial economic features are listed as planned on the project page.                                        |
| Caves of Qud: [authors' history-generation paper](https://pcgworkshop.com/archive/grinblat2017subverting.pdf)                                                                   | Events change shared entities; grammars express accounts through cultural artifacts. Event causes may be rationalized after selection.    | Connect history to sites, artifacts and cultural expression. Explanations of simulated outcomes must use recorded causes; distinguish fictional accounts from those causes.                                                   |
| Cultural dissemination: [Lanchier's Axelrod-model analysis](https://arxiv.org/abs/1004.0365)                                                                                    | Shared traits affect interaction, which can transmit another trait; convergence or fragmentation can result.                              | Selective transmission is preferable to indiscriminate averaging. Similarity alone can freeze exchange; institutions, trade and migration need consideration. This is a model reference, not a universal theory of societies. |

## Working proposal

The generator boundary above is agreed. The process breakdown and data shapes
below are implementation proposals within that boundary, open to workshop.

### Social concepts

Use geographically located communities as the population foundation, with rural,
urban and mobile forms. Separate demographic composition from shared identities,
institutions and authority.

| Concept     | Proposed responsibility                                                                      |
| ----------- | -------------------------------------------------------------------------------------------- |
| Community   | Aggregate population, demographic composition, residence, mobility and supporting conditions |
| Culture     | Identity, practices, ancestry, regional variation and historical relationships               |
| Language    | Speakers, multilingual use, related varieties and institutional use                          |
| Religion    | Adherents, practices, sacred places, institutions and schisms                                |
| Polity      | Government, resources, jurisdiction, political relationships, claims and control             |
| Institution | Located cultural or political influence, affiliations and historical continuity              |
| Settlement  | Located population, functions, infrastructure, dependencies and occupation history           |

Start with population quantities and mixtures of relevant identities and
affiliations. Do not require an age-cohort or household model. The representation
must preserve requested demographic combinations rather than manufacturing joint
distributions from unrelated percentages. Multilingualism and overlapping
affiliations have different semantics from exclusive population partitions. A
cultural prevalence field and a named community describe the same people without
double counting. The exact typed representation remains implementation work.

Fantasy peoples may have optional aggregate environmental and growth traits with
usable defaults. Culture, religion, political affiliation and moral behavior do
not follow automatically from biology. Which peoples and demographic distinctions
the creator needs to author remains a workshop decision.

### Historical processes and feedback

Initialize the shared society state once, then repeat a process sequence through
human eras, carrying the changed state forward. Candidate operations are:

1. Derive population-supporting conditions from land, water, ecology, access,
   settlement infrastructure and the distinct Fire, Aurora and Pressure conditions.
   Represent livelihoods and exchange through
   aggregate suitability and connectivity rather than household or commodity accounts.
2. Grow or reduce populations according to those conditions; transfer migrants
   toward reachable opportunities, retaining their demographic composition.
3. Diffuse practices, language and religion through contact. Retain mixed
   communities and allow divergence or new identities when the modeled conditions
   support them.
4. Grow, establish or abandon settlements and connections according to population
   and access. Apply land use, extraction, conservation and geographic works,
   including the system-specific magical practices described below.
5. Refresh affected water, terrain, ecological and magical processes. Resolve
   geographically grounded disturbances and benefits, changing population support,
   settlements, routes and exposure. Carry surviving people and displaced groups
   forward; do not count the same casualties or migration twice.
6. Expand, consolidate, contest or fragment political geography according to
   reach, population support, connectivity and accumulated strain.
7. Retain communities, identities, infrastructure, abandoned sites and claims;
   let recovery and subsequent expansion act on those consequences.

Each process reads the altered state left by preceding operations. Internal
iterations resolve feedback where needed, as erosion and ecology do. Era duration
can scale growth, travel and decay responses; it does not mandate one tick per year.
Exact step sizes, ordering and numerical methods remain implementation choices to
assess against geographic behavior. Geological history supplies relevant context
without becoming an annual society simulation.

Migration transfers people along accessible paths and changes source/destination
counts. Diffusion changes practices or affiliations through contact without
necessarily moving people. Conquest changes political authority without necessarily
changing either population or culture. Ports, passes, roads, rivers and configured
magical connections affect contact differently.

Political change needs concrete geographic mechanisms. For example, loss of a
route reduces reach; poorly connected territory accumulates strain; connected
groups of settlements can become successor polities. Institutions can influence
support, contact or reach through aggregate effects. Claims can retain historical
extent after control retreats. No faction negotiation or campaign simulation is
required to produce these outcomes.

Collapse preserves surviving people, cultures and infrastructure. Recovery follows
improved supporting conditions, renewed connections and consolidation. Avoid a
universal collapse timer, random border repainting or an inevitable government
progression. The exact strain and fragmentation rules are proposals to develop;
keep explanations tied to the causes actually modeled.

### Society, environment and magic feedback

Run these operations within human eras over the inherited present landscape.
Select interventions from located needs, available materials, knowledge, access
and aggregate institutional capacity. A settlement need not attempt every work.
Creators can place, shape and protect the same works that generation produces.

| Human activity                            | Geographic change and returned consequence                                                                                                                                                      |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dams, weirs and irrigation                | Retain water upstream, route releases and overflow, change downstream supply and aquatic habitat. Damage or neglect can cause a breach; abandonment does not instantly erase a reservoir.       |
| Pass clearance, road cuts and bridges     | Change local terrain, obstacles and route connectivity. Cuts can change slope exposure; opening a pass changes migration and political reach without flattening the mountain range.             |
| Reinforced bays, breakwaters and dredging | Change harbor shelter, coastal barriers and local bathymetry. Refresh affected coastal and Pressure propagation rather than assigning a universal port-protection bonus.                        |
| Farming, logging and restoration          | Change cover, habitat, soils and runoff. Carry erosion, fire exposure and ecological succession into subsequent steps.                                                                          |
| Hunting and conservation                  | Remove animals from the existing aggregate populations or reduce extraction and protect habitat/connectivity. Recovery follows the ecological processes; conservation does not conjure animals. |

Retain the intervention's footprint, condition, dependencies and history. Broad
generation represents its geographic effects; finer generation elaborates the
structure under the same identity. Maintenance depends on continued occupation,
access and capability, without individual workers or construction accounts.

#### Magic sources and evidence

The design below comes from reading the reference's
[lore bible sections 7–9](../../the-canonry-game/docs/lore/lore-bible.md#7-the-three-fires--magic-system),
[Three Fires](../../the-canonry-game/docs/lore/encyclopedia/three-fires.md),
[Fire Keepers](../../the-canonry-game/docs/lore/encyclopedia/fire-keepers.md),
[Ice-Memory](../../the-canonry-game/docs/lore/encyclopedia/ice-memory.md),
[Dead God](../../the-canonry-game/docs/lore/encyclopedia/dead-god.md),
[Wake-Singers](../../the-canonry-game/docs/lore/encyclopedia/wake-singers.md) and
[Deep Ice Corruption](../../the-canonry-game/docs/lore/encyclopedia/deep-ice-corruption.md).
The [physical generation design sections 8–11](../../the-canonry-game/docs/design/physical-microgeography-worldgen.md#8-fracture-network-and-fire)
and `FireFieldLayer`, `AuroraFieldLayer`, `PressureFieldLayer`,
`FireClimateFeedbackLayer`, `MagicRockResistanceLayer`,
`PressureCoastFeedbackLayer` and `MagicInteractionLayer` establish the geographic
operations under `src/IceRemembers.Seed/PhysicalGeneration/Layers`.

These links identify research sources, not content to import. Named gods,
characters, peoples, factions, artifacts, places and historical events remain in
the reference setting. Use Fire, Aurora and Pressure as functional system names.
Social uses and practitioner costs below are adaptation proposals; named lore and
the reference's cultural ownership do not become atlas requirements. Additional
systems may introduce their own state, effects and processes through the shared
generation structure without reducing the current three to generic modifiers.

The current atlas's `magicPresets.ts`, `magicPropagation.ts`, `magicOcean.ts` and
`magicFeedback.ts` retain core propagation and physical feedback. They do not
establish the social operations proposed here. A field intensity is not a mined
core inventory, a crystal charge or a population of trained readers.

**Captured Fire: geothermal deposits, extraction and release.** The reference
describes fire-cores as mineral formations storing compressed geothermal energy.
Controlled cracking releases that energy through contact. The geographic
field follows conductive fractures, heats and melts its surroundings, and bakes
rock harder. Proposed use costs include burns and cumulative injury; uses include
heating, forging, cutting and destructive excavation.

Proposed society operations: establish mines on reachable veins; retain aggregate
extractable deposits and usable core supply; carry supply along connected routes;
consume it at heating works, forges and excavation sites. This limited resource
state is justified by the medium itself, not a general commodity economy. Do not
turn intensity directly into unlimited fuel, or treat extraction as extinguishing
the underlying geothermal source. Deposit recovery rates require separate physical
justification; daily or era-based automatic replenishment is not assumed.

Controlled use can open a frozen pass or support a cold settlement. Bad releases
can collapse tunnels, rupture works or burn a town. Heating and excavation change
ice, water and local terrain; subsequent processes consume those changes. Supply
loss can freeze a route and displace dependent communities. Extraction knowledge
and route control give institutions geographic power. Represent injury and lost
working capacity in aggregate, without simulating individual practitioners.

**Aurora-light: cold reservoirs, crystals and witnessed memory.** Geographic
Aurora flows toward colder terrain, accumulates in thick ice and weakens rock.
Aurora-crystals collect and store charge; practitioners use slow attunement for
reading impressions recorded in ice, distant seeing and preserving memory.
Cognitive strain from sustained use is a proposed social cost. Its perceptive
role does not imply combat casting or a generic growth/energy bonus.

Proposed society operations: harvest crystals where the geography supports them;
establish prismatic collection works, cold repositories, observatories and
archives. Track aggregate crystal availability, charge/use and reader capacity
separately from the regional field. Excavation or Fire-heating can remove cold
storage, change Aurora distribution and damage accessible memory-bearing ice;
preserving those sites protects both the material and the institution's purpose.
Collection efficiency and the effects of removing crystals need explicit local
rules, not a blanket increase/decrease of all Aurora intensity.

Reading and distant seeing can improve route knowledge, hazard warning and
institutional reach. Ice-testimony and archives can support law, religious
practice and contested historical claims. Benefits depend on access and trained
readers, whose sustainable capacity can reflect rest and cognitive strain.
They do not grant perfect foresight, certain interpretation or automatic political
legitimacy. Physical damage to an archive affects in-world access to memory;
it never deletes the atlas's retained causal history. Cultures choose practices
around these affordances; exposure does not force a single religion or government.

**Pressure: deep access and ocean transmission.** The
geographic source is a deep-basin locus. Ocean-connected propagation, reflections
and overlapping rays produce crush zones, wakes and coastal stress. The lore's
practitioners descend into deep water and return carrying charge, using subsonic
communication and directed force. Sustained-use costs are a social adaptation
to design; the reference's named cosmology is not needed for these mechanisms.

Proposed society operations: locate diving and song sites by reachable depth,
ocean connectivity and exposure; derive communication routes and maritime reach
from those conditions. Access depends on actual depth tolerance and means of
reaching the source, not an imported species list or religious affiliation.
Record aggregate use, available practitioners and use costs without modeling
individual minds or assuming every settlement can create a pressure source.

Coastal engineering changes the geometry through which existing Pressure travels
and the places exposed to it. Deep-water practices can apply located directed
force; they do not move the deep-ocean source or replenish an arbitrary mana
pool. Habitat, navigation and hunting respond to the resulting ocean conditions.
The prior proposal to import a named supernatural current and its offering rites
is withdrawn. Any additional current-heating mechanism needs its own physical
definition rather than assuming the reference setting's cosmology.

**Interference retains its specific causes.** Fire and Aurora interfere rather
than forming a stronger combined spell; carried Pressure dissipates near
Aurora-crystals; Pressure relics used in Fire forges have destructive outcomes.
At landscape scale, thermal war rims occur where Aurora meets Fire-thawed ground,
steam fractures where Pressure meets Fire veins, and Pressure/Aurora breaches
where Pressure reaches charged coastal ice. These supply distinct exposure and
engineering constraints, not one generic magical-instability score. Geographic
feature flags indicate conditions; an event still needs timing, magnitude and
exposure before it damages a settlement. Old wake scars are not new disasters
replayed every era. Fire/Aurora interaction must not depend on enabling Pressure
merely because today's preset stores the rule there.

Opened shafts and failed containment can expose existing heat, water and Pressure
hazards through changed pathways. Do not import a named corruption phenomenon or
add an unexplained hazard merely because it appeared in the source's stories.

#### Disturbances, refresh and social consequences

Derive event footprints from a trigger, susceptible geography and exposed people
or works. Avalanches follow suitable snowy slopes and runout; tsunami inundation
follows a coastal event and connected low terrain; floods, droughts and fires
change support and habitation. Pressure-driven coastal impacts retain their
magical cause instead of being labeled ordinary tsunamis. Abundance follows an
actual mechanism such as reliable Fire heating or a productive warm current,
without an additional generic fertility multiplier.

Apply casualties, injuries, displacement, ruined structures, route loss and
changed support once. A town can be destroyed while its identity and historical
record survive. Political reach responds to the changed network and populations;
cultures and institutions can survive through migrants or retained sites.
Protection reduces relevant exposure rather than guaranteeing survival, and no
era is required to contain a disaster.

Refresh the dependencies actually changed: drainage after a dam; habitat after
clearance; ice and Aurora retention after Fire heating; affected ocean propagation
after coastal works. A downstream catchment or connected bay can extend beyond
the settlement's generation area. Respect existing boundary/reconciliation and
authored-protection rules. Do not replay tectonics, ancient Pressure impulses or
full geological erosion amounts as a side effect of each human-era refresh.

Proposed worked examples for implementation review:

- A dam supports farming while reducing downstream aquatic habitat. Population
  and fishing respond; neglect later permits a breach and displacement.
- A Fire-core route supports a cold pass and settlement. A mine failure cuts
  supply; the pass closes, migration changes and political reach contracts.
- Fire excavation opens a route beside an Aurora repository. Thaw reduces cold
  storage and memory access; communities can relocate the work or preserve the
  repository, with different geographic and institutional consequences.
- A reinforced bay changes Pressure exposure. A later coastal impact tests the
  changed geometry, damages exposed works and redirects maritime connections.

These examples test causal behavior, not mandatory stories or outcome quotas.
Defaults should select viable opportunities and practices without requiring a
creator to configure each mine, reader institution or diving site.

### Culture expressed in geography

Connect identity and history to names, institutions, sacred sites and reused
places. Finer authoring can express the same identity through architecture,
public spaces and other cultural details without simulating their development
individually. Separate practices that influence processes from descriptive
expression while retaining shared provenance. A diaspora can preserve some
traditions and adapt others.
Administrative language, household language and religious affiliation can change
at different rates and cross political borders.

### Creator shaping

Shaping is optional direction over a useful default generator. Starting
populations, cultures and polity characteristics should be generated automatically
when the creator has not supplied them. Candidate broad influences include
population abundance, mobility, cultural mixing, political consolidation and
historical disruption. These are illustrative controls, not an agreed list or
fixed category taxonomy.

Detailed rates and coefficients belong to internal defaults or optional advanced
settings. Creators should not have to tune fertility, budgets, taxation, loyalty
or succession to get coherent geography. Test defaults across representative
geographies and seeds; internal calibration must not be displaced onto the user.

The exact shaping tools and guarantees remain open:

| Candidate action              | Example                                                                           | Proposed semantics                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Establish starting conditions | Place a community, homeland, capital or trade corridor                            | Subsequent processes develop from authored initial facts.                                               |
| Shape historical conditions   | Specify a drought era, open a route or establish an institution                   | A located, dated cause influences subsequent development.                                               |
| Shape environmental works     | Place a dam, protect a habitat, mine a Fire vein or preserve an Aurora repository | Apply the same geographic operations and consequences as generated works; preserve authored protection. |
| Author a historical anchor    | Require a particular empire to fragment during an era                             | Apply an explicitly authored event with consequences; do not disguise it as emergent simulation.        |
| Edit the present              | Change community composition, effective control or a disputed claim               | Change current geography while retaining completed history.                                             |

Distinguish a preference from a guarantee. A bias toward fragmentation need not
force a particular state to collapse. A prevalence edit must have clear semantics:
changing affiliation among residents, relocating people and adding population are
different actions. Resolve this through concrete creator examples before choosing
controls. Protected facts and existing boundary rules apply to every operation.

### Presentation and refinement

A selected place should explain who lives there, who claims/administers/controls
it, what supports it, what changed it, and which facts the creator authored.
Refinement elaborates established communities and totals with stable identity;
it must distinguish inherited estimates from detail actually generated.
Independent political or cultural generation consumes existing/authored inputs
from the other domains without silently regenerating them.

## Workshop agenda and decision ownership

These questions concern authoring behavior and mechanisms within the accepted
generator boundary. They do not reopen detailed actor or economy simulation.
Record further user decisions with their source and rationale as the workshop proceeds.

| ID  | Open decision                                                                        | Starting recommendation                                                                                                                                                         | Owner; evidence trigger; affected milestone                                                                                       |
| --- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| D1  | What should a creator be able to specify about societies and their outcomes?         | Work through a mixed port, a homeland and a fallen empire; distinguish starting facts, biases, historical anchors and present edits.                                            | User with agent proposals; next workshop; M0 and shaping throughout M1–M4.                                                        |
| D2  | Which demographic distinctions and fantasy peoples should be generated and editable? | Population quantities and mixtures of relevant identities/affiliations, with optional aggregate traits and automatic defaults; no age-cohort requirement.                       | User defines needed distinctions; agent chooses representation; before M1 schema work.                                            |
| D3  | Which geographic conditions and connections should drive population support?         | Derive support from land, ecology, water and routes, including Fire-core access, Aurora knowledge practices and Pressure-related maritime conditions.                           | Agent investigates available inputs and proposes mechanisms; user refines exposed influences; before M1, revisited for E1 and M3. |
| D4  | What constitutes cultural change?                                                    | Separate practices, language, faith, affiliation and named identity; retain continuity through divergence and mixing.                                                           | User defines desired authoring meaning, agent proposes algorithms; before M2.                                                     |
| D5  | Which political properties and institutional influences should creators shape?       | Polity origins, reach, support, consolidation and disruption; named institutions can modify geographic influence without autonomous agendas.                                    | User defines authoring needs; agent proposes spatial rules and entity properties; before M3.                                      |
| D6  | How should human-era duration and forcing affect repeated processes?                 | Use elapsed-time responses and iterations for feedback, with explicit physical/magical context; no annual accounting loop.                                                      | Agent investigates existing contracts and useful iteration semantics; user resolves exposed era controls; before M1 loop design.  |
| D7  | How much fine demographic detail is materialized at each scale?                      | Preserve inherited totals/identities and elaborate requested areas; use existing spatial authority.                                                                             | Agent investigates refinement; user resolves required detail; M1 foundation and M4.                                               |
| D8  | How should each magic system's social use and cost be represented at atlas scale?    | Use distinct core deposits/supply, crystal charge and reader capacity, and deep-access/Pressure practice; preserve media, costs and interference without individual simulation. | Agent designs from source lore and implementations; user refines authoring examples; before E1 implementation.                    |

Technical work includes choosing useful process iteration/duration semantics,
geographic contact and political reach models, and sufficient retained causes to
explain outcomes. Resolve these within the agreed aggregate generator boundary.
Measurements guide choices; they do not authorize arbitrary runtime caps, a
mandatory creator workflow, or a return to autonomous historical simulation.

## Proposed milestones

M1–M4 and E1 describe the authorized society delivery.
Their acceptance examples and checks are agent-derived and may change while the
user requirements remain intact. Authoring and inspection accompany each slice;
M4 integrates them rather than postponing all UI work until the end.
The user has fixed their priority ahead of B1 and backlog item 10. B1 is deferred;
its goals and design must be established separately after society delivery.

### M0 — Workshop the society model

Scope: refine creator behavior, demographic distinctions and causal examples
within the accepted process-generator boundary. Keep later decisions open with
an owner and a point at which they become blocking.

Acceptance: agreed requirements and remaining proposals are distinguishable;
worked examples specify what changes, what persists and what can be authored.
Evidence: workshop decisions and revised examples in this document.

### M1 — Populations, livelihoods and migration [depends on M0]

Scope: shared aggregate demographic state, population-supporting conditions,
growth/decline, accessible movement and settlement history, with automatic initial
generation, optional starting-condition authoring and inspection. Locate land use,
resource dependencies and candidate works so E1 can evolve their consequences.
Use underlying ecological quantities and the retained channel network, including
unmapped tributaries; biome names and visible river filtering are presentation
choices, not the authority for supporting conditions.

Acceptance: changes in access or livelihood conditions affect movement and
settlement; population changes distinguish aggregate growth/decline from migration,
and transfers preserve represented people. Defaults produce usable populated
geography without custom demographic coefficients.
Evidence: focused population accounting checks and representative map comparisons,
including a blocked route, an authored community and default-only generation.
Select numerical checks only after choosing the representation.

### M2 — Cultural, linguistic and religious change [depends on M1]

Scope: mixed communities, selective transmission, divergence, institutions and
geographic expression, using the agreed concepts from D4.
Include practices and institutions grounded in each magic system's media and costs;
geographic opportunity must not force a culture's beliefs or political identity.

Acceptance: contact can transmit practices without migration; communities retain
distinct identities; language and faith can cross political boundaries; creators
can inspect and shape these facts without configuring every culture separately.
Evidence: contrasting connected/isolated communities and a mixed settlement;
domain checks for affiliation semantics and shared demographic totals.

### E1 — Society and environmental feedback [depends on M1, M2]

Scope: implement the shared human-era feedback sequence, dams and water use,
pass/coastal works, land use, hunting/conservation and their physical/ecological
responses. Add distinct Fire-core extraction/use, Aurora crystal and memory
practices, and Pressure deep-access and coastal interactions. Use the
source-backed mechanisms above; develop social costs and resource limitations at
aggregate scale. Add disturbance footprints and consequences for settlements,
people and routes. Authoring and inspection accompany the processes.
Associate works with both their located geometry and affected physical network.
Refresh connected water, shorelines, mouths and ecological exclusions consistently;
advance ecology for new human-era time without replaying inherited history.
This society feedback is in scope before backlog item 10; comprehensive repair
and balancing of magic/ecology and other environmental gaps remains B1 work.

Acceptance: interventions change actual geography; affected physical and magical
conditions feed back into society; destroyed settlements leave history and
survivors; each magic system has recognizable opportunities, costs and failure
modes. Fire/Aurora interference works without Pressure. Future systems remain
possible without weakening these first-class processes. Neither imported named
lore nor a universal magic editor is needed for acceptance.
Focused refreshes preserve completed physical history and do not replay old
events or multiply elapsed effects.
Evidence: the worked examples above plus each system's distinct social use and
cost, including a Pressure-diving access limit and an Aurora knowledge benefit.
Compare protected/unprotected and maintained/abandoned works, inspect upstream
and downstream effects, and check defaults across representative environments.
Include a dam on an unmapped tributary, a harbor whose access depends on water
connectivity, and land clearance followed by ecological response. Separate these
society checks from later whole-world ecological calibration.
These are proposed checks, not fixed event quotas or numerical performance caps.

### M3 — Politics, collapse and recovery [depends on M1, M2, E1]

Scope: aggregate political reach and support, consolidation, contested control,
fragmentation and recovery. Produce political relationships, sovereignty,
jurisdictions and claims, with institutions as geographic influences.
Use environmental disruption, resource access, magical practice and damaged
infrastructure as concrete causes of changed support, reach and recovery.

Acceptance: political change has causes and leaves identifiable consequences;
state collapse preserves surviving people and cultures; claims can survive lost
control; access, support and institutional influence affect outcomes. No ruler,
faction-agenda, tax-budget or campaign subsystem is needed for acceptance.
Evidence: a connected regional history exercising consolidation, a crisis and
recovery, plus contrasting cases that remain stable. These are test scenarios,
not events that every generated world must contain.

### M4 — Integrated shaping and spatial refinement [depends on M1–M3, E1]

Scope: coupled history, agreed historical shaping operations, present editing,
authored protection, independent domain selection and regional/local refinement.
Include intervention footprints, affected catchments/coasts, magical works,
damaged sites and their inherited causes across scales.
Consume retained drainage during refinement, allowing smaller channels to become
visible while works and crossings retain their geographic associations. Verify
this behavior explicitly rather than assuming stored reach metadata implements it.

Acceptance: creators can understand and alter social geography through the existing
atlas; ordinary edits preserve completed history; refinement retains identities,
population accounting and boundary commitments; protected facts survive generation.
Evidence: browser authoring scenarios, focused inheritance/protection checks,
default generation across representative seeds/geographies, and runtime
measurements. Inspect geography and causal explanations, not only numerical
validity. Report limitations without inventing caps or demanding user tuning.

### B1 — Deferred four-pillar work [outside this delivery]

The user intends to consider society, magic, physical processes and geology
together later. That work has no agreed detailed design or completion criteria.
Backlog item 10 and the earlier biome/drainage observations are inputs to that
future discussion, not authorization to repair or calibrate other pillars now.
The attempted B1 execution branch was canceled at the user's correction.

## Sulion mapping and resume

| Milestone | Phase ID                               | State                      |
| --------- | -------------------------------------- | -------------------------- |
| M0        | `850ad3a1-3f86-4ee3-9e73-27a4867563f0` | Completed |
| M1        | `ae74e167-7dc0-44f2-9179-894d78745040` | Completed |
| M2        | `cc7a4cc1-51aa-42e1-aa58-dce686b90122` | Completed |
| E1        | `0732178d-7533-4d02-b1ca-d27561a584ed` | Completed |
| M3        | `75d063b0-3759-4481-9741-e0ad0ac484d1` | Completed |
| M4        | `3ff0f2c9-b569-434b-94df-8b3547d04db3` | Completed |
| B1        | `fc6a9e64-e3e4-4d6b-a19b-f7f3411c51c4` | Deferred; excluded |

Society implementation is in the domain `society` modules and generation
`society*` processes, with browser controls in `Society*` components and human-era
configuration. Focused checks cover population conservation, diffusion, political
collapse/recovery, works, practices, authoring and refinement. Those component
checks did not establish the agreed population dynamics. The repair above adds
causal trajectories and representative output checks; four-pillar balance remains
outside this delivery.

On resume, read `sulion plan current` and this document. If needed, attach the root
with `sulion plan attach 1f6ee3d8-9ece-42d5-b31b-55477d263691`.
The older root records the initial delivery and B1 exclusion. Future four-pillar work
needs a separate scoped plan based on the user's goals.
