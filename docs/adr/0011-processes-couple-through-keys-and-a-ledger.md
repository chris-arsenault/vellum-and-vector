# 0011 — Land-shaping processes couple through declared keys, quantities and one ledger

User direction recorded 2026-11-07. Extends [ADR 0010](0010-processes-and-materials-meet-through-modes.md).
Its method is section 2 of [the materials and processes analysis](../../MATERIALS-AND-PROCESSES-ARCHITECTURE.md).

## Context

Most of the processes that shape land existed but did not act together. Rivers ignored rain, coasts barely
touched the shore, and old ground never wore down, because each process read what its author remembered and
per-pass caps hid the missing links. Bands moved with the crust only if someone added them to a list. The
requirement was structural: processes must interact and extend without anyone remembering to update them.

Options were judged against what this task needs: a hookup cannot be silently missing; hot loops over large
meshes on typed arrays with no allocation per cell; explicit order, because order here is physics; wrapping
existing bodies, with no rewrite and no new storage.

## Decision

- **One contract.** Everything that shapes land is a `GroundProcess` entry declaring what it reads, asks and
  moves. The declarations generate the coupling table. Wear processes get a view typed to what they declared, so an
  undeclared read does not compile. Builders with long-lived bodies hold the field directly and declare their
  main inputs and what they move.
- **Keys for reads.** A process asks a question by key, such as `runoff` or `warmth`, and never learns who
  answered. Responders register a base answer, additions and scales, so climate, wetlands or a magic system's own
  medium can shape an answer with no process edited. An answer resolves once into a band and holds until the world
  moves.
- **Stock-and-flow for writes.** Material moves between named pools through one ledger, which keeps height, column
  and sediment together and records who moved what, naming each mover as the process it is. Wear lands through a stage,
  so a process works from the ground as it stood and nothing wears below base level however much is asked for.
- **Table-driven quantity kinds.** Every band declares a kind, and the kind decides what a plate move does to it. A band
  with no kind fails a test.
- **Double dispatch stays at the ground only.** Process and layer both really vary there, as ADR 0010 set out.
- **Rates per span, no caps.** A pass carries a span. Iterations are resolution, not amount. Limits come from supply,
  capacity or stepping. Caps exist only for numerical reasons: the height and crust limits and the rock column's layers.
- **Epochs are data.** Strength, travel, span and forcing differ by epoch, and no process knows which it is in.

Numerical accuracy and reproducibility are not goals. Nothing checks that output stays the same or that totals close.

## Alternatives

- **Visitor over quantities.** Events are few and fixed, so kinds answer by data with no visitor.
- **Every stage simultaneous.** Steps stay sequential by default, keeping order explicit.
- **Automatic scheduling.** Order is physics; declarations describe it and do not decide it.
- **Bond graphs.** Rigorous for energy coupling, but this models no energy, and every process would be re-derived.
- **Petri nets as an engine.** Discrete firing does not fit fields of continuous amounts.
- **Actors, rule engines, Datalog.** They solve concurrency or sparse facts, and cost too much per cell.
- **Algebraic effects.** A good fit with no TypeScript support; passing capabilities gives the part needed.
- **Entity storage.** Bands already exist, as ADR 0010 found.

## Consequences

A new responder edits no process, and a new forcing is a key plus the processes that ask it. A new band moves with the
crust once it has a kind. Removing caps changed the map throughout, and rates are judged by what becomes of old ground
on the map. A process on its declared view cannot compile a read or write it did not declare, and reaches the rest of
the world only through its tools. A builder holds the whole field, and what it reaches is worked out from the program
and held to in the architecture check. A step needs a band only if a selected step wrote it earlier; no validity is
derived from a write, and the order of the sequence is what keeps a band right. A cell's stack through `Ground` runs
cover, loose material and rock; the crust beneath is a stock the ledger draws on when wear passes what is piled on it,
and soil stays ecology's depth rather than a layer.
