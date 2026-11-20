# 0018 — Cities refine into city maps and district maps

The owner's 2026-11-19 and 2026-11-20 direction: a large city is refined the way every other
layer is, from larger to smaller. A city map comes first and is coarser than streets and
buildings; its districts are refined afterwards as their own maps, over organic outlines.
City generation is a hybrid of regional refinement and city growth, interleaved. Walls have
their own phase. Hot spots place prominent places from the catalogue; major works follow
the population-band expectation. Each settlement template guides both the city and the
district level with similar layouts.

## Organic outlines

A refined child is its selected outline. Capture stores the outline as the child's
footprint and the outline with a context band (a tenth of its extent) as `map.extent`; the
child generates over the extent as captured, so an organic region has no rectangular edge,
and publication clips fields, samples, features and hexes to the outline. A real-scale map
opened at a point keeps its frame of hexes; one opened over a region covers that region.

## The city map

A city map is a regional refinement opened at a settlement (`RefinementRequest.city`). It
covers the settlement's surroundings, two and a half times its built radius, at the
regional level whose cells give that extent a region's triangle count. It runs the
regional sequence with two additions:

- **City growth** after each round's people pass moves a share of the city's people toward
  where it grows, after the urban cellular-automaton rules of SLEUTH: edge growth beside
  built land, road-influenced growth along maintained ways, spreading centres, and
  resistance on steep ground. The people pass then builds where people live, so the next
  round's refinement reads what growth changed.
- **The city plan** after the last round: hot spots of the refined social fields run a few
  development rounds that raise prominent catalogue places, reading the town catalogue's
  own eases and bars; districts gather round the strongest hot spots and part along water,
  walls, main roads and changes of character (a barrier-weighted shortest-path partition);
  and the city's major works, as many as its population band expects, are sited by their
  own rules.

## Templates at two levels

A settlement template's layout rules are read in units: on a district map the plot depth,
on a city map the template's quarter, which every template states. The same rules give
a surveyors' ring frontages on a district map and ring roads on a city map. A large city
chooses one template from its own site at its first growth round; its districts' towns
take it where it can found.

## Walls

A city raises a wall round the built land joined to its heart, courtyards within included,
where its template guards or seats power, its people can build, and its built land stands
unwalled; a template with an enclosed seat raises an inner wall first. A wall's run leaves
out faces that water or steep ground defends and opens gates where maintained ways cross.
Every wall stands once raised, so an outgrown wall stays inside the city. The enclosure
question, how many walls enclose a cell, conditions where places stand.

## The catalogue's large-scale slot

Every place in the settlement catalogue states how it appears on a city map: shown, with its
symbol, rough ground, the reading that raises it and the uses it seeds on a district map; or
hidden, with the reason. Walls, gates, hot-spot places, districts and major works are
entries of the place catalogue, which publishes them.

## District maps

A district opens as a real-scale map over its outline. Its town's seat is the captured
district, with the district's people and built ground; its works arrive inherited from the
city map.
