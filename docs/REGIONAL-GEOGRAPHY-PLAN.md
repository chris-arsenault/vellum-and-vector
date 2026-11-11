# Regional geography quality — working plan

Working copy for Sulion plan `ea1eabd9-8a17-4e96-8b90-81b487c7d677` (owner review of refined
regions, 2026-11-03). Durable mechanisms move to the generation guide and ADR 0008 when the
plan closes; this file is then deleted.

Ground ownership and process interaction are described in
[ADR 0010](adr/0010-processes-and-materials-meet-through-modes.md) and
[ADR 0011](adr/0011-processes-couple-through-keys-and-a-ledger.md).
The current world maps are accepted as a useful baseline. Physical magic and regional
inheritance/shared-owner integration are implemented. Regional capture and execution
mechanisms are described in [ADR 0008](adr/0008-regional-refinement-is-conditioned-amplification.md)
and ADR 0011 above. Terrain development versus vegetation recovery remains a geography
tuning concern; completing integration does not close the older geography work below.

The older diagnosis below records the owner's outstanding geography concerns, not
the implementation of the current regional pipeline. Society, economy, POI categories
and music still require the separate design session. Further cosmetic tuning is not
the next priority.

## Periodic regional working frame — pending (phase 14)

A region crossing the world's horizontal seam can allocate the whole world width even
though its compact chart is much narrower. `refinementFrame` already computes compact
bounds; regional capture discards them, and shared initialization rebuilds bounds from
the split footprint. A bounds-only change is insufficient: topology coverage and geometry
operations need a consistent continuous chart with canonical periodic input and output.
Preserve that frame through shared initialization and lattice construction, retaining
periodic sampling and captured identities. Do not add a separate
regional grid or freeze parent values. Exit: the child develops on a compact working frame
and renders contiguous geography at the intended cell span. Reuse the saved parent and
child rather than regenerating upstream history. Report framing is a separate presentation
concern and does not repair the generator's working allocation.

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

## Rivers, relief and ways — processes built (phases 2–4)

Owner correction 2026-11-03: the first design constructed outcomes; the work names processes
and lets their running make the geography. Built:

1. **Initial drainage organization** (`regional/evolution.ts`). A geodesic strategy uses
   captured terrain, material and waters to organize one-time detail realization. It does
   not run an unrecorded uplift/erosion history. The later current drainage uses shared
   conditioning, water-budget lakes, flow routing and river owners.
2. **Shared physical development** (`regional/sequence.ts`). Feature selection dispatches
   the shared incision, hillslope, sediment, ice and coastal owners against retained Ground.
   Local work exposure is separate from historical epochs and from derived refresh. Initial
   relief may cut or displace actual retained beds; later processes transform those materials.
3. **Hillslope steps** (`regional/relief.ts`). A step between cells rises over one
   hillslope's length, not the cell's width.
4. **Meander migration** (`canonry/meanders.ts`, `canonry/riverMeanders.ts`). A reach on a
   gentle floor migrates across it by its own and upstream curvature (Howard and Knutson),
   with neck and chute cutoffs; width follows discharge; confined reaches keep the valley line.
5. **Ways** (`regional/ways.ts`, `regional/societyWays.ts`, `regional/wayLines.ts`). Travel
   pays the square of the grade over a ruling grade and extra on floodplain ground; the
   busiest journeys make their ways first and later traffic joins made roads; a way's line
   runs straight wherever the ground allows and shared roads are drawn alike.

Open: lakes along unglaciated courses are rare (glaciated regions hold many); range flanks
drain by close parallel valleys; the oxbows the migration leaves are not published.

## Owner review of phases 2–4 (2026-11-04)

Slightly better; none of these features is near done. The owner questions whether the approach
is right or the chosen algorithms need more work. Recorded findings, to take up after phase 6:

1. **Waterfalls.** Published waterfalls sit all over the map, many off any river, at nearly even
   spacing along courses, on reaches that are only sloped. A waterfall is a steep drop; where one
   stands it must shape the local elevation profile (a step in the long profile, a lip and a
   plunge), and its placement must come from that profile.
2. **Rivers never reach the coast.** Drawn rivers stop short of the shore in every case seen,
   including large trunks ending a few kilometres inland.
3. **Valleys are just the rivers.** The published valley features trace the river lines almost
   exactly instead of describing a landform (floor and walls) of their own. Possibly belongs with
   the POI work (phases 7–8).
4. **Peaks.** A whole mountain range publishes two peaks.

Shared-owner integration review: current child maps show connected rivers, lakes and
exposed inherited materials, but long parallel tributaries still recur across smooth
uplands. Keep that routing/valley-shape concern in the existing owner-review follow-up
(root phase 11); completing inheritance does not close it. Sparse vegetation variation
also remains a geography-quality observation, not evidence that regional ecology is
fully tuned. The separate society design session remains required.
