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
(biome, landform and magic classes) are fields at cell fidelity. Names and
outlines on every map additionally require geographic significance: coherent
extent and morphology, exceptional relief or causal/network/institutional
importance in the feature's own domain. A classified component does not
automatically become a place. Physical water and local-condition raster color remain independent of
named coverage. Corresponding ecological edges reuse existing raster sampling.
Only domains large relative to the map's own land, at the map's scale, receive
geographic subdivisions; the minimum size of an eligible region is not a general
maximum-size rule.

**Significance is judged at each map's scale (user direction 2026-11-03).** Every
map holds about the same number of cells, so a finer map is the same kind of map
of a smaller country. One set of significance rules, subdivision included,
applies to every profile. Generated geographic dimensions are relative declarations
resolved by the shared `MapScale` against the map's actual frame. Lengths, areas,
volumes and inverse or fractional dimensions retain their declared dimensional
powers. Nonlinear scaling is explicit in the declaration; resolution controls
sampling and declared cell support independently of feature size.
A per-map cell minimum alone would name every resolved fragment of a finer map.
What a map does not name stays latent on it.

**One length authority (user correction 2026-11-08).** `MapScale` owns map-relative
dimensions, cell conversions and geographic unit codecs. Its characteristic span
is the width of an equal-area 4:3 frame, so translation and aspect changes alone
do not alter isotropic lengths. Definitions resolve once at their owning map;
consumers receive measured quantities. Coordinates and captured geography remain
measured data. Resolved settings carry a distinct type and runtime marker so they
cannot be supplied again as relative overrides. Only the current map format is
supported; old maps and configurations have no conversion path. Architecture checks
reject competing codecs, fixed dimensional declarations and bypasses of the
definition boundary; source review remains necessary for untyped arithmetic.

Processes have no arbitrary geographic or output ceilings. Material availability,
bounded fractions and numerical solver constraints describe their own limits;
they do not impose a maximum terrain height or crust thickness. Water depth rates
retain fractional millimetres so smaller maps do not lose water to integer storage.

**People's works below the mesh.** Land under crops, herds and buildings is a
share of a cell in people's layers. A structural work is one thing or none: it
stands at a profile only where the map's cells can show it, as a dam does where
it makes a lake, and is otherwise left for a finer map. How a human era is lived
and what it recomputes is decided in
[ADR 0012 (people live on the land's layers)](0012-people-live-on-the-lands-layers.md).

**One publication rule per profile for every era.** A crowd of any era meets the
same town-size test to appear as a place on a map, and a finer map shows smaller
places. Hazards are yearly chances read from the ground a place stands on.

**Regional maps develop independently.** A child owns captured present geography
and completed historical context. It starts from its parent's ground and makes it
more defined: a parent cell is a rough average, and what lies inside it (a plain, a
slope, a cliff, a ridged range) comes from its rock column and history, shaped by
every process that shapes ground. The parent's elevation is not thrown away or
rebuilt. Nothing is fitted to the parent numerically and no boundary is pinned
(user clarification 2026-11-12 of the 2026-10-30 direction). The code does not yet
meet this: it rebuilds a region's heights from a drainage tree; see
[the water and relief plan](../WATER-AND-RELIEF-PLAN.md). Regional development
adds coasts, drainage, habitats, magic detail and places at the selected physical
scale; it does not run human eras or replay world history. The
child inherits its parent's people as layers; known places remain available and
smaller settlements are read from where those people gather. Neither a revised parent nor
a refined sibling changes the child's captured inputs. The child never writes
its new geography into another map.

## World products and regional context

| Pillar    | World products                                                               | Regional use                                                                                                   |
| --------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Terrain   | Continents, significant relief, glacial landforms and material histories     | Captured elevation, rock and fractures guide finer relief and coastal deformation.                             |
| Hydrology | Physical drainage, lakes and named major waters                              | Regional runoff develops local catchments, streams, supported lakes and incision.                              |
| Climate   | Temperature, moisture, precipitation and wind                                | Present conditions respond to finer relief and exposure.                                                       |
| Ecology   | Cover, soil and significant landscapes                                       | Fine cover and classes respond to local water and soil; outlines share raster class boundaries.                |
| Magic     | Sources, stocks, effects, distinct material histories and significant places | Captured present quantities resolve through each system's medium without renewing stocks or replaying history. |
| Society   | People's layers, settlements, ways, identity shares, territories and events  | Inherited layers are lived once per development round; smaller places and ways are read from them.             |

Authoring and fixture processes (`gis.*`, `terrain.*`, `survey.*`,
`history.rewrite`, `fixture.*`, `atlas.*`) act at the profile being edited and
are outside this table.

Political territory is supported geography, with no requirement to cover land.
A realm's hold follows the travel from its seat, and its territory is the land
where people hold its allegiance.
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

World maps show no sub-mesh works; a dam appears at World only with the lake it
makes. A
Region adds useful detail to captured present geography. Its terrain and drainage
develop through dedicated local algorithms; new places do not depend on rerunning
history or reconciling numerical budgets with the World map. Initial World
generation and independent regional refinement retain separate working states.
