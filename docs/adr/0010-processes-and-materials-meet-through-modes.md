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
- `Ground` is the one reader of rock. A cell is a stack of cover, sediment and rock layers, with fractures,
  wards and map-specific modifiers bearing on what passes. `actOn` carries an action down it and `fold` reads
  it with a query written by whoever needs the answer.
- One ledger writes what comes off and lands. A lint rule keeps rock bands inside the rock module.
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
curves, so readers can still disagree except where they share one, as `surfaceStanding` does. Processes that
build the land use the whole-field adapter described in ADR 0011. Additional loose material kinds and
voids still need a concrete consumer before extending the representation.
