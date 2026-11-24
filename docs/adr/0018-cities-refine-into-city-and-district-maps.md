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
census. It uses the settlement's published footprint when one exists. Otherwise its edge
follows the connected concentration of residents and built ground around the settlement,
accounting for slope and standing water on the parent map. It opens at the
regional level whose cells give that extent a region's triangle count. It runs the
regional sequence. The society rounds refine population and built stock on the shared field.
City template guidance influences household placement. Walls and commissioned works develop
during those rounds.

In each City development round, movement connects approaches and lays avenues, then records
walking access across the terrain. Districts partition the served ground and record local
activity. Construction uses those fields with population and standing stock to place developed
frontage and open space. Occupied frontage and district activity carry over on the lattice
and influence where the following round lays its routes. After the last round movement takes
up the streets serving the final blocks. The City publishes its district polygons, thoroughfares, blocks and
reserved spaces, and retains the identity of existing districts and works.

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
hidden, with the reason. The City places prominent catalogue landmarks according to local use and site conditions.

## District maps

A district opens as a real-scale map over its outline. The Street map carries the published district, main streets, landmarks, open spaces and blocks by identity. Local lanes subdivide the blocks. Individual plots, yards and buildings follow their street frontages.
