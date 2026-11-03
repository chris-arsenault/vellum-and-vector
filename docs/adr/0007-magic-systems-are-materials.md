# 0007 — Magic systems are materials the world carries

User direction recorded 2026-10-24 and 2026-10-25; adopted 2026-10-25. Applies
to every magic system in generation. Refines
[ADR 0004](0004-coupling-through-each-systems-medium.md), which keeps each
system acting through its own medium, and holds under
[ADR 0005](0005-scale-contract.md).

## Decision

**Seven systems, no more.** Fire, Aurora, Pressure, Greenwood, Salt, Hallowed
and Veil, each a first-class world effect with its own medium, propagation,
feedback and interference. The
[magic lore bible](../lore/magic.md) carries their character; the
[product contract](../product-spec.md#103-magical-generation--the-seven-systems)
their mechanisms.

**A system is a material.** Each system holds stocks in named reservoirs, and
each stock declares the world's own transports that carry it: the crust (plate
drift carries every solid reservoir by the transport plan, conserving the
amount), ice (charge rides the flow and is dumped at the terminus and on the
shelf), rivers (placers and brine move one cell down the drainage), groundwater
(aquifers leach a buried stratum to a spring), wind (dust and sand lift and
settle), animals (sap in the gut of grazing herds) and people (trade ledgers
along the ways). Ocean currents can be declared as a carrier, but no stock is
moved by them yet. Intensity is derived from stock and medium at evaluation, and
a budget of created, carried, stored, released and lost closes per system. Sinks
are physical: flushing to the sea, burning, extraction.

Every stock changes in one stock advance per epoch, run from the history pass;
locating sources only reads stocks, so re-evaluating a system within an epoch
never counts a stock twice. An origin that feeds on a record consumes it: Salt's
death origin uses up the mass-death record and its dead-lake origin the lake
memory, so Salt never re-makes itself from the same dead each epoch. Some
carriers are excluded by what the medium is: meltwater is Aurora's sink, not its
carrier; grazers avoid Salt, so Salt has no animal carrier; Pressure charge sits
in water, not crust; Veil carries nothing itself. Crust drift decays the stocks
it carries, so crust-borne tracks (spent Fire behind a drifting hotspot, a
displaced Salt bed) are features of an early world.

**Origins on the schema.** A system holds several origins, each with its own
source, propagation, renewal and parameter overrides; a system's effects and
rules stay one set. Renewal names the mechanism (conduit-fed, accumulating,
continuous, finite, kept, emergent); no generic renewal engine. A system saved
before origins existed is parsed into one origin.

**Cells carry shares.** A class covers a fraction of a cell, derived from the
rule's own continuous quantity through a declared mapping, never from sub-cell
geometry. The drawn surface shows the class with the largest coverage and
hatches the next where it holds a declared share of the ground; places are
outlined at a declared fraction of their peak coverage, and society seats where
coverage passes a declared floor. Magic is
never netted on a shared scalar: Fire is not a warming term that cancels
Aurora's cold.

**Sources are sites; places are coherent.** A located source has a declared
least strength: a release, a tenure, a killing or a cracking below it is still
stock, which moves, accumulates and feeds the field, but it is no source and
seeds no site, so a trace a river or a trade road carried is never a labelled
core. A class component is published as a named place only past a minimum of
cells declared with its cartography (one for a site, more for a course or an
area) and significant at the map's scale
([ADR 0005](0005-scale-contract.md)); below that the class stays on the map as
coverage, and only a domain large relative to the map's land is subdivided. Density
is lowered by locating sites and keeping places whole, never by thinning stocks
or intensities, and the seven systems are judged against each other: no one of
them may own the map's places.

**Meetings are processes.** A confluence names the systems it reads, the
coverage floor each must reach, its own writes to the physical fields, its own
hazard and class. Its coverage is the smaller parent's scaled by the strain
between them, and it displaces the parents, so a meeting is never the mean of
what made it. Hallowed and Veil are the any-system meetings: warding scales
every other system inside a ring and lays what it removed on the rim; tearing
reads the strain of every pair plus the meetings' coverage, so a triple meeting
tears more than its pairs. Each connected patch of warding is one ring and pays
its own rim. Veil answers Fire's release at a cell, not Fire's presence, because a
Fire and Aurora front always has Fire under its tears.

**People are a carrier and a source.** Trade moves held cores, seed and salt
along the ways; cores cracked at a forge are a Fire source; extraction, hunting,
clearance and burning act on the stocks and their media. The society recorder
writes tenure, walked routes, kept lines and the dead onto the mesh as amounts
the crust carries. A society-phase system is evaluated inside the environmental
refresh while people act and lapses to its stored charge between, so an
abandoned sanctuary fades; systems whose stocks people touched in a cycle are
re-evaluated in that refresh.

**Doors are edges.** Stable tears pair into doors; a door is an edge of kind
`door` between the surface cells under its ends, added when connections are
built and never when territories are assigned, unworn and never a highway, not
drawn as a way.

## Alternatives

- An intensity field with carried history, which is what existed. Rejected:
  it cannot say where the Fire went when the crust moved or what the glacier did
  with the charge, and extraction had nothing to draw down.
- Separate systems per origin (two Fires with two forges). Rejected: the bible
  gives one effect set per system and distinct places per origin.
- More systems, one per trope. The ten candidate systems were folded into seven by
  joining those that share a medium or a physical cause, never those that merely
  share a mood: Starfall into Fire, Gale into Pressure, Wellwater into Greenwood,
  Grave into Salt, Doors and Wild zones into Veil, Bound lines into Hallowed.
  Folding Gale gave up air as an independent medium.
- Rejecting a meeting whose parent system the world lacks. Rejected: it would
  break every custom system list; such a meeting validates and never holds.
- Winner-takes-all classification of a World cell. Rejected by the user:
  at that size a few percent of each class is real ground, and a meeting cannot
  displace part of a cell that has only one class.
- Interference as a surface-only class. Rejected: a class with no process is a
  cosmetic mark; geography is the result of processes.
- A separate epoch pass for society-phase systems. Rejected: the round already
  runs inside the epoch before coasts, burial and history, and the present's
  refresh already re-evaluates magic each cycle.

## Consequences

Each system's reach, rarity and signature are tuned in its preset and curated
controls (`packages/generation/src/magicCartography.ts`); documents describe
mechanisms and leave the values to code. Fields and couplings come first;
classes, names and drawing follow from them. A world with no human era has no
Hallowed and no forge, and its other systems are unchanged. The Salt detachment
effect on orogeny, mirages, detour routes, vow practice and door-keeper economies
are open work in the [backlog](../backlog.md).
