# 0010 — Rock answers from its catalogue; what wears the land is a plugin

User direction recorded 2026-11-06. Follows the shape the POI catalogue set.

## Context

The rock catalogue held each kind's properties, but what those properties meant was decided by
whoever read them. More than a dozen formulas turned the same rock into a hardness, each with its own
bounds, and world and region defined the ground's resistance differently. Rivers, ice, slopes and
solution each kept their own books, and a global profile held their settings, so a region's erosion
had to know the inside of each process to rescale it. Each new behaviour added another constant to
another file.

## Decision

The catalogue decides how rock answers each thing that works on or reads it. `Ground` is the one
reader of a cell's rock, on world and region alike. A lint rule keeps other generation code from reading
the rock bands.

Whatever wears the land is a `WearProcess`: a module in `wearProcesses`, with its settings in
`wearSettings`. It is handed the ground and its settings, does its work, and says how its settings read
at another scale. A shared ledger keeps the sediment's books. `sequence.ts` keeps the order, because
order is physics.

Answers come from shared rules over each kind's properties, so a new kind needs only properties. A rule
reads a new property when one is needed; kinds do not override answers one by one.

## Alternatives

- **Named constants beside each process.** Tidier, but what hard means stays decided in many places.
- **Every generation step a plugin.** Most steps share no structure worth a contract; `GenerationModule`
  already owns which capabilities run. Only wear has the proven duplication.
- **Coast as a wear process.** It carries material along the shore and does not read rock. It would join
  when it does.

## Consequences

A behaviour change to rock goes in the catalogue and reaches every reader. A new wear process touches
its module, `wearSettings`, the profile, the list, the sequence and its step's contract. Answers remain
as they were when they moved, including ones that disagree, and `Ground` still holds separate streams
and regional material readings, so reconciling them is deliberate work on the map. Only wear has a
contract: processes that build the land, and anything reading below the surface, have none yet.
