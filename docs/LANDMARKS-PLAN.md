# Preserved major landmarks

Status: working design, created 2026-10-24. Planning only; the request that
created this document ("let's plan this out") authorizes the plan artifact, not
implementation. All milestones pending.

Sulion root: `df565123-7512-4dee-9155-7da7c54bbca8`. Backlog item 9.

## Outcome and scope

A creator places a named landmark of a catalogued kind at a world location,
chooses the epoch in which it forms, and sets its defining measures in physical
units: a summit at 5,900 m with 5,000 m of prominence, a canyon 1,500 m deep along
this path, a ring structure 45 km across, a falls with a 50 m drop on this river.
After generation the landmark is there, with those measures met at the end of
every later epoch and at present. Everything around it is ordinary procedural
geography that has responded to it: rivers bend around the mountain or cut the
canyon, its summit holds ice, its lee is drier, Fire follows its fractures,
settlements avoid its slopes and roads use its passes. The landmark keeps one
identity and name through regeneration and appears in the Features registry with
its target and measured signature. Naturally emerging peaks, gorges, falls and
craters continue to be generated and detected exactly as today.

Non-goals: no stamped final shapes, no frozen elevation patches over the
landmark, no change to how natural landforms arise or are detected, no new magic
system, no backend or persistence beyond the existing local map saves, no
Region-scale terrain synthesis (that is regional refinement subplan B).

## Context and reuse map

Sources reviewed 2026-10-24. These are observations of the current code, not
evidence that any landmark behavior exists.

