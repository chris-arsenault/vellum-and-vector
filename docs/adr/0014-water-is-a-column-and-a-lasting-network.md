# 0014 — Water is a column on every cell and a network that lasts

Owner direction of 2026-11-12: water gets the same intentional paradigms and columnar state as
ground ([ADR 0010](0010-processes-and-materials-meet-through-modes.md),
[ADR 0011](0011-processes-couple-through-keys-and-a-ledger.md)) and people
([ADR 0012](0012-people-live-on-the-lands-layers.md)). The code is the authority; the line that
carries the direction is marked in `packages/generation/src/water/water.architecture.ts`. The
structure below is agent-derived and follows the method in
[Materials and processes](../../MATERIALS-AND-PROCESSES-ARCHITECTURE.md).

## Context

Water grew as separate layers, each written by the step that computed it: rain and snow, a
yearly runoff, groundwater, lakes, flow, river order. Several layers had more than one writer.
Water left the model unrecorded where a lake seeped, snow never melted, a bed leaked or
groundwater reached the sea. The river network was redrawn from the surface in every pass and
a river became a thing only when it was published, so nothing could carry a course, a bed or a
regime from one epoch to the next, and an abandoned channel had nowhere to exist. Every map
therefore showed a river in every basin, flowing all year, never shrinking and never moving.

Two axes grow independently: the places water is held, and the ways it moves. Rules that
depend on both belonged to neither file.

## Decision

- **One owner.** Everything that makes, moves, stores or loses water lives in the water
  namespace and writes water state through it. Everything else asks.
- **A water column on every cell.** Snow, soil water, groundwater and standing water are one
  package: carried with the crust, inherited by a finer map as shares, never split band by
  band. A cell's year of water is part of that state, held month by month on the map.
- **A network that lasts.** River reaches have identity, a course, a flow through
  the year and a regime, and they persist across passes. Processes change the network; they do
  not redraw it. What a reach was before it moved or dried stays on its record. A cell holds
  quantities of water and is never itself a river; a reach exists by a size declared against
  the map ([ADR 0005](0005-scale-contract.md)).
- **Transfers between stores.** A water process is a move between two named stores: fall,
  melt, evaporate, soak, seep, spring, run, fill and spill. Each store states what it holds,
  what room it has and how readily it gives. The water ledger records the processes'
  exchanges, including incoming water and losses to the air and sea.
- **The year's rhythm, not elapsed time.** A pass works out each cell's typical year in twelve
  months and rivers gather those months. The months describe the climate within the span a
  pass stands for; no clock advances. Rain falls in the months the rain belts stand over a
  cell, and the air's demand follows each month's warmth and day length; the climate states
  that demand once, and water, lakes and plants all read it.
- **Ice and heat make no water.** Ice gives back the snow it was fed. What melts ice from
  outside the climate decides where that water comes out, not how much there is. Ground lost
  or gained over the ages a pass stands for is never a year's water.
- **Couplings by question.** Plants, people, erosion and magic ask water how wet the ground
  is, what flows and when. What changes water answers a question at a named point: the air's
  demand, what the ground takes, what a bed leaks, what people draw.
- **A river is an outcome.** A river is water gathered from a catchment the map resolves, in
  an amount significant at the map's scale. A cell that sheds much water of its own is wet
  ground, not a river. The sizes are declared against the map and are the same on every map.

## Consequences

These follow from the decision.

- One routing replaces the separate gatherings for rivers, lakes, erosion and regions; one
  closed-basin balance replaces three tests; one soil-water store serves water and plants.
- A finer map inherits the columns as a package and the reaches that cross its frame as
  things, with what they carry in each month.
- Sediment that builds fans, plains and deltas, courses that break out, and old beds that stay
  dry are built on the lasting network; they are not possible without it.
- A place changes water only by asking: the contributions ledger refuses every water band.

## Implemented ownership

The physical field owns a water column of stores and its retained reach store. An explicit
budget command establishes the monthly supply and ending contents together. Current runoff
reads reduce that established supply; they neither spend the ending stores again nor
reconstruct the transferred year from them. Supplied contents start the returned year's
transfers; seasonal warmup applies to unspecified initial contents. Soil that loses room
releases its excess through the budget. Water resources publish and import both the column
and its established year. Ground transport carries them and the reaches, including abandoned
courses.

Conditioning reads the current Ground valley floor under land and lakes, including
unresolved channels, independently of the cell's averaged terrain height. Routing and erosion keep viable
existing courses. Explicit development changes retained courses, history and river membership.
Current queries update their flow and bed profiles without another network transition, then
produce river rasters. Bed leakage, channel dimensions, floodplain
seeds and published profiles read the owned courses; leakage asks the actual bed facet.
Unresolved water and small-channel
length remain cell quantities. Presence and seasonal status read each point's monthly
profile, so a losing river may have a wet head and a dry end.

Explicit local saves retain courses, monthly profiles, physical beds, names and former
courses. Refinement clips captured river objects onto the child's lattice and imports their
actual boundary water and catchment. Published-map input with only a mean supplies that
mean throughout the year; it does not invent seasons from the receiving cell. Named dry
and abandoned courses publish under their river's name through the ordinary network contract.
An established river-side town retains its stream through the water owner, without adding
water. A dry course keeps its retained confluence rather than following new routing.
Water establishes identity and membership before publication. Current flow cannot regroup
an established river. Cartography joins that owned graph through read-only reach views;
publication and final naming associate record names through the water owner.
Curves, junction cuts, river landmarks and riverborne material follow the retained graph.
Terrain drainage remains a separate cell quantity graph. Terminal courses may project into
adjacent standing water through the shared water owner.
Captured confluence edges remain distinct from owned profile samples. Scoped import follows
those actual edges with the tributary's outgoing supply, retains isolated owned points, and
imports former-only paths as dry history without a present downstream relationship.

## What stays out

Storms shorter than a month beyond a share that runs off at once, water depth and velocity as
dynamics, two-dimensional flooding, tides, and water chemistry other than salt left in closed
basins.
