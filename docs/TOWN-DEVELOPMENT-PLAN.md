# Town development from interacting processes

Working design, 2026-11-18. M1–M3 and the initial growth migration delivered the baseline below. The Evorno investigation found that most construction candidates came from street frontage. Founding and later development now also consider individual sites on open land. The requirements of the proposed use determine whether a site needs street access.
Sulion root: `d693174d-8188-4995-bd52-b1b498b74ade`.
At close-out, move durable mechanisms into the generation guide, product contract or
an ADR as appropriate, then delete this document and its references.

## High-fantasy settlement templates

Sulion subplan `5f49411a-ca00-4a2a-8eb2-3c44f5c99874`. Design this and the sibling feedback plan before the first capital-scale trial. A founding template determines what kind of settlement can take root here. The shared development cycle determines how this particular settlement grows.

1. **Design physical and cultural templates.** Aim for 10–15 eventual templates spanning ordinary and exceptional settlements suitable for high-fantasy play. For each, describe the inhabited founding kernel, its persistent rules, the geography those rules can produce, and which decisions remain open. A town split across two levels raises a question of access. A compass-oriented town asks how later builders inherit an alignment. For a town organized around fervent religious observance, ask who can direct labor and what obligations shape the use of land. For a town of enslaved households dominated by a walled highborn compound, ask who controls land, movement and construction on each side of the wall. Cultural rules should continue to shape decisions as the town grows. Survey other possibilities and identify any spatial or social capability the current fabric would need.
2. **Ground suitability in the founding site.** Select roughly 5–10 axes from numerical fields and features already available when the site is chosen. Trace each to its producer, spatial extent, and meaning. Relief across the site, the presence of particular POIs, and evidence of a particular magical system are possible inputs. Work out which evidence makes a template plausible and which physical conditions it actually requires. A strong signal from one magical system should retain that system's meaning.
3. **Specify selection and the handoff to growth.** Work through contrasting supplied sites to show their ranked alternatives and why the order changes. Draw a template at random with greater weight toward the top, preserving multiple plausible outcomes where conditions permit. The same ranked choices should later support explicit creator selection. Describe what founding passes to recurring development so the template's rules survive expansion, redevelopment and changes of use across roughly 18 rounds. Leave the creator UI for later.
4. **Design major works as an independent choice.** The same founding template can produce settlements with different works or none at all. Population scale influences how many works a settlement is likely to have. Its site, institutions and practices can influence which works make sense there. Design for wonders distinctive enough to give adventurers a reason to visit. A great library, a royal palace, an extraordinary prison or a colossal head carved into a mountain illustrate the range of purposes and scales.

   | Settlement scale | Typical major works over its development |
   | --- | --- |
   | Small settlement | Most have none. An exceptional small settlement can have one. |
   | Mid-sized city | Roughly half have one. |
   | Capital | Usually two or three. |
   | City of a million or more | Usually five or six. |

   Treat these as expectations for the combined result of two routes. During template selection, larger cities can preselect some individual works so their siting and development can shape the city as it grows. During recurring development, circumstances can also give rise to a work with low probability, including in a small settlement. Describe how a preselected work enters development and how an organically initiated work uses the same work-specific siting and development rules. Keep those rules with the work's POI definition. Compare two cities with the same template but different major works, and trace one small settlement that grows around an exceptional work. Exact probabilities and population cutoffs remain open.

The design is ready when a reader can follow one site into two plausible, materially different settlements and explain why another site favors a different ranking. The kernel and rules must leave the eventual layout open.

The [founding design](settlement-template-design.md), [major works catalogue](settlement-major-works.md), [reference research](settlement-reference-research.md) and [lore research](settlement-lore-research.md) record the design and its sources. Implementation subplan `c001bc62-bf39-43cd-86d4-8de06eba67f8` connects founding-site evidence, weighted selection, inhabited kernels and continuing development rules to the shared Rust town sequence. Major works enter construction through inheritance, a founding commission or a later subscription. The settlement GIS record carries its selection and commissions. Built members and their reserved ground publish as named, related map features.

The owner's correction to this implementation is recorded in Sulion plan
`55828535-9cac-4e8d-a1de-01a562b944aa`. A settlement template owns the policies
that recurring processes consult, including any street geometry the template proposes.
A major work is a generated instance of a type. Its program, occupied premises, open
ground and local name belong to that instance. The named examples in the research
describe possible places.

## Feedback among settlement processes

Sulion subplan `b4b77d1a-e3ef-4e90-b60c-eba5878b419e`. Design how the recurring processes should influence one another before measuring their effects. This work applies across templates. A template can constrain a placement or change a rule while the participating processes retain ownership of the interaction.

1. **Design the loops in domain terms.** Start from the existing process and POI catalogs. Explain which actions by households, livelihoods, institutions and practitioners change a later choice by another participant. For each consequential loop, describe where it acts, what persists between rounds, what reinforces it and what can weaken or reverse it. For example, shared journeys can support a crossing, access can attract livelihoods, and new occupations can sustain more journeys. The design must explain what happens if those occupations leave. Cover ordinary economic and civic activity alongside the distinct practices of the seven magic systems.
2. **Express the intended economy and interactions outside the code.** Use the geology and society design as the reference. For each chain, identify the state owner, the small set of typed messages, keys or questions crossing ownership boundaries, and the decision each consumer makes differently. Use stocks for things that accumulate or are spent. Represent access, obligations and spatial relationships according to what they do. Keep POI-specific behavior with its POI and craft-specific responses with the relevant system. A process has meaningful representation when it can influence a consequential choice under the conditions where it matters.
3. **Compare implementation to the design.** Trace the proposed chains through current producers, owners and consumers. Prioritize breaks that cut off a whole class of decisions. For a disputed link, specify a small constructed case that changes one causal input and exercises the downstream decision. Reserve a capital run for interactions whose combined spatial effect genuinely needs a full town. Equal process representation carries no frequency, feature-count or map-area quota.

The deliverable is a causal design and a prioritized account of what existing contracts can express and what needs to change. The catalog and feedback design can proceed independently and meet at the rules ordinary development reads after founding.

## Independent building sites

The owner's four spacing references show individual buildings at irregular distances and orientations. Early settlements and mature outskirts can be diffuse. Open ground between buildings can remain unused. Shared courts, gathering places and connected projects require their own reasons to occur.

1. Separate the physical building site from its optional street connection. Construction, walking access, land claims, inspection and publication must admit a freestanding home. A street address requires an actual street relationship.
2. Establish an inhabited kernel on workable land. On every development pass, offer sites around the existing settlement and its holdings, including beyond intervening empty ground. Choose among viable sites with variation; keep frontage, subdivision, vertical growth and declared relationships available. A new building does not commission a street by default.
3. Compare early, middle and mature buildings at Amadir and Evorno, including a view without roads or parcel outlines. Assess whether loose occupation persists at the edge while older areas can change. The number of buildings or roads in either example is not a target.

## Growth contract and process migration (earlier implementation)

### Follow-up from the Amadir and Evorno maps

Preserve Amadir's loose outskirts. Nearly every occupied building should eventually
have a street address. A distant holding can reach a named way by a long private
approach. Prefer growing those connections during development. One candidate is to
remember the routes people already walk, let buildings displace informal routes, and
improve stretches that multiple journeys share. Keep the building entrance, its
access route and the named way it reaches distinct. Decide whether a finishing pass
is needed after observing what recurring movement connects.

Evorno retained its two founding buildings for all eighteen rounds. Treat that as an
unresolved growth failure. Connecting those two buildings would leave that failure
intact. Use the existing harness to locate where further occupation stops.

Execution plan `a9f733fb-c94c-45cf-8959-2266c602a95b`:

1. Follow construction from candidate land through an accepted holding on the retained
   Evorno site. Repair the decision responsible for the stall and keep the named-town
   trace available in the local atlas.
2. Retain courses used by walkers in the town fabric. Reuse shared segments on later
   journeys, reroute around new occupation, and let repeated use support a first lane or
   an improvement to the existing network during the ordinary movement process.
3. Resolve indirect addresses at the junction reached by the approach. Publish the
   access geometry and the address through the existing GIS and staged town previews.
4. Compare Evorno and Amadir in the local atlas at their previous extents. Inspect
   settlement growth, rural approaches and their connections to named ways.

The growth and approach changes have been exercised on both mature towns. The
remaining access question is the physical entrance to an occupied holding when
its original parcel entrance is obstructed. Some unaddressed entrances fall
inside a published roof. A street number requires a usable route.

**The deliverable is a town that visibly grows from its inhabited kernel to its eventual extent over the development cycle.** At town overview scale, the occupied edge moves, density changes within the older settlement, and the street network takes shape as places are occupied and connected. The owner's finding on the current maps is that round one already establishes nearly the whole visible layout. A smaller initial stamp followed by the old development algorithm would reproduce that failure. The graph, connected projects and contracts below are means of changing what land gets built on in successive rounds.

**The recurring decision is where and how to grow next.** At each pass, derive opportunities from the *present* occupied fabric: underused or crowded holdings, ends of built streets, reachable land beyond the inhabited edge, and outlying livelihoods worth connecting. Movement and construction must be able to produce new frontage as well as consume it. Compare developing an edge with filling or rebuilding an existing frontage and establishing a separate cluster. Fit the selected work to land, access and competing uses; carry its actual streets, buildings and remaining opportunities into the next pass. An inherited country road can cross the whole frame while its inhabited portion grows along it over many passes.

**The intended trajectory is cumulative.** Viewed in sequence, each iteration should read as a further stage of settlement, with growth spread roughly evenly across the cycle. People housed, density and sprawl are ways to imagine that progression. One pass might build along a way into the countryside and another might house more people on an already busy street. The owner uses monotonic, roughly linear growth to describe the design. Do not select, compute, target or test a growth metric or encode a proxy curve. The processes determine which physical changes accrue.

Sulion expansion `b94d1699-cf92-475b-8940-71249f66bfef` tracks the six implementation phases and their current status. The owner requires repeated interacting town-scale processes, inhabited kernels, flexible connected placement, POI-owned rules, a contracts-only first phase, and preservation of the independent town schedule. The Rust type names and routing choices below are proposed mechanisms. [Settlement growth research](settlement-growth-research.md) gives the reasoning behind them.

**Growth cadence.** Keep roughly 18 iterations of comparable magnitude. Town processes recur together throughout development; an individual process may run at a regular interval such as every other iteration. Commerce, roads and foot traffic can influence one another throughout the cycle. Each iteration can realize multiple projects, and a connected project can place or adapt several holdings and routes. This leaves room for a large town to grow over the same number of iterations. The amount of work per pass remains an open design choice. Comparable magnitude is qualitative guidance, with no per-round placement quota or growth target.

### 1. Replace production interfaces only

Change the existing Aggregate, Specification, Strategy and Command interfaces in `town/fabric.rs`, `town/catalogue.rs`, `town/access.rs` and `processes/town/mod.rs`. Use the existing shared executor and typed query/command bindings. Change signatures first and let real callers fail compilation until migrated. Algorithms, catalogue population and caller rewrites begin in phase 2.

| Contract | Current production boundary | Proposed replacement or extension |
|---|---|---|
| Physical fabric | A holding has a stable ID, a slot with a street index, an outline and roof geometries. A street owns a polyline and sampled widths. | Retain these shapes and the identity of the named street. Give junctions, traversable stretches and entrances typed identities. An entrance joins a particular holding or public space to a stretch or passage and declares permitted access. Inserting a crossing splits a stretch and preserves its street and attached entrances. Frontage and rear/service access can differ. |
| Economic fabric | Provider sources have IDs, coordinates, activity and scalar offers. Livelihood retains support, occupation and means after calculating reach. | Give source and consumer endpoints typed references to holdings, fields or external destinations. Retain enacted work, supply, service and claim relationships with their strength and access requirements. Keep costs, candidate matches and routed loads as derived reads. A site's potential to provide work and a household actually working there are different facts. |
| Purpose and proposal | A purpose has an anchor, investment and relationship specifications. Strategies usually return one `FabricEdit`. | Preserve purposes as outstanding needs. Extend specifications to refer to actual participants and distinguish shared sponsorship, physical frontage and routed access. A proposed project binds existing participants or project-local roles, composes edits, and identifies which relationships must hold for the intervention to work. |
| Mutation | `FabricOwner::apply` handles establish, reuse, share, divide, connect and enclose. Several callers also update owner state directly through methods. | Add one composite command to the same owner, with single edits as the one-operation case. Its result resolves proposed roles to actual IDs. A stale claim, disconnected required entrance or failed parcel fit declines the affected project without orphan geometry, spent effort or dangling edges. Domain processes keep narrow operations for occupation, wear and maintenance. |
| POI and pattern ownership | POI definitions supply siting, sharing and development rules. Construction also branches on a square slot. | POIs declare offers, needs, admissible premises and changes of use. A placement strategy owns relationships among roles and can bind multiple roles to existing suitable premises. The fabric validates topology, claims and geometry. Delete square-specific ranking, forced occupancy and width handling from shared construction. |

