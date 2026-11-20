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
and publication clips fields, samples, features and hexes to the outline. The band stays
within the parent map: past the parent's edge only coarser ancestry holds fields, and a
child one level down takes up its parent alone. A child's processes place things inside
its outline; the band is context (`Scope.outline`). A real-scale map opened at a point keeps
its frame of hexes; one opened over a region covers that region.

## The city map

A city map is a regional refinement opened at a settlement (`RefinementRequest.city`) and
reads that settlement by its captured record's identity: its centre, built radius and
census. It covers the settlement's surroundings, two and a half times its built radius, as
far as its parent map reaches, at the
regional level whose cells give that extent a region's triangle count. It runs the
regional sequence with the city's own steps inside every round, after the round's people
pass, so refinement and city development interleave:

- **City growth** moves a share of the city's people toward where it grows, after the urban
  cellular-automaton rules of SLEUTH: edge growth beside built land, road-influenced growth
  along maintained ways, spreading centres, the draw of the city's prominent places and
  major works, and resistance on steep ground. Walls rise in the same step.
- **Hot-spot towns at city fidelity.** Where the round's refined social fields concentrate,
  a town is founded by the ordinary town founding, under the city's template where it can
  found, and sized by the share of the city's people round it. It develops at city
  fidelity: the same town processes, with a plot a city block, a street a thoroughfare and
  a holding a block's use standing for the premises it holds. Every hot-spot town runs a
  few rounds of the ordinary town development steps, growing thoroughfares, business and
  residential blocks and civic seats. The city's major works, as many as its population
  band expects, are sited by their own rules in the first round and taken up by the
  hot-spot town beside each, which builds round them.
- **Coupling into the people layers.** After the town steps the towns' blocks and
  thoroughfares are taken up by the people layers through the people owner: people move
  toward blocks that house more people than live there, built ground rises to the blocks'
  cover, and thoroughfares become maintained ways. Landmarks are the towns' places of a
  kind the city map shows, one per kind family and town.

The next round's refinement and growth start from what the towns changed. After the last round, districts gather round the strongest
hot-spot towns, as many as the city's people call for, and part along water, walls, main
roads and changes of character (a barrier-weighted shortest-path partition) over the built
and walled city only.

## Town fidelity

Every length the town system declares is declared once, in street metres, with what it
measures: a plot, the layout between plots, a holding's reach over its neighbours, a width,
the ground's raster, or a distance people travel. A town carries its fidelity, and its scale
(`town::scale::TownScale`) resolves each declared length by that fidelity's factor for the
measure, as `MapScale` resolves a map process's measures. A fidelity is a row of factors:
street fidelity is the unit, city fidelity sizes plots into blocks and streets into
thoroughfares, and people walk as far at both. Major works keep their real size.

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
hidden, with the reason. Walls, gates, thoroughfares, blocks with their use, landmarks,
districts and major works are entries of the place catalogue, which publishes them.

## District maps

A district opens as a real-scale map over its outline. Its town's seat is the captured
district, with the district's people and built ground; its works arrive inherited from the
city map.