| Source                                                                                                                                                                                                                                                                                                                                                                                                            | Observed behavior and implication                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [impacts.ts](../packages/generation/src/canonry/impacts.ts), [plumes.ts](../packages/generation/src/canonry/plumes.ts), [volcanism.ts](../packages/generation/src/canonry/volcanism.ts)                                                                                                                                                                                                                           | The closest precedent. A geological event has an id, kind, position, radius, epoch and strength in `map.events`; it writes bedrock, surface rock load, rock resistance, fracture conductance and heat into the shared field, books excavation into the sediment ledger, and later erosion acts on it freely. Landmark emplacement follows this shape with authored rather than seeded placement. |
| [geologicalFeatures.ts](../packages/generation/src/canonry/geologicalFeatures.ts)                                                                                                                                                                                                                                                                                                                                 | An event becomes a feature with `causeId`; a crater is published only while `craterRelief` is at or above `ImpactVisibleRelief`. This is the honesty rule for an unmaintained event. A landmark differs in exactly one respect: its signature is maintained, so it does not fade.                                                                                                                |
| [atlasSequence.ts](../packages/generation/src/canonry/atlasSequence.ts), [generationSlots.ts](../packages/generation/src/generationSlots.ts)                                                                                                                                                                                                                                                                      | Formation runs `formation.impacts` once; each epoch runs `epoch.impacts` before climate, drainage, incision, sediment, ice, sculpting and coasts, and ends with `epoch.history`. Emplacement before climate lets the same epoch's processes respond; maintenance before `epoch.history` keeps the retained history consistent. Adding a slot is an explicit profile change.                      |
| [atlasWorkspace.ts](../packages/generation/src/canonry/atlasWorkspace.ts), [atlasProcesses.ts](../packages/generation/src/canonry/atlasProcesses.ts) `restoreAuthoring`                                                                                                                                                                                                                                           | Authored elevation becomes fixed samples restored after every native pass. This is the existing protection mechanism and it is the wrong one for landmarks: it freezes a patch, so nothing around it integrates and the processes inside it are undone. Landmarks must not use `work.fixed`.                                                                                                     |
| [landforms.ts](../packages/generation/src/canonry/landforms.ts), [codes.ts](../packages/generation/src/canonry/codes.ts)                                                                                                                                                                                                                                                                                          | Natural detection: peaks by topographic prominence (`rise`), waterfalls by drop per evaluation length, gorges by slope plus cumulative incision. These stay untouched and will classify landmark cells too. The waterfall rule needs about 630 m of fall across a 14 km Standard cell, so a Niagara-scale drop is below the World mesh.                                                          |
| [resolution.ts](../packages/generation/src/resolution.ts)                                                                                                                                                                                                                                                                                                                                                         | World cell spans: Draft 28 km, Standard 14 km, Fine 7 km. Region is ten times finer linearly. Decides which kinds are mesh-scale at World.                                                                                                                                                                                                                                                       |
| [flowGuidance.ts](../packages/generation/src/canonry/flowGuidance.ts), `DrainageGuidanceTargets`                                                                                                                                                                                                                                                                                                                  | Routing already accepts guidance targets (inherited valleys). A canyon or falls landmark can guide the river along its declared path through the same channel.                                                                                                                                                                                                                                   |
| [fluvial.ts](../packages/generation/src/canonry/fluvial.ts) `surfaceResistance`, `recordCut`                                                                                                                                                                                                                                                                                                                      | Incision divides by rock resistance and books cuts into the sediment ledger. Caprock and resistant cores are expressed through `RockResistance`; landmark deepening must use `recordCut` so `deposited + exported <= produced` holds.                                                                                                                                                            |
| `world.magic` placed sources: [model.ts](../packages/domain/src/model.ts), [settingsIntents.ts](../packages/domain/src/settingsIntents.ts) `putMagicSource`, [magicSources.ts](../packages/generation/src/canonry/magicSources.ts) `placedSources`, [cartography.ts](../frontend/src/cartography.ts) "Place magical source", [GenerationMagicConfiguration.tsx](../frontend/src/GenerationMagicConfiguration.tsx) | The authored-located-input pattern end to end: a world-level array with `startsAtEpoch`, an intent that validates and invalidates facts, a placement tool, a generation consumer that reads the array at the right epoch, and wizard copy listing the located inputs in the extent. Landmarks reuse each step.                                                                                   |
| [App.tsx](../frontend/src/App.tsx) world creation                                                                                                                                                                                                                                                                                                                                                                 | A world can be created without generating (`generate: false`). Landmarks can be placed on the blank world and generation launched afterwards through the existing path; or placed on a generated world and the physical domain regenerated.                                                                                                                                                      |
| [geographicIdentity.ts](../packages/generation/src/canonry/geographicIdentity.ts)                                                                                                                                                                                                                                                                                                                                 | Features with an explicit `causeId` keep identity without spatial matching. Landmark features use `landmark:<id>` as cause.                                                                                                                                                                                                                                                                      |
| [ADR 0005](adr/0005-scale-contract.md)                                                                                                                                                                                                                                                                                                                                                                            | Realized/latent/absent per profile; a category a profile designates as major has cell-scale influence even with point geometry. Sub-mesh landmarks at World are exactly that category.                                                                                                                                                                                                           |
| [REGIONAL-REFINEMENT-PLAN.md](REGIONAL-REFINEMENT-PLAN.md) subplan B (`cea5e9bb-a7c7-483f-91c4-3b6d8e50ae41`)                                                                                                                                                                                                                                                                                                     | Regional terrain and river refinement is planned, not started. Realizing a falls' lip and plunge pool, or a horn's faces, is B's work reading the World landmark record.                                                                                                                                                                                                                         |

## Kinds of landmark

