# Large cities: a city map refined into district maps

Working copy of a proposed plan (owner direction 2026-11-19). Nothing here is built. The
last milestone moves its durable content into an ADR and the backlog and deletes this file.

## Outcome

A large city is made the way every other layer is made: refined from larger to smaller.
First a city map is generated completely. It covers the whole city, coarser than streets
and buildings, and shows:
- the city's land and water;
- its walls, gates and main roads;
- its major landmarks;
- six or seven districts, each with its own population, density, wealth, specializations
  and occupations.

Then any district can be refined into its own map, where streets, plots and buildings grow
from the district's character. This follows the city maps of Baldur's Gate and Neverwinter
Nights: one map of the city and its districts, each district a map of its own. District
outlines follow the city: rivers, walls, roads, ridges and the edges of older growth, not
rectangles.

## User requirements (owner, 2026-11-19)

1. Cities refine like every other layer, larger to smaller, then subdivide.
2. A city map comes first, generated completely, with its own features and major
   landmarks. It is not as fine-grained as streets and buildings. It holds districts with
   their density, specializations and occupations.
3. After the city map is complete, individual districts (wards) are refined as their own
   maps.
4. Districts are not forced to be rectangular. They follow arbitrary, organic boundaries.
   Generation areas stop being rectangles.
5. Lattice sizes follow the scale contract: a child of about a seventh of its parent's area
   has about the parent's triangle count (Draft about 15k, Standard about 60k).

Standing direction: towns grow through processes, never stamped layouts; a child captures
its parent's context and writes only itself; parent and child owe each other landmark
agreement; regions are indexed polygons.

## How the research informs generation

The research pass of 2026-11-19, from the sources it opened:

- **Real cities nest in parts of a few to tens of square kilometres.** Paris's 20
  arrondissements run 2–16 km², New York's community districts 4–59 km², Tokyo's wards
  10–60 km². Each level splits into 4 to 18 parts, so six or seven districts per city map
  fits real cities and the scale contract.
- **City-wide decisions belong to the city map.** Hillier's space syntax describes a
  foreground network of main roads linking centres and other towns, set in a background of
  residential streets. Main roads, centres and their ranking, landmarks and district
  identity are therefore decided once, on the city map, and inherited by districts.
- **District edges form on rivers, walls and main roads.** Conzen and Whitehand's fringe
  belts form against walls and in building slumps, and survive inside the grown city. The
  city map draws district outlines along those features, which makes them organic and puts
  seams where streets change anyway.
- **Large cities absorb villages that keep their identity.** London and Paris both grew
  this way. On the city map, an absorbed village becomes a district with its own older
  centre.
- **Coarse to fine is the established pattern.** Parish and Müller go from highways to
  streets, lots and buildings. Chen et al. trace major roads first, then fill the regions
  between and seed their streets from the major roads' ends.

## Proposed design

Agent-derived and revisable; owner decisions are marked.

**Scale ladder.** Using the real-scale hex ladder, each step from city to district is a
third of the hex size, about a ninth of the area: close to the scale contract's seventh.

| Map | Hex | Area at ~15k Draft triangles | Real-world match |
|---|---|---|---|
| City map | 300 m | ~16 × 12 km, ~200 km² | A historic capital, or Paris inside its walls |
| District map | 100 m | ~5 × 4 km, ~20–30 km² | A Paris arrondissement, a New York district |

A metropolis larger than one city map (New York, Tokyo) needs one more level: its city
map's districts are themselves cities with district maps. **Owner:** confirm the ladder
and the step.

**City map.**
- A ground map opened at a settlement from its region, sized to the settlement's
  footprint.
- Its generation runs the land at city scale, then a city stage:
  - main roads continuing the region's ways, river crossings and the harbour;
  - walls and gates;
  - centres and their ranking, major landmarks and absorbed villages;
  - six or seven districts, cut along rivers, walls, main roads and fringe belts;
  - each district's population, density, wealth, specializations (docks, markets,
    temples, crafts, noble quarter) and occupations, drawn from the city's census and
    position.
- It publishes:
  - the main roads, walls and landmarks as features;
  - density and land-use as rasters;
  - each district as a named region polygon with its character.
- It shows no buildings.

**District map.**
- Opened from a district polygon on a complete city map.
- Generated over the district's own outline, not a rectangle.
- It captures:
  - the city map's land;
  - the main roads, walls, gates and landmarks inside and along its outline, as fixed
    features;
  - its character, as the census and conditions its town rounds start from.
- The existing town processes grow its streets, plots, buildings and occupations, with
  minor streets starting from the main roads.

**Neighbouring districts.**
- Outlines run along main roads, rivers and walls that the city map has already fixed, so
  two districts meet on the same feature, generated in either order.
- **Owner:** this is a new agreement between maps: sibling districts share their boundary
  features exactly. Until now maps owe each other only landmark agreement.

**Non-rectangular generation.**
- Today a refined child's lattice is built over the bounding rectangle of the selected
  outline plus a margin (`atlas-host/src/generation_frame.rs`, `regional_frame`).
- The change:
  - Build the frame over the outline itself, with a band of context outside it.
  - Grow and publish only inside the outline.
  - Publish rasters and features clipped to the outline.
- This applies to every refinement, not only districts. A region can then follow a coast,
  a valley or a border.

## Milestones

### M1 — Generation over arbitrary outlines
Scope: refinement and real-scale generation build their frame, capture, processes and
publication over the selected outline instead of its bounding rectangle, keeping a context
band outside it.
Acceptance: a region selected as an organic outline (a valley, a coast) is generated and
published inside that outline, with no rectangular edge.
Evidence: frame and capture unit tests on supplied polygons; one organic region in the
reference chain.

### M2 — The city map [depends on M1]
Scope: a city map kind opened at a settlement. A city stage generates main roads,
crossings, walls and gates, centres, landmarks and absorbed villages, then cuts six or
seven organic districts with their population, density, wealth, specializations and
occupations, published as region polygons.
Acceptance: the reference chain's largest city shows a readable city with districts that
follow its rivers, walls and roads, each with a distinct character.
Evidence: unit tests of each city-stage process on small fields; one city map.

### M3 — District maps [depends on M1, M2]
Scope: a district opens from its polygon as a district map over its own outline. It
captures the city map's land, main roads, walls and landmarks as fixed, and grows its
fabric from its character.
Acceptance: a dock district and a temple district of the same city look like those
districts, and their main roads are the city map's.
Evidence: town development unit tests with supplied city context; two district maps.

### M4 — Neighbouring districts meet [depends on M3]
Scope: districts generated in either order agree exactly on their shared roads, rivers
and walls; plots stop at their side of the shared street.
Acceptance: two neighbouring districts, opened side by side, continue each other without
a step or gap.
Evidence: a seam test over two supplied districts; two neighbouring district maps.

### M5 — Navigating the city [depends on M3]
Scope: the viewer goes from the region to the city map, from the city map into a district,
across to a neighbouring district and back; the city map finds a district's streets and
addresses.
Acceptance: the Baldur's Gate pattern in the viewer: city overview, then districts.
Evidence: browser UI wiring tests on fixture maps.

### M6 — Integrate and record [depends on M1–M5]
Scope: an ADR for cities and organic outlines; backlog entries; this file deleted.

## Assumptions to check

- The 300 m hex resolves walls, main roads and district edges well enough for a city map.
- Town processes accept fixed main roads and a supplied character as starting conditions
  without a second road network authority. The town plan's network ownership decides this.
- A district's town rounds stay within today's single-map town run times at its census.

## Sulion mapping

To be published when work starts, as a root plan with M1–M6 as phases.
