# 0011 — Processes couple through shared questions and ground operations

Extends [ADR 0010](0010-processes-and-materials-meet-through-modes.md).

## Context

Processes must act on a limited set of facts and extend without changing unrelated processes.
The owner's 2026-11-07 correction prioritizes clean code and understanding effects over contracts,
enforcement and metadata completeness. Scheduling prerequisites serve execution; declarations alone
do not establish what an algorithm actually did.

## Decision

- **Local composition.** A process owns its algorithm, plain settings and scale rule. Specialist
  helpers bind in its optional `prepare` function; the shared tools provide scratch storage.
  Feature operations reference executable steps directly. Those references supply both the
  selected runtime invocations and the native registry; there is no second list of step names to
  synchronize. Shared step groups also serve regional erosion. Settings modules join the profile
  without importing the running algorithms.
- **Shared questions.** Consumers ask keys such as `discharge`, `wetness` or `heat`.
  Responders register a base, additions and scales beside the system that supplies them.
  Adding a responder changes every consumer of that key without editing those consumers.
  Answers are read-only through the narrow process interface. Each narrow process or simultaneous
  substep resolves its declared questions before running; later groups see landed effects.
  Whole-field builders resolve questions where their algorithms ask them.
- **Ground operations.** Modes express how processes act on material facts. The ground reader
  walks the cell's stack, while the ledger keeps height, rock, soil and sediment consistent.
  A stage queues supported transfers and lands them through the ledger. Sequential demands
  use what remains; simultaneous demands share available material. Routed transfers retain their
  source and destination, so competition at one source changes only its outgoing routes. Loose
  removal cannot cut rock; surface removal resolves cover before rock. Soil is a skin of those
  substrates, not an additional supply pool. Unsupported transfers fail instead of silently
  taking another meaning.
- **Explicit execution.** Staged processes can run together. Immediate writers and solvers that
  settle during their own run execute separately. Whole-field builders adapt existing algorithms
  to the same sequence; they are not narrow-view processes. Their dependencies are not inferred
  from an incomplete source scan.
- **Transport by quantity kind.** Bands declare how plate transport carries them. The transport
  policy covers movement, new crust and rift blending; specific identity and return-pool rules
  handle their respective cases. It is not a general history-event dispatcher.
- **Actual observations.** Optional callbacks expose before-run, after-run and settled field
  states. A simultaneous settlement identifies its group, since individual effects compete.
  `explainAnswer` evaluates one cell's current base, additive and scaling contributions without
  changing the cached inputs used by a running group. The harness samples selected bands at a
  world coordinate, alongside captured answer values and explanations of current facts. World
  and regional execution share the observer adapter, without adding world validation to regional
  operations. Samples survive a failed run.

## Consequences

To add a process, implement its entry, add any plain settings to the profile and place its step in
the selected feature's operations. A step used in several places can live in `world/sequence.ts`.
Bind new specialist operations in that entry. A new shared influence registers a
responder and loads its module; existing consumers remain unchanged. A new material uses the
existing mode vocabulary unless a real process needs another mode.

Typed views support local reasoning, not runtime isolation. Helpers and builders can access the
whole field, and direct history writes may happen before settlement. Observation phases therefore
name execution boundaries rather than claiming every change is a deferred command.

The sequence still determines order. Required/provided bands select runnable steps but do not prove
that a previously written value is current. Numerical accuracy, exact replay and conservation
closure are not acceptance criteria; generated geography is judged on maps.
