# Rivers as things, and regions that keep their parent's ground

Working plan. It replaces nothing that works: the monthly water budget, routing, lakes and
bed loss stay. It changes what a river _is_ in the model and how a region gets its ground.

## Outcome

- **A river is a thing, not a mark on a cell.** Cells hold quantities of water. Rivers are
  reaches with identity that last from pass to pass. What a map draws is chosen by sizes
  declared against the map.
- **Water on a cell is one package**, lying snow included, carried with the ground and handed
  to a region whole.
- **A region keeps its parent's ground and makes it more defined.** What a parent cell looks
  like inside (plain, slope, cliff, ridged range) comes from its rock column and its history,
  worked by every process that shapes ground, with water as one of them.

Seen on a map: a region picture beside its parent picture shows the same country with more
in it; rivers are lines where a river is, with empty country between them.

## Not in scope

- Rewriting the water budget, routing, lakes, groundwater or bed loss.
- Tests that a region's heights match its parent's numerically, or that region edges are
  pinned to the parent.
- New water processes, until M1–M3 are done.

## What the owner has said (requirements)

All 2026-11-12 unless dated.

1. Rivers are everywhere; this is a fundamental deficiency. There must be dry mountains, old
   river beds and great plains.
2. Water gets the same intentional paradigms and columnar state as ground and people: an
   actual column of water, and a river representation, not memory marks on cells.
3. Not a rewrite. Nothing is thrown away to do this.
4. Look at the river definition and representation before doing anything else with processes.
5. Sizes must respect the scale and latent contracts ([ADR 0005](adr/0005-scale-contract.md)):
   no computing down to unreasonable detail, no "everything is a river".
6. A region starts at the parent's level and becomes more defined. It does not start smooth
   and become refined but different. The parent's elevation is not thrown away.
7. The 30 October "do not conserve parent-cell heights" line means only: no sub-millimetre
   matching tests and no pinned boundaries.
8. A parent cell is a rough average. What is inside it comes from the rock column, shaped by
   all the relevant processes; draping detail over the parent with water as the only shaper
   is not enough.
9. Results are judged by looking at maps. Ledgers, counts and small percentage shifts are not
   results.
10. Earlier, standing: no caps, no deleting things after the fact, no parameters tuned to
    output, no fresh worlds, only unit and UI tests, sizes through `MapScale`.
11. Owner correction, 2026-11-13: architecture reviews assess structural issues in interfaces,
    organization and correct, complete use of the engineering paradigms. Finish the structural
    pass before reporting. Finding and fixing minor functional defects does not establish that
    the architecture is complete.

## What was true when the plan was written (read in code, 2026-11-12)

Each milestone's "State" line below says what has changed since.

**Rivers**

- A river is a per-cell mark (`RiverOrders > 0`), set where a month's gathered flow passes
  "24 cells of ordinary runoff". That is a bare cell count. (Changed by M1.)
- About twenty per-cell layers are recomputed from the surface every pass. Nothing carries.
- A reach record exists (`DrainageReach`, `world.drainage`), but it is filled only when
  rivers are published. Identity is the end coordinate.
- About 35 files outside the water code read the cell mark as "river".
- The region picture of the world's highest land shows the mark as a tangle and as solid
  blocks: `.artifacts/harness/reports/2026-11-12T16-51-36-087Z/terrain.png`.
- Added on 2026-11-12 with no shown effect on a map: old-bed memory, dry-bed records, regime
  drawing, seasonal inflow to regions, deltas building land.
- ADR 0014 was edited on 2026-11-12 to describe the cell memory as "the network that lasts".
  That text is wrong and is corrected in M0.

**Water column**

- `waterColumn` in the domain package is a list of layer names. The layers are separate,
  lying snow is not stored, and a region inherits only groundwater.

**Region ground**

- The parent's heights are sampled, shifted by noise and smoothed (`regional/base.ts`), and
  used to grow a drainage tree (`regional/network.ts`, `evolution.ts`).
- Heights are then rebuilt from the tree's roots upward by formula slopes
  (`regional/relief.ts`), and the parent's ground is pushed or cut to that surface.
- Of the rock column, the starting relief reads one number per cell: a cutting resistance of
  the top layer (`regional/material.ts`). Grain, bed dip, the layer sequence, thrust sheets,
  strain and the cut share are inherited and not used. `regional/character.ts` computes grain
  and strain that nothing reads.
- Code that used grain and thrust sheets for structural relief was deleted in `7f48a4d`
  (2026-11-11).
