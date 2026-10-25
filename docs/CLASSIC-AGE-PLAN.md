# Classic age: a medieval default world on a dynamic temporal scale

Working plan, opened 2026-10-24. Planning only; no implementation is authorized
by the planning request. The last step moves durable content into the
[generation guide](generation-workflows.md), the backlog or an ADR and deletes
this file.

## Outcome and scope

The default new world reads as the classic fantasy age: roughly medieval
approaching renaissance. Its largest capitals hold on the order of 100,000
people, regional capitals tens of thousands, market towns a few thousand, and
its kingdoms have had time to fill their land and build. Today the default world
reads as an age of city states: the largest settlement in a measured default
draft world held 16,958 people and the median community had filled 15% of the
land it holds.

The human simulation reaches that age without a proportional increase in
generation cost. Instead of simply adding simulated years at the current fixed
ten-year cycle, the cycle length follows how fast society is changing, so a
longer history costs about as many cycles as the present 200 years do.

Non-goals: new map types, city layouts, a backend, saved or recoverable
execution, numerical parity with Canonry, a redesign of magic coupling (ADR
0004/0005) and any change to the regional refinement subplans' ownership.

## Context and reuse map

M0 baseline, 2026-10-24, `pnpm --dir frontend inventory:society` (default
recipe, seed 104729, 3,000 × 2,000 km, draft quality; 63.5 s in total, with
the working tree carrying another session's uncommitted mesh changes, so
geography differs slightly from the two earlier scratch runs):

| Measure                                              | Baseline                         |
| ---------------------------------------------------- | -------------------------------- |
| Communities / inhabited                              | 416 / 308                        |
| Total carrying capacity / people after the present   | 33.3 M / 5.5 M (fill 0.17)       |
| Urban residents / urbanization                       | 494 k / 8.9%                     |
| Community fill, q25 / median / q90 / max             | 0.09 / 0.17 / 0.35 / 1.7         |
| Capacity per km², median / q90 / max                 | 19.8 / 32 / 50.9                 |
| Settlement residents ÷ community, median / max       | 7.6% / 24.4%                     |
| Capitals (8), sizes                                  | 12,631 … 558 (largest of 82,709 people) |
| Regional capitals (18), largest / smallest           | 7,046 / 1,874                    |
| Present era                                          | 200 years, 20 cycles, 1.1 s per cycle (max 2.8) |
| Ice-age round                                        | 400 years, 16 cycles, 1.1 s per cycle; 16.4 M people discarded |
| `human.evolve` / all human processes                 | 21.4 s / 28.5 s                  |
| Connections (land / sea)                             | 1,096 (823 / 273)                |
| Roads published / major settlements / majors without a road | 13 / 38 / 21              |
| Connected components among the 38 majors             | 27                               |

Three stacked causes, in order of size:

1. **Time.** `societyProcesses.ts` runs the present eras (`frontend/src/generationDraft.ts`
   defaults: an "Ice age" round of 400 years bound to the before-present epoch,
   then "Settlement", 200 years). The round's people end as ruins by design
   (`societyRound.ts`); the present starts again from founders drawn at 4–24% of
   capacity for about a fifth of communities (`societySettlements.ts`
   `startingPopulations`). Growth is logistic at 0.012 per year
   (`societyPopulation.ts` `growPopulation`), doubling in about 58 years, so 200
   years takes the median community to 15% of capacity. About 500–700 settled
   years fill it.
2. **Own-catchment urban share.** `societySettlements.ts` `concentration` sets a
   settlement at people × density × (0.025 + site draw + 0.2 × farming share ×
   market + 0.06 × water); the observed share is 7% median, 25% maximum, which
   is already a plausible medieval urbanization *per catchment*. The published
   population is the minimum of this and the community's people
   (`societyPublication.ts`).
3. **No concentration across catchments.** The market term is a ratio of
   reachable neighbours within about 50 km of travel cost; it scales a town's
   own share and never moves anyone. `migratePopulation` moves people toward
   room per head, which equalizes territories. Politics (`societyPolitics.ts`,
   `societyHierarchy.ts`) picks seats from existing sizes and does not feed
   them. With every territory full, the best community would hold about 272k
   and its town 50–70k; 100k cities need cause 2 or 3 addressed as well.

