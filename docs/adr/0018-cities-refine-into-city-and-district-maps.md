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
Household placement reads the previous round's road access alongside food, work and
city template guidance. Each captured census describes a population spread across a
catchment. Neighbouring catchments overlap on reachable ground, where roads, workplaces
and housing determine the fine distribution. Households carry their identities with them.
Walls and commissioned works develop
during those rounds.

Households settle where built ground has room, and a better location is worth living
more closely for. Builders then add a share of the ground people still lack, and ground
beyond what its people need returns to the fields. Over the rounds the city's ground
fills and its edge sharpens: inside it open ground is taken up, outside it built ground
thins to farmsteads. Built ground holds more people where many live within a short walk
and fewer where trade fills its households' purse. Each district program adds how tightly
its own households live, so tenement ground holds several times the people of estate
ground. Ground inside a wall is worth more to households and to investment, and crowds
further, by the share of the circuit that stands: a wall begun protects little and a
ruined one less each time more of it falls out of use. A landmark that needs a wall
counts any circuit that has been begun. The City passes both to the society rounds with its road access
and reservations. District centres are founded on built ground and stand as far apart
as that ground warrants in each round, so a city that gathers onto less ground founds
more of them where it has come to stand. Land-use areas and districts cover ground that
is built on; the rest of the map is its countryside and neighbouring villages. No step
fills an outline or sets a coverage.

The captured settled outline gives the interior a strong preference for urban development.
The surrounding countryside can support farms, road stops and satellites. The founding
policy and the settlement's existing people, capital, institutions and approaches give
rise to district programs before roads and land use settle. Each program competes for a
site. Local settlement patterns and geography weight the economic, social and trait
draws. Repeated city-wide choices become progressively less likely. Every new district
receives at least one trait. Ordinary stands alone and adds no effect. Other traits
shape land use and movement across the district, with local variation from terrain,
occupation and earlier rounds of development. A home or water source can explain a
district-wide effect. The district retains that origin as detail. POI siting and major
works remain independent. Magical effects depend on the corresponding medium. These choices change
land claims, investment, access and construction. Each round
reads the previous round's occupied ground and access on the shared lattice.

An institution or major work holds the ground round it as its precinct where its claim is
stronger than the households'. Its claim falls with the walk from its door. Theirs rises
where housing is crowded or sought after and on ground outside the city's interior, so a
precinct is small in a crowded quarter, and a work that asks little of its surroundings
keeps its own grounds alone. A named control sets how a sponsor's claim weighs against
the households'.

After these rounds, the City partitions the principal settlement into permanent districts
around the programs that shaped it, preserving public courts, parks and geographic obstacles.
The built body nearest the seat is the settlement's own. Each other body near it belongs to
the settlement whose population draws it most strongly for its distance: a city keeps the
quarters that have grown to reach a village, that village becoming one of them, and a
neighbouring town of the city's own size keeps its ground.
The City publishes district types and polygons, broad developed tracts, major roads,
open grounds and significant sites.

## Walls

Walls are walked into being, a step at a time, and nothing names a kind of wall. A
circuit, an arc open to one side, an old wall deep inside a later one, a stump, a ruin
and no wall at all are what the walks and the wear leave behind for different towns,
histories and rolls.

Each era the town's record tells of builds against the town as it then was, and each round
of the present era builds against the city as it stands. The town is the city's built
ground. An earlier era's town stood on the most crowded share of that ground equal to its
share of today's people, and it did not grow evenly: a many-scaled field of the era's own
tilts which ground it favoured, so each era's town leans its own way.

A season of building begins by drawing the edge the town walls, from wide to tight, the
more worthwhile edges the likelier; a civic order that holds a citadel draws every edge in
round more crowded ground. An edge is the rim of one body of the town: the crowded ground
joined to its most crowded place, with whatever gardens, yards and ponds that ground
surrounds. A quarter as crowded that lies apart across open fields is not walled with it.
A wall the present era has begun keeps the line it was begun on through the rounds that
follow, though the town grows past it or gathers behind it. The town's site, its standing
as a realm's seat, a contest for it and its civic order weigh how readily it defends
itself, and a draw for the era scales that weight into how threatened the era left it. The
work the season gives is its means by how keenly that threat and the worth of the edge
move it: an earlier era gives from its share of today's standing stock, and the present
era's builders set out in a year dealt by chance and give what their supporters can do in
the years each round stands for. An era that passes quietly lays a stump or nothing.