### 2. Grow the occupied edge and street network across successive rounds

This is the first behavioral implementation. Deliver founding and repeated growth together. After a local way and its holdings are established, later rounds can extend or branch that way, occupy the resulting frontage, or build more densely on an earlier claim. Each decision changes the opportunities available on the following pass. Use the existing livelihood reads until phase 3 supplies routed ties. A change confined to the founding frame leaves this phase incomplete.

In `atlas/town/site.rs` retain captured seats, landmarks, terrain, approach destinations and scale. In `atlas/town/development.rs` replace initialization that calls `main_street(arm, f64::MAX, final_size, ...)` for each arm. Distinguish a captured through-way, a destination beyond the map and a locally built street. Preserve any actual inherited connection. Give the founder enough occupied frontage, housing and livelihood to make the first round meaningful. Reuse a captured way or establish the local connection needed by the founding group. Use the composite command for this first concrete pattern. Remove the round-zero final-size crossroads decision as movement adopts responsibility for through connections. Keep width variation and the requirement that major crossings reach the countryside.

Move ownership of round advancement out of `construction::advance` into the town development cycle so settlement age progresses once per round even when no project is built. Retain the existing 18 independent rounds as the starting schedule. A seat can contain multiple growth centres anchored to actual places; each centre can acquire relationships of its own while retaining the identity of the settlement. Separately named captured seats keep their identities even if later linked by development.

### 3. Let changing destinations redirect expansion and reshape streets

Migrate `atlas/town/providers.rs`, `town/influence.rs` and `economy::advance` to return compatible reachable counterparties as well as aggregate site conditions. Compare current and alternative ties by access, demand, competing supply and condition. Strengthen an operating tie, weaken it when the destination loses capacity or reach, and let viable alternatives acquire demand. Retain means, occupation and crowding as holding state. Use actual usable floors for housing capacity and the lattice census as approximate demand.

Extend `town/access.rs` so a trip between bound entrances can return the stretches traversed and their cost for the declared mode. Use existing spatial noding, gate restrictions and external links. In `movement::traffic` replace frontage-based wear with loads from these journeys. Derive shared routes once per relevant origin/mode and reuse them across destinations. Compute loads as a round read; store the resulting wear and built changes. An unreachable destination contributes unmet access demand. Establishment, demolition, widening, a changed entrance or a broken tie invalidates the relevant reads.

Movement compares extending an existing way, widening a loaded stretch, opening a passage, connecting two centres, or leaving a need unresolved. Require actual land and an accessible endpoint. Widening must confront the claims and buildings along the proposed stretch. Keep the existing GEOS intersection, clearance and through-route machinery. This makes a main road, cross street and local lane possible outcomes of repeated investment at distinct places.

### 4. Grow coherent clusters and additional centres through connected projects

Expand investment's existing reuse/share strategies into locally fitted connected proposals. Start from an unmet purpose, an established participant or reachable demand. Search the actual adjoining or reachable fabric once for the whole group. First bind suitable premises, then propose adaptation or construction for missing roles. Compare competing proposals on the need served, resources, access and displaced uses. Commit the coherent portion whose essential roles fit; shed optional roles before commitment. Reassess the purpose against the changed fabric. Another independent strategy can respond next round. This uses the Canonry connected-component idea with the town's own selection and feasibility semantics.

Adopt founding, livelihood clusters and civic investment through this interface. An exchange project may give several businesses frontage on a used open area, widen a trading street, or use available premises. Co-financed institutions may occupy distant sites. Sponsorship alone creates no adjacency. A successful project creates ordinary holdings and ties which can be divided, rerouted, enclosed, reused or lost. Remove explicit square-slot preference from the construction caller once real access to public frontage participates in the common proposal contract.

### 5. Grow inward and outward through competing uses of the same land

Keep the selected operation order in `atlas/features/domain.rs` and the town process registry. At the start of a round, cultivation uses the prior fabric; movement reads existing ties and changes routes; signals use the changed fabric; livelihood can rebind demand on the new routes. Sanitation, land competition, investment, construction and maintenance then change conditions, claims and occupation. Trips from new or redirected ties affect movement on its next scheduled pass. Preserve the final cultivation/publication pass. This identifies exactly where a change crosses a round boundary.

| Process | Change in decisions and retained output |
|---|---|
| Signals and sanitation | Keep exchange and waste on the triangular lattice, with existing transport and clearance operations. Bind sources to operating premises and access where relevant. Repeated use can increase both opportunity and burden; closure, clearance and exposure can reverse the advantage. |
| Land competition, construction and maintenance | Keep existing division, rear access, reuse and condition changes. Add alternatives for a second dwelling, an upper storey, attached frontage, encroachment and continued public use. Select them from actual crowding, usable area, means, exposure, claims and access. Store the adopted building geometry and floors. Publication currently invents floor counts from holding attributes; move that decision to the building change. Preserve earlier boundaries or buildings when the edit allows it. |
| Collective investment | Bind purposes to affected centres and actual counterparties. Institutions can sponsor or protect an open space while other users press to occupy it. Gates and walls change access and the land cost of expanding. Model their effects through routes and claims. |
| Cultivation and expansion | Preserve field geometry, worked-by identity and rural supplies. Use reachable labour, suitable ground, environmental providers and contested land to extend, retain or surrender working land. Let an outlying cluster of work and households become another centre; extending frontage and connecting the clusters can join their built areas. Preserve undeveloped, common and other occupied land. |
| POI catalogue | Migrate the existing family and residential-form inventory through these mechanisms. Keep site requirements, sharing, activity, craft and compound-building behavior with each owner. Reuse geometry for roofs and public furnishings where a development decision justifies it. Review actual callers for identity or label dispatch and per-POI substitutes embedded in generic processes. |

A landing illustrates the full sequence. A connected project establishes work, binds a yard and links households. Occupation and supply generate journeys. In a later round movement detects the shared crossing's load. Existing claims may favour widening, a different passage, or housing near the work. The next livelihood pass can redirect ties. The old street may lose support and its premises become available for reuse. Terrain, magic, existing investment and the actions of other processes can change any of those choices. This is an example of coupling; it does not prescribe a district or a required trajectory.

### 6. Publish, inspect and retire the superseded paths

Compare founding, early, middle and mature views from one run in the same frame and at the same overview scale. Keep the built streets, building footprints and open land visible. Read three changes directly from those views: where occupation extended beyond its previous edge, where existing frontage became denser or changed use, and which street extensions, branches or connections appeared later. A long inherited road counts as inherited geography. If the early and mature views have essentially the same occupied limits and street skeleton and differ chiefly in labels, roofs or graph attributes, reopen the growth mechanism. Quiet intervals and locally constrained directions are legitimate; the whole-cycle evolution is the criterion.

Persist authoritative geometry, identities, activity ties, purposes and claims in current-format generation checkpoints. Rebuild derived access and flow reads on resume. `publication/town.rs` extracts realized geometry, floors, use, frontage/access and relevant named relationships through the existing GIS writer. Browser and native hosts run the same Rust core. A future manually moved POI could use the same attachment and livelihood operations with existing streets and buildings; editor integration is separate work.

Use supplied small geometries for the new contract risks: splitting an occupied stretch retains access; a composite edit that loses required frontage leaves no partial holding; a changed route reallocates journeys; shared investment can succeed at two separate sites. Exercise normal publication and checkpoint boundaries. Use independent ownership review during adoption. After process and POI migration, inspect early, intermediate and mature fabric from the same native Amadir run and compare with a contrasting site such as Evorno. Look for a network and neighbourhoods whose changing use explains their shape, including different centre/fringe outcomes. Measure the comparable native workload once after the batch. Retire old routing, scalar-only opportunity decisions, square dispatch and final-size initialization as each production caller adopts its replacement. No separate proof report.

## Outcome and authority

Review building spacing first. Compare isolated premises, incidental neighbours and changes in older occupied areas with the road and parcel layers hidden. Restore those layers to inspect main ways, country crossings, pedestrian access, widths and working land. Gaps may remain unused through the whole history.

A town of roughly 5,000 people should read as a lived medieval-scale place: a civic
and commercial focus, recognizably different neighbourhoods, working premises mixed
with homes, dense streets and quieter spaces, an irregular transition to rural land,
and farms whose buildings, holdings and access belong together. The town should offer
memorable places for play. A connected street network is one ingredient.

Owner requirements and corrections from the current conversation:

- Each POI owns every rule specific to it. The M2/M3 completion assessment missed
  consumer-owned rules in investment, siting, access, trails and publication.
  The ownership review covers those production callers and the guards that allowed them.
- Design before further implementation. Use the same software architecture as the
  other generation systems, with multiple processes whose effects overlap and interact.
- Repeated development rounds apply mechanisms, not declared end states. Economic
  diffusion, construction, sanitation and security illustrate that distinction;
  they do not exhaust the possible mechanisms.
- Use a hybrid model to drive coherence: town-scale intentions, interacting pressures
  and local development projects. Projects adapt the existing fabric; they must not
  stamp finished neighbourhoods or reset the town to an ideal layout.
- Numerical lattice population density, terrain and magic all influence layout.
  Human-layer density is an approximate census, not an obligation to place people
  in corresponding cells. Artistic composition and rule of cool have priority over
  numerical accuracy. Do not reconcile building occupants with lattice totals.
- Support influences on town development through generic, extensible coupling.
  Magic access, landmarks and river/road connections illustrate the feature class;
  they are not a closed list of source-specific prosperity rules.
- Produce meaningful market/civic structure, differences in wealth and living
  conditions, declining density toward the outskirts and agricultural homesteads.
  These examples start the design; they do not exhaust its scope.
- Retain the improved street connectivity. Complete town structure before returning
  to the separate problem of missing terrain variation.
- Work in the main checkout on its existing branch. Execute all phases.
- The agent owns technical decisions. Record choices that affect later stages or
  prevent an incomplete implementation; resolve routine details in code rather than
  deferring them to the owner or repeatedly reopening planning readiness.

Standing boundaries: shared Rust generation; one triangular lattice; independent
children; spatial-kernel geometry; real-metre features; publication during production;
GIS-only viewing, inspection and export; existing authoring contracts and stable feature
identities. Preserve the supported completed-boundary checkpoint model.

This proposal uses aggregate activity and spatial development. It excludes individual-person
simulation, economic accounting, an ECS, another scheduler, another spatial grid, a new
database and a detailed recovery journal; none is needed for the requested town behaviour.

The following model and process divisions are proposals. They are not additional owner
requirements. Replace them when a simpler complete mechanism produces the desired maps.

## Baseline before this implementation

Unless qualified, Rust source paths below are relative to `crates/atlas-generation/src/`.

- `atlas/town.rs` registers one publish command, reads a site, calls `plan::lay` for
  each settlement, lays surrounding fields and publishes records.
- `atlas/regional/sequence.rs::real_scale` appends that command after the regional
  development sequence. Town structure does not participate in the development rounds.
- `atlas/town/site.rs` samples terrain for reservations and siting, but obtains the
  town's population total and story from a point record. The layout process receives
  neither the spatial population distribution nor the composed magical questions.
- `plan.rs` reserves a square, lays roads, places special buildings, then takes
  available rectangular frontage slots for ordinary households. Nearness to the centre
  affects allocation order, not the character of occupation or a density transition.
- `wards.rs` assigns angular sectors. `uses.rs` assigns special uses by counts and
  ordinary trades by an interval in the household list. These are labels and placement
  rules, not neighbourhood formation.
- `fields.rs` creates field polygons and strips; it does not create rural households
  and their associated farm building groups. Ordinary farmstead barns exist only for
  the smallest settlement sizes in `plan::finish`.

The recent `growth.rs` repair provides useful GEOS junction constraints and continuing
streets. Its perpendicular branching and geometric extent are agent-derived choices,
not the desired town-development model. Reuse its junction operations where useful;
street demand and orientation must come from the town's developing structure.

These findings come from current Rust bodies. Earlier society-design discussions
emphasized retained change and interacting processes; their earlier proposed record
models are not implementation authority for the current Rust system.

## Historical reference and adaptation

