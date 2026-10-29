# 0005 — Realized, latent and absent: what each profile generates

User direction recorded 2026-10-23 and adopted 2026-10-24. Applies to every
generation process at every creation profile. Refines the last paragraph of
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

**Children realize, conserve and never write up.** A child profile reads from
its ancestor the unit records, their demands, practice resources, political
membership, the retained drainage and the parent fields sampled onto its own
surface. Heirs take people by overlap share; a demand passes to the whole
country of heirs at their combined share and is searched across all their land.
The child realizes towns for the inherited urban share, locates each structural
demand on the cell of its medium that the child's terrain makes the best site
(a dam between the highest banks on the strongest channel, a harbour on
sheltered deep shore, a pass at a col, a weir off shallow water), gives the work
to the heir whose land holds that site, applies it on its own surface, and keeps
any demand it could not site latent with its whole amount recorded as unmet. The
sum of realized amounts never exceeds the inherited amount. The child never
edits the parent's realized facts.

## What each pillar realizes, leaves latent and leaves absent at World

| Pillar                                                   | Realized at World                                                                                                                                                                                                                                                    | Latent at World, and who reads it                                                                                                                                                                                                | Absent at World, first realized at                                                                                                                                                                                  |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Geology and terrain (`physical.*`, `ice.balance`)        | Continents, significant mountain systems and glacial complexes, exceptional summits and falls, surviving major craters, substantial incised courses and material histories                                                                                           | Crust, bedrock and sediment ledgers, fracture conductance, noise wavelengths above the cell; read by the child's physical refinement and by Fire propagation                                                                     | Ridge-and-valley relief below the cell, realized at Region by `canonry.refine-relief` from the parent's gradient with each parent cell's mean conserved; cliffs, terraces and scree at Local                        |
| Hydrology (`hydrology.drainage`, `canonry.refine-water`) | Complete physical drainage and lake geometry; named major courses assessed by their own discharge, catchment and length; significant or exceptional lakes; deltas                                                                                                    | Runoff, catchment area, flow targets, channel width and depth profiles, lake stage; read by drainage refinement, by society water access and by the child's drainage rerun                                                       | Tributaries below a cell's catchment, meanders, oxbows, springs, braids; Region for tributaries, Local for oxbows                                                                                                   |
| Climate (`climate.*`, `canonry.refine-climate`)          | Temperature, moisture, wind and seasonality fields; snowline; fog and sea-surface bands                                                                                                                                                                              | The same fields with their lapse and aspect rules; read by ecology, society support and the child's climate rerun on refined relief                                                                                              | Valley microclimate, frost hollows, the shadow of one sub-cell ridge; Region and Local                                                                                                                              |
| Ecology (`ecology.living`)                               | Cover, soil, disturbance and animal fields; coherent significant named landscapes with geographic subdivisions only at continental extent                                                                                                                            | Cover, soil, fuel, flood frequency and herd density fields; read by society support, biome naming and the child's ecology                                                                                                        | Stands, groves, clearings, wetlands below a cell; Region for patches and gallery forest, Local for stands                                                                                                           |
| Magic (`magic.*`)                                        | Sources, stocks, propagation and effects in their distinct media; significant coherent areas, retained courses and exceptional causal sites; guaranteed injected landmarks                                                                                           | Intensity, stored charge, conductance, retention, quickening, stillness and sea-surface anomaly fields; read by climate, ecology, society sites and support, and the child's magic refinement                                    | Individual vents, sinter terraces, single prism outcrops, one weir's reflection; Region for vents and terraces, Local and Site below                                                                                |
| Society (`human.*`, `built.layout`)                      | Catchment units as population records; capitals, regional capitals and towns above the concentrated-resident threshold, and their ruins; routes between them; polities and territories; events above the casualty threshold; population, culture and language fields | The unit's urban share, its demands per kind with units, its practice resources, the intensive forcing already applied, and the camps of earlier rounds as a site bonus; read by the child's society inheritance and realization | Located structural works, minor settlements as sites, local roads, fields, institution buildings, camps as features; Region for towns, dams, harbours and passes, Local for villages and fields, Site for buildings |

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
Region shows what its ancestor could not: towns for the inherited urban share,
a dam with its impoundment upstream, a harbour on the sheltered shore, and an
inspectable remainder where a demand found no site. Regional terrain synthesis
is decided: a Region realizes the ridge-and-valley relief its parent's cells left
latent, from the parent's own gradient, before its incision, hillslope and ice
passes act. Regional drainage synthesis, which decides how much finer the
Region's water network is than the inherited one, remains a separate decision.