**Roads (observed 2026-10-24: three or four per continent).** On a second
default draft run: 411 communities, 319 inhabited, 1,077 connections (802 land,
275 sea), 27 major settlements (7 capitals, 18 regional capitals), 2 roads
published; 23 of the 27 major settlements have no road at all.
`societyPublication.ts` `publishRoutes` walks `region.connections`, which only
holds links between *adjacent* catchments (`societyGeography.ts`
`connectionsFor`), and at World keeps a link only when both endpoints are in the
mapped set, i.e. both are major (`societyMapScope.ts`: capital, regional
capital, or 5,000 concentrated residents). A road therefore exists only where
two major towns sit in touching territories. There is no trunk network: nothing
realizes the chain of adjacent links a traveller would follow between two
capitals through minor catchments, so those links are neither latent nor
realized, just dropped. Nothing culls roads downstream; the frontend draws every
published road. Sea links are never published as routes (`findRoute` with kind
`road` forbids ocean cells). The size problem makes this worse by keeping the
major set small, but M2 alone would not fix it: capitals a few territories apart
would still have no road between them.

Every cycle process is already written against elapsed years rather than a
cycle count: logistic growth, migration response `1 − exp(−years·mobility/120)`,
settlement relaxation `exp(−years/30)`, work condition `exp(−years/80)`,
hazard draws `1 − exp(−rate·years)`, political support `exp(−years/80)`, land
clearance and conservation doses. `societyEvolution.ts` `evolveSociety` and
`societyRound.ts` `runEra` choose a fixed step (10 and 25 years). Two places
read the step itself: `societyPolitics.ts` resettles ruins only when
`years > 80` (end-of-era call, not per cycle) and `societyPopulation.ts`
merges per-cycle era records. Determinism comes from the context's seeded
random stream; hazards key their draws on era, cycle index and community.

Cost: the present era's cycles are the expensive part of human generation
(earlier profiling in plan 09693b37: about 2 s per round cycle against up to
16 s per present cycle on the default-size standard world before the language
fixes; the measured draft run above completed in 66 s in total). Plan 09693b37
records the user requirement to preserve iterative founding, decline,
abandonment and recovery, and its principle that reduced history is not a
performance fix.

Consumers that read settlement and community records: `societyPublication.ts`
(features, fields, routes), `societyHierarchy.ts` (capital, regional capital,
market town roles consumed by `featureCatalogue.ts` and `societyMapScope.ts`),
`societyInheritance.ts` (regional refinement inherits people by footprint
share; subplan D of `REGIONAL-REFINEMENT-PLAN.md` builds on it), the inspector's
local population history, and the era form `frontend/src/HumanEraForm.tsx`
(years, mobility, political capacity per era; eras may bind to a physical
epoch). Backlog item 11 asks what an ice-age round's bands become.

## Decisions

User requirements (this request, 2026-10-24):

- R1. The default world is the classic fantasy age: roughly medieval
  approaching renaissance, not Greek city states. Capitals reach the 100k
  class.
- R2. Do not fix this by simply adding a large number of simulated years at the
  current fixed cycle. Use a dynamic temporal scale.
- R3. Do not add much more time to the human simulation. Confirmed
  2026-10-24: this means generation cost (cycles, wall time), not the
  simulated span.
- R4. Shipping lanes are map features.
- R5. Roads are more than settlement connectors: a developed network.
- R6. A rare opportunity for grand highways: straight shots through plains.
- R7. Roads route through the physical landscape appropriately: valley paths,
  along rivers, over passes.
- R8. A small, lightweight process reinforces well-travelled roads and
  connects them.
- R9. Major roads are not always a shortest-path construction between map
  points, especially not in a pre-modern era.

Agent-derived choices:

- D1. **Interpretation of R3 (assumption, recorded for correction).** "Time"
  is read as generation cost: the number of society cycles, and so wall time,
  stays near today's. The simulated span becomes whatever the medieval target
  needs (expected 1,000–1,500 settled years) and is covered by roughly the same
  number of cycles because the step length adapts. If the user instead means
  the simulated span itself must stay short, M1's lever changes from span to
  the growth and founding parameters, and M2 carries more of the result.
