# Society, economy, places and magic interactions

## Outcome and sequence

**Owner correction — 2026-11-10: lengthy design session required.** The earlier
proposal drifts toward simulation. The goal is procedural generation of society,
economy, culture and places. Explore a society concept analogous to the rock
column, but its representation and operations are not yet decided. Society must
also use magic at aggregate scale to influence generation, beyond carrying and
trading magical materials. Music is another component of society, loosely
representing cultural influence. The owner's ideas are preliminary; do not fill
in the design on their behalf or begin implementation from the old milestones.

Settlements, working landscapes, trade routes, institutions and points of interest
arise from what people can reach, produce, use, maintain and pass on. All seven
magic systems participate through their distinct physical media and practices.
Human activity changes the landscape; changing resources, hazards and access
change society. Music participates in cultural influence through a mechanism to
be designed. Abandonment leaves recognizable places and inherited conditions.

This is the owner-requested 2026-11-10 follow-up to the shared physical magic
interactions described in the [generation guide](generation-workflows.md). Planning is
authorized; implementation and the future design reviews are pending. This
document preserves a coverage inventory and provisional work programme. Its
architecture, economic machinery and S2–S8 implementation sequence must be
reassessed after the lengthy S1 design session, not treated as a settled design.

The shared physical prerequisite is complete. Begin this plan with its lengthy
social design session before choosing the world implementation. Regional
shared-process work can proceed independently; the regional exit here depends
on it. This follow-up does not insert all new society work ahead of regional
geology.

## Requirements, decisions and boundaries

**User requirements and established decisions**

- Cover society, economy, POIs and magic interactions together, including
  ordinary societies and all seven systems; do not select a few attractive sites.
- Prioritize procedural generation over an increasingly detailed social or
  economic simulation. Aggregate simulation is not an agreed compromise merely
  because it avoids individual actors.
- Explore a rock-column-like concept for society without assuming literal
  layers, a particular history model or a new schema. Decide what should be
  retained and how generation should interact with it during design.
- Society's aggregate use of magic must influence generation. Material trade
  and extraction alone do not satisfy this requirement.
- Include music as a component of society loosely representing cultural
  influence. Its meaning, representation, interactions and outputs remain open.
- Hold a lengthy design session with the owner before implementation. It may
  span several conversations; a short approval checklist is not a substitute.
- Explain actual settlement rules with the owner before rewriting them. Retain
  the accepted POI catalogue design and resolve its remaining product choices;
  do not restart the catalogue or silently turn open slots into requirements.
- People affect actual geography through works, land use and extraction, and
  respond to physical and magical hazards. Historical requests for dams, passes,
  bays, hunting and conservation illustrate the relationship, not a closed list.
- Magic is physical. Group places by what they are, not into a separate magic
  category. Source media, use, costs and interference remain system-specific.
- Specialization develops from activity, access and contact, not assigned nation
  archetypes. Culture, language, religion, sovereignty, control and claims remain
  distinct. Numeric parameters and ordinary architecture are agent decisions.
- One catalogue entry owns a place kind's generation and publication; a
  place-specific effect has one writer. Shared field processes keep their own
  effects. Ground owns material, depth and history; MapScale owns dimensions.
- No desired POI counts, arbitrary process/output caps, exact replay or closure
  checks. Size, significance and presentation do not determine whether a place
  is allowed to exist. A coarse record may represent one thing or many.
- Regional maps elaborate captured present context without rerunning world
  epochs or society eras. Preserve named identities, completed history and
  pinned inputs; children do not modify parents or siblings. Exact inherited
  population allocation and frozen terrain are not required.
- Manual authoring/undo, backend services, and site/interior layout remain
  deferred. Preserve their code. This plan adds no restart or recovery system.

**Earlier economic proposal — to be reassessed, not an implementation direction**

The earlier aggregate production/consumption, service, movement and maintenance
model remains an inventory of possible causes. The owner has challenged its
simulation emphasis. Do not assume it requires economic ledgers, resource-flow
solvers, annual upkeep or a more elaborate feedback cycle. Design which retained
social conditions and procedural transformations can produce meaningful places
and cultural influence, then choose only the machinery those outcomes need.
Existing communities, practices, works and routes are reusable evidence, not a
requirement to keep their present representation or execution model unchanged.

