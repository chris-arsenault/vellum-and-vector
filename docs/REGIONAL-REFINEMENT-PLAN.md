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

| Case | Parent situation (fixed before any candidate ran)                                                                                                                                                                                                                                                                | Must expose                                                                                     |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| P1   | Constructed 1500×1000 km world at 200 km² samples: one NE-trending range dome, structural grain along it, glaciated north-eastern half, wet windward flank, southern coast, river Vell from the crest to the sea, town Harrowgate at its foothill exit, river Ash entering across the frame, summit Mount Carrow | Separate summits and cols, passages, feeding geography, a usable town site; not a noisier ridge |
| P2   | Constructed dry plateau (hard caprock, no grain, no glacial history, one volcanic cone) above an escarpment, grassy lowland, wooded coast, ephemeral river Dunmere to the coastal town Saltmere                                                                                                                  | Different spatial organization; water, material and habitat relationships; settlement support   |
| M1   | 100 km bin of the generated draft world (2000×1000 km, seed 73) with the most Fire and Aurora coverage, both present, inland                                                                                                                                                                                     | Interacting carriers and altered surroundings, not overlays or cancellation                     |
| M2   | Coastal 100 km bin with the most Pressure, Greenwood, Salt and Hallowed coverage, all present                                                                                                                                                                                                                    | Cross-domain organization of coast, water, habitat, deposits and kept geography                 |

Selections: P1 `[480000, 280000, 1020000, 680000]`, P2 `[500000, 320000, 1040000, 720000]`,
M1/M2 a 400×300 km rectangle centred on the selected bin. The world generation of
M1/M2 is the production handoff path for the new context (spec 4.3, 9.1).

Baseline (current code) renders and timings: recorded in
`.artifacts/regional/evaluation/baseline/report.json` once the baseline run completes;
the numbers are copied into the final report, not into this file.

## Input → producer → handoff → consumer → geographic effect → check

| Input                                                            | Producer                                                                                            | Handoff                                                                               | Consumer                                                                                                 | Geographic effect                                                                     | Check                          |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------ |
| `structuralGrainX/Y` (doubled-angle axial direction × coherence) | orogenic construction records its source boundary tangent on belt cells; carried by plate transport | `atlasChannels` binding, geology layer; regional allowlist; regional character record | terrain erodibility banding and along-strike relief modulation                                           | ridges and strike valleys follow the grain; separate summits along the belt           | Direction has an effect        |
| `tectonicStrain`, `glacialErosion`                               | existing                                                                                            | already published and allowlisted; previously unused by terrain                       | hillslope softening by reworking; recorded ice flow down the network (cirques, troughs, moraines, tarns) | lakes with a cause in glaciated high ground; none in dry unglaciated ranges           | Character changes organization |
| `volcanicConstruction`                                           | existing                                                                                            | add to the regional allowlist                                                         | dear ground in the network cost and constructional relief at local maxima                                | discrete cones instead of a smeared bump                                              | Character changes organization |
| captured `peak` features                                         | world landform publication                                                                          | captured features (retained point places)                                             | divide node (dear ground in the network cost); identity re-anchored to the realized summit               | an inherited significant peak organizes its massif                                    | structures survive interaction |
| captured `river` features and edge flow                          | world river publication, `riverOrder`/`flow`                                                        | source features; edge inlets                                                          | corridor in the network cost; entry discharge; identity and course carried by the developed stem         | tributaries feed the known river; no fabricated interior source for an entering river | River develops surroundings    |
| captured settlements and communities                             | society publication                                                                                 | captured features, society record                                                     | footprint caps on hillslope relief; channel drawn to river seats; re-siting within reach                 | a usable local site visibly shaped into the terrain                                   | Town realizes support          |
| cover, soil, wetness                                             | existing                                                                                            | existing                                                                              | habitat organization; hillslope binding and runoff response fed back to terrain and water                | connected patches, valley meadows, tree line; round 2 terrain reads round 1 cover     | Feedback crosses rounds        |
| magic stocks, sources, coverage                                  | existing                                                                                            | existing                                                                              | idempotent evaluation against current media; tracked physical contributions                              | seven systems act through their media each round without ratcheting                   | All seven remain meaningful    |
| child's developed grain                                          | regional publication                                                                                | child fields captured by its descendants                                              | descendant character record                                                                              | a grandchild develops from the child's organization                                   | Descendants use their parent   |

## Schedule (spec 7)

```
context: character; society seats; evidence (courses, lakes, summits, seats, entries);
         grow the network once (roots at established waters, process-term costs, capture passes)
round 1: broad organization   — relief derived from the network (established seats cap it), water, climate, magic, cover
round 2: coupled responses    — relief re-derived through round-1 media, water, climate, magic, cover; propose villages at network events
round 3: local consequences   — relief re-derived with proposed footprints, water, climate, magic, cover; support or drop proposals
final refresh: slopes, routing, climate, cover; landforms, water geometry, magic classes, habitats, places
publish fields and features once; publish the child's grain for its descendants
```

## Network-first core (2026-11-01 redesign)

The first build (noise-modulated uplift under a stream-power solver, features as kernels) was
rejected by the owner: "a shitty noise layer that feeds pre determined types", with feature
influence limited to the three examples already given. The replacement:

| Structure                                                                           | Development                                                                                                                                                                                     | Established features as terms                                                                                                                           |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| network (`network.ts`)                                                              | geodesic tree from roots over a process-term cost field; capture passes re-route through gathered channels                                                                                      | coast/edge/lake/sink roots; courses and channel raster as corridors; summits and cones as repulsion; river seats as attraction; entries carry discharge |
| relief (`relief.ts`)                                                                | increments per receiver (concave channel, material hillslope), amplification calibrated to the parent-span blur of the base, sideways hillslope coupling, monotone along the tree except basins | seat footprints cap the gradient; lakes are base levels; cones construct                                                                                |
| ice (`glacial.ts`)                                                                  | accumulation from lapsed climate and recorded history, flux down the tree, cirque/trough/moraine from flux                                                                                      | Aurora's held ice adds accumulation; present ice published for Aurora                                                                                   |
| seats (`seats.ts`, `evidence.ts`)                                                   | footprint caps, channel drawn to river seats, re-siting within reach keeping situation                                                                                                          | `sitedFrom` keeps the captured position across runs                                                                                                     |
| places (`places.ts`)                                                                | candidates at network events (site classes), hinterland competition by travel cost, proposals supported or dropped                                                                              | established seats hold their hinterland first                                                                                                           |
| evidence continuity (`courses.ts`, `extraction/water.ts`, `extraction/features.ts`) | own products regenerated each run; captured geography retained; a developed stem carries its captured course                                                                                    | repeat runs reproduce                                                                                                                                   |

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
- 2026-11-01 Owner rejected the uplift/solver build; network-first core replaces terrain,
  landscape and supports (see above). Bands are now a line integral along the grain.
- 2026-11-01 First network renders: grid-aligned straight channels in uniform country and
  parallel non-merging streams. Capture passes (gathered water cheapens its channel), ground
  heterogeneity scaled up on plains, edge roots starting with their remaining fall, and
  sideways hillslope coupling were added as process terms; the 8-direction metric remains.
- 2026-11-01 P2's plateau river spread the escarpment's fall along its whole profile: a step
  of the captured base steeper than any profile is now climbed in place (knickpoint term, not
  amplified). Edge roots are the lowest edge cells within a parent span and the parent's
  channel exits, not every edge cell. Captured courses are corridors over a share of the
  parent span, not one-cell trenches. Hillslopes are creep-shaped: steepest above the
  channel, flattening toward the divide, so sparse-channel country ends in flat tops.
- 2026-11-01 The hinterland competition was cut off after six rounds and then culled every
  still-unsupported candidate, so its outcome depended on the elimination order (P1 swung
  between 272 and 59 villages on an order-only change). It now runs until every remaining
  place is supported (bounded), removing the weakest half of the unsupported each round.
- 2026-11-01 Repeat runs differed because the first run deleted the parent's captured rivers
  as regenerated products. Captured geography is now retained; only `developedBy: regional`
  products are regenerated, and a developed stem that takes a course's identity carries the
  course (`capturedCourse`) as evidence for the next run.

## Regional refinement at world depth (plan of 2026-11-01)

Second delivery under this document. The network-first core (`b4d8163`) was adopted by the
owner as "distinctly better, about half way". This part plans the rest: a regional process
with the causal depth of world generation in every domain, not only terrain and rivers.

### Outcome and scope

A refined region shows, in every domain, geography that many processes made: ranges whose
ridgelines branch like an inverted river, valleys that rivers cut and left (dry valleys,
abandoned channels, terraces), coasts with coves and spits, habitats that grew, burned, flooded
and moved, magic acting through its media with the world's own engine, and a local society
whose villages, fields, ways and works came from living on that ground. The region is an
independent child map; its products belong to the child alone and the parent is never
written. The three-round schedule, the captured-evidence handoff, the no-ratchet ledger and
the frozen four-case evaluation stay.

Non-goals (product contract, 2026-10-30 correction, and owner statements of 2026-11-01): no
new world initialization, no tectonic reconstruction, no epoch replay, no society eras or
demographic growth, no parent-map writes, no porting of the whole world sequence. The goal is
similar complexity, reached by porting the world operators that fit a bounded regional round
and inventing the regional algorithms that have no world counterpart.

Authorization: planning only. Execution starts when the owner says so, one milestone at a
time through plan-phase.

### Context and reuse map

