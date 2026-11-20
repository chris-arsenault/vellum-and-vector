# Large cities: city refinement, then district maps

Working copy of a proposed plan (owner direction 2026-11-19 and 2026-11-20). Nothing here is
built. The last milestone moves its durable content into an ADR and the backlog and deletes
this file.

## Outcome

A large city is made the way every other layer is made: refined from larger to smaller. A
city refinement turns the city and its surroundings into a city map, the city overview of
Baldur's Gate or Neverwinter Nights. It shows:

- the city's land and water, walls and main roads;
- its districts with their population, density, wealth, specializations and occupations;
- its major works and other prominent places, drawn at their rough location.

It shows no ordinary streets or houses. Any district can then be refined into its own map,
where streets, plots and buildings grow from the district's character. District outlines
follow the city, not rectangles.

## User requirements (owner)

2026-11-19:

1. Cities refine like every other layer, larger to smaller, then subdivide.
2. A city map comes first and is generated completely, with its own features and major
   landmarks. It is coarser than streets and buildings, and holds districts with their
   density, specializations and occupations.
3. Districts (wards) are refined afterwards as their own maps.
4. Districts are not forced to be rectangular; generation areas follow arbitrary, organic
   boundaries.
5. Lattice sizes follow the scale contract: a child of about a seventh of its parent's area
   has about the parent's triangle count (Draft about 15k, Standard about 60k).

2026-11-20:

6. Rough agreement between maps remains enough, including between neighbouring districts.
7. The city map shows some buildings: major works for certain, and other prominent POIs at
   their rough location.
8. City generation is a hybrid process.
   - From regional refinement: a city refinement takes the city's surroundings and the
     parent's numerical fields and refines them to a smaller grid.
   - The refinement focuses on the social representation.
   - From the graph-based town and works system: at hot spots in that social
     representation it runs small development iterations that place major POIs.
9. Major works are POIs that happen to appear on the bigger map. The city map reaches into
   the POI catalogue, which is extended with how its places appear on a large-scale map.
10. The city map's generation is a hybrid of regional refinement and city growth, not one
    after the other.
11. City walls get their own phase. Not every city has walls, and a city's walls are not
    always at its outskirts; some cities have several. Most processes need to know whether
    a place is inside or outside a wall.
