# Large cities across several maps

Working copy of a proposed plan (owner request 2026-11-19). Nothing here is built. The
last milestone moves its durable content into an ADR and the backlog and deletes this file.

## Outcome

A city too large for one real-scale map is made as a city and its parts: a city layer that
decides everything that must be the same everywhere in the city, and part maps (wards,
boroughs, districts) that grow streets, plots and buildings inside it. Opening two
neighbouring parts shows one city: the arterials, rivers, walls and district edges meet at
the shared edge, and each part's fabric reads as belonging to its part of the city.

## User requirements (owner, 2026-11-19)

1. Cities that need to spread over multiple maps need an intermediary layer between the
   city and its detailed maps, as New York has boroughs and Tokyo its wards.
2. Lattice sizes follow the scale contract: a child of about a seventh of its parent's area
   has about the parent's triangle count (Draft about 15k, Standard about 60k).

Standing direction this plan inherits: towns grow through processes, never stamped
layouts ([TOWN-DEVELOPMENT-PLAN](TOWN-DEVELOPMENT-PLAN.md)); real-scale maps capture their
parent's context and owe it only landmark agreement ([ADR 0016](adr/0016-real-scale-maps.md));
regions are indexed polygons; refinement writes the child, never the parent.

## Findings

Research report (sources opened by the research pass, 2026-11-19):

- **Real cities nest three to five levels between the city and the block.**
  - New York: 5 boroughs, 59 community districts of 3.6–59 km², then neighbourhoods.
  - Tokyo: 23 wards of 10–60 km², then machi, chōme and blocks.
  - Paris: 20 arrondissements of 2.2–16 km², then 80 quartiers of about 1.3 km².
  - London: 32 boroughs of 12–150 km², then wards.
  - Istanbul: 39 districts, then mahalle.
  - Rome and Constantinople had 14 regiones each, bounded by their walls.

  Each level splits into 4 to 18 parts, so the scale contract's sevenths fit.
- **Large cities grow by absorbing villages, which keep their identity.** London absorbed
  hundreds of towns and villages; Paris's arrondissements come from annexed communes
  (1860). Beneš et al. 2014 grow several settlements where inter-city roads cross and
  merge them into a conurbation.
- **Some decisions are city-wide and break if made per tile.**
  - Hillier's space syntax describes a foreground network of linked centres at every
    scale, set in a background of residential streets; the foreground also carries the
    links to other towns.
  - Tiled map rendering shows that rules depending on far-away facts fail at tile edges:
    labels, priority, merging (imagico; OSM metatiles).
- **District edges form on arterials, rivers and walls.** Conzen and Whitehand's fringe
  belts form against walls and in building slumps. They are large, green, institutional and
  thin in radial roads, and they persist inside the grown city. Chen et al. 2008 let street
  patterns change across major roads and seed one region's streets from another's road
  ends.
- **Coarse-to-fine generation is the established pattern.** Parish and Müller generate
  highways, then streets, lots and buildings, driven by population and coast maps. Chen et
  al. trace major roads first and then fill the regions between.

How this codebase differs from the research's sizing:
- Streets, plots and buildings are free vector shapes. Only the ground is on the lattice.
- A part map's limit is therefore the cost of the town processes over its holdings, and the
  ground's resolution, not hex count.
- A real-scale map at 100 m hexes, 50 across, holds about the Draft triangle count over
  about 20 km². That is the size of a Paris arrondissement, a New York community district
  or a small Tokyo ward.

## Decisions

Agent-derived, revisable with evidence; the ones marked **owner** need the owner's word:

1. **The city layer is a regional map at the city's level, with a metropolitan stage.**
   - A city of 600–1,500 km² is about one level-4 region (about 48 × 36 km at about 15k
     Draft triangles). That lattice resolves a few hundred metres: enough for arterials,
     centres, land use and density, not for streets.
   - Its new metropolitan stage runs after regional development:
     - It grows the foreground network: arterials, the links to other towns, river
       crossings.
     - It places centre seeds and their hierarchy, walls with gates as fixation lines, and
       fringe belts.
     - It places absorbed villages as their own nuclei, in the order they were reached, and
       builds density, land-use and building-period fields.
     - It cuts parts along arterials, rivers, walls and fringe belts.
   - It publishes the skeleton as vector features, and each part as a region polygon with
     its census, character and period.
   - It reuses regional maps, the scale contract and region selection, and adds no new map
     kind. The alternative is a real-scale map at the 300 m hex: rejected, because at the
     largest hex a city of this area holds several times the triangle count.