## Sources and current foundation

Authority: [product scope and sections 10.3–10.6](product-spec.md),
[magic lore and seven system bodies](lore/magic.md),
[ADR 0004](adr/0004-coupling-through-each-systems-medium.md),
[ADR 0007](adr/0007-magic-systems-are-materials.md),
[ADR 0009](adr/0009-named-entities-persist-and-cells-are-shares.md),
[ADR 0011](adr/0011-processes-couple-through-keys-and-a-ledger.md), and the
[backlog](backlog.md). New practice designs must distinguish lore motivation,
reference implementation and atlas adaptations. The preceding review checked the
original Three Fires sources; revisit the relevant source bodies before adding
new Fire, Aurora or Pressure practice behavior. Do not import named setting lore.

Retrieved owner turns establish two useful boundaries: people and geography
influence each other (`01a1624c-599c-7bf1-9637-19d90755e636`, turn 2033002), and
magic places have physical kinds with no target count or scale-based exclusion
(`2ee7d278-717b-4f6b-81bc-2e43fb02043e`, turn 184291818). The assistant proposals
in those turns are not additional user requirements.

Selected current bodies were read for this plan:

| Existing code                                    | What is available and what the plan must inspect further                                                                                                                                                                                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `societyEvolution.ts`                            | An ordered cycle already advances population, culture, works, magic use, practices, environment, hazards, settlements, route wear and politics. Extend it; do not create a parallel economy clock.                                                                                    |
| `societyMagic.ts`, `societyContact.ts`           | Finite core use, crystals/readers, diving, seed and Salt use; traded ledgers move toward equal holdings along links. Contact already reads language and archive access. Demand-led exchange is a proposal beyond this balancing behavior.                                             |
| `domain/societyPractices.ts`                     | Four livelihood channels and three named magic practice channels, with learned shares. Greenwood/Salt have use paths elsewhere; absence from this list is not proof they have no behavior. Inventory all seven before extending it.                                                   |
| `societyHazards.ts`                              | Physical and meeting exposures produce events, casualties, displacement and damaged works. Establish geographic event reach and real consumers before claiming coherent disasters.                                                                                                    |
| `poi/poiContract.ts`, `poi/settlements/forge.ts` | Catalogue covers origin, publication, fields, movement, people, time and naming. Relation slots explicitly state they are not yet enforced. Forge reads a practice ledger but also has a source-free fallback heat path; audit ownership and actual operation before extending sites. |
| `regional/society.ts`                            | Fields and pasture already allocate suitable hinterland and declare cover changes. Use this as existing work, not proof of a complete regional economy.                                                                                                                               |
| `societyInventory.ts`                            | Existing inspection of population, settlements and routes can aid diagnosis. Its counts do not establish geographic quality.                                                                                                                                                          |

This is a scoped planning inspection, not a full audit of every society, economy
or catalogue helper. S1 performs that audit and explains the rules. Current
working-tree changes from magic-rock work remain intact.

## Architecture questions for S1

The rock column is a conceptual reference for a reusable retained representation,
not a prescribed society data structure. Discuss what society needs to remember,
how earlier influences persist or are transformed, what a generation operation
reads and changes, and how present places expose the result. These are questions,
not approval for literal cultural strata or a chronological simulation.

The responsibility table below records the earlier proposal. Keep its established
Ground/catalogue ownership boundaries, but reconsider its social state and
operations in S1. Do not introduce a generic social-effects engine to settle the
question prematurely.

