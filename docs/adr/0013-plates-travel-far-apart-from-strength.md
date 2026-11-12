# 0013 — Plates travel far, apart from tectonic strength

Owner directions of 2026-11-06 and 2026-11-07, restated 2026-11-12 after they were lost twice.
The code is the authority; the lines that carry these directions are marked `owner-direction`
and listed in `packages/generation/src/ownerDirections.architecture.ts`
([whose direction the code carries](../../AGENTS.md#whose-direction-the-code-carries)). The
first three points of the decision are the owner's; the fourth, and the mechanism of a
per-epoch share, are agent-derived.

## Context

Epochs exist to mix the world. Crust has to travel far enough for a continent's interior to be
former sea floor, for oceans to close, and for old plate edges to end up inside the land with
new edges around it. The reference design moved plates by a share of the world's size, about
half a continent in the first step and sharply less in each later one, and kept that fall
deliberately separate from how strongly each epoch builds.

The port lost this three ways, and later changes lost it again:

- A share of world size became a fixed distance of a few cells, so continents never met.
- Travel was multiplied by the epoch's tectonic strength, so a weaker epoch also stood still
  and a setting meant for relief changed where continents went.
- A later default chose a short-travel motion setting and wrote its own tectonic strengths
  over the epochs, and the generation guide was edited to describe the coupling as intended.

Each loss produced the same map: static continents and low plains.

## Decision

- **Travel is far.** Under default settings plates cross a large part of the map in the first
  epoch and less in each later epoch. Travel that amounts to a few cells is a defect, not a
  quieter style. A shorter-travel world is a deliberate choice in setup, never the default.
- **Travel is a share of the map.** Plate speed is declared against the map's span, so worlds
  of different sizes move their plates alike.
- **Travel and tectonic strength are separate figures.** Each epoch states its share of full
  travel as its own value. Tectonic strength scales what a collision builds and never how far
  plates move. No control, default or process derives one from the other, and a control that
  sets travel leaves every epoch's strength alone.
- **The fall in travel is the epoch's own data.** An epoch is a repeated pass and does not act
  by its position in the list; later epochs travel less because each states a smaller share.

## Consequences

- Longer travel depends on plates behaving when they meet: ocean sinks and is renewed,
  continents lock and weld, welded plates tear along old seams and gain new edges. Shortening
  travel to hide a fault in those is not a fix.
- The default terrain, continent and shoreline choices are the varied ones (ranges among
  plains, several continents, indented coasts). Tamer choices remain available.
- Tests state the separation: plate travel is the same at any tectonic strength, and the motion
  control changes no epoch's strength.