- The shared processes that run after (slopes, ice, weathering, streams, solution, creep,
  coast) do read the column: strength, jointing, solubility, grain and bed dip. Coast passes
  no direction. Fractures are captured, with no regional fracture set. No wind process.
- Column facts arrive piecewise constant across each parent cell.
- The per-process verdict table for regions exists only in git history
  (`14c60d4:docs/REGIONAL-REFINEMENT-PLAN.md`, lines 291–390).
- Earlier owner rejections that still bind: noise-modulated uplift under a stream-power
  solver, and band patterns that render as a washboard.

## Terms, fixed for this plan

These are not redefined to fit code. If the code cannot meet one, the milestone is not done.

- **Cell quantity:** an amount on a cell (flow by month, how much small channel it holds). It
  is latent: a finer map may realise features from it. It is never called a river.
- **Reach:** one stretch of river between confluences that the map's mesh resolves, kept as a
  record in the map's state with identity, course, flow by month, regime and former courses.
  It exists from pass to pass and is changed, not rebuilt.
- **Drawn river:** reaches that pass the map-scale significance tests.
- **Water column:** one owned package per cell holding snow, soil water, groundwater and
  standing water, moved and inherited as a unit.
- **Keeps the parent's ground:** the region's starting surface is the parent's surface.
  Detail is cut into it and raised on it; heights are never rebuilt from a formula.

## How this plan is kept to

These are part of the work, not advice.

Owner's correction, 2026-11-12: pictures, reviews, commits and pushes are batched over
several milestones, not done after each one. Points 1 and 6 below apply at each batch: M2
and M3 together, then M4 and M5, then M6. Unit tests still run as each piece is written.