- D2. **Dynamic step.** Each cycle chooses its length from the state: the step
  is the shortest relaxation time that currently matters, bounded below and
  above (expected 10 and about 60 years). The driving measure is the
  population-weighted growth rate `r(1 − N/K)` across inhabited communities
  together with migration pressure; using the weighted rate rather than the
  maximum keeps one frontier catchment from pinning every cycle at the minimum.
  Rounds use the same rule with their own bounds. Rate-based processes need no
  change; the plan verifies that results at the adaptive step stay close to
  the fixed ten-year step on the same world (same founding, abandonment and
  decline behaviour, not identical numbers). Alternative rejected for now: a
  fixed years-per-cycle per era in the era form. It is simpler but static,
  and the user asked for a dynamic scale; it remains a fallback if the adaptive
  rule proves unstable.
- D3. **Concentration across catchments.** A central-place allocation: each
  community's town-dwelling share (today's `concentration`) is demand for
  urban residence, allocated among reachable centres by attraction that grows
  with the centre's existing size, its political seat, harbour or pass, and
  decays with travel cost; a share stays home. Residents who move are real
  migration into the centre's community groups, so culture, language and the
  existing conservation check (`before + births − deaths = after`) carry over
  unchanged, and regional inheritance by footprint needs no new rule. The
  centre's own logistic capacity remains the food bound; the measured best
  community (272k capacity, 91k people) shows World territories can feed a
  100k city once people concentrate. Alternatives: a separate urban account fed
  by imported food (double-counting risk, new inheritance rule) or raising the
  per-catchment urban coefficients (produces many 30k towns, no primacy).
- D4. **Default eras.** Keep the ice-age round. Replace the single 200-year
  present era with a short sequence whose total span fills the land, with
  mobility and political capacity rising across it so kingdoms consolidate
  late. Names and durations are a lore choice for the user (see open
  decisions); the mechanism does not depend on them.
- D5. **Acceptance is a size distribution, not one number.** Target for the
  default draft world: largest capitals 60k–150k, regional capitals 10k–40k,
  market towns 2k–10k, a roughly rank-size (Zipf-like) ordering, overall
  urbanization 8–15% with rich coasts and river lands higher, median community
  fill at least 0.6 and the best at least 0.9. These are agent-derived checks
  of R1; the user judges the map.

- D6. **Travelled ways (R5, R8, R9).** The catchment adjacency graph stays the
  travel model, and each cycle writes the travel it carried onto its links:
  migration flows, market contact and political reach already compute per-link
  weights, so wear is their sum times elapsed years, decaying slowly when
  unused. Wear lowers a link's travel cost (a worn way is faster), and the
  next cycle's migration, contact and reach read those costs, which is the
  reinforcement loop: used ways attract use, side ways fade. The work is one
  pass over about a thousand links per cycle. Publication realizes a link as a
  road when its wear passes a class threshold, independent of whether its
  endpoints are major, so roads form a network through minor catchments; a
  floor guarantees each major settlement a connection to its nearest majors
  and each capital to its polity's regional capitals. Links below the
  threshold stay latent for subplan D. Road class (track, road, highway)
  follows wear, not endpoint role, so a major road is the way traffic made,
  not a line drawn between two points. Alternative rejected: publishing only
  shortest paths between majors (first proposal); it meets connectivity but
  not R9.
- D7. **Roads follow the land (R7).** The published geometry comes from
  `findRoute` with a road cost that prefers valley floors and river banks
  (channel access, low slope), uses saddles for crossings, pays for fords and
  bridges at river crossings, and penalizes steep ground, forest and wetland
  more than today's slope-only term. The society travel edges already price
  rivers at half cost; the published road adopts the same preferences so the
  drawn way matches the way people travelled.
- D8. **Grand highways (R6).** Rare and built, not emergent: a structural
  society work (ADR 0005, like a dam or harbour) that a polity with enough
  political capacity, support and tenure raises along a trunk way whose
  straight line crosses open, low-relief country, when the straight line
  saves enough over the worn way. Its geometry is the straight shot; it is
  dated, named, decays when unmaintained like other works, and becomes a
  highway-class road. Rarity comes from the conditions, with a per-polity
  limit, not from a random draw alone.
- D9. **Shipping lanes (R4).** Sea links accumulate wear the same way. A worn
  sea link between harbour settlements publishes as a lane feature in the
  routes layer, routed over sea cells with a pre-modern coast-hugging
  preference (open water costs more unless practice or magic says otherwise),
  classed by wear like roads. Lanes are never routed over land and roads never
  over sea; a trade route of both kinds meets at a harbour.
  Alternative rejected: lowering the 5,000-resident threshold so more towns
  become major; it floods the World map with regional places and still joins
  only adjacent pairs.

