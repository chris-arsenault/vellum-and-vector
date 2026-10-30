# 0005 — Realized, latent and absent: what each profile generates

User direction recorded 2026-10-23 and adopted 2026-10-24. The World publication
rules remain applicable. The user's 2026-10-30 direction replaces the earlier
regional conservation and realization mechanism with dedicated surface refinement.
Refines the last paragraph of
[ADR 0004](0004-coupling-through-each-systems-medium.md) and the
materialization states in
[product specification 12.2](../product-spec.md#122-authorship-and-materialization-states).

## Decision

A fact a profile could hold is in one of three states there.

- **Realized:** generated at this profile's fidelity and authoritative here,
  published as a feature or a field. Cartography may generalize it at a zoom;
  it still exists.
- **Latent:** a quantity, budget or propensity this profile computed for a unit
  its mesh resolves (a cell, catchment, reach or coast segment). A finer profile
  reads it as forcing and may realize features from it. It has no geometry finer
  than the mesh.
- **Absent:** not generated at this profile. Nothing is stored and nothing is
  hidden; a finer profile generates it from the latent quantities and its own
  terrain, including authored terrain.

"Hidden" is not a state. A computed thing the map withholds is either a
realized fact generalized by cartography, which is legitimate when it is at mesh
fidelity, or a sub-mesh fact that should not have been computed at this profile.

**Resolution rule.** A process at profile P realizes a feature it would place
from a physical footprint (a work, a lake, a settlement) only when that
footprint spans at least a declared number of cells of P's mesh, or when the
feature belongs to a category P designates as major, whose influence is
cell-scale even when its geometry is a point. Whatever the process would decide
below that footprint becomes a latent quantity on the unit that contains it. The
cell count is declared once in code where it is consumed. Cell classifications
(biome, landform and magic classes) are fields at cell fidelity. World names and
outlines additionally require geographic significance: coherent extent and
morphology, exceptional relief or causal/network/institutional importance in the
feature's own domain. A classified component does not automatically become a
place. Physical water and local-condition raster color remain independent of
named coverage. Corresponding ecological edges reuse existing raster sampling.
Only genuinely continental domains receive geographic subdivisions; the minimum
size of an eligible region is not a general maximum-size rule.

**Intensive and structural society works.** An intensive work (clearance,
burning, hunting, conservation, irrigation, tapping, quarrying) is a fraction
per cell with meaning, so at World it is a demand spread as field forcing over
the cells of its medium in the unit's country, conserving the total of the
located work it stands for. A structural work (dam, weir, pass, harbour) is one
thing or none, so at World it is a demand with an amount and a unit and no
physical consequence; it is located, applied and published at the child
profile. A demand is never published as a feature at any profile. The
classification is one labelled declaration in the domain. Magic practices are
located at every profile and force one cell at their seat.

**A World cycle recomputes only mesh-scale consequences.** The ten-year cycle
writes intensive field forcing, advances the ecology for the elapsed years and
refreshes society support and connections. Hydrology re-routes when a located
structure or authored terrain changed the surface; magic re-propagates when its
medium changed. A sub-mesh cause, such as a demand or the heat at a practice's
seat cell, does not re-route the world. Speed is a consequence of this, not its
purpose.

**One publication rule per profile for every era.** A camp of an earlier round
meets the same test as a present town to appear on the World map, or appears as
a mesh-scale ruin field where a sealed vein or a drowned weir line carries camps
at its root. Hazards at World are rates on the unit with unit-scale
consequences, not point radii.

**Regional maps develop independently.** A child owns captured present geography
and completed historical context. Dedicated algorithms add local relief, coasts,
drainage, habitats, magic detail and places at the selected physical scale. They
do not allocate demographic heirs, conserve parent-cell heights, run society eras
or replay world processes. Known places remain available and smaller settlements
can appear without an inherited population budget. Neither a revised parent nor
a refined sibling changes the child's captured inputs. The child never writes
its new geography into another map.

## World products and regional context

| Pillar    | World products                                                                 | Regional use                                                                                                   |
| --------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Terrain   | Continents, significant relief, glacial landforms and material histories       | Captured elevation, rock and fractures guide finer relief and coastal deformation.                             |
| Hydrology | Physical drainage, lakes and named major waters                                | Regional runoff develops local catchments, streams, supported lakes and incision.                              |
| Climate   | Temperature, moisture, precipitation and wind                                  | Present conditions respond to finer relief and exposure.                                                       |
| Ecology   | Cover, soil and significant landscapes                                         | Fine cover and classes respond to local water and soil; outlines share raster class boundaries.                |
| Magic     | Sources, stocks, effects, distinct material histories and significant places   | Captured present quantities resolve through each system's medium without renewing stocks or replaying history. |
| Society   | Communities, settlements, routes, affiliations, territories and completed eras | Known places and history remain context; regional algorithms add smaller habitation, local ways and POIs.      |

Authoring and fixture processes (`gis.*`, `terrain.*`, `survey.*`,
`history.rewrite`, `fixture.*`, `atlas.*`) act at the profile being edited and
are outside this table.

Political territory is supported geography, with no requirement to cover land.
Founding claims follow actual reach; independent successors require a sustained
political base. Terrain travel costs and population support shape World frontiers.
Sovereignty, current control and claims retain distinct meanings, including older
claims after retreat. Subdividing a continental country does not create more
sovereign entities.

## Alternatives

- Keep located works at World and withhold them from the map. Rejected by the
  user: hidden is not latent, and a five-kilometre earthwork on a cell tens of
  kilometres across is computed below the mesh.
- Spread every work as a field, structural ones included. Rejected: a dam
  demand that puts a fraction of a dam on every river cell makes every pond a
  lake, and a weir flag has no fraction.
- A registry of declarations that processes register at runtime. Rejected until
  something reads it; the table above and the per-rule minima in code are the
  declaration.
- A fourth state for computed-but-withheld facts. Rejected: it would license
  exactly the behavior the user ruled out.

## Consequences

World society costs a fraction of a physical pass because its cycle no longer
re-routes water or re-propagates magic. World maps change: no camp ruins or
sub-mesh works appear, and the lake set does not depend on society demands. A
Region adds useful detail to captured present geography. Its terrain and drainage
develop through dedicated local algorithms; new places do not depend on rerunning
history or reconciling numerical budgets with the World map. Initial World
generation and independent regional refinement retain separate working states.