| Responsibility                        | Owner and boundary                                                                                                                                                                                             |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Resources and environmental potential | Ground, water, ecology and magic reservoirs. Society reads accessible supply and uses admitted withdrawals; it does not invent a second deposit estimate that can replenish an exhausted host.                 |
| Population, skills and affiliations   | Existing communities and groups. Practices learn from actual work and contact. Political membership does not overwrite cultural or religious identity.                                                         |
| Production and use                    | Society activities translate available inputs and practiced effort into actual output or service. Consumption and maintenance are explicit; benefits are not awarded twice through support and a POI bonus.    |
| Exchange and access                   | Existing route/contact graph carries eligible goods and people between accessible sources and demand. Keep stores distinct from throughput and contact. A closed crossing changes reachable activity.          |
| Works and institutions                | Existing records hold location, host, purpose, operating state and upkeep; extend only for agreed behavior. A visible building and an operating service are different facts.                                   |
| Physical effects                      | Shared process operations apply extraction, water changes, clearance, heating and protection. Catalogue entries delegate to these operations where a place owns the effect. No direct competing Ground writer. |
| Named places and areas                | Catalogue is the single definition and publisher. Economic activity can create or sustain a place; its name or icon cannot create activity, stock or heat by itself.                                           |
| History and refinement                | Completed events and identity remain; current use and condition change. Children realize captured demands and places through shared operations without manufacturing another past.                             |

The existing feedback cycle is an implementation to evaluate, not the required
future algorithm. S1 must decide how procedural operations compose and how much
iteration is useful. Preserve clear operation ownership and avoid repeated side
effects on refresh. Use scoped spatial operations and existing numerical
structures where appropriate; neither an automatic universal scheduler nor
bespoke wiring for every practice/magic combination answers the design question.

The physical prerequisite owns stock/host transfer, groundwater physics,
ward/door lifecycle and coastal interactions. This plan owns why people request
those operations, their social costs, the use of results and the places left
behind. If the prerequisite proves incomplete, branch the repair there rather
than implementing a competing mechanism here.

## Complete coverage to design

### Retained society, aggregate magic use and music

These are central topics for the lengthy design session, not optional additions
after the economic plan is built:

- Explore the society analogue of the rock column: what the authoritative
  representation contains, what persists, what can mix or replace earlier
  influences, and how processes access it. The analogy is tentative; do not
  choose its shape before hearing the owner's ideas.
- For all seven systems, distinguish availability and material movement from
  society's collective capacity to use magic and thereby influence generated
  geography, settlement, institutions and culture. Determine the scale,
  conditions and consequences of that use without simulating each practitioner.
  The table below supplies motivations, not a finished aggregate-use model.
- Define music's role as a loose representation of cultural influence: what it
  means in the generated society, how it relates to other cultural components,
  and what should change or be visible because of it. Relationships with magic,
  transmission and retained history are questions for the owner. This request
  does not yet choose musical taxonomies, audio generation or playback.

### Ordinary social and economic processes

Survey food and water, gathering/grazing/fishing, timber and construction
materials, quarrying/mining, processing and power, transport/storage, market
exchange, skilled services and maintenance. Select concrete modeled quantities
in S1; a list here does not require a stock ledger for every commodity.

Cover settlement founding, growth, migration, specialization, contact, political
reach, competing land uses, infrastructure investment, deprivation, disruption,
abandonment and reuse. Institutions must have activities and upkeep behind their
map roles. Explain how protection, access and material scarcity influence people
without reducing culture to biome or polity to a single personality.

Works coverage includes dams, weirs, irrigation, embankments, marsh drainage,
harbour reinforcement/breakwaters, pass clearance, bridges/fords, canals and
portages; land-use coverage includes farming, forestry, grazing, hunting,
conservation, extraction and restoration. These are a coverage inventory for S1,
not a requirement to simulate construction crews or resolve every small work on
a world map. Survey additional missing activities before freezing the scope.

### All seven systems

The table gives design candidates grounded in existing lore. Practices and costs
are adaptation proposals until S1 resolves them; no particular custom becomes a
universal obligation for every culture.

