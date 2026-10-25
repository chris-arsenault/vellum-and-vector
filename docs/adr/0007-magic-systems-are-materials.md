# 0007 — Magic systems are materials the world carries

User direction recorded 2026-10-24 and 2026-10-25; adopted 2026-10-25 with the
seven magic systems plan. Applies to every magic system in generation. Refines
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
settle), currents, animals (sap in the gut of grazing herds) and people (trade
ledgers along the ways). Intensity is derived from stock and medium at
evaluation, and a budget of created, carried, stored, released and lost closes
per system. Sinks are physical: flushing to the sea, burning, extraction.

**Origins on the schema.** A system holds several origins, each with its own
source, propagation, renewal and parameter overrides; a system's effects and
rules stay one set. Renewal names the mechanism (conduit-fed, accumulating,
continuous, finite, kept, emergent); no generic renewal engine. A system saved
before origins existed is parsed into one origin.

**Cells carry shares.** A class covers a fraction of a cell, derived from the
rule's own continuous quantity through a declared mapping, never from sub-cell
geometry. The drawn surface shows the class with the largest coverage and
hatches the next where it holds a fifth of the ground; places are outlined at
half their peak coverage; society seats where coverage passes a tenth. Magic is
never netted on a shared scalar: Fire is not a warming term that cancels
Aurora's cold.

**Meetings are processes.** A confluence names the systems it reads, the
coverage floor each must reach, its own writes to the physical fields, its own
hazard and class. Its coverage is the smaller parent's scaled by the strain
between them, and it displaces the parents, so a meeting is never the mean of
what made it. Hallowed and Veil are the any-system meetings: warding scales
every other system inside a ring and lays what it removed on the rim; tearing
reads the strain of every pair plus the meetings' coverage, so a triple meeting
tears more than its pairs.

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
- Winner-takes-all classification of a 50 to 200 km² cell. Rejected by the user:
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
mechanisms and leave the values to code. Every milestone of the plan was
accepted on fields and couplings; classes, names and drawing trail. A world with
no human era has no Hallowed and no forge, and its other systems are unchanged.
The Salt detachment effect on orogeny is deferred (backlog item 16); mirages,
detour routes, vow practice and door-keeper economies remain reads with no field
behind them. The frontend's whole unit suite, which runs real draft worlds, is
the integration gate for every change to these systems.
