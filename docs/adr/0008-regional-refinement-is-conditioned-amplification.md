# 0008 — Regional refinement is a bidirectional, multi-pass process

User direction recorded 2026-10-29 to 2026-11-01; adopted 2026-11-01 from the regional
refinement specification. Applies to independent regional maps under
[ADR 0005](0005-scale-contract.md) and the dedicated regional refinement correction in the
[product contract](../product-spec.md). It replaces the 2026-10-31 decision recorded under
this number: a smoothed parent surface plus noise, relaxed toward that surface, is no longer
the organizing strategy, and no later work should restore it.

## Decision

**World generation establishes macro character; the child develops from it.** Besides the
present fields, the world publishes the structural grain of constructed relief
(`structuralGrainX/Y`: the orogenic strike as a doubled-angle axis times its coherence,
recorded where construction happened and carried with the crust). The child reads it with the
captured strain, glacial erosion and volcanic construction into a character record. A map
captured before the grain existed infers its grain from the orientation of its captured
relief. Classifications bias mechanisms; none selects a finished landscape.

**Shared media are natural copies plus tracked contributions.** The captured present media
are copied once. A process that changes a medium declares the total it wants and a ledger
writes the difference from what it applied before, so re-evaluating a round updates an
influence and never adds it again. Elevation is the one medium the processes also evolve
directly; a contribution to it is applied once and then develops with the rest.

**The network comes first; relief is derived from it.** The drainage network is a geodesic
tree over the land, grown once in round one from the established waters: land beside the
connected sea, the open frame edges (an exit starting with the fall it still has to the sea,
so the lowest exits gather the largest catchments), captured lakes at their level and the
floor of each closed basin the parent holds. It descends a cost field in which every
organizing term is a process term: flowing uphill on the captured base costs; steps across
the structural grain cost more than steps along it; material bands integrated along the
grain's streamlines, hard rock, open fractures and warded ground set the resistance;
captured courses and the parent's channel raster are cheap corridors; the ground around a
known summit or volcanic cone is dear, so channels run around it and it stands on a divide;
a river seat's ground is cheap, so a channel comes to it. Water that has gathered makes its
channel cheaper and the country is routed again through it, which is how tributaries join
trunks. Heterogeneity of the ground decides only between routes those terms leave equal,
strongly on plains where nothing else steers the water and weakly on slopes. Nothing random
is drawn as geography.

Relief is a pure function of the network and the present media, re-derived each round from
the same tree. Every cell rises above its receiver: along a channel by the concave profile
of its discharge through its material, on a hillslope by the material's gradient softened by
glacial reworking and living cover, and in no case above the gradient a seat's footprint
holds. The increments are amplified so that the relief blurred to the parent sample span is
the captured base: the parent sets the macro character and the network decides where within
it summits, cols, valleys and low ground lie. Hillslopes are coupled sideways so paths that
drain to different channels meet in a rounded interfluve. Glaciation is then a process on
that surface: snow accumulates where the lapsed climate and the recorded history allow, ice
flows down the network melting as it descends, hollows a cirque behind a lip where it first
gathers, deepens and widens a trough where it runs full and leaves a moraine where it ends;
tarns and ribbon lakes follow from those shapes and the water supply. Volcanic cones add
their construction. Drainage, climate and the living landscape re-derive each round from
the present surface and the natural copies; the developed cover softens the next round's
hillslopes; magic's hardening, cracking, heat and held ice enter the next derivation through
the ledger. Each magic system resolves its captured materials once and derives its field
each round from those materials and the present medium through its own carrier, without
added texture; a captured ward does not spread again, only located sources do; wards
displace other fields to their rims and resist cutting inside; brine crusts in captured
closed basins; tears form from strain; effects, coasts, relief and meetings go through the
ledger.

**The derived relief is then worked by the processes that act on real ground.** Where the
network leaves divides, the crests between neighbouring catchments carry a crest term so
ridgelines branch like an inverted river rather than standing as isolated knobs; hillslopes
above their angle of repose shed material downslope and the sediment is carried along the
network, settling along the captured base gradient, dropping where a channel enters a lake and
leaving its load at the shore roots. Drainage loses water to the ground along its length, so
a channel's discharge is what the country between its head and the reach supplies plus the
captured inflow that enters across the frame edge; valley
floors are read as the flat ground a channel can reach from its own cells. The coast is
developed on the derived surface: exposure is read from the fetch each shore cell faces and
spreads a short way inland, exposed shores are cut back and sheltered shallows filled, and
rivers meet the sea as deltas or estuaries according to their load and the shore's exposure.
Ice is routed over the surface the relief gives it, thinning as it descends and melting where
the lapsed climate does not hold it; what it removes is booked once as glacial erosion and
what it releases enters the runoff as meltwater. Climate re-derives each round from the
captured copies on the developed relief: temperature by lapse, aspect and cold pooling where
a gentle floor lies below the surface around it, snow re-split from precipitation by the
world's own seasonality rule, wind deflected by the relief it meets through the world's
terrain rule, runoff changed by the present cover against the captured cover (cleared ground
sheds more, grown ground holds more) and increased by the meltwater. The ground's soil develops under the
living landscape once the ecology has begun and is not re-written by the climate after that.