| System    | Access and economic/social role                                                                                                                                  | Costs, feedback and surviving places                                                                                                                                                                                                                               |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Fire      | Reachable cores, extraction and transport to hearths/forges; distinguish renewable veins from finite fallen deposits and spent ore.                              | Cracking consumes stock, gives local heat and injures practitioners. Supply interruption changes work and settlement; mines, spent workings and altered ground can remain after a forge cools.                                                                     |
| Aurora    | Crystals, cold ice and trained readers support archives, preservation and information/contact services. Readable lore memory is distinct from generator history. | Charge, cold and reader strain/rest constrain service. Thaw and heat affect operation; an archive may survive as a place while its service fails. Do not turn knowledge into generic magical wealth.                                                               |
| Pressure  | Reachable ocean depth and capable divers; directed force, maritime contact, fisheries and sky-reading inform coastal work and access.                            | Diving tolerance, carried-charge cost and storms constrain practice. Depth and connected water matter; no inland mana well. Examine seasonal harbours and changed routes using actual exposure.                                                                    |
| Greenwood | Tending soils/channels, grafting, planting, spring use, protected growth and transported seed support working landscapes.                                        | Establishment time, suitable ground, withdrawal and clearance costs matter. Evaluate lumber taboos as a practice choice. An old tended grove or depleted well can outlast its institution.                                                                         |
| Salt      | Harvesting, pan/barrow maintenance, preservation, memorial and oath institutions; possible mirage-informed travel.                                               | Salt is carried material with ecological costs, not automatically a beneficial commodity. Retained memory and maintenance can constrain practice; abandoned pans, salted ground and memorial sites persist. Resolve stronger undead/resurrection scope explicitly. |
| Hallowed  | Maintained sanctuaries, boundaries and pilgrim routes; restraint/vows can change permissible local activities and produce protected ground.                      | Upkeep and displaced hazards impose costs inside and outside the boundary. Temple/pilgrim economies need actual visits, supply and practice, not free prosperity. Abandonment changes protection while structures remain.                                          |
| Veil      | Door keepers, maintained crossings and wild-zone navigation can alter trade, contact and defence; door fortresses require a meaningful crossing.                 | Current stability and access, crossing costs and closure matter. No guaranteed door empire. A disused crossing may leave a road, settlement or keeper's house after its trade advantage disappears.                                                                |

Cover combinations through actual co-location, carriers and exposure, not a new
all-pairs recipe matrix. Examples to investigate include forge heat near cold
archives; stored Pressure with crystals, Fire release or door passage; clearance
near Greenwood and brine; work restrictions inside wards and displaced activity
outside; protected pilgrim routes whose doors close. All ten existing meetings
need their applicable hazard/opportunity consumers reviewed. A meeting without
a distinctive social use need not acquire one just to fill a table.

## Milestones and semantic exits

S0 is publication of this plan. Future phases are pending. Implementation exits
are behavioral obligations; unit checks explain operations and UI checks verify
interactions, but neither alone proves a generated society makes sense.
S2–S8 are provisional coverage headings and candidate exits. S1 must rewrite,
merge or replace their mechanisms and ordering to fit the agreed procedural
design, while preserving the requested scope. No implementation proceeds merely
because an old phase already has a detailed description.

### S1 — Lengthy society, aggregate magic and music design with the owner

This is a substantial collaborative design session, potentially across multiple
conversations. Begin with the owner's vague ideas and the procedural-generation
goal. Explore the rock-column analogy, aggregate use of each magic system, music
as cultural influence, and the relationships among society, economy and POIs.
Do not narrow the session to approving the earlier economic simulation proposal.

Read current support, site selection, hinterland allocation, migration, practices,
trade, works, political reach, hazards and catalogue consumers. Explain why
representative existing settlements and works are where they are, including
unexplained outcomes. Reconcile every proposal in the coverage inventory and
backlog 2/12/19 with current behavior and an implementation home.

Resolve the procedural representation and operations, the necessary economic
detail, aggregate magic use, music, land-use/individual-place representation
and the proposed cultural practices with the owner. Reuse accepted catalogue
categories and true-size decisions; do not ask again for settled architecture
or numeric tuning. Put a concrete explanation and proposed behavior in front of
the owner, rather than a vague request to design the subsystem.

Exit: the lengthy design session has produced an owner-agreed conceptual model
and concrete examples of generation, preservation and change. The society
representation is chosen explicitly; aggregate magic has consequences beyond
material exchange; music has a defined cultural role. Settlement rules and the
needed economic detail have been reviewed. Rewrite S2–S8 and their exits around
that design before implementation. No system, ordinary society or old backlog
clause disappears silently, and declarations are not implementation evidence.

### S2 — Shared social and economic operations [depends on S1 and physical magic]