2. **A part is a real-scale ground map opened from its region polygon.**
   - It captures the city layer's skeleton inside and around its outline as fixed context.
   - Its town development is constrained by that context: arterials, centres and walls fixed
     in place, its census as the population it realizes, its period and character as the
     starting conditions of its rounds.
   - The existing town processes grow everything below the arterials.
   - A part larger than one map's area is cut again, one level down, by the same rules.
3. **Seams lie on skeleton features, so parts agree without seeing each other.**
   - A part's outline follows an arterial centreline, a river or a wall.
   - The city layer fixes the seam feature's geometry, width and gates.
   - A part grows its plots up to its side of the seam street, and minor streets start from
     the arterial's frontage, as Chen seeds one region from another's road ends.
   - Parts can be generated in any order and still meet.
   - **Owner:** this adds an across-map rule for parts of one city: their shared skeleton
     features agree exactly. Today parent and child owe only landmark agreement, so this
     needs the owner's word.
4. **City-wide facts are decided once, at the city layer.** These are the centre hierarchy,
   landmark priority, arterial names and classes, and part names. Addresses within a part
   follow the part's own streets.
5. **Trigger.** A settlement whose census footprint exceeds one real-scale map's area at the
   chosen hex opens as a city layer. A smaller settlement opens as one real-scale map, as
   today. **Owner:** confirm the threshold's measure (footprint area or census population).

## Milestones

### M1 — Metropolitan stage on a city-level regional map
Scope: a regional map at the city's level runs a metropolitan stage after regional
development. It publishes arterials (including links to other towns), river crossings,
centre seeds, walls with gates, fringe belts and density and land-use fields.
Acceptance: a large settlement in the reference chain shows a readable city skeleton whose
arterials continue its parent's roads and whose centres sit where the census and roads say.
Evidence: unit tests of each process on small fields; one reference-chain city map.

### M2 — Parts as region polygons [depends on M1]
Scope: the metropolitan stage cuts the city into parts along skeleton features, with each
part's census, character, period and name, published as region polygons a creator can
select.
Acceptance: parts tile the city without gaps or overlaps, their edges run on arterials,
rivers, walls or fringe belts, and each part's census sums to about the city's.
Evidence: geometry unit tests; the reference city's parts drawn on its map.

### M3 — A part grows inside the skeleton [depends on M2]
Scope: opening a part captures the skeleton inside and around it. Town development treats
arterials, centres and walls as fixed and realizes the part's census and character.
Acceptance: a part's streets meet the arterials it was given, and its density and
character follow its census and period.
Evidence: town development unit tests with a supplied skeleton; one part map.

### M4 — Neighbouring parts meet [depends on M3]
Scope: seam features agree exactly between parts generated in either order; plots stop at
their side of the seam.
Acceptance: two neighbouring parts, opened side by side, continue each other's arterials,
river and wall without a step or gap.
Evidence: a seam test over two small supplied parts; two neighbouring part maps from the
reference city.

### M5 — Absorbed villages and growth history [depends on M2]
Scope: villages the city reached keep their nuclei, names and older street patterns, and
fringe belts mark where the city stopped growing for a time.
Acceptance: an inner part shows a distinct older core from an absorbed village, separated
from later growth by a fringe belt.
Evidence: metropolitan-stage unit tests; the reference city.

### M6 — Navigating the city [depends on M3]
Scope: the viewer moves between the city layer, its parts and neighbouring parts; search
and addresses find a street or building in any part from the city layer.
Acceptance: a creator can go from the city to a part, across a seam to its neighbour and
back, and find an address from the city.
Evidence: browser UI wiring tests on fixture maps.

### M7 — Integrate and record [depends on M1–M6]
Scope: an ADR for cities across maps; backlog entries; this file deleted.

## Assumptions to check

- A level-4 regional lattice resolves arterials and fringe belts well enough. If not, the
  metropolitan stage may need a level-5 city layer for the largest cities.
- Current town processes accept fixed arterials and supplied centres as starting
  conditions without a second network authority. The town plan's network ownership decides
  this.
- One 100 m-hex part map's town rounds stay within the run times of today's single-map
  towns at the part's census.

## Sulion mapping

To be published when work starts, as a root plan with M1–M7 as phases.
