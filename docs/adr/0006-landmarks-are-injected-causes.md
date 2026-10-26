# 0006 — Major landmarks are sited by the generator as injected causes with a guaranteed signature

User direction recorded 2026-10-18 (backlog item 9) and corrected 2026-10-26; adopted
2026-10-26. Applies to major landscape and magic points of interest in world generation.
Refines [ADR 0004](0004-coupling-through-each-systems-medium.md),
[ADR 0005](0005-scale-contract.md) and [ADR 0007](0007-magic-systems-are-materials.md).

## Decision

A world is owed a configured number of major landscape landmarks and major magic landmarks.
The generator sites them during the physical epochs, forms each in an epoch, guarantees its
defining measures at the end of every later epoch and at present, names it, and publishes it
as one feature. Nothing is placed before generation: the workflow is create, generate, refine,
author, and a landmark is part of the procedural result that a creator may then rename, adjust
or remove.

**Counts are generation settings.** The physical landmark capability carries the number of
landscape landmarks and the number of magic landmarks a top-level run owes. A run keeps every
landmark record the extent already carries and sites only the shortfall, so regeneration
preserves identity, name and position. An inherited (child) run re-forms its parent's
landmarks inside its extent and sites none.

**Siting is a terrain reading.** Each kind declares where it belongs as a score over the
physical field at the epoch it forms in, the same reading a creator would make from the map: a
great cone on broad stable plains, a canyon where a large river crosses a plateau, falls on a
large river above base level, a scarp across a long fall of the land, a ring structure on low
quiet ground, a wellspring on a fracture-fed heat maximum, a vault in deep ice, a locus in deep
water far from shore, a heartwood in a wet old wood, a salt pan where a lake died in a dry
basin. Kinds that read climate, ice, ecology or rivers wait for an epoch in which those exist.
A world's kinds are drawn in rotation from the catalogue, and from the magic kinds only those
whose systems the run generates; measures start from the catalogue defaults with a seeded
spread and are fitted to the site and the mesh. Sites stand apart from each other, and a site
whose present-day position the remaining drift would carry outside the extent waits for a
later epoch.

**Injected causes, not stamped shapes.** At its epoch a landscape landmark writes the same
quantities impacts, plumes and orogeny write: bedrock and rock load, rock resistance, fracture
conductance, volcanic activity, fault traces, incision booked as sediment supply. A magic
landmark injects a kept source of its system, which the system's own origin, propagation,
feedback and meetings then act on as on any source. No other process knows a landmark exists,
and no field is frozen around one.

**Maintained signature.** Before each epoch's history is kept, each landmark's signature is
measured on the mesh (a summit's height and prominence, a canyon's depth between its rims, a
ring structure's crest-to-trough relief, a crater's floor depth and rim height, a scarp's
throw, a falls' step, a source's intensity at its site). Measures are read from whole cells,
so a kind narrower than a cell still measures what it was given. Where a measure has fallen
short, the smallest correction that restores it is applied through the same quantities: relief
through bedrock and incision, booked in a cumulative `LandmarkMaintenance` field and the
sediment ledger; a source by raising its strength, to the cap the system's activity allows,
and the record says when the cap holds it short. The published signature is read again at
present, after the present phase has re-formed water, ice and magic. A landmark whose
maintenance is a large share of its relief every epoch is telling the creator that its causes
fight the setting.

**Water is captured, never fabricated.** A canyon or falls claims the largest river within its
declared capture distance that a cut can divert: above base level and not about to discharge
into the sea. The corridor that brings it is cut as incision and becomes part of the landmark's
channel. If no river qualifies, the relief still forms, the landmark carries its local drainage,
and the record says so.

**Features ride the crust.** Plate advection moves events, faults, sources and the surface. A
sited landmark is recorded at the present-day position its anchor will have after the drift of
the epochs still to come; each later pass walks the record back to where the drift has carried
it, so at present every landmark stands where its record says.

**Scale follows ADR 0005.** A kind declares the cell span its defining dimension must cover to
be realized at a mesh. Below it the causes are still written at cell scale and the landmark
publishes with a latent signature; a kind may hold its cell-scale causes while latent (a great
falls holds its step), and the finer profile that resolves it realizes the form there.

**One identity, one row.** A landmark publishes as one feature under its own id, on the geology
layer for a landscape kind and the magic layer for a magic kind, carrying its target and
measured signature, maintenance, captured river or source strength, and notes. A detected
landform standing on a landscape landmark's claimed cells is the landmark and is not published
a second time; the landmark's own fault trace publishes as the landmark, not as a fault. A
magic landmark's source record is owned by the landmark, removed with it and hidden from
source editing. Names come from the geography's naming vocabulary once and are kept.

## Rejected alternatives

- **Creator placement before generation:** the first delivery. Rejected by the user: there is
  no terrain to place anything on before the world is generated, and the feature's point is to
  inject and guarantee major places as part of the procedural process. Editing the generated
  record afterwards remains.
- **Fixed-sample protection** (`work.fixed`): it freezes a patch, so nothing around the landmark
  integrates and the processes inside it are undone.
- **Causes only, no maintenance:** strong erosion, sea-level change or isostatic subsidence can
  erase a landmark, and the request is a guarantee.
- **Supporting a mountain by thickening the crust under it:** the support target is smoothed
  over the flexural wavelength, so a sharp root never holds a sharp summit. A cone is built as
  constructed rock and the subsidence it earns is paid as maintenance.
- **Fabricating discharge at a canyon or falls:** breaks the water budget.
- **A separate generated feature beside the record:** two ids for one identity split history,
  selection and the registry.
- **Promoting the tallest emergent peak or largest falls to a major landmark:** considered as
  the other reading of the request; it guarantees nothing about kind, presence or measures.
  Hallowed and Veil have no injectable initial origin, so their major sites would need such a
  promotion of emergent seats and doors; that is left open.

## Consequences

- `world.landmarks` holds the generated records with `origin: generated`; the intents that
  rename, move, re-measure or remove a landmark remain for authoring the result. Saved maps
  carry the records and the magic landmarks' source records with the rest of the world.
- `physical.landmarks` carries the two count settings and contributes `landmark.emplace` after
  each epoch's impacts and `landmark.maintain` before its history at every top-level run;
  disabling the capability leaves the records and removes the effects.
- Adding a kind means one declaration in the domain catalogue and, in generation, its siting
  rule and its causes, measure and correction; nothing else changes.
- Regional refinement (the terrain and rivers subplan) reads the landmark records and realizes
  latent forms within the parent's cells.
