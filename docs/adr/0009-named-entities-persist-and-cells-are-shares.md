# 0009 — Named entities persist; a coarse cell's value is a share of its children

User direction recorded 2026-11-05. Refines refinement in
[ADR 0005](0005-scale-contract.md) and
[ADR 0008](0008-regional-refinement-is-conditioned-amplification.md). It states what these terms
already meant; it does not change how cell values or an entity's own effects work.

## Decision

**A named entity is not removed.** A named entity on a coarser map continues on every finer map,
and refinement may change its size, shape and where it stands. A name on the World is a major
geographic or cultural landmark, so it does not disappear because generation cannot place it.

**A coarse value describes the area beneath it, not each child.** A coarse cell that is 50% forest
means that about half of its child cells are forest. It does not mean that every child cell is
50% forest. Rain coverage works the same way.

**A biome is a line drawn around a generalized area.** A biome's outline contains cells of other
kinds, because it draws around the area and fills in the divergences. It is reflective of an area
that is some reasonable percent of that biome, so a finer map finding other ground inside a
coarse biome's outline is expected and is not a contradiction of it.

## Consequences

- A forest named on the World continues on a region as that forest, at the size and place the
  region's own forest takes.
- What a place does to the ground as its own effect stands as its entry defines it: a fall holds
  its step, and a peak shapes the rock around it.