Builders set out one after another, each on a stretch of the edge with no standing wall in
sight, toward the side the era's threat came from, with chance in the choosing. A builder
carries its wall both ways along the edge from where it set out. It keeps to a ribbon of
ground along the edge and judges each step by where it leads a few steps on: toward the
era's own line, which sways inside the edge here and outside it there, and toward wall
that already lies near, standing or fallen, so it closes on old lines and on its fellows'
work. It lays a section where it treads and spends work for it: more through built and
busy ground today, several times more over a stream or a steep bank it can step across,
little along an earlier era's wall that still stands, and the work of plain wall along an
earlier town's open edge. Coming within a few cells of wall laid that season it lays a
last length straight to it and stops, so stretches join and a circuit closes. It stops,
too, when its work is spent, and where water too wide to step across lies ahead, to which
it carries the wall so that the bank completes the line.

Wall falls in patches that shift from era to era: a little everywhere, more where built
ground presses on it and its stone is taken, more where the quarter about it lies in ruin.
An era's wear follows each earlier era's building, and each round takes its share of an
era's wear from the walls of earlier eras. The present era keeps up the wall it is
building.

A wall shelters the ground it makes someone coming from outside the city go a long way
round to reach, or keeps them from altogether: all the ground inside a closed circuit,
the ground close behind a long arc, none behind a stump. Water and ground too steep for a
wall bar the way as wall does, so a river or a cliff completes a side. Sheltered ground is worth more to
households and to investment by the share of the wall that stands, so people and works
gather behind what stands before the next round's builders read the city. An earlier
era's wall that shelters too small a share of today's people is outgrown, and districts
that hold it carry it as a trait. Principal roads crossing standing wall establish gates.

## The catalogue's large-scale slot

Every place in the settlement catalogue states how it appears on a city map: shown, with its
symbol, rough ground, the reading that raises it and the uses it seeds on a district map; or
hidden, with the reason. The City places prominent catalogue landmarks according to local use and site conditions.

Major works compete for suitable sites across the settled outline early in development.
Each family describes the land it needs and how far its influence extends along and across
its approach. Its commissioned design supplies the physical grounds. Principal journeys
connect incoming ways, works and economic destinations. Later journeys reuse those routes
and connect emerging districts where the existing journey is too indirect. Regional approaches
and district journeys converge on centres supported by trade, work and civic activity.
Routes that carry several journeys gain width and improve access in the next round.
The reach of a district centre scales with the settled area and the local quarter size.
The road process selects pairs of endpoints and their trip demand before routing. The router
can serve a pair over existing streets or survey a new connection between the same destinations.
It compares passages on both sides of a direct alignment and surveys the resulting profile
for traverses on steep ground and bridge decks between bearing banks. Journeys can join
an existing hillside ascent at two accessible elevations. A new ascent follows successive
ground contours and evaluates the grade on each leg of a turn. The grade along the
road, occupied ground and local passage costs shape bends between junctions. Planned
ground favours straighter runs, while rough ground favours curved approaches.

## District maps

A district opens as a real-scale map over its outline. The Street map inherits the district identity, boundary, major roads, landmarks, open spaces and developed ground. The district's selected programs respond to local ground, access and the mix of uses the City resolved. The same development rounds serve district maps and standalone settlements. Local routes create opportunities for frontage and premises, and the places that take hold generate demand for more access. A district's principal roads keep their City identities, including where they continue into neighboring districts.