Implement the retained society representation and procedural operations agreed
in S1, reusing existing state where it fits. The old production/use, transfer,
service and maintenance proposal is not a required engine. Assign state and effects
one owner; retire superseded estimates and fallback effects in the same change.
Keep source access and physical effects behind prerequisite interfaces.

Exit: following an activity from resource access through use and publication
reveals one causal path. An idle or unsupported forge does not gain heat merely
because it has a POI record. Refresh does not perform work twice, exhausted
resources are not replenished by social projections, and consumption respects
what was actually supplied. Check explicit operations and review real activity
traces; do not use total-account closure as the acceptance test.

### S3 — Livelihoods, cultural influence, land use and settlement [depends on S2]

Own music's generation behavior and its relationship to wider cultural influence
as agreed in S1, using the representation from S2. The form of that behavior is
still open; it must not become a decorative label added after generation.

Connect ordinary production, accessible resources, practiced effort and competing
land use to support, settlement and migration. Add farm country, extraction or
other working areas using the agreed area/point distinction. Preserve multiple
cultures, languages and practices; institutions emerge from use and history.

Exit: maps show plausible inhabited and working landscapes under different
resource/access conditions, including a world without magic. Inspect why people
remain, leave or specialize, and what they change on the ground. Scarcity is not
solved by silently creating supply or forcing everyone to the richest cell.
Abandoned use can leave a landscape that later vegetation and water rework.

### S4 — Exchange, travel and infrastructure [depends on S2/S3]

Make transfers respond to accessible supply and actual need, not only equalize
ledgers. Carry appropriate goods and services over existing routes; distinguish
land, river, sea and door access. Traffic and maintenance sustain relevant works;
bridges, ports, passes, canals and portages respond to geography and use. Reuse
existing routing, not a second economic network with unrelated costs.

Exit: supply can serve a distant consumer, and interruption or reopening of a
crossing can change use, movement and settlement prospects. A port or market has
a geographic and economic reason to matter. Inspect routes and their connected
places; flow totals, a road count or a preassigned hub label are insufficient.
Roads and works can survive after the demand that established them disappears.

### S5 — Seven distinct practices and institutions [depends on S2–S4]

This candidate phase must include the agreed aggregate use of magic to influence
generation. Traded materials, local practice sites and practitioner-cost ledgers
alone cannot close it. S1 decides how this relates to retained society and music;
do not assume every cultural influence is itself magical.

Implement the S1-agreed coverage for every system, including existing practices
that need completion. Institutions connect people, supply, skill, visits and
maintenance with concrete places and environmental consequences. Costs constrain
the relevant practice rather than all systems sharing one fatigue/mana scalar.
Connect mixed-system effects through shared state and current access.

Exit: each system has an explainable access → practice → use/cost → environmental
and social consequence chain at the agreed aggregate scale, including loss of
access or abandonment. Generated outcomes demonstrate collective use, not only
material transport. Across
suitable histories, compare a remote consumer, an exhausted source, a maintained
institution and an abandoned one. Do not force all seven into every seed or
require every community beside a source to adopt the same culture.

### S6 — Hazards, maintenance, abandonment and reuse [depends on S3–S5]

Connect current susceptibility and event reach to exposed people, works and
routes. Include ordinary disasters, existing meeting hazards, resource loss and
failed maintenance. Use shared physical responses and existing events; no generic
magic explosion or obligatory disaster per era. Resolve how early mobile camps,
settled towns, ruins and later reuse relate without erasing completed history.

Exit: disruption changes accessible routes, functioning works and inhabited
places; survivors and later communities respond to those conditions. A past
settlement or practice can leave visible ruins, altered ground, field patterns,
roads or reused infrastructure after its active cause stops. Ruins are not just
live buildings with a changed label. Multiple histories establish capability;
no particular illustrative catastrophe is mandatory on one map.

### S7 — POIs express functioning places [depends on S2–S6]

Complete catalogue consumers needed by the agreed social design: origins,
relationships, operation, benefits/hazards, fate, naming and presentation.
`needs`, `excludes`, `contains` and `pairsWith` must have meaningful consumers
where used; remove redundant declarations rather than filling every slot for
appearance. Use causal physical/social incompatibility, not arbitrary spacing
or hard-coded scene recipes. General relation support stays here; detailed kind
work outside this scope retains its existing foundation phase.

