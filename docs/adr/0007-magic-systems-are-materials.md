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

**A system is a material.** Each system holds stocks in named reservoirs and
uses the world's own carriers: Ground, ice, rivers, groundwater, wind, animals,
ocean currents and people. Solid stocks belong to their actual Ground material;
erosion, burial, geological movement and extraction carry that association.
Fresh cover does not acquire the charge of an older bed of the same mineral.
Dissolved and living stocks retain their water and ecological carriers. Intensity
depends on the present stock and medium. Spent material can remain visible after
its magical activity ends. The [generation guide](../generation-workflows.md)
describes these shared ownership boundaries.

Births and renewal belong to elapsed operations; locating existing sources does
not repeat them. An origin that feeds on a record consumes it: Salt's
death origin uses up the mass-death record and its dead-lake origin the lake
memory, so Salt never re-makes itself from the same dead each epoch. Some
carriers are excluded by what the medium is: meltwater is Aurora's sink, not its
carrier; grazers avoid Salt, so Salt has no animal carrier; Pressure charge sits
in water, not crust; Veil carries nothing itself. Ordinary transport and wear
continue after supply ends, leaving spent Fire, displaced Salt beds and other
altered material available to later epochs.

**Origins on the schema.** A system holds several origins, each with its own
source, propagation, renewal and parameter overrides; a system's effects and
rules stay one set. Renewal names the mechanism (conduit-fed, accumulating,
continuous, finite, kept, emergent); no generic renewal engine. Only current
map and configuration formats are supported.

**Cells carry shares.** A class covers a fraction of a cell, derived from the
rule's own continuous quantity through a declared mapping, never from sub-cell
geometry. The drawn surface shows the class with the largest coverage and
hatches the next where it holds a declared share of the ground; places are
outlined at a declared fraction of their peak coverage, and society seats where
coverage passes a declared floor. Magic is
never netted on a shared scalar: Fire is not a warming term that cancels
Aurora's cold.

**Sources are sites; places are coherent.** Physical activity can remain below
the significance of a named site. A trace carried by a river or trade road need
not become a labelled core. A class component is published as a named place
when significant at the map's scale
([ADR 0005](0005-scale-contract.md)); below that the class stays on the map as
coverage, and only a domain large relative to the map's land is subdivided. Density
is lowered by locating sites and keeping places whole, never by thinning stocks
or intensities.

**Meetings are processes.** A confluence names the systems it reads, the
coverage floor each must reach, its own writes to the physical fields, its own
hazard and class. Its coverage is the smaller parent's scaled by the strain
between them, and it displaces the parents, so a meeting is never the mean of
what made it. Hallowed and Veil are the any-system meetings: warding scales
other systems inside a ring and displaces activity to a rim in its receiving
medium; without a valid receiver the activity stays at its source. Tearing
reads the strain of every pair plus the meetings' coverage, so a triple meeting
tears more than its pairs. Each connected patch of warding is one ring and pays
its own rim. Veil answers Fire's release at a cell, not Fire's presence, because a
Fire and Aurora front always has Fire under its tears.

**People are a source and practitioners.** The owner of people's layers writes
tenure, walked routes, kept lines and the dead onto the mesh as amounts the
crust carries. Deliberate custody of extracted grains
ends when ordinary geological transport returns them to their natural reservoir.
Current refresh updates dependent fields and doors without replaying supply or
history. Seats cease supplying protection when their people leave, while routes
and kept lines fade through elapsed time. Retained ground can outlast protection.
How a people's practice of a system acts on the land is decided in
[ADR 0012 (people live on the land's layers)](0012-people-live-on-the-lands-layers.md).

**Doors are edges.** Stable tears pair into doors; a door is an edge of kind
`door` between the surface cells under its ends, added when connections are
built and never when territories are assigned, unworn and never a highway, not
drawn as a way. Current stability and access govern pairing; closure removes the
travel edge.

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
- A separate epoch pass for society-phase systems. Rejected: people's loose pass
  already runs inside the epoch, and magic is evaluated again at the end of each
  human era.

## Consequences

Each system's reach, rarity and signature are tuned in its preset and curated
controls (`packages/generation/src/magicCartography.ts`); documents describe
mechanisms and leave the values to code. Fields and couplings come first;
classes, names and drawing follow from them. New social practices and presentation proposals remain
separate design work in the [backlog](../backlog.md).
