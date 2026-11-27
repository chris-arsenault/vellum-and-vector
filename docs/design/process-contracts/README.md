# Process contracts

The original process inventory and society decisions came from `vellum_vector_process_contract_chunk_06.xlsx` at `a616cef`. Keep each original catalog ID when reviewing a proposed rename, merge or change of responsibility.

| Document | Row key |
| --- | --- |
| [Processes](processes.dataset.json) | Process ID |
| [Strategies](strategies.dataset.json) | Process ID and strategy ID |
| [Society decisions](society-decisions.dataset.json) | Existing catalog ID |
| [District types](district-types.dataset.json) | Type ID |

Edit strategy applicability in the strategy dataset. Each entry pairs a map type with an independent resolution band. Named bands use the exact atlas constructor endpoints. Custom intervals specify an exclusive `above_metres` and inclusive `through_metres`. An algorithm declares its clock and required input slots. Algorithms that work together at the same site each declare a distinct composition order and execute in ascending order. A NoOp records its reason for each applicable scope. Unspecified entries retain the work awaiting design.

The generation crate reads this catalog at build time. Semantic registrations bind its algorithm IDs to Rust implementations. Provider, inherited, coordinator, transferred and deferred entries retain their own dispositions. Existing legacy registrations keep their execution paths until migration.

Run `cargo run -q -p atlas-generation --example process_applicability` to print the flat review view. It expands each strategy once per scope and includes the original workbook fields.

## City development

A Street strategy with a `Current execution strategy` names the existing runtime disposition for its scope. Its own row describes the intended implementation. When the Street owner implements and registers that strategy, remove the field so the catalogue selects it directly.

A City captures its refined parent’s settlement, households, approaches and surroundings. Regional refinement can repeat at progressively finer scales. On the City map itself, trade, provisioning, household placement, built investment and upkeep run before urban layout in each round. The following round reads the access, usable bridge crossings and reserved ground the previous round produced, with how tightly each district's households live and which ground stands inside a wall. Households settle where built ground has room, builders add the ground people lack, and ground nobody needs returns to the fields; [household placement](../../../crates/atlas-generation/src/field/people/gather/catchments.rs) and [building](../../../crates/atlas-generation/src/field/people/building.rs) hold those rules. Land-use areas and districts cover ground that is built on. The regional sequence owns this order. [Regional schedule](../../../crates/atlas-generation/src/atlas/regional/sequence.rs) and [City inputs](../../../crates/atlas-generation/src/atlas/regional/city.rs).

| Owner | City result |
| --- | --- |
| [Major works](../../../crates/atlas-generation/src/atlas/regional/city/works.rs) | Early siting across the known settled extent. Captured works retain their sites. A new work needs suitable ground, backing and room for its family’s footprint and influence. |
| [District programs](../../../crates/atlas-generation/src/processes/town/urban/programs.rs) | Founder catchments respond to settlement area and geography. Each founder draws one economic role, one social character and at least one trait. The founding template favors particular roles. Local evidence and an increasing city-wide repeat penalty shape the draws. |
| [Investment](../../../crates/atlas-generation/src/processes/town/urban/investment.rs) and [defenses](../../../crates/atlas-generation/src/processes/town/urban/defenses.rs) | Stewards acquire adjoining ground for parks and commons. Competing enclosures earn funding for individual sections according to who and what they protect. |
| [Movement](../../../crates/atlas-generation/src/processes/town/urban/circulation.rs) | Site ordinary destinations, choose journeys, then route across the terrain. Approaches can share an ascent, take a switchback or cross a ravine by bridge. |
| [Land competition](../../../crates/atlas-generation/src/processes/town/urban/claims.rs) and [construction](../../../crates/atlas-generation/src/processes/town/urban/landscape.rs) | Resolve mixed housing, trade and workshop ground. Local activity can support pockets away from principal roads. Connected junctions and arterials can draw additional activity. |
| [Final district partition](../../../crates/atlas-generation/src/processes/town/urban/city.rs) | Assign the full districtable ground around reservations, preserve founder identities and count residents by area overlap. A district can comprise several pieces. |

The City publishes the resolved districts, mixed land uses, principal routes, gates, works and places through `town.urban-geography`. Local streets, plots and individual buildings belong to the finer map. [Urban registrations and publication](../../../crates/atlas-generation/src/processes/town/urban/registration.rs).

## Module chunks

The following tables and pilot notes describe the original workbook import.

