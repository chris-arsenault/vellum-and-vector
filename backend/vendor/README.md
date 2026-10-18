# Canonry physical generation core

Whole source files copied from `chris-arsenault/the-canonry-game`, commit
`0f62584c114863ffadeb5e29e021f5fce6b37a61`, on 2026-10-17.

`Engine.WorldGen` supplies the domain-neutral microtriangle topology, physical
layers, fixed-point fields, validation and multi-epoch evolution session.
`Engine.Constants` supplies its numeric and material vocabulary. These libraries
retain their numerical algorithms; Atlas does not include the game kernel, Godot
UI or Ice Remembers content. Atlas adapters and bounded refinement live outside
this directory.

The project file additionally grants `Atlas.Generation` internal access so its
present-day forcing adapter can reuse the existing physical layer contracts.
The evolution session and pipeline accept an optional constraints callback before
each layer consumes its prerequisites. Atlas uses this hook to impose hard authored
terrain/climate inputs inside the coupled root solve, rather than clamping exported
rasters after drainage and ice have already been calculated. Calls without a callback
retain the original pipeline behavior. The profile additionally distinguishes
expected natural climate/current diversity from structural invariants. Atlas
disables those diversity assertions for hard-constrained worlds; range, material,
drainage, water and topology checks remain active. Land-ice generation accepts an
empty dry-land set and still handles inland water. These are explicit adaptations
in the precipitation/current validators and land-ice domain handling.
NuGet lock files are regenerated for Atlas's target framework and deployment RID.

The source repository is owned by the same project owner, Chris Arsenault.
No third-party license declaration was present in that checkout. Preserve this
provenance when updating the copied core.
