# Regional refinement — working plan

Working copy for the bidirectional regional refinement delivery
(`.sulion-paste/regional-refinement-implementation-spec.md`, Sulion plan
`abf8e123-a6c6-472e-9254-2006d2b2470b`). Durable decisions move to
[ADR 0008](adr/0008-regional-refinement-is-conditioned-amplification.md) and the
[generation workflow design](generation-workflows.md) at closure; this file is then
removed.

## Frozen evaluation

Harness: `frontend/src/regionalEvaluation.generation.test.ts`, run with
`ATLAS_REGIONAL_VARIANT=baseline|candidate pnpm --dir frontend exec vitest run -c vitest.regional.config.ts`.
Renders and `report.json` land under `.artifacts/regional/evaluation/<variant>/`.
Seed 73 for every case. Standard quality, level 1. Presentation: the production
terrain painter plus one fixed symbol set (rivers by order, lake shores, roads,
settlement dots, summit triangles, col crosses, magic-site dots). Three runs per
case; the median is the case time; equal surface signatures across the runs are the
deterministic-repeat check.

| Case | Parent situation (fixed before any candidate ran)                                                                                                                                                                                                           | Must expose                                                                                   |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| P1   | Constructed 1500×1000 km world at 200 km² samples: one NE-trending range dome, structural grain along it, glaciated north-eastern half, wet windward flank, southern coast, river Vell from the crest to the sea, town Harrowgate at its foothill exit, river Ash entering across the frame, summit Mount Carrow | Separate summits and cols, passages, feeding geography, a usable town site; not a noisier ridge |
| P2   | Constructed dry plateau (hard caprock, no grain, no glacial history, one volcanic cone) above an escarpment, grassy lowland, wooded coast, ephemeral river Dunmere to the coastal town Saltmere                                                             | Different spatial organization; water, material and habitat relationships; settlement support   |
| M1   | 100 km bin of the generated draft world (2000×1000 km, seed 73) with the most Fire and Aurora coverage, both present, inland                                                                                                                             | Interacting carriers and altered surroundings, not overlays or cancellation                     |
| M2   | Coastal 100 km bin with the most Pressure, Greenwood, Salt and Hallowed coverage, all present                                                                                                                                                             | Cross-domain organization of coast, water, habitat, deposits and kept geography                 |

Selections: P1 `[480000, 280000, 1020000, 680000]`, P2 `[500000, 320000, 1040000, 720000]`,
M1/M2 a 400×300 km rectangle centred on the selected bin. The world generation of
M1/M2 is the production handoff path for the new context (spec 4.3, 9.1).

Baseline (current code) renders and timings: recorded in
`.artifacts/regional/evaluation/baseline/report.json` once the baseline run completes;
the numbers are copied into the final report, not into this file.

## Input → producer → handoff → consumer → geographic effect → check

| Input                                   | Producer                                                        | Handoff                                                                     | Consumer                                                 | Geographic effect                                                                    | Check                             |
| --------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------- |
| `structuralGrainX/Y` (doubled-angle axial direction × coherence) | orogenic construction records its source boundary tangent on belt cells; carried by plate transport | `atlasChannels` binding, geology layer; regional allowlist; regional character record | terrain erodibility banding and along-strike relief modulation | ridges and strike valleys follow the grain; separate summits along the belt           | Direction has an effect           |
| `tectonicStrain`, `glacialErosion`      | existing                                                        | already published and allowlisted; previously unused by terrain             | uplift amplitude; glacial reworking (cirque basins, trough deepening, retained tarns) | lakes with a cause in glaciated high ground; none in dry unglaciated ranges            | Character changes organization    |
| `volcanicConstruction`                  | existing                                                        | add to the regional allowlist                                               | cone-shaped constructive uplift at local maxima           | discrete cones instead of a smeared bump                                              | Character changes organization    |
| captured `peak` features                | world landform publication                                      | captured features (retained point places)                                   | uplift concentration; summit identity re-anchored to the realized summit | an inherited significant peak organizes its massif                                     | structures survive interaction    |
| captured `river` features and edge flow | world river publication, `riverOrder`/`flow`                    | source features; edge inlets                                                | course imprint on uplift/erodibility; inlet discharge; identity carried to the developed stem | tributaries feed the known river; no fabricated interior source for an entering river  | River develops surroundings       |
| captured settlements and communities    | society publication                                             | captured features, society record                                           | settlement-support realization (site search, bounded terrace, access)   | a usable local site visibly shaped into the terrain                                   | Town realizes support             |
| cover, soil, wetness                    | existing                                                        | existing                                                                    | habitat organization; hillslope binding and runoff response fed back to terrain and water | connected patches, valley meadows, tree line; round 2 terrain reads round 1 cover       | Feedback crosses rounds           |
| magic stocks, sources, coverage         | existing                                                        | existing                                                                    | idempotent evaluation against current media; tracked physical contributions | seven systems act through their media each round without ratcheting                    | All seven remain meaningful       |
| child's developed grain                 | regional publication                                            | child fields captured by its descendants                                    | descendant character record                               | a grandchild develops from the child's organization                                   | Descendants use their parent      |