**The living landscape is the world's own engine, hosted on the regional field.** The world
ecology engine is prepared once from the captured state in the context step, its history
memory reset to the first derived geography, and then
responds each round over a short span of horizons, forced by the regional climate, the
magic systems' living effects and the fire causes the country holds; its soil water is capped
by the soil's own capacity after the soils have evolved and its history is remembered between
rounds, so the second round develops what the first grew and does not restart it.

**Magic writes the ground through the ledger, from captured materials.** Each system is
prepared once from the captured sources and intensities, with the parent's doors kept as
established evidence and the captured intensity held along the frame edge where the parent's
country continues. Each round the systems are evaluated against the present media in the
lore's order, their meetings read the covered classes, and their ground effects are declared
as this evaluation's totals: hardened rock as the change from the captured intensity,
confluence soils against the natural soil, the hallowed spill, the Veil's wild relief, door
chill and pools, and salt's glass and desiccation against the natural ground. Three writes
are floors on their own bands rather than ledger totals: toxicity is reset from the captured
band and raised to the meetings' maximum, ice held by charge is written to the persistence
the ice budget reads above its relict floor, and the door rings' grass and saplings are held
as floors. The applied heat is the forcing the rivers carry
downstream. Nothing accumulates: a round re-derives from the captured materials and the
present medium, and the ledger's replace rule turns a re-evaluation into an update.

**Society develops at depth from the places the country holds.** Each settled place takes
its fields and pasture from its hinterland, ranked by farming suitability and travel decay,
and declares their clearance on the tree cohorts each round as the difference to the cleared
target, so the engine grows on cleared ground and the fields stay cleared without ratcheting;
an abandoned seat clears nothing. At extraction every settled place sends its residents to
the market seat and a smaller share to its nearest larger neighbour; the flows are traced
over the present surface with captured roads as worn ground and door ends as free edges, in
repeated passes over the ground the previous pass wore, so later ways bend into earlier
ones, and each way is published at the class its own flow earns. A way that crosses a channel fords it: the crossing is read geometrically against the
drainage tree's links (the tree joins channel cells a knight's step apart, so a path can
cross a channel without touching one of its cells), a road over a sizeable river crosses by
a bridge, a settled place with a falling channel within reach turns a mill, and every
settlement inside a captured control polygon carries that control.

**Established features are terms in the processes, not shapes stamped on the result.** An
inherited summit is a divide node the channels route around; it keeps its identity and
moves to the realized summit of its massif. A captured river's course is a corridor the
network follows, it brings its discharge across the frame edge, no headwater is fabricated
inside the frame for it, and the developed stem that follows it carries its name, place
identity and the course itself as evidence for the next refinement. A captured lake is a
base level its tributaries rise from. A known settlement's footprint caps the hillslope
relief around it, so a valley floor widens, a shoulder flattens or a col stays low in the
form the network gives that ground; a river seat draws its channel; a seat whose ground is
still unusable moves to the best usable ground within reach that keeps its situation, and
its footprint follows. New villages are proposed once at the network's own events
(junctions, mouths, fords, cols, bays, springs, magical sites), compete for hinterland over
the travel cost of the present surface, and are supported in the last round or dropped.
Seats and summits are re-sited from their captured positions on every refinement, and this
map's own products are regenerated from the same evidence, so repeating a refinement
reproduces it.

**Three rounds, one refresh, one extraction.** Round one establishes broad organization,
round two the coupled responses and the proposal of local places, round three the local
consequences and their support. The order inside a round is fixed: relief and support, water
and access, climate and magic on the shared media, the living landscape and places. One
declared follow-up reroutes water inside a round when magic moved relief by a resolvable
amount. The refresh updates derived reads; extraction (summits above a scale-dependent
prominence, cols, ranges, water geometry, habitats, magic classes and doors, places and ways)
runs once, outside the loop.

**Descendants read their parent.** The child publishes its developed grain through the same
captured-channel contract, so a grandchild develops from the child's organization.

## Alternatives

- Keep the amplification pipeline and tune it. Rejected by the user: a restored surface plus
  noise cannot raise summits above the parent mean or let known places shape their ground.
- Run the old stages three times. Rejected: they mutated shared channels in place and would
  ratchet; the ledger and the prepare/respond split are what make a second pass an update.
- Noise-modulated uplift under a stream-power solver, with inherited features as kernels
  (a summit bump, a course trough, a settlement disc). Built first and rejected by the user
  on 2026-11-01: the organization was a noise layer selecting predetermined forms, and
  features influenced little beyond the three examples given. The network-first derivation
  replaced it.
- A universal geographic-object framework or constraint solver. Rejected by the
  specification: typed working structures and ordinary composition suffice.

## Consequences

Ranges develop separate massifs, strike ridges and cols because divides are where the
network leaves them; tarns appear where ice gathered and nowhere else; established rivers
keep their names, bring their discharge and gain feeding geography; towns on unusable flanks
acquire a visible bench or valley floor; fields clear the woods around the places that farm
them and ways ford the rivers they cross where they cross them. A refinement costs one
network growth with its capture passes, three relief derivations with their calibration blurs,
mass wasting, sediment and coast development, and three rounds of drainage, climate, magic,
the ecology engine's response and the fields' clearance; site classes are read when places
are proposed, and the ways once at extraction. The implementation lives in `packages/generation/src/regional`; parameter
values stay in that code and this record names the mechanisms only.