Module names are proposed architectural groupings for review, not claims about today's Rust file layout.

Source basis: main @ a616cef. 120/120 Processes contracts complete; 40/480 map-type & metric Implementation rows now drafted for 10 society pilot entries (proposed, not executed). 440 nonpilot strategies remain unfilled. World/Region/City/Street bounds come from atlas/resolution.rs, independent of map type; Region/City lower bound is exclusive. Grounding: GENERATION-GROUNDING.md.

| Chunk | Proposed module | Processes at import | Filled at import | Complete at import | Review scope |
| --- | --- | ---: | ---: | ---: | --- |
| 1 | Society / population, food & land | 11 | 11 | 100% | Pilot focus: population, provisioning, land occupation, inheritance and publication |
| 2 | Society / cultural identity | 6 | 6 | 100% | Traditions, language, customs, craft learning and cultural presentation |
| 3 | Society / realms & politics | 4 | 4 | 100% | Realm formation, control, allegiance and administrative presentation |
| 4 | Society / places, infrastructure & effects | 12 | 12 | 100% | Places, cities, physical/magic coupling, events and landscape works |
| 5 | Town / local development | 11 | 11 | 100% | Settlement founding, access, economic life, urban development and publication — intended semantic outcomes |
| 6 | Ecology / ecosystems & evolution | 7 | 7 | 100% | Ecological origins, succession, present habitat response, burial, human land use and state interpretation |
| 7 | Magic / sources & effects | 8 | 8 | 100% | Design-first: seven distinct magic media and their confluences; source/phase coupling, initial-state realization, history, classification and publication |
| 8 | Physical / tectonics & lithosphere | 16 | 16 | 100% | Design-first: plate/province genesis, evolving strain, material-backed uplift/orogeny, flexure, faults, geothermal, volcanism and impacts; two derived crustal context providers |
| 9 | Physical / erosion, sediment & rock | 7 | 7 | 100% | Mechanical transport, weathering/erosion composites, rock alteration |
| 10 | Physical / ocean & coasts | 9 | 9 | 100% | Design-first: connected ocean state, currents and shoreline processes; offshore boundary coupling, margin context, seafloor and island/shelf classification |
| 11 | Physical / ice & glaciation | 7 | 7 | 100% | Design-first: glacial mass balance and transport, material-backed erosion/till deposition, meltwater hydrology, sea ice; derived glacial landform interpretation |
| 12 | Physical / runoff, drainage & rivers | 11 | 11 | 100% | Water sources, routing, channels, lakes, floodplains and deltas |
| 13 | Physical / atmosphere & geography | 3 | 3 | 100% | Background warmth, atmospheric climate and broad landform classification |
| 14 | Physical / history & checkpointing | 1 | 1 | 100% | Physical timeline snapshots and historical state |
| 15 | Landmarks / emplacement & upkeep | 2 | 2 | 100% | Persistent landscape landmarks and their later alteration |
| 16 | Real scale / local terrain details | 5 | 5 | 100% | Physical point-scale landscape presentation and access |

## Society review

The following notes record the society pilot at workbook import. The strategy dataset and Rust registrations above describe current applicability and execution.

### Shared numerical state and cross-process causes

#### Population

- **Physical/social meaning**. People occupying the land; not coverage
- **Processes creating or changing it**. World: land.grow/found; spatial: gather; events damage
- **Other processes consuming/effecting it**. Trade, food, access, construction capacity, hazards, culture
- **Region behavior**. Nonlinear concentration of inherited population
- **Field decision**. No new Population band

#### BuiltUp

- **Physical/social meaning**. Land physically devoted to settlement; distinct from headcount
- **Processes creating or changing it**. land.harden expansion/reuse; maintenance/event/physical damage via human owner
- **Other processes consuming/effecting it**. Movement, scarcity, agriculture, ecology, floodplains, access
- **Region behavior**. Redistribute into rural low-coverage and dense high-coverage zones
- **Field decision**. Keep existing numeric field

#### Standing

- **Physical/social meaning**. Retained constructed capital/works stock; not automatically households
- **Processes creating or changing it**. Construction investment, built maintenance and hazards
- **Other processes consuming/effecting it**. Trade investment, climate, animal/vegetation encroachment, magic, crowded housing
- **Region behavior**. Differentiate intensity and usable stock within built cover
- **Field decision**. Reuse existing; validate capacity meaning

