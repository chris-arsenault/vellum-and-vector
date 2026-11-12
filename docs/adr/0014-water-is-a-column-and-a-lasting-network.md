# 0014 — Water is a column on every cell and a network that lasts

Owner direction of 2026-11-12: water gets the same intentional paradigms and columnar state as
ground ([ADR 0010](0010-processes-and-materials-meet-through-modes.md),
[ADR 0011](0011-processes-couple-through-keys-and-a-ledger.md)) and people
([ADR 0012](0012-people-live-on-the-lands-layers.md)). The code is the authority; the line that
carries the direction is marked in `packages/generation/src/water/water.architecture.ts`. The
structure below is agent-derived and follows the method in
[Materials and processes](../../MATERIALS-AND-PROCESSES-ARCHITECTURE.md).

Status: in progress. One owner, the ledger of transfers, the year's rhythm and the single
soil-water store are in the code. The lasting network, one routing for every gathering, and
inheritance of reaches by a finer map are not yet.

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
- **A network that lasts.** Reaches, lakes and outlets have identity, a course, a flow through
  the year and a regime, and they persist across passes. Processes change the network; they do
  not redraw it. What a reach was before it moved or dried stays on the ground.
- **Transfers between stores.** A water process is a move between two named stores: fall,
  melt, evaporate, soak, seep, spring, run, fill and spill. Each store states what it holds,
  what room it has and how readily it gives. Every transfer is recorded, with the air and the
  sea as stores, so nothing is made or lost unrecorded.
- **The year's rhythm, not elapsed time.** A pass works out each cell's typical year in twelve
  months and rivers gather those months. The months describe the climate within the span a
  pass stands for; no clock advances.
- **Couplings by question.** Plants, people, erosion and magic ask water how wet the ground
  is, what flows and when. What changes water answers a question at a named point: the air's
  demand, what the ground takes, what a bed leaks, what people draw.
- **A river is an outcome.** A cell carries a river when a river's flow reaches it, judged on
  what reaches it and on nothing else. How much flow makes a river is a statement about what a
  map of that cell size can show, and is the same on every map.

## Consequences

- One routing replaces the separate gatherings for rivers, lakes, erosion and regions; one
  closed-basin balance replaces three tests; one soil-water store serves water and plants.
- A finer map inherits the columns as a package and the reaches that cross its frame as
  things, with what they carry in each month.
- Sediment that builds fans, plains and deltas, courses that break out, and old beds that stay
  dry are built on the lasting network; they are not possible without it.

## What stays out

Storms shorter than a month beyond a share that runs off at once, water depth and velocity as
dynamics, two-dimensional flooding, tides, and water chemistry other than salt left in closed
basins.