A kind is one declaration with three parts: a **signature** (the defining
measures, with units, that are guaranteed), **causes** (what emplacement writes
into the shared physical field and event record at the chosen epoch) and a
**maintenance** rule (the minimal correction that restores the signature after
the epoch's processes have acted). Everything else about the landmark is
emergent. The initial catalogue below covers the three exemplars in the request
(Kilimanjaro, Niagara, the Eye of the Sahara) and the backlog's Grand Canyon and
Matterhorn. Adding a kind means adding one declaration; it does not touch other
processes.

| Kind                     | Exemplars                                                       | Geometry                       | Signature (guaranteed)                                                              | Causes written at emplacement                                                                                                                                                                                                          | World mesh                                                                                                                         | Region adds                                                         |
| ------------------------ | --------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Great mountain           | Kilimanjaro, Fuji (volcanic); Uluru, Ben Nevis (resistant core) | Point + base radius            | Summit elevation (m), prominence (m), base radius (km)                              | Volcanic: a plume root event at the point, cone construction every active epoch, geothermal and fracture conductance. Resistant core: bedrock dome with high rock resistance so erosion lowers the surroundings and leaves it standing | Realized when base radius spans at least the declared cells (60 km base: 2 Draft, 4 Standard cells)                                | Horn faces, arêtes, cirques by glacial sculpting (Matterhorn shape) |
| Great canyon             | Grand Canyon, Fish River Canyon                                 | Path + rim width               | Depth below rim (m), rim width (km), length from path                               | Plateau uplift along the corridor through crust support target, resistant caprock bands, routing guidance along the path, incision booked through the sediment ledger                                                                  | Realized for length and depth; width is one cell or less at Standard                                                               | Walls, terraces, side canyons, inner gorge                          |
| Great ring structure     | Richat (eroded dome); Vredefort, Chicxulub (impact)             | Point + diameter               | Diameter (km), ring count, ring relief (m); impact variant: rim height, floor depth | Dome: bedrock dome with concentric alternating rock-resistance rings that erosion exposes over epochs. Impact: the existing `applyImpact` with authored location, radius and epoch                                                     | Realized when diameter spans at least the declared cells (45 km: 2 Draft, 3 Standard cells)                                        | Ring ridges and the valleys between them                            |
| Great escarpment or rift | Drakensberg, East African Rift, Dead Sea trough                 | Path + side                    | Throw (m), length from path                                                         | Fault record, differential crust support target across the line, fracture conductance and geothermal along it; rift lakes and Fire veins follow on their own                                                                           | Realized                                                                                                                           | Scarp faces, step faults, waterfalls off the edge                   |
| Great falls              | Niagara, Victoria, Angel                                        | Point snapped to a river reach | Drop (m); desired discharge (m³/s) is advisory                                      | A resistant caprock band upstream, a bedrock step across the reach, routing guidance so the river keeps the lip                                                                                                                        | Latent: the step and caprock exist in the fields and the reach profile; the landmark publishes as a major point with its signature | Lip, plunge pool, gorge retreat downstream                          |

Later candidates, each one declaration when wanted: great lake basin, great
delta, archipelago or sea-stack coast, geyser field, natural arch or tepui.

## Decisions

### User requirements (sources)

- Inject landmarks at chosen points within the epoch sequence; guarantee
  presence, location and defining physical characteristics; preserve them
  through later epochs while integrating the surrounding terrain, geology,
  drainage and magic. Keep natural landforms and detection routes available.
  Source: backlog item 9; user turn
  `01a14db4-8f8f-7113-9e05-b2c47fbd5f5e / 59586053`.
- Landforms are consequences of physical and magical generation; no separate
  landform-placement generator. Source: user turn
  `01a14db4-8f8f-7113-9e05-b2c47fbd5f5e / 59564642`. The reconciliation with the
  requirement above is this plan's central decision (first agent choice below).
- Features should be interesting as well as believable; passes connect, peaks
  rise. Source: user turn `01a14db4-8f8f-7113-9e05-b2c47fbd5f5e / 104836920`.
  The implementation of that direction was stopped and archived (turn
  `126524420`); the direction stands, the general finishing pass does not.
- A published feature must correspond to geography that exists; craters with no
  surviving relief are not shown. Source: user turn
  `003affee-4cd8-4570-8625-31d9b8b0ebc5 / 18018621`, implemented as
  `ImpactVisibleRelief`.
- This is not a river simulator; no hydrology rewrite or numerical chase in
  service of a feature. Sources: user turns
  `01a14db4-8f8f-7113-9e05-b2c47fbd5f5e / 72502767` and
  `01a14b05-e6ed-7251-b3dd-696ad822ddca / 19706882`.
- ADR 0005: realized, latent, absent; hidden is not a state. ADR 0004: couple
  through each system's medium. ADR 0003: browser session only.

### Agent-derived choices (revisable within the outcome)

1. **A landmark is injected causes plus a maintained signature, never a stamped
   shape or a frozen patch.** Emplacement writes the same quantities impacts
   and plumes write today (bedrock, rock load, resistance, fractures, heat, crust
   support, routing guidance, an event record). Every later process acts on the
   landmark's cells exactly as on any other cell. At the end of each epoch a
   maintenance step measures the signature and, if it has fallen short, applies
   the smallest correction through the same physical quantities. Rationale: the
   only way to satisfy both "guaranteed" and "a consequence of processes" is to
   guarantee the measures, not the field values. Alternative rejected: reuse the
   fixed-sample protection (`work.fixed`); it freezes the patch and undoes
   integration. Alternative rejected: causes only, no maintenance; strong
   erosion or sea-level change could erase the landmark and the user asked for a
   guarantee.
2. **Maintenance is accounted.** Each correction adds to a cumulative
   `LandmarkMaintenance` elevation field, and any cut goes through `recordCut`
   so the sediment ledger invariant holds. The total is published as a landmark
   attribute. A landmark that needs a large share of its relief every epoch
   tells the creator that the chosen causes fight the setting; the kind's causes
   are then tuned, not the ledger hidden.
3. **One generation feature, two slots.** `physical.landmarks` is a
   `GenerationFeature` in the physical module, enabled by default, contributing
   to new slots `formation.landmarks` (after `formation.impacts`),
   `epoch.landmarks` (after `epoch.impacts`) and `epoch.landmark-maintenance`
   (before `epoch.history`). Disabling it omits emplacement and maintenance;
   authored landmark records remain. Rationale: emplacement before climate lets
   the same epoch's rain shadow, drainage and ice respond; maintenance after
   coasts and before history keeps retained history consistent. Alternative:
   contribute into `epoch.impacts` and `epoch.mountains` per kind; rejected
   because landmark order relative to seeded events would then vary by kind.
4. **Authored record.** `world.landmarks` beside `world.magic`: id, name, kind,
   geometry (point or path), kind parameters with units, `emplacedAtEpoch`
   (`-1` for formation), optional `spaceId`. Intents `putLandmark` and
   `removeLandmark` validate against the kind catalogue and invalidate physical
   facts over the landmark's influence footprint. The seed does not affect
   landmarks; their ids are stable.
5. **Placement in the editor, consumption by generation.** Point and line
   placement tools beside "Place magical source", a landmark panel for kind,
   name, measures and epoch, and a wizard listing of landmarks in the extent as
   the magic configuration does for sources. New worlds: create without
   generating, place, generate. Existing worlds: place, regenerate the physical
   domain. No in-wizard mini-map in this plan.
6. **Scale.** Each kind declares its cell-count minimum once, where consumed.
   At the generating profile a landmark at or above it is realized and its
   signature is checked there; below it the causes are still written at cell
   scale, the landmark publishes as a major point or line with its target
   signature marked latent, and the finer profile that resolves it checks the
   signature (subplan B for Region).
7. **One registry row: the detected feature takes the landmark identity.**
   Decided 2026-10-24 from prior directions. A naturally detected peak, gorge,
   waterfall, crater or volcano whose geometry contains the landmark's signature
   location takes the landmark's id and name. Where detection finds nothing (a
   latent falls at World), the landmark publishes itself. Sources: spec 7.4
   ("each semantic identity has one row"); the user's 2026-10-23 objection to
   craters shown without recognizable deformation (turn
   `003affee-4cd8-4570-8625-31d9b8b0ebc5 / 18018621`), which is the same class of
   confusion as two rows for one mountain. Alternative rejected: let the
   landmark and the detected feature coexist as volcano events and detected
   peaks do today.
