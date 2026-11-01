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

**Processes are prepared once and respond each round.** Terrain is uplift intent against
stream-power incision and hillslope creep: intent follows the captured height of strained
ground and its local relief, is organized along the grain into separate massifs and across it
into material bands of varying spacing, rises around inherited summits and volcanic cones,
and is lowered along captured river courses; erodibility reads the present rock, fractures,
living cover, bands and a fine substrate heterogeneity. A long-wavelength anchor keeps the
captured broad character while summits rise above it and valleys cut below. Where ice
reworked high ground, headwater bowls are excavated once behind rock rims that hold; whether
each holds a tarn follows its water supply. Drainage, climate and the living landscape
re-derive each round from the present surface and the natural copies, and the developed
cover binds the next round's hillslopes and runoff. Each magic system resolves its captured
materials once (deposits, drained charge, leached strata, weathered and burnt beds, located
sources) and derives its field each round from those materials and the present medium
through its own carrier; a captured ward does not spread again, only located sources do;
wards displace other fields to their rims, tears form from strain, and effects, coasts,
relief and meetings go through the ledger.

**Established features are evidence, not frozen geometry.** An inherited summit moves to the
realized summit of its massif and keeps its identity. A captured river's course gathers the
developed drainage, the stem that follows it carries the river's name and place identity,
and a river entering across the frame keeps its edge source and discharge. A known
settlement takes a nearby usable site consistent with its broad situation or, where none
exists, a bounded terrace with an access ramp shaped into the terrain. New villages are
proposed once from the sites the developed terrain offers, with hinterlands by site class and
water access, and are supported in the last round or dropped. Seats and summits are re-sited
from their captured positions on every refinement, so repeating a refinement reproduces it.

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
- A universal geographic-object framework or constraint solver. Rejected by the
  specification: typed working structures and ordinary composition suffice.

## Consequences

Ranges develop separate massifs, strike ridges and cols instead of one dome with gullies;
tarns appear where ice reworked high ground and nowhere else; established rivers keep their
names and gain feeding geography; towns on unusable flanks acquire a visible local site. The
schedule costs three rounds of drainage, climate, magic and cover with one terrain relaxation
spread across them; site classes are read once. The implementation lives in
`packages/generation/src/regional`; parameter values stay in that code and this record names
the mechanisms only.