Exit: inspect a settlement and its works/resources/routes to understand why each
place exists, what it does, who uses it and what remains when it stops. A dam,
mine, forge, archive, sanctuary and crossing are not interchangeable bonus nodes.
No second publisher recreates a place; meaningful dependencies affect actual
generation. Coarse working areas and finer individual places express the same
context without treating symbols as physical footprints or inventing POI quotas.
Review visibility, names and map crowding on rendered maps, not catalog counts.

### S8 — Independent regional realization and combined review [depends on S3–S7 and regional shared processes]

Realize captured demand, named places, infrastructure and working areas against
the child's actual geography. Add suitable finer communities/works and local
variation without replaying eras or dividing exact parent population totals.
Retain remote trade/door context when its other end lies outside the map. Use
shared Ground, water, ecology, magic and route operations; no regional economy
or field vocabulary that duplicates the world implementation.

Exit: world and child maps show related but independently developed societies;
named places resolve and function, remote connections remain meaningful, and
parent/sibling maps remain unchanged. Read representative full histories and
their present maps: ordinary economy, all seven systems, mixtures, disruption,
abandonment and reuse each have evidence. Existing accepted evidence can be
reused where unchanged; failures remain open with their actual missing mechanism.
Inspection, layer presentation, explicit local save/reopen and export preserve
the agreed visible state and identities through focused UI checks.
The revised exits must also demonstrate music's agreed cultural influence and
the retained society model in generated output; neither can be replaced by an
unused field, label or future-work note.

Use pure explicit-input unit checks first and UI fixtures for interaction.
Reserve serial real generations for semantic questions, with existing monitoring;
do not add fixture simulations, closure checks, exact replay or mandatory seed
counts. Fine workload verification still needs explicit authorization. Record
review in this plan/chat, not a new verification report.

Close only after the agreed exits are met: move durable mechanisms into existing
docs/ADRs, retain genuinely open choices in the backlog, remove this working
plan and every reference, then complete the parent anchor. This follow-up does
not establish completion of regional integration.

## Ownership across plans

| Existing work                                      | Home after this follow-up                                                                                                                                                                                                                                                  |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared physical magic                              | Completed lifecycle, hosts/carriers, thermal/water/ecology/coastal processes, ward/door mechanics and physical remnants. This plan consumes the contracts in the generation guide.                                                                                         |
| Root phase 5, settlement debugging                 | S1 owns the actual owner review; the root phase points here and closes only when that review happens.                                                                                                                                                                      |
| POI foundation phase 18, human land use            | S1 design and S3 implementation own it, including mills/farm country/working districts; retain the earlier true-size work.                                                                                                                                                 |
| POI foundation phase 11, relations/name references | S7 owns shared relation consumers and coherent naming references; do not leave a competing implementation checklist.                                                                                                                                                       |
| POI foundation phases 7/10/17                      | Existing host resolution, across-map identity and true-size foundations remain there. S7/S8 consume them and add social-specific behavior; do not restart all natural-place work.                                                                                          |
| POI foundation phases 8/9/12–16/21                 | Natural areas, remaining per-kind slots, peaks/rivers/falls and documentation remain in their current homes. Only dependencies actually needed here block a milestone.                                                                                                     |
| Relief parent phases 10/19                         | Own regional physical inheritance and shared-process integration. S8 depends on them; social/economic realization here does not replace their work.                                                                                                                        |
| Backlog 2                                          | S1/S6 resolve early camps, towns, ruins and later founding; do not assume camps must become towns.                                                                                                                                                                         |
| Backlog 12                                         | S1/S5 now own the full society-practice design, including tending/taboos, vows, keepers, sky-reading, temple/pilgrim economies, door fortresses, mirages and detour routes. No silent selection of a subset.                                                               |
| Backlog 13                                         | Manual ward/door authoring remains deferred. Generated practices/works do not resume manual editing.                                                                                                                                                                       |
| Backlog 14/18, conjunctions                        | S7/S8 own social use of existing natural/magic places; shared terrain/magic mechanisms stay with their owners.                                                                                                                                                             |
| Backlog 19                                         | S3–S8 own regional society behavior: works, hamlets/shrines/way-stations, canals/portages/gorge dams, harbour/pass demand, forges/dives/archives, hinterlands, hierarchy, language names, sea links, hazards, livelihood, decayed works, worn roads, land use and traffic. |