8. **Water is captured, never fabricated.** Decided 2026-10-24 from prior
   directions. A canyon or falls landmark claims a river: within a declared
   capture distance it redirects the nearest river whose catchment meets its
   requirement through its path or lip, by making its trench the
   least-resistance corridor and setting routing guidance; confluences may move.
   The water budget is conserved; no water is invented. If no river of that size
   exists within reach, the relief still forms and the shortfall is a diagnostic
   with the measured discharge and the nearest qualifying river. Sources: spec
   8.3 (water budget is a plausibility invariant); the user's direction that the
   finishing lens may reshape a network and modify terrain to fit it, with
   confluences moving (turn `01a14db4-8f8f-7113-9e05-b2c47fbd5f5e / 104812119`);
   the user's "not a river simulator" corrections (turns `72502767` and
   `01a14b05-e6ed-7251-b3dd-696ad822ddca / 19706882`), which rule out a
   hydrology rewrite to make the guarantee. Alternatives rejected: fabricate
   discharge (breaks the budget); guidance only with no capture (Niagara on a
   creek is not Niagara).
9. **Not a return to the canceled macro refinement.** The user stopped the
   macro feature refinement after three corrections (turn
   `01a14db4-8f8f-7113-9e05-b2c47fbd5f5e / 126524420`; code archived on
   `archive/macro-feature-refinement`). The goal it served (features that look
   good at the macro lens, turn `104836920`) still stands, but this plan does
   not revive a general finishing pass. Landmarks act inside the epoch loop at
   their own locations; the only network reshaping is the river capture in
   choice 8, bounded by the landmark's capture distance.