[Historic England, Settlement Sites to 1500, pp. 18–19](https://historicengland.org.uk/images-books/publications/dssg-settlement-sites-1500/heag253-settlement-sites-to-1500-ssg/)
describes planned medieval streets, narrow holdings behind frontages, elongated market
spaces, back access, civic institutions, working waterfronts and craft concentrations.
It also describes successive development rather than one universal plan. The adaptation
is to model property, activity, access and institutions together. Making every road
crooked would not supply the missing structure.

[Historic England, Medieval Settlements, pp. 2–4](https://historicengland.org.uk/images-books/publications/iha-medieval-settlements/heag210-medieval-settlements/)
describes variation between compact and dispersed settlement and holdings containing
houses, agricultural buildings, yards and gardens. The adaptation is a rural settlement
process coupled to holdings and working land, with both clustered and isolated farms.

These are English references, not a mandate to reproduce England or its institutions.
Fictional cultures, environments and magic can produce other forms. The earlier
[Parish and Muller street algorithm](https://people.eecs.berkeley.edu/~sequin/CS285/PAPERS/Parish_Muller01.pdf)
remains a reference for local connection constraints, not a model of medieval society.

## Settlement catalogue proposal — 2026-11-17

The owner's suggested catalogue direction is a design lead, not a mandate for the
example POIs or properties. The requirement is to examine the whole settlement feature
set, grounded in historical literature and medieval city builders, with breadth useful
for TTRPG play. This section is a proposed first catalogue, not implemented runtime data.
It precedes M1. Exact family boundaries, field names and tuning values remain revisable.

### Recommendation and scope

Define settlement **places**, including outdoor spaces, infrastructure and residential
forms. A place may occupy a room, a building, several buildings or an open area. Its
activity need not match a building one-to-one: a household can live over a shop, several
traders can share a hall, and a monastery can contain several activities. The catalogue
provides stable identities and facts; processes select, place and transform instances.

Prioritize places supporting encounters, information, shelter, supplies, authority,
belief, danger, movement and recognizable daily life. These are reasons for including
families, not required quest hooks or new simulation subsystems. Production appears
where it changes the map or creates a useful place. Do not reproduce commodity chains,
one building per intermediate good, worker rosters, taxes or economic balance sheets.

Start with the inventory below. It is intentionally broader than shops and monuments,
but does not imply every town contains one instance of every row. Common services can
be shared or absent; specialized institutions need context. An exceptional local site
can outweigh a low ordinary occurrence weight. Preserve captured named places before
considering additional instances.

### Lessons from the existing catalogues

- `rock/catalogue.rs::RockKind` separates stable identity/family and material facts from
  `rock/material.rs::MaterialLayer`, which retains placement, condition and history.
  Apply the same type/instance distinction to town places; a prosperous inn can decline
  without changing its type to a separate ruined-inn catalogue entry.
- `field/poi/contract.rs::Entry` separates existence, publication, cross-map behaviour
  and roles such as visibility, naming, movement and relationships. Reuse those meanings
  and the global catalogue's common publication path. Its callbacks over lattice places
  are not directly a catalogue of building morphology.
- Existing global kinds include mill, harbour, forge, archive and shrine. Their detailed
  local representation must extend or compose the same entity, not generate a duplicate
  because a town catalogue contains a similarly named facility. Several buildings may
  be parts of that entity. New purely local place identities can use the common POI
  publication/significance mechanisms without pretending their location is a cell centre.
- The current `atlas-map/src/town/uses.rs` has useful shared vocabulary, but its fixed
  size/storey/occupant rules and single workshop trade list are not sufficient for this
  catalogue. Avoid adding another independent switch over the same uses.

Use a typed domain catalogue in `atlas-generation/src/town/catalogue/` for generation
facts and profile references. Shared published kind/variant IDs and inspection vocabulary
belong in `atlas-map`; the viewer does not load generation rules. Bind behaviour beside
process owners. Do not copy the entire global POI role structure into each shop or build
a parallel visibility/naming framework. The exact adapter is M1 work after tracing the
current geometric `Place` and publication consumers.

### Type shape and field meanings

Proposed Rust contract sketch; subordinate types below describe intended contracts,
not already implemented symbols. The final table should be statically typed, with
stable persisted IDs, as the rock catalogue is. No string-keyed property bags for rules.

```rust
enum TownPlaceKind {
    Exchange(ExchangeKind),
    Hospitality(HospitalityKind),
    Workshop(WorkshopKind),
    Retail(RetailKind),
    Civic(CivicKind),
    Worship(WorshipKind),
    Care(CareKind),
    Learning(LearningKind),
    PublicSpace(PublicSpaceKind),
    Infrastructure(InfrastructureKind),
    Rural(RuralKind),
    Residence(ResidentialForm),
    CraftPractice(ExistingCraft),
}

struct PlaceDefinition {
    kind: TownPlaceKind,
    identity: PlaceIdentity,
    prominence: ProminenceProfile,
    scale: SpatialEnvelope,
    means: MeansProfile,
    occurrence: OccurrenceProfile,
    form: FormProfile,
    relationships: &'static [PlaceRelationship],
    effects: &'static [PlaceInfluence],
    map: MapProfile,
}

struct PlaceInstance {
    id: PlaceId,
    kind: TownPlaceKind,
    holding: Option<HoldingId>,
    parts: Vec<FeatureId>,
    means: MeansBand,
    trading: TradingState,
    condition: BuildingCondition,
    occupation: OccupationState,
    // Geometry, retained change and relationships belong to the town owner.
}
```

| Typed field      | Intended meaning                                                                                                                                                                                                                                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity         | Stable kind ID, family, display/naming term and typed variant. A discriminated kind prevents invalid combinations such as an inn with a goldsmith variant.                                                                                                                                            |
| Prominence       | Distinct functional reach, visual salience and cultural importance; defaults feed existing POI significance. A small shrine can be important, a large storehouse visually recessive. TTRPG usefulness guides catalogue inclusion rather than forcing every feature to carry a quest score.            |
| Spatial envelope | Separate building footprint, total floor area, open/working area, holding area, frontage/depth, storeys and component counts. Use unit newtypes and bounded ranges with a preferred region, not one square-foot number. Outdoor-only and compound forms are typed alternatives to building envelopes. |
| Means            | Typical operator/resident means and clientele range, with public, institutional and household funding distinguished. These are ordinal layout facts, not annual revenue.                                                                                                                              |
| Occurrence       | Contextual commonness and relevant settlement roles, traditions, routes and environments. Indicates repeatability, clustering or association with an institution; it does not impose a quota or minimum population gate.                                                                              |
| Form             | Street-edge, passage-access, yard, court, compound, detached, open-space or linear morphology; possible attached residence and ancillary structures; preferred access and spacing.                                                                                                                    |
| Relationships    | Typed attraction, avoidance, adjacency, containment, shared-premises and access relationships. Separate true requirements from preferences; most adjacency rules should remain soft.                                                                                                                  |
| Influences       | Noise, smoke, smell, gathering, traffic, prestige, shelter and other concrete effects consumed by processes. No universal desirability field and no generic magic bonus.                                                                                                                              |
| Map profile      | Existing geometry/support/significance rules, label role, public versus concealed access, parts and parent-place identity, and compatibility with structure maps. Visibility does not determine whether the place exists.                                                                             |
| Instance state   | Realized size/means, trading activity, occupancy, maintenance, condition and change. A rich but neglected household and a thriving low-price tavern must both be representable.                                                                                                                       |

Canonical sizes stay in metres and square metres through the existing scale contract.
Square feet can be a display unit. Explicitly distinguish floor area from footprint:
two storeys do not require twice the land. Initial size ranges are artistic layout
envelopes, not claimed historical measurements, absolute output caps or census obligations.
Set actual controls in code when the catalogue is implemented, not in competing prose tables.

`TradingState` applies to businesses: struggling, steady, flourishing or inactive.
It is separate from building condition and resident/operator means. Institutions and
open spaces do not receive fake commercial income; their maintenance and occupation
still vary. Residential crowding is also independent of means and maintenance.

### Families, variants and spatial exceptions

A variant can share a family's form, dimensions, relationships and process bindings when
it mainly changes the name, visual assets, stock/service description and cultural flavour.
Use a typed subtype or a different family when access, emissions, required working area,
security or component structure changes. Small factual overrides are sufficient for a
variant; inheritance trees and an arbitrary rule language are unnecessary.

For example, fine craft premises can share a shop-house form for a jeweller, goldsmith,
engraver or instrument maker. A merchant selling books may share a retail form with a
clothier; bookbinding is a workshop activity, not automatically the same variant. A
smithy needs a working yard and heat/smoke behaviour. A tannery needs different water,
effluent and edge relationships again. A wealthy townhouse may share a building with
any of these compatible activities. Do not let palette swaps erase those distinctions.

### Proposed initial place inventory

Each numbered row is a family with a distinct spatial or play role. Semicolon-separated
variants are typed selections, not mandatory separate generators. Examples of variants
illustrate the available breadth; the data catalogue can choose a smaller initial set.
Ordinary residences are listed separately below.

| ID  | Family and candidate variants                                             | Form and process-relevant distinction                                                                                                                                  |
| --- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P01 | Market place: street market; square; covered stalls                       | Public circulation and temporary occupation; several traders share space; can anchor streets.                                                                          |
| P02 | Market/exchange hall: general; cloth; merchants' exchange                 | Enclosed public trade, entrances and service access; can be a civic hall's ground floor.                                                                               |
| P03 | Provision seller: baker; butcher; fishmonger; grocer                      | Stall or shop-house; preparation/delivery facts vary, slaughter or heavy ovens need explicit support.                                                                  |
| P04 | Specialist retailer: clothier; bookseller; outfitter; spice merchant      | Trading frontage and optional dwelling/store; rarity follows customers and connections.                                                                                |
| P05 | Fine craft shop-house: jeweller; goldsmith; engraver; instrument maker    | Small workshop/display, valuable stock and security; modest workshop emissions as applicable.                                                                          |
| P06 | Domestic craft premises: tailor; cobbler; weaver; leatherworker           | Home and workshop share a holding; rear workroom or yard, market and household access.                                                                                 |
| P07 | Heavy craft yard: carpenter; cooper; mason; cartwright                    | Larger working/delivery yard and noise; does not require a commodity-chain simulation.                                                                                 |
| P08 | Smithy: general smith; armourer; farrier                                  | Heat, smoke, working/service space; farrier's animal access differs from a small metalworker.                                                                          |
| P09 | Wet or noxious works: tannery; dyeworks; slaughter yard                   | Water/effluent or nuisance exposure and neighbour response; prefer appropriate edge/service access.                                                                    |
| P10 | Mill: water; wind; animal-powered                                         | Power-specific form and access; reuse a captured mill identity when present.                                                                                           |
| P11 | Brewhouse                                                                 | Working vessels, deliveries and possible attached residence or drinking room.                                                                                          |
| P12 | Inn: roadside; merchant; pilgrimage                                       | Lodging and gathering, with yard/stabling where appropriate; can be a compound.                                                                                        |
| P13 | Drinking house: alehouse; tavern; wine house                              | Gathering and noise; ranges from a room in a house to a larger venue, without mandatory lodging.                                                                       |
| P14 | Eating place: cookshop; communal bakehouse; shared cooking yard           | Public service, shared yard or market association; ovens and waste handled where present.                                                                              |
| P15 | Stable/carrier yard: livery; carter; pack train                           | Animal/cart turning and deliveries; useful connection between gates, inns and market.                                                                                  |
| P16 | Storehouse: merchant warehouse; communal granary                          | Storage, security and service frontage; dockside only where relevant.                                                                                                  |
| P17 | Landing/quay: ferry landing; fishing quay; cargo wharf                    | Water-edge access and paths; facilities can be small parts of a captured harbour.                                                                                      |
| P18 | Town/assembly hall                                                        | Governance and public assembly; may contain court, market, treasury or records rooms.                                                                                  |
| P19 | Guild/livery hall: merchant; craft; confraternity                         | Group meeting and patronage; compound or reused house rather than always a monument.                                                                                   |
| P20 | Court and confinement: courthouse; gaol                                   | Institutional/public access with secured parts; can share civic premises.                                                                                              |
| P21 | Watch/garrison premises: watchhouse; barracks                             | Patrol/access and secure yard; not every settlement needs a barracks.                                                                                                  |
| P22 | Gate/toll facility: gatehouse; bridge tollhouse; weigh house              | A node on an actual route, with controlled passage and gathering/deliveries.                                                                                           |
| P23 | Lordly residence: manor; fortified residence; small keep                  | Household and authority, enclosed yard, service buildings and conspicuous position.                                                                                    |
| P24 | Worship house: neighbourhood chapel; temple; major sanctuary              | Gathering and cultural significance; precinct and associated buildings depend on scale/tradition.                                                                      |
| P25 | Shrine/sacred site: wayside; spring; courtyard                            | Small building, marker or outdoor site; can reuse an existing global shrine.                                                                                           |
| P26 | Religious house: monastery; convent; analogous communal institution       | Compound with residential, ritual, service and productive parts; traditions choose the names/form.                                                                     |
| P27 | Burial/memorial ground: graveyard; ossuary; memorial enclosure            | Open land with paths and possible small structures; can share a worship precinct.                                                                                      |
| P28 | Healer's premises: barber-surgeon; herbalist; apothecary                  | Consultation/retail, household or garden as applicable; not a mandatory modern clinic.                                                                                 |
| P29 | Hospital/almshouse                                                        | Care, hospitality or communal residence shaped by local institutions; courtyard/compound form.                                                                         |
| P30 | Learned premises: school; scribe/notary; archive/library                  | Quiet rooms, records and meeting; modest shop-house or institutional component.                                                                                        |
| P31 | Public water point: well; cistern; conduit/fountain                       | Small shared gathering/access space; water supply type affects placement.                                                                                              |
| P32 | Bath/wash premises: bathhouse; wash yard                                  | Water, privacy, drainage and potentially heat; composite with other premises where justified.                                                                          |
| P33 | Sanitation/service site: public latrine; refuse yard                      | Service access and nuisance exposure; often small or visually recessive, useful local geography.                                                                       |
| P34 | Green/common: neighbourhood green; grazing common                         | Shared open ground; circulation, animals, gathering and retained negative space.                                                                                       |
| P35 | Enclosed garden/pleasure ground: civic; institutional; private            | Ownership and access matter; do not impose a modern municipal park on every town.                                                                                      |
| P36 | Fair/revel ground: fair; games; performance                               | Episodic use, booths and open gathering; often near an approach or edge.                                                                                               |
| P37 | Entertainment/vice premises: gaming house; performance house; bawdy house | Gathering, privacy and neighbour response; optional tone/context, not assumed universal.                                                                               |
| P38 | Farmstead: arable; pastoral; market-garden                                | House, working yard, barns/sheds and links to working land; one holding may serve many fields.                                                                         |
| P39 | Agricultural/service outbuilding: barn; byre; dovecote; store             | Usually a component of a household or institution rather than a separately named POI.                                                                                  |
| P40 | Peripheral work site: quarry yard; timber yard; fishing station           | Locally supported working landscape and access; quarry or resource existence is contextual.                                                                            |
| P41 | Magical practice premises                                                 | A host for an existing craft, activity or institution and its actual medium/access needs; no new magic school, universal mage guild or seven cosmetic temple variants. |

Bridge, wall, street, path, household plot, watercourse and existing natural/magical
landmarks remain first-class geography. They are not omitted because they are not rows
in this activity catalogue. Reuse their owners and link associated facilities to them.
Vacancy, abandonment, ruin, secrecy and supernatural reputation are instance states or
contextual associations, not a second copy of every family. A concealed meeting place
can occupy an ordinary cellar without a visibly labelled thieves' guild building.

### Residential forms and neighbourhood character

Define residential morphology separately from wealth and current condition. A
neighbourhood's character summarizes several forms and activities and may influence
further occupation; it is not an exclusive zone that makes all residents identical.
The following are proposed forms, with characteristic layouts rather than rigid classes.

| Form                                 | Spatial character and useful variation                                                                                                                     |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R01 Cottage/croft                    | Small detached or loosely grouped dwelling with garden/working rear ground; poorer and comfortable versions can both exist.                                |
| R02 Street/burgage household         | Narrow frontage, deeper holding, rear yard/garden/outbuildings; shared walls or gaps; subdivision and consolidation possible.                              |
| R03 Shop-house                       | Residence over/behind a trading or working frontage; wealth, size and neighbour effects follow actual activity.                                            |
| R04 Court/lodging cluster            | Several residences reached by a passage or shared court; dense occupation can be maintained or deteriorated.                                               |
| R05 Informal/incremental cluster     | Opportunistic small plots, accretion, irregular service access and vulnerable tenure; deprivation is possible, not a universal identity for its residents. |
| R06 Prosperous courtyard household   | Larger rooms/buildings, private court, service access and possible garden; can be dense within a valuable central block.                                   |
| R07 Elite compound                   | Main residence, enclosed grounds and ancillary/service buildings; either urban or peripheral, with a strong spatial claim.                                 |
| R08 Communal/institutional residence | Dormitory, lodging range or shared residential court as part of another place; avoid counting the same institution's residents as separate houses.         |

Farmstead residence belongs to P38 rather than being a mandatory rural tier in this list.
Estate staff, tenants and workshop households can occupy different forms within one
holding. Low income does not imply detached huts; prosperity does not imply low density.

Useful emergent character descriptions include mixed commercial frontage, established
household streets, crowded courts, poor edge settlement, prosperous enclaves and a
garden/farm fringe. Treat a slum as an overlap of deprivation, crowding, weak services,
condition and tenure, rather than a synonym for all low-income housing. Do not hard-code
poor outskirts versus rich centre. Neither these descriptions nor ward names are
substitutes for the underlying layout and activity facts.

If development needs a deliberate district tendency, use a typed `NeighbourhoodProfile`
that combines preferred residential forms, a means distribution, mixed-use tendencies,
access/open-space preferences and responses to crowding and nuisance. Examples include
an established mixed household quarter, a prosperous enclave and crowded poor courts.
These are revisable process inputs with overlapping influence, not exclusive zoning or
one housing model per income band. Avoid building this profile machinery before the
occupation and holding processes actually need a shared description.

### How catalogue facts become interacting processes

Occurrence profiles propose opportunities; trade, institutions, population context and
composition decide which ones develop. A selected type is a spatial demand, not an
instruction to drop a rectangle into the next available slot. Holdings/construction
resolve its form; access connects actual entrances/service routes; occupation and
neighbour effects alter later choices. Multiple compatible activities can share premises.

For a fine craft shop-house, a quiet frontage, clientele and security can be preferences;
its realized operator may be comfortable or struggling, with a household above. A
smithy creates different working-space and emission effects; nearby affordable housing
may become denser without being assigned a slum label in advance. A worship precinct
can reserve a court that later shops encroach on. This is the catalogue supplying facts
to overlapping processes, not embedding the processes in a building-type switch.

Do not require commodity prerequisites such as an entire ore-to-jewellery chain before
a jeweller can appear. Broad support can come from trade connections, a patron or the
town's role. Artistic composition may favour a memorable exception. Structural validity,
meaningful access and useful typed distinctions still matter; census precision does not.

### Research basis, transferable ideas and limits

- Helen Clarke, [Public buildings in English towns: a preliminary survey](https://www.persee.fr/doc/acsam_0000-0000_1994_act_4_1_1079)
  (1994), pp. 225–226: civic functions span halls, courts, assembly places, gates,
  quays and public services. This supports the civic/infrastructure breadth above,
  not a claim that each settlement possessed a distinct building for each function.
- Historic England, [Commercial Sites](https://historicengland.org.uk/images-books/publications/dssg-commercial/heag240-commercial-sites-ssg/)
  (2018), pp. 4–5: markets and fairs, shop fronts, cellars, craft concentrations and
  nuisance-related separation. Adapt these spatial relationships, not a full economy.
- [Manor Lords official building catalogue](https://wiki.hoodedhorse.com/Manor_Lords/Buildings)
  and [burgage plots](https://wiki.hoodedhorse.com/Manor_Lords/Burgage_plot): flexible
  holdings combine residence, extra living space and backyard activities. Transfer the
  holding/component idea; omit production recipes, unlock trees and fixed household counts.
- [Foundation's official building catalogue](https://wiki.polymorph.games/foundation/Modular_Building)
  distinguishes modular compounds and sub-buildings. Its [housing documentation](https://wiki.polymorph.games/foundation/House)
  separates quality from density, while the developer's [desirability update](https://www.polymorph.games/foundation/news/2023/09/14/the-1-9-6-desirability-update-is-now-available/)
  discusses nuisance and degradation. Transfer independent dimensions and changing
  occupation; omit service-radius upgrade ladders and beautification scores.

Game documentation is design inspiration, not historical evidence; versions can change.
Historical sources reviewed here are predominantly English and do not establish a
universal medieval settlement kit. The inventory is a TTRPG adaptation, including
explicit fantasy and tonal options. Exact sizes, relative frequencies and clientele
ranges are proposed artistic controls still to tune, not results of historical measurement.

Implement a contrasting subset of catalogue definitions together with their real
consumers in M1, then expand the inventory in M2. The subset establishes outdoor/shared
space, mixed household/business occupation, a working nuisance and contrasting residential
forms; it does not reduce the eventual breadth. Confirm that a quiet retail variant needs
data/naming changes, while a new spatial effect reaches shared questions and owner
operations. Do not validate the catalogue by merely counting enum variants.

## Representation: approximate census into detailed spatial form

Use the lattice as geographic context and for private broad-pressure state, while
retaining owned geometric working state for exact town development. Publish the town's
present features through the existing map contract. Private numerical working state
does not imply numerical presentation output or a census-matching obligation.

| Representation                       | Authority and purpose                                                                                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Existing human layers                | Approximate population and land-use census; built/standing/remains and cultural/craft context. They suggest scale, concentration, rural versus urban character and prior occupation. |
| Existing physical and magical fields | Spatial opportunities, hazards, materials, movement conditions and system-specific media and effects. Read through their owners and shared questions.                                |
| Proposed town fabric                 | Actual local sites, route graph, holdings, activities, building groups and their retained development. Owns fine placement and local relationships.                                  |
| Derived queries                      | Access, footfall, crowding, available frontage, desirability and environmental exposure. Recompute from current inputs; do not become competing authorities.                         |
| Published GIS                        | Finished geometry, uses, estimated occupants, addresses, character, relationships and completed causes. Sufficient for viewing and inspection without generation data.               |

The town fabric does not simulate a second population. It realizes the approximate
census as a composition. It may concentrate a broad population share into a compact
town, move a market to a stronger site and leave gardens or commons where a numerical
cell suggested occupation. Occupant estimates communicate scale; they do not close an
account. Settlement identity and important captured landmarks remain meaningful.
Density must not be inferred solely from a captured point's headcount.

Retain these concrete spatial facts:

- **Sites and land claims:** civic, religious, commercial, defensive and productive
  premises, shared greens, burial grounds and reserved access; their footprint,
  established importance, development origin and current use.
- **Routes:** shared junctions and edges, width, mode of use, worn importance, destination
  and access relationships. A path can become a lane or market street; local access
  does not require another full-width through street.
- **Holdings:** polygons with boundaries, street frontage, rear/service access,
  occupation, approximate means and capacity to improve or subdivide. A holding can
  contain several households and several buildings; it is not one rectangle per house.
- **Activities and buildings:** homes, workshops, shops, storage and agriculture may
  share a holding. Building groups retain use, approximate occupants, condition and
  links to the holding and routes. Distinguish buildings from their courtyards and gardens.
- **Standing change:** established routes and boundaries, reused premises, subdivided
  holdings, vacancy, ruins and displaced activity. Later passes transform these facts
  rather than redraw the whole town from scratch.

Use typed IDs, compact tables and geometry handles with the existing spatial kernel.
GEOS supplies intersections, offsets, subdivision and proximity operations. The existing
reservation raster may remain disposable collision support; it must not determine town
form or become a second lattice. Do not store a material-style layer stack merely to
imitate rock: the useful similarity is retained owned facts and meaningful operations.

## Process architecture and shared questions

Follow [ADR 0011](adr/0011-processes-couple-through-keys-and-a-ledger.md): each process
owns its algorithm, settings, dependencies and executable operation. Pure algorithms
belong under `processes/`; atlas adapters bind them to map state and publication.
Feature operations select and register their executable steps from the same definitions.
The sequence composes those operations. Splitting `plan::lay` into helper functions
inside one opaque publish command would not meet this design.

Proposed module ownership:

| Location                                                        | Responsibility                                                                                                                                 |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `atlas-generation/src/town/`                                    | Retained fabric, typed spatial facts, owner commands and town queries; independent of host adapters and UI.                                    |
| `atlas-generation/src/processes/town/`                          | Actual development algorithms and their plain settings, divided by the effects below.                                                          |
| `atlas-generation/src/atlas/town/`                              | Capture/binding adapters and assembly with the atlas state; existing helpers move to their actual owners when adopted.                         |
| `atlas-generation/src/atlas/features/` and sequence composition | Select executable operations and causal positions through the existing mechanism; no parallel list of town step names.                         |
| `atlas-generation/src/publication/`                             | Extract the retained town into finished GIS during production. The current town record writer supplies reusable naming and record conventions. |
| `atlas-map/src/town/`                                           | Shared finished-map vocabulary and contracts, including the facts used by inspection and authoring.                                            |
| `atlas-gis` and `atlas-host`                                    | Existing geometry/storage capabilities and host wiring respectively; neither owns town algorithms.                                             |

One proposed `TownFabric` owner maintains spatial facts through registered commands:
reserve or release a site, connect or widen a route, establish or divide a holding,
occupy or reuse premises, and abandon or repair structures. Processes submit these
operations; they do not edit one another's backing collections. Incompatible geometric
claims are resolved by the owner against the available space, with domain priorities.
Overlapping influences and compatible mixed uses remain allowed.

Use existing `Query`, `Command` and projection boundaries. Numerical environmental
questions continue through `QuestionBook<Field, ...>`. Batch sampling onto an actual
site, proposed route or holding resolves area-weighted conditions and useful extrema
where the consumer needs them. It does not freeze an average across the whole town.

Town questions concern actual spatial requests: reaching a market, joining a street,
occupying a holding, obtaining service access or dividing a courtyard. The current
`QuestionBook` accepts a lattice-cell index and returns scalar answers; it does not
already support holding polygons or typed project requests. The earlier suggestion
to reuse it directly for those requests was not an established software contract.
Retain it for numerical environmental and broad-pressure questions. Use ordinary typed
`Query<State, ...>` operations with invocation inputs to combine those answers with
exact spatial relationships. A request batch is not a new grid. Do not generalize the
question-book API without a concrete consumer that the existing query boundary cannot serve.

Consumer-owned questions include travel cost, frontage access, commercial footfall,
livelihood access, occupation suitability and ability to alter established premises.
Environmental, route, activity and institutional providers contribute beside their
owners. Separate meanings remain separate: flood exposure, nuisance, prestige and
craft access are not one universal suitability or magic score. Process-local decisions
need no registered question until another owner actually contributes to them.

Queries cannot advance development. Later sequential commands see landed changes;
genuinely competing same-stage claims share their starting state. Invalidate derived
access and occupation queries at the existing command boundaries. Publication only
classifies and exports retained facts; it cannot develop the town.

### Extensible influences on development

The proposed pattern is consumer-owned questions with domain-owned contributions.
Movement, economic development, occupation and construction ask about the conditions
relevant to their decisions. Contributing domains implement their effects beside their
own state and register them at assembly. Receiving processes must not enumerate source
types or accumulate special cases for individual POIs, environments or magic systems.

Separate three responsibilities:

| Responsibility       | Ownership                                                                                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source domain        | The actual capability, demand, activity, hazard or restriction, its prerequisites and its current availability.                                       |
| Connection mechanism | How an influence reaches a recipient through a concrete relationship: exposure, accessible routes, service reach, membership or control, for example. |
| Receiving process    | The meaning of the composed conditions for its decision, and the commands that change its own retained state.                                         |

These are responsibilities, not a proposed universal effect record or a mandatory
three-stage runtime. A source can contribute to several questions; several domains
can contribute to one answer. Connections may themselves change as development alters
routes, occupation or institutions. Proximity is one possible relationship, not the
default propagation rule for every influence. Benefits need not reach every nearby
household, and availability does not establish access, permission or an ability to use it.

Keep demand, access, danger, permission, prestige and other meanings distinct. Do not
translate all sources into a generic benefit or desirability score. Contributions may
add a burden, change a cost, establish a connection, offer an opportunity, restrict a
choice or break an ordinary rule. Each question defines its meaningful composition;
do not assume all contributions can be summed or that registration order resolves
conflicts. The receiving process owns any trade-offs needed to make its decision.
These examples illustrate composition needs, not an exhaustive effect taxonomy.

Use existing scalar lattice responders where their contract fits. For exact spatial
questions, define typed, domain-specific contributor contracts and compose them when
binding ordinary queries. Contributors declare the dependencies they read so command
invalidation reaches the composed query. An ordinary `Query<State, ...>` provides
execution and dependency handling; it does not by itself supply an extensible provider
contract. Prefer ordinary Rust composition over a new general-purpose influence engine,
string-keyed effect bags or a central table of source/consumer combinations.

The extension criterion is that a new source of an already understood influence can
be implemented and registered without editing each receiving process. A genuinely new
meaning or relationship may require a new typed question or connection contract. This
does not require predicting every future influence or making every internal calculation
an extension point. Preserve system-specific mechanisms behind the shared questions.

Queries read composed conditions; commands advance development. An opportunity is not
already realized prosperity: the receiving economic/occupation mechanisms must define
how reachable opportunities and burdens change activity and means over rounds, then
construction and maintenance respond. Business prospects, household means and building
condition remain distinct facts. The current proposal has not yet established that
transition or the spatial contributor contracts in code. The choices below establish
their design; M1 implements the first complete interaction.

## Selected execution design — not yet implemented

The following are agent-selected implementation decisions, checked against the current
Rust executor, projected queries, link offers and spatial helpers. They guide later
milestones without becoming additional owner requirements. Implementation can adapt
their mechanics while preserving ownership, extensibility and the requested behaviour.
There is no outstanding user decision or separate architecture-readiness phase.

### Owners and representations

| Owner/read model       | Placement                                    | Responsibility                                                                                                                                                                                              |
| ---------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Proposed `TownSignals` | Alongside numerical domain owners in `Field` | Retained exchange potential and waste burden on the existing triangular lattice. Exchange potential describes broad trading reach, not wealth or universal suitability; waste records accumulated exposure. |
| Proposed `TownFabric`  | Map generation `State`                       | Exact routes/junctions and wear, holdings, premises, activity/occupation, household means, condition, claims, intentions and current project commitments under typed identities.                            |
| Derived query results  | Existing executor query scope                | Accessibility, activity-source projections, available frontage and site conditions. These are disposable reads, not additional authoritative state.                                                         |

Use map-wide owners with settlement IDs where needed, not a new lattice or executor
for every town. Existing human layers remain approximate census inputs. Geometry owns
the detailed form and occupation of premises; broad opportunity or waste burden is a
different fact, not a second copy of building occupants or property boundaries.
Choose each persistent pressure because a process needs memory of it. Footfall, safety
or other quantities that can be derived from current routes and activities need not
become persistent bands merely because they appear in the domain vocabulary.
Retain an exposure-weighted livelihood-support trend with households and businesses:
means and trading state respond to sustained support rather than flipping on each query.
Do not retain every past answer, a project event log or a second population simulation.

Broad pressures cannot resolve every alley, wall or entrance. Exact spatial queries
handle those constraints and local relationships. Conversely, geometric placement
does not replace the broad spatial propagation needed by a mechanism. Neither side
reconstructs or overwrites the other's authority after every round.

### Existing capabilities that connect the owners

- `execution/projection.rs`: `Query::projected` and `Command::projected` retain operation
  identity and dependencies across a typed owner projection on the same execution scope.
- `execution.rs`: `CommandContext::query_with_context` binds typed request data to a
  query; `ReadContext::input` reads it. Invocation inputs have their own revision, so
  request changes participate in existing query memoization rather than an ad hoc cache.
  Binding replaces the ambient typed context. Resolve environmental answers under the
  physical invocation first, then carry their read-only band views in the site request;
  spatial providers must not try to interpret a site request as a physical context.
- `atlas/runtime.rs::Runtime::bind_field_query` binds a field-facing query to a read of
  map-owned state. This is an existing connection for deriving numerical inputs from
  exact map-owned fabric; it is not permission to mutate geometry during a query.
- Existing dispatched commands invalidate query results at mutation boundaries.
  Projected numerical and geometric operations must remain on that shared scope.

The proposed spatial contract is an ordinary `Query<State, SiteConditions>`. Its
invocation input is a typed batch of proposed footprints and entrances, with the
relevant purpose and existing-place references. It reads projected field answers,
current holdings/claims and access, uses the spatial kernel for geometric relationships,
and returns typed per-request results. The names `SiteConditions` and the request types
are proposed domain symbols, not existing implemented APIs.

Sample numerical conditions at the actual sites or over relevant footprint intersections,
not once at the town centre. Use existing spatial operations for coverage and proximity.
An area-weighted answer, representative point or relevant extremum is a consumer choice;
none creates a numerical-accuracy gate. Keep flood exposure, nuisance, access and other
meanings distinguishable rather than reducing all conditions to one suitability scalar.

### Typed contributors and connection semantics

Each spatial question owns a small typed request/result contract and an assembled list
of provider queries returning that contract's contributions. The composed query declares
those provider dependencies and reads them through the existing executor, with the same
typed invocation input. Providers can project their owners' reads into `State`; no new
dispatcher, universal influence trait, string-keyed bag or provider service is needed.
Start with questions for activity opportunity, access and site exposure; add another
question only when an actual mechanism needs a distinct meaning.

An activity-opportunity request contains the intended activity, site footprint, entrances
and relevant existing identities. Its contributions distinguish audience demand, usable
capability and operating burdens, retaining source identities and connection endpoints.
The economic owner defines these meanings; providers describe their source without
choosing the recipient's wealth. A provider may implement a prerequisite or permission
through its typed answer, rather than embedding a new source-type case in the consumer.

Keep source identity through composition: multiple routes to one source are alternative
access, not additional demand. Combine distinct compatible sources; compare available
paths by generalized travel cost; enforce actual permissions and barriers before ranking
preferences. Environmental exposure uses its own footprint/path sampling through GEOS
and field questions. Broad exchange potential guides candidate discovery and route
pressure; livelihood support uses source-resolved contributions, never adding potential
as a second estimate of that demand. Composed access includes maintained
nonlocal links through the existing offers pattern, with exact local entrances connected
to the relevant endpoints. No provider is assumed to have a circular area of effect.

### Pressure, activity and means

Advance exchange potential with a source-driven, lossy neighbour relaxation on the
existing lattice. Occupied trading activity, captured external approaches and compatible
providers supply sources. Composed travel costs attenuate transfer; absent selected
connections do not join opposite map edges, and an offered nonlocal link supplies an
explicit additional neighbour. Each command reads the previous potential and writes the
next state once for its exposure, so propagation neither recursively settles inside a
query nor instantly broadcasts opportunity everywhere. This is a layout pressure, not
conserved trade, population or money. Exact network/site queries resolve distinctions
inside a cell; the lattice never decides which side of a wall has access.

At each occupied or candidate premise, the economic query estimates livelihood support
from relevant reachable demand and usable capabilities, reduced by competition and
operating burdens. Competing compatible premises share the same source's demand according
to accessibility and activity fit; each premise cannot claim the source's whole demand.
This is aggregate competition, not commodity recipes or cash accounting. Sustained
support relative to the activity's catalogue needs improves or worsens trading state.
Household means respond to support from their associated activities or institutional
support, relative to their living needs. Means influence construction and maintenance;
building condition changes only through its own mechanism. Initial means have a varied
town-role distribution, not a radial rich/poor zoning rule.

Noise and similar immediate exposure are derived from current use. Waste accumulates
from occupation, moves with current drainage and service access, and is removed by
sanitation effort through its numerical owner. Footprint queries combine that broad
burden with exact nearby sources. Separate accumulation from current-source exposure
so an inactive nuisance can disappear while uncleared waste remains.

### Spatial growth and competing edits

Generate candidates from existing premises that can be reused, accessible frontage,
unoccupied land near unmet opportunities, and desired connections. Score viable
alternatives in the receiving process against intentions and current conditions; use
seeded variation among plausible choices so the best numerical score is not a mandate.
Intentions express weighted relationships and persistent public/institutional claims,
not finished coordinates or a final repair pass.

Route proposals connect actual destinations and approaches. Search the current route
graph by composed cost; unmet connections propose incremental extensions toward their
destinations or useful joins. Constrain and merge extensions with GEOS, including real
junctions and crossings. Wear and unmet access can justify widening or another connection.
Reuse the existing junction helpers, but retire radius-filling perpendicular branching
as the source of street demand. Terrain informs candidate cost and validity without a
new raster or lattice for routing.

Holdings grow from frontage intervals into available land, using catalogue depth/form
preferences and GEOS clipping against routes, prior claims, water and neighbouring
holdings. Reuse, split or consolidate existing holdings before demanding undeveloped
land. Fit buildings, courts and service access inside the selected holding; a successful
plot fit is not permission to fill the entire plot. Space reservations can later be
contested, but an occupied structure is not silently deleted to make a candidate fit.

Projects request typed owner edits over these existing identities. Construction prepares
competing proposals against one current state; the fabric owner accepts nonconflicting
edits and arbitrates conflicts using established rights/occupation, project priority and
available effort. Losing proposals remain unmet or are reconsidered in a later round;
they do not overwrite the winner. Revalidate geometric prerequisites when landing each
accepted edit. Keep adaptation within the existing command boundary, without a durable
transaction journal or separate project executor.

### Initialization, schedule and early publication

Initialize once from captured settlement identities, approximate census, approaches,
known places and actual standing detail. Seed sparse occupation and candidate focal
relationships from that context; do not prebuild every service or a completed network.
External approaches, rural demand and institutional activity supply opportunity even
before a trading centre exists, avoiding a circular requirement for established shops
before any shop can develop.

After real-scale land preparation, compose a distinct town sequence on the shared Rust executor. Initialize from captured identities, approaches, population and available physical and magical conditions. Town operations own their development rounds. Compose any necessary physical feedback at its actual consumer. Publish town geometry before trails, crossings and cover use it. Real-scale terrain generation remains a separate concern.

Within each urban round, run movement/wear and exchange propagation, then economic
support and occupation, use/waste and sanitation/security, claims and project selection,
construction, and maintenance. A command reads current landed state; same-stage competing
proposals use one captured starting state. New buildings become occupation candidates
next round, and resulting destinations affect movement and exchange on that next round.
Construction cannot immediately manufacture the demand used to justify itself. Retained
support trends, route wear and standing claims give different mechanisms different
response rates. Use configured development exposure rather than a completion quota or
equilibrium loop. Controls and exact numerical update formulas belong in labelled code
declarations, with meaning and scale conversions beside their owners.

M1 must publish and inspect its small but complete interaction through the existing GIS
path. M2 expands catalogue and process breadth through that same working path; M5 finishes
remaining caller adoption and removal, rather than introducing publication for the first
time. Include new retained state in existing completed-boundary checkpoint payloads;
rebuild derived spatial reads, provider bindings and query caches on restore. Recovery
precision stays unchanged.

## Hybrid development: intentions, pressures and local projects

Owner direction: combine the chaotic interaction of large-scale mechanisms with deliberate
development that can drive coherence. The hybrid retains the repeated mechanisms below
and adds purpose at town and project scales. All three participate through the same
registered process, query and owner-operation architecture; they are not separate engines.

| Part                       | Responsibility                                                                                                                                | Example                                                                                                           |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Town-scale intentions      | Establish important relationships, priorities and compositional direction, informed by role, history, culture, geography and artistic choice. | A trading town favours accessible gathering space, strong rural approaches and useful commercial frontage.        |
| Interacting pressures      | Repeatedly change activity, movement, means, occupation, sanitation, security and land competition.                                           | A crossing attracts traffic; valuable frontage becomes crowded; waste makes some nearby premises less attractive. |
| Local development projects | Construct or adapt particular places in response to opportunities, pressures and intentions.                                                  | Widen a street into trading space, convert existing premises, open a service passage or commission a hall.        |

Intentions describe relationships and priorities, not completed arrangements. An intention
for trading space can favour connections to the main approaches, clear circulation and
useful frontage without specifying a square, four entrances or surrounding shop rectangles.
An intention may persist while its realization changes. Competing intentions can protect
public access, encourage trade or retain a sacred precinct without agreeing on every site.
These concepts do not require a new creator-facing configuration workflow.

A local project is a purposeful proposal over the current town fabric. It identifies its
purpose, the existing places and relationships it concerns, its spatial needs and relevant
preferences. Construction, land claims and other mechanisms can realize or revise that
proposal through owner operations. A project can be compromised, partially realized,
superseded or abandoned. It does not guarantee a complete set of associated services.
Projects are domain values, not a new job framework, autonomous-agent system or recovery log.

Coherence comes from persistent anchors, access relationships, institutional claims and
artistic priorities. Projects strengthen or adapt those relationships while the wider
mechanisms continue to act. There is no final optimizer or repair pass that restores a
predetermined town plan after every round. Established sites and earlier compromises can
survive even when another arrangement would now be more convenient.

### Boundaries that prevent projects becoming stamps

- **Read the existing fabric.** Entrances, frontage, boundaries, terrain, neighbouring
  uses and access affect the proposal. A project cannot merely translate a fixed local
  coordinate layout to a selected anchor.
- **Change shared spatial relationships.** Apply owner operations to establish or alter
  claims, routes, holdings, access and structures. Do not return a self-contained package
  of completed roads, plots and buildings carrying its own neighbourhood.
- **Allow several realizations.** Trading space may occupy a widened street, court,
  existing hall or connected spaces. The same purpose can yield different forms because
  it encounters different fabric, not just different random rotations.
- **Share premises and components.** A civic hall can accommodate exchange, and a holding
  can accommodate both a household and a workshop. A project need not reserve a private
  copy of every supporting function.
- **Retain later change.** Other processes can extend, subdivide, encroach on, repurpose
  or abandon the result. A project's earlier geometry is not an immutable template.
- **Avoid completeness guarantees.** A market project need not install every related
  service or finish every frontage. Institutional effort can resist encroachment without
  guaranteeing perfect public-space protection.

Reusable building forms, courtyard helpers and catalogue variants remain useful. The
boundary is between reuse of a spatial component and an operation that installs a finished
district independent of its surroundings. Review actual project inputs and owner changes,
then inspect how projects respond to existing approaches, shared premises and older
boundaries. Passing geometry checks or varying a prefab's outline does not establish this.

M1 implements one market-related interaction across intentions, mechanisms and owner
operations, including a constrained or compromised realization. For example, existing
approaches and an institutional source contribute to the same opportunity question;
occupation raises use and waste; a public-space project competes with private frontage
claims; construction adapts the accepted space; subsequent occupation changes movement.
On constrained land, the selected project can reuse a passage or widen part of a street
instead of claiming a complete square. This exercises the chosen design without making
the market example a universal town template or requiring every project kind in M1.

## Mechanisms acting over repeated development rounds

Owner correction: processes describe mechanisms, not desired completed places.
Economic diffusion, construction, sanitation and security are examples of the required
shape, not an exhaustive list. This supersedes the earlier proposed division into civic
foundation, exchange, production and rural-place builders. The catalogue describes what
places can be; development processes describe how current conditions change.

A process reads existing spatial facts and composed questions, applies a change
appropriate to its exposure and available opportunities, and submits owner operations.
It does not declare that a town now has its intended market, prosperous district or
agricultural fringe. Several processes may affect the same site, holding or route, in
different directions. Specialised geometry helpers can construct a courtyard or fit
a hall without becoming a process that completes a district.

Proposed mechanism set:

| Mechanism                             | Reads                                                                                        | Changes and feedback                                                                                                                                                                                                                                                                             |
| ------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Economic diffusion and livelihood     | Existing activity, connections, travel costs, broad population and rural opportunities       | Advances broad exchange potential, resolves activity-specific opportunity and competition, and updates support trends, trading state and means. Existing centres can reinforce themselves; competing centres and changed access can divert activity. No conserved-money or commodity simulation. |
| Movement and route wear               | Occupied destinations, trips, obstacles and composed travel questions                        | Concentrates movement along useful paths, changes route importance and access pressure; later construction can widen or formalize a route. It does not lay an entire street plan at once.                                                                                                        |
| Occupation and relocation             | Premises, livelihood opportunities, means, access, exposure and local attachments            | Changes where activities and households occupy available space; creates crowding, vacancy and demand to alter premises. The census remains approximate context.                                                                                                                                  |
| Land competition and subdivision      | Occupation pressure, activity, established holdings, claims and access                       | Splits, consolidates or contests holdings, presses on rear gardens and common space, and changes frontage/service-access opportunities. Different claims resist at different strengths.                                                                                                          |
| Construction and adaptation           | Demand, current holdings, means, access, catalogue forms and existing structures             | Builds, extends, converts or reuses premises and infrastructure through owner commands. Chooses viable catalogue forms for current opportunities rather than fulfilling a list of required buildings.                                                                                            |
| Use and externalities                 | Actual activity and occupation, working areas and route use                                  | Produces local gathering, noise, smoke, waste and service demand. A place's effects depend on its use, not simply the presence of a type label.                                                                                                                                                  |
| Sanitation                            | Waste/exposure, drainage and water access, crowding, service access and institutional effort | Accumulates, transports or clears waste and changes local living/working conditions; can create demand for service infrastructure. Occupation and maintenance respond to its effects. It does not promise complete coverage or optimal sanitation.                                               |
| Security and control                  | Vulnerability, valuable activity, existing protection, access and local authority            | Changes protection and perceived risk through actual access networks and premises. This can concentrate activity, displace it, or create demand for gates, watch premises or enclosure. No individual-agent combat simulation is proposed.                                                       |
| Collective investment and land claims | Existing institutions, common use, competing demands, means and cultural context             | Maintains public-space claims, commissions local works and supports institutions. Its efforts compete with encroachment and other spending opportunities; it does not designate the final civic layout.                                                                                          |
| Cultivation and land-use change       | Agricultural suitability, working access, rural occupation, demand and existing holdings     | Changes working land and the demand for agricultural premises. Construction and occupation establish farmsteads; there is no independent process that stamps a finished farmhouse beside each field.                                                                                             |
| Maintenance, decay and abandonment    | Occupation/use, means, exposure, structural condition and standing fabric                    | Repairs some premises, degrades others, preserves alignments and leaves opportunities for conversion or abandonment. Changing activity does not automatically erase its earlier geometry.                                                                                                        |

These divisions remain proposals. Each needs a concrete state change and a consumer;
combine mechanisms when their separation provides no useful causal or ownership boundary.
Separate queries from changes: accessibility or neighbourhood character can be derived
without advancing the development round.

### Repetition and retained state

Initialize from captured census context, geography, approaches, known places and whatever
standing detail actually exists. Sparse initial occupation and artistic opportunities are
allowed; a finished network and all selected POIs are not prerequisites for the loop.
Preserve named landmarks and identities without prescribing every surrounding feature.

Run the selected mechanisms over multiple development rounds, carrying forward routes,
holdings, occupation, activity and local conditions. Later sequential operations see landed
changes; genuinely simultaneous claims share a starting state and compete through owner
operations. Do not run isolated complete pipelines for markets, housing and farms and
combine their finished outputs afterwards.

Use the selected execution schedule above. New construction enters occupation on the
next round; new destinations enter movement and exchange on that round. Later commands
within a round see changes already landed. Keep these delays explicit instead of hiding
cycles inside queries, and preserve them when grouping registered operations.

Activity and occupation may respond faster than construction, established boundaries
or institutions. Give mechanisms their own response/exposure settings rather than making
each pass fully settle every pressure. Development runs for configured exposure judged
on real maps, not until every POI is installed, a numerical equilibrium is reached or a
target town template is recovered. This is procedural development of the captured present,
not replay of global human eras or a new historical event log.

Use town-owned exposure and ordering. Preserve the existing checkpoint boundaries, process registry and common lattice.

### Market as an interacting example

A crossing or other accessible place can begin with modest exchange activity. Economic
diffusion increases trading opportunities there; movement concentrates visits; occupation
takes nearby frontage. Construction can accommodate those activities with stalls, shops,
a widened trading street or a hall using catalogue form facts.

Repeated use creates gathering, waste, service demand and security pressures. Sanitation
and security change those conditions. Collective investment may protect an open trading
area or improve a route, while land competition encourages encroachment and subdivision.
Some households can obtain valuable frontage; others occupy cheaper rear premises.
Existing boundaries and buildings constrain the next round.

In the hybrid model, a civic process can recognize this activity and propose protecting
gathering space. A local project adapts the space to existing roads, holdings and terrain;
other projects can convert neighbouring premises, commission a hall or open service
access. These interventions express the town's intentions without installing the whole
market neighbourhood. Later rounds can prompt another intervention, such as protecting a
passage, extending the trading space or supporting a second node.

The result may be a market street, a court, several trading nodes or a declining older
market beside a stronger new centre. Its particular form comes from intentions, local
projects, mechanisms and retained facts together. An inherited named market remains a
meaningful entity whose detailed form and condition develop. A local project's purpose
is legitimate; a promise to complete an ideal market and all its surroundings is not.

### Artistic composition and neighbourhoods

Art direction biases initial opportunities, catalogue choices and process responses.
It can favour a striking market site, a strong civic relationship, open-space contrast
or an unusual enclave. It must not become a final repair pass that resets the town to a
predeclared layout after each round. Rule of cool and an approximate census remain the
owner's priorities; detailed accounting is not a new requirement.

Neighbourhood character is read from overlapping occupation, means, form, conditions and
retained change. Institutions and land claims can produce sharp boundaries, while other
influences blend. Administrative wards remain distinct from social character. Do not
paint exclusive rich, poor, industrial or magical zones and fill them uniformly.

Where a mechanism affects another domain, use that owner's registered operations or
maintained contributions. Approximate land-use projections can support ecological or
surface queries without projecting occupants back to census cells. Do not reconstruct
the retained town from disposable projections on the next pass.

## Magic, terrain and composition

Terrain supplies routes, slopes, shore access, water, useful outcrops and risks through
current owners. It can encourage an elongated riverside town, a terraced hillside town,
or disconnected occupation gathered around crossings. These are influences, not demands
for strict physical optimization. Numerical smoothness does not prohibit a striking
market site, an unusual precinct or a memorable negative space.

Read the seven existing systems separately. Reuse current media, retained physical
effects and practiced shares; avoid a generic magical desirability bonus. Current Rust
crafts already affect questions such as climbing, forgetting, building, harm, presence
and sea-standing, and offer maintained door links to travel. Urban consumers must use
those composed conditions and links where relevant. A warm site, preserved place or
unusual access route should change actual activity and form, not merely add a label.

No new magical power is specified here. New town-specific craft rules require reading
their lore motivation and implemented mechanism, identifying the ordinary rule they
break, and adding the responder beside the system. The review for this design covered
lore-bible section 7, Three Fires, microgeography sections 8–11, the old interaction
layer and current Rust craft/travel code; it did not survey every old layer. Old setting
names and old numerical validation requirements do not become atlas requirements.

Artistic composition informs initial opportunities and the mechanisms' responses. It
favours strong focal relationships, useful contrasts, open space and a legible town
silhouette without prescribing the final arrangement. Later development can pressure
those tendencies. A memorable market can be
long, widened along a street, partly enclosed, or shared with a civic precinct; it need
not be the current fixed square at the anchor. Medieval character comes from these
relationships, property depth, mixed uses, courts and rural continuity, not crookedness
or added grime. Preserve geometric validity, usable access and stable identities while
allowing the census and procedural expectations to bend for a stronger composition.

## Milestones and evidence

The design phase is M0. This turn is a design handoff; implementation milestones remain
pending. Expand only the next selected milestone, using plan-phase, at implementation start.

### M1 — A coupled development interaction visible on the map

Scope: implement the selected execution design through one complete interaction, using
the contrasting catalogue subset defined above. Establish `TownFabric`, `TownSignals`,
typed provider composition and owner edits with actual consumers, rather than completing
the whole catalogue before it has users. Reuse current geometry, naming and publication.
Run movement/exchange, economic support/occupation, waste response, claims and construction
across repeated rounds. A market-related project adapts current frontage and access;
new occupation changes the following round's sources. Publish the result through the
existing GIS path and inspect it on a real map in this milestone.

Acceptance: route and occupation processes read spatial population/terrain/magic context,
modify retained facts through the owner, and observe one another's changes. Distinct
domain-owned providers contribute through the same typed opportunity question without
consumer source-type cases. A constrained project respects established access and claims
and can remain partial or unmet. Business support, household means and condition stay
distinct. No prefab neighbourhood, census reconciliation, new scheduler or universal
effect engine is needed. A smaller initial inventory is an implementation sequence,
not a reduction of M2's town breadth.

Evidence: explicit-input units for composition, owner edits, geometric failure cases
and invalidation; review actual selected execution and inspect the published map through
existing local atlas tooling. M1's map establishes a working causal and publication path,
not the complete quality target. Pure contract tests do not assert simulated town outcomes.
Read existing owner marks; add governed marks and behavioural entries with implementation.

### M2 — Repeated mechanisms and settlement structure [depends on M1]

Scope: expand the typed catalogue and selected mechanisms into one complete small town
with civic/market sites, working premises, differentiated
occupation, holdings and building groups, courts, fringe and agricultural homesteads.
Town intentions guide coherence and local projects make purposeful interventions within
the same repeated development loop. Projects can share premises and remain compromised;
subsequent mechanisms can change their results.
Acceptance: economic diffusion, movement, occupation, construction, sanitation, security
and other selected mechanisms change shared state across repeated rounds. No process
declares a completed market, residential district or rural fringe. Market activity changes
access and frontage, crowding changes holdings, and rural holdings include buildings
and working access. The first town already has an intentionally composed focal place,
negative space and a readable transition into farms; composition is not deferred to M4.
Layout is not generated by unzipping the existing placement function.
Evidence: inspect the selected production decisions, their inputs, retained edits and downstream use. Use focused checks on explicit inputs. M4 owns visual assessment of these outcomes after M2 and M3.

### M3 — Magic, terrain and retained change [depends on M2]

Scope: integrate relevant existing system-specific responses, environmental changes,
institutional enclosure, maintenance and reuse into the same processes.
Acceptance: contrasting terrain and magic produce different routes, activities and
occupation through actual dependencies; later development encounters earlier fabric.
New powers are unnecessary for acceptance. Classify neighbourhoods from occupation
and form, separately from administrative wards.
Evidence: trace responder and owner decisions on supplied inputs. M4 inspects
their contributions at selected places in representative towns. No simulation-fixture,
determinism, numerical closure or automatic aesthetic-score tests.

### M4 — Refine composition across representative maps [depends on M3]

Scope: tune and assess the complete town behaviour, including the town's readable map
presentation, rather than optimize one street algorithm or counter.
Acceptance: towns around the requested population scale have distinctive civic and
commercial focus, differing living conditions, a visible density transition and working
rural surroundings. Selected layouts respect their creative intent. Contrasts survive
at overview and close-up; feature inspection explains actual uses and relationships.
Evidence: representative real workloads covering an inland market, constrained terrain
or water, and consequential magic; share each generated result across relevant checks.
Choose actual available inputs during phase expansion. Inspect rather than assume a
particular density or wealth gradient. Artistically successful exceptions are allowed.
Use existing local atlas tooling; no hosted data publication and no new generator driver.
Fine workload verification still requires the owner's explicit request.

### M5 — Integrate and retire the working design [depends on M4]

Scope: finish remaining production caller adoption and GIS inspection/export coverage,
preserve deferred authoring code and contracts, then consolidate durable documentation.
Publication and real-map inspection already operate from M1 onward.
Acceptance: normal viewing requires no private town or numerical resources; existing
job recovery retains supported guarantees with any necessary owner state included at
existing completed boundaries. No per-process journal or new checkpoint precision.
Remove the superseded monolithic generation path once callers use the new processes;
retain useful junction and authoring helpers. Move durable content to canonical docs,
delete this plan and remove all references.
Evidence: focused publication/serialization and UI-boundary checks, required normal
checks and review of the actual selected production path. Do not repeat full workloads
unless changed behaviour or unresolved evidence warrants it.

## Assumptions and choices to revisit

- Wealth and means are not currently a spatial town input. Begin with an aggregate
  distribution conditioned by livelihood opportunities and settlement role. Cultural
  institutions can influence claims and occupation preferences, not prescribe a culture's
  wealth. This is a layout
  mechanism, not an inferred historical fact or full economic model. Check whether it
  produces visibly different forms before adding more social variables.
- Retained geometric state is necessary for boundaries, reuse and encroachment to
  matter across passes. It does not justify another storage service or general event log.
- Regional development hosts the selected urban slots. If a prerequisite becomes
  available later than source inspection indicates, move its consumer after availability
  and update the schedule without inventing fallback facts or duplicating history.
- A forced layout remains a meaningful creator choice. Interpret its existing contract
  before changing controls; do not silently ignore it or force every town to be organic.
- English historical references guide mechanisms, not a compulsory culture preset.
  Additional cultural morphology and art direction can be developed without changing
  census or process ownership. None is currently a blocking user decision.
- Surface variation remains a distinct later task. Town design must use current terrain
  honestly; adding town-specific height noise would not solve that separate problem.

## Source and reuse map

Current architectural bodies read: ADRs 0010–0012; `answers.rs`; `human/operations.rs`;
`field/people/{pass,questions,travel,crafts,gather,country}.rs`;
`atlas/{questions,sequence/people,features/domain,regional/sequence}.rs`;
`atlas/state/regional_people.rs`; and the town entry, planning, siting, uses, fields and
ward implementations. Some supporting files were read in relevant sections rather
than exhaustively. Verify their current bodies again at implementation phase start.
The existing real-scale plan's M4 was reviewed as the origin of the current mechanism;
this working design owns its proposed replacement, not the broader authoring milestones.

Reuse `atlas-map` for finished contracts and vocabulary, `atlas-generation` for processes
and private state, `atlas-gis` for geometry/storage, and `atlas-host` for application wiring.
The existing feature/executor boundary, not an atlas-host-specific route, runs production.

## Sulion mapping and current state

Root `d693174d-8188-4995-bd52-b1b498b74ade` retains the earlier completed connectivity
repair as history. That repair's completion does not establish complete town structure.

| Milestone                      | Sulion phase ID                        |
| ------------------------------ | -------------------------------------- |
| M0 — Design                    | `d5560d93-e496-4bd0-8fa1-ef93b5866bb6` |
| Catalogue investigation        | `72d23905-b055-46d4-994d-3f2ce89e6bae` |
| M1 — Coupled map interaction   | `0661adc3-c286-4e0e-89e3-15e9133dad23` |
| M2 — Interacting development   | `d8888bc0-d218-4410-b5a3-5f38b600c8cc` |
| M3 — Magic and retained change | `71f853db-bca2-4e5f-ba6b-5f4def9fc9bf` |
| M4 — Composition and maps      | `e115a21d-090d-47a4-8389-902b4f2e79c1` |
| M5 — Integration and close-out | `2b3dbcd2-9939-4791-a7a7-b93e38cd7eda` |

The terrain-variation phase remains pending after the town milestones. M1 establishes
the working owner/query/command and GIS path. Shared identities live in
`atlas-map/src/town/places.rs`; generation definitions and retained geometry live in
`atlas-generation/src/town/`; registered mechanisms live in `processes/town/`.
M2–M5 remain unfinished. Exact helper signatures, coefficients and local geometry tuning
remain agent-owned implementation details, not further owner decisions.
M1 execution expansion: `8037388d-9ee8-4d87-9ad5-414677bc210c`.

### M1 execution

1. Owned town contracts: move reusable geometry out of atlas adapters; implement the
   typed catalogue subset, retained fabric and domain-owned contribution contracts.
   Check supplied-input catalogue, composition and owner-edit behaviour.
2. Coupled mechanisms: registered movement/exchange, support/occupation, waste and
   construction commands read shared questions and land retained changes over rounds.
   Check geometric rejection, competing edits and dependency invalidation on explicit inputs.
3. Production and recovery: bind actual feature operations and schedule, publish retained
   geometry through existing GIS writers, include owned state at supported checkpoints.
   Check native/WASM compilation, publication and serialization contracts.
4. Inspect the interaction: use the existing local atlas, inspect the map and run focused
   domain/architecture checks. Record actual results here; declarations alone do not pass.

M1 result: Amadir-development-2 ran eighteen urban passes interleaved with three regional
rounds, published GIS, and opened in the ordinary frontend. Inspected `streets.png` and
the exported geometry: 385 buildings, 26 streets and a market establish the working path,
not the finished town-quality target. The map remains ribbon-like, housing is dominated
by distressed forms, and working fields/farmsteads are missing. These are M2 work.

Focused town contracts (27), owner/access/loading checks (5), architecture checks (82),
core Clippy and core WASM compilation pass. The reused helper checks include legacy
generation-outcome cases; retire those with the superseded generator in M5. The empty
access graph regression caught a real GEOS failure. Environmental snapshots resolve
under the physical context before spatial requests bind their own typed inputs.
Initialization reads captured source records before working GIS products are republished.
The first attempt and a resume across changed schedule positions are rejected as evidence.

Waste now has one retained authority in `TownSignals`; service access derives from actual
premises/routes and sanitation submits removals through the numerical owner. Premise
exposure queries stay disposable. This correction and quieter yard labels postdate the
inspected binary and remain for the M4 map inspection. Local test servers are stopped;
the harness uses the existing Nix CMake package and keeps build/run/view in one shell.

### Implementation review and revised M2 execution

Sulion expansion `eb60354f-9831-4fff-8005-0840b7a32771` retains the completed working-land step. Its geometry prerequisite is `3807afff-7012-49ad-9157-b7d3a56ff4bc`.

Owner correction, 2026-11-17. Flesh out the POIs and processes before inspecting another town. M1 demonstrated production wiring. Its map and passing checks established neither the full hybrid model nor catalogue completeness. The implementation review below covers the selected generation path, its state and publication boundaries. Browser UI, native restart and export still need end-to-end verification in M5.

| Design commitment                                                            | Decision the production code makes today                                                                                                                                                                                                                                                            | Engineering disposition                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Town owns its development over captured real-scale land                      | `atlas/regional/sequence.rs::real_scale` parses round and final-water operation names to inject urban passes.                                                                                                                                                                                       | Compose an explicit town sequence after site preparation. Retain the executor and downstream extraction order.                                                                                                                                                                                                                                                                                                     |
| Persistent intentions shaped by role, history, geography and creative layout | `town/fabric.rs::Town::new` sets gathering from road count, protection from guarded/seat flags and rural access to a constant. `Intentions::priority` maps these to seven kinds.                                                                                                                    | Bind town purposes to actual approaches, landmarks, institutions and uses. Give purpose a spatial relationship whose fulfilment can change with access or occupation. Keep artistic choice and the approximate census.                                                                                                                                                                                             |
| Purposeful, revisable projects                                               | `processes/town/investment.rs` chooses one anchor, accumulates need and funding per kind, and drops a market commitment when a hall takes a secondary use. Movement separately ranks routes by benefit.                                                                                             | Let several interventions pursue the same purpose. Sharing a hall can satisfy shelter while leaving delivery access unresolved. Route and construction choices must see that remaining need and retain compromises across rounds.                                                                                                                                                                                  |
| Place identity, occurrence, siting and relationships                         | The catalogue implements 41 family entries and eight residential identities. Construction's specialist branch hashes into the full list, then substitutes kinds for a dry mill/landing or a craft-practice site. Retail and fine-craft variants share family facts.                                 | Complete the inventory above across exchange, crafts, hospitality, transport, civic institutions, worship, care, learning, infrastructure, open land, agriculture and homes. For each family identify which local activity supports it, what site and access it can use, what it can share and what it changes. Implement those distinctions in selection and adaptation. Keep purely naming variants inexpensive. |
| Structures, mixed occupation and neighbourhoods                              | `town/roofs.rs` produces court, compound and yard components. Construction also selects elite forms by sample thresholds. Economy assigns an unoccupied secondary-use slot in a shop-house to a provision seller. Publication labels character from a single holding's means, crowding or activity. | Connect household means, tenure, access, demand and existing premises to form and actual secondary activity. Derive neighbourhood character across related premises, separately from wards, in M3.                                                                                                                                                                                                                 |
| Movement and economic diffusion                                              | Movement spends effort connecting backland, destinations and shortcuts. Exchange diffuses over lattice neighbours and links. Economy reads reachable activity-specific opportunities, housing pressure, support, means and delayed occupation.                                                      | Preserve these interacting mechanisms. Let relationships sought by households, workplaces and collective projects affect which connections and frontage gain use. Distinguish access for customers, workers and deliveries where the family requires it.                                                                                                                                                           |
| Use, sanitation, protection and control                                      | `town/signals.rs` carries exchange and waste. Sanitation submits removals. Service providers change clearance and protection. Investment uses vulnerability to fund a watch and maintenance uses protection to adjust claims.                                                                       | Extend actual use into service demand, access, exposure and contested claims. Protection needs a place or route to protect and consequences for occupation or enclosure. Preserve the numerical owner's waste authority.                                                                                                                                                                                           |
| Land competition, construction and maintenance                               | Competition subdivides an occupied rear garden, then directly edits the child, roofs and passage. Maintenance adjusts condition, occupation and claim. Geometry fitting can return an unusable fragment.                                                                                            | Give the fabric owner complete spatial edits for subdivision, conversion, shared access and extension. Preserve occupied structures during competing edits. Let maintenance, vacancy, institutional reuse and abandonment affect later choices. Resolve the captured geometry failure in its existing branch.                                                                                                      |
| Agricultural households and fringe                                           | `town/land.rs` retains field identity, clips roads and holdings, and associates working land with a household. The completed farm phase provides a usable baseline.                                                                                                                                 | Keep this implementation. Integrate rural access, cultivation and household projects into the same catalogue and occupation decisions as other uses.                                                                                                                                                                                                                                                               |
| Terrain, population, magic and external contributors                         | The adapter reads population, slope, water kind, cultivation, travel, harm and building responses. Door links affect access. The institutions provider reduces captured offers to trade demand and capability.                                                                                      | Preserve domain-owned providers and distinct meanings. In M3 connect relevant existing responses to concrete choices of route, practice, place and retained use. Distinguish a navigable bank from a wet sample and an active destination from practised ground.                                                                                                                                                   |
| Recovery, publication and consumers                                          | Fabric and numerical signals join existing checkpoints. Publication writes GIS streets, passages, holdings and field ties. Primary place kind survives as typed data while secondary use is published as a label.                                                                                   | Carry required identities and relationships through owner edits, checkpoint restore, publication and ordinary GIS queries. M5 verifies adoption, inspection/export without private state and removal of superseded paths.                                                                                                                                                                                          |

#### M2 engineering sequence

Owner correction, 2026-11-18. Choose implementation work from the missing generator capabilities in the design. The observations above describe the starting code. Defer individual quality issues until a working generator exists and representative towns give the owner a basis for prioritizing them. Address a local defect during construction only when it prevents the current capability from operating. Report progress by the production capability delivered and the design scope still open.

1. **Replace the production contracts and interfaces only.** Change the existing Rust owner types, callable signatures, visibility and composition interfaces in place. The contracts below define the extent of this phase. Algorithms, process implementations, caller migration, catalogue population, production wiring and map inspection belong to later phases.
2. Adopt those contracts throughout the town-owned development cycle. Implement the aggregate commands and relationship assessment, bind providers and strategies, and compose the production sequence on the shared executor. Carry purposes, changed fabric and unresolved relationships across rounds.
3. Complete the catalogue and process implementation together. Use every family and residential row in the inventory and every mechanism in the repeated-round design as scope. Follow each material distinction through a production choice, fabric or signal change, and subsequent use. Preserve existing working cases, including working farms. Include ownership and partial-failure behavior in the spatial edits they govern.
4. Resolve the precision branch on explicit geometry inputs. Then finish M3 environmental integration, institutional change and neighbourhood derivation. Review the selected production sequence for omitted decisions before moving to representative maps.
5. M4 owns the next town inspection, including the first complete town and the contrasting settings. A compatible checkpoint may be resumed there. If a schedule change invalidates it, use normal fresh generation. M5 retains integration, cleanup and documentation.

#### First phase contract design

- **Blackboard and Aggregate.** Model retained town fabric and purposes with stable domain IDs. Give processes read access to the fabric and narrow commands for changes. The aggregate owns spatial invariants and its backing collections are private. Numerical owners retain broad pressures on the existing lattice.
- **Specification.** Represent a purpose as desired relationships among places, uses and routes. Define the assessment interface over current fabric so one relationship can hold while another remains unmet. Completion follows from reassessment of the town. A project finishing an edit has no authority to declare its purpose satisfied.
- **Strategy and Command.** Define how a strategy reads a purpose and current conditions and proposes a feasible intervention. Use a closed Rust sum type for fabric edits and typed outcomes for accepted or declined changes. The aggregate's command interface owns the whole edit, including affected claims and access. Keep strategy composition open to additional processes.
- **Algebraic data types and composition for POIs.** Define place-family contracts for supported activities, site and access requirements, shared occupation, and effects during use. Encode mutually exclusive alternatives with the data each requires. Naming variants can reuse the same behavioral definition.
- **Dependency inversion and interface segregation.** Processes own the questions they ask. Domain providers implement the existing typed query and projection contracts, sharing the meaning and units of each answer. Give each process only the read and mutation capabilities its decisions require. Separate selection, mutation and extraction responsibilities.
- **Composition root.** Define the town-sequence interface over prepared land and captured context. Keep one executable feature registry and one executor. The town owns the ordering and exposure of its rounds. Give publication a read-only fabric input and a GIS writer. Private working state stays behind the generation boundary.

**Contract phase exit.** The new contracts occupy the actual production boundaries. Run the relevant Cargo check to expose the callers still using superseded interfaces. Owner preference is to leave those callers failing compilation until adoption. Do not add compatibility overloads, permissive defaults, placeholder implementations, feature switches or parallel APIs to keep the old path building. A deliberate compiler error is unnecessary. The expected breakage comes from real changed signatures, types and visibility. Caller migration begins in the following phase. Native and WASM compilation must be restored through real adoption.

**Architectural checks during adoption.** Compose the production schedule and resolve its operations through the real registry to establish town-owned rounds independent of the regional water schedule. On explicit fabric, apply a command that satisfies one relationship and reassess the outstanding purpose through another strategy. Exercise GIS publication of shared occupation and access from supplied fabric. Use Rust privacy for mutation authority. These checks and the production code carry the evidence. M4 judges town composition on representative maps.

#### Historical M2 execution notes

The contract-only replacement reached the active caller boundaries. After adoption, the generation core built for native and WASM, and the independent schedule and partial-purpose checks passed. The captured GEOS fragment now disappears at output precision while invalid inputs still fail.

M3 first connects environmental and practiced responses to local development, then implements institutional claims and classification from surrounding occupied fabric. M4 will inspect these changes with M2 on the same towns.

The following entries describe earlier runs and the decisions made at the time. The revised sequence above governs resumption.

Current work: working land and complete-map inspection. Access projects now use actual
backland demand, destinations and useful graph connections; owner edits arbitrate claims
and reject building cuts and duplicate routes. Housing pressure is independent of trading
success. Court components leave shared entrances and yards; rear-garden division retains
standing buildings and a shared passage. GEOS working plots retain identities while roads
and built claims take land, and an agricultural provider feeds the same source query.
Eight explicit-input owner/access/land checks passed before the first M2 production run.
Amadir-development-3 did not include subsequent collective commitments, shared-hall reuse,
partial public-space fitting or corrected address numbering.

Amadir-development-3 completed every development pass but failed final publication: shared
passages were written as streets without network reach/endpoints. The extractor now uses
the same network publication path for passages and ordinary streets. Current owner formats
and schedule have changed, so Amadir-development-4 is a fresh normal run rather than a
resume across those changes. Ten explicit-input checks now pass, including fitting a
gathering claim around older premises and numbering premises along their retained street.

Source review found a semantic error in the first town adapter: `building` is the share of
people who raise premises, not a construction-cost multiplier. The consumer now changes
roofed versus open occupation rather than making the craft cheaper construction. This
uses the existing question and introduces no new magical power. The separate terrain
variation phase remains after town development.

Amadir-development-4 published and opened in the ordinary viewer. Its actual geometry is
still a ribbon village with scattered branches, not the M2 outcome. Fields and farmsteads
now exist, but repeated public-space fitting produced nineteen fairgrounds and sixteen
burial grounds. M2 remains open. Corrections separate claim strength from opportunity
ranking, allow financed access to unmet housing before frontage fills, and require an
actual funded civic purpose before an open-space proposal can consume a gap. Catalogue
audiences describe rough unmet use rather than installation quotas; existing provision
changes those needs. Form, farming and collective-project variation now use independent
samples instead of competing for the same upper tail. Local nuisance attenuates with
distance, and existing working premises reduce demand for another farmstead nearby.

The first movement pass also had no candidates because it seeded approaches after the
adapter's spatial request. Initialization now retains captured incoming streets before
the request is made; only demand-driven projects extend them. Amadir-development-5 is
running these corrections. Twenty-nine focused core checks and ten shared town-contract
checks pass; legacy helper cases still await M5 retirement.

Additional M4 finding from the same map: 114 read-ice areas and 180 trails make the map
noisy. The old trail adapter treats every `magicPractices` feature as a visited destination,
uses its first coordinate as an entrance, and scans line segments for nearest access.
During integration, distinguish actual destinations from practised ground, use the spatial
adapter for access, and retain the underlying magical geography and its actual effects.

M5 caller finding: the initial generic step adapter prepared all frontage, opportunity
sources and source-to-site costs even for sanitation, maintenance and land competition.
Their actual consumers need different reads. This repair was pulled into M2 after actual
steps grew to five to eight seconds: the existing adapter now prepares frontage,
livelihood or exposure reads according to the consumer, without a separate cache framework
or reduced geography. M5 will check caller adoption and measure the batch. Civic provision reads usable
area, condition and occupation rather than counting every clipped claim as a complete site;
this source correction postdates the Amadir-development-5 binary.

Amadir-development-5 published and was inspected at overview and detail. Real lodging courts,
courtyard houses and elite compounds now appear; public sites fell from 108 to eleven.
The town remains too spread along branches and its exchange activity shares a hall without
a legible civic focus. M2 remains open. Opportunity requests now distinguish the intended
activity: households seek work rather than treating other households as jobs, and workplaces
read household audiences. Existing mixed premises use their actual business activity.
Candidates retain an answer per activity, not one universal economic score. Housing and
civic intentions guide ranking without being overwhelmed by the sum of every source.
Private parcels can fit irregular available land while retaining frontage access; occupied
claims and roads are subtracted, and older structures remain intact. Curved streets can
offer frontage. Working land retains and publishes its actual reachable household tie.
Amadir-development-6 is the next native inspection. Twelve owner/access/land checks and
thirty focused core checks passed before the final sparse-source lookup improvement;
source-alternative checks and core Clippy also pass after that change.