## Schedule (spec 7)

```
capture context; establish surface; derive character
initialize once: grain, uplift intent, known peaks, river courses, settlement seats, magic stocks
round 1: broad organization   — long-wavelength relief, drainage, magic on the new media, cover
round 2: coupled responses    — relief reads cover/magic media, drainage, magic, cover; propose villages once
round 3: local consequences   — fine relief, supports for accepted places, drainage, magic, cover
final refresh: slopes, pits, routing, landforms, water geometry, habitats, magic classes, places
publish fields and features once; publish the child's grain for its descendants
```

## Decisions log

- 2026-11-01 Harness and cases frozen before any mechanism change; baseline run started on
  commit `4f7f654` plus the harness files only.
- 2026-11-01 User correction: no in-place patches to `refinement/`; the process is rebuilt in
  `packages/generation/src/regional` behind a failing guard test and the old namespace deleted.
- 2026-11-01 Shared media are natural copies plus a contribution ledger; magic systems split
  into prepare-once (materials, transport) and respond-per-round (fields from materials and
  the present medium). Captured Hallowed intensity does not spread again; only sources do.
  Aurora reservoirs come from captured stock, coverage and source only.
- 2026-11-01 Repeat refinement read the first run's published rivers as captured courses; the
  removed products of an earlier refinement are now excluded from the evidence.
- 2026-11-01 Ice-carved basins: bowls close below their outer rim, the rim is held against
  incision and creep, and inflows grade to the basin's water surface.
- 2026-11-01 A pure cosine band pattern across the grain rendered as a washboard; bands are now
  anisotropic noise with variable spacing that pinches out along strike.

## New namespace `packages/generation/src/regional`

Built behind `regional/refactorGuard.test.ts`; the old `refinement/` namespace is deleted
when the entry points switch. Behaviours the old modules handled, ported deliberately (ticked
when the new module carries them):

- [x] capture: pinned fields only; present-channel allowlist plus `magic:*`; extensive
      channels scaled by represented area; shared position lookup; cylinder compact chart
      and `periodicWidth`; society-only runs reuse the present grid layout; frame with
      coastal margin pinned on `map.extent`; resolution ladder with the frame/8 cap;
      `area.footprint` and `domain.scope` set to the frame.
- [x] workflow: regional_map/regional_parent diagnostics; `refinement.*` configuration ids;
      domain gating (physical, magic, built/cultural/political); cancellation and yield
      between steps; progress; feature/network/contour workspaces; source features copied
      into the map's features; retained places (protected, landmarks, placeId points,
      political layers) and removal of regenerated products with their reaches; final
      boundary with facts, publications, workspaces; band release.
- [x] terrain: datum from `seaLevel`; connected sea from frame edges and captured ocean;
      river inlets at edge samples with inward descent; captured lake basins; erosion and
      sediment channels; slopes; society-only runs leave terrain untouched.
- [x] drainage: priority flood with inlets as non-outlets; `drainageElevation`, `water`,
      `waterDepth`, `waterLevel`; flow and catchment with beyond-frame area at inlets;
      river qualification (map-sample threshold, strip test, headwater pruning counting
      inlets as already run); stream order; lake stage balance with seepage by fracture and
      rock; rivers cleared on water; floodplain and delta margins.
- [x] climate: lapse with developed relief; exposure on captured wind; moisture; soil from
      sediment; runoff regime kept; all derived from natural copies so rounds do not ratchet.
- [x] living: Ocean/Freshwater/Ice; climate cover for unclassified priors; cold relief to
      tundra; delta wetlands; tree/grass/wetland response to soil, slope, verdure, salting;
      natural surfaces (floodplain, scree, ridge, shelf/lake/glacier, resolved coarse
      surfaces); material codes; realized-lake mask; named habitats with land-share and
      hole rules.
- [x] magic: disabled systems zeroed; captured core features seeded with out-of-frame guard;
      deposit patterns; extensive stocks; origin sources; seven carriers; ward and tear;
      doors as features and network reaches; effects channels; material, ice, living,
      coastal and relief changes; meetings; classification, places and sites.
- [x] landforms: classes; summits by prominence with the resolved-body rule; cols; ranges
      and valleys as polygons under the footprint rule; waterfalls at knickpoints.
- [x] water geometry: ocean contour from connected membership; lakes per stage with the
      footprint rule; one river feature per stem; drainage reaches with downstream links.
- [x] places: society seats and events retained; occupation from community footprints;
      villages named through the naming cultures; local ways by A*; seam-safe geometry.
- [x] publication: channel-to-layer map; magic default layer; geography layers per kind;
      population layer definition.
- [x] features: naming (settlement/geographic), canonical seam geometry, network nodes at
      canonical positions.