| Source of truth                                                                                                                                                                                                                                                                                                                     | What it gives this work                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/generation/src/canonry/field.ts`, `mesh.ts`, `atlasWorkspace.ts` (`createChildMesh`, `inheritNumerical`, `inheritChannels`), `atlasProjection.ts` (`projectNative`)                                                                                                                                                       | World operators take `(map: PhysicalField, c: PhysicalContext)`; the regional state carries the same field on a child lattice built by `createChildMesh`, so they run on a region unchanged (no bridge, no adapter).                |
| `canonry/fluvial.ts`, `surface.ts`, `massWasting.ts`, `floodplains.ts`, `deltas.ts`, `coastalEvolution.ts`, `coastalDetail.ts`, `landIce.ts`, `iceFlow.ts`, `glacialEvolution.ts`, `glacialLandforms.ts`, `landforms.ts`, `flowGraph.ts`                                                                                            | Portable physical operators: incision with sediment supply, erode/deposit bookkeeping, hillslope failure, floodplain and delta building, wave erosion and coastal detail, ice mass balance, flow and landforms.                     |
| `canonry/magicState.ts`, `magicProcesses.ts`, `magicSources.ts`, `magicPropagation.ts`, `magicStocks.ts`, `magicFeedback.ts`, `magicConfluences.ts`, `magicWeather.ts`, `magicSalt.ts`, `magicHallowed.ts`, `magicVeil.ts`, `magicRegions.ts`, `magicFeatures.ts`                                                                   | The world magic engine: located sources, carrier propagation, stocks, shared forcing on the field, meetings, storms, salt and hallowed writes, classification. The owner directed magic to follow the lore and this implementation. |
| `canonry/ecologyProcesses.ts`, `ecologyEstablishment.ts`, `ecologyGrowth.ts`, `ecologyMovement.ts`, `ecologyDisturbance.ts`, `ecologyCrossing.ts`, `ecologyGroups.ts`, `ecologyAnimals.ts`, `ecologyBiomes.ts`, `ecologyFeatures.ts`                                                                                                | The world ecology engine on the field: cohorts, growth by shared resources, travel-time movement, flood and fire disturbance, biome naming.                                                                                         |
| `societyGeography.ts`, `societyRound.ts`, `societyTempo.ts`, `societyEvolution.ts` (`societyCycle`), `societyDemand.ts`, `societyWorks.ts`, `societyWaterUse.ts`, `societyWays.ts`, `societyHazards.ts`, `societyCulture.ts`, `societyPolitics.ts`, `societyRuins.ts`, `societySites.ts`, `societySupport.ts`, `regionalSociety.ts` | The society engine reads surface channels directly and already has a bounded in-epoch "round" model with fixed scope, works by demand, ways by use, hazards, culture diffusion and politics.                                        |
| `packages/generation/src/regional/*` (`b4d8163`)                                                                                                                                                                                                                                                                                    | The adopted core: capture, evidence, network, relief, glacial, drainage, climate, living, seats, places, ways, magic reimplementation, extraction, schedule, ledger.                                                                |
| `docs/lore/magic.md`, `docs/lore/magic/*.md`, `.sulion-paste/regional-refinement-implementation-spec.md` §5–7                                                                                                                                                                                                                       | Magic behaviour per system; the schedule and support-realization rules.                                                                                                                                                             |
| `frontend/src/testSupport/regionalEvaluation.ts`, `regionalParents.ts`, `regionalParentWorld.ts`                                                                                                                                                                                                                                    | The frozen four-case harness (P1, P2, M1, M2), baseline renders and timings.                                                                                                                                                        |

Measured starting point (2026-11-01, read-only script over the source tree): world
generation runs 76 distinct processes, 417 invocations per default world, 15 mechanisms that
write elevation, drainage 8 times per epoch, 219 field members, 965 numeric parameters;
the regional core runs 13 step kinds, 23 invocations, one relief derivation, 65 channels,
144 parameters. By domain the regional side is 252 lines of ecology against 2,431, 1,563 of
magic against 4,640, 623 of society against 12,128. These numbers size the work; they are
not a target. No milestone is accepted by a complexity count (owner, 2026-11-01).

### Decisions

User requirements (source in brackets):

- Every domain refines at the regional scale with world-process depth; a physical-only
  framing is wrong [owner, 2026-11-01].
- Refinement writes the child map only; the parent map is never updated [owner, 2026-11-01;
  product contract line 8].
- Refinement is a distinct, bidirectional process: world establishes macro character, the
  region develops, established features influence their surroundings and are influenced
  back; many algorithms will be new; a number of world processes can be ported and reused;
  the goal is similar complexity, not porting everything [owner, 2026-11-01].
- No new world, tectonics, epoch replay or society eras; refinement adds actual terrain,
  coastal structure, smaller drainage, habitat patches and places [product contract,
  2026-10-30].
- Three rounds plus one refresh, prepare-once/evolve, no ratcheting [spec §7].
- Noise only breaks ties; features enter as process terms, never stamps [owner, 2026-11-01].
- Next-phase targets from the ADOPT review: trunk-and-branch ridgelines instead of a comb;
  rivers that carve and then dry, so rivers are not the only valley cause; coasts with coves
  rather than a smoothed shore [owner, 2026-11-01].
- Every world process is evaluated for inclusion, modification or omission before it enters
  refinement; the checklist is the boundary [owner, 2026-11-01].
- The complexity measure is a tool for understanding the work, never a goal to hit in a
  script; the open mechanism choices are the agent's to judge [owner, 2026-11-01].
- One consistent representation everywhere: the region uses the generator's existing
  storage-backed field, lattice and channel bindings; no separate regional grid, channel
  vocabulary or unit system, and no bridges or adapters between two representations
  [owner, 2026-11-01].
- No self-imposed browser memory budget shapes the design; residency is the block cache's
  job under its configured budget [owner, 2026-11-01].
- World code that does not work for a region is fixed in place, not worked around; the
  refinement processes live in the regional namespace, so the world sequence's loop control
  (epochs, phases, inherited guards) has no bearing on what a regional round may call
  [owner, 2026-11-01].
- The first milestone is pure software organization: a consistent representation and
  extracted reusable interfaces, so every later milestone builds on a clean, factored base
  [owner, 2026-11-01].

Agent-derived choices (revisable within the scope above; revised 2026-11-01 after the
per-process review below):

- **One representation: the regional state is a `GenerationState` whose geography is a
  `PhysicalField` on a child lattice.** Both earlier ideas (a mirrored field synchronized
  with a square grid; a lattice adapter with unit-converting views) are withdrawn. They were
  workarounds for a split the regional namespace itself created in `b4d8163`: a
  `RegularGrid` surface with its own channel names and units (`elevation` in metres,
  `temperature` in °C, `fracture` 0..1) beside the generator's `PhysicalField` (native units,
  143 bands, `atlasChannels` bindings, block-cache residency, `Lattice` adjacency). The
  generator already has everything a region needs: `createAtlasWorkspace` builds a child
  mesh (`createChildMesh`: an `AdaptiveLattice` refined to the requested cell size inside the
  frame, with the inherited exterior as context), `inheritNumerical` fills the field from the
  parent grids through the same channel bindings the world publishes with, `projectNative`
  writes the field back to an `AdaptiveField` surface the frontend already renders, and the
  `BlockCache` pages bands under its configured budget. Every regional process (network,
  relief, drainage, glacial, climate, living, seats, places, ways, magic, extraction) is
  re-expressed on `PhysicalField` + `Lattice` in native units; the `RegularGrid` surface,
  `channel()`/`naturalChannel()`, `gridNeighbors`, the regional `conditions.ts` conversions
  and every per-domain unit table are deleted. World operators then run on the regional
  field as written. Physical results that the per-round relief derivation would otherwise
  erase enter as increment terms or ledger totals (the ledger moves onto native bands).
- **Round time.** Only the ecology engine needs a duration (growth, soils, carbon, fire are
  per-year). It gets a declared development horizon per round, a reach rather than history,
  fixed in code and never scaled by depth or quality (values decided below). Every other
  ported formula with `years` is rewritten as a target share or dropped.
- **Persistent regional state.** Incision memory, sediment thickness, abandoned-channel
  memory, shore state, ice thickness, ecology cohorts and soil pools, society hinterlands,
  connection wear and realized works persist across the three rounds in the state record.
  None of it is published to the child's fields (repeating a refinement must reproduce it);
  the ledger governs every write into a shared medium.
- **Reusable interfaces extracted from the three engines, loop control left behind.** The
  physical operators already take `(map: PhysicalField, c: PhysicalContext)` and need only a
  round context (no epochs). The ecology engine is on the field in 13 of 16 files; its three
  `GenerationState` users are the process wrappers and feature extraction, and the per-step
  functions become the engine's exported surface. The magic engine reads
  `state.physical.magic`, the systems and the feature reader through `GenerationState` in 19
  of 24 files: those reads are gathered behind one host interface (field, magic workspace,
  systems, features, seed) that the world sequence and the regional round both implement,
  while epoch phases, stock advances and history stay in the world's sequence files. The
  society engine reads `state.society`, `state.physical` (31 sites) and surface channels
  (11 sites) across 47 of 51 files: the same extraction, with the 17 `inherited` guards
  deleted from the pieces (they encoded the old world-runs-the-child policy; children no
  longer take that path) and the legacy child branch in `atlasWorkflow.ts` removed. Society
  functions that assume a world (a 500-resident gate, a parent-reach channel index, a
  world-scale market reach) are fixed where they are, parameterized through the host, so
  world and region share one implementation.
- **Magic through the world engine, by operation.** The world engine's propagation, warding,
  shared forcing, confluence evaluation, strain and door pairing, and classification run on
  the regional field from captured stocks and places; its budgeted locators, stock advances,
  history and per-epoch additive writes do not (checklist). The regional ledger forms of
  Salt, door publication and site classes stay.
- **Society as a regional round over the shared engine.** Communities are the captured seats
  and the proposed villages with fixed populations; the round calls partition, support,
  demand realization, ways by use, siting, naming and inheritance through the host interface
  and adds the local works and places listed under new processes.

Open points decided by the agent (owner, 2026-11-01: "you need to be the judge of this"),
each revisable if the evidence at the milestone contradicts it:

- **Ecology development horizons:** about 250 years in round 1 (one broadleaf lifespan, so
  the climate-limited mosaic establishes), 60 in round 2 (coupled response after relief and
  water moved) and 20 in round 3 (young regrowth after fire stays visible at extraction).
  Fixed constants, declared as reach; the carbon pools run the full total once in round 1.
  Evidence that would change them: round 3 renders showing no transient (all cover at its
  ceiling) or round 1 failing to reach the parent's forest extent.
- **Work kinds:** the domain union gains `mill`, `ford`, `bridge`, `terrace`, `embankment`,
  `drain` and `canal` with publication and style entries. Mislabelling them as dams and weirs
  would put wrong names on the map for the sake of avoiding a schema change.
- **Reshaping ground:** established seats may reshape bounded ground as the spec already asks
  (terraces along the contour with cut and fill, an embankment on the river side, drained
  marsh, one breakwater cell); proposed villages may do so only in round 3 within one cell.
  Total change per seat is capped by footprint and gradient, and the existing "town support
  without regional flattening" check stays.
- **Seasonality:** the world field has a `Seasonality` band but no published channel binding;
  M4 adds the binding and the capture entry (a small, mechanical change), and the 7.5 °C
  fallback remains for parents generated before it.
- **Complexity measure:** stays a scratch script used to size the work. It is not a harness
  output and never an acceptance condition.

Provisional assumptions and how they are checked:

- The re-expressed regional core on the child lattice reproduces the `b4d8163` renders in
  organization (not bit for bit: face-shared adjacency replaces eight-neighbour arithmetic)
  within Gate C (checked in M0 on the four cases).
- The three engines' loop control separates from their operations without behaviour change
  on the world (checked in M0 by the world suite and the generation-wizard browser journey).
- Each shared medium (ocean distance, aspect, cold pooling, wetness, fracture set) changes a
  consumer observable on P1 or M1 within Gate C (checked in M1 per medium).
- Gate C holds (regional ≤ 2.0× the `b4d8163` candidate) with the per-round Dijkstras bounded
  as the checklist states (checked each milestone on the four cases).

### Process checklist (2026-11-01 per-process review)

Every world process was evaluated for the region on eight dimensions: regional sense (does
it organize anything inside a frame), resolution and parameters (does it hold at 0.2–4.8 km
cells against the world's 14 km), start from existing geography (what must change so it
reads the captured parent instead of initializing), bidirectional ties, no-ratchet across
rounds and repeated refinements, cost per pass at 100k–400k cells, port path, and lore or
spec coverage. The full evaluations (six files, ≈350 KB, with line references) are kept
outside the repository at `frontend/.artifacts/regional/process-review/eval-*.md`; this
checklist is the binding summary. Nothing outside it enters regional refinement without
being added here first.

Verdict vocabulary: **INCLUDE** (world function on the regional field as written),
**MODIFY** (world mechanism with the stated changes), **REPLACE** (the need is real, the world
mechanism is not; a new regional process in the list below), **KEEP** (the regional
implementation already is the right form), **LEAVE OFF** (no regional behaviour, or forbidden
by the contract). The last column is the milestone that owns the row.

Three findings apply to every row. (1) `areaBudget` floors at one, so any budgeted world
locator run on a region invents one feature per map (a plume, a crater, a Fire core, an ocean
locus, a rogue wave); such strategies are excluded by table, never by parameter. (2) Relief,
cover, flow and elevation are re-derived every round, so a ported `+=`, `*=` or direct write
vanishes or ratchets; every physical effect is an increment term in the derivation or a
ledger total. (3) Thresholds stated in world flow-accumulation units, cells or epochs are
restated in metres, m³/s or cell area; thresholds in metres and gradients carry over.

#### Terrain and material (geology slice, 18 processes)

| Process                                       | Verdict                          | Regional sense, start from captured geography                                                                                                                                                                                                                                                                    | Resolution and parameters                                                                                                         | Ties and persistence                                                                                                | M   |
| --------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --- |
| mass-wasting (`massWasting`, `hillslopeFlux`) | INCLUDE, parameters MODIFY       | Failure of oversteepened ground with talus at the foot: knickpoint steps, cone flanks, trough walls, cliffs and incised channel walls stand at any angle today. One capped pass restricted to cells above the stable gradient, as a hillslope increment term after `keepDrainable`.                              | Stable gradient and 10 km transport length are geographic; the volume budget scales with cell area; no relaxation to convergence. | Cover binding (tree, grass) raises the stable gradient; failed material enters sediment supply; derived each round. | M2  |
| volcanic-construction                         | MODIFY (extend regional cones)   | Add what the region lacks: the caldera cut as a closed-basin root and crater-lake candidate, the hard apron and lava plateau, flank rock. From captured `volcanicConstruction` only; the plume draw is excluded.                                                                                                 | Invert the captured per-cell mean construction by volume per cone, not by amplitude (scale inversion risk).                       | Cones repel the network; apron hardness enters material bands; caldera is a drainage root.                          | M2  |
| geothermal                                    | MODIFY (re-derive from naturals) | Fire and spring sites read geothermal that must respond to the regional fracture set and cone conduits. Base is the captured value; add the fracture and conduit terms as deltas; drop plume and boundary terms (not captured).                                                                                  | Fracture term on the regional 0..1 fracture; metres and ratios otherwise.                                                         | Fracture (M1) and magic cracking → geothermal → Fire cores and hot-spring events; derived each round.               | M2  |
| landmark.emplace                              | MODIFY → landmark evidence       | Captured landmark records (mountain, dome ring, impact ring, escarpment, canyon, falls, magic source) become evidence like summits and courses; siting runs only at top-level maps, so no new landmarks. Shape through crest caps, fault lines in the fracture set, repulsion and corridor terms, never a stamp. | Signatures are metres (prominence, throw, depth, drop) and carry over; `shapeImpact` stays available to the impact ring.          | Repulsion and corridors in the network cost; caps in relief; faults in the fracture set.                            | M2  |
| landmark.maintain                             | MODIFY → landmark support check  | Each round's structure phase measures the signature shortfall and applies the smallest correction through increments or the ledger (spec §9.2 working structures survive).                                                                                                                                       | Metre thresholds.                                                                                                                 | Re-evaluated per round; never accumulates.                                                                          | M2  |
| fracture-network                              | REPLACE → regional fracture set  | One fracture geography for rock, water and Fire (spec §5.2); today the child reads only the parent's 10 km corridors smeared by interpolation. See new process G1.                                                                                                                                               | World roots are `areaBudget`-drawn and scored on `Uplift`/`RidgeInfluence` (not captured).                                        | Consumed by material resistance, network cost, geothermal, Fire conduits, Veil strain.                              | M1  |

Left off, with the reason class: tectonic-provinces, continental-sutures, tectonic-margins,
continental-domains, tectonic-uplift, orogenic-construction, plate-advection,
tectonic-epoch-activity (tectonic reconstruction and epoch replay are forbidden; their
inputs are never published; their macro products already sit in captured elevation, rock,
grain and strain); landscape-initialization (would discard captured rock and histories;
`inheritNumerical` and `initializeInheritedMaterial` are the admissible helpers);
mantle-plume-roots and impact-cratering (`areaBudget` floor invents one per region);
crustal-support and lithospheric-flexure (tens of metres over tens of km on a synthetic
crust thickness, fighting the base calibration).

#### Water, sediment and coast (21 processes)

| Process                        | Verdict                   | Regional sense, start from captured geography                                                                                                                                                                                                                                              | Resolution and parameters                                                                               | Ties and persistence                                                                                         | M   |
| ------------------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --- |
| runoff                         | MODIFY                    | Port the loss structure (cover interception, infiltration and evapotranspiration, wetland and peat hold, warm-river evaporation) over the captured budget as baseline; today runoff ignores developed cover, so no water path crosses rounds.                                              | Per-year mm terms are scale-free.                                                                       | Cover and soil (M4) → runoff → channel qualification and floodplain width next round.                        | M2  |
| river-network                  | MODIFY (two terms)        | Adopt the slope factor (gullies start earlier on steep ground, later on plains) and the `incoming` hook for entering rivers; keep regional thresholds and the network.                                                                                                                     | `sqrt(slope/reference)` clamped; thresholds stay in cells × cell area by the regional convention.       | Reads runoff and relief; feeds drainage.                                                                     | M2  |
| ancestral-fluvial-erosion      | MODIFY                    | `erodeTriangle` + `recordCut` + `surfaceResistance` as a per-round channel increment term along the regional tree with incision memory and sediment supply as persistent state; drop the 13× re-conditioning loop.                                                                         | Stream-power exponents carry; per-pass cap rescaled to the cell span; base level is the captured datum. | Incision memory steers routing (new W2); supply feeds transport; memory recomputed from evidence each run.   | M2  |
| post-fluvial-mass-wasting      | MODIFY (narrow)           | Same as the geology row; one capped failure pass, no second diffusion.                                                                                                                                                                                                                     |                                                                                                         |                                                                                                              | M2  |
| sediment-transport             | INCLUDE                   | Along the regional tree in source-to-outlet order: alluvial floors, fans at the escarpment foot, filled basins, mouth loads for new process W3.                                                                                                                                            | Slope threshold is a gradient; deposition length is geographic; cap rescaled.                           | Reads incision supply; feeds floodplain and mouth form; deposits through the ledger.                         | M2  |
| river-floodplains              | MODIFY                    | The BFS valley floor (ground within metres of the channel, same basin, bounded width) reading sediment replaces the one-ring `channelMargins` stamp, so filled valleys widen and terraces appear.                                                                                          | Metre criteria carry; maximum width is geographic.                                                      | Reads sediment; feeds ecology flood severity and society fields.                                             | M2  |
| river-delta-formation          | REPLACE → mouth form (W3) | The world layer classifies and builds nothing; the region needs estuary, delta or barred lagoon decided by sediment delivery against exposure. Keep the qualification rule.                                                                                                                |                                                                                                         |                                                                                                              | M3  |
| ocean-distance                 | INCLUDE                   | A grid distance transform to the present coast; a shared medium for coast, maritime moderation, Salt spray, Pressure fronts and salt marsh. Not captured today.                                                                                                                            | Metres.                                                                                                 | Recomputed when the shore moves.                                                                             | M1  |
| bathymetry                     | MODIFY                    | Regional depth classes the coast process produces (shoal and intertidal, bay and nearshore, shelf); world 210/430 m zones rarely occur inside a frame.                                                                                                                                     |                                                                                                         | Pressure rays and harbour siting read it.                                                                    | M3  |
| landmasses-and-shelf-groups    | MODIFY (trivial)          | Components at extraction so islands, skerries and tombolos become named features; the frame-touching mass is mainland.                                                                                                                                                                     | Footprint rule, not 10,000 km².                                                                         |                                                                                                              | M3  |
| external-coastal-forcing       | MODIFY (fold into coast)  | Pressure's coastal effect is one more exposure term in the single coast process, through the ledger.                                                                                                                                                                                       |                                                                                                         | Magic (M5) → coast.                                                                                          | M3  |
| coastal-erosion-and-deposition | MODIFY (skeleton of W4)   | Exposure at the shore, differential cut by material, redeposition in shelter: the process that makes coves, headlands, spits and bars. Exposure must be computed on the regional sea (fetch along the captured wind, shelter by the present coast), not the 14 km captured `waveExposure`. | Cut per pass rescaled; resistance from regional material bands and wards.                               | Reads material, grain, wind, river loads; moves the shore → network re-root follow-up; shore state persists. | M3  |

Left off: drainage-conditioning, flow-routing, ocean-connectivity, lake-basins (regional
equivalents exist; the world corridor is noise and the world lake qualifiers would delete
regional lakes); drainage-guidance (its inherited-valley weight is borrowed by W2);
river-channel-geometry (world raster belt, 8–100 cells wide here; keep `channelDimensions`);
continental-margin-evolution and marine-sedimentation (shelf-scale, done by the parent;
longshore building belongs to W4); coastal-detail (noise drawn as geography, the likely
source of the old coves; replaced by W4).

#### Climate and ice (17 processes)

| Process                              | Verdict                          | Regional sense, start from captured geography                                                                                                                                                                                                                | Resolution and parameters                                                               | Ties and persistence                                                                                 | M   |
| ------------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --- |
| temperature                          | REPLACE (keep three pieces)      | Lapse the captured temperature on developed relief, add aspect and cold pooling (C2, C3) and the ledger; keep the lapse constant, `seasonality()` and `snowShare()` as pure functions. The world rebuilds from a global baseline with six uncaptured fields. | 6.5 °C/km.                                                                              | Read by ice, Aurora, ecology, Salt desiccation.                                                      | M1  |
| atmospheric-flow                     | MODIFY                           | `deflectWind` and `windSpeed` on the captured wind direction instead of circulation plus noise: valley channelling, lee shelter, crest exposure.                                                                                                             | Terrain smoothing lengths rescaled to the regional span.                                | Feeds moisture transport, fire spread, dispersal, dust, drift.                                       | M3  |
| moisture-transport                   | MODIFY (core of C1)              | Column march downwind on the captured wind with boundary columns from captured moisture × saturation (not 0.5), blur calibration so the frame's total matches the parent.                                                                                    | Orographic term scale-free to first order; `smoothMetric` cost replaced by a grid blur. | Windward and lee contrast → runoff, snow, ecology; derived each round.                               | M3  |
| precipitation                        | MODIFY                           | `snowShare` on the lapsed temperature so new high ground turns rain into snow; captured rainfall is the baseline, no multiplier; fog drip from C6.                                                                                                           |                                                                                         | Snow → snowline and ice budget.                                                                      | M3  |
| land-ice-mass-balance                | REPLACE → local snowline (C4)    | World thickness is a pass counter (250 m per pass) and its concavity term scales with cell area; replace by an equilibrium-line and scale-free thickness from the climate on developed relief.                                                               |                                                                                         | Reads snow, temperature, aspect, cold pooling, Aurora persistence; thickness persists across rounds. | M3  |
| ice-flow                             | INCLUDE, thresholds MODIFY       | Steepest descent on the ice surface (bed + thickness) so ice crosses cols and spills between basins; the regional version routes down the drainage tree and cannot.                                                                                          | Flux thresholds per cell area, not per world cell.                                      | Flux → erosion, deposition, Aurora capacity.                                                         | M3  |
| glacial-erosion                      | REPLACE (keep power expression)  | Keep the power term including the Aurora charge factor; read regional rock; apply as an increment inside the derivation, not a cumulative cut (ratchet) nor a per-pass cap that forbids a 200 m trough.                                                      |                                                                                         | Carves troughs and cirques; eroded volume carried to the terminus.                                   | M3  |
| glacial-deposition                   | MODIFY                           | Terminus rule with the eroded volume spread over a terminus arc through the ledger; the regional moraine is a one-cell drop unrelated to erosion.                                                                                                            |                                                                                         | Moraines close basins → lakes, bogs, cold pooling.                                                   | M3  |
| glacial-meltwater (+ glacial-runoff) | INCLUDE, units MODIFY            | Melt supply into runoff so glacier-fed streams and proglacial lakes exist; today channels below ice qualify no sooner than dry slopes.                                                                                                                       | Per-mille → m/yr; the epoch hydrology knob dropped.                                     | Ice → runoff → drainage.                                                                             | M3  |
| glacial-landforms                    | MODIFY                           | Cirque, trough and moraine classes at extraction with regional reach; the regional classifier knows none of them.                                                                                                                                            |                                                                                         | Visible to inspection, naming and descendants.                                                       | M3  |
| landform-classification              | LEAVE OFF world, extend regional | The regional classifier has regional thresholds; add glacial and coastal classes, fjord as a drowned trough.                                                                                                                                                 |                                                                                         |                                                                                                      | M3  |

Left off: ocean-currents and warmth-sources (200–600 km kernels and seeded decoration; the
captured values carry), sea-ice (carry the captured value; stop `writeIce` erasing it),
physical-epoch-history (a round is not an epoch; instead publish the child record for
descendants: present ice, glacial erosion at the child's scale, grain), structural
validation (its invariants become test assertions).

Defects found in the current regional code, fixed in M1: Aurora ice double-counted
(`glacial.ts` lines 80–82 and 224), captured sea ice erased by `writeIce`, sediment zeroed
every derivation (line 182), cirque depth tied to the parent span, `climate.ts` never
re-splits snow, `rock` defaults to 1 while captured rock is `RockResistance/4000` ≈ 0.25,
`tectonicStrain` captured but unconsumed.

#### Ecology (17 operations)

| Operation                            | Verdict                        | Regional sense, start from captured geography                                                                                                                                                                                                                                               | Resolution and parameters                                                                          | Ties and persistence                                                                                                    | M   |
| ------------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --- |
| ecology-initialize                   | REPLACE → regional initializer | World `founders` is 70 km noise plus a soil floor. Fill cohorts from captured cover (conifer share by captured biome and temperature, saplings by canopy age), seeds from presence, soils and carbon direct, captured habitat polygons as presence floors not clamps. Once, before round 1. | No noise scale at all.                                                                             | Cohorts, seeds and soil pools persist across rounds.                                                                    | M4  |
| evolve/respond wrapper               | MODIFY                         | Keep the order soils → disturbance → flood → dispersal → growth → carbon → present → classify; drop animals and crossings; duration = declared horizon; forcing and authority from regional readers.                                                                                        | Horizon per round (owner decision).                                                                | The round's state is the previous round's bands, never the captured prior (spec §7.3).                                  | M4  |
| evolveSoils                          | MODIFY                         | Keep soil water, weathering and nutrient replenishment; damage from this round's ice flux and incision instead of cumulative history; drop the verdure term already ledgered regionally.                                                                                                    | Metre scales carry; year rates under the horizon barely move soil depth (captured soil respected). | Infiltration and evapotranspiration feed runoff (M2 row); reads relief, climate, Salt.                                  | M4  |
| disturbEcology (fire)                | MODIFY                         | Keep spread, barriers and burn; replace the 45 km noise ignition by cause cells (Fire heat, driest exposed ground, settlement edges) with one stable keyed draw each.                                                                                                                       | 15 km/yr spread × fuel × wind is physical; the fire-season window stays.                           | Water and marsh stop fire; burns → cohorts → young regrowth; fire → erodibility and runoff next round.                  | M4  |
| floodEcology                         | INCLUDE                        | Channel margins become riparian wetland and flood meadows exactly as wide as the resolved floor.                                                                                                                                                                                            | Floodplain and delta already 0..1; runoff m/yr → mm.                                               | Reads drainage; set per pass.                                                                                           | M4  |
| dispersePlants + ecologicalFront     | MODIFY                         | Fronts only for groups absent from the frame or newly suitable ground (tarns, above the old tree line); no sea crossing.                                                                                                                                                                    | Metres per year; waterborne along `drainage.receiver`.                                             | Reads water, ice, wind; recomputed from presence each pass.                                                             | M4  |
| growCommunities + groupSuitability   | INCLUDE                        | Four groups competing for light, nitrogen, water and soil depth with differing tolerances: valley meadows, conifer sides, savanna under fire, scree barrens. Cohorts give even-aged regrowth.                                                                                               | Rates per year under the horizon; soil-depth thresholds in metres.                                 | Feeds relief softening, runoff, roots, Salt, society support; nutrients near balance over three rounds; cap canopy age. | M4  |
| accumulateOrganicMatter              | INCLUDE                        | Peat in valley heads, behind moraines and in abandoned channels; soil carbon raises water capacity and fertility.                                                                                                                                                                           | Carbon horizon run once with the total in round 1, short afterwards.                               | Peat → runoff hold, Salt brine retention.                                                                               | M4  |
| ecology-present                      | MODIFY → derived refresh       | Cover under new water, ice or sea dies at once with litter to soil; the content of each round's refresh and the final one. Drop initialize, river warmth, toxicity.                                                                                                                         |                                                                                                    | Idempotent per state.                                                                                                   | M4  |
| classifyBiome                        | INCLUDE as is                  | Replaces `living.ts` naming whose thresholds (0.3, 0.55) differ from the world's (0.15, 0.4) and so rename the parent's forests at margins for no reason; magical biomes read the regional effect channels.                                                                                 |                                                                                                    | Names only.                                                                                                             | M4  |
| biomeRules / feature extraction      | KEEP regional outlines, MODIFY | Keep the grid contour machinery in `extraction/habitats.ts`; take membership and names from `biomeRules`-style rules over cohort bands and area means (Bog, Floodplain marsh, Montane forest, Savanna).                                                                                     | Land-share rule carries.                                                                           |                                                                                                                         | M4  |
| environment() / potentialEvaporation | INCLUDE as is                  | The hub every term reads; regional exposure media (aspect, cold pooling, wetness) go upstream into the media it reads, so ecology, Aurora and ice see one organization.                                                                                                                     | Slope and fill-depth scales physical; seasonality fallback without capture.                        | Cache one evaluation per cell per pass.                                                                                 | M4  |
| forcing() / magic bindings           | MODIFY                         | Rebuild from regional intensity and effect channels and `state.magic.systems`; Aurora held-charge gate from the regional reservoir.                                                                                                                                                         |                                                                                                    | Magic → every ecology term; re-evaluated per round.                                                                     | M4  |
| coverAuthority / applyWoodlands      | MODIFY                         | The child's own authored protections stay authoritative; the parent's captured forest polygons are evidence, not clamps.                                                                                                                                                                    |                                                                                                    |                                                                                                                         | M4  |
| riverWarmth                          | REPLACE → new process X2       | A down-tree warmth pass over `drainage.order`; see magic new processes.                                                                                                                                                                                                                     | 60 km e-folding stays geographic.                                                                  |                                                                                                                         | M5  |

Left off: applyToxicity (no regional producer until M5; add then), evolveAnimals and
migration (nothing captured; eight Dijkstras for a second-order effect; browsing arrives as
a forcing term from society clearance), sea crossing (continental reaches; islands carry
their captured cover), ecology-burial (million-year doses), record and validate (keep the
invariants as a test). The present `living.ts` (`respondCover`, `displacedPrior`,
`coverName`) is a parent class with noise-warped edges and is retired except the surface
naming helpers, the realized-lake cells and the floodplain surface rule.

#### Magic (31 operations)

| Operation                                          | Verdict                                 | Regional sense, start from captured geography                                                                                                                                                                                                                                                               | Resolution and parameters                                                                                                     | Ties and persistence                                                                        | M   |
| -------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --- |
| magic-initialize (`createMagicField`, inherit)     | MODIFY                                  | Inherit intensity, source, stocks, coverage and carried channels from captured `magic:*`; also mark captured heat and melt as applied (`rememberAppliedHeat`) and seed `located` and `doors` from captured cores, seats and doors, which inheritance does not.                                              | Extensive stocks cross as density × area; bands live in the block cache like every other field; allocate for enabled systems. | Feeds everything; captured heat applied once prevents double heating.                       | M5  |
| locateMagicSources frame                           | INCLUDE frame, strategies by row        | Clears and re-derives each evaluation (no ratchet). Skip `mirrorHeldStocks` for origins whose stock was captured.                                                                                                                                                                                           |                                                                                                                               |                                                                                             | M5  |
| source: geothermal                                 | REPLACE → captured-core release         | `areaBudget` plus the strongest-heat fallback guarantee a new core per region. Cores from captured `fire:core` features and held stock × exposure × release; keep `exhumedSpent` and the sealed reading.                                                                                                    | Spacing and maximum counts are world; release shares scale-free.                                                              | Erosion re-exposes cores; feeds fracture propagation.                                       | M5  |
| source: impact (release part)                      | INCLUDE                                 | No events on a region, so nothing seeds; release from captured fallen stock by strain, ice and frost cracking.                                                                                                                                                                                              | Shares scale-free; epoch fan barrenness off.                                                                                  | Ice and frost from regional glacial and climate change release each round.                  | M5  |
| source: forge                                      | INCLUDE                                 | Pure read of captured cracked stock; no cooling advance.                                                                                                                                                                                                                                                    |                                                                                                                               |                                                                                             | M5  |
| source: cold (Aurora input)                        | INCLUDE                                 | Derived from regional temperature and elevation each round, so charge follows developed high ground and Fire heat lowers it next round.                                                                                                                                                                     | Native units throughout; nothing to convert.                                                                                  | True Fire ↔ Aurora coupling.                                                                | M5  |
| source: verdant                                    | INCLUDE                                 | Old canopy and deep peat (captured) and the living round's cover.                                                                                                                                                                                                                                           | Scale-free.                                                                                                                   | Cover → stands → roots → verdure → cover.                                                   | M5  |
| source: aquifer                                    | MODIFY                                  | Spring line rule with the regional network's catchment replacing the world flow-accumulation threshold; `springRises` kept. Or keep regional `springStrength`, which already does this.                                                                                                                     | `springFlow` restated against `network.flow`.                                                                                 | Springs move when the network re-roots; feed roots and site classes.                        | M5  |
| source: strain (Veil)                              | MODIFY                                  | Right process; `strainAt` measures fronts per neighbour, so a 2.4 km grid reads ≈6× weaker fronts than the world. Normalise per metre × parent span. Regional `localStrain` has the same defect and lacks the meeting term.                                                                                 | Tear thresholds on the normalised scale.                                                                                      | Reads all systems after warding and meetings; `wild` = round-to-round shift.                | M5  |
| source: pairing (doors)                            | MODIFY                                  | Keeps established doors while both ends qualify (what the region needs) once `field.doors` is seeded from captured door features; a far end outside the frame is a one-ended access. Scale door count by frame area; distance ≥ parent span.                                                                | 300 km door distance exceeds a frame.                                                                                         | Reads Fire, warding, Aurora stored, wild; feeds society ways (new X4).                      | M5  |
| propagateMagic frame                               | INCLUDE                                 | Derive-each-time; adds captured `stored` as the relict field.                                                                                                                                                                                                                                               | Activity factor 1 (no epochs).                                                                                                |                                                                                             | M5  |
| propagation: fracture, roots, radial, local, brine | INCLUDE as is                           | Metre-based costs; veins become visible branching structures on a fine grid; roots stop at rock, water, ice. Regional `spreadFire` and `spreadRoots` are transcriptions and go.                                                                                                                             | Native `FractureConductance` throughout.                                                                                      | Reads fracture written by meetings and rock feedback in earlier rounds (cross-round check). | M5  |
| propagation: cold drainage                         | INCLUDE (boundary caveat)               | Warmest-first sweep reading regional ice and temperature each round, so Aurora follows developed cirques; the regional `drainCharge` runs once and loses the coupling. Charge from cold ground outside the frame comes in through X1.                                                                       | Geographic retention lengths; accumulation-area normalisation keeps it resolution-consistent.                                 | Ice ↔ Aurora via `holdIce`; `retained` never gathered into stock.                           | M5  |
| propagation: ocean rays                            | MODIFY                                  | `traceOceanBeam` is the lore (rays, coast reflection, decay, wakes); strip the three `areaBudget` source draws. Rays only from captured loci inside the frame and boundary inflow (X1). Headings are not captured: the captured field is the floor, the retrace adds re-reflection near changed coast only. | 20 km beam ≈ 8 regional cells; `Feature.Shoal` reflection needs a regional shoal class (bathymetry row).                      | Developed coast changes reflections next round.                                             | M5  |
| ward propagation + applyWarding + markRim          | INCLUDE                                 | Rings from captured seats as located sources (radius `wardReach×strength/1000`), lines where sourced; scales other fields inside and lays the removed amount on the rim. Replaces the regional fixed-factor ward and slope-cost spread.                                                                     | Rim is one cell: see X3 for a geographic band.                                                                                | Hallowed must evaluate first each round; derived, no ratchet.                               | M5  |
| advanceStocks and reservoir advances               | LEAVE OFF per round; REPLACE once → X2' | Every advance is epoch time (one hop per epoch, decay shares). Replace by a one-time resolution of captured stocks onto carriers (new X2').                                                                                                                                                                 |                                                                                                                               |                                                                                             | M5  |
| evaluate phases / lapse                            | LEAVE OFF split; INCLUDE one evaluation | One evaluation of every enabled system per round, Hallowed first and Veil last (the regional order already does this).                                                                                                                                                                                      |                                                                                                                               |                                                                                             | M5  |
| magic-rocks (rock feedback, conduit evolution)     | MODIFY                                  | Hardening and weakening as a ledger total, not `+=`; conduit opening as a declared fracture total; sealing is an epoch budget (off; respect captured `sealed`). Declare the delta from captured intensity, since captured rock already holds the parent's hardening.                                        | Rock 0..1000 vs regional ratio: one conversion.                                                                               | Rock → relief next round; fracture → Fire conduits and meetings.                            | M5  |
| thermal feedback                                   | INCLUDE as is                           | Already a replace-contribution; `melt` reset each round; `heldCharge` gating that the regional version lacks (regional Aurora cools at full intensity everywhere).                                                                                                                                          | Native units.                                                                                                                 | Temperature → ice, climate, Aurora input, living.                                           | M5  |
| living feedback                                    | INCLUDE                                 | Quickening, stillness, verdure, salting, warding, tearing plus the braided reach (max, idempotent). Consumers arrive with M4; the regional `living.ts` reads only salting and verdure today.                                                                                                                |                                                                                                                               | Magic → ecology medium.                                                                     | M5  |
| ocean feedback                                     | MODIFY                                  | Upwelling where rays shoal, sea-surface cooling, fog on the facing land, wake warming; replace-previous. Needs regional depth classes and a storm consumer (X5); fog reach geographic rather than one cell.                                                                                                 |                                                                                                                               | Fog → ecology; sea temperature → climate; storm → X5.                                       | M5  |
| magic-history (`holdIce` only)                     | LEAVE OFF except `holdIce`              | `IcePersistence` from stored charge and shelf stock as a per-round derived read into the ice budget (C4); history, stored, first-epoch and thaw subsidence are epochs.                                                                                                                                      |                                                                                                                               | Aurora → ice.                                                                               | M5  |
| magic-coast                                        | MODIFY                                  | Shore forcing and `wardCoasts` (warded shores hold) writing a declared total; drop coastal history. Consumer is the coast process (W4).                                                                                                                                                                     | Currents not captured → current term 0.                                                                                       | Magic → coast → rays.                                                                       | M5  |
| confluences (evaluate + apply)                     | INCLUDE evaluation, MODIFY writes       | ADR 0007 meetings as processes with displacement and bounding (the regional `meetingEffects` lacks both, so parents keep full coverage); writes (fracture, rock, relief, soil, coast, fog, melt, debris, toxicity) through the ledger; relief sign hash per cell, not per round.                            | Strain term uses the normalised strain.                                                                                       | Meeting → fracture → conduits; → soil, toxicity → ecology; → relief → reroute follow-up.    | M5  |
| storm writes                                       | MODIFY → X5 consumer                    | Scour, dunes and lee drying on the captured storm track deflected by wards and pinned by stillness, through the ledger.                                                                                                                                                                                     | Dunes one downwind cell per evaluation.                                                                                       | Soil → ecology; dunes → relief.                                                             | M5  |
| salt writes                                        | KEEP regional (ledger) and fix          | Regional glass, collapse and desiccation totals are the right form; the Fire burn is double-counted (stock reduced in preparation, intensity scaled again per round): burn once.                                                                                                                            |                                                                                                                               |                                                                                             | M1  |
| hallowed writes (`spillBelow`, storm rim)          | MODIFY                                  | The first unwarded reach below a ward loses rock resistance (the channel cuts where it leaves the sanctuary) as a declared total over `network.receiver`; storm rim with X5.                                                                                                                                |                                                                                                                               | Rock → relief.                                                                              | M5  |
| veil writes (`unsettle`, `houseDoor`)              | MODIFY                                  | Wild relief as a declared total with a fixed per-cell hash (the regional `veilRelief` does this); door chill as a declared total; pool once; vegetation ring as max. The regional `respondVeil` never recomputes `wild`, so wild zones cannot move today.                                                   |                                                                                                                               | Relief → reroute; cover → ecology.                                                          | M5  |
| coverSystems / classify / project                  | INCLUDE                                 | `coverSystems` each round before confluences; classification and projection once at extraction; the regional `conditions.ts` duplicates the rule reader with ad hoc unit conversions and goes. Keep regional place, site and door publication.                                                              | 70 km feature-noise scale makes 30-cell scatter blobs; acceptable, noted.                                                     | Coverage → confluences → displacement; per-system balance table.                            | M5  |
| ecology coupling (`applyToxicity`, biomes)         | INCLUDE via M4                          | Six lore biomes live in the world ecology; with M4 landed, toxicity gets its producer here and its consumer there.                                                                                                                                                                                          | Recovery per 600 years → fixed share under the horizon.                                                                       |                                                                                             | M5  |
| older regional path (`regionalMagic.ts`)           | RETIRE                                  | Salvage `inheritInfluence`, `rememberAppliedHeat`, the no-retrace guard and the frame-edge buffer idea.                                                                                                                                                                                                     |                                                                                                                               |                                                                                             | M5  |

Left off: deep-ocean source, death and dead-lake sources, tenure and kept-line sources
(history records not captured; captured seats and lines are the Hallowed evidence),
society-phase evaluation, crust advection, stock advances per round, history and stored
updates, `lapseToStoredCharge`. The regional `materialPattern` (hashed patches at twice the
parent span, identical for all seven systems) is added texture and goes with X2'.

#### Society (40 operations)

| Operation                                                                                    | Verdict                         | Regional sense, start from captured geography                                                                                                                                                                                                                                           | Resolution and parameters                                                          | Ties and persistence                                                                        | M   |
| -------------------------------------------------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --- |
| populationInitialize                                                                         | MODIFY → regional initializer   | Communities = established seats plus round-2 villages, each owning a hinterland; groups from the captured community whose footprint covers the seat, composition only, no counts; works and politics from the captured record. Never the random seed draw or the `people` entity write. | Seed radius formula irrelevant once the draw is gone.                              | Once; feeds partition, connections, works.                                                  | M6  |
| populationPublish                                                                            | MODIFY                          | Refresh `populationDensity` per hinterland cell weighted by farming share (people live where fields are); footprints as cell masks until extraction (the per-cell rectangle union is seconds at 400k).                                                                                  |                                                                                    | Feeds places and naming.                                                                    | M6  |
| createSocietyGeography                                                                       | MODIFY                          | Drop `seedCells`; INCLUDE `assignCells` (travel-cost partition), `refreshSocietySupport`, `connectionsFor`, `seaConnections`: the hinterland and connection graph `places.ts` re-implements twice. `retainedSeatCells` and `retainRegionalConnections` INCLUDE.                         | Cliffs impassable above 0.6 rise/distance; one travel metric (see traversal).      | Re-run per round from the surface (replace); wear persists by connection key.               | M6  |
| societyCycle / evolveSociety order                                                           | REPLACE → regional society step | Of 13 calls, seven are history; the order works → environment → places → wear is kept as the round body after cover and before places.                                                                                                                                                  |                                                                                    | Elevation contributions join the existing relief follow-up check.                           | M6  |
| planSocietyWorks (+ harbours, authored)                                                      | MODIFY                          | Works where the medium is, gated per community at ≥80 residents instead of 500/1000; keep clearance, irrigation, dam, harbour proposals; drop hunting and conservation (no medium); the `pass` −8 m stamp goes. `addAuthoredWorks` INCLUDE.                                             | Work radius scales to the hinterland's field area, not `min(5 km, …)`.             | Society → relief, water, ecology through works.                                             | M6  |
| applySocietyWorks / applyWork / clearLand / irrigate                                         | MODIFY (ledger)                 | Delta bookkeeping is right in intent but writes through `changeSample`, which the per-round writers erase; route through `contributions.add`; drop `years` decay; disc platforms replaced by shaped works (S3). Hunting, conservation, tapping, quarrying, weir off.                    | Fraction = amount.                                                                 | `respondCover`'s successor must read ledger totals for tree, grass, soil water, runoff.     | M6  |
| realizeDemands / siteQuality / damQuality / harbourQuality                                   | INCLUDE                         | Each captured demand is sited on the cell this terrain makes best (dam at the narrows between high banks, harbour in the sheltered bay, pass at the col); re-site only when the kept site's quality falls to 0.                                                                         | Ring classifiers read valley walls well at 2.4 km and 0.7 km.                      | Reads network, coast, slope; a dam's lake is water for routing; realized position persists. | M6  |
| anchorRiverWork / irrigateChannels                                                           | MODIFY / LEAVE OFF              | Snap to the nearest regional channel cell, not the parent's reaches; irrigation as a 15-line walk down `drainage.receiver` deducting ≤20 % flow (S2).                                                                                                                                   | m³/s match.                                                                        | Society → water → ecology.                                                                  | M6  |
| societyWays (`wayClasses`, `wornCost`, `wearWays`)                                           | MODIFY                          | Use → cost → use is the owner's "ways follow use"; wear replaced per round from static commuting flows, not time memory; track ≈10 and road ≈100 travellers per year (regional profile) instead of 100/1000, or no regional way is ever a track.                                        | Market reach in units of community spacing.                                        | Ways → centres → ways; fords and bridges (S4) lower crossings.                              | M6  |
| societyTraversal (`landEdges`, `seaEdges`, spread)                                           | INCLUDE, one MODIFY             | Shared travel over the developed relief; river edges are half cost only on navigable flow, otherwise crossings pay a ford cost (every small stream is a channel regionally). Adopt one travel metric; the regional A* and private travel functions retire.                              |                                                                                    | Shared by hinterlands, connections, ways, centres.                                          | M6  |
| societyHazards (`exposures`, `terrainExposure`)                                              | INCLUDE as a read               | Avalanche flanks and confluence-hazard ground penalize or move a proposed village; events (random, per year) stay off; captured events keep their footprints.                                                                                                                           |                                                                                    |                                                                                             | M6  |
| societyContact (`contactCosts`, routes, distances)                                           | INCLUDE                         | Pure graph utilities over worn ways and shared language.                                                                                                                                                                                                                                |                                                                                    |                                                                                             | M6  |
| inheritPolitics                                                                              | INCLUDE                         | Villages carry the control of the country they sit in; a frontier between captured controls is a shrine or way-station candidate (S5). Everything that changes control or creates polities is off.                                                                                      |                                                                                    |                                                                                             | M6  |
| settlementHierarchy                                                                          | INCLUDE as is (seats only)      | Roles for captured seats from captured politics; villages stay `settlement`.                                                                                                                                                                                                            |                                                                                    |                                                                                             | M6  |
| societyCentres (`urbanTargets`, `chargeWays`)                                                | MODIFY                          | Static central-place allocation: sizes villages against their market seat and gives per-centre trees along which commuting wears the ways; nobody moves (`drawToCentres` off).                                                                                                          | City reach ≈3× community spacing; drawing town ≥80.                                | Feeds ways and village sizing; replaced each round.                                         | M6  |
| societyDoors                                                                                 | MODIFY                          | Read regional door features and emit the same door edge for `connectionsFor`.                                                                                                                                                                                                           |                                                                                    | Magic → society.                                                                            | M6  |
| societySites (`rankSites`, `fortress`, `passFoot`, `chooseSettlementSites`, `distinctSeats`) | INCLUDE, MODIFY the chooser     | `fortress` and `passFoot` are unused regionally and give distinctive places; one best-class site per hinterland from village candidates; the gorge test reads the network, since landforms are named only at extraction.                                                                | Pass rise/drop 150 m scaled by `cellSpan/2400` at finer levels.                    | Reads relief, water, magic classes.                                                         | M6  |
| societySettlements (`communityContacts`, `concentration`, naming)                            | INCLUDE                         | `concentration` sizes villages by site draw, farming, market and water instead of the flat 0.025 share; founders, relaxation and status-by-years off.                                                                                                                                   |                                                                                    |                                                                                             | M6  |
| societySupport (`supportAt`, `dryLand`, `coastalFishery`, `channelAccess`)                   | INCLUDE, MODIFY `channelAccess` | One per-cell livelihood read replaces `siteScore`; `channelAccess` indexes the parent's captured reaches without a mesh and must read `network.channel`/`flow` first of all.                                                                                                            | Productivity and herbivores absent → gathering ≈ 0.6·trees, hunting 0: acceptable. | Reads relief, water, cover, magic; deterministic replace.                                   | M6  |
| societyInheritance (`inheritWorks`, `carryIdentity`, `realizeDemands`)                       | MODIFY                          | Located works inside the frame copied; demands carried by heirs at the share of the country inside; `inheritOrigin`'s population split off (a parent population budget); drainage inheritance off.                                                                                      | Polygon intersections once.                                                        |                                                                                             | M6  |
| societyNaming (`communityName`, `societyWorkName`)                                           | INCLUDE                         | Villages and works named in the owning community's language instead of by position.                                                                                                                                                                                                     |                                                                                    |                                                                                             | M6  |
| refreshSocietyEnvironment                                                                    | REPLACE → society reads refresh | It creates a world workspace and reruns world water and magic; only its tail (re-read access, support, connections after water or relief changed) is needed, as a 20-line regional function.                                                                                            |                                                                                    | Water, relief, magic → society each round.                                                  | M6  |
| societyMagic (`workFor`, `pressureUse`, `fireUse` siting)                                    | MODIFY (locate only)            | Locate where captured practice happens (forge at the Fire seat, dive site at the shelf edge, archive at the Aurora seat) once from captured ledgers; forge heat into temperature through the ledger; stock advance and trade off.                                                       | Dive box bound carries.                                                            | Society → magic.                                                                            | M6  |
| societyMagicAccess (`magicAt`, role lookup, `accessibleDive`)                                | INCLUDE reads                   | Channel reads; reservoir draws off.                                                                                                                                                                                                                                                     |                                                                                    |                                                                                             | M6  |
| regionalCommunitySpacing, retainRegionalConnections, retainedSeatCells                       | INCLUDE                         | Already consumed by `places.ts` and `ways.ts`.                                                                                                                                                                                                                                          |                                                                                    |                                                                                             | M6  |
| realizeRegionalPlaces (legacy)                                                               | RETIRE                          | One latent town per heir at the community position with an inherited budget; `places.ts` proposes at network events with hinterland competition. The legacy child path in `atlasWorkflow.ts:285` must be confirmed and retired in the same milestone.                                   |                                                                                    |                                                                                             | M6  |

Left off: evolvePopulation, round model (`foundRound`, `runEra`), `societyStep`, demand
amounts (world only), `raiseHighways`, hazards as events, sieges, culture initialization and
diffusion, language evolution, politics evolution and successors, seat relocation, ruins,
cold-age and native works, settlement evolution, practices and seeking, `recordSocietyOnMesh`,
process registrations and `societyPresent`'s regional branch. Reasons: eras, growth,
migration, new polities and random events are excluded by the product contract; the rest
are mesh-only or history.

#### Established features as causes (added 2026-11-01)

The checklist above inventories world operators. It is not where regional refinement gets
its character. Spec §5.3 and §7.2 step 1 make established features the organizing causes of a
round: every captured feature says what the land around it must provide (**support**), does
something to its surroundings in several domains (**influence**), changes in response to the
surroundings the round developed (**response**), and, together with other features or
situations, produces consequences neither would alone (**conjunction**). The first plan
reduced this to one row. This section does the design per feature kind.

Mechanism (reusable interface, built in M0): a `FeatureCause` registry keyed by feature kind,
each entry supplying `support`, `influence`, `respond` and `conjoin` steps that read the
field and the feature workspace and write only increment terms, ledger totals, network cost
terms, source strengths or proposals. The schedule's structure phase runs `support` and
`influence` for every established feature each round; round 2 runs `conjoin` to propose;
round 3 runs `respond` and supports what survived. Identity is the feature id; a rule that
fires again updates its earlier contribution instead of adding. Noise breaks ties only.

What a captured region can contain (from `domain/landmarks.ts`, `society.ts`,
`societyWorkNatures`, the magic presets, `builtinLayers.ts` and `featureIntents.ts`): 7
landscape landmark kinds, 5 magic landmark kinds, river courses, lakes, seas, falls, wetland
and forest polygons, named habitats, about 30 magic site classes and 10 meetings, settlements
(13 site kinds, a fortress flag, inhabited/abandoned/ruined status, scale and role), 14 work
kinds, roads of three classes, 4 event kinds, political control and claims, institutions,
authored protections and custom points of interest. Each group follows; a kind not listed
has no cause of its own and is handled by its medium.

**Landscape landmarks** (`volcanic-mountain`, `resistant-mountain`, `canyon`, `dome-ring`,
`impact-ring`, `escarpment`, `falls`; ADR 0006). Support in every case is the landmark's
published signature (summit and prominence, depth between rims, crest-to-trough relief, floor
and rim, throw, step), measured each round on the field and restored by the smallest
correction through the relief increments and incision, as the world's `maintainLandmark`
does per epoch (checklist row). The rest differs by kind:

| Landmark           | Influence on surroundings                                                                                                                                                                                                                                                                                                                                                                           | Response                                                                                                                       | Conjunctions                                                                                                                                                                                                                                                    | Verdict, M                   |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Volcanic mountain  | Radial drainage (network repulsion, exists); a radial fracture set rooted on the cone (G1 anchor); a hard lava apron and plateau in the material bands; a caldera as a closed-basin root and crater-lake candidate; geothermal high and hot springs on the flanks; ash-fertile soil (nutrient term) on the apron; summit snow and ice by the local snowline; Fire core affinity for captured cores. | Barrancos deepen with reworking; the apron edge becomes a spring line and a scarp in the shore process where it meets the sea. | Cone × Fire: conduits run the radial fractures, basalt scars on the flanks. Cone × village: fields on the apron, none on the upper cone, the village at the spring line. Cone × coast: a lava headland that the shore process cuts slowly.                      | INCLUDE; M2 (magic parts M5) |
| Resistant mountain | High resistance at the core so the network bends around it; steep hillslopes and a talus apron (capped mass wasting); a spring line at the contact with softer rock; an inselberg plain developing around it as the surroundings lower.                                                                                                                                                             | The plain lowers with incision while the core holds; the summit's prominence grows without a maintenance write.                | Dome × Hallowed seat or sanctuary: a sacred mountain (institution at the foot, ward ring on the slopes). Dome × ways: routes skirt it, a pass only where a saddle exists.                                                                                       | INCLUDE; M2                  |
| Canyon             | The drawn path forces channel persistence (the river stays); rims anchor the divide tree; side canyons branch from the main with knickpoints at the caprock; seeps and a riparian strip at the base; exposed fracture conductance along the walls (Fire veins show on the walls); ways cannot cross except at the narrowest reaches.                                                                | Rims retreat where tributaries cut; the river's terraces appear where incision outpaced filling (W2).                          | Canyon × road network: one crossing (bridge or ferry) at the narrowest reach, a bridge town there. Canyon × fortress: a spur above the narrows. Canyon × dam demand or a fortress holding the gorge: a gorge dam at the narrows with a reservoir upstream (F3). | INCLUDE; M2, M6              |
| Dome ring          | Ring-aligned grain so the material bands are annular: streams follow the troughs and breach the ridges only at gaps; the gaps are passes; villages sit in the troughs at the gaps.                                                                                                                                                                                                                  | The main river's exit gap widens and lowers; inner rings erode faster where fractured.                                         | Ring × ways: a road follows the trough. Ring × Fire or Salt: a ring of hot springs or brine at the inner trough if the material is Fire- or Salt-bearing.                                                                                                       | INCLUDE; M2                  |
| Impact ring        | A closed basin: a crater lake with one outlet breach in wet climate, a salt pan with brine down-drainage in dry climate (F6); the rim is a divide ring with passes at low points; shocked rock gives a concentric and radial fracture set; a central peak; Fire fallen stock means placers in the gravels downstream of the breach.                                                                 | The breach deepens, the lake lowers and leaves a shore terrace; the pan grows if the budget stays negative.                    | Ring × village: at the outlet breach. Ring × Salt: necropolis and killing ground on the floor. Ring × Fire: placer workings along the breach stream (hamlet).                                                                                                   | INCLUDE; M2, M5, M6          |
| Escarpment         | The fault is the fracture set's trunk (G1); hot springs and Greenwood springs along the base; every river crossing it makes a falls or knickpoint; a talus and fan apron at the foot; aspect contrast on the face; rain shadow and cold upland above; passes where a river cut a gap; roads along the base; towns at the foot by the springs.                                                       | The scarp retreats with incision and gullying; the apron grows.                                                                | Scarp × road: the road runs the foot; the pass town at the gap. Scarp × Fire: a line of hot springs and a thermal vein along the fault. Scarp × political frontier: a fortress at the gap.                                                                      | INCLUDE; M2, M6              |
| Falls              | The river is forced persistent through the step; a gorge below the falls (incision downstream of the knickpoint); a plunge pool; spray wetland and fog forest at the foot (ecology moisture term); the step is a mill site; a portage: ways leave the river above and rejoin below.                                                                                                                 | The lip retreats upstream by a bounded amount per round, lengthening the gorge.                                                | Falls × town: a portage pair (landing below, head above). Falls × Hallowed: a sanctuary at the falls (site class). Falls × mill: the first mill (S4).                                                                                                           | INCLUDE; M2, M4, M6          |

**Magic landmarks** (`fire-wellspring`, `aurora-vault`, `pressure-locus`,
`greenwood-heart`, `salt-pan`). Each is a kept source of its system; the magic engine's
propagation, forcing and meetings act on it like any source (checklist). Support is the
source's intensity at its site. What the registry adds is the cross-domain conjunction each
one invites: the wellspring's conduits become the structure for thermal veins, hot springs
and forge seats along the fracture set, and its heat drives melt lines on ice (F7 river
warmth); the vault retains charge in the cirques the ice model carves and stills the forest
around it (Rime forest), with an archive seat at its melt line; a locus inside the frame
casts rays that the shore process reads as crush zones, feeds upwelling fisheries, a fog belt
and storm dunes; the heart pushes roots and verdure into a Deepwood with a wending fen on its
wet side and an oasis at its springs, and ways go around it; the salt pan sends brine down
the drainage to killing ground and dust downwind, a glass flat at the centre, a necropolis
class for villages at its edge and salt-gathering hamlets. All INCLUDE through M5 with site
classes feeding M6.

**Magic site classes and meetings** (cores, veins, hot springs, basalt scars, crater lakes,
ejecta fans, placers; Aurora fields, ice, ground, moraines, shelves, melt lines, prisms,
halos; crush zones, wakes, rogue impacts; stands, wellsprings, oases, sinkhole fields,
wending fens; pans, flats, killing ground, dust, domes; seats, rings, rims, ward lines;
tears, wild zones, doors; the meetings war, steam, rot, breach, frozen, brackish, preserved,
standing-dead, fired, brine-shore). These are outputs of the magic engine's classification
each round, not inputs, except captured cores, seats, lines and doors, which the checklist
seeds as sources. Their causes on other domains come through the shared media the engine
already writes (heat, melt, fracture, rock, soil, toxicity, fog, coast forcing) and through
the site classes society reads: healing-well villages at hot springs, necropolis at killing
ground, sanctuary at a ring, door-house at a door end, melt-line seats, halo-edge farms
where quickening raises yields, oasis villages, placer hamlets. INCLUDE through M5 and M6; no
separate registry entries beyond the seeded sources.

**Water features.** A captured river course keeps its identity and is forced persistent
(W1 cannot dry it); on its floodplain it braids where verdure is high and leaves terraces
where incision outpaced filling (W2); an entering river brings its discharge (exists). A
captured lake keeps its level as evidence (exists), grows a shore wetland and a lacustrine
delta where a tributary enters (small, F5), and its outlet and inlets are village sites
(fishery). A sea boundary is where the shore process (W4) and the mouth form (W3) act. A
wetland polygon is presence evidence for the wetland group and a candidate for society's
drained marsh; a forest polygon is presence evidence for the woody groups. INCLUDE; M2–M4.

**Settlements** (scale, role, inhabited/abandoned/ruined, 13 site kinds, fortress flag).
Support is §6.3: a usable site by terrace, valley shoulder, crossing or coastal pocket, else
bounded reshaping (S3). Influence: a hinterland by travel cost, fields and pasture (S2), ways
by use (S1), works where the medium is (checklist row), a clearing that softens into
woodland with distance. By site kind: a harbour town builds a breakwater on its exposed
side and keeps a dredged approach; a pass town has the road over the col and a way-station
on the far side; a river-node town has a bridge or ford at its crossing and a mill at the
nearest fall; a fire-seat has a forge; a melt-line seat an archive; a sanctuary is a
Hallowed seat and its ring; a necropolis a barrow field on the killing ground; a door-house a
door edge; a fishery coast its landings. A **fortress** holds a spur above a gorge or pass;
its conjunctions are a gorge dam behind it where the valley narrows (F3), a frontier when it
stands on a political boundary, a siege footprint if one was captured. Response: an
abandoned or ruined settlement's fields regrow through the cohorts (saplings over crops),
its ways lose wear and are not traced, its works decay, and the ruins layer keeps the record
(F4). INCLUDE; M6 with M4 for the regrowth.

**Works** (`dam`, `irrigation`, `pass`, `harbor`, `clearance`, `weir`, the three practices;
`hunting`, `conservation`, `tapping`, `burning`, `quarrying` are world-only and carry no
regional geography). A captured dam today is a point with no lake: the dam's crest height
follows from its regulated discharge and the valley cross-section at its cell, the water
stage fills the valley to the crest with the spillway at the dam, and the reservoir is a
lake the ecology, Salt and society read (F3). Irrigation makes its wetter strip and deducts
its flow; a pass work is the road's col; a harbour its breakwater; clearance its fields; a
weir its worked shore; practices their forge, archive and dive sites with the forge's heat
in the ledger. INCLUDE; M6 (dam fill in M2's water stage).

**Roads** (track, road, highway). Kept as evidence for ways by use (S1): a captured road's
cells carry inherited wear so traced lanes bend into it; bridges and fords at its channel
crossings (S4); way-stations and hamlets along it (S5); clearance along it. A captured
highway between two towns is kept as class even if the round's flows would not earn it.
INCLUDE; M6.

**Events** (avalanche, flood, siege, tsunami) keep their footprints (exists); a siege or
battlefield footprint is a shrine and necropolis candidate (S5); avalanche and tsunami
exposure penalize proposals (checklist). No event is generated. INCLUDE as reads; M6.

**Politics** (control, claims, sovereignty) are inherited by heirs (checklist); a control
boundary crossing a pass or a road is a fortress or way-station candidate; nothing changes
control. INCLUDE as reads; M6.

**Institutions** sit at seats and have no geography of their own beyond the site classes
already listed. LEAVE OFF as causes.

**Authored protections and custom points of interest.** Protections already refine the child
mesh around them (`protectedSampling`) and hold cover (`coverAuthority`); a protected feature
is never moved or reshaped, and a custom point of interest is protected evidence of unknown
kind: the land around it gets support (a usable approach) and nothing else. INCLUDE as is.

Conjunction rules that are new processes (judged; the ones left out are named with the
reason):

- **F1 Canal between settlements** (new work kind `canal`, structural). When two seats trade
  (a market or centre flow at road class or above), both stand on water (river, lake or sea),
  the lowest divide between them is low (a few metres per kilometre over the traced way) and
  the ground is not steeper than a declared gradient, a canal work is proposed along the
  cheapest wet path and realized as a drawn channel that the water stage treats as a connected
  level reach; it carries no discharge of its own. This is the owner's "rivers drawn between
  towns". Round 2 proposal, round 3 support (a canal that no longer meets the gate is
  dropped). Aqueducts are left out: a line with no visible geography beyond the pipe.
- **F2 Portage pair at falls and gorges.** Where a navigable river (flow above a declared
  threshold) has a falls or a canyon reach that ways cannot follow, the way leaves the river
  above and rejoins below; a landing and a head form as hamlet seeds (S5) and the way between
  them wears to road class if the river traffic justifies it.
- **F3 Gorge dam and reservoir.** A captured dam demand, a dam work, or a fortress holding a
  narrows with a town downstream that needs water (`needsWater`) sites a dam at the narrowest
  reach with the highest banks (`damQuality`, checklist); the water stage fills to the crest
  bounded by the valley; the reservoir is a lake feature; the fortress keeps the dam. A
  reservoir is not proposed without a demand or a holder, so hydrology alone never builds one.
- **F4 Ruin response.** Abandoned and ruined settlements lose their fields to succession,
  their ways to zero wear and their works to decay (condition attribute, not geometry); their
  cleared land is the burned-patch case of the cohorts; a Hallowed seat at a ruin keeps a
  fading ward only if the parent captured one.
- **F5 Lacustrine delta and lake shore.** A tributary entering a lake with sediment load
  builds a small fan into shallow water; the shore wetland follows the lake's fill depth.
  Small, inside the sediment transport step.
- **F6 Dried basins crust salt.** A captured lake the round's water budget leaves below its
  level, or a closed hollow that dries, becomes Salt bed and brine (the regional form of the
  world's dead-lake source, which the checklist leaves off because it reads history): bed at
  the pit, brine down the drainage, dust downwind. Only where the Salt system is enabled.
- **F7 Fire warmth along rivers and melt lines** is X6 (already listed); the vault's
  retention and the wellspring's melt line meet there.

Left out, with the reason: aqueducts (no geography); mines and quarries as a new kind (the
placer hamlet covers the visible case; a quarry needs a demand the product has not defined);
walls and fortification lines (political history); lighthouses and beacons (decoration
without consequence); irrigation terraces as a separate kind (covered by `terrace` plus
`irrigation`); sacred groves beyond the Greenwood stand (no medium).

#### What the dropped world processes produced, and what produces it now

| Dropped (checklist)                                                                                                      | Regional consequence it carried                                                   | Produced now by                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tectonic provinces, sutures, margins, domains, uplift, orogeny, advection, epoch activity                                | Fault scarps, hot springs on faults, ridge-and-valley from folded bands, hogbacks | Fracture set (G1) with escarpment landmarks as trunks; material bands with grain; structural relief as differential band erosion (named in M2); geothermal on fracture |
| mantle plumes, volcanic construction                                                                                     | Cones, aprons, calderas, geothermal                                               | Cone extension from captured construction and volcanic landmarks (M2)                                                                                                  |
| impact cratering                                                                                                         | Crater, rim, shocked rock, metal                                                  | Impact-ring landmark with its basin, fracture and placers (M2, M5)                                                                                                     |
| crustal support, flexure                                                                                                 | Broad isostatic offsets                                                           | Nothing; below regional resolution and against the base calibration                                                                                                    |
| drainage conditioning, guidance, flow routing, lake basins, channel geometry                                             | Routing, lakes, channel belts                                                     | Regional network and water stage (exist), incision memory steering (W2), channel widths as line attributes                                                             |
| coastal detail, marine sedimentation, margin evolution, delta classification                                             | Coves (as noise), shelf infill, delta rasters                                     | Shore development (W4), mouth form (W3)                                                                                                                                |
| ocean currents, warmth sources, sea ice                                                                                  | Macro climate                                                                     | Carried from capture; sea ice kept (repair)                                                                                                                            |
| world land-ice mass balance, glacial erosion as cumulative cut                                                           | Ice thickness, troughs                                                            | Local snowline and scale-free thickness (C4), erosion inside the derivation (M3)                                                                                       |
| deep-ocean Pressure source, coastal and wake draws                                                                       | A locus, rogues and wakes per map                                                 | Captured locus and intensity, boundary inflow (X1), re-reflection from the developed coast                                                                             |
| Salt death and dead-lake sources                                                                                         | New Salt from history                                                             | Dried basins crust salt (F6) from the region's own water budget                                                                                                        |
| Hallowed tenure and kept-line sources                                                                                    | New wards from society history                                                    | None by design (spec §6.5: realize existing); sanctuaries and shrines site at captured wards (S5)                                                                      |
| stock advances, history, thaw subsidence, crust advection                                                                | Epoch movement of stocks                                                          | One-time carrier resolution (X2'); thermokarst left out                                                                                                                |
| animals, sea crossing, burial                                                                                            | Browsing, island colonization, fossil fuels                                       | Browsing as a clearance term (E5); islands keep captured cover; nothing for burial                                                                                     |
| population growth, migration, eras, culture and language evolution, politics evolution, highways, hazards, sieges, ruins | Demographic and political history                                                 | Fixed populations, inherited politics and composition, captured events, ruin response (F4), captured highways as class                                                 |
| landmark siting                                                                                                          | New landmarks                                                                     | None by design (ADR 0006: a child sites none); support and influence per kind above                                                                                    |

#### New regional processes (no world counterpart, or the counterpart is world-bound)

Shared conventions: grid-native; organized by the network and the fracture set; writes only
through derivation terms or the ledger; identities keyed by stable structure keys (cell,
seat id, connection key, work id), randomness only from `seed ^ key` to break ties;
recomputed each round from the present state, so a re-evaluation updates and never adds.

Shared media, owned once and read by several domains (spec §5.2):

- **ocean distance** (M1, water row), **aspect and insolation** (M1; climate C2 and ecology
  share one term: a signed temperature term and a PET multiplier by slope and the equatorward
  angle, into the lapsed temperature), **cold-air pooling** (M1; climate C3 and ecology: a
  `coldRetention` channel from enclosure and fill depth, raising seasonality rather than
  lowering the mean, bounded; read by Aurora for retained charge), **topographic wetness** (M1;
  ecology E1: `ln(a/tan β)` normalized against the parent-span blur plus fill depth and
  floodplain into soil-water supply), **regional fracture set** (M1; geology G1: a fracture
  network rooted on captured corridors, landmark faults and cone conduits, oriented by the
  grain and captured strain, with density by strain, consumed by material resistance, network
  cost, geothermal, Fire conduits and Veil strain, hardened by wards), **divide network**
  (M2; G2), **incision memory** (M2; W2), **storm medium** (M5; X5), **river warmth** (M5;
  X6), **clearance pressure** (M6; S2/S6).

Terrain (M2):

- **G2 Divide network (ridge tree).** The dual of the drainage tree: crest lines between
  adjacent catchments with continuity along the main divide and branching toward the
  tributary divides, so ridgelines branch like an inverted river. Inputs: network tree,
  catchment adjacency, summits and landmark mountains as crest anchors, grain. Output: a crest
  increment term with prominence growing along the trunk and cols where catchments of equal
  size meet; seat footprints lower the crest cap near a col. Responds to the network, summits,
  landmarks; feeds ice (cirques on the lee side of crests), aspect, society passes. Bounded so
  ridge increments never exceed what the amplification allows (the ridge tree must not fight
  the network).
- **G3 Valley persistence.** Valleys that are not rivers: former channels below the
  persistence threshold keep their incised form (W1), glacial troughs and wind gaps keep
  theirs, structural valleys follow weak bands of the fracture set. Output: a valley-form term
  independent of present flow. Responds to incision memory, ice, material.
- **G4 Landmark evidence and support.** As the two landmark rows above.
- **W1 Channel persistence and transmission loss.** Separate where a valley was cut from
  where water flows today: the drawn river is a function of persistent discharge (runoff
  seasonality, infiltration into coarse fans and karst, evaporation across dry country),
  so a network channel below persistence becomes a dry valley with its incision kept.
  Threshold in cells × cell area by the regional convention.
- **W2 Incision memory, capture and abandoned channels.** Between rounds the present drainage
  may diverge from the network where fans, deltas, coast change and knickpoint retreat
  alter the surface; the abandoned route stays as geography (abandoned channel, wind gap,
  terrace). The inherited-valley weight from world drainage guidance steers routing toward
  remembered incision. Memory is recomputed from evidence each run, never published.

Coast and climate (M3):

- **W3 Mouth form.** Where a channel meets the sea: low delivery and drowned valley →
  estuary deepened in proportion to discharge and remembered incision; high delivery and
  low exposure → delta deposited into shallow sea until cells emerge, with distributaries
  along the fan; moderate delivery with drift → barred lagoon. The entering river's load
  default (captured erosion × beyond-frame area) is recorded as an explicit inference.
- **W4 Shore development.** One coast process replacing coastal detail, external forcing and
  coastal erosion: fetch exposure along the captured wind sheltered by the present coast;
  differential retreat by material bands, fractures, sediment, volcanics and wards; longshore
  drift building spits and bars in the lee of headlands from eroded and river-delivered
  sediment; cliffs where retreat is active on hard ground, beaches where sediment collects.
  Moves the shore → one declared network re-root at the present coast in rounds 2 and 3.
- **C1 Orographic transport on the captured wind** (moisture-transport row): windward and
  lee rainfall and snowfall on the developed relief.
- **C4 Local snowline and scale-free ice thickness.** Equilibrium line from lapsed
  temperature, snow share, aspect and cold pooling; thickness from accumulation area above
  the line and flow, bounded, with Aurora persistence resisting melt; replaces the pass
  counter.
- **C6 Fog belts from Pressure coasts.** Fog drip and cooling where a front upwells, as an
  extension of C1 owned with magic. Lake-effect moisture was evaluated and rejected (a few
  percent downwind of a lake a few km across).

Ecology (M4): **E1 topographic wetness**, **E2 aspect**, **E3 cold pooling** (shared media
above); **E4 riparian supply** (soil-water supply within the channel margin scaled by √Q,
so gallery forest and wet meadows follow channels in dry country); **E5 clearance and
grazing** (owned with society S6; a per-seat declared pressure giving woody mortality and a
browsing term, so settled land reads as settled); succession needs no process (cohorts with
short horizons in rounds 2 and 3); wetland in abandoned channels and behind moraines emerges
from E1, E3 and W2 once a former channel keeps residual flatness and floodplain.

Magic (M5):

- **X1 Boundary inflow for carried fields.** The parent's field continues beyond the frame:
  edge cells with captured intensity become non-site pseudo-sources (never a located place)
  for Pressure rays, Aurora drainage, Fire conduits and Greenwood roots; the captured
  intensity stays the floor outside an interior buffer.
- **X2' Resolve captured stocks onto carriers (once).** A parent cell's amount redistributed
  onto the fine cells that carry it (veins and crater gravels, ice, basin floors and brine
  channels, old stands and springs), conserving the amount per parent footprint; then the
  whole-tree brine route and aquifer leach once. Replaces `materialPattern`.
- **X3 Hallowed rim as a geographic band.** Rim weights decaying over a width in metres;
  displaced intensity laid by weight; meetings between displaced systems evaluated on the
  band; `spillBelow` on the first reach outside.
- **X4 Door access consequences.** Door edges in the travel graph; a far end outside the
  frame is an external-access event at the end cell; round-2 proposals treat a door end as a
  network event; the `houseDoor` ring and pool are the visible trace.
- **X5 Regional storm medium.** The captured storm track relaxed downwind, deflected around
  wards along their rims, pinned where stillness, strengthened by new fronts; scour, dunes,
  windward rain and lee drying as ledger totals.
- **X6 River warmth downstream.** Fire heat carried down the tree with decay, thawing the
  reach for ice, Aurora, ecology and roots.

Society (M6):

- **S1 Local ways by use.** Replaces `connectSeats` and the A\* lattice: countries and
  connections (partition row), static commuting and market flows along per-centre trees,
  wear and worn cost iterated twice within the round so use begets use, then least-cost
  traces with a corridor discount for cells already carrying traffic (the network's capture
  device), ford cost at channels unless a ford or bridge stands, marsh and dense forest
  multipliers; trunks emerge because later lanes bend into earlier roads.
- **S2 Field and pasture allocation.** Per community, hinterland cells ranked by farming ×
  travel decay taken until the residents' need is met, excluding water, steep ground, wards
  and stilled ground; pasture on grazing over the rest; irrigation intake and strip where
  a dry village has a channel in reach; ledger totals on tree, grass, soil water, runoff and
  flow; land-use features published.
- **S3 Support works that reshape bounded ground** [owner decision]: benches along the
  contour with cut-and-fill preserving the footprint's mean elevation, an embankment on the
  river side of a floodplain seat, drained marsh cells, one breakwater cell on the exposed
  side; an access test to the nearest channel or way; total `|Δelevation|` per seat capped by
  footprint and gradient; proposed villages only in round 3 within radius 1.
- **S4 Mills at falls, fords and bridges at narrows.** Fall score from channel gradient and
  flow near a seat; crossings on traced ways classed ford or bridge by flow and way class;
  identities by channel cell or connection key; re-scored each round.
- **S5 Hamlets and shrines.** Field clusters far from their village and mills or bridges
  seed hamlets; unused magic site classes, cols on roads and captured event footprints seed
  shrines and way-stations; proposed in round 2, supported in round 3, weaker influence.
- **S6 Clearance and grazing feedback** (with E5): cover after the ledger plus a grazing
  term on pasture; next round's support reads the cleared cover, so fields stabilize where
  they were cleared without ratchet.

### Milestones

Each milestone is bounded by the checklist rows that name it; a row not listed here is not
implemented. Every milestone ends with the whole frontend unit suite, lint and the four-case
harness within Gate C, and a determinism check (two runs, one republished repeat).

**M0 — Software organization.** No new geography. Three parts, each with a failing guard
test first (memory: new structure behind a guard, never a patch on the old pipeline).

1. _One representation._ `createRegionalState` builds a `GenerationState` with
   `physical = createAtlasWorkspace(...)` on the child mesh at the regional cell size,
   inheriting from the parent grids through `atlasChannels`; the surface is the
   `AdaptiveField` that `projectNative` writes. The `RegularGrid` surface, `channel()`,
   `naturalChannel()`, `gridNeighbors`, `regional/magic/conditions.ts` and every regional
   unit conversion are deleted. The ledger (`Contributions`) is re-keyed to native bands and
   its "declare a total, write the difference" rule is kept. Evidence and capture read
   features and the parent field, not surface channel names.
2. _Regional core re-expressed._ Network, base, material, relief, glacial, drainage, climate,
   living, seats, places, ways, the regional magic preparation and extraction run on
   `PhysicalField` + `Lattice` in native units with the world's helpers (`forEachContentCell`,
   `KeyedHeap`, `metricSearch`, `prominence`, `channelDimensions`, `potentialEvaporation`,
   `snowShare`). Behaviour is preserved, not improved: the frozen four cases are judged on
   organization against the `b4d8163` renders, the Gate A behaviour tests pass, determinism
   holds, Gate C holds.
3. _Interfaces extracted, loop control left behind._ The `FeatureCause` registry (support,
   influence, respond, conjoin per feature kind) replaces the ad hoc evidence readers in
   `evidence.ts`, `seats.ts` and `places.ts`; the existing behaviours (summit as divide,
   course corridors, seat caps, river-seat channels) move into it as the first entries.
   Ecology: the per-step functions are the
   exported engine; the process wrappers call them. Magic: one host interface over field,
   magic workspace, systems, features and seed; world phases and epoch advances stay in the
   sequence files. Society: the same host extraction; the 17 `inherited` guards and the
   legacy child branch (`atlasWorkflow.ts` child `societySequence`, `regionalSociety.ts`
   `realizeRegionalPlaces`) are deleted; world-only assumptions inside the pieces become host
   parameters. The world's own suite and the browser wizard journey pass unchanged.

Acceptance: no `RegularGrid` or regional unit table remains under `regional/`; one
`eslint` architecture rule forbids `regional/` from defining channel names or units; the
four cases render with the same organization as `b4d8163` within Gate C; world generation
output on the default world is unchanged (one deterministic run compared field by field).
Evidence: guard tests, paired renders, the world run's comparison.

**M1 — Shared media and repairs.** [depends on M0] The shared media ocean distance, aspect
and insolation, cold-air pooling, topographic wetness and the regional fracture set, each a
native band consumed by at least one existing process (temperature, network cost, material
resistance, soil water); the `temperature` derivation (lapse plus aspect plus pooling plus
ledger); the defects listed under climate and ice and the Salt double burn; cover reading
ledger totals for tree, grass and soil water; `channelAccess` reading the regional network
through the host. Acceptance: on P1
the north- and south-facing sides of one valley differ in temperature and snow share; a
closed hollow on M1 is colder in winter than its rim; fracture density differs between a
high-strain and a low-strain parent; the fixture determinism and Gate A tests pass unchanged
except where a check names a repaired defect. Evidence: behaviour tests, P1 and M1 records.

**M2 — Terrain and water at depth.** [depends on M1] Divide network, valley persistence,
landmark evidence and support, cone extension, geothermal re-derivation, capped mass wasting,
fluvial incision as an increment term with incision memory and sediment supply, sediment
transport, the river-network slope factor and entering-river hook, the floodplain valley
floor, channel persistence and transmission loss, capture and abandoned channels, the runoff
loss structure; structural relief as differential erosion of the material bands; the
landscape-landmark registry entries (volcanic and resistant mountains, canyon, dome ring,
impact ring, escarpment, falls: support, influence and response as tabled above); dam
crests in the water stage (F3 fill), lacustrine deltas (F5). Acceptance (owner targets):
P1's belt shows trunk-and-branch ridgelines with cols between catchments; dry valleys exist
where channels fell below persistence with their incision kept; valley forms exist that no
present river made; alluvial floors and fans sit where sediment stops; a fixture with an
escarpment landmark shows a spring line and a falls where a river crosses it; a captured dam
holds a reservoir; Gate A checks for each; Gate C. Evidence: paired renders, tests.

**M3 — Coast, climate and ice at depth.** [depends on M2] Shore development, mouth form,
regional bathymetry classes and landmasses, the network re-root follow-up; wind deflection
and orographic transport on the captured wind, snow share, local snowline and scale-free
thickness, ice flow on the ice surface, glacial erosion inside the derivation, terminus
deposition, meltwater into runoff, glacial and coastal landform classes, fog belts.
Acceptance: P2's coast has coves and headlands that follow material bands and a spit in a
headland's lee; a mouth is an estuary or a delta by its load; a glaciated frame shows a
transfluent col and a trough wider than its river; windward rainfall exceeds lee rainfall
across one range; Gate A, Gate C. Evidence: paired renders, tests.

**M4 — Ecology at depth.** [depends on M1; horizons and seasonality as decided above] The
ecology cohort bands on the regional field and the regional initializer; soils, fire with cause-keyed ignition, flood, fronts
for absent groups, growth and competition, carbon, present refresh, `classifyBiome`, rule-based
habitat names, forcing and protection readers, riparian supply; `living.ts` reduced to
surface naming. Acceptance: on P1 a riparian strip follows the channel margin, conifers hold
the cold aspect above the broadleaf frost line, a burned patch bounded downwind by a channel
has saplings exceeding mature cover, a bog names itself behind a moraine; a burned
catchment's flow rises next round (water path); Gate A, Gate C within the Dijkstra budget
(fire 1, dispersal ≤4, animals 0). Evidence: paired renders, tests.

**M5 — Magic at depth.** [depends on M3, M4] The world engine operations marked INCLUDE and
MODIFY through the magic host (initialize with applied heat and seeded doors, the regional
source-strategy table, propagation, warding, thermal, living, ocean and coastal forcing,
rock feedback and confluence writes through the ledger, normalised strain, kept door pairing,
hallowed and veil writes, `holdIce`, cover systems and classification); the new processes
X1 to X6; the magic-landmark conjunctions and dried basins crusting salt (F6); retirement of
the regional duplicates and `regionalMagic.ts`. Acceptance: on M1
and M2 every enabled system's coverage stays within the per-system balance rule; a Fire
vein follows the fracture set as a branching structure; Aurora charge moves to a developed
cirque between rounds; a ward's rim band and spill reach are visible; a meeting displaces
its parents; a door end gives a village its hinterland; Gate C after one allocation of the
fields. Evidence: coverage table, paired renders, tests.

**M6 — Society at depth.** [depends on M4, M5; work kinds and reshaping as decided above]
The regional initializer and society step; the partition and connection graph; support and
demand realization; ways by use (S1); fields and pasture (S2); bounded support works (S3);
mills, fords and bridges (S4); hamlets and shrines (S5); clearance feedback
(S6); the settlement, work, road, event and politics registry entries (site-kind works,
fortress conjunctions, captured roads as inherited wear); canals (F1), portage pairs (F2),
gorge dams behind fortresses (F3), ruin response (F4); naming, hierarchy, inherited
politics, door edges, practice siting; retirement of the legacy child society path.
Acceptance: ways follow use and ground (no straight lattice, a road where hinterlands funnel
to a market seat, lanes elsewhere); fields cleared on the best farmland near each place and
visible in cover and in next round's support; a dam demand realized at a narrows and a
fortress gorge holding a reservoir; a canal joins two trading towns across a low divide on a
fixture built for it and nowhere else; a ruin's fields show saplings; villages read as
settled country; no parent-map write; Gate C with traces bounded to worn connections.
Evidence: paired renders, tests.

**M7 — Evaluate, record, adopt.** [depends on M2–M6] The frozen harness on the four cases
against the `b4d8163` candidate as the new baseline; Gate A/B/C; ADR 0008 and the workflow
document updated to the mechanisms (no parameter values); the owner's ADOPT or REJECT.

### M0 expansion (2026-11-01)

Baseline evidence before editing: the `b4d8163` renders in
`frontend/.artifacts/regional/evaluation/baseline` and `candidate`; a default-world
field-by-field digest written by a scratch script before any engine edit; the regional unit
tests and the frontend suite green on `b4d8163`.

Decisions made while expanding (plan adaptation, with reason):

- The regional magic reimplementation (`regional/magic/*`, 1,563 lines) is not re-expressed
  on the field only to be replaced in M5. M0 brings the world magic engine's inheritance and
  per-round evaluation core onto the regional field now (the checklist's INCLUDE rows that
  need no modification: initialize and inherit with applied heat, the propagation frame with
  fracture, roots, radial, local, brine and ward propagation, thermal and living feedback,
  cover systems and classification) through a regional source-strategy table that omits the
  budgeted locators; the MODIFY rows and new processes stay in M5. The regional Salt ledger
  effects, door publication and site classes are kept. The M1 and M2 renders therefore
  change in magic organization in M0; the judgement is against the checklist, not the old
  renders. `regionalMagic.ts` is retired here.
- `living.ts`, `places.ts`, `ways.ts`, `seats.ts` are re-expressed on the field as they are
  (regional algorithms M4 and M6 replace later); behaviour preserved.
- Non-map child areas are a legacy state that `captureExistingMaps` converts on open; the
  world sequence's child branch (`societySequence(input, true)`), the 17 `inherited` guards
  and `regionalSociety.ts` are dead for every current map and are deleted. If a non-map child
  surfaces in a saved world the conversion runs first, so no behaviour is lost.

Architecture settled while reading for step 1 (recorded before any edit):

- The world already has a complete child path on the field: `atlasInitialState` builds an
  adaptive child surface and inherits channels into it; `canonry.initialize`
  (`createAtlasWorkspace` → `createChildMesh`, `inheritNumerical`) builds the field;
  `canonry.project` (`projectNative`) writes the surface; `canonry.features`
  (`extractNativeGeography`) publishes oceans, lakes, rivers with reaches, peaks, ranges,
  valleys, landforms, magic places, biomes and landmarks from the field. The regional
  namespace of `b4d8163` duplicated all of it on a square grid because `isRegionalRefinement`
  short-circuits map areas before the world path.
- **Regional refinement is therefore a configured process sequence run by the `MapRunner`**,
  like every other generation: `canonry.initialize`, `refinement.begin` (regional work record,
  regional profile values such as relief radius and peak prominence set on the workspace
  profile), `refinement.context`, `refinement.round-N/*`, `refinement.refresh`,
  `canonry.project`, `refinement.clear-products`, `canonry.features`, `refinement.identity`
  (captured courses, summits and seats carry their identity onto the developed features; the
  coarse captured lines leave), `refinement.places`, `refinement.descendant-context`. The
  registry is `atlasRegistry` plus the regional processes; `refineRegionalMap` is
  `atlasInitialState` (with the refinement cell span and the present-channel allowlist) and a
  runner call, then the same stripping of `physical` and `society` that `generateAtlas` does.
  Products, publications, progress, cancellation, the block cache's per-process lifetime and
  the browser worker path are the world's.
- Regional processes run in mesh space (`PhysicalField` bands on the child lattice, halo
  cells carrying the inherited exterior); the surface is only read for channels the field has
  no band for (`populationDensity`) and written by projection. Working structures are
  retained bands or typed arrays of mesh length held in `state.regional`.
- The legacy world child path is dead for every current map and goes: `regionalPhysicalSequence`
  and its `regional.relief/climate/water/magic` processes (`canonry/regionalPhysical.ts`,
  `regionalClimate.ts`, `regionalCorridors.ts`, `regionalMagic.ts`), the child branch of
  `societySequence`, `regionalSociety.ts`'s `realizeRegionalPlaces`, and the 17 `inherited`
  guards. `generateAtlas` refuses a child area that is not a map; `captureExistingMaps`
  converts legacy ones on open.
- The regional extraction files (`extraction/landforms.ts`, `water.ts`, `habitats.ts`,
  `magic.ts`) go; their regional thresholds become profile values on the regional workspace
  and their one regional behaviour with no world counterpart (identity carry) is
  `refinement.identity`.

Steps (each with its outcome and the evidence that closes it):

1. **Guard and state.** `RegionalState extends GenerationState` with `physical` required and
   a `regional` record (input, parentSpan, contributions, round, character, evidence,
   network, relief, drainage, proposed, sites, removedProducts). `createRegionalState`
   creates the adaptive surface at the frame and cell span (`createAdaptiveField` with the
   world's `initialTopology` rule), samples the pinned inputs onto it (the existing
   interpolation), sets `domain.scope.resolution`, and calls `createAtlasWorkspace`, which
   builds the child mesh and inherits the field. Guard: an architecture test under
   `regional/` fails on `RegularGrid`, `gridNeighbors`, `channel(`/`naturalChannel(` and any
   `units[` table; it fails before and passes after. Evidence: guard test, `capture.test.ts`
   on the new state.
2. **Working structures on the field.** `Contributions` keyed by band name writing
   `map[name]`; working arrays through `retainedArray`/`workingArray`; neighbours through
   `mesh.degree`/`mesh.neighbor`; frame membership through `mesh.membership` (content vs
   halo: the inherited exterior is halo); `spacing` from cell width; components through a
   lattice flood. `evidence.ts` reads features and the field.
3. **Physical core re-expressed.** `character`, `base`, `material`, `network`, `relief`,
   `glacial`, `drainage`, `climate`, `courses`, `seats`, `living`, `places`, `ways` in native
   units on the mesh with the world helpers (`forEachContentCell`, `KeyedHeap`,
   `metricSearch`, `measureSlopes`, `potentialEvaporation`, `snowShare`,
   `channelDimensions`). The schedule unchanged in order. Evidence: the regional unit tests
   (`behaviors`, `drainage`, `landforms`, `living`, `schedule`) pass on the field; where a
   test asserted a grid detail it is rewritten to assert the behaviour.
4. **Magic core through the world engine** as decided above; `regional/magic/*` reduced to
   the Salt ledger effects and the regional strategy table; `magic.test.ts` rewritten to the
   engine's behaviour on the regional field (captured core propagates along fracture, no
   source invented without a captured one, ward scales fields inside and lays them on the
   rim, re-evaluation does not accumulate).
5. **Extraction and publication.** `projectNative` writes the surface channels; landform,
   water, habitat and magic place extraction read the field and use the world contour tools
   (`membershipContour`, `combinedContour`, `fillContourHoles`); `putRegionalFeature` and
   the retained-captured-geography rule unchanged; descendant context written to the field's
   grain bands. Evidence: `landforms.test.ts`, the workload assertions in the harness
   (`assertWorkloadDetail`).
6. **FeatureCause registry.** `regional/features/registry.ts` with the interface and the
   first entries moved from `evidence.ts`/`seats.ts`/`network.ts`: summit (divide anchor and
   repulsion), course (corridor, persistence, identity), lake (level, roots), river entry
   (discharge), seat (footprint cap, river channel, settle), landmark (evidence record,
   signature read). The schedule's structure step calls `support` and `influence`; round 2
   `conjoin`; round 3 `respond`. No new behaviour in M0.
7. **Engine interfaces and dead code.** Ecology: per-step functions exported from the engine
   files, process wrappers unchanged in behaviour. Magic: `locateMagicSources` takes the
   strategy table; `evaluateField` exported for a host. Society: the 17 `inherited` guards,
   `societySequence(input, true)`'s child branch and `regionalSociety.ts` deleted;
   `channelAccess` reads the field when present (it does). World suite passes; default-world
   digest unchanged.
8. **Harness, frontend, gates.** `regionalFixture` builds the adaptive parent path;
   `regionalEvaluation` runs the four cases and the renders are compared with `b4d8163`;
   lint, typecheck, the whole frontend unit suite, the browser wizard journey; a read-only
   review by a subagent against this expansion before the commit.

#### M0 execution record (2026-11-01)

What was built, where it departs from the steps above, and why. Each departure is a
mechanism decision made while the code was read and run; none changes a user requirement.

- **Representation (steps 1–3).** `RegionalState` is the generator's `GenerationState` with a
  `regional` record; the regional run is a `MapRunner` sequence (`canonry.initialize`,
  `refinement.begin`, the schedule steps, `canonry.project`, `canonry.features`,
  `refinement.identity`, `refinement.places`, `atlas.names`) on the world's registry plus
  the regional processes. All regional work runs on the physical field's bands over the
  child lattice; the surface is read only for channels the field has no band for and written
  by projection. `lattice.ts` holds the lattice helpers (positions, frame membership, face and
  corner neighbourhoods, components, a geometric diffusion); `media.ts` the ledger keyed by
  band name; `profile.ts` the regional reading of the world's extraction thresholds.
- **Neighbourhoods are geometric.** The eight-cell neighbourhood is "boxes that touch", not
  "within a multiple of the nominal span": the nominal span differs from the lattice's cell
  width, and a span-based reach let a step skip a cell, which the world's river-path curve
  then subdivided without end (the heap exhaustion seen in the suite). The curve code also
  gained a guard for a zero-length chord.
- **The exterior is the parent's ground.** A map area's own captured inputs are its parent
  channels in `inheritNumerical`, so the halo carries the country beyond the frame rather than
  the frame edge clamped outward (commit `c8f7268` had emptied the parent channels for map
  areas). A run without the physical domain reads the terrain already made: the initial facts
  carry `terrain:present` and the present (non-input) fields are preferred. The fixture's
  parent grid is captured over the frame's padding like a real parent.
- **Diffusion is geometric.** The lattice blur is explicit finite-volume diffusion with each
  cell's own rate (the finest cell's step over the cell's area), so a large exterior cell no
  longer swamps the fine cells beside it; blurs used for calibration are taken over the
  frame's content only, so an edge mismatch is not hidden behind the exterior's agreement
  with itself.
- **The frame edge drains.** Every frame-edge cell whose exterior is no higher is a network
  root (a valley crossing the edge still gathers its country through the cost of climbing the
  base); frame-edge cells are flood outlets when reading captured sinks, since the coarse
  exterior cannot carry a valley narrower than itself; the steepest-descent routing may exit
  to the exterior or sea; each cell takes its root's level in tree order (an index-order pass
  had left most levels at zero, inflating every calibration).
- **Relief is conditioned on the base (ADR 0008), not only calibrated.** After the network
  construction, the base's blur replaces the construction's blur at the base's own smoothing
  length, so at the scales the parent resolves the relief is the parent's and the network
  decides the detail within them; exits return to the parent's ground at the edge. The base
  smoothing length was reduced so a sampled valley floor keeps most of its depth. Without
  this the construction drifted hundreds of metres from the parent (long hillslopes flatten
  toward their divides) and the amplification fit could not recover it. A steep base step is
  climbed in place only where it is steeper than the profile that would carry it (a channel's
  knickpoint gradient, a hillslope's own gradient).
- **Divides and passes.** The world's ridge and pass classes read tectonic ridge influence,
  which a region does not carry; the region marks drainage divides (cells beside ground of
  another channel segment) into that band, and marks a pass where a ridge cell is the low
  point along its divide. The world's own pass rule reads a wide sampling ring that at a
  region's scale sees the flanks more than the crest.
- **Captured rivers.** A developed stem takes a captured course's identity when it runs
  beside enough of the course within the course's valley corridor (not on the same cells);
  the whole stem along the course (upstream by the larger own inflow, downstream) carries
  the name; the name is marked as named in its era so the naming pass leaves it; a course no
  stem stands for stays on the map as captured.
- **FeatureCause registry (step 6).** `regional/causes/`: the interface (`read`, `influence`,
  `support`, `caps`, `conjoin`, `respond`) and the first entries: summit (divide anchor,
  massif repulsion), river course (valley corridor, raster corridor, identity through the
  extraction), lake (captured standing water), river entry (entering discharge), settlement
  seat (river corridor, channel support, footprint caps, settling). The schedule calls the
  registry at context, after the network, every structure step, round two and after each
  round's water. Lake roots and entry inflow are consumed in `growNetwork` from the registry's
  evidence (one place for the network's roots). No landmark entry yet (M2 adds the table).
- **Magic (step 4).** The world engine's inheritance, locating with a regional strategy table
  (budgeted locators replaced by the captured source), propagation, warding, thermal, living
  and ocean feedback and classification run on the regional field each round. Departure: the
  regional Salt ledger effects and door publication were not kept; the whole regional magic
  reimplementation was retired and M5 brings those behaviours through the engine. M1/M2
  renders change in magic organization accordingly.
- **Dead code (step 7).** Deleted: `canonry/regionalPhysical.ts`, `regionalClimate.ts`,
  `regionalCorridors.ts`, `regionalMagic.ts`, `regionalEnvironmentFixture.ts`, their tests,
  the world sequence's child branch (`regionalPhysicalSequence`), `societySequence`'s child
  branch, `realizeRegionalPlaces` and its tests, the `parentId` branch of population
  inheritance, and the regional branches of the society environment refresh. Kept: the
  `inherited` flag and its guards, because they also encode same-area regeneration with a
  prior society (world policy), which the first plan text had not distinguished.
  `prepareAtlasGeneration` refuses a child area that is not a map (site and interior profiles
  excepted; they are built interiors on the world pipeline). The setup projection's regional
  tests now prepare a map through the regional preparation; the regional water and
  environment steps carry the `water.routing` and `physical.climate` feature tags for the
  setup view. Deferred: the ecology engine's per-step exports (M4 hosts the engine; nothing
  consumes them before).
- **Review findings (read-only subagent, 2026-11-01) and what was done.** Blocker fixed:
  the production sequence never initialised the magic workspace (`prepareMagic` was called
  only by the test fixture); `refinement.begin` now prepares it when the run develops magic.
  Also fixed: the settlement cause moved under `causes/` with its own domain gate; the dead
  regional-input diagnostic (unreachable once non-map children are refused) removed.
  Disclosed, not changed in M0: `refinement.begin` reads the surface's derived `flow` and
  `waterLevel` channels into the field (the world binds no inheritance for derived channels);
  the place proposal projects the field to the surface to run the society engine's site
  ranking and maps the samples back (the society host extraction is M6); four module-level
  WeakMaps hold per-state caches (adjacency, path searches, magic work, fixture preparation);
  the ledger (`Contributions`) has readers but no regional writer yet and `respondMagic`
  reports no relief change, so the declared magic reroute follow-up does not fire before M5;
  `refinement.refresh` produces the extraction's `canonry:Validated` fact itself, since the
  world's validation operation checks world-process invariants a refinement does not run;
  `regionalSociety.ts` keeps its spacing, allocation, connection and seat helpers (used by the
  world and the regional places), so the file stays despite the plan text; the world magic
  engine's per-field evaluation is not exported (the regional host composes the engine's
  exported operations instead). Reclassified: the base conditioning, the full-edge exits, the
  divide and pass marking and the geometric diffusion are mechanisms pulled forward from M2's
  terrain work because the re-expressed core did not reproduce the parent without them (edge
  inflation, dammed valleys, summits hundreds of metres below the parent's); they are plan
  adaptations, judged on the four-case renders, not behaviour preservation. Left for M1:
  one unit-conversion helper pair across the regional modules (elevation, temperature,
  per-mille), one lattice reach-walk helper for the four hand-rolled BFS walks, cell area
  taken from the mesh wherever the nominal span squared appears beside it, and a guard rule
  for raw unit literals.
- **After the review, from the gates.** The calibration and conditioning blurs are a separable
  Gaussian over the content grid (the frame's cells lie on one spacing), not diffusion passes:
  a frame-sized blur on the harness cases had made a run minutes long. The regional
  preparation now reports mapped-edit overlaps like the world's (a drawing on the map must
  survive its regeneration) and no longer writes the resolved settings back into the world's
  epoch records (completed history stays as recorded). The draft preparation dispatches a map
  area to the regional preparation. Frontend tests that built legacy non-map children now
  build captured maps, generate the root where they test mapped-edit rules, and one asserts
  the refusal of a non-map child. The regional test files declare a longer per-test budget
  (world-depth runs); the world's ecological region extraction on the adaptive surface
  dominated a run: the adaptive point sampler fitted a Hermite patch per query because its
  caches (sized for a viewport reader) thrashed on a lattice-wide sweep, and the contour
  tracer samples each region tens of millions of times. The generation's sampler now sizes
  the patch caches to the lattice; the contour sampler on an adaptive lattice uses it. A
  bilinear read over the frame's regular block was tried and withdrawn: it is a different
  reconstruction from the adaptive one the world contracts on (the adaptive geology, river
  end and marine region tests failed), and M0 changes no world behaviour. The channel resampling and inheritance sweeps
  (`resample`, `inheritChannels`, the derived-channel reads) pass the same lattice-sized
  budget to the field interpolator (`sweepBudget`), while viewport readers keep the small
  default caches. Ecology extraction on the fixture fell from twenty-five seconds to about
  seven; it still creates one sampler per term and piece and is an M1 repair item. The
  surface that carries the inherited channels until the lattice exists is built at the
  parent's sample span, not the cell span: it carried nothing finer than the parent, and at
  the cell span it was a quarter-million samples that initialization resampled onto the
  lattice (two minutes of a P1 run; fifteen seconds now). A refinement's content cells are
  not square (the frame's own aspect), so the dense grids behind the blur and the block
  sampler step separately on each axis. The runner's per-process validation parsed the whole
  surface against its schema after every process (a third of a minute on P1); the same
  surface object is now parsed once. Remaining P1 cost after these (one profiled run,
  165 thousand lattice cells against the earlier pipeline's 52 thousand samples): the world's
  feature extraction (ecology contouring foremost), the round-two place proposal (the
  society engine's site ranking over a projected surface), initialization, and the magic
  classification; the harness report records the measured per-process times. The first P1 render after the eight-direction
  neighbourhood showed channels ruled along the belt's strike in straight parallel lines
  (D8 routing with the grain's anisotropy); the neighbourhood now has sixteen directions
  (faces, corners and knight's steps, never a cell straight across a gap), which the earlier
  twelve-cell neighbourhood had given by accident. The channel-margin step moved to its own
  module to keep the drainage file within the size rule.
- **From the first full harness run on the new core.** M1 was not deterministic and its begin
  step took five minutes: the magic inheritance read the carrier surface without the sweep
  budget (fixed), and the reconstruction of a sharp captured stock edge undershot below zero,
  a negative ice stock turned Aurora's logarithmic concentration to NaN, and the NaN spread
  through the heat into the ice and the relief (inherited intensities and stocks are now
  floored at zero; three fixture refinements in one process now repeat exactly). The five
  minutes were the magic channels being reconstructed from the lattice-sized surface, one
  Hermite patch per cell per channel; a magic channel is now read from the captured parent
  grid that carries it, like the native bands, or copied leaf for leaf when only the surface
  on this very lattice holds it. A third M1 run differed although its source held the
  same features and fields as the second's. The evidence lists and the feature scans that
  feed them were first ordered by identity (store order changes after a publication), which
  did not cure it; a dump of what each chained run read and produced did. Two things drifted
  through publication while the surfaces repeated: the inherited summit's captured anchor and
  prominence were dropped when the world's extraction found a realized summit where the moved
  feature already stood (its identity reuse writes the realized peak's attributes over the
  feature's), so the third run read the summit from its moved position; and a carried course
  was read once per river of the stem that carried it, so each run claimed one more reach for
  the captured river. The identity step now writes the anchor and prominence from the evidence
  read at context, and a carried course is read once. Three chained M1 refinements (each
  reading the last publication) now repeat in every channel; the only publication difference
  left is the realized summit's own area and cause text on the inherited peak. P1 held
  seven hundred one-cell ponds (every pit two metres deep became a lake): a pool now needs
  three cells to be standing water. The world's gorge and fjord rules read a region's incision
  (every channel cuts below the smoothed base) and its cell-scale inlets as hundreds of gorges
  and fjords: the regional profile raises the gorge slope and incision and the fjord's glacial
  erosion. Still open after this run and recorded for M2/M5, not hidden: the mountain belts
  show strike-parallel streaks (the grain's anisotropy and the material bands through the
  conditioning), valley, pass and range counts differ widely from the earlier pipeline, and
  the magic engine on the regional field publishes floods of Aurora prisms and wells where
  the old regional magic published few.
- **Tests.** Gate A tests were rewritten to assert behaviour on the field; where a check named
  a grid detail or a mechanism this delivery replaced (exact pass cell, single-reach identity,
  lake "resolution" on both axes) it now asserts the behaviour (a pass within a few cells of
  the parent's col, the stem's reaches, a lake several cells long). Two tolerances are
  recorded: land drains to within the pool depth (flats shallower than drawn water remain);
  an entering river's discharge is read at the edge cell by interpolation (within a tenth).

- **Gates at the commit, and the owner's correction.** Lint, typecheck, formatting and the
  architecture guard (a CI vitest check under `make test-architecture`, not an eslint rule as
  the acceptance text said) pass; the whole unit suite passes (289 files, 1,588 tests); the
  default-world digest is unchanged in content (379 plain channels and the feature counts
  equal; the 32 entity-keyed channels differ only in the run's ids); the browser journeys pass
  after one assertion was updated to the sequence's new shape (the regional run carries the
  world's initialization and extraction around the refinement steps). Gate C was last measured
  at about 3.5× the earlier pipeline on P1 and P2 and 6.7× on M1, before the block read was
  withdrawn; the feature counts differ widely from the earlier renders. The owner withdrew
  Gate C and count parity as gates on 2026-11-01: the earlier pipeline is broken and is no
  reference, and M0 had consumed a day chasing them through half-hour harness runs. From here
  a phase is judged by its behaviour existing at fixture scale (touched tests, lint,
  typecheck, a short review); the harness and the browser matrix run only on request.

### M1 expansion (2026-11-01)

Under the lean process: each step's evidence is a fixture-scale behaviour test or a one-off
probe, lint and typecheck; no harness runs. Read before expanding: `regional/climate.ts`,
`glacial.ts`, `living.ts`, `material.ts`, `character.ts`, `drainage.ts` (seepage), the
world's `climate.ts` (`seasonality`, `snowShare`), `geography.ts` (`oceanDistance`),
`latitude.ts`, and `societyChannelAccess.ts`.

Decisions (mechanism choices, with reasons):

- **Media the field has a band for use the band; media it has none for are retained arrays
  in the state record.** `OceanDistance` and `FractureConductance` are field bands and are
  written in place (the world's `oceanDistance` runs on the lattice as it is). Insolation,
  cold pooling and topographic wetness have no world band; adding bands means a schema and
  publication change for three regional-only quantities, so they live in
  `state.regional.media` (one lattice, mesh-indexed, never published) and are re-derived after
  each round's water. The plan's "native bands owned once" principle is read as "one place,
  on the lattice", which this satisfies; the record notes the adaptation.
- **Temperature.** Captured temperature, lapsed by the height the relief gained, plus an
  aspect term (equatorward slope warms, poleward cools, scaled by slope), minus cold pooling
  (depth of a hollow below the surrounding smoothed surface, on gentle ground), plus magic's
  heat and the ledger's `Temperature` total. Precipitation is re-split each round with the
  world's `snowShare` from the new temperature and a seasonal half-range from the world's
  `seasonality` (latitude from the parent's frame, continentality from `OceanDistance`), so
  new high ground turns rain into snow and a warmed valley turns snow into rain.
- **Fracture set.** `FractureConductance` is the captured conductance plus an opening term
  where captured tectonic strain is high and the material band is weak, oriented by nothing
  (the bands already follow the grain); the ledger's total sits on top for M5's magic rocks.
  Consumed by material resistance (network cost, relief) and seepage. `tectonicStrain` is
  thereby consumed.
- **Wetness.** A topographic wetness index, ln(upslope area per unit contour length over
  slope), normalized over the frame's content; `regionalWetness` reads it in place of the
  captured floodplain and delta intensities, which are the parent's and never developed.
  Consumers: wetland cover, soil water through moisture.
- **Glacial repairs.** The ledger's held ice is counted once (in the written thickness, where
  the ledger commits it; it no longer also feeds accumulation, so Aurora's ice does not carve
  in M1; M5 decides whether it should). The cirque depth is a fixed physical depth at full
  strength instead of a share of the parent span. Sea ice and sediment were already repaired
  in M0 (sea cells keep the captured ice; sediment starts from the captured thickness plus the
  ledger). The rock reading is already the captured `RockResistance` against the world's
  baseline. The regional Salt double burn is moot: the regional magic reimplementation was
  retired in M0.
- **Cover and ledger totals.** `respondCover` and `respondClimate` already read the ledger's
  tree, grass, wetland, moisture and soil totals; no change beyond wetness.
- **`channelAccess`.** The world's helper reads retained reaches whenever the area has a
  published drainage network, so a refinement read the parent's captured reaches instead of
  the live regional network. Fixed in place: when the physical field is present it is the
  current terrain and the live channels are read; retained reaches serve runs without a field.

Steps:

1. **Shared media.** `regional/sharedMedia.ts`: `deriveMedia(state)` writes `OceanDistance`
   (world helper), insolation, cold pooling and wetness; `openFractures(state)` writes the
   fracture set at context. Called at context (fractures, ocean distance) and after each
   round's water (all). Evidence: a fixture with a ridge has warmer sun-facing cells than
   shaded ones; a closed hollow is colder than its rim; a high-strain fixture has more
   conductance than a low-strain one; valley cells are wetter than ridge cells.
2. **Temperature and snow.** `respondClimate` reads the media and re-splits precipitation.
   Evidence: on the mountain fixture, new high ground carries more snow than its captured
   share; the existing climate assertions hold.
3. **Glacial repairs and `channelAccess`.** As decided. Evidence: a probe that the held-ice
   contribution appears once in `IceThickness`; `societySupport` tests pass; a regional
   places test sees river access from the developed network.
4. **Record, review, commit.** Plan record, one short read-only review, commit.

#### M1 execution record (2026-11-01)

- **Built as decided.** `regional/sharedMedia.ts` derives the media; the context step opens
  the fracture set before the network is grown and derives the rest after it; each round's
  water step re-derives them. `respondClimate` reads insolation and pooling into the
  temperature and re-splits precipitation with the world's `snowShare` and `seasonality`
  (the `Seasonality` band is written for the extraction). `regionalWetness` reads the wetness
  medium once a round has derived it and the captured floodplain and delta intensities before
  that (a run without the physical domain). `glacial.ts`: the ledger's held ice enters the
  written thickness once and no longer feeds accumulation; the cirque depth is a fixed physical
  depth. `societyChannelAccess.ts`: live channels whenever the field is present.
- **Evidence (fixture scale, `sharedMedia.test.ts`).** On an east–west ridge the equatorward
  flank is warmer than the poleward flank and takes a smaller snow share; the floor of a
  closed hollow is colder than its rim; strained country is more fractured than unstrained;
  a valley floor is wetter than the slopes above it. The regional suite and the society tests
  pass (45 files, 192 tests). The held-ice and `channelAccess` repairs are judged by reading:
  one addition site remains for the ledger's ice, and the live branch is the only one taken
  with a field.
- **Disclosed.** The media the field has no band for are mesh-indexed arrays in the state
  record, not field bands (see the expansion's first decision). The temperature band is the
  annual mean, so "colder in winter" is read as colder on the mean. The snow check was first
  written as "new high ground is snowier" and withdrawn: the captured temperature already
  carries the parent's lapse, so only the height a cell gains over the capture cools it, and
  that is small against the aspect term; the milestone's own acceptance (two sides of one
  relief) is the check. Aurora's held ice does not carve in M1 (M5 decides). The regional
  Salt double burn is moot since the regional magic reimplementation was retired in M0.
- **Review (read-only subagent) and what was done.** Fixed: the parent's `oceanDistance` was
  not among the captured channels and the regional field was not an open boundary, so a frame
  without sea read a constant distance and every landlocked region got maritime seasonality
  (captured now; the field is open, so a cell is as near the sea as the parent said or as the
  sea inside the frame); the media were not re-derived at the refresh or after the magic
  reroute (they are); the wetness medium reached only the wetland cover, not the ground's
  water (it now raises the aridity index that cover reads, scaled by the climate's own
  water); the wetland rule was frame-relative (a dry upland's wettest cells became marsh; the
  topographic term is now scaled by the climate); the live channel read for `channelAccess`
  applies only when the field carries routed channels (a society-only world run's field may
  not); the wetness check reads the developed wetland cover, not the medium. Disclosed, not
  changed: the ledger term in `openFractures` is zero at context (magic's rock work lands on
  the band through the ledger's commit; the term documents the path); `materialBands` is
  integrated once more per run; nothing writes the `Temperature` ledger before M5; the
  fracture check reads the band, not a consumer.

### M2 expansion (2026-11-01)

Under the lean process. Read before expanding: `regional/relief.ts`, `network.ts`,
`drainage.ts`, `margins.ts`, `divides.ts`, `base.ts`, `material.ts`, the landmark cause table
above, the world's `landmarks.ts` (`maintainLandmark`), `landmarkKinds.ts`, `landforms.ts`
(waterfall rule) and `floodplains.ts`.

Decisions (mechanism choices, with reasons):

- **Divide network as a crest term.** The network tree already holds the dual: a hillslope
  cell whose neighbours drain to another channel segment stands on a divide, and the smaller
  of the two catchments it separates says how far up the ridge tree it stands (trunk divides
  between large catchments, tributary divides between small ones). The crest term raises the
  hillslope increment on divide cells by the logarithm of that catchment size, bounded, so
  ridgelines grow along the trunk and dip to cols between small catchments; a seat's footprint
  cap still holds the crest down near it. No separate ridge-tree data structure: the divides
  module reads the network, as it reads the drainage for the classifier.
- **Valley persistence and channel persistence.** The relief is derived from the network, so
  a valley's incision is kept whether or not a river is drawn in it. The drawn river is a
  function of persistent discharge: the routed flow loses water along its path to seepage
  through the ground (intact and fractured, as the lake stage already reads) and to
  evaporation over its wetted width where the climate takes more than it gives, so in dry or
  fractured country channels fall below the river threshold and leave dry valleys with their
  incision. Capture and abandoned channels (W2) follow: the routed water takes the derived
  valleys, and a network valley the routing left keeps its form. Recorded as covered by the
  derivation, not a new term.
- **Landmark evidence and support.** A `landmark` cause reads the captured landmark records
  placed on the lattice (the world's `placeLandmark`, no drift: a region has no epochs);
  influence by kind: mountains repel the network like summits and anchor the crest, canyons
  and falls are corridors the network is drawn into, rings repel along the rim, an
  escarpment's fault is a trunk of the fracture set (conductance along the path). Support is
  the world's own `maintainLandmark` run on the regional field after each structure step's
  relief is written (a new `restore` stage of the registry): the signature is measured and
  the smallest correction applied, re-derived each round (the correction never stacks because
  the relief is re-derived first). A falls where a river crosses an escarpment is the world's
  waterfall class on the restored step. The spring line at an escarpment foot is M5's
  (springs are magic sites); recorded as not done here.
- **Cone extension.** Cones already build; the hard apron enters the material resistance
  within the cone's radius. The caldera (a closed-basin root) and lava plateau are deferred
  with the reason: a new root kind in the network for a feature the fixtures do not hold.
- **Geothermal.** The captured geothermal plus a term for conductance opened above the
  captured fracture set and a term for cone proximity; written where the media are derived.
  Consumed by the magic engine's Fire sources as before.
- **Mass wasting.** One capped pass after the relief is drainable: a hillslope cell steeper
  above its receiver than the material's stable gradient (beyond the base's own step) fails
  by a bounded share of the excess; the failed rock is booked as sediment supply.
- **Fluvial incision, sediment transport, floors, fans, lake deltas.** The channel profile is
  the incision term (exists); incision below the captured base and failed hillslope rock are
  the sediment supply, carried down the network tree with a capacity proportional to flow
  times gradient; the excess deposits (bounded per cell) as alluvial floors where gradients
  fall, fans where a steep channel meets flat ground, a small fan where a channel enters a
  lake (F5), and a mouth load at the sea for M3. Deposits raise the derived surface by their
  thickness and write `SedimentThickness` with the ledger total.
- **River network slope factor.** The channel threshold scales with the inverse square root
  of the base gradient, bounded, so gullies start earlier on steep ground and later on plains.
  The entering-river hook exists.
- **Floodplain valley floor.** A breadth-first floor from each river cell over ground within a
  few metres of the channel (growing with discharge and sediment), in the same basin, within a
  geographic maximum width, replaces the one-ring margin.
- **Runoff loss structure.** The captured runoff is the budget; developed cover changes it:
  trees intercept, wetland holds, so a cleared or afforested cell changes its runoff and the
  next round's water. A full per-term water balance is not rebuilt (the captured budget already
  carries the parent's).
- **Structural relief.** Differential erosion of the material bands is the existing
  hillslope and channel gradient dependence on material resistance; recorded as covered.
- **Dam crests (F3).** A captured dam feature on a channel holds a reservoir: the crest is the
  lower of the two banks across the valley at the dam cell; the water stage behind it fills
  the connected ground below the crest upstream of the dam, written as a lake body after the
  routing. A dam feature cause carries it (`respond` after water).

Steps:

1. **Divides, mass wasting, sediment, slope factor, apron, geothermal** (`divides.ts`,
   `sediment.ts`, `network.ts`, `material.ts`, `sharedMedia.ts`). Evidence: divide cells stand
   above their non-divide neighbours; the foot of a mountain front holds more sediment than
   its slopes; a steep fixture draws channels at a smaller catchment than a gentle one.
2. **Persistence, valley floor, runoff loss, dams** (`drainage.ts`, `margins.ts`,
   `climate.ts`, `causes/dam.ts`). Evidence: a dry, fractured fixture holds network valleys
   with incision and no drawn river; a captured dam holds a lake upstream of it.
3. **Landmark cause and restore stage** (`causes/landmark.ts`, `causes/registry.ts`,
   `relief.ts`, fixture landmarks). Evidence: a fixture with an escarpment landmark shows a
   waterfall class where a river crosses it, and the measured throw holds within a tenth.
4. **Record, review, commit.**

#### M2 execution record (2026-11-01)

- **Built as decided**, with these mechanism findings from running the fixtures: the frame's
  roots owed only the climb cost per metre of height, so on a slope whose exterior is level
  water left sideways at the nearest edge instead of running down to the low exit, and no
  sediment reached the foot of a mountain front; an exit, lake or sink root now owes a larger
  fall cost per metre of height (`exitFall`), which keeps water on the slope. A strict "lower
  exterior only" exit rule was tried and withdrawn: a level plain then had no exit at all.
  Sediment settled within a few cells because the conditioned channel profiles are stair-
  stepped (flat reaches between knickpoints) and the settling share was per cell; settling is
  now a rate per length (a load crosses kilometres of flat ground). Hillslope smoothing eroded
  the crests the divide term built; divide cells are now fixed in that smoothing (their flanks
  round toward them). The sediment band is added to after the glacial step writes it, so
  moraines survive. A dam's crest is read from the second-highest ground around the dam cell
  that is neither channel nor below the bed (the river leaves the cell diagonally, so face
  neighbours include the channel's own next cells). The refresh step re-runs the features'
  responses after its water routing, or a reservoir written in round three vanished.
- **Evidence (fixture scale, `terrain.test.ts`, six checks).** Ridges and passes exist and
  seven in ten divide cells stand above their flanks; the foot of a sampled mountain front
  holds more sediment than the slope above it (the fan lies on the lower ramp of the parent's
  five-kilometre sample, not on the drawn plain beyond it, where loads are exhausted);
  channels start at a smaller catchment on steep ground than on a plain; dry, fractured
  country leaves a larger share of its network valleys without a river, with incision kept,
  than humid country; a captured dam on a gently falling trunk holds a reservoir of several
  cells behind it; an escarpment landmark in the captured ground keeps its measured throw
  within a tenth and a river crossing it is classed a waterfall.
- **Disclosed.** The divide term's first check ("trunk divides stand higher than tributary
  divides") was wrong and withdrawn: the divide between two large catchments is lowest at
  their confluence, so catchment size at a divide cell does not order crest heights. The
  escarpment check first gave the landmark a smooth captured base; the world's symmetric throw
  then dug a 150 m trench along the foot and rivers ran along it to the frame edge, so the
  check now carries the scarp in the captured ground as a parent would. Valley persistence,
  incision memory, capture and abandoned channels and structural relief are covered by the
  derivation (the relief comes from the network, not the drawn river) and recorded as such;
  the spring line at an escarpment foot and the caldera and lava plateau are not built (M5
  springs; a new root kind for a feature the fixtures do not hold). Mouth loads are recorded
  in the state for M3's coast; nothing reads them yet. The runoff loss structure is the cover
  retention factor on the captured budget, not a rebuilt water balance.
- **Review (read-only subagent) and what was done.** Fixed: the incision sediment supply was
  taken at every cell, not only channels; mouth loads were booked at every root (exits, sinks,
  lake roots), now only where a root meets the sea; the world's landmark correction wrote
  halo cells, where nothing re-derives them, so corrections stacked round on round (the halo
  now keeps the parent's ground) and the maintenance band accumulated across rounds (reset
  each restore); the exit fall cost also taxed lake and sink roots, shifting catchments away
  from inland waters (exits only now); the valley floor's channel datum counted sediment the
  surface already carried; the slope factor applied to the network's channels only, so no
  drawn river started earlier on steep ground (drawn rivers now carry it too); the crest term
  raised cols as much as crests (it is now weighted by hillslope length, and only ridges above
  a crest strength are fixed in the hillslope smoothing). Disclosed, not changed: mass wasting
  softens a knickpoint step by the same bounded share as any oversteepened flank; lacustrine
  deltas form at captured lakes only (the routing's own lakes and reservoirs are not network
  roots); the landmark cause carries the table's influence column in reduced form (massif
  repulsion, canyon and falls corridors, ring rims, the escarpment fault) and no response
  column (rim retreat, lip retreat, scarp retreat and breach deepening are M3/M5 work on the
  coast and ice terms); the terrain checks have no "mechanism off" controls, and the
  escarpment check, with the scarp in the captured ground, exercises the conditioning and the
  knickpoint step as much as the landmark's restore; Gate C is not measured (withdrawn as a
  gate), and M2 adds per-landmark path scans, a cone loop in every material read and a
  per-river-cell floor walk.

### M3 expansion (2026-11-01)

Under the lean process. Read before expanding: `regional/relief.ts`, `glacial.ts`,
`climate.ts`, `sediment.ts`, `base.ts`, the world's `windTerrain.ts` (`deflectWind`),
`glacialLandforms.ts`, `geography.ts` (`landmasses`), the coast rows of the checklist and
W3/W4/C1/C4 above.

Decisions (mechanism choices, with reasons):

- **Shore development (W4) as a relief term.** After sediment, each shore cell (land beside
  the sea) reads its exposure: the fetch of open sea upwind along the captured wind and two
  flanking rays, sheltered by the present coast. Exposed shore is cut in proportion to
  exposure over the material's resistance (weak bands and fractured ground give way, resistant
  bands stand as headlands); a cell cut below the datum becomes sea, so coves follow the weak
  bands. The cut volume and the rivers' mouth loads settle in shelter: the least exposed
  shallow sea cells beside land fill first, emerging as spits and bars in a headland's lee.
  Exposure is written to `WaveExposure` for the readers the world has. Re-derived each round
  from the same captured wind and material, so it updates rather than ratchets; the water
  stage reads the moved shore (sea is wherever the surface lies below the datum and connects).
  The network re-root follow-up is not built: the network keeps the captured sea as its roots
  and the relief at a cell the coast turned to sea is cut again each round from the same
  exposure (recorded; M7 judges whether a re-root is needed).
- **Mouth form (W3).** At a shore root with a mouth load: a large load into sheltered water
  builds a delta (the shallow sea within reach fills and emerges, the routing finds the
  distributaries); otherwise the mouth is an estuary, deepened in proportion to the river's
  discharge (a drowned valley). The barred lagoon is left out (longshore drift beyond the
  lee-fill above is not modelled).
- **Bathymetry and landmasses.** The world's shelf class stands; regional depth classes are
  not added (the field's code vocabulary is the world's and its readers test the shelf code).
  Islands are named at the footprint rule: the regional profile's island threshold is the
  published footprint minimum, not ten thousand square kilometres.
- **Wind on the developed relief (C1 in part).** The captured wind is deflected by the world's
  own rule on the developed relief with the terrain smoothing length rescaled to the parent
  span (valley channelling, lee turning); the orographic rain factor already reads the wind
  against the slope, so windward rainfall exceeds lee rainfall across a range. The world's
  column march is not ported (the captured rainfall is the budget; the factor is the regional
  term).
- **Ice (C4).** Ice flows on its own surface (bed plus thickness), down the steepest descent
  of that surface over the neighbourhood rather than down the water network, so a glacier
  crosses a col into the next valley when its surface stands above it; thickness is
  scale-free (proportional to the square root of the ice-covered area feeding the cell, not to
  a cell count) and bounded. Glacial erosion stays inside the derivation (exists); the moraine
  is the terminus deposit (exists); melt is written to `GlacialMeltwater` and enters runoff;
  the glacial cut is booked in `CumulativeGlacialErosion` so the world's fjord and trough
  readers see it. The regional snowline is the per-cell lapsed temperature already in the
  budget (recorded as the local snowline).
- **Fog belts (C6)** are owned with Pressure coasts and are M5's.

Steps:

1. **Shore and mouth** (`shore.ts`, `relief.ts` writes sea cells from the derived surface,
   `profile.ts` island threshold). Evidence: a straight coast of alternating weak and
   resistant bands under an onshore wind retreats further in the weak bands; a steep country
   shedding sediment into a sheltered shallow sea gains land beyond its captured shore.
2. **Wind and ice** (`climate.ts` wind deflection and meltwater into runoff; `glacial.ts`
   surface-routed flow, scale-free thickness, erosion band). Evidence: windward rainfall
   exceeds lee rainfall across a ridge; a cold frame's ice stands on divide cells (a
   transfluent col) and its trough is wider than the same valley unglaciated.
3. **Record, review, commit.**

#### M3 execution record (2026-11-01)

- **Built as decided**, with these findings from running the fixtures: the shore's cut was
  undone a step later by the drainability pass (a cut cell was lifted back above its receiver),
  so the shore now works after that pass; exposure read only on the cells touching water
  could cut one row in one derivation and each round re-derived the same row, so exposure now
  spreads three cells inland, fading, and the sea works a belt rather than a line; a river
  mouth's load builds a delta in the smoothed shallows beside the captured shore, so weak
  bands (which carry more rivers) gain delta ground seaward while losing coves landward.
- **Evidence (fixture scale, `coast.test.ts`, four checks).** Behind the shore roots (which
  stand a metre above the sea and go in any band), a low coast of alternating ten-kilometre
  weak and resistant bands under an onshore wind loses 45 cells to coves in the weak bands
  and 26 in the resistant ones; a steep country shedding sediment into a sheltered shallow sea
  gains land beyond its captured shore; rainfall on a ridge's windward flank exceeds the lee
  flank's by more than a tenth; with the captured temperature falling with the captured
  height, ice from the cold heights stands on divide cells too warm to snow on (a transfluent
  col) and the glacier's cut spans more cells across its valley than the river's own (a
  trough wider than its river), where the unglaciated valley has none.
- **Disclosed.** The fixture's rock bands must be two parent samples wide to be captured at
  all (a five-kilometre band on a five-kilometre parent averages to one value), and a shallow
  sea beside land is smoothed above the datum within about a kilometre of the captured shore,
  so the realized coast sits seaward of the drawn one in every band; both are properties of the
  capture, recorded for M7. On resistant rock the derived relief stands a hundred to two
  hundred metres high at the very shore where the parent has three to thirty: the hillslope
  gradient's material factor outruns the base conditioning there (M7 item). Not built: the
  network re-root at the moved shore (the water stage reads the moved shore; the network keeps
  the captured sea), the barred lagoon, regional bathymetry classes, fog belts (M5), and the
  world's column march (the orographic factor on the captured budget stands in). Melt enters
  runoff only on ice-covered cells. The ice flow's two passes resolve one spill over a col,
  not a glacier's full thickness-flow equilibrium.
- **Review (read-only subagent) and what was done.** Fixed: the shore's cut could leave a
  sub-datum pit behind an uncut headland and a weak cell below its receiver (the cut now
  works inward from the water's edge, a cell only once a nearer neighbour is water, and ground
  cut to the sea is held there while the rest drains); the lee fill and delta fill could raise
  a lake floor or ground the cut had just taken (only the sea's own shallows fill); a cove's
  lowering was booked as river incision (it is not); moraines were placed at the water
  network's receiver although the ice now flows on its own surface (placed where the ice went);
  the island threshold was dead on a region (removed) and the world's wind blocking height of
  fifteen hundred metres left the deflection inert on regional ranges (three hundred); the
  delta's exposure limit is named. Two checks passed for the wrong reason and were rewritten:
  the mouth check counted captured land as gained (now: sea the network held that is land);
  the ice check counted snow on divides as transfluence (now: the captured temperature falls
  with the captured height, so only the heights snow, and ice is sought on divides too warm to
  snow on; the width is read across the glaciated valley against the same valley unglaciated).
  Disclosed, not changed: the wind check measures the orographic rain factor (M0), which the
  deflection can only weaken; exposure reads the captured coast each round (the cut never
  compounds, by design); a ray leaving the lattice counts as open sea; glacial and coastal
  landform classes are not classified on a region (the world's trough and moraine classes run
  in its own extraction; the fjord class reads the booked glacial erosion on land only);
  meltwater starts one cell above the terminus; the wind terrain's sampler cache is built each
  round and unused; the shared `GlacialMeltwater` band carries a plain mm/yr here and an
  ice-weighted per-mille on a world.

### M4 expansion (2026-11-01)

Under the lean process. Read before expanding: the world's `ecologyVegetation.ts` (the
evolve order), `ecologyProcesses.ts` (forcing, authority, initialize, present, advance),
`ecologyEstablishment.ts`, `ecologyDisturbance.ts`, `ecologyGrowth.ts`,
`ecologyEnvironment.ts` (`environment`, `classifyBiome`), `ecologyBiomes.ts`,
`ecologyFeatures.ts`, `ecologyState.ts`; `regional/living.ts`, `climate.ts`, `schedule.ts`.

Decisions (mechanism choices, with reasons):

- **The world engine's operations run on the regional field, hosted by one regional module.**
  `regional/ecology.ts` calls the engine's own steps in the engine's order (soils,
  disturbance, flood, dispersal, growth, carbon, present, classify) with the round's declared
  horizon (250, 60, 20 years; the refresh runs the present step only). The world's process
  wrappers (epoch bookkeeping, world authority, record and validate) are not reused; the
  regional host supplies forcing, authority and the initializer. `living.ts` is retired: the
  engine's `classifyBiome` names the cover and the world's ecological feature extraction, which
  already runs in `canonry.features`, names the habitats by its rules over the cohort bands.
- **Regional initializer.** Once, before round one: the engine's inheritance (functional
  groups from the captured tree cover) and then the cohorts from the capture: the conifer
  share of the tree cover from the captured temperature (all conifer at two degrees, none at
  eight), saplings from a young captured canopy age, seeds from presence of each group's
  cover, soils and carbon as captured. No noise. The engine's history memory bands are set to
  the captured state so soil damage reads this run's change (ice, incision), not the parent's
  cumulative history.
- **Forcing and authority.** Forcing per cell is the engine's neutral forcing plus the
  shared magic bands the field carries (quickening, stillness, verdure, salting) and the
  fire causes; authority is the engine's own tree-cover update (authored protections hold
  cover through the world's existing fixed-channel path, unchanged). Riparian supply (E4) and
  the wetness medium (E1) enter the soil water the engine's environment reads: the captured
  soil water raised on the valley floor by the wetness medium and on the channel margin by the
  floodplain intensity.
- **Fire with cause-keyed ignition.** Ignition cells are causes with one stable keyed draw
  each: ground under magic heat; the driest, best-fuelled cell of each ten-kilometre block;
  the edge of a settlement's footprint. They enter the engine as its `fire` forcing at those
  cells. The engine's own background ignition (its noise term) remains alongside, disclosed:
  it lives inside the engine's ignition rule, and the checklist asks for the regional causes,
  not for the engine to lose its own.
- **Dispersal.** The engine's fronts run as written, including its sea crossing; the plan's
  "no sea crossing" is not enforced (a frame's islands are within the engine's reach rules)
  and is disclosed.
- **Present refresh.** Cover under new sea, lake or ice dies at once with its litter to the
  soil, each round and at the final refresh (the engine's mortality at full stress).

Steps:

1. **Host and initializer** (`ecology.ts`, `schedule.ts`, `living.ts` retired). Evidence: a
   dry valley's channel margin carries more trees than the ground away from it (riparian
   strip); the poleward flank of a ridge carries a larger conifer share than the equatorward
   flank; a dry country burns somewhere and the burned ground has more saplings than mature
   cover; wet flats hold more peat than dry ground; burned ground sheds more runoff than its
   captured budget (the water path across rounds).
2. **Record, review, commit.**

#### M4 execution record (2026-11-01)

- **Built as decided.** `regional/ecology.ts` hosts the engine: the initializer (inheritance,
  then cohorts by captured temperature and canopy age, seeds by presence over the floors the
  world's founders give without their noise, history memory at the captured state), the
  forcing (neutral plus the field's magic bands and the fire causes), the soil-water supply
  (captured plus the wetness medium and the channel margin, applied after the engine's soil
  step so the growing cover reads it), the engine's steps in its order with the round's
  horizon, the present refresh (cover under new sea, lake or ice dies) and the engine's
  classification. `living.ts` and its tests are gone; the schedule's cover step and refresh
  call the host. A river's valley floor is at least its own ring where the ground is flat (a
  small river's floor at this cell size had been nothing beyond the channel cell).
- **Evidence (fixture scale, `ecology.test.ts`, three checks).** A country captured at one
  degree is conifer country and at fifteen degrees broadleaf country; dry country burns at its
  cause cells, the burned ground has more saplings than mature cover, and more than half of it
  sheds more runoff than its captured budget (the water path across rounds); wet flats hold
  more peat than dry ground. The regional suite passes (14 files, 68 tests).
- **Not demonstrated, and why.** The riparian strip and the wetness medium's effect on cover
  do not show at fixture horizons: the derived relief at this cell size incises every channel
  tens of metres below its banks even where the parent is flat (the calibration fits the
  parent's blurred heights, which a fine sawtooth averages out of), so no valley floor exists
  to be riparian, and the engine's soil step and growth then dominate the soil water the
  medium supplied. A hillslope term scaled by the parent's local gradient was tried and
  withdrawn: it changes the M0 relief core's behaviour beyond this phase and broke an
  established behaviour check (the entering river's edge source). Recorded for M7 as the first
  relief item to judge on renders: flat parent ground should stay flat. The conifer-on-the-
  cold-aspect acceptance did not move the conifer share measurably within the horizons (the
  cohorts are set by the captured temperature and the engine's rates are slow) and is carried
  to M7's render judgement. The bog behind a moraine is covered by the peat check only in
  kind (peat on wet flats), not at a moraine.
- **Disclosed.** The engine's own noise ignition remains beside the cause cells; its sea
  crossing runs; the horizons are the agent's constants (250, 60, 20); dispersal and animals
  are the engine's as written; the fire causes draw one keyed chance per ten-kilometre block
  per round (so the same block may burn every round).
- **Review (read-only subagent) and what was done.** Fixed: the captured soil-water baseline
  was read after the engine's soil step had overwritten the band (kept at initialization);
  the supply was uncapped and could zero the engine's drought anywhere (capped at the soil's
  capacity, as the engine's soil step has it); a parent that published no canopy age made
  every captured tree a sapling (zero means mature); the authority callback was the engine's
  own update twice over, so authored forest polygons and fixed ecology channels held nothing
  during the rounds (a regional authority now holds them, as the world's does); the per-system
  ecological effects (growth, fire, preservation, toxicity, dispersal) were not bound into the
  forcing (they are, through the held-charge gate the world's bindings use); climate and the
  engine both wrote soil depth each round, so soil evolution never outlived a round (climate
  writes it only until the engine owns it); round one's whole relief derivation read as
  incision damage and wiped cover along every channel (the history memory now starts at the
  derived relief, so damage reads change from there); fire causes could mark water or ice. The
  fire check counts a few blocks' keyed draws and compares burned ground's runoff rise against
  unburned ground's. Disclosed, not changed: the engine's soil step then overwrites the supplied
  soil water within a round, so the supply acts on the cover of that round only; the peat
  check and the cohort check observe the engine's rules and the initializer's rule, not
  development; the engine runs eight dispersal searches and one fire search per round against
  the plan's budget of four; the retired living module's sub-resolution pond rule is replaced
  by the engine's own submerged classification; the floor's minimum ring (M4) gives every flat
  cell beside a river a floodplain reading regardless of discharge; habitat features are
  extracted by the world's own rules in `canonry.features`, untested here.

### M5 expansion (2026-11-01)

Under the lean process. Read before expanding: `regional/magic/index.ts` (the host as M0 left
it), the world's `magicProcesses.ts` (the evaluation order and the writes it sequences),
`magicFeedback.ts` (rock, thermal, living, ocean, coastal; `heldCharge`, `holdIce`),
`magicConfluences.ts` (evaluate, displace, bound, apply), `magicHallowed.ts` (`markRim`,
`hallowedWrites`), `magicVeil.ts` (`pairingSources`, `veilWrites`), `magicSalt.ts`,
`magicWeather.ts`, `magicFeatures.ts` (`coverSystems`), `riverWarmth.ts`, `media.ts`.

Decisions (mechanism choices, with reasons):

- **The host keeps the engine's operations and adds the ground writes through the ledger.**
  M0's host already locates, propagates, wards, and runs the thermal, living and ocean
  feedbacks and the meetings' evaluation each round. M5 adds what the world sequences after
  them, each as a declared ledger total so a re-evaluation replaces rather than adds (the
  checklist's rule two): rock hardening and weakening and conduit opening from the systems'
  intensities; the meetings' own processes (fractures, rock, bounded signed relief with a
  per-cell hash, soil removal, coastal forcing, ice melt) scaled by their coverage, read from
  the engine's own confluence states; the Hallowed spill (the first unwarded reach below a ward
  loses resistance); Veil's wild relief and door chill and pool; Salt's glass, desiccation and
  Fire's burn of the stocks once (round one), so the burn is not double-counted. Fog and
  toxicity are written as maxima (idempotent); the door's grass ring likewise. The ledger
  cycle (begin, declare, commit) runs inside the magic step; the committed relief change is
  what the schedule's declared reroute follow-up reads. Storm writes (X5) and the coastal
  forcing consumer are left to the coast's ledger reads and disclosed.
- **Cover systems before meetings, rim marked.** The engine's class coverage runs before the
  meetings' evaluation (the meetings read it), and the ward rim is marked each round (X3's
  band, from the engine's own marking).
- **Ice held by charge.** `IcePersistence` is derived each round from the systems' persistence
  effects at their held charge (the engine's gate on intensity), and the glacier's melt is
  reduced by it; the world's history-based `holdIce` is not run (a round is not an epoch).
- **Doors seeded from captured door features** (a line's two ends, or one end when the far end
  is outside the frame), kept while both ends qualify by the engine's own pairing.
- **Boundary inflow (X1).** The captured intensity stands as a floor along the frame edge,
  fading inward over a parent span, so a field the parent carries across the frame does not
  stop at the edge for lack of a source inside.
- **River warmth (X6).** The world's own down-tree warmth pass runs after the fields.
- **Not built, with the reason:** X2' carrier resolution (the captured stocks stand where the
  parent put them), X5 storm medium, F6 dried basins crusting salt (a stock write with no
  captured-lake-dries fixture; M7 judges on renders), the ocean feedback's regional depth
  classes, the magic-landmark conjunctions beyond what the engine's sources already do.

Steps:

1. **Writes, hold, doors, inflow** (`magic/writes.ts`, `magic/index.ts`, `glacial.ts`).
   Evidence: Fire's intensity changes rock resistance through the ledger and a second
   evaluation leaves it unchanged; a captured ward has a rim band of cells beside it; a
   captured door chills its ends; a captured field at the frame edge keeps its intensity there
   with no source inside; Aurora's charge holds ice where it is strong.
2. **Record, review, commit.**

#### M5 execution record (2026-11-01)

- **Built as decided.** `magic/writes.ts` declares the ground writes as ledger totals (rock
  and conduits by intensity, the meetings' effects by their coverage from the engine's own
  confluence states, the Hallowed spill below a ward, Veil's wild relief and door chill and
  pool, Salt's glass and desiccation, with Fire's burn of the stocks in round one only),
  holds ice by the systems' persistence at their held charge (read by the glacier's melt),
  seeds doors from captured door features and keeps them as established evidence while the
  engine's pairing adds its own, and gives every field the captured intensity as a floor
  along the frame edge fading inward over a parent span. The host runs the engine's class
  coverage before the meetings, marks the ward rim, runs the world's down-tree river warmth,
  and commits the ledger each round so the schedule's declared relief follow-up reads the
  change. The ledger thereby gained its first writers: until M5 it had readers only.
- **Evidence (fixture scale, `magicDepth.test.ts`, five checks).** Fire's intensity changes
  the rock's resistance where it reaches, re-evaluations converge (each moves fewer cells than
  the last) and never stack beyond one evaluation's declared total over the captured rock; a
  captured Hallowed ground has a rim band of unwarded cells each beside a warded one; a
  captured door's two ends are kept and stand colder than the capture by its chill; a field
  the parent carries across the frame keeps its intensity along the edge with no source
  inside, well above the interior; Aurora's charge holds ice where its field is strong and
  nowhere it is weak (the hold is read; a thickness comparison with and without Aurora sat
  inside the relief's own variation at fixture scale, because the field re-derives weaker
  inside the frame than the capture and the hold's persistence with it). The existing magic
  checks (M0) still pass. Noted from the probe: declaring rock from the change in intensity
  restores hardening where the regional field is weaker than the parent's (Aurora's weakening
  undone where its field thinned), which is the row's intent.
- **Disclosed.** A captured door is kept whether or not its ends still carry tear strength (a
  deviation from the pairing row's "while both ends qualify": the parent's door is evidence
  like a seat, and a fixture cannot supply the engine's tear strength without two other systems
  meeting there). Re-evaluation is convergent, not identical: an opened conduit lets the next
  propagation reach further. The salt burn runs once in round one and not on a later
  refinement of the same map (the stocks are re-read from the capture each run). Not built:
  the carrier resolution (X2'), the storm medium (X5), dried basins crusting salt (F6), the
  ocean feedback's regional depth classes, the coastal forcing consumer in the coast process
  (the ledger total is declared; the shore reads exposure only), the magic-landmark
  conjunctions beyond the engine's own sources; the dam, canal and portage conjunctions are
  M6's.
- **Review (read-only subagent) and what was done.** Fixed: the soil and moisture totals were
  declared as shares of the band as last written, so they chased themselves round to round
  (glass soil flipping between gone and restored, desiccation halving and recovering); every
  total is now declared against the captured ground. Rock and conduit totals re-added the
  parent's hardening the captured rock already holds (declared from the change in intensity
  since the capture, as the checklist row asks). The ledger recorded what it wanted rather
  than what the band took when a floor clamped it, so later totals drifted; it records the
  applied amount and bounds the magic bands above as the world does. The ice hold read the
  intensity alone (it reads the engine's held charge, with its ice-presence gate). The river
  warmth pass read a heat forcing band nothing regional wrote (the applied heat is written to
  it first). Door seeding ran before the earlier products were cleared and could read this
  map's own last doors (only the parent's are read). Toxicity was a ratchet (it re-forms from
  the capture each evaluation). The rim call was redundant (the engine's living feedback marks
  it). Two checks were rewritten to observe M5 rather than M0: the ward check reads the spill
  (resistance lost below the ring), the ice check compares ice thickness with and without
  Aurora. Corrected in the decisions: the rim is the engine's one-cell rim, not X3's weighted
  band; a captured door is kept outright and is not a Veil source, and the engine's pairing
  cannot add a door inside a frame at its three-hundred-kilometre distance (not rescaled).
  Disclosed, not changed: the ocean rays' retrace, the system-level coastal forcing producer,
  the meetings' debris and soil-water scaling, Veil's cover shuffle, the burn's fuse of burnt
  ground, the geothermal captured-core release, the aquifer catchment and the normalised
  strain rows are not built; the acceptance's coverage table, Fire vein structure, charge
  moving to a cirque, meeting displacement and door hinterland are not evidenced here
  (meetings displace parents in the engine, unobserved by a check); the regional magic
  duplicates were retired in M0.

### Sulion mapping

Root plan `5732ab12-bbaf-45e0-a972-55a163ae8ff9` "Regional refinement at world depth (one
representation)". Milestone phases: M0 `38866554-d3e6-4206-b8ca-eee0b24c009e`, M1
`9e68a47a-9c55-42ad-9355-e8ace4f2b826`, M2 `45276a6c-ad78-4e63-8e7c-009dcb351af8`, M3
`0d73bb48-cea3-4e2c-99ee-fffba493c667`, M4 `059b5010-b91a-4f76-945e-cebdc881d366`, M5
`c44b8a43-8ff6-4861-8a99-feee9289500d`, M6 `b06ffed9-b952-476d-b5dc-90be6c32144c`, M7
`bb02859f-f6e5-452b-ab4c-84feb2ddee5d`. Closed predecessors: the first delivery
`abf8e123-a6c6-472e-9254-2006d2b2470b` (completed); `ca5efe77-0da8-43df-927d-430fc69524f2`
(field-bridge milestones) and `d7bc0e07-3d2a-48f1-a2de-cd604bc61739` (lattice-adapter
milestones), both canceled as superseded by the one-representation decision.

### Current state

M0 (software organization), M1 (shared media and repairs), M2 (terrain and water at depth),
M3 (coast, climate and ice at depth), M4 (ecology at depth) and M5 (magic at depth)
committed as recorded above. Next: M6 (society at depth) through plan-phase, under the lean
per-phase process the owner set on 2026-11-01.

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
- [x] terrain (now network + relief): datum from `seaLevel`; connected sea from frame edges
      and captured ocean; river entries at edge samples with inward descent; captured lake
      basins; erosion and sediment channels; slopes; society-only runs derive no relief.
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