## Open designs and assumptions

- **D1 — procedural model and economic scope, owner in S1:** explore the
  rock-column-like society concept and decide its representation and operations.
  Reassess the prior aggregate economy; choose economic detail for generated
  meaning, not simulation completeness. No data structure is selected yet.
- **D2 — practices and institutions, owner in S1:** decide which lore-derived
  cultural constraints/costs and institution behaviors become defaults or varied
  practices. Every backlog 12 proposal receives a reasoned disposition. Detailed
  religion, legal systems and resurrection are not silently inferred from lore.
- **D3 — working landscapes and coarse places, owner in S1:** apply the existing
  true-size decisions to human land use and institutions; resolve what a record
  means before building another publisher. Preserve already accepted decisions.
- **D4 — historical society, owner in S1:** resolve backlog 2 and how source loss,
  maintenance, destruction and reuse should read on the present map. Do not
  equate a memory log with a visible surviving place.
- **D5 — aggregate magic use, owner in S1:** determine how collective use of each
  system influences generation beyond trade/extraction, and how it interacts
  with the retained society representation.
- **D6 — music and cultural influence, owner in S1:** define music as another
  component of society, loosely representing cultural influence. Representation,
  mechanisms, relationship to magic and user-visible outcomes remain open.

These choices do not require an answer to finish this planning request. They are
explicit work in S1 and become blocking before their dependent implementation.
Routine algorithm and architecture decisions remain with the executor.

Assumptions to revisit in S1: existing society state and iteration may be useful,
but are not presumed to be the right authoritative representation or procedural
model. Completed history/catalog records and the physical prerequisite may supply
useful interfaces. Neither the rock-column analogy nor music has a chosen
implementation. If a
multi-step prerequisite fails, branch its repair from the owning phase rather
than hiding it inline or reducing the promised outcome.

## Tracking and resume

Root: `ea1eabd9-8a17-4e96-8b90-81b487c7d677`, follow-up phase 13
`c779a284-f719-4ec8-8d12-8a31072630bb`.
This plan: `038e2842-78bc-4d53-8abc-e7c51e15b5a9`.
Physical contracts: [generation guide](generation-workflows.md).
POI foundation: `cc3b3834-15e6-40e3-9abe-97ce00bc6c96`.
Regional physical owner: `b870430e-af54-438e-b9c5-09c1c9b6e0ea` phases 10/19.

| Milestone         | Sulion phase ID                        |
| ----------------- | -------------------------------------- |
| S0 plan           | `8a60055c-03e6-4133-a761-1ade313828ad` |
| S1 design         | `d5c9b6de-7601-43e0-b6bf-968ae0dbb178` |
| S2 operations     | `b1fdf595-5f95-4e59-9a60-70fff5fba6c4` |
| S3 livelihoods    | `8b5f5fd6-41f3-4840-9484-8d3104dae041` |
| S4 exchange       | `23405774-cff0-4cfd-8b9b-df0bece97145` |
| S5 practices      | `a2a13026-4ce6-4672-9076-29f01fd51a16` |
| S6 history        | `2c0737d9-828f-4163-8c56-c84e1564ae99` |
| S7 POIs           | `863af4ed-294e-4c07-b13b-ee3f83927083` |
| S8 regions/review | `f5416fb5-f7ca-4298-99dd-513e39c19747` |

2026-11-10: follow-up contract written from current source bodies, prior owner
directions and existing plan bodies. No runtime implementation or generations.
The physical prerequisite is complete. When this follow-up begins, expand S1 and
prepare the concrete settlement/economy review before changing the behavior.
Do not mistake S0 completion for completion of S1–S8.

2026-11-10 owner correction incorporated: procedural generation rather than
simulation; tentative rock-column-like society concept; aggregate magic use
beyond material trade; music as cultural influence. S1 now explicitly requires
a lengthy design session. S2–S8 are provisional and must be revised from its
outcome. No runtime changes or design choices were made by this amendment.