Open decisions [DECISION], owner: user.

- O1. Resolved 2026-10-24: the user confirmed D1. The span follows the
  target; cycles stay near today's count.
- O2. Default era names and count (D4). Blocks M4. Recommendation: three
  present eras, for example "Settlement", "Kingdoms", "High age", about 300,
  600 and 400 years, mobility 1 / 0.8 / 1, political capacity 0.6 / 1.2 / 1.5.
- O3. Whether ice-age survivors seed the present (backlog item 11). Deferred;
  not needed for R1 under D2/D3. Revisit if M1 shows the fill still short.

## Milestones

### M0 — Demographic inventory and targets

Scope: a short headless scenario (generation test or diagnostic, draft
quality, the default recipe) that prints the distribution used by D5: fill,
urban share, settlement sizes by role, urbanization, cycles per era and
seconds per cycle, plus the route measures used by M3 and M3b: roads and lanes
published by class, roads per major settlement, connected components among
majors, highways and their conditions. Record the baseline in this document.
Acceptance (agent check of R1/R3): the inventory runs in a few minutes, is
deterministic for a seed and reports every D5 measure plus cycle timing.
Evidence: the printed table for the current code, kept here as the baseline.

Sulion: `8f23e957-f9e7-46f3-a580-6e388d6a50d9`; expansion `9a664352-ec07-4bb1-8614-c557b8ba7eab`.

#### Execution steps

1. Inventory module and script (`5f0cc5fc-6cc8-4878-a67a-bd964536a9a7`)
   - File(s): `packages/generation/src/societyInventory.ts` (+ export),
     `frontend/scripts/society-inventory.ts`, `frontend/package.json` script
     `inventory:society`, `frontend/tsconfig.json` include `scripts`.
   - Reference / outcome: D5 measures and the M3/M3b route measures from the
     published snapshot (`world.societies[area]`, settlement and route
     features, `settlementHierarchy`); cycle timing from `generateAtlas`
     progress messages (`Starting`/`Completed <process>`, `<era>: year X of Y`).
   - Change: a pure `societyInventory(snapshot, areaId)` returning the
     measures; the script runs the default draft recipe at the society test's
     3,000 × 2,000 km size (seed and size overridable by environment), prints
     the tables and the per-process and per-cycle timing.
   - Verify: the script completes on the default draft in about a minute and
     its figures agree with the 2026-10-24 scratch run; typecheck and lint
     cover the new files.
   - State / evidence: completed. Typecheck (generation, frontend), eslint and
     prettier pass; the run took 63.5 s and its figures match the scratch runs
     within the variation the concurrent mesh edits introduce.