10. **Initial catalogue is the table above.** Decided from the user's named
    exemplars (Kilimanjaro, Niagara, Eye of the Sahara, Grand Canyon,
    Matterhorn): great mountain in two variants, great canyon, great ring
    structure in two variants, great escarpment, and great falls as the first
    latent kind. Later kinds are one declaration each.
11. **M3 does not wait for subplan B.** The World side of a latent landmark
    (caprock, step, capture, reach profile, major point) is delivered here; B
    realizes it when B runs. Waiting would hold a deliverable hostage to an
    unstarted plan.
12. **Landmark features publish on the geology layer** as a distinct `landmark`
    kind with the catalogue kind as subtype, so Feature controls can style and
    hide them independently of detected landforms. Agent choice, revisable in M2.
13. **Magic and society need no landmark code.** Volcanic kinds write fractures
    and geothermal that Fire already reads; summit ice is Aurora's medium; marine
    escarpments shape Pressure reflection through bathymetry. Society reads
    slope, water and routes. Any coupling that turns out to need a landmark
    special case is a sign the medium is missing, to be fixed in the medium.

### Assumptions to check

- Saved maps serialize the whole world object, so `world.landmarks` round-trips
  without a migration. Check in M0 against `frontend/src/savedMaps.ts`.
- Routing guidance holds a river to a declared canyon path across epochs
  without carving that breaks the ledger or creates closed basins. Check in M1
  with a fixture world; if guidance alone is insufficient, the canyon's trench
  from uplift plus incision should make the path the least-resistance corridor.
- Per-epoch maintenance is a small share of signature relief under default
  erosion. Measure in M1; a large share means the kind's causes are too weak.
- A river of the required catchment exists within a reasonable capture
  distance of most canyon and falls placements on a continental World; the
  capture distance default is chosen in M1 from fixture evidence.

### Deferred decisions

None block a milestone. The open questions from the first draft (discharge,
one row or two, catalogue, M3 timing, layer) were answered on 2026-10-24 from
retrieved user directions; see choices 7 to 12. The Draft map's representation
of a sub-mesh falls as a major point with latent signature follows ADR 0005
("hidden is not a state") and needs no separate confirmation.

## Milestones

### M0 — Landmark contract and authoring

