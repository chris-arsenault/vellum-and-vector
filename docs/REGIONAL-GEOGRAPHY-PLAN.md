# Regional geography quality — working plan

Working copy for Sulion plan `ea1eabd9-8a17-4e96-8b90-81b487c7d677` (owner review of refined
regions, 2026-11-03). Durable mechanisms move to the generation guide and ADR 0008 when the
plan closes; this file is then deleted.

## Rivers — diagnosis (phase 2)

Evidence: one generated draft world (seed 73), the coastal region M2 refined at standard
quality (55 468 cells at 2.1 km), measured in a throwaway run; renders under
`.artifacts/river-diagnosis/`.

| Measure                                                  | Value                                                      |
| -------------------------------------------------------- | ---------------------------------------------------------- |
| Channel cells                                            | 1 962 of 37 954 land cells                                 |
| Channel ends at a captured lake                          | 19                                                         |
| Channel ends at another root (shore, exit, closed basin) | 37                                                         |
| Channel cells draining into an ocean cell                | 0 (shore cells are roots, so channels stop beside the sea) |
| Published rivers                                         | 166, median 21 km, longest 167 km                          |
| Sinuosity (length / straight distance)                   | median 1.02, 90th percentile 1.07                          |
| Lakes published                                          | 9                                                          |

What causes each symptom the owner reported:

1. **Rivers end inland.** A captured lake and a parent closed basin are roots of the network
   (`regional/network.ts` `networkRoots`): water reaching them stops. Nothing carries a lake's
   overflow onward, so every river feeding one ends there, and the lake reads as a pond at a
   river's tip. In a humid country every such lake should overflow to the sea.
2. **Few long rivers, empty lowlands.** Every land cell beside the sea is a root at sea level,
   and the network is a least-cost tree to the nearest root. A coastal plain therefore drains
   as many short parallel strips straight to the shore instead of gathering into a few trunks
   that run along the plain to a mouth. The channel threshold also doubles on flat ground, so
   a lowland strip rarely qualifies at all.
3. **Straight rivers.** A least-cost (geodesic) path over a nearly even cost field is a
   straight line; the grain term makes mountain channels straight along strike, which is the
   comb of parallel grooves in the relief render. Nothing bends a channel inside its valley:
   there is no floodplain, no meander and the drawn line follows cell centres.
4. **Relief highlights, not valleys.** The relief beside every channel rises at the full
   hillslope gradient from the bank (`regional/relief.ts` `reliefIncrements`), so each channel
   is a V-cut crevice whatever its size. Real valleys widen with discharge into flat floors
   where large rivers wander.
5. **Few lakes.** Lakes come only from captured parent lakes and kept hollows; no process
   makes lakes along courses.

## Rivers — what real rivers look like

- **Basins gather into trunks.** The longest stream grows faster than the square root of its
  basin area (Hack's law, exponent near 0.5–0.6), so large basins are elongated and their
  trunks run long distances, often parallel to ranges or coasts before breaking through to a
  mouth. Few mouths drain most of a coast; the coast between them carries short streams.
- **Pattern follows slope and valley room.** Steep confined channels are nearly straight and
  follow their valley's bends; on gentle slopes with room to move, a river meanders (sinuosity
  1.3–4, with 1.5 a common meandering threshold); steep, sediment-laden gentle reaches braid.
- **Meander size scales with the river.** Wavelength is about 10–14 channel widths (about 11
  on average), the bend radius about 2–3 widths and about a fifth of the wavelength; bends
  are close to sine-generated curves. Channel width grows roughly with the square root of
  discharge, so a larger river makes larger bends.
- **Valleys widen downstream.** Headwaters sit in V-shaped valleys; downstream the floor
  widens into a floodplain several to many channel widths across, bounded by the valley walls.
- **Lakes along courses.** Glacial troughs hold ribbon lakes behind rock bars and moraines;
  landslides and fans dam valleys; fault-angle basins hold long lakes; meander cut-offs leave
  oxbows; a humid lake overflows and its river continues. Only where evaporation exceeds
  inflow does a river end in a terminal lake or salt flat.

Sources: Leopold and Wolman, river meanders (USGS); Langbein and Leopold, sine-generated
meanders; Williams 1986 (USDA-ARS meander design summary); Hack's law and Sassolas-Serrayet
et al. 2018 (Nature Communications); Leopold and Maddock downstream hydraulic geometry.

## Rivers — proposed design (for owner review)

Each item follows the existing order: network, relief derived from it, then publication. The
same rules apply at every map scale through the map's cell span and the significance rule.

1. **Lakes overflow.** A lake is not a root: it fills to its lowest rim and its outflow
   continues down the network. Only a basin whose water balance is negative (evaporation
   above inflow, as the world's water-budget lakes decide) stays terminal, and then it is a
   terminal lake or salt flat on the map.
2. **Mouths compete.** The shore is not uniformly a root. Mouths form where the parent's rivers
   reach the sea and where the coastal plain's gradient converges; elsewhere the shore is an
   outlet only for its own short streams. Water on a coastal plain follows the plain's
   gradient to a mouth rather than the nearest shore cell, so lowlands gather long trunks.
   The parent's significant rivers are the trunks of their basins.
3. **Valley floors widen with discharge.** Relief beside a channel starts with a flat floor
   whose width grows with the river's size; the hillslope rises from the floor's edge. Small
   streams keep V valleys; large rivers sit in broad floodplains.
4. **Channels bend in their valleys.** The drawn river is a centreline inside the valley
   floor, not the cell path: where the slope is gentle and the floor wide, it meanders with
   wavelength and bend radius set by its width (and so its discharge), confined by the floor;
   steep reaches stay near the valley line. The bends are deterministic per river identity.
   Cut-off loops become oxbow lakes where the floor is wide.
5. **Lakes along courses.** Lakes form where the processes already make basins: glacial
   overdeepening behind a rock bar or moraine, slide and fan dams (kept hollows), fault-angle
   basins along the fracture set, and oxbows from item 4. Each overflows by item 1.
6. **Mountain drainage is not a comb.** Along-strike channels collect into a few longitudinal
   trunks that break through the range at gaps, instead of every groove running parallel to
   the frame (the grain term picks direction; capture, not cost, picks which grooves join).

Owner decisions:

- Should meanders change the cells the river occupies (floodplain cells, oxbow lakes on the
  field) or only the drawn line? Recommendation: both; the floodplain and oxbows are
  geography the other domains read (settlements, roads, ecology).
- Terminal lakes and salt flats in dry basins: keep (recommended), or always drain to the sea?
