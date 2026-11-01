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
acquire a visible bench or valley floor. A refinement costs one network growth with its
capture passes, three relief derivations with their calibration blurs, and three rounds of
drainage, climate, magic and cover; site classes are read once. The implementation lives in
`packages/generation/src/regional`; parameter values stay in that code and this record names
the mechanisms only.