Scope: domain record and kind catalogue with unit-bearing signature schemas;
`putLandmark`/`removeLandmark` intents; placement tools and panel; landmarks in
local map saves; wizard lists landmarks in the extent. Generation is not yet
affected.
Acceptance: a creator places a great mountain and a canyon path on a blank
world, names them, sets measures and an epoch, saves and reopens the map, and
sees them listed in the wizard; invalid measures and unknown kinds are rejected
with field-level diagnostics.
Evidence: domain intent tests; a browser journey for placement, save and reopen;
wizard setup projection test showing the listing.
Sulion: `2a1566ce-f2ef-4e2a-9a47-7d50e69c73b2`.

### M1 — Mesh-scale landmarks in the physical epochs [depends on M0]

Scope: `physical.landmarks` feature, the three slots, emplacement and
maintenance for great mountain (volcanic and resistant core), great canyon,
great ring structure (dome and impact) and great escarpment;
`LandmarkMaintenance` field and ledger accounting; river capture along canyon
paths within the capture distance, with the shortfall diagnostic when no river
qualifies.
Acceptance (user-required): on a fixture world with two epochs after
emplacement, each landmark's signature is met at the end of every epoch and at
present; drainage, climate, ice and sediment have responded (a river routed
through the canyon, a rain shadow in the lee of the mountain, ice on a summit
above the snowline); disabling the feature removes the landmark effects;
results are deterministic for the same inputs.
Acceptance (implementation checks): `deposited + exported <= produced` holds;
maintenance share per epoch is reported; no process other than the landmark
module references landmarks.
Evidence: fixture-world tests (seconds, not minutes); one Draft world run with
one landmark of each kind, visually reviewed. No Fine run.
Sulion: `ba08f7af-3c3b-4943-9a0a-b72002c82f2e`.

### M2 — Landmark identity and publication [depends on M1]

Scope: landmark features with target and measured signature, maintenance total
and emplacement epoch as attributes; `causeId` identity through regeneration;
the identity rule against detected features (choice 7); map symbol, Feature
controls entry, inspector and registry row.
Acceptance: regenerating with a different seed keeps each landmark's id and
name; the registry shows one row per landmark with target and measured values
and units; hiding the landmark type hides its symbol without touching the
field.
Evidence: feature registry and publication tests; browser journey for the
inspector.
Sulion: `b9616ebd-484e-4a94-a0f3-b2ab1be70212`.

### M3 — Sub-mesh landmarks declared at World [depends on M1, M2]

Scope: great falls as the first latent kind: caprock band, bedrock step on the
reach, river capture at the lip; the retained reach profile carries the step;
publication as a major point with latent signature; handoff record for subplan
B naming what Region must realize (lip, plunge pool, gorge retreat) from the
landmark record.
Acceptance: at World the falls sits on a mapped river reach whose profile shows
the declared drop within one cell, the point publishes with its signature
marked latent, and the step survives later epochs. Region realization is
accepted under subplan B, not here.
Evidence: fixture test of reach profile and publication; subplan B's design
notes updated with the dependency.
Sulion: `e6361a41-a8bf-429a-af30-1ad4869571e0`.

### M4 — Review, durable records and close [depends on M1–M3]

Scope: Draft world review with the user; ADR recording "injected causes with a
guaranteed signature" and its rejected alternatives; mechanism paragraphs in
the generation guide and spec section 7.4; backlog item 9 closed; this file and
every reference removed.
Acceptance: durable docs describe mechanisms without parameter values; code and
docs agree; `make ci` passes.
Sulion: `8aaaff2c-9781-4ea9-8e33-882a5d090add`.

## Current state

Design recorded; no code changed. All five milestones pending. Open questions
resolved from retrieved directions on 2026-10-24 (choices 7 to 12); Sulion
boundaries updated to match. Next action when
execution is authorized: expand M0 with plan-phase, starting from the
`world.magic` pattern files listed in the context map and
`frontend/src/savedMaps.ts` for the serialization assumption.
