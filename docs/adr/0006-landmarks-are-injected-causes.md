# 0006 — A landmark is injected causes with a guaranteed signature

User direction recorded 2026-10-18 (backlog item 9) and 2026-10-24; adopted
2026-10-25. Applies to authored major landscape features in physical generation
at every creation profile. Refines [ADR 0004](0004-coupling-through-each-systems-medium.md)
and [ADR 0005](0005-scale-contract.md).

## Decision

A creator may place a named landmark of a catalogued kind at a world location,
choose the epoch it forms in and set its defining measures in physical units.
Generation guarantees those measures at the end of every later epoch and at
present. Everything else about the landmark is a consequence of the ordinary
processes acting on the causes it injected.

**Injected causes, not stamped shapes.** At its epoch a landmark writes the same
quantities impacts, plumes and orogeny write: bedrock and rock load, rock
resistance, fracture conductance, volcanic activity, fault traces, incision
booked as sediment supply. The landscape, drainage, climate, ice, magic and
society then act on its cells as on any other cell. No process other than the
landmark processes knows a landmark exists, and no field is frozen around one.

**Maintained signature.** Before each epoch's history is kept, the landmark's
signature is measured on the mesh (a summit's height and prominence, a canyon's
depth between its rims, a ring structure's crest-to-trough relief, a crater's
floor depth and rim height, a scarp's throw, a falls' step). Where a measure
has fallen short, the smallest correction that restores it is applied through
the same physical quantities. Every correction is booked in a cumulative
`LandmarkMaintenance` field and, when it cuts, through the sediment ledger, so
the cost of holding a landmark against its setting is inspectable. A landmark
whose maintenance is a large share of its relief every epoch is telling the
creator that its causes fight the setting; the kind's causes are what to tune.

**Water is captured, never fabricated.** A canyon or falls claims the largest
river within its declared capture distance that a cut can divert: above base
level and not about to discharge into the sea. The corridor that brings it is
cut as incision and becomes part of the landmark's channel. If no river
qualifies, the relief still forms, the landmark carries its local drainage, and
the record says so. The water budget is conserved.

**Features ride the crust.** Plate advection moves events, faults and the
surface. A landmark is emplaced at its authored position walked back through
the drift of the epochs still to come, and each maintenance pass measures where
the drift has carried it, so at present it stands where it was drawn.

**Scale follows ADR 0005.** A kind declares, where it is consumed, the cell
span its defining dimension must cover to be realized at a mesh. Below it the
causes are still written at cell scale and the landmark publishes with a latent
signature; a kind may declare that it holds its cell-scale causes while latent
(a great falls holds its step), and the finer profile that resolves it realizes
the form and checks the signature there.

**One identity, one row.** The realized landmark publishes as one geology
feature under the landmark's own id, carrying its target and measured signature,
maintenance total, captured river and notes. A detected landform standing on a
landmark's claimed cells is the landmark and is not published a second time.
The landmark's own fault trace publishes as the landmark, not as a fault.
Regeneration with another seed keeps the id and the authored name.

## Rejected alternatives

- **Fixed-sample protection** (`work.fixed`, the mechanism that protects
  authored elevation): it freezes a patch, so nothing around the landmark
  integrates and the processes inside it are undone.
- **Causes only, no maintenance:** strong erosion, sea-level change or
  isostatic subsidence can erase a landmark, and the creator asked for a
  guarantee.
- **Supporting a mountain by thickening the crust under it:** the support
  target is smoothed over the flexural wavelength, so a sharp root never holds
  a sharp summit and the correction converged slowly. A cone is built as
  constructed rock and the subsidence it earns is paid as maintenance.
- **Fabricating discharge at a canyon or falls:** breaks the water budget.
- **Routing guidance as an input channel:** drainage guidance is computed from
  the drainage surface and inherited incision; the canyon holds its river by
  being the lowest, most-incised corridor.
- **A separate generated feature beside the authored record:** two ids for one
  identity split history, selection and the registry.
- **A general finishing pass that reshapes features for the macro lens:** that
  work was stopped and archived by user direction; landmarks act inside the
  epoch loop at their own locations.

## Consequences

- `world.landmarks` is an authored world-level record beside placed magic
  sources, with `putLandmark` and `removeLandmark` intents validated against
  the kind catalogue. Saved maps carry it with the rest of the world.
- `physical.landmarks` contributes `landmark.emplace` after each epoch's
  impacts and `landmark.maintain` before its history, only when a landmark lies
  in the extent; disabling the capability leaves the records and removes the
  effects.
- Adding a kind means adding one declaration in the domain catalogue and one
  in generation (causes, measure, correction); nothing else changes.
- Regional refinement (the terrain and rivers subplan) reads the landmark
  records and realizes latent forms within the parent's cells.
