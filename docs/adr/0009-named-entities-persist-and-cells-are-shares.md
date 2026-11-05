# 0009 — Named entities persist; a coarse cell's value is a share of its children

User direction recorded 2026-11-05. Refines refinement in
[ADR 0005](0005-scale-contract.md) and
[ADR 0008](0008-regional-refinement-is-conditioned-amplification.md).

## Decision

**A named entity is not removed, and it is not fixed.** A named entity on a coarser map
continues on every finer map. Refinement may change its size, its shape and where it stands.
It may not take the entity away, and it may not force the ground to match the entity's old
position or extent.

Two things follow:

- Generation has no pass that removes a named entity because it cannot be handled. An entity
  ends only as an event in the world's history.
- The rule protects the entity's identity. It does not protect its old cells. Nothing is
  pinned, seeded or held in place on finer ground to keep an entity where it was.

**A coarse cell's value describes its children as a population.** A coarse cell that is 50%
forest means that about half of its child cells are forest. It does not mean that every child
cell is 50% forest. Rain coverage works the same way: a coarse share of rain falling on a cell
means that share of the ground below it is rained on.

Refinement therefore distributes a coarse share among the children, according to their own
ground, so that the children together come to about the parent's value. Averaging a share into
every child, or copying it to every child, is wrong.

## Consequences

- A forest named on the World continues on a region as that forest. It may be smaller, larger
  or elsewhere than its coarse outline, wherever the distributed forest cells actually fall.
- A coarse outline is evidence of where and how much, not a boundary the finer map must keep.
- Every process that refines a share (cover, rain, magic and any later one) distributes it, and
  a check of a refined share compares the children's total with the parent, not one child with
  the parent.

## Alternatives

- **Hold a coarse entity's cells on finer ground.** Rejected by the user: it makes local ground
  contradict itself to keep an outline that was only ever approximate.
- **Remove what finer ground does not support.** Rejected by the user: a name on the World is a
  major geographic or cultural landmark.