1. **A picture gate on every milestone.** Each milestone ends with the parent and region
   pictures of three fixed places (the world's highest land, a plain, a coast), made by the
   quick region check, with their paths given to the owner. A milestone with no visible gain
   is reported as such and work stops there until the cause is found.
2. **No figures as results.** Reports say what the pictures show. Counts and percentages
   appear only to explain a cause the owner asked about.
3. **Guards that fail first.** Each structural change starts with an architecture check that
   fails on today's code and is never loosened:
   - sizes that decide what exists are `MapScale` declarations, not cell counts
     (`riverCells`, `channelCells`, `trunkCatchments` fail it today);
   - nothing outside the water code reads the river cell mark;
   - the water column's parts are written and inherited only as the package;
   - the region's starting surface is never assigned from a formula.
4. **Proof by removal.** A mechanism stays only if the pictures lose something without it.
   The items added on 2026-11-12 are tested this way in M6.
5. **The contract is read before a size is written.** Every new threshold cites the line of
   ADR 0005 it satisfies in its comment.
6. **A review against this document before each commit.** A read-only review checks the
   change against the milestone's text and the fixed terms, and its findings are answered
   before committing.
7. **The plan is re-read at each phase start.** `sulion plan current` and the milestone's
   section here, before the first edit; the boundaries are recorded there as the owner's.
8. **Decision records follow the code.** An ADR is changed to say something is in the code
   only after a guard or picture shows it.
9. **A verdict row before a process enters a region.** The table in M4 is filled before any
   process code changes.
10. **One thing at a time.** No new process or layer is started while a milestone is open.

## Milestones

### M0 — See it, fence it, correct the record

Scope: the looking tools and the failing guards; no behaviour change.

- Quick region check writes parent and region pictures for the three fixed places, and draws
  drawn rivers and marked cells in different colours so the two are told apart.
- The four guards in point 3 above, failing.
- ADR 0014 corrected to say the lasting network and the column package are not built. ADR
  0005's regional paragraph reworded to requirements 6 and 7.

Acceptance: pictures exist for the three places; guards fail for the reasons listed; the two
records say what the code does.

State: done 2026-11-12. The three places are on the saved world `people-full-resumed`:
`highland:1858268,187500;plain:2286000,1914000;coast:3143000,1571000`, given to the quick
region check as `HARNESS_REGION_AT` with `HARNESS_QUICK=1`; one report holds a folder for
each with `parent.png` and `terrain.png`. Ten checks fail in
`water/riverDefinition.architecture.ts` and `regional/startingGround.architecture.ts`. Open
from the review: the starting-ground check bans the present code by name only, so M4 adds a
unit test of the behaviour; the owner's directions in the two check files go into the
owner-directions registry once another session's open edits to that file are committed.

What the baseline pictures showed (drawn rivers blue, marked-only cells pink): drawn rivers
are sensible lines; the mark covers whole lowlands as solid blocks. On the coast most marked
cells have about six cells draining through them and pass the test on their own water: it is
very wet country with full ground, so every cell sheds a river's worth by the cell-count
rule. The water is real, not double-counted. The fault is the definition: any cell with
enough flow is a river, whether or not the flow was gathered.

### M1 — A river's size comes from the map [depends on M0]

Scope: the definition only.

- A stretch of ground carries a river when two things hold: its water was gathered from a
  catchment the map resolves, and the flow is significant at the map's scale. Both sizes are
  declared once, through `MapScale`, in one place, and are the same declarations the map
  uses to decide what to draw. A cell's own yield, however large, never makes it a river.
- Below that, flow stays a cell quantity.
- The region's starting network uses the same declarations.
- A river entering a region brings the catchment its parent map gives it, so it is a
  gathered river from its first cell.
- One exception, because named things persist: a parent map's named river, and the stream a
  parent's river-side town stands on, continue on a finer map whatever their water there.
  M2 gives such a river its regime (running, seasonal or dry) so the map says which it is.

Acceptance (owner-required): the region pictures show rivers as separate lines with empty
ground between; no blocks or tangles; the same place at draft and standard detail shows the
same rivers.
Evidence: the three picture pairs at two detail levels; the size guard passes.

State: in the code 2026-11-12, at draft detail. The sizes are in `water/riverSize.ts`. On
the pictures of all three places the blocks and tangles are gone: rivers are separate lines
with empty ground between, and the plain is mostly empty of rivers.

At standard detail the same holds: rivers are as few and as separate as at draft, so the
size no longer depends on how many cells the map has. But they are not the same rivers. On
the plain the main river takes a different course at each detail level, and standard detail
has many more small lakes. The cause is not the river's size: a region's ground is rebuilt
from its own drainage tree, and comes out different at each detail level. "The same rivers
at any detail" is therefore an acceptance of M4, and is checked again there.

Seen on the pictures and left for later milestones: the ground is
speckled with single-cell bumps (M4), and some rivers stop inland where their water is lost,
which the map does not yet tell apart from a river that ends for no reason (M2).

### M2 — Reaches are kept, and everything asks them [depends on M1]

Scope: the representation.

- The water code builds reaches each pass into the map's state and carries them to the next:
  a reach keeps its identity while its course still mostly holds, changes when its water or
  ground changes, and leaves its former course on its own record when it moves or dries.
- Publishing reads these records; it no longer derives reaches itself.
- Readers of the cell mark move in two groups: those that mean "water runs here" read the
  cell quantity; those that mean "a river" (travel, siting, works, magic carried by rivers,
  landforms) ask the reaches.
- The old-bed layer added on 2026-11-12 is replaced by former courses on reaches.

#### Reader decisions for the remaining authority review

River geometry, regime, waterborne travel, settlement crossings, works, river landmarks and
river publication ask the owned reach profile (`waterAt`, `riverSample`, `onRiver`). This
includes `riverPaths`, `riverCourses`, `riverPublish`, `poiReads`, bridges, fords, work records,
waterworks, delta qualification and river landmark selection. Hydrological routing, gathered
catchment, unresolved erosion, physical validation and final numerical-grid presentation
continue to read cell quantities. Published mean-only input supplies a mean; it does not
authorize inventing monthly variation from the receiving cell's seasons.

#### Execution steps

1. The reach store. `water/reaches.ts`: a reach holds an identity, its cells from head to
   end, the reach it runs into, its order, its flow in each month at its end, its regime,
   and its former courses. The store is part of the map's state (on the field, saved and
   restored with it), not a side table.
2. Building and carrying. After the flow is gathered, the water code cuts the river cells
   into reaches at confluences and matches them to the reaches of the pass before: a reach
   keeps its identity when most of its course is still its course; cells it left are added
   to its former courses; a reach with no water left stays as a dry reach on its old cells.
   Unit test on a small field: a course that shifts keeps its identity and leaves a former
   course; a river that dries stays as a dry reach.
3. Asking. `riverAt(map, cell)` answers with the reach, from the store. Readers of the cell
   mark move in two groups, file by file: "water runs here" reads the cell's flow; "a river"
   asks the store. The list of readers and which group each is in is written here before
   they are changed.
4. Publishing reads the store: river records are drawn from kept reaches, with their
   identity, regime and former courses; a dry reach is drawn as a dry course under its name.
   The old-bed layer and the separate dry-bed derivation go.
5. A region takes its parent's reaches as things (their lines and flows, from the parent's
   stored network) where it now reads the parent's river mark as a picture of cells.

Acceptance (owner-required): a river that loses its water or is turned aside remains on the
map as a dry course under the same name; boats, towns and works stand only on rivers the map
could draw.
Evidence: picture pairs; a unit test of reach matching and of a course change on a small
field; the reader guard passes.