12. Correction: hot spots are not major works. Hot spots place POIs that come from the
    other POIs in the catalogue. Major works keep the older ruling ("keep the older 3-5
    major work ruling"): the population-band expectation in `settlement-major-works.md`,
    with no per-district minimum.
13. Each template provides guidance at the city level and at the district level. A large
    city selects a template for both levels; a smaller city uses only the district level.
    The city and district guidance give similar layouts, tailored to their size and
    fidelity.

Standing direction: towns grow through processes, never stamped layouts; people live on the
land's layers ([ADR 0012](adr/0012-people-live-on-the-lands-layers.md)); the POI
catalogue is the one definition of places and a missing concept becomes a contract slot;
refinement writes only the child; regions are indexed polygons.

## How the research informs generation

The research pass of 2026-11-19, from the sources it opened:

- **Real cities nest in parts of a few to tens of square kilometres.** Paris's
  arrondissements run 2–16 km², New York's community districts 4–59 km², Tokyo's wards
  10–60 km². Each level splits into 4 to 18 parts, so six or seven districts per city map
  fits real cities and the scale contract.
- **Main roads and centres form a city-wide foreground network** (Hillier's space syntax).
  The city refinement therefore decides them once, and districts inherit them as starting
  conditions.
- **Centres grow from seed intersections that reinforce each other.** Where several
  pressures meet, new centres seed and older ones grow. These are the hot spots in the
  social fields where the city refinement runs its small development iterations.
- **District edges form on rivers, walls and main roads; fringe belts form against walls
  and in slumps and persist** (Conzen, Whitehand). District outlines follow those edges and
  the boundaries between social character in the refined fields.
- **Large cities absorb villages that keep their identity** (London, Paris). An absorbed
  village shows as its own centre and district.
- **Coarse to fine.** Parish and Müller go from population and land maps to highways,
  streets, lots and buildings. Chen et al. trace major roads first, then fill the regions
  between.

## Proposed design

Agent-derived and revisable; owner decisions are marked.

**City refinement is a regional refinement focused on people.**

- It is opened at a settlement from the district map that holds it.
- Like every refinement, it captures the city and its surroundings and the parent's
  numerical fields, and refines them on a finer lattice sized by the scale contract: about
  the parent's triangle count over the city's surroundings.
- The physical processes run as in regional refinement.
- The social representation is the focus. People's bands are refined at the finer grid
  through the people pass:
  - population and density;
  - shares built on and under crops;
  - how long built places have stood;
  - the identity column: tongue, faith, custom, allegiance, craft.

  From these the city reads districts of distinct population, wealth, specialization and
  occupation.

**Refinement and city growth interleave.**

- The city refinement's rounds alternate:
  - regional refinement rounds that refine the land, water and social fields;
  - city growth rounds that extend the city's built extent, strengthen or seed centres,
    raise walls and shift districts' character.
- Each reads what the other last left. Growth reads the refined fields (where people,
  wealth and ways concentrate). The next refinement round reads what growth changed (built
  ground, walls, works and their pull on people), through the shared questions and the
  people pass's registered operations.
- This follows the regional schedule's repeated passes ([ADR 0008](adr/0008-regional-refinement-is-conditioned-amplification.md)),
  with city growth as a pass of its own, not a stage after refinement.

**Walls are a phase of city growth.**

- A wall rises where its causes meet:
  - threat, a seat of power and wealth to protect;
  - the ground: ridges, rivers, the existing edge;
  - the people able to build it.

  A city without those causes has none.

- A city can hold several walls:
  - a citadel or palace wall inside the city;
  - an old wall the city has outgrown, now inside it;
  - a newer outer ring;
  - a quarter's own wall;
  - a wall left partial where the ground defends.
- An outgrown wall persists as a fixation line. Its ring becomes a fringe belt or a street
  where it was cleared, and its gates stay centres.
- Gates are where ways cross a wall; markets, inns and suburbs gather at them.
- Every process can ask the city's enclosure question: inside which walls a place stands,
  how many, and through which gate it is reached. The answer conditions density, land
  value, occupations and which places may stand there: noisome trades and burial grounds
  outside, markets at gates, palaces within the innermost wall. The POI catalogue's
  large-scale slot states its conditions in these terms.
- District maps capture the walls and gates crossing or bounding them and keep asking the
  same question at their scale.

**Hot spots place prominent ordinary POIs (owner correction 2026-11-20).**

- Where the social fields concentrate (dense, long-standing, at a crossing of ways, a
  harbour, a seat of power, a shrine), the city refinement runs a few rounds of the
  graph-based town system on that spot.
- Those rounds decide which prominent places from the ordinary catalogue stand there, and
  roughly where: a great market, a guildhall, a temple precinct, a landing, a court.
- Hot spots do not place major works.
- They do not grow the whole city's streets.

**A city's major works follow the population-band expectation (owner 2026-11-20).**

- The count follows the existing ruling in `settlement-major-works.md`: a size-weighted
  draw at founding, rare organic works during growth, and one shared expectation by
  population band. There is no per-district minimum.
- Each work is sited by its type's own siting, construction and sponsorship rules
  (`town/major_works.rs`, `catalogue/works.rs`) where its requirements meet in the city.
- Works are published on the city map at their rough location and size, with the hot-spot
  POIs. A district map captures the works that stand inside it.

**Every template guides both the city and the district level (owner 2026-11-20).**

- Today a template is chosen once per settlement from founding-site evidence, and its
  policy (tenure, where uses prefer to build, ground level, connectors, enclosure,
  alignment, proposed streets) is read by founding and the recurring town processes. That
  is district-level guidance: it works on plots, frontages and streets.
- Each template gains city-level guidance with a similar layout at the city map's size
  and fidelity: where centres and gates sit, how main roads align, which ground is held
  and by whom, where enclosures and walls run, and how levels or banks connect. A
  surveyors' ring is a ring of main roads on the city map and a ring of frontages on a
  district map; a walled household state is a walled compound and its dependent quarters
  on the city map and the same arrangement in plots on a district map.
- A large city selects one template from its site evidence, by the existing weighted draw.
  The city refinement's growth rounds read
  its city-level guidance; each district map reads its district-level guidance.
- A smaller city, with no city map, uses only the district level, as towns do today.

**The POI catalogue says how a place appears on a large-scale map.**

- Each catalogue entry gains a slot for its large-scale appearance:
  - whether it shows on a city map;
  - the social and physical conditions that raise it there;
  - its rough footprint and symbol;
  - what it seeds when a district map is refined from it.
- Major works become catalogue places that show at that scale, not a separate kind.
- Entries without the slot do not appear on city maps; the slot is filled kind by kind as
  open work.

**Districts.**

- The city refinement cuts six or seven districts.
- Outlines follow the refined social fields' boundaries, rivers, walls, main roads and
  fringe belts.
- Each district is published as a named region polygon with its population, density,
  wealth, specializations and occupations.

**District maps.**

- A district opens from its polygon as a real-scale map over its own outline.
- It captures the city map's land, main roads, walls, the district's major works and its
  hot-spot POIs as starting conditions, with rough agreement as today.
- The existing town processes grow its streets, plots, buildings and occupations from the
  district's character, under the city template's district-level guidance.
- The major works and hot-spot POIs the city map placed seed the district's development
  where they stand.

**Generation over arbitrary outlines.**

- Today a refined child's lattice is built over the bounding rectangle of the selected
  outline plus a margin (`atlas-host/src/generation_frame.rs`, `regional_frame`).
- The change:
  - Build the frame over the outline itself, with a band of context outside it.
  - Grow inside the outline, and publish only inside it.
- This applies to every refinement, not only districts.

**Scale.** **Owner:** confirm the sizes.

- Example: a city of about 16 × 12 km refined at about 15k Draft triangles has cells of
  about a hundred metres, enough for districts, main roads and the rough place of major
  works.
- Its districts at a seventh of that, about 5 × 4 km, each fit one real-scale map at
  100 m hexes.
- A metropolis larger than one city refinement needs one more level, where its districts
  are themselves cities.

## Milestones

### M1 — Generation over arbitrary outlines

Scope: refinement and real-scale generation build their frame, capture, processes and
publication over the selected outline, keeping a context band outside it.
Acceptance: a region selected as an organic outline (a valley, a coast) is generated and
published inside that outline, with no rectangular edge.
Evidence: frame and capture unit tests on supplied polygons; one organic region in the
reference chain.

### M2 — The large-scale appearance slot in the POI catalogue

Scope: the catalogue contract gains the large-scale appearance slot (conditions, rough
footprint, symbol, what it seeds). Major works become catalogue places with the slot
filled; other prominent kinds are filled first, the rest stubbed as open work.
Acceptance: the catalogue lists, for every kind, whether and how it appears on a city map.
Evidence: catalogue contract tests.

### M3 — City refinement and its social fields [depends on M1]

Scope: a city refinement opened at a settlement refines the city's surroundings and the
parent's fields on a finer lattice, with the people pass refining the social bands. It
publishes density, land-use and character rasters and the main roads.
Acceptance: the reference chain's largest city refines into a city map whose density and
character vary across it as its census, roads and water suggest.
Evidence: unit tests on small fields; one city map.

### M3b — City growth rounds interleaved with refinement [depends on M3]

Scope: city growth runs as a repeated pass in the city refinement's schedule. It extends
the built extent, seeds and strengthens centres and shifts district character; the next
refinement round reads what it changed. The city refinement selects the city's template,
and growth reads its city-level guidance; the template contract gains that level here.
Acceptance: a city's extent, centres and density change across rounds in response to its
ways, water and people, and the refined fields respond to the growth.
Evidence: unit tests of the growth pass on small fields; a removal run showing the city
refinement without growth loses the change.

### M3c — Walls and the enclosure question [depends on M3b]

Scope: walls rise as a growth phase where threat, power, wealth, ground and builders meet.
A city may have none, one or several: inner, outgrown, outer, quarter or partial walls,
with gates where ways cross. Outgrown walls persist as fixation lines. Processes ask an
enclosure question (which walls enclose a place, through which gate), and the POI
catalogue's large-scale conditions use it.
Acceptance: across the reference cities, some have no walls, some one and one at least
two; an outgrown wall stands inside its city, with gates as centres; trades and places
sort inside and outside walls as their conditions say.
Evidence: wall and enclosure unit tests on small fields; the reference city maps.

### M4 — Hot spots place prominent ordinary POIs [depends on M2, M3c]

Scope: hot spots in the refined social fields run small town iterations that place
prominent POIs from the ordinary catalogue at their rough location on the city map. They
place no major works.
Acceptance: the city map shows its great markets, guildhalls, temple precincts, landings
and courts where the city's people and ways concentrate, and nowhere else.
Evidence: hot-spot and iteration unit tests; the reference city map.

### M5 — Districts [depends on M3]

Scope: the city refinement cuts six or seven organic districts along its social
boundaries, rivers, walls, main roads and fringe belts, each published as a region polygon
with its character.
Acceptance: districts tile the city, follow its features and differ in character.
Evidence: geometry unit tests; the reference city's districts.

### M5b — Major works on the city map [depends on M2, M3b]

Scope: the city's major works, counted by the population-band expectation, are sited by
their types' own rules on the city map and published at their rough location and size.
Acceptance: the reference city carries the number of works its population band expects,
each standing where its requirements meet.
Evidence: major-work siting unit tests on supplied city fields; the reference city map.

### M6 — District maps [depends on M1, M4, M5, M5b]

Scope: a district opens as a real-scale map over its outline. It captures the city map's
land, main roads, walls, the major works inside it and its hot-spot POIs, and grows its
fabric from its character under the city template's district-level guidance.
Acceptance: a harbour district and a temple district of the same city look like those
districts, around the works and POIs the city map placed, and a district's layout reads
as the city template at district fidelity.
Evidence: town development unit tests with supplied city context; two district maps.

### M7 — Navigating the city [depends on M6]

Scope: the viewer goes from the region to the city map, into a district and across to a
neighbouring one.
Acceptance: the Baldur's Gate pattern in the viewer: city overview, then districts.
Evidence: browser UI wiring tests on fixture maps.

### M8 — Integrate and record [depends on M1–M7]

Scope: an ADR for cities and organic outlines; backlog entries; this file deleted.

## Assumptions to check

- The people pass refines meaningfully at city resolution: its steps are sized by area and
  years, not by a cell size tuned to regions.
- A few town rounds at a hot spot can place prominent POIs without growing the surrounding
  streets, given the town plan's network ownership.
- Every one of the fourteen templates has a city-level layout similar to its district
  layout. Each is written out at M3b; a template whose rule has no city-scale form (for
  example a moored flotilla's hulls) gets the nearest city-scale arrangement, recorded
  there.
- The town fabric's existing walls (`town/founding.rs` kernel walls) and the city's walls
  are one representation at two scales; district maps capture the city's walls rather than
  founding their own.
- A district's town rounds, seeded with its major POIs, stay within today's single-map town
  run times.

## Sulion mapping

Root `fa4e971d-be53-4820-89bb-81dd58e8a183`. Phases: M1 `bc1c8375`, M2 `e8a4a2b9`, M3
`6d468d52`, M3b `f5df21b8`, M3c `46e10f3e`, M4 `34684574`, M5 `661a72fe`, M5b `4a298065`,
M6 `a50dcf10`, M7 `4a94c87f`, M8 `c3b6a81b`.

## Current state

Execution authorized 2026-11-20 ("execute all phases of the plan").

- **M1 done.** Capture keeps the selected outline as the child's footprint and stores the
  outline with a context band (10% of its extent) as `map.extent`; the frame generates over
  the extent as captured; publication clips fields, samples, features and hexes to the
  outline (`publication/product/inputs.rs`). A real-scale map clicked at a point keeps its
  hex frame; one opened over a region (a district) covers that region. Evidence:
  `tests/regions.rs` organic capture, the publication clip test, and Alagalo Savanna
  refined on the local atlas as its 168 × 142 km, 291-vertex outline. Fixed on the way: the
  cargo donor is located as the material sampler locates it.
- **M2 done.** `town/city.rs`: every catalogue place states its city appearance
  (`CityMap::Shows` with symbol, rough ground, the reading that raises it and what it seeds,
  or `Hidden` with a reason); every major work has one and is never raised at a hot spot.
- **M3 built.** `RefinementRequest.city` opens a city map at a settlement over its
  surroundings (2.5 times its built radius), at the level the scale contract gives that
  extent (`Quality::level_for_extent`). Rivassanrema refined into a 26 km city map at about
  128 m cells. Limitation: refining three levels in one step from the district map leaves
  the parent's cells as blocks in the people fields and concentrates population in a few
  cells.
- **M3b–M5b built** (`atlas/regional/city.rs`, `city/plan.rs`, `field/people/growth.rs`,
  `town/walls.rs`, `field/poi/city_places.rs`): city growth after each round's people pass
  (SLEUTH-style edge, road and centre growth moving people; the template's city level
  weighs every cell); walls raised where a guarded or seated template, builders and unwalled
  built land meet, with gaps where water or steep ground defends and gates on ways; the
  enclosure question; hot spots raising catalogue places through a few development rounds
  that read the town catalogue's eases and bars; districts by a barrier-weighted
  multi-source shortest path; major works by the population-band expectation, sited by
  their own rules. Wealth is read from standing ground and nearness to the heart, since the
  people layers hold no means.
- **M6 built.** A district map's seat is its captured district polygon, with the
  district's people, built ground and its city's template; its works arrive inherited from
  the city map.
- **M7 built.** The viewer offers "Open a city map" on a settlement and "Open this
  district" on a city map's district (`frontend/src/CityOpen.tsx`, `cityMaps.ts`).
