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
  Composed quantities can depend on other answers. Surface-water supply combines rainfall,
  melt and spring return; routing applies maintained withdrawals and passage losses to available
  incoming water. Incision and lake budgets use that same composition. Providers state their own
  contributions; consumers do not maintain lists of water producers.
  Lake stages use routed effective catchment yield and their own evaporation/infiltration
  losses. They do not refund terrestrial rain losses after routing, which would bypass
  downstream withdrawals. This approximates precipitation over a newly submerged footprint.
- **Command–Query Separation and Incremental Computation.** Opaque executable operations replace
  optional callback shapes. Map steps, native steps and nested domain operations dispatch through
  the same interface. A selected query owns its derived dependencies; map-owned revisions memoize
  current reads, and completed commands invalidate them at operation boundaries. Dependencies
  accept queries only. Query evaluation cannot schedule a material
  command or infer elapsed work. Development receives explicit exposure, while elapsed evolution
  retains its duration binding. Physical forcing follows explicit epoch ancestry, not a human
  era's loop ordinal; an unbound present-day query uses neutral physical forcing.
  Routing, channel geometry and flood environment resolve through
  this boundary before ecological response. Query strategies are bound per map from the selected
  feature owners; a regional implementation can replace an algorithm without changing readers.
  This is coarse invalidation, not per-cell dependency tracking or a general workflow engine.
  Operation handles hide their callable implementations. Compiler-derived architecture checks
  discover registered callbacks and their callers, rejecting raw entry callbacks and direct calls
  across operation owners. Caller checks include diagnostic harnesses and tests across the workspace;
  supplied test doubles do not redefine ownership of production helpers.
  Internal algorithm helpers remain ordinary functions; the checks enforce
  executable boundaries rather than infer every helper's effects.
  Development and publication are separate operations: publishing cultures, polities or works
  cannot initialize or advance society. Ocean budget initialization and marine reconnection
  history likewise run explicitly, outside current shoreline queries.
  Coastal forcing resolves the current shoreline and currents before projecting its sources
  onto receiving land. Terrain changes invalidate that projection; an earlier shore target is
  not a persistent force. Coastal exposure history is recorded by the explicit epoch event.
  A query completes the output it owns. Atmosphere composes temperature, wind, transported
  moisture and precipitation before exposing their bands; consumers cannot cache an unfinished
  temperature. Delta fans, floodplains and routed channel geometry retain separate outputs.
  Classification combines those outputs without overwriting another owner's cached result.
  Feedback that needs an earlier pass remains explicit: runoff uses preceding river heat,
  while new heat transport follows the routes that runoff establishes.
- **Ground operations.** Modes express how processes act on material facts. The ground reader
  walks retained material, while owner operations keep placement, columns and projections together.
  A stage queues supported transfers and lands them through the ledger. Sequential demands
  use what remains; simultaneous demands share available material. Routed transfers retain their
  source and destination, so competition at one source changes only its outgoing routes. Loose
  removal cannot cut rock; surface removal resolves cover before rock. Material cargo retains its
  source composition and alteration through routing and landing. Rejected routed deposits remain cargo.
  Incision spends work widening into intact material before deepening the combined floor; the
  surviving intact column and valley fill remain distinct. Soil is a skin of those
  substrates, not an additional supply pool. Unsupported transfers fail instead of silently
  taking another meaning.
  Numeric demands cannot deposit existing land or sea cargo: those operations must carry actual
  material through the existing routing or deposition interface. Staged weathering retains its
  climate forcing; after removals and routed deposits settle, the owner evaluates each remaining
  substrate and its cover. A cut exposing another bed cannot reuse the removed bed's susceptibility.
- **Explicit execution.** Staged processes can run together. Immediate writers and solvers that
  settle during their own run execute separately. Whole-field builders adapt existing algorithms
  to the same sequence; they are not narrow-view processes. Their dependencies are not inferred
  from an incomplete source scan.
  Selected mountain construction, immediate slope failure and load response settle between plate
  movements. Ice mass balance advances once per epoch; later flow refreshes reuse that mass.
  Support reads retained grounded ice whenever it runs.
- **Transport by quantity kind.** Bands declare how plate transport carries them. Geological
  packages travel through the ground owner, keeping their columns, alteration, fabric and seam
  identity together; generic scalar transport does not average these facts independently. The transport
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

Typed views support local reasoning, not a hostile-runtime sandbox. Helpers and builders can read
the whole field, while ground writes require owning operations. External forcing and ecological
state retain their existing writers. Immediate operations and direct process-history writes can
still occur during execution, so observation phases name execution boundaries rather than claiming
every change is a deferred command. Material formation and alteration remain attached to the
accepted material operation.

The sequence still determines command order. Required/provided bands select runnable steps;
current derived dependencies are executable queries rather than claims of freshness inferred from
those declarations. Numerical accuracy, exact replay and conservation
closure are not acceptance criteria; generated geography is judged on maps.