Each tract the City records as inhabited is founded as a town is: with a kernel of
premises at the place its street survey chose, on an avenue where one serves it. A
tract no avenue touches gets one way in across passable ground. The development rounds
raise the rest of the district from these kernels: an occupied street opens the land
behind it, premises take it up, and streets follow where traffic and frontage call for
them. Founding lays no block streets and fills no tract. A standalone
town can establish a public street at a founding workplace or meeting place even
when no regional road reaches it. Later traffic can turn a well-used walking route
into a street in either kind of settlement.

The City's finding of how tightly households live comes with each tract: the built ground
a resident has there beside a one-storey street household's. Where residents have more,
that share of new households takes crofts, courtyard houses and compounds by their means,
and the district offers them larger plots. Where they have less, that share takes places
in lodging courts, and a crowded household builds upward more readily before it builds
over its garden. A standalone town has no City to say and chooses as it always has.

Every town on a street map carries a record of how it is ordered: the spacing its streets
keep, how far a back lane runs, where a main street's crossings fall, the saving that
earns a shortcut, the street work its residents give and the size of the plots it offers.
Premises take a plot from their own range of sizes, larger or smaller as the town's plots
stand beside an ordinary town's and never under the least their kind works on. A
commissioned work and a place inside another's court keep their own size.
It also says how far apart households' lots lie, how much birth counts beside work, how
strongly standing draws standing, how much the town lays frontage streets ahead of
building against surfacing the ways feet wear, how far trade keeps to busy frontage, how
strongly the template shows, how much like trades draw together and how much a town's
own signature trades outbid the rest. Every term is one part of a rule inside the rounds;
none lays out a result by itself.

Three loops in the rounds grow an early difference. A site is held in regard by the
usual means of the places round it and the dignity great houses and institutions lend
its street; a crowd of poor neighbours does not raise it. Where an order defers to
standing, a share of its households settle by it: the better born take the open sites
held in highest regard and the worst born are left those held in least, so one early
great house can make a great street beside a common one. The lots drawn are the same;
only where they land changes. Premises of one family make their street cheaper
for more of that family, so a street's first smith can make it the smiths' street.
Chance gives each town a few working trades as its own at founding, weighted toward what
its district lives by, and those outbid the rest wherever custom lets them stand.
The causes that vary a town and the rules that build it meet in this record. A cause
writes a term; a rule reads it where it would otherwise hold a number of its own. The
map's settings write first and the settlement's civic order writes over them. Each term
is a declared setting of the map, so one map can be made with different terms and
compared.

A settlement's policy is drawn on independent choices. Its founding template says who
first lives there and on what ground. Its civic order says who holds it and how its
wealth and decisions are spread: a princely seat, an autocracy, a slave-holding city, a
council of elders, a freehold, a democracy or a merchant council. Both are drawn from the
same site evidence, each on a draw of its own, so any template can meet any order. A
record that says households are free rules out holding them. The order is saved with the
policy: a City publishes it and each district's street map inherits it.

A third choice is drawn the same way: the craft the settlement practises everywhere, if
any. Its weight is its medium's presence at the site and the share already practising it,
and often none is drawn. Every site the rounds consider in such a settlement reads that
craft as a little present, and more by the learning that reaches it from those who
already practise and teach nearby, so its premises can take hold on any street where
custom supports them and gather into quarters as the rounds go on. Tending still needs
living roots. A city on a stable tear can become a city of doors and one on quickened
ground a city of hearths, and the rounds decide how far.

At City scale the civic order weighs which resident characters the districts take and
how far apart districts live in how tightly they dwell. An order adds its own weight to
what moves the town to wall itself, and one that holds a citadel draws its walls' edge
round more crowded ground. It never weighs a district's economic role or its traits.

On a street map a civic order speaks only through the town's order record and adds
nothing to what a district's economy and residents ask for, so it varies a town along
lines the district choices do not.

During Street development, local conditions inform demand, operating premises
compete for reachable customers and services, and funded common works can claim
ground. Accessible clearance already affects nuisance at premises. The separate
sanitation strategy for laying out local service infrastructure is deferred.
Development at the inherited date does not run the elapsed waste-removal operation.