State: in the code 2026-11-12. The map keeps its reaches (`water/reaches.ts`, on the field
as `rivers`); each pass's rivers are carried onto them (`water/riverKeeping.ts`); publishing
reads them, and a drawn river that loses its water is drawn again as the same record, dry.
Everything outside the water code asks `onRiver`, `riverOrderAt` or `reachAt`; the readers
were all of one kind ("a river"), about fifty reads in thirty files. A region takes its
parent's rivers from the parent's stored reaches. The reader checks pass.

Not met, and said plainly:

- The kept reaches are not saved with a run or carried when the plates move. A run resumed
  from a saved point starts with no reaches; after a plate move, dry and former courses are
  let go and rivers are found again on the ground as it lies.
- "Only on rivers the map could draw": the answer is true on every reach that meets the
  map's river sizes. A reach too short to be drawn as a course still counts as a river.
- No dry course has been seen on a map: the saved world has no history that makes one.

### M3 — The water column is one package [depends on M0]

Scope: snow, soil water, groundwater and standing water as one owned package, stored (lying
snow included), moved with the ground and inherited by a region as a unit.

Acceptance: a region starts with its parent's snow, soil water, groundwater and lakes without
recomputing them; the column guard passes.
Evidence: unit tests of the package under movement and inheritance; picture pairs unchanged
or better (a region's lakes and snowfields present from its first round).

State: in the code 2026-11-12. `water/column.ts` holds the package: lying snow (a new
layer), soil water, groundwater and standing water. Every change to a part goes through it;
it is carried with the crust by the water owner (lakes ride their ground, the sea does not),
and its list of parts is what a finer map inherits. The year's water budget starts from the
snow and soil water a cell already holds. The column checks pass.

Not met: soil water and snow are worked out again by a region's first budget, starting from
the inherited values; they are inherited, not left untouched. The saved world predates the
snow layer, so the pictures do not show inherited snow.

### M4 — A region keeps the parent's ground [depends on M1]

Scope: the starting surface and the verdict table.

- The verdict table is restored into this document: one row for every column fact and every
  shaping process, saying what it contributes inside a parent cell and whether it runs.
- The starting surface is the parent's surface. The rebuilding of heights from the tree is
  removed.
- The drainage network decides where valleys are cut into that surface, not what the heights
  are.

Acceptance (owner-required): region and parent pictures show the same mountains, plateaus and
plains at the same heights, with valleys and smaller forms added; and the same place at draft
and standard detail shows the same rivers and lakes (carried over from M1).
Evidence: the three picture pairs; the starting-surface guard passes.

State: the starting ground is in the code 2026-11-12 (`regional/startingGround.ts`). A parent
cell's rock column already records how much of the cell is valley and how deep the valley
lies. Each finer cell inherits that record, and the region places the valley along its own
drainage: the stream's cells first, then outward, until the parent's share is placed.
Valley cells take the recorded floor and the rest the uncut surface
(`resolveCut` in `rock/groundShares.ts`, with unit tests of the behaviour). The code that
rebuilt heights from the tree is gone, and the starting-ground check passes.

On the pictures the highland now has its parent's plateau, escarpment and long even slope,
and a region's ground at its start is the parent's ground with connected valley floors.

Not met:

- The verdict table is not yet written here.
- Draft against standard detail has not been pictured again since the ground changed.

Found and fixed on the way (2026-11-12). After the three rounds of development the low
ground was speckled, cell against cell, with dozens of small false lakes. The quick check
now records what each process does to low ground (`ground-changes.json`), and a trace of one
cell showed its loose cover swinging by hundreds of metres from one working to the next:
taken away, then put back. The cause was the rule for how much cover may creep between two
cells at once. It let each pair close half the drop between them, as if no other face of
either cell moved; a hollow then filled from all its sides at once and came out a peak. At
the world's pace the rule seldom binds; at a region's it bound everywhere. Each pair now
closes its share of the drop among all the faces moving (`levelling` in
`processes/creep.ts`, with a unit test). On the pictures the plain is smooth again, the false
lakes are gone, and the highland and the coast read as their parents' country with rivers
as lines.

### M5 — The rock column shapes what is inside a cell [depends on M4]

#### Regional verdicts, checked against the current shared owners

These are implementation decisions, not additional owner requirements. Captured history is
input to present development, never permission to replay the world's construction. A run
below means the existing selected shared operation, with the regional exposure, not a new
regional copy of its physics.

| Retained fact                                                  | Contribution within a parent cell                       | Verdict                                                                                                                                                                                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bedrock elevation and surface                                  | Starting height and exposed face                        | Keep; never reconstruct from a tree                                                                                                                                                                                         |
| Ordered bed kinds, secondary kinds and shares                  | Resistant caps, weak foundations, soluble intervals     | Read the exposed stack for routing and valley placement; shared wear already traverses it                                                                                                                                   |
| Each bed's depth                                               | Finite cap thickness and absolute contacts              | Resolve the recorded inclined contacts before organization asks the ground, then from those same captured beds after facet placement; allocate captured finite material, never manufacture repeated bands                   |
| Strength and consolidation                                     | Resistance of intact rock and cohesion of loose cover   | Existing Ground responses                                                                                                                                                                                                   |
| Damage                                                         | Local weakness of the actual bed                        | Existing Ground responses                                                                                                                                                                                                   |
| Grain X/Y                                                      | Axial ease of release and erosion along fabric          | Feed direction to initial organization and shared directional wear; the extra coastal direction bands were removed after no clear visible benefit                                                                           |
| Bed slope X/Y                                                  | Signed release planes and asymmetric scarps             | Resolve contacts and feed direction to initial organization and existing directional Ground actions                                                                                                                         |
| Deposited, formedMin, formedMax, altered, mixed                | Surviving material history and identity                 | Carry intact; no synthetic epochs or forcing from ages                                                                                                                                                                      |
| Land/cut rock stacks and loose stacks                          | Distinct floor and interfluve material, cover and fill  | Keep all four; expose through Ground                                                                                                                                                                                        |
| Cut share and depth                                            | Valley footprint and floor beneath the parent average   | Place the inherited share on connected, material-responsive ground                                                                                                                                                          |
| Hosted material and magic cargo                                | Actual constituents moved or exposed by wear            | Move the complete bed records at their retained densities; finite material availability limits allocation, never discard hosted cargo to draw an outcrop                                                                    |
| Structural grain, strain, thrust pair/sheet/segment/across/dip | Captured organization and discontinuities               | Realize local fracture fabric from captured structures; no renewed mountain uplift                                                                                                                                          |
| Fracture conductance and retained fault lines                  | Joints, weakness and water passage                      | Resolve captured traces and sheet contacts from retained strain and material openness through the existing fracture owner; the additional sampled joint generator was removed after no visible gain in its removal pictures |
| Construction, impact and glacial histories                     | Established forms and previous reworking                | Retain forms and causes; do not rerun their historical events                                                                                                                                                               |
| Snow, soil, ground and standing water                          | Present stores for climate, ice, vegetation and routing | Inherit the owned column before development                                                                                                                                                                                 |
| Reaches and small-channel length                               | Established courses and latent finer drainage           | Import records; resolve wet tributaries from quantities                                                                                                                                                                     |

| Process                        | Contribution inside the parent cell                                     | Runs in a region?                                                        |
| ------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| tectonic-provinces             | Captured crust provinces                                                | No; captured                                                             |
| continental-sutures            | Captured contacts                                                       | No; captured                                                             |
| tectonic-margins               | Captured margin structure                                               | No; captured                                                             |
| continental-domains            | Captured continental architecture                                       | No; captured                                                             |
| crust-uplift                   | Captured construction and level                                         | No; captured                                                             |
| landscape-initialization       | Existing parent ground                                                  | No reset; refinement inherits it                                         |
| plates                         | Captured plate positions                                                | No historical transport                                                  |
| tectonic-epoch-activity        | Captured strain and grain                                               | No new epoch                                                             |
| mountains                      | Captured thrust sheets and mountains                                    | No new belt or uplift                                                    |
| mantle-plume-roots             | Captured thermal sources                                                | No new sources                                                           |
| volcanoes                      | Captured cones, beds and causes                                         | No new eruptions                                                         |
| impacts                        | Captured craters, beds and causes                                       | No new impacts                                                           |
| slopes                         | Failure of exposed faces, including cap support                         | Yes                                                                      |
| slopes-after-streams           | Failure after incision exposes support                                  | Yes                                                                      |
| crustal-relaxation             | Local response of loaded crust                                          | Yes, around captured support datum                                       |
| crustal-support                | Support response to changed local loads                                 | Yes, around captured support datum                                       |
| settling                       | Changed material settles on existing surfaces                           | Yes, through shared material settlement                                  |
| margins                        | Present erosion at ocean-facing margins                                 | Yes                                                                      |
| sea-floor                      | Ocean floor presentation from current ground                            | Yes, current geography refresh                                           |
| shore-detail                   | Coast from current ground                                               | Yes, current geography refresh                                           |
| fracture-network               | Finer traces and discontinuities along captured structural organization | Resolve captured faults and sheet contacts locally; no new sampled roots |
| geothermal                     | Current effects of captured heat sources                                | Captured sources; current responders remain available                    |
| ocean-budget                   | Existing ocean and datum                                                | Captured; no new global inventory                                        |
| ocean-surface                  | Present connected water surface                                         | Yes, current geography refresh                                           |
| marine-reconnection            | Present connections through altered ground                              | Yes, current geography refresh                                           |
| ocean-distance                 | Distance from the child's current shore                                 | Yes, captured maritime context at frame                                  |
| bathymetry                     | Current submerged relief                                                | Yes, current geography refresh                                           |
| landmasses-and-shelf-groups    | Current outlines and named geography                                    | Yes, current geography refresh                                           |
| ocean-currents                 | Maritime forcing from captured context                                  | Captured; no global circulation replay                                   |
| warmth-sources                 | Current effects of captured heat and magic                              | Yes, shared responders                                                   |
| atmospheric-climate            | Current climate over finer slopes                                       | Yes                                                                      |
| runoff                         | Transfers through inherited stores                                      | Yes, after initial organization                                          |
| drainage-conditioning          | Current depressions and routes                                          | Yes                                                                      |
| lake-basins                    | Standing water on current ground                                        | Yes                                                                      |
| drainage-guidance              | Established courses and actual ground                                   | Yes                                                                      |
| flow-routing                   | Water quantities routed through current ground                          | Yes                                                                      |
| river-network                  | Kept reaches evolve from routed water                                   | Yes                                                                      |
| groundwater                    | Store release and seepage through retained ground                       | Yes                                                                      |
| weathering                     | Weather releases actual surface material                                | Yes                                                                      |
| streams                        | Directional incision of retained bed stacks                             | Yes                                                                      |
| solution                       | Dissolution of soluble exposed material                                 | Yes                                                                      |
| creep                          | Cover moves across slopes; plains remain plain                          | Yes                                                                      |
| river-load                     | Carrying and deposition on actual courses                               | Yes                                                                      |
| land-ice-mass-balance          | Present snow and ice accumulation or melt                               | Yes                                                                      |
| ice-flow                       | Present grounded ice transport                                          | Yes                                                                      |
| glacial-meltwater              | Meltwater enters current water quantities                               | Yes                                                                      |
| ice                            | Directional abrasion and plucking                                       | Yes                                                                      |
| moraines                       | Deposition of carried glacial material                                  | Yes                                                                      |
| glacial-landforms              | Existing and newly exposed glacial forms                                | Yes, final geography                                                     |
| sea-ice                        | Present sea ice                                                         | Yes when selected                                                        |
| outside-waves                  | Current external wave forcing                                           | Yes; existing owner, without the unproven extra direction bands          |
| coast                          | Material wear and deposited shore loads                                 | Yes; existing owner, without the unproven extra direction bands          |
| river-channel-geometry         | Owned bed width and depth                                               | Yes                                                                      |
| river-warmth                   | Present warmth carried by rivers                                        | Yes through selected shared responders                                   |
| river-floodplains              | Current river banks and overflow ground                                 | Yes, final geography                                                     |
| river-delta-formation          | Mouth deposits from delivered load                                      | Yes; retention depends on removal pictures                               |
| landform-classification        | Names and outlines from current terrain                                 | Yes, finer significance                                                  |
| burial                         | Existing consolidated material                                          | No new geological age                                                    |
| rock-metamorphism              | Existing altered material                                               | No historical replay                                                     |
| physical-epoch-history         | Completed world history                                                 | Preserve; no invented regional epochs                                    |
| physical-structural-validation | Publication invariants                                                  | Yes, where shared publication requires them                              |

There is no existing wind-transport owner to schedule. This work does not add a new wind
simulation: the missing paths above use existing Ground responses and captured structure.

Scope: the column facts and processes the table marks as needed and missing. Known from the
survey: layer sequence and bed dip, grain, thrust sheets, strain, the cut share, a regional
fracture set, direction in coastal wear. Each is done through the existing ground
responses, one at a time, each proved by removal.

Acceptance (owner-required): on the pictures, folded country reads as ridges and valleys
along its grain, hard beds stand as scarps, plateaus stay flat-topped with cliffed edges, and
plains stay plain. Not noise, not a washboard.
Evidence: picture pairs per mechanism, with and without it.

### M6 — Regions take reaches and quantities; unproven additions are tested [depends on M2, M3, M5]

Scope:

- A region receives the parent's reaches as things and the parent's cell quantities, and
  realises smaller reaches where the quantities say there is channel.
- Each 2026-11-12 addition (regime drawing, seasonal inflow, deltas building land) is run
  with and without; it stays only if the pictures lose something.

Acceptance (owner-required): a parent's river is the same river in the region; smaller
rivers appear in the region where the parent's country is wet, and not where it is dry.
Evidence: picture pairs.

## Sulion mapping

Plan `4a82dad4-8288-4201-82e0-612170985313`, branched from "Rivers: why every cell line
becomes a river" in plan `5b7dd6d0-f4d1-432e-8946-806632479c1a`.

| Milestone | Phase id                               |
| --------- | -------------------------------------- |
| M0        | `4db1d291-cb7a-4453-aae3-a706d04d4b8e` |
| M1        | `47f07d79-c1bf-43e3-944a-1358de443269` |
| M2        | `6efe2ea6-c49f-460a-97d0-8a58e98ec0b1` |
| M3        | `f1ee16f3-9da2-49bf-8863-5bce5e4f53df` |
| M4        | `8d9e10ba-e05c-4431-bdaa-c61af4a7343e` |
| M5        | `6f88525f-477b-4345-ae5b-b637daadc761` |
| M6        | `16170012-92b7-417c-aee5-c2ebce1be9d2` |

## Current implementation — 2026-11-13

The resumed implementation makes retained reaches and the water stores authoritative.
Commands transfer the supply year and change courses; current queries derive profiles without
advancing stocks or history. Publication, material carriers, landmarks and hosted places use
the retained owner interfaces. Captured records and place identity are distinct; a new map
takes current source geometry as input, including dry courses, without inheriting the source
map's product role. Protected and authored records remain outside replaceable generation.

Full structural reviews found and repaired competing authorities in current queries,
publication connectivity, year capture, clipped import and inherited hosting coordinates.
The integrated architecture, routine unit and type checks pass. The completed structural
repair is receiving its final representative saved-map validation before the architecture
branch closes.

The parent/Draft/Standard pictures establish the broad plateau, escarpment, plain and coast.
The contact/material/fault implementation and removal checks are present, but the sampled
maps have not established M5's folded ridges and valleys. That visual acceptance remains open;
passing structural checks does not close it. The stop snapshot below describes the predecessor,
not the current implementation.

## Historical stop snapshot — `cfd022c`

Work stopped by the owner on 2026-11-12, after `cfd022c`. Everything below is committed and
pushed on `main`; nothing of this plan is uncommitted. The unit, architecture and frontend
suites passed at `cfd022c`. Nothing is running.

### The owner's judgement at the stop

The reports kept centring on fixed symptoms, and the architecture that was agreed is only
partly what was built. The milestone "State" notes above were written as each piece landed
and read more favourably than this section. Where they differ, this section is the truer
one.

### What was agreed, against what the code does

| Agreed                                                 | In the code at `cfd022c`                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A cell holds quantities and is never a river           | Not met. Each pass still marks cells as river by a test on the cell (`noteMonth` and `buildChannels` in `water/rivers.ts`). Only the test changed (`water/riverSize.ts`).                                                                                                                                                                              |
| Rivers are kept things that processes change           | Half. `map.rivers` (`water/reaches.ts`) keeps identity, dry courses and former courses across passes. It is filled after the cell marks, by cutting marked cells into stretches (`water/reachCuts.ts`) and matching them to the last pass's (`carryReaches`). No water process works on reaches: flow, bed loss, regime and channel size are per cell. |
| Everything asks the rivers                             | In name only. `onRiver` and `riverOrderAt` (`water/riverKeeping.ts`) read the `RiverOrders` layer. `reachAt` is used by publishing and the land readout alone.                                                                                                                                                                                         |
| How much small channel a cell holds, as a quantity     | Not built.                                                                                                                                                                                                                                                                                                                                             |
| The water column as one package of stores              | A funnel. `water/column.ts` is the one place the parts change, with a carrier and an inheritance list. The parts are still separate layers; soil water and snow are worked out afresh by each budget, starting from the held values. No stores stating what they hold, their room and how readily they give.                                           |
| A region keeps its parent's ground                     | Met. `regional/startingGround.ts` places each parent cell's recorded valley among its finer cells (`resolveCut` in `rock/groundShares.ts`). The code that rebuilt heights from a drainage tree is gone.                                                                                                                                                |
| The rock column shapes what is inside a cell           | Not started, beyond the recorded valley share and depth. Grain, bed dip, layer sequence, thrust sheets, strain and fractures are inherited and unused at the start. The verdict table M4 asks for is not written.                                                                                                                                      |
| A region takes the parent's rivers and cell quantities | Partly. It reads the parent's stored reach lines as a mask of cells (`regional/parentRivers.ts`) and takes an entering river's flow, driest-month flow and catchment. It does not take reaches as things or realise smaller ones from cell quantities.                                                                                                 |

### What changed what a map looks like

Two changes account for nearly all the visible difference, and neither is architecture:

1. The river test: water gathered from a catchment the map resolves, in a flow significant
   at the map's scale (`a970d0e`).
2. A numerical fault in how loose cover creeps between cells, which roughened a region's low
   ground and made false lakes (`cfd022c`). It is a shared process, so it also changes world
   generation wherever creep runs at its limit; that has not been looked at on a world.

The region's starting ground (`9d6cf15`) is the third, and is architecture.

### Commits of this plan

- `0009f66` plan, picture tools, failing checks, decision records corrected.
- `a970d0e` the river test and its sizes.
- `1dfbc76` and `9d6cf15` kept rivers, the column funnel, the region's starting ground. The
  first holds only deleted files by mistake; the second is the rest.
- `cfd022c` the creep fix and the per-process record of what moves low ground.

### What a successor should know before trusting it

- **The checks pass by name.** `water/riverDefinition.architecture.ts` and
  `regional/startingGround.architecture.ts` are all green, but several match identifiers and
  were satisfied by moving or renaming code. Green there does not show the agreed
  architecture exists. The reader check in particular passes because readers call a
  function that reads the same layer.
- **The kept rivers are not saved** with a run or a map, and are let go when the plates move
  (`carriedBy("rivers")` in `water/riverKeeping.ts`). A resumed run starts with none.
- **No dry course or former course has been seen on a map.** The saved test world
  (`people-full-resumed`) has no history that makes one. The code paths are covered by unit
  tests only.
- **Some drawn rivers end inland** on the region pictures. Not investigated.
- **Standard detail was never pictured after the ground changed.** Before it, draft and
  standard showed different rivers for the same place.
- **A river's regime on a record** comes from per-cell months in flow, not from the reach.
- **Soil water is now published with the water layers**, no longer with the living landscape,
  so it is absent from a map generated with water routing off and ecology on.
- **The owner-directions registry** has no entries for this plan's directions; the two check
  files say so. Another session had open edits in that file.
- **Earlier work of the same day** (seasons by rain belt, day length in the air's demand,
  deltas settling at river mouths, seasonal inflow to regions) was never shown to change a
  map and was never tested by removal. M6 was to do that.
- **The Rust port session** recorded the water refactor as complete. It is not. Its plan
  (`docs/FINISHED-MAPS-PLAN.md`) should not port water's present shape as final.

### How to look

- Pictures, parent beside region, three fixed places, draft detail:
  `.artifacts/harness/pictures/m5/` (now) and `.artifacts/harness/pictures/m0-before/`
  (before). The folder is ignored by git.
- To remake them:
  `HARNESS_QUICK=1 HARNESS_WORLD=people-full-resumed HARNESS_WORLD_QUALITY=draft HARNESS_REGION_QUALITY=draft HARNESS_REGION_AT='highland:1858268,187500;plain:2286000,1914000;coast:3143000,1571000' pnpm --dir frontend harness regional`.
  One report folder under `.artifacts/harness/reports/` then holds a folder for each place
  with `parent.png`, the ground at its start and after each round, `terrain.png`, and
  `ground-changes.json` (what each process did to low ground). About three minutes a place
  at draft, ten at standard.

### Work identified at that stop

In the order the agreed architecture needs, not the order of the milestones above:

1. Make the kept rivers what decides: update them each pass (heads extend and retreat, a
   course changes only where the ground forces it), fill the cell layer from them, and keep
   each river's months of flow, regime and bed on the river.
2. Move water's river processes (bed loss, channel size, floodplains, sediment along a
   course) onto rivers.
3. Give cells the quantity of small channel they hold.
4. Make the column's parts stores that state what they hold and give, with the year's budget
   moving water between them.
5. Save the kept rivers with a map and decide what happens to them when the plates move.
6. M5 as written: the verdict table, then the rock column's unused facts, one at a time,
   each proved by removal.
7. M6 as written, including the removal tests of the earlier additions.

Sulion plan `4a82dad4-8288-4201-82e0-612170985313`: M0 to M3 marked completed, M4 in
progress, M5 and M6 pending. Those marks record that the milestone's code landed, not that
the table above is met.