#### RuinedBuiltUp, RuinedStanding

- **Physical/social meaning**. Persistent degraded construction and occupied-land aftermath
- **Processes creating or changing it**. Human owner via damage, abandonment, environmental change
- **Other processes consuming/effecting it**. Reuse, settlement history, ecology encroachment, migration
- **Region behavior**. Reveal ruin clusters and reused stock without extra historical destruction
- **Field decision**. Keep existing; review condition semantics

#### Farmland, Pasture

- **Physical/social meaning**. Area shares committed to food work and livestock
- **Processes creating or changing it**. land.feed; conversion through constructed-land operations
- **Other processes consuming/effecting it**. Soil/climate, wildlife, market access, labor, land competition
- **Region behavior**. Pattern farmsteads, productive rural belts, nonuniform fields
- **Field decision**. Keep existing numeric fields

#### Ways / maintained routes

- **Physical/social meaning**. Historic and current travel-connectivity evidence
- **Processes creating or changing it**. World migration/trade wear; refined current access/corridor strategies
- **Other processes consuming/effecting it**. Commercial centrality, location, boundaries, hazards
- **Region behavior**. Competing market corridors, local ways, off-map connections
- **Field decision**. No extra history from spatial iteration

#### Derived capacity, crowding, condition

- **Physical/social meaning**. Relational measures from stocks, reach and environmental state
- **Processes creating or changing it**. Produced as typed questions; potential future retained stocks
- **Other processes consuming/effecting it**. Multiple writers/consumers: construction, maintenance, events, trade, climate, ecology, magic
- **Region behavior**. Control expansion vs intensification, reuse vs decline and population distribution
- **Field decision**. No new retained field until pilot establishes need

### Minimum pilot checks for World to Region, then City

**1. Uniform → patterned**. Begin with generic near-uniform child samples of a populated coarse World cell. Check that nonlinear process interactions produce contrasting urban, rural and vacant land, possibly multiple centers.

**2. Coupled feedback**. Disable trade, construction feedback or attraction separately; verify qualitative and numerical morphology changes. Noise alone must not produce the same city.

**3. No false history**. Run additional spatial-refinement iterations; verify no births, starvation, historic trade, ruin degradation or extra route years solely from iteration.

**4. Population/area plausibility**. Compare equivalent geographic footprints: rough city census and BuiltUp remain credible without forcing each child's exact mean or preselecting a city center.

**5. Built-land variety**. Compare farmsteads, compact cores, crowded/low-investment areas and derelict neighborhoods under varied access, wealth, terrain, ecology and danger.

**6. External context**. Crop the scene and repeat with boundary providers for food, markets, roads, danger and migration. A map edge should not orphan a city or fabricate a new urban location.

### Pilot map-type and metric strategy contracts

#### Coverage

- 10 catalog IDs × 4 map types
- World: 7,071–28,284 m
- Region: >0–6,325 m
- City: >0–6,325 m
- Street: 0.190–113.975 m

#### Causal processes

- land.gather, land.trade, land.feed, land.harden
- World: elapsed history
- Region: coupled spatial differentiation
- City: finer coupled spatial differentiation
- Street: current provider/no-op in pilot

#### Supporting processes

- land.grow, land.meet, town.maintenance
- World: actual births/damage/decay
- Region: pressure, exposure, quality
- City: finer pressure, exposure, quality
- Street: current readout/no-op in pilot

#### Nonprocess / migration

- land-inherit, city.growth, city.quarters
- No independent historic process
- Coordinator; merge City growth into gather
- Coupling deferred to town detail
- No geometry prerequisite for regional density

#### Status at workbook import

- PROPOSED — not Rust-executed
- 40 map-type strategies specified
- 440 remaining rows unfilled
- No arbitrary process-scale cutoffs invented
- Bounds are currently supported constructor ranges

#### Proof obligation

- Start with near-uniform inherited values
- Generate multi-center/rural variation
- Ablate trade, food, hazard, built feedback
- Keep census/built stocks credible
- No new historic years or zeroed boundary markets

#### Metric source

- Current atlas/resolution.rs constructors
- Quality: World 50/200/800 km²
- Region/City: regional_span()
- Street: hex 1.5–300 m with triangle detail
- https://github.com/chris-arsenault/vellum-and-vector/blob/a616cefbeaa404cfe1aa16504f7cabaf2be1cfa6/crates/atlas-generation/src/atlas/resolution.rs

