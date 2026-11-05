# 0009 — Refinement resolves named entities; it does not review them

User direction recorded 2026-11-05. Refines [ADR 0005](0005-scale-contract.md) and
[ADR 0008](0008-regional-refinement-is-conditioned-amplification.md).

## Context

Maps at different scales are views of one world. Looking closer cannot make something stop
existing. Generation treated a coarse place as a claim the finer map could fail to confirm: it
searched near the old position, and what it did not find was removed or left where it was. Either
result makes the maps disagree about what exists, or leaves a map wrong about where a thing is.

## Decision

A coarse record of a named entity makes two claims of different strength. That the entity exists
is firm. Where it stands and how large it is are an estimate at the coarse map's resolution, and
the finer map has the better answer.

Refinement therefore answers only where and how big. It can add detail going down and it never
subtracts a named entity. Moving and resizing are expected. A fact stays a fact across passes on
one map as well as across maps.

A coarse value describes the area beneath it. A cell that is 50% forest means about half its
children are forest, not that each child is 50% forest. A biome's outline draws around a
generalized area and fills in the divergences. Other ground inside a coarse outline contradicts
nothing, so nothing is held on finer ground to keep to it.

The rule covers what has become a named fact. Unnamed streams and cell values come and go freely.

## Consequences

- Failure to find a named entity on a finer map is a generator bug. A child is built from its
  parent's fields, so either it was not built properly from them or a test looks for the entity
  wrongly. The cause is traced and fixed. Generation does not handle the failure, and it does not
  paint the entity onto ground that does not support it.
- Significance decides whether something is named the first time. A carried entity is not judged
  by it again.
- A place left at a position that is now wrong has not survived. It is an unresolved failure, even
  though its record remains.
- Two named entities do not collapse into one.
- An entity's own effect on the ground stands: a fall holds its step and a peak shapes its rock.
- History can end an entity as an event in the world's story. Generation cannot end one for its own
  convenience.
- Lying outside a finer map's frame is not removal. The entity stays on the parent.
- Across-map rules must always return an answer. A rule that can report absence, such as a search
  that can come back empty or an outcome that drops the place, has the wrong shape.

## Status of the code

The POI contract's `unrealized` outcomes and empty counterpart searches predate this decision. POI
entry files carry a `@needsResolution` header until their kinds resolve in this way.