2. Baseline recorded (`4df02acb-82a6-4c75-ac8a-853e3d6444cc`) [depends on #1]
   - Change: run the script once; paste the baseline tables into this
     document's context section (replacing the scratch-run table).
   - Verify: the recorded figures are the script's output for the stated seed.
   - State / evidence: completed; baseline table above, from
     `scratchpad/baseline-m0.log` of the 2026-10-24 session.

#### Changes and resume

Era names (O2) chosen by the agent under the 2026-10-24 authorization
("choose interesting names; we can change them later"); recorded at M4.

### M1 — Dynamic temporal scale [depends on M0]

Scope: adaptive step selection in `evolveSociety` and `runEra` (D2); era
records, causes, local histories, progress messages and cancellation stay per
era and per cycle; determinism preserved; the round keeps its bounds.
Acceptance (R2, R3): on the default world the present eras' cycle count stays
within about 1.5× today's 20 while the span can reach the D5 fill; iterative
founding, abandonment and recovery remain visible in local histories (plan
09693b37 requirement); results at the adaptive step agree in behaviour with
the fixed step on the same seed.
Evidence: M0 inventory before/after with the span set to the D1 target;
focused unit tests for the step rule; existing society suites.

Sulion: `30c3990e-09aa-44fc-858f-3dbe1120ad8e`; expansion `661d8c4b-a4ad-40c8-91ba-d8775bcba065`.

#### Execution steps

1. Adaptive step rule (`4a8f7627-221f-4829-896b-8240b887ef6e`)
   - File(s): `packages/generation/src/societyTempo.ts` (new),
     `societyEvolution.ts` `evolveSociety`, `societyRound.ts` `runEra`,
     `societyPopulation.ts` (export the growth and decline rates),
     `societyTempo.test.ts`, `societyEvolution.test.ts` (the 20-cycle
     expectation becomes a bound).
   - Reference / outcome: D2. The step is the years in which the world's
     people would change by about a fifth at the current logistic rates
     (population-weighted `r(1 − N/K)`, the same rates `growPopulation`
     uses), bounded to a settled decade and a long lifetime (10–60 years;
     rounds 25–100), and the remaining years of the era are split evenly so no
     cycle is a sliver. Deterministic: it reads state only.
   - Change: `societyStep(state, remaining, bounds)`; both loops step with it,
     report progress by elapsed years, and keep per-cycle indices for hazard
     keys and era-record merging.
   - Verify: unit tests (bounds, low fill steps shorter than high fill, steps
     partition the era exactly); existing society suites pass.
   - State / evidence: completed. `societyTempo.ts`: a quarter of the world's
     people per cycle, settled bounds 10–80 years, round bounds 25–100; three
     unit tests; 95 society tests pass; lint and typecheck clean.
2. Behaviour agreement and span measurement (`bf2a7002-2e92-444a-b18a-37be1df65efe`) [depends on #1]
   - File(s): `frontend/scripts/society-inventory.ts` (`ERAS`, `STEP`, `TRACE`
     overrides and diagnostics), `societyProcesses.ts`/`societyEvolution.ts`
     (end-of-history extraction once).
   - Change: run the inventory on the 200-year default with the adaptive step
     and compare with the M0 baseline (fill, urbanization, settlement counts
     and sizes, founded/abandoned); then run a long span (about 300 + 600 +
     400 years) and record cycles, seconds and fill. Tune the bounds or the
     change target if the present cycles exceed about 30 or fill falls short.
   - Verify: the tables in this document; present cycles within about 1.5× of
     20; median fill ≥ 0.6 and best ≥ 0.9 on the long span.
   - State / evidence: completed. Same working tree, seed 104729, 200-year
     default: fixed 10-year step 20 cycles, fill 0.14, urbanization 8.0%,
     largest capital 8,109, 352 inhabited; adaptive step 11 cycles, fill 0.14,
     urbanization 7.4%, largest capital 7,677, 344 inhabited. Long span
     (300 + 600 + 400 years, tuned bounds): 28 present cycles (13 + 10 + 5)
     at 1–2.3 s each, fill 0.99 (median 0.99, min 0.75), urbanization 17.4%,
     largest town 79,322, 393 of 432 inhabited catchments above the 5,000
     World threshold (M2's problem to solve), 891 roads. Profiling the long
     run showed each era's final cycle costing 25 s in the end-of-era water,
     dam and GIS extraction; that work now runs once, when the last present
     era ends (`lastEra` epoch variable), leaving one 24 s cycle per run. The
     remaining one-off costs are route pathfinding at publication (30 s for
     891 roads, M3) and the GIS extraction itself. A `process_failed`
     diagnostic ("This method does not support GeometryCollection arguments")
     appeared in one long run and not in the next two on the same seed while
     other sessions were editing geometry code; the script now prints the
     failing process and stack if it recurs.

### M2 — Cities drawn from their hinterlands [depends on M1]

Scope: central-place allocation of urban residence (D3) within
`migratePopulation`/`evolveSettlements`, with seats, harbours and passes as
draws and travel cost as friction; hierarchy roles follow the new sizes
without a threshold rewrite unless the inventory shows one is needed.
Acceptance (R1): the D5 distribution on the default world; population
conservation holds; no community exceeds its food bound; regional inheritance
tests pass unchanged.
Evidence: M0 inventory; society unit tests; a browser check of the default
world's capital labels.

Sulion: `43efa16b-9eec-484b-9ef6-6c1849e3da0e`; expansion `60619808-e04d-457b-85d7-662a89e9c74f`
(steps `c70fbdab-ab03-4cd4-b880-bb7111a7be36`, `a5c66dca-0dfa-448a-a9a3-0d53b4964cf6`,
`176a8d56-b93d-4b57-9da4-12e783f3e327`).

#### Execution steps

1. Central-place targets
   - File(s): `packages/generation/src/societyCentres.ts` (new),
     `societySettlements.ts` (export `concentration` as the own-catchment
     urban demand), `societyCentres.test.ts`.
   - Reference / outcome: D3. Each community's town-dwelling demand is today's
     `concentration`. It is allocated among centres reachable over the contact
     graph (`communityDistances`) by attraction that grows with the centre's
     current town size (a power above one, for primacy), a seat, harbour or
     pass bonus, and decays with travel cost; a home share keeps part at home.
     The result is a town target per community and, per centre, the
     contributors and their shares.
   - Change: `urbanTargets(state)` computing targets and contributions once
     per cycle; bounded by the centre's food (its capacity less its people).
   - Verify: unit test on a small fixture: the larger of two linked towns
     receives a target above its own demand, the smaller below, and targets
     never exceed the food bound.
2. People move to the centres [depends on #1]
   - File(s): `societyPopulation.ts` (`evolvePopulation`/`migratePopulation`),
     `societySettlements.ts` (`evolveSettlements` uses the target).
   - Change: after room-per-head migration, each centre whose target exceeds
     its town draws the gap at the settlement relaxation rate from its
     contributors in proportion to their shares, capped per contributor per
     cycle; movers carry their groups. `updateOccupation` relaxes toward the
     central-place target instead of the own-catchment value.
   - Verify: conservation (`before + births − deaths = after`) in the existing
     era-record test; the fixture test shows town residents concentrating
     over cycles; society suites pass.
3. Distribution on the default world [depends on #2]
   - Change: inventory on the 1,300-year span and the 200-year default; tune
     the attraction exponent, reach and bonuses toward D5; check the World
     publication count (majors at or below about 15% of inhabited catchments)
     and hierarchy roles; adjust `worldSettlementResidents` only if the
     measured sizes demand it.
   - Verify: D5 table recorded in this document; browser check of capital
     labels on the default world.
   - State / evidence: completed 2026-10-25. The first full run hung for 37
     minutes: every community sent slivers of every group to every centre in
     reach, and the merged groups multiplied by cycle. Two bounds fixed it: a
     catchment deals with its three strongest centres only, and a move of
     under one person does not happen. A third, `compactGroups`
     (`societyGroups.ts`), folds merged groups below one person into the
     largest group of the same people after every migration, which cut the
     per-cycle cost from 5.6 s back to about 1 s on a full world. Shares were
     then retuned: 30% of a catchment's town-dwellers stay local and half of
     those live in its chief town (the rest are latent small towns), 70% go
     to centres, and a centre's town may not exceed half its catchment's
     food. 900-year run (300 + 600), seed 104729, same tree: 23 present cycles
     at 1 s each plus the 25 s end-of-history cycle; fill 0.97; capitals
     123,277 / 118,635 / 83,601 / 76,665 / 56,695 / 12,585 / 11,581; regional
     capitals 42,675 / 14,895 / 10,139 … 5,346; 65 unranked towns of 5,000 to
     9,305; 88 major settlements of 421 inhabited (21%, against the 15% aim;
     the World threshold is left at 5,000 for the user's map read);
     urbanization 3.8% counting only mesh-scale towns. The 200-year default
     is measured again in M4 with the default eras.

### M3 — Roads between the places that matter [depends on M0; benefits from M1, M2]

Scope: the travelled-ways process in the society cycle (D6: per-link wear from
migration, contact and reach; decay; cost feedback into the travel graph), road
publication by wear class with the connectivity floor, terrain-following road
geometry (D7), and the catalogue and style entries for road classes.
Acceptance (R5, R7, R8, R9; user observation 2026-10-24): on the default world
every inhabited major settlement has a road, each polity's capital reaches its
regional capitals, roads form connected networks through minor catchments,
drawn roads follow valleys, river banks and passes rather than cutting across
relief, and the cycle cost of the process is a small fraction of a cycle.
Links below the class threshold remain latent for regional refinement.
Evidence: M0 inventory extended with roads by class, roads per major settlement,
connected components among majors and the process's share of cycle time; a
browser check of the roads layer over relief and rivers.

#### Execution steps (expanded 2026-10-24; Sulion IDs added when the branch opens)

1. Ways wear with use
   - File(s): `packages/domain/src/society.ts` (`SocietyConnection.wear`),
     `packages/generation/src/societyWays.ts` (new), `societyCentres.ts`
     (return each centre's predecessor tree so hinterland flows can be walked
     to the links they use), `societyPopulation.ts` (per-link migrant counts),
     `societyEvolution.ts` (call order), `societyWays.test.ts`.
   - Reference / outcome: D6. Per cycle each link's wear decays (about a
     150-year memory) and gains the people who used it: migrants along the
     link, market traffic between its two towns (geometric mean of their
     town sizes, decaying with travel cost), and the hinterland's
     town-dwellers walking the least-cost path to their centre. Worn links
     cost less to travel (`travelCost` falls toward about half of the base
     `distance` as wear reaches the road class), and migration, contact and
     political reach read that cost next cycle.
   - Verify: unit test on a line of communities with one city: the links on
     the path to the city wear more than side links; wear decays when traffic
     stops; `travelCost` never rises above the base nor below its floor.
2. Publication by class with a connectivity floor [depends on #1]
   - File(s): `societyPublication.ts` `publishRoutes`, `societyMapScope.ts`
     (class thresholds), `frontend/src/vectorStyles.ts` (width by class),
     `societyInventory.ts` (already counts by class).
   - Change: a land or river link publishes when its wear passes the track
     threshold, with `roadClass` track or road by wear, independent of
     endpoint roles; then every major settlement without a published link
     gets its least-cost path to the nearest major realized at track class,
     and every polity capital its paths to the polity's regional capitals.
     Sea links are left for M3b.
   - Verify: inventory on the 1,300-year span: no major without a road,
     major components close to the number of landmasses, roads form through
     minor catchments; browser check.
3. Roads follow the land [depends on #2]
   - File(s): `mapRouting.ts` (`routeCost` for roads, A* with an admissible
     distance heuristic), `societyPublication.ts`.
   - Change: road cost = distance × slope term × land term, where the land
     term rises with tree cover and standing water, falls along river banks
     and channel access, and a river crossing pays a ford or bridge charge;
     saddles fall out of the slope term. A* keeps publication of several
     hundred roads within a few seconds.
   - Verify: a unit test routes around a ridge through its saddle and along a
     river bank rather than across the interfluve; publication timing in the
     inventory.

### M3b — Shipping lanes and grand highways [depends on M3]

Scope: lane publication from worn sea links with coast-hugging sea routing and
harbour endpoints (D9); grand highways as rare structural works of strong
polities across open country, with straight geometry and highway class (D8);
their catalogue entries and styles.
Acceptance (R4, R6): the default world shows lanes between its harbour towns
and across its narrow seas, never over land; a highway appears only where a
strong polity has a trunk way across plains, is dated and named, and most
default worlds show none or one or two per continent.
Evidence: M0 inventory counts lanes and highways and reports highway
conditions; browser check of lanes and a highway where one exists.

### M4 — Default age, political scale and documentation [depends on M1, M2, M3, M3b; O2]

Scope: default era list and per-era mobility/political capacity (D4); era
form defaults; political reach checked against kingdom-scale polities;
mechanism text in the generation guide (no parameter values); backlog item 11
note; this plan's durable content moved and the file deleted.
Acceptance: a new default world generated through the UI shows the D5
distribution and the user confirms it reads as the classic age.
Evidence: browser journey on the default draft; documentation review.

## Sulion mapping

Root plan: `2008fc0a-bb96-4384-8a21-63dc8fdd6171`. Milestone phases:
M0 `8f23e957-f9e7-46f3-a580-6e388d6a50d9`, M1 `30c3990e-09aa-44fc-858f-3dbe1120ad8e`,
M2 `43efa16b-9eec-484b-9ef6-6c1849e3da0e`, M3 roads `af2201c2-022e-4817-b698-b94cfce00e77`,
M3b lanes and highways `a3d17862-23eb-492e-b97e-ab689916de0f`,
M4 `be3fbce9-a5be-4c97-a569-b46559e27c17`. The M3 phase description in Sulion
predates the 2026-10-24 road requirements; this document's M3 section governs. Phase `f6b3e39f-b658-4c3e-82a5-7f388e87399c`
is the original documentation milestone, skipped when the roads milestone was
inserted as M3 and its content renumbered to M4 (phases cannot be retitled).
Expansions are added under each milestone when it is selected.

## Current state

Investigation complete for sizes and roads; plan written; O1 confirmed by the
user; all milestones pending. Next action: expand M0 with plan-phase when
execution is authorized.
