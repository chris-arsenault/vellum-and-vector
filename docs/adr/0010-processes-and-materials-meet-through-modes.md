# 0010 — Processes and materials meet through modes, down a cell's stack

User direction recorded 2026-11-06. Follows the shape the POI catalogue set.
[The analysis](../../MATERIALS-AND-PROCESSES-ARCHITECTURE.md) holds the reasoning and the method.

## Context

Materials and processes both grow, and how a process affects a material depends on both, so it fits in
neither. When the rule lived in each process, more than a dozen formulas turned one resistance number into
a hardness with their own bounds, and world and region defined the ground differently. Moving the rules into
the catalogue made it name every process in the generator.

## Decision

Give the interaction its own representation.

- The rock catalogue holds facts about materials, with fixed codes, and nothing about processes.
- Modes are the shared vocabulary. Each says how a material's facts answer one way of attacking it. A process
  states how it acts as a mix of modes, compiled at load to tables by kind.
- Ground owns material, placement and surviving geological state. An intact share and an incised share
  use the same lattice, each with a bounded rock column and finite loose cover. Layers retain composition,
  strength, damage, fabric and formation/alteration ages. Elevation and exposed-material fields are projections.
- `Ground` reads those columns. Top-down actions stop at material they cannot remove. Surface-removal actions
  evaluate each occupied share before removal commits; face queries expose only contacts above neighboring
  terrain. `fold` supports consumer queries, and `section` exposes copied inspection records.
  Query visitors receive retained material snapshots, including both constituents, fabric and ages.
  Numeric queries explicitly average responses over occupied facets; categorical queries select
  the dominant facet. Shared material-fact reads combine constituent properties without inventing
  a synthetic rock identity. A new question belongs to its consumer, not a list inside Ground.
- Wear, burial, heat and deformation have distinct interaction operations. Material facts and retained
  state determine the response; callers supply forcing and routing. Construction, removal and transport
  commit material and placement together through the rock owner.
  In-place weathering evaluates rock beneath each facet's cover, spends forcing through successive
  beds, and places the converted substrate beneath that cover with its retained composition.
- Production fields and named Coverage lookups expose live read-only ground views. Bulk reads and
  snapshots give independent storage. Import boundaries restore packages, then derive their projections;
  ordinary process helpers cannot acquire writable backing or call internal column setters.
- What wears the land is a `GroundProcess` module with its own settings and scale rule. Feature operations
  compose its executable steps at explicit causal slots, as ADR 0011 describes.

## Alternatives

- **Rules in the catalogue.** Every new process edits the catalogue, and the catalogue must name them all.
- **Rules in each process.** Nothing keeps processes consistent, and a material can never be an exception.
- **Classic Visitor with a method per kind.** Each new kind edits every process.
- **Entity Component System.** Per-cell bands already exist, so it would be a rebuild for no new behaviour.
- **Every generation step a plugin.** Most steps share no structure worth a contract; `GenerationModule`
  already owns which capabilities run.

## Consequences

A new rock kind or attack is one entry, and every process and reader responds. A new wearing process touches
no other process and no catalogue rule. Queries own their own
curves, so readers can still disagree except where they share one, as `surfaceStanding` does. Whole-field
builders retain their solvers and use the same owning ground operations as narrow processes.

This is composition of owned state, material responses and caller-owned queries. Double dispatch
is not a required implementation pattern. Adding a process still requires its physical algorithm
and execution position; it does not require adapters to every process that previously changed the ground.

Bounded columns preserve the surface cap and basement while coarsening internal contacts. Layers retain
the two largest material constituents; finer ordering and minority chemical responses can be lost.
Combining cut profiles preserves material packages but loses their unresolved horizontal alignment.
Neighbor-face queries do not locate a subcell channel against a particular edge. These approximations
support material-dependent generation without claiming full three-dimensional stratigraphy.
