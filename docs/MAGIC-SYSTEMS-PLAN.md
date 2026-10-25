# Seven magic systems

Status: working plan, opened 2026-10-24. Planning only; the request that created this
document authorized the review and the plan, not implementation. All delivery
milestones are pending.

Sulion root: `95ca0671-e12f-46ff-8bed-f1c630865ffe`.

## Outcome and authority

The atlas generates and lets a creator configure all seven systems of the
[magic lore bible](lore/magic.md): Fire with vein and fallen cores, Aurora, Pressure with
sea-born weather, and the new Greenwood, Salt, Veil and Hallowed. The deliverable is
physics: where each system is created, how it propagates through its medium, what it does
to rock, water, air and living cover at each step of an epoch, what those pillars do back to
it, and what new thing happens where two systems meet. Classification, biome naming, place
outlines and the drawn surface follow from those fields and are ancillary. A world with one
system enabled and a world with all seven both generate without a system standing in for
another.

Source of the requirement: the user's direction of 2026-10-24 to design the remaining
systems (consolidated in [magic system candidates](magic-system-candidates.md)), the lore
bible written to that design, backlog item 12, the request of 2026-10-24 to review the
bible against the three implemented systems and plan the remaining work, and the user's
corrections of 2026-10-25 recorded under Decisions.

Non-goals: character-only magic (illusion, mind control), a universal spell editor, named
setting lore from the reference game, and any backend or persistence
([ADR 0003](adr/0003-frontend-session.md)). Regional refinement of magic belongs to the
[regional refinement plan](REGIONAL-REFINEMENT-PLAN.md), subplan C.

## Context and reuse map

Sources of truth: [product contract 10.3](product-spec.md#103-magical-generation--fire-aurora-and-pressure),
[ADR 0004](adr/0004-coupling-through-each-systems-medium.md) (each system acts through its
own medium; society reads the medium), [ADR 0005](adr/0005-scale-contract.md),
[AGENTS.md magic source authority](../AGENTS.md#magic-source-authority), the
[candidates design](magic-system-candidates.md) and the [lore bible](lore/magic.md) with
its seven pages.

What exists, read 2026-10-24 and 2026-10-25:

| Concern                           | Where                                                                                                                                                                | Shape today                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| System definition                 | `packages/domain/src/magicSystems.ts`, `magicPresets.ts`                                                                                                             | One `source`, one `propagation`, `phase` in {climate, post-glacial}, flat parameters and effects, history retention, feature rules with seed/retain conditions and `system:<id>` cross-reads                                                                                                                                                                                    |
| Source and propagation strategies | `packages/generation/src/canonry/magicSources.ts`, `magicPropagation.ts`, `magicOcean.ts`, `magicBeams.ts`                                                           | geothermal, cold, deep-ocean, placed; fracture (priority queue over `FractureConductance`), cold-drainage (accumulation routed to colder neighbours, retained by ice), ocean-rays (reflection, crossing, wakes), radial. Strategy declarations drive contracts and the parameter form                                                                                           |
| Field channels                    | `canonry/magicFieldDefinitions.ts`, `magicState.ts`                                                                                                                  | intensity, history, firstEpoch, stored, retained, coastalHistory, source, wake, rogue, sealed, radii; carried channels advect with the crust and are sampled onto a child surface                                                                                                                                                                                               |
| Feedback                          | `canonry/magicFeedback.ts`                                                                                                                                           | heat into `ExternalHeatForcing` and ice melt; Quickening and Stillness; moved water (Upwelling, SeaSurfaceAnomaly, FogForcing, wake warming); RockResistance; conduit opening and sealing against a budget; ExternalCoastalForcing; history retention and IcePersistence                                                                                                        |
| Orchestration                     | `canonry/magicProcesses.ts`, `domainContributions.ts`, `canonry/atlasSequence.ts`                                                                                    | Climate-phase systems evaluate at `epoch.climate-forcing` (after initial climate, before water, ecology and incision); post-glacial systems at `epoch.post-glacial-forcing` (after ice and meltwater, before ecology responds); the human round runs after ecology responds and before coasts, storage and history; present repeats the two phases then classifies and projects |
| Climate reads                     | `canonry/climate.ts`, `airColumn.ts`, `riverWarmth.ts`                                                                                                               | Temperature sums insolation, lapse, geothermal, currents, `Warmth`, `ExternalHeatForcing`, minus fog cooling and evapotranspiration; air columns march downwind carrying marine and magical heat and rain out over terrain; rivers carry heat forcing downstream                                                                                                                |
| Ecology reads                     | `canonry/ecologyEnvironment.ts`, `ecologyProcesses.ts`, `ecologySoils.ts`, `ecologyMagic.ts`                                                                         | Quickening and Stillness enter the forcing as rates; toxicity is a condition that decays; stillness release feeds soils. Cover is four fractions per cell                                                                                                                                                                                                                       |
| Classification and places         | `canonry/magicFeatures.ts`, `geographicRegions.ts`, `packages/domain/src/geographySurfaces.ts`                                                                       | Binary rule regions grown from seeds; each published as a channel and as one place per component; `finalSurface` is the presentation raster, one code per cell by priority; three meeting rules (war rim, steam fracture, breach) on the Pressure preset classify a surface and change no field                                                                                 |
| Biome naming                      | `canonry/ecologyBiomes.ts`, `ecologyFeatures.ts`                                                                                                                     | Named regions contoured through interpolated cover and forcing with a minimum land share per rule; rule order is a naming precedence                                                                                                                                                                                                                                            |
| Society                           | `societyMagic.ts`, `societyMagicAccess.ts`, `societySites.ts`, `societyHazards.ts`, `societyNativeWorks.ts`, `packages/domain/src/society.ts`, `societyPractices.ts` | Practices fire-forge, aurora-archive, pressure-diving; site classes fire-seat, melt-line, fishery-coast, halo-edge; magical hazards; cold-age works (tapping, quarrying, weir). `magicAt` finds a system by its propagation string                                                                                                                                              |
| Routes                            | `societyGeography.ts`, `mapRouting.ts`                                                                                                                               | Travel edges of kind land, river, sea between adjacent cells                                                                                                                                                                                                                                                                                                                    |
| Controls and UI                   | `magicCartography.ts`, `frontend/src/MagicSystemsForm.tsx`, `MagicRuleEditor.tsx`, `GenerationMagicConfiguration.tsx`                                                | Per-system curated controls patch parameters and effects; the form edits source, propagation, phase, parameters, effects and rules                                                                                                                                                                                                                                              |
| Physical media available          | `canonry/field.ts`, `atlasProjection.ts`                                                                                                                             | Impact excavation, rim and ejecta thickness and `Feature.ImpactCenter` across epochs; lakes as water kind 2 with outlets and overflow; carbonate ratio (karst); tree, wetland, grass and peat cover, soil water and depth; drainage basins and flow targets; wind direction and speed; sea-surface anomaly already warms and moistens the air columns above a wake              |
| Society media available           | `societyRound.ts`, `societyHazards.ts`, `societyPolitics.ts`                                                                                                         | Communities with founding and peak, ruined camps of earlier rounds, works, connections, polity sovereignty and control, hazard events with casualties. No battle, siege or famine event exists yet                                                                                                                                                                              |

## Review: the three implemented systems against the bible

Fire, Aurora and Pressure are implemented as the product contract describes. The bible and
the candidates design ask for these changes.

**Fire**

- Fallen origin: none of it exists. Craters, ejecta and impact centres are generated and
  travel with the crust, but Fire locates only geothermal maxima. Needed: a second origin
  at impact centres with a finite stock, ejecta propagation (radial, elongated downwind) and
  placer propagation down the drainage, a long-barren ejecta fan, and a panning extraction
  that runs out.
- Vein origin: matches the bible (conduit opening and sealing, warmth down rivers,
  hardened rock, Quickening). Society does not yet read a sealed vein as a reason to leave.
- Meetings to add: Shatter rim with Aurora (M1b), Overgrowth rot and boiling springs with
  Greenwood (M3), Fired crust on Salt (M5), broken ward lines (M6), ruptured doors (M7).

**Aurora**

- Relict cold: the bible says charge remains in the ground after the ice retreats and keeps
  formerly glaciated valleys cold. `heldCharge` gates cooling and stillness on at least a
  skin of ice, so a relict field with no ice casts no cold shadow. Revise so strong stored
  charge acts without ice, at reduced strength.
- Melt-line release: the bible's fertile strip where preserved matter thaws exists only as
  the stillness-release term in soils. Verify in M1d whether the melt line shows raised soil
  and cover, and add a release pulse if it does not.
- Meetings to add: Shatter rim (M1b), Breach (M1b), Frozen Deepwood (M3), Preserved barrow
  (M5), reinforced wards (M6), closed doors (M7).

**Pressure**

- Weather: none of it exists as weather. Warm wakes already warm and moisten the air
  columns above them, so part of the storm is emergent, but there is no storm genesis,
  no storm track, no windward deposition, scour, dune movement or dry lee.
- Meetings to add: Boiling shore (M1b), Breach (M1b), Fire columns feeding and Aurora cold
  pinning storms (M2), Brackish wending (M3), a Hallowed rim turning a track (M6), carried
  charge stopped at a door (M7).

**Cross-cutting**

- The schema holds one source and one propagation per system. Fire, Greenwood and Salt
  each need two origins with their own locate rule and propagation; Veil's source is
  derived from other systems' fields; Hallowed and Salt are sourced from society.
- The phase vocabulary names only climate and post-glacial. Salt's death origin and all of
  Hallowed need a phase evaluated after people have acted.
- No meeting has physics. The three meeting rules classify a surface and publish a place;
  none changes a physical field. Systems touch one another only where their effects land on
  the same scalar: Fire's warmth and Aurora's small cold term in one heat sum, Quickening
  and Stillness each summed over systems. No rule reads three systems.
- Ecology reads no system as a medium. Cover, soil and disturbance take forcing from magic
  but no system yet propagates through cover or groundwater, so the ecology-to-magic
  direction of the loop is absent; Greenwood is the first system whose medium is living.
- Society reads a system by its propagation string (`magicAt`). Once propagation moves to
  origins, society must read a system by id or by a declared role.
- Travel edges connect adjacent cells only. Veil doors need an edge between two distant
  cells.
- Rule membership is binary per cell. A class that reaches a tenth of a 50 to 200 km² cell
  is the whole cell or nothing, so a meeting cannot displace part of a cell and a child
  profile has no coverage to realize. Fields and per-rule places already keep every overlap
  (product contract 6.3); only the presentation raster collapses to one code.
- Surface codes are positional over all systems' rules. Each generation stores its own
  `magicSystems`, so saved maps resolve against their own definitions; verify in M1a before
  changing presets.

## Decisions

**User requirements (sources).**

- Seven systems, no more: the three extended plus Greenwood, Salt, Veil and Hallowed
  (user, 2026-10-24, recorded in the candidates design).
- Each system is a first-class world effect with its own medium, propagation, feedback and
  interference; no generic effect menu or altered-vegetation lineage (product contract 10.3,
  ADR 0004, AGENTS.md).
- Magic feeds physical processes at the correct causal stage; society changes access,
  extraction, use and local conditions and those feed back (product contract 10.3).
- Setting-neutral lore; practitioner, not race (lore bible).
- Canonry is design, not parity: values are retuned freely (user memory).
- Magic is powerful and visible on the map. The user objected when a retune cut its
  reach ("I didn't realize you were going to drastically reduce the impact of magic") and
  when a control redesign cut its cardinality ("too much of a reduction in cardinality,
  especially for magic"). New systems are tuned toward presence, with every patch still
  attributable to a source (user, 2026-10-23 and 2026-10-24).
- Geography is the result of processes, never a placed shape: "mountain ranges must remain
  the result of tectonics", and the macro-lens finishing pass reshapes terrain and values
  together so features are "not just believable, but interesting" (user, 2026-10-21 and
  2026-10-22). A magic signature that changes the map changes the fields underneath it.
- Society history includes collapse: "societies collapse and fall", hazards "wipe out
  towns", and magical abundance or explosion acts on people (user, 2026-10-22 and
  2026-10-23).
- Cells carry mixtures, not a winner: "The strict winner takes all algorithm needs to be
  revisited. Our cells are 50-200 sqkm. At that range a few percent of each type is about
  coverage area, especially once we get to regional refinement" (user, 2026-10-25).
- Meetings are novel, and magic is not geology: "magic areas should combine to form novel
  geology more than the sum of their parts. Fire is not a geothermal warming source that
  can cancel out Aurora cold. They are both mystical otherworldly sources of power that
  have significant effects on the landscape" (user, 2026-10-25). No system's effect is
  netted against another's; a meeting is its own process with its own geology, medium,
  hazard and society read.
- Weight: "nearly all of this plan should be the creation, propagation, and interaction
  between magic ecology climate and geology. the final rendered surface, biome
  classification is all ancillary" (user, 2026-10-25). Every system milestone is accepted
  on its fields and couplings; classes, names and drawing are a trailing line and never an
  acceptance on their own.

**Explicitly agreed.**

- The candidates design's consolidation: Starfall folds into Fire, Gale into Pressure,
  Wellwater into Greenwood, Grave into Salt, Doors and Wild zones into Veil, Bound lines
  into Hallowed.
- Two prerequisites are decided before Salt, Hallowed or Veil is built: society-sourced
  magic and nonlocal routing (candidates design, backlog item 12). This plan places them
  in M4 and M7.

**Agent-derived implementation choices.**

- Origins on the schema. `MagicSystem` gains `origins: [{ id, source, propagation,
renewal, parameters }]`; `source` and `propagation` on the system become the single
  origin of a one-origin system during migration. Effects, history and feature rules stay
  per system. A field keeps one intensity, the maximum over its origins, plus per-origin
  source channels where a rule or a meeting needs them (fallen versus vein). Reason: the
  bible gives one effect set per system and distinct locations per origin. Alternative
  rejected: separate systems per origin, which would make Fire two systems with two forges.
- Renewal is a declared kind per origin (conduit-fed, accumulating, continuous, finite,
  kept, emergent) that selects which existing mechanism applies: the conduit budget and
  sealing, storage retention, a stock channel that extraction and transport draw down, a
  maintenance read, or a parent read. No new generic renewal engine.
- Each system has a medium it propagates through and a forcing it writes, and both are
  physical fields the other pillars already own or that this plan adds beside them.
  Propagation reads the medium (fractures, cold and ice, ocean geometry, cover and
  groundwater, groundwater and aridity, society tenure and routes, other systems' strain).
  Forcing writes one named channel per system in the pattern of Quickening, Stillness and
  FogForcing (Greenwood Verdure, Salt Salting, Hallowed Warding, Veil Tearing) plus direct
  writes to the physical fields the bible names. The step table in Composition fixes where
  in the epoch each read and write happens.
- Each system is a stock in named reservoirs carried by the world's existing transports
  (crust, ice, rivers, groundwater, wind, currents, animals, people), with intensity derived
  from stock and medium and a closed budget published per system; see the
  [material model](#material-model-budgets-carriers-and-couplings). Alternative rejected: an
  intensity field with carried history, which is what exists, because it cannot say where
  the Fire went when the crust moved or what the glacier did with the charge.
- Meetings are confluences in a shared `confluences` list in generation settings: each
  names the systems it reads, the coverage floor each must reach, and its own process on the
  physical fields, its own hazard and society read, and last its own class. A confluence is
  effective when every system it reads is enabled. Alternatives rejected: rules on the
  acting system (several meetings have no single actor); a surface-only interference rule
  (a class with no process is a cosmetic mark).
- Society phase. The phase enum gains `society`. A society-phase system is evaluated after
  the human round inside an epoch, so the epoch's coasts, storage and history see it, and
  again after the present's people with a late classify and project for society-phase
  fields. Society-phase locate strategies read `state.society`, `state.rounds` and
  published society channels. Alternative: evaluate society-sourced systems only from bound
  eras; rejected because a present pilgrim road must show on the present map.
- Each new system gets one practice channel beside fire-forge, aurora-archive and
  pressure-diving, a work kind, a site class where the bible names a settlement reason, a
  hazard where it names a danger, and a control set in `magicCartography.ts`.
- Veil doors are edges of kind `door` in the society travel graph and a published paired
  feature. Route lines drawn on the map are not rerouted through doors in this plan.
- Society reads a system by id, with a role lookup (which enabled system quickens, stills,
  moves water, greens, salts, wards) replacing the propagation-string match.
- Coverage is the measure a meeting displaces and a child realizes: a latent fraction per
  cell per rule, derived from the rule's own continuous quantity through a declared mapping
  (never from sub-cell geometry, which ADR 0005 forbids). The drawn raster and place
  outlines read it; they are ancillary and live in M8.

**Provisional assumptions.**

- Impact centres from earlier epochs remain locatable after advection through
  `Feature.ImpactCenter` or the excavation field. Checked at the start of M1c.
- A closed-basin lake that dries between epochs can be recorded by comparing water kind
  per epoch in a carried channel. Checked at the start of M5.
- Storm genesis can ride the existing air columns: a storm is an energy and moisture pulse
  injected at the wake cells and marched downwind by `marchAirColumns`, so windward rain and
  a dry lee emerge from the existing orographic rainout; scour and dunes are added writes.
  Checked at the start of M2; if the columns cannot carry it, a separate storm field is
  added and the reason recorded.
- Cover age can be carried as one channel (epochs a cell has held canopy above a floor),
  which Greenwood's stand origin needs. Checked at the start of M3.
- The saved-map store resolves surface codes against the generation's own
  `magicSystems`. Checked in M1a before any preset changes.

**Decisions resolved from prior user direction (2026-10-24).**

- Wild zones change the world physically. A tear's instability perturbs cover and small
  relief in its cells at each epoch boundary within a bound, through the same ecology
  disturbance and surface edits the other processes use. The cartographic mark (region
  unreliable, features in alternate positions) is derived from the recorded change, with
  the previous epoch's positions published beside the current ones. The bound keeps a wild
  zone from rewriting a mountain range.
- Salt's death origin reads every mass-death record society already produces and gains
  one located conflict event. Existing records: hazard events with casualties at a
  position, communities' die-off deaths when population exceeds capacity, ruined and
  abandoned settlements, and polities whose status became fragmented or collapsed with
  their communities and cause. M5 adds a siege event at each community of a polity that
  fragments or collapses, with casualties scaled to its population, so the bible's
  battlefields and sieges exist without a separate war simulation.

**Decisions taken by the agent (2026-10-25).** The user directed that choices the agent
can make are made, not referred back. These are agent decisions and revisable with
evidence.

- The Pressure/Salt meeting is Brine shore: a warm, still lagoon closed behind a Pressure
  coast dries to a sabkha, and the dried lagoon is a dead closed lake, a Salt source. Brine
  storms (dust lifted from the sabkha along a storm track) are its carrier, not a separate
  meeting. Reason: it follows from two mechanisms the plan already builds (wakes, coastal
  evolution) rather than adding a third.
- Veil's responses to the systems the bible leaves open: Greenwood roots knit a tear shut
  over epochs (living ground relaxes strain), Salt ground holds a tear open (nothing changes
  on salted ground, so strain does not relax), and carried Pressure charge cannot pass (the
  bible). A triple meeting makes a tear, never a door on its own; doors come from stable
  tears whatever made them.
- A thick Salt bed shaping the fold belt above it (the detachment effect) is not built in
  this plan. Reason: it needs a bed buried in the first epochs and a collision over it
  later, so it is visible on few seeds, and it reaches into the orogeny module that no other
  coupling touches. Recorded in the backlog when M5 lands.
- The bible gets these names and mechanisms at M8's bible update, with the meeting table
  and system pages amended.

**Deferred.**

- Whether ADR 0004 is amended or a new ADR records the seven-system shape. Agent decides
  in M8 from the size of the change.

## Material model: budgets, carriers and couplings

Source: the user's direction of 2026-10-25 that the systems are "specialized physical
processes with high impact" that "respond to normal physical processes and act on land like
physical processes", and the follow-up that the design must go past the examples given.
This section fills the whole carrier-by-system matrix, including the cells whose answer is
no, works out what one epoch moves at the world's own rates, and lists the couplings that
fall out of the matrix rather than the ones that were asked about. Real analogues were
researched on 2026-10-25 and are cited at the end of the section. Everything here is an
agent proposal against the bible, revisable with evidence.

**Principle: a system is a stock, not a field.** Each system is an amount of something held
in named reservoirs per cell: created at its sources, carried by the world's own transports,
stored, released, transformed and destroyed, with the budget closed the way sediment is
(`SedimentExportedTotal` is the precedent). Intensity, which every reader uses today, is
derived from the stock and its activity in the medium, not stored on its own. The
stock channels are extensive (amount per cell) and ride the same carriers the physical
pillars already use; the code already carries `history`, `stored`, `firstEpoch` and
`sealed` with the crust through the transport plan, moves `SedimentSupply` with ice flow to
the terminus, migrates animals along fronts and crosses propagules by wind and current.
The material model extends those routes to the stocks instead of inventing new ones.

**What one epoch moves.** The world has its own rates and they are not Earth's; the design
has to use them. An epoch defaults to a thousand years (`duration` on the epoch). Crust
drift is 234 km in the first epoch and decays by 0.42 each epoch after (98, 41, 17, 7 km):
about 400 km in all, almost all of it early. A World cell of 50 to 200 km² is 7 to 14 km
across, so the first epoch carries a stock twenty cells and the fifth less than one.
`IceTransportYears` is 1,000, so a glacier moves its load about one cell per epoch. Ecology
runs the epoch's years, so herds cross a region and forests mature within one. Rivers,
wind and currents reach the whole basin or coast within one. Earth rates imported for
things the world does not yet time: dunes at 5 to 30 m a year are 5 to 30 km an epoch,
about a cell; peat at 0.2 to 2 mm a year is 0.2 to 2 m an epoch; a herd disperses seeds a
few kilometres a generation and so covers its range in a century. Three consequences. Crust
carriage makes long tracks only in the first two or three epochs, so a Fire hotspot track or
a displaced Salt bed is an early-world feature that later epochs erode and bury. Ice moves
stock a cell at a time, so moraine charge accumulates across epochs rather than arriving.
Life and water redistribute their stocks within an epoch, so Greenwood and brine reach
equilibrium with the landscape every epoch and their geography is the landscape's. The
earlier draft bounded a Veil wild zone at tens of metres; at these rates the bound is about
a cell per epoch, which is a stream moved to the next valley, not a range moved.

**The matrix.** Every carrier against every system. "No" is a decision with a reason, not
an omission.

| Carrier               | Fire                                                                                      | Aurora                                                                             | Pressure                                               | Greenwood                                                                           | Salt                                                                                      | Hallowed                                | Veil                                     |
| --------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------- | ---------------------------------------- |
| Crust                 | Yes: cores and sealed conduits ride; plume stays, so a track forms                        | Ground reservoir rides; ice reservoir does not (ice is not crust)                  | No: charge is in water                                 | Peat, soil and buried strata ride; living cover does not                            | Yes: the bed rides, is folded and squeezed up                                             | Yes: stones and ruins ride              | No: strain is recomputed                 |
| Burial and exhumation | Buries fallen stock and spent tracks; exhumation of an old orogen exposes them            | Buries ground charge under till; thaw exhumes nothing, it releases                 | No                                                     | Buries peat into a stratum; an aquifer through it is a spring origin                | Buries the bed (inert); exhumation dissolves it and the ground collapses                  | Ruins buried fade faster                | No                                       |
| Ice                   | No carriage; ice load cracks held cores and releases heat under the glacier               | Yes: the main carrier; rides flux, concentrates on ablation, dumps at the terminus | No                                                     | No: ice is a barrier and kills cover; buried peat under ice is preserved, not moved | Minor: a scraped bed travels in till as saline till                                       | No                                      | No                                       |
| Rivers and sediment   | Yes: placers from fallen stock and from exhumed veins                                     | No: meltwater carries charge to warmth, where it is lost; a sink, not a carrier    | No                                                     | Yes: sap and litter in sediment, concentrating on floodplains and deltas            | Yes: dissolved brine downstream; a river into a closed basin feeds the pan                | No                                      | No                                       |
| Groundwater           | No                                                                                        | No                                                                                 | No                                                     | Yes: aquifers from recharge to spring                                               | Yes: brine seep and capillary rise                                                        | No                                      | No                                       |
| Wind                  | Ejecta only, at the impact                                                                | No                                                                                 | Storms carry its weather inland                        | Propagules by the wind crossing                                                     | Yes: dust from a dried bed, the strongest terrestrial dust source there is                | No                                      | No                                       |
| Currents              | No                                                                                        | Bergs: charge in calved ice grounds on shelves                                     | Yes: wakes and stored charge drift between evaluations | Propagules by the current crossing                                                  | Flushing to the sea is the sink                                                           | No                                      | No                                       |
| Animals               | No                                                                                        | No: stillness slows the animals instead                                            | No                                                     | Yes: in the gut along migration fronts; grazing also suppresses stands              | No: grazers avoid salted ground                                                           | No                                      | No                                       |
| People                | Yes: mining moves cores to cities; a core cracked in a forge releases where it is cracked | Crystals carried; the ledger exists                                                | Carried charge in the ledger, dissipating near Aurora  | Seed and timber; clearance and burning are sinks                                    | Yes: made by death, raked, burned clean; clearance lifts the water table and brings it up | Yes: made by tenure, carried by walking | Doors are made by strain, used by people |
| Doors                 | Cores pass; a release at a door ruptures it                                               | Crystals close a door                                                              | Carried charge cannot pass                             | Seed passes, so a door seeds a grove at its far end                                 | Salt passes with trade and the dead                                                       | A ward seals a door                     | The carrier itself                       |

**Carriers.** What moves, on which existing machinery.

| Carrier               | Machinery                                                                | What it carries for magic                                                                                                                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Crust motion          | `plateAdvection`, the transport plan, `transportHistory`                 | Every solid reservoir: spent and live Fire cores, sealed conduits, fallen stock and buried placers; Aurora's ground charge; Salt beds; Hallowed stones. Plume events are already held fixed while the crust moves, so vein sources migrate relative to the rock |
| Burial and exhumation | `SedimentThickness`, fluvial and glacial erosion, `CumulativeDeposition` | A solid reservoir under sediment is inert; erosion that removes the cover re-exposes it. Fallen cores and Salt beds are the two that matter                                                                                                                     |
| Ice flow              | `iceFlow`, `IceFlux`, `IceFlowTargets`, `glacialDeposition`, meltwater   | Aurora charge entrained in ice, carried downstream, concentrated where ice ablates, dumped with till at the terminus, a share leaving in meltwater                                                                                                              |
| Rivers and sediment   | `sedimentTransport`, `deltaFormation`, `hillslopeFlux`                   | Fallen core fragments as placers; dissolved Salt brine; Greenwood in sap and detritus downstream to deltas                                                                                                                                                      |
| Groundwater           | `SoilWater`, drainage basins, `CarbonateRatio`                           | Greenwood's aquifer route to springs; Salt's brine seep and capillary rise                                                                                                                                                                                      |
| Wind                  | `WindX`, `WindY`, `UpwindTargets`, `ecologyCrossing` wind carrier        | Salt dust from pans; impact ejecta downwind; Greenwood propagules to islands; storm tracks                                                                                                                                                                      |
| Ocean currents        | `OceanCurrentX`, `OceanCurrentY`, `ecologyCrossing` current carrier      | Drift of Pressure wakes and their stored charge; Greenwood propagules by sea; Salt flushed to the ocean leaves the budget                                                                                                                                       |
| Animals               | `migrateAnimals`, Grazers, Browsers, `MigrationFlux`                     | Greenwood in the gut of browsers and grazers, dropped along migration fronts; grazers avoid Salt, so Salt has no animal carrier                                                                                                                                 |
| People                | extraction, works, routes, clearance, burning, raking, the siege event   | Fire stock out of the ground; Greenwood cut; Salt made, raked and burned; Hallowed walked; carried charge in the society ledger                                                                                                                                 |

**Reservoirs and their physics, per system.**

| System    | Reservoirs                                                                | What moves it between reservoirs                                                                                                                                                                                                                                  | Sinks                                         |
| --------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Fire      | held (cold cores in rock), releasing (cracked, hot), spent (hardened ore) | Cracking turns held into releasing: mining, tectonic strain, ice load, impact shock, exhumation and frost at the surface. Release hardens the rock and seals the conduit (the fault-valve cycle). Crust carries all three; rivers carry held fragments as placers | Extraction out of the world; release spent    |
| Aurora    | ice, ground, moraine, shelf                                               | Falls into ice at the cold source; ice flux carries it; ablation concentrates it; terminus dumps it to moraine; thaw moves ground charge to release; calving puts it on shelves                                                                                   | Meltwater to warmth; thaw                     |
| Pressure  | ray (travelling), wake (stored in still water), storm (in air)            | Rays reflect and cross; fronts leave wakes; currents drift wakes; sharp warm fronts spawn storms; wind carries storms inland                                                                                                                                      | Ray decay; rain-out                           |
| Greenwood | sap (living cover), litter and peat, buried stratum, aquifer water, gut   | Growth and death between sap and litter; burial of peat to stratum over epochs; aquifers leach a stratum to springs; herds carry gut loads along fronts; rivers carry litter to floodplains and deltas                                                            | Burning; clearance; salting from below        |
| Salt      | brine, bed, dust                                                          | Death and dried lakes make brine and bed; seep and capillary rise move brine; crusting makes bed; wind lifts bed to dust; crust carries, folds and squeezes the bed; exhumation dissolves it                                                                      | Flushing to the sea; Fire fusing and shedding |
| Hallowed  | stones (shrines, lines), walked routes                                    | Tenure and pilgrimage make it; walking carries it; crust carries stones                                                                                                                                                                                           | Abandonment                                   |
| Veil      | none                                                                      | Strain between other systems' stocks; doors carry other systems' stocks between distant cells                                                                                                                                                                     | Strain relaxes                                |

**Couplings the matrix produces.** These are the landscapes the material model makes that
a field model cannot, each with its mechanism and the milestone that builds it. None of them
was in the user's list; they fall out of asking what each carrier does to each stock.

1. **Fire under the ice, and ice stopped by Fire** (M1c). A glacier's load cracks held cores,
   so a vein country under an advancing ice sheet releases heat at its bed. The melt pools
   under the ice and bursts out as outburst floods that cut channels and spread outwash
   below the ice margin, and the margin itself cannot advance across a strong vein field: a
   Fire country is an ice-free corridor through an ice age, with the Shatter rim where the
   charged ice meets the melt. The Thaw meadow of the bible is the stable form of this
   margin. Reads `IceThickness` as a cracking agent; writes `GlacialMeltwater` and the
   meltwater drainage.
2. **The ember road** (M1c). In the first epochs the crust carries a vein field 100 to 230 km
   from its fixed plume, leaving a line of spent, hardened conduits behind the live head.
   Hardened rock resists erosion, so after the drift decays the track stands as a low
   straight ridge of dead Fire across the continent, with the live field at one end. New
   strain across the ridge reopens it at reduced strength. Reads the plume event position
   and `TectonicActivityHistory`; writes `RockResistance` along the track.
3. **Old mountains are Fire country** (M1c). Convergence piles crust and buries vein tracks
   and fallen stock deep under an orogen. Erosion over later epochs exhumes them, so a worn
   range yields cores and its rivers carry placers long after the plume has moved on.
   Vein-sourced placers, not only fallen ones, follow every exhumed track. Reads
   `CumulativeFluvialErosion` and `SedimentThickness` against the buried stock.
4. **Aurora cuts the fjords** (M1d). Charge weakens the rock it touches, and charge in ice
   touches the bed wherever the ice slides. Charged ice above the flux threshold erodes
   deeper than clean ice, so Aurora country is overdeepened: troughs, cirques and fjords
   deeper than the climate alone would cut. Under cold-based ice that does not slide the
   bed is preserved, as it is in nature. Reads `IceFlux` and `GroundedIce`; writes the
   glacial erosion rate.
5. **Thaw lakes to dead lakes** (M1d and M5). A deglaciated lowland holds ground charge that
   thaws over epochs; thawing ground collapses into lake basins, the way thermokarst does.
   Those lakes are small and closed, and in a drying climate they die, and a dead closed
   lake is a Salt source. The chain is Aurora, then thermokarst, then Salt, two or three
   epochs long, and it puts Salt pans in old glacial country where no battle was fought.
   Reads the ground reservoir's thaw; writes small relief depressions and water kind.
6. **Green river mouths** (M3). Greenwood in litter travels with sediment, so floodplains
   and deltas accumulate it as they accumulate silt. A river from a Deepwood makes a Wending
   fen on its floodplain and a Deepwood at its delta in a climate that would not grow one.
   The oasis chain of the bible is the dry-country case of the same transport. Reads
   `SedimentSupply` and `DeltaIntensity`; writes verdure where sediment lands.
7. **Herd roads and forest islands** (M3). Herds export Greenwood in the gut along their
   migration fronts and suppress stands by grazing. Groves form in lines along the herd
   roads; dense stands survive where herds cannot graze, on steep ground, in peat and on
   islands. Predators keep the herds down and so keep the stands up. People who hunt out
   the herds stop Greenwood spreading and thicken the stands they have. Reads
   `migrateAnimals`, `Grazers`, `Browsers`, `Predators`; writes gut stock along fronts.
8. **The desert remembers its forests** (M3). Peat buried for epochs becomes a stratum that
   rides the crust. An aquifer that passes through it leaches Greenwood and brings it to a
   spring, so the bible's two origins are one process: a spring origin is where water meets
   a buried stand. Springs appear in deserts where forests stood epochs earlier and were
   buried, far from any living Deepwood. Reads the buried stratum and `CarbonateRatio`.
9. **The zoned basin** (M5). Brine seeps to a closed basin's centre and crusts there;
   Greenwood springs sit on the basin's edge where the aquifer outcrops. A closed basin in
   a dry climate is green at the rim and dead at the centre with the Standing-dead front
   fought between them, and the front moves with the climate: wetter epochs push the rim in,
   drier epochs push the pan out. A battlefield on high ground salts the basin below it.
10. **Salt in the mountains** (M5). A bed buried under thick sediment and squeezed by strain
    rises as a dome far from the basin that made it. Exhumed, it dissolves and the ground
    collapses into sinkhole fields; brine springs ring the dome. Salt returns epochs later
    where a sea or lake died in the first epoch and the crust has since carried the bed into
    a fold belt. Where the bed is thick, the belt above it folds broad and low; that effect
    on orogenic shape is noted for a later plan, not built here.
11. **Pressure makes both Salt and Greenwood coasts** (M2 and M5). This is the Brine shore
    meeting, the plan's answer to the bible's Pressure/Salt gap. A wake leaves warm, still
    water; coastal evolution behind a Pressure coast closes lagoons behind spits; a warm,
    still, closed lagoon evaporates to a sabkha, and a dried lagoon is a dead closed lake,
    which is a Salt source. On the exposed, foggy side the upwelling feeds fisheries, and
    seabirds and the fish that run upriver carry those nutrients ashore, so the coast grows
    cover and in time a stand. Sheltered Pressure coasts salt; exposed Pressure coasts
    green. Brine storms, dust lifted from the sabkha by the storm track, remain as a second
    carrier.
12. **Fire dries the lakes it warms** (M5). Warmth carried down a river raises evaporation
    in the closed lake it ends in, so a Fire country's basin lakes die sooner and salt.
    Fire burns Salt clean and also makes it; a Fire country's lowlands are its Salt
    country. Reads `RiverWarmth` into the lake water budget.
13. **The ward as a dam** (M6). A Hallowed line across a brine seep stops the brine, and the
    brine pools behind the line: a pan forms upstream of a ward that would never have
    formed without it. A ward across a fracture seals the conduit, and the fault-valve
    cycle builds pressure behind the seal. When the line lapses or a conduit breaks it, the
    pooled Salt floods the protected ground and the sealed Fire releases at once. This is
    the bible's "forces held back inside accumulate along the outer edge" made into a
    conservation law with a failure mode. The same displacement puts the sediment and wave
    energy a ward holds back onto the first reach below it and the coast downdrift.
14. **Forge cities are Fire sources** (M4). Cores mined at a vein are carried to
    cities and cracked in forges, and a core releases heat where it is cracked. A city that
    imports cores for an era becomes a small Fire source of its own, in a country with no
    vein, and a city that imports too many ruptures its own door. The society ledger already
    tracks deposit, supply and use; the release becomes a located source in the society
    phase.
15. **Doors carry the stocks** (M7). People take seed, salt and cores through doors, so a
    door seeds a grove, salts a necropolis or founds a forge at its far end, and the far
    end's country changes as a port's hinterland does. Carried Pressure charge cannot pass,
    Aurora crystals close the door, Fire released at it ruptures it, and a ward seals it, so
    which stocks a door moves is decided by which systems its two ends hold.

**Schema consequence.** Each origin declares its reservoirs and their carriers: `stocks:
[{ id, reservoir, carriers: [crust | ice | river | groundwater | wind | current | animal |
people | door], transfers, sinks }]`. Intensity is computed from stock and medium at
evaluation. The budget is published per system as totals (created, carried, stored,
released, lost) so a test can close it. Implementation note: the ecology today disperses
plants only by local seed banks and by the wind and current crossings, so the animal
carrier is new machinery on `migrateAnimals`, not a read of something that exists. M1a
introduces stocks and the crust carrier; M1c builds couplings 1 to 3; M1d builds 4 and 5;
M2 and M5 build 11 and 12; M3 builds 6 to 8; M4 builds 14 and the people carrier; M5
builds 9 and 10; M6 builds 13; M7 builds 15 and the cell-per-epoch
bound.

**Sources consulted (2026-10-25).** Hotspot age progression: O'Connor et al. 2013 via
[AWI](https://epic.awi.de/id/eprint/35551/) and a
[hazards text](https://open.maricopa.edu/hazards/?p=300). Fault-valve veins:
[CONICET](https://ri.conicet.gov.ar/handle/11336/39607),
[Nature Communications 2025 via IDEAS](https://ideas.repec.org/a/nat/natcom/v16y2025i1d10.1038_s41467-025-57199-6.html).
Impact hydrothermal lifetimes: [Arizona](https://repository.arizona.edu/handle/10150/193511),
[Chicxulub 8 Myr](https://www.universetoday.com/articles/the-long-lived-chicxulub-hydrothermal-system-lasted-8-million-years),
[Glasgow](https://eprints.gla.ac.uk/389882/1/389882.pdf). Placers:
[Yukon Geological Survey](https://open.yukon.ca/information/1e6c1744-8a48-41ac-a526-5ab35be5f75a).
Tektite strewn fields: [Wikipedia](https://en.wikipedia.org/wiki/Tektite),
[Southampton](https://eprints.soton.ac.uk/497123/1/s40645-024-00660-9.pdf). Glacial
transport: [Lennoxtown erratics](https://era.ed.ac.uk/handle/1842/17847),
[erratic trains preprint](https://egusphere.copernicus.org/preprints/2023/egusphere-2023-1621).
Relict ground ice: [Kokelj et al. 2017](https://dspace.library.uvic.ca/items/478b3198-ae62-4a05-8cfc-b7559dc91e12),
[Fennoscandian frozen beds](https://resolve.cambridge.org/core/services/aop-cambridge-core/content/view/9900F70046025D367385E4143C90B945/S0022143000007346a.pdf/glacial-land-forms-indicative-of-a-partly-frozen-bed.pdf).
Peat rates: [Western Siberia](https://resolve.cambridge.org/core/journals/quaternary-research/article/holocene-peat-and-carbon-accumulation-rates-in-the-southern-taiga-of-western-siberia/60C18DBCA746DEAD834D1722AA1506AA),
[Mires and Peat](https://doaj.org/article/cb7dce2521e2462789ec62e4b411546b).
Mycorrhizal transfer: [PMC review](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10751480/).
Animal transport: [Wolf, Doughty and Malhi](https://adamwolf.princeton.edu/2013/08/09/herbivore-diffusion/),
[Doughty et al.](https://joeroman.com/wp-content/uploads/2016/01/Doughty-with-supplement.pdf),
[forest elephant dispersal](https://repositorio.unesp.br/items/8b5bd3c9-1b74-448a-88a8-ef8e585871df/full).
Salt tectonics: [BEG Texas](https://store.beg.utexas.edu/reports-of-investigations/2680-ri0143.html),
[AGU glossary](https://blogs.agu.org/georneys/?p=593),
[NASA Earth Observatory](https://earthobservatory.nasa.gov/IOTD/view.php?id=86861),
[Zagros](https://en.wikipedia.org/wiki/Zagros_fold_and_thrust_belt). Dust:
[NASA Bodélé](https://earthobservatory.nasa.gov/images/150991/another-dusty-day-in-the-bodele-depression),
[PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC2791565). Dryland salinity:
[Wikipedia](https://en.wikipedia.org/wiki/Dryland_salinity),
[Alberta](https://www1.agriculture.alberta.ca/$department/deptdocs.nsf/all/agdex167). Karst
and fault springs: [Alashtar](https://ojs.zrc-sazu.si/carsologica/article/view/352),
[types of springs](https://vikaspedia.in/energy/environment/know-your-environment/water/types-of-springs).
Storms on warm fronts: [JAMSTEC](https://www.jamstec.go.jp/e/about/press_release/20170121),
[Bergen](https://www.uib.no/en/gfi/127036/ocean-currents-shape-weather),
[WCD preprint](https://wcd.copernicus.org/preprints/wcd-2020-50/wcd-2020-50-ATC1.pdf).
Displaced erosion: [Southampton groynes](https://eprints.soton.ac.uk/393174),
[Groyne](https://en.wikipedia.org/wiki/Groyne),
[Snake River levees](https://pubs.usgs.gov/publication/70190123),
[Rio Grande](https://gsa.confex.com/gsa/2002AM/webprogram/Paper41493.html). Mobile
terrain: [Namibia dunes](https://eo.belspo.be/news/racing-dunes-namibia),
[Thermokarst](https://en.wikipedia.org/wiki/Thermokarst),
[Alaska 2018 drainage](https://epic.awi.de/id/eprint/53396/).

## Composition: the seven systems as processes

Each system below is given as creation, propagation, what it does to geology, climate and
water, and living cover, what those pillars do back to it, and the meetings it takes part
in. Mechanisms marked (exists) are in the code today; the rest are agent proposals against
the bible, revisable with evidence. Ancillary classes and names close each block in one
line.

**Where each system acts in an epoch.** The epoch body runs initial climate, climate
forcing, material forcing, water, ecology evolve, incision and hillslopes, climate, water,
sediment, glaciation, climate, water, post-glacial ice and meltwater, post-glacial forcing,
history, ecology respond, water, the human round, coastal forcing and coasts, burial,
storage, history. Phase decides the slot:

| System    | Phase                    | Reads at evaluation                                                                           | Writes, and who consumes it next in the same epoch                                                                                                                                                                 |
| --------- | ------------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Fire      | climate                  | Geothermal maxima, FractureConductance, impact centres and ejecta, FlowTargets, wind          | ExternalHeatForcing (climate, air columns, river warmth), IceThickness melt, RockResistance and FractureConductance (incision, hillslopes, next epoch's propagation), Quickening and fan toxicity (ecology evolve) |
| Aurora    | post-glacial             | Temperature, IceThickness after glaciation, stored charge                                     | Cold term, IcePersistence (next glaciation), RockResistance (next incision), Stillness and melt-line release (ecology respond, soils)                                                                              |
| Pressure  | climate                  | Ocean geometry, shelves, currents, wind, air temperature                                      | Upwelling, SeaSurfaceAnomaly, FogForcing (climate), storm pulses (air columns, precipitation, snow, scour, dunes), ExternalCoastalForcing (coasts)                                                                 |
| Greenwood | post-glacial             | Cover and cover age, PeatCarbon, CarbonateRatio, SoilWater, drainage basins, ice, water       | Verdure (ecology respond: growth beyond climate, establishment, regrowth), SoilDepth, WetlandCover and channel braiding (after-response water), spring collapse relief edits                                       |
| Salt      | post-glacial and society | Dried closed-basin lakes, death records, FlowTargets, SoilWater, Moisture, WetlandCover, wind | Salting (ecology respond: thinning, infertility, grazer avoidance), SoilWater and Moisture drawdown (next climate), RockResistance at glass flats, dust deposition                                                 |
| Hallowed  | society                  | Community tenure, pilgrimage convergence, kept lines, routes                                  | Warding (every other system's next evaluation), RockResistance and channel pinning inside (next incision), ExternalCoastalForcing reduction (coasts), storm-track deflection                                       |
| Veil      | derived, last            | Every enabled system's intensity and coverage, confluence coverages                           | Tearing; at the epoch boundary small relief, course and cover edits inside the bound; door edges                                                                                                                   |

### Fire

- Creation. Vein cores at separated geothermal maxima under land, spaced by a land-area
  budget, conduit-fed and sealing when the conduit has carried its budget (exists). Fallen
  cores at impact centres in the epoch of the impact, a finite stock scaled to the
  excavation volume, never renewed, drawn down by panning and by placer transport.
- Propagation. Vein: priority-queue transport through FractureConductance with a cost that
  falls as conductance rises (exists). Fallen: an ejecta halo around the centre elongated
  downwind by WindX and WindY, scaled by ImpactEjectaThickness; a placer train down
  FlowTargets from every ejecta cell, depositing where slope falls and decaying per reach.
- Acts on geology. Hardens rock along veins (RockResistance up, exists) and opens the
  conduits it flows through until they seal (exists); the sealed conduit's conductance
  floors, so next epoch's veins reroute. Fallen: hardens the fan and the placer gravels.
- Acts on climate and water. Warms the ground, the air columns above and the rivers below
  (exists); melts ice (exists). A fallen field's crater lake is the impact's, not Fire's;
  Fire warms it.
- Acts on living cover. Quickening: growth, seeding and decay run faster (exists). The
  ejecta fan is barren for epochs: a toxicity pulse with slow recovery, so establishment
  waits while the placers below carry cores.
- Acted on by. The crust carries its cores and sealed conduits away from the fixed plume,
  leaving a hotspot track of dead country that new strain can reopen; sediment buries the
  fallen stock and erosion exhumes it; tectonics and erosion rewrite the fractures it
  follows; glaciation over a vein is melted from below; society extraction draws the vein's
  budget and the fallen stock down; Hallowed cools its halo inside a ward; Aurora shatters
  its rim.
- Meetings. Shatter rim (Aurora), Boiling shore (Pressure), Overgrowth rot (Greenwood),
  Fired crust (Salt), broken ward line (Hallowed), ruptured door (Veil).
- Ancillary. Core, vein, halo, crater lake, ejecta fan, placer band and compass-deviation
  classes; Ember grove and Thaw meadow; fire-seat, fire-forge, panning.

### Aurora

- Creation. Charge falls to cold ground and accumulates in ice: the cold source reads
  Temperature and IceThickness after glaciation (exists); storage retains charge across
  epochs (exists).
- Propagation. Accumulation routed to the coldest neighbour, retained in proportion to ice
  thickness and travel distance (exists). Carried: the ice reservoir rides `IceFlux` along
  `IceFlowTargets`, concentrates where ice ablates and is dumped with till at the terminus,
  so a moraine belt holds charge after the ice has gone and a readvance re-entrains it; a
  share leaves in meltwater. Relict: the ground reservoir acts without ice at reduced
  strength and thaws over epochs, so a deglaciated valley stays cold (M1d).
- Acts on geology. Weakens exposed rock over epochs (RockResistance down, exists), so
  Aurora country erodes faster when the ice goes; Shatter rim is its violent case.
- Acts on climate and water. A cold shadow of a few degrees (exists, small) and ice that
  resists ablation (IcePersistence, exists), which is the loop: ice holds charge, charge
  holds ice.
- Acts on living cover. Stillness: growth, decay and ripening slow and matter is preserved
  (exists). Melt-line release: where stillness falls between epochs the preserved carbon
  decays at once, a soil pulse that makes the fertile strip (verify, add in M1d).
- Acted on by. Glaciation gives it its medium and warming takes it; Fire melt removes ice
  under a vein; Hallowed stores it in crystals and a reinforced ward holds it; Salt ground
  under its field keeps the dead.
- Meetings. Shatter rim (Fire), Breach (Pressure), Frozen Deepwood (Greenwood), Preserved
  barrow (Salt), reinforced ward (Hallowed), closed door (Veil); carried Pressure charge
  dissipates near its crystals (society ledger).
- Ancillary. Field and prism-ridge classes; Rime forest and Glow-lichen barrens;
  melt-line site, aurora-archive.

### Pressure

- Creation. A deep-ocean source (exists).
- Propagation. Rays through open water, reflecting off coasts and shelves, reinforcing where
  they cross, leaving warm wakes (exists). Weather: where a wake's SeaSurfaceAnomaly stands
  above the air temperature by a margin, or a strong front meets upwelling, a storm is born
  as an energy and moisture pulse into the air columns at those cells; `marchAirColumns`
  carries it downwind along WindX and WindY, raining it out over terrain, so a windward slope
  is wet and the lee dry by the existing orographic logic.
- Acts on geology. Repeated stress reshapes coasts (ExternalCoastalForcing into coastal
  evolution, exists). Storms scour soil where storm precipitation and slope are high
  (SoilDepth down) and move dunes on bare windward ground (sediment flux on cells below a
  cover floor).
- Acts on climate and water. Upwelling cools the sea surface and settles fog on the facing
  coast (exists); wakes warm still water (exists); storms bring rain and snow to the
  windward side and dry the lee.
- Acts on living cover. Fog supports fog heath and moss forest (exists); storm-fed windward
  slopes carry heavier cover, the lee thinner.
- Acted on by. Coast geometry and shelves decide reflection, so the coasts it cuts change
  next epoch's rays; cold air gives storms their genesis and Aurora's cold pins a front;
  Fire heat columns feed a storm; a Hallowed rim turns a track.
- Meetings. Boiling shore (Fire), Breach (Aurora), Brackish wending (Greenwood), Brine
  storm (Salt, bible gap), turned track (Hallowed), carried charge stopped at a door
  (Veil).
- Ancillary. Ray, front, wake, crush, upwelling and fog classes; Fog heath and Moss forest;
  fishery coast, seasonal harbour closure, pressure-diving and sky-reading.

### Greenwood

- Creation. Stand origin: cells whose canopy has held above a floor for several epochs
  (carried cover age) or whose PeatCarbon is deep; accumulating renewal through storage.
  Spring origin: aquifer outcrops, cells of high CarbonateRatio on basin edges and slope
  breaks where SoilWater saturates from upstream recharge; continuous renewal while the
  basin's precipitation holds, reduced by society withdrawal.
- Propagation. Two media. Roots: spread between connected cells whose cover is above a
  floor, cost falling as cover rises. Aquifer: along the drainage basin below ground from
  the recharge area to the spring, emerging only at spring cells. Barriers: bare rock
  (cover below the floor with shallow soil), open water, ice. Oasis: a spring on bare ground
  forces establishment in its cell, and next epoch's roots carry on from it, so chains of
  oases cross dry country. Animals: browsers and grazers feeding on verdure carry it in the
  gut and drop it along `migrateAnimals` fronts, so a herd seeds Greenwood ahead of the
  forest edge. Wind and current: the `ecologyCrossing` carriers take propagules to
  islands.
- Acts on geology. Deepens soil (SoilDepth up) under verdure. Overdrawn springs collapse
  the karst beneath them: a bounded relief drop at the spring cell and its neighbours, the
  spring fails, a sink may hold water.
- Acts on climate and water. Divides rivers into wetland channels: WetlandCover up and
  flow spread across verdure cells so the after-response water pass braids them;
  evapotranspiration rises, which the temperature term already cools.
- Acts on living cover. Verdure: growth beyond the climate band (the ecology's temperature
  and moisture gates relax in proportion), establishment on bare ground, regrowth of cleared
  land within an epoch, resistance to the fire regime.
- Acted on by. Cover is its medium, so burning, clearance and drought cut it; karst gives
  it springs and society withdrawal collapses them; Salt kills it from below and it buries
  Salt under peat; Aurora freezes its front; Fire rots it and boils its springs.
- Meetings. Overgrowth rot (Fire), Frozen Deepwood (Aurora), Brackish wending (Pressure),
  Standing-dead front (Salt), knitted tear (Veil, proposal).
- Ancillary. Stand, spring, oasis and sinkhole classes; Deepwood, Wending fen and Well
  meadow; tending practice, lumber taboo, healing well.

### Salt

- Creation. Death origin: society's mass-death records (hazard casualties, die-offs, ruins,
  fragmented and collapsed polities, and the new siege event), strength by deaths per area,
  evaluated in the society phase. Dead-lake origin: a closed basin whose lake was water kind
  2 in an earlier epoch and is dry now (carried channel), strength by former area and depth;
  the rain-shadow pan is this origin in a dry climate. Accumulating renewal: Salt does not
  decay; Fire alone removes it.
- Propagation. Brine seep downslope along FlowTargets with SoilWater, retained where ground
  is dry (low Moisture) or anoxic (high WetlandCover or PeatCarbon), flushed where flow
  reaches the sea. In closed sinks the seep crusts into a bed; wind lifts the bed as dust
  along WindX and WindY for a bounded distance and deposits salting. The bed rides the
  crust: buried under sediment it is inert, exhumed it dissolves and collapses the ground,
  and where strain is high it is squeezed up through the overlying rock far from the basin
  that made it.
- Acts on geology. The pan centre fuses: RockResistance up and soil gone at the glass flat.
- Acts on climate and water. Desiccation: SoilWater and evapotranspiration fall on salted
  ground, Moisture falls, so drying spreads outward from each basin and the next epoch's
  climate is drier there, which dries more lakes, which is the loop.
- Acts on living cover. Salting: cover thins (growth down), soil turns infertile
  (productivity down), grazers avoid it.
- Acted on by. Aridity retains it and wet climates flush it; tectonics makes the closed
  basins; society makes the killing grounds and rakes the pans; Fire burns it clean;
  Greenwood buries it; Hallowed halts it at a line.
- Meetings. Preserved barrow (Aurora), Fired crust (Fire), Standing-dead front (Greenwood),
  Brine storm (Pressure, bible gap), halted at a ward (Hallowed), tear held open (Veil,
  proposal).
- Ancillary. Killing ground, pan, flat and dust classes; Barrow heath, Salt pan and Glass
  flat; mirages; raking practice, necropolis, salt trade, detour routes.

### Hallowed

- Creation. Society phase. Tenure: years occupied times population at a community's seat,
  summed over eras and rounds; pilgrimage: communities where many connections converge;
  bound lines: polity borders and walls kept across cycles, river banks with works. Kept
  renewal: a maintenance read; an abandoned shrine or unwalked line decays over epochs, a
  ruin fades.
- Propagation. Along society connections in proportion to their use, stored at shrines
  (works), reinforced by Aurora charge stored in crystals.
- Acts on other systems. Warding: inside a ring every other system's intensity and coverage
  are scaled down and the displaced amount is added to the rim cells, so the land just
  outside a great sanctuary is the most dangerous in the world.
- Acts on geology and water. Rivers keep their beds and coasts stop eroding inside: channel
  migration pinned and RockResistance raised inside the ring for the next incision pass,
  ExternalCoastalForcing reduced for the coasts pass. The sediment and wave energy held back
  are not destroyed: the first reach below the ring incises and its banks collapse, and the
  coast downdrift of the ring retreats faster, as below a levee or past a terminal groyne.
- Acts on climate. Storm tracks turn aside at the ring (M2's tracks route around it).
- Acts on living cover. No biome of its own; disturbance is damped inside so existing cover
  persists.
- Acted on by. Society tenure makes and abandonment unmakes it; an opened Fire conduit
  under a line breaks it; Aurora reinforces it.
- Meetings. All through warding; it is the any-system class.
- Ancillary. Sanctuary ring, pilgrimage line, ward line and fading-halo classes; vow
  practice, temple cities, pilgrim economies, sanctuary site.

### Veil

- Creation. Derived, evaluated after every other system of the epoch. Strain in a cell is
  the sum over pairs of enabled systems of the product of their intensities times the
  gradient of their difference across the cell's neighbours, plus the coverage of any
  confluence present. A tear forms above a strain floor. A tear whose strain moves between
  epochs is a wild zone; one that holds its place and strength across epochs is a stable
  tear, and stable tears are paired by similar strain and distance into doors.
- Propagation. None in space; it persists and pairs in time.
- Acts on geology and water. A wild zone perturbs small relief within a bound at each epoch
  boundary, so streams change course without flooding and a hill shifts; the bound is
  about a cell per epoch, the distance mobile dunes and thermokarst move in a thousand
  years, so a stream moves to the next valley and a range never moves; a door leaves a
  cold pool (a small depression holding water).
- Acts on climate. The cold pool lowers temperature in its cell.
- Acts on living cover. A wild zone shuffles cover as a disturbance pulse; a door grows a
  ring of unusual vegetation (establishment forced in a ring of cells).
- Acts on travel. A door is an edge between two distant cells in the society graph.
- Acted on by. Every other system is its source; Aurora closes a door, Fire ruptures it,
  Hallowed seals it; proposals: Greenwood knits a tear shut, Salt holds it open; carried
  Pressure charge cannot pass.
- Ancillary. Wild-zone and door classes, the unreliable-region mark and alternate feature
  positions derived from the recorded change; door-keepers, fortresses at doors, inland
  door cities with port-like reach.

### Meetings as processes

A confluence is a process in the shared list. Its coverage comes from its parents: the
smaller parent coverage, scaled by strain. The parents' coverages are reduced by the
confluence's, so a meeting displaces what made it rather than adding to it, and no
system's effect is ever netted against another's. Within its coverage the confluence's
process sets the cell's conditions, so a meeting is never read as the mean of its parents.
Hallowed and Veil are any-system classes: warding scales coverages inside a ring and lands
the displaced coverage on the rim; tearing reads strain wherever classes of two or more
systems hold a cell above the floor, so it is the generic product of any meeting, named or
not. The bible names no triple. Where two pair confluences themselves hold one cell above
the floor, tear coverage rises, so a triple meeting is always more than its pairs: it is
where the world tears.

| Meeting                     | Bible shows                          | Proposed process (agent; the user owns the names)                                                                                                                                                                  |
| --------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Fire / Aurora               | rim of cracked ground, Veil          | Shatter rim: rock split between held heat and held cold; FractureConductance up, RockResistance down, relief roughened into needle fields within a bound, soil removed, steam vents along the rim; strain for Veil |
| Fire / Pressure             | steam fractures, broken coast        | Boiling shore: fractures vent under the sea; ExternalCoastalForcing spikes, cliffs retreat into stacks and blowholes, sea-floor vents; steam and fog together                                                      |
| Fire / Greenwood            | rot halo, steam fractures at springs | Overgrowth rot: verdure under quickening outruns structure; canopy dies standing, fungal mats, EcologicalToxicity rises, springs boil and fracture the ground                                                      |
| Fire / Salt                 | burnt-clean ground                   | Fired crust: salting fused to glass and shed; the one process that removes Salt; a scoured surface that recovers within an epoch                                                                                   |
| Aurora / Pressure           | breached coast, Veil                 | Breach: a front punches an ice coast; fjord-scale breach, ice-wall collapse debris, cold brine fog; strain for Veil                                                                                                |
| Aurora / Greenwood          | frozen forest front                  | Frozen Deepwood: forest preserved standing under held charge; canopy without growth or decay; a front that moves with the ice edge                                                                                 |
| Aurora / Salt               | undeath                              | Preserved barrow: nothing decays, nothing grows, nothing erodes; the hazard is the dead                                                                                                                            |
| Pressure / Greenwood        | salted coastal springs               | Brackish wending: springs turn salt, fen becomes tidal marsh with mangrove-like cover; well meadows fail                                                                                                           |
| Greenwood / Salt            | dying trees, Veil                    | Standing-dead front: a moving line where verdure and salting meet; trees die without falling; strain for Veil                                                                                                      |
| Pressure / Salt (bible gap) | not defined                          | Brine shore: a warm, still lagoon closed behind a Pressure coast dries to a sabkha, a dead closed lake and so a Salt source; brine storms lift its dust along the storm track as the carrier (agent decision)      |
| Hallowed / any              | weaker inside, concentrated at rim   | Warding scales coverages inside; the displaced coverage lands on the rim                                                                                                                                           |
| Veil / any                  | closed, ruptured, sealed             | Aurora closes and Fire ruptures a door as the bible says; Greenwood roots knit a tear shut over epochs, Salt ground holds a tear open, carried Pressure cannot pass (agent decisions)                              |

### Ancillary: measure, classes and drawing

Coverage is the one piece of this that the physics needs: a latent fraction per cell per
rule, derived from the rule's own quantity through a declared mapping, bounded so a cell's
coverages sum to at most one (within a system the highest-priority class takes first;
across systems they scale down together). Everything else here is presentation and lands
in M8: `finalSurface` stays the presentation raster, as the largest coverage with the
second code published beside it and hatched above a floor; magic places are outlined from
the coverage contour the way biomes are outlined from cover; biome naming goes to the
strongest forcing rather than list order; a society site needs coverage above a floor.
Under ADR 0005 a child reads coverage as one more latent field and realizes classes at its
own mesh; that work is subplan C of the regional refinement plan.

## Milestones

Every system milestone is accepted on fields and couplings, measured on a short scenario:
the system's own medium changed, the physical fields it writes changed where the bible says
and nowhere else, and the pillar it reads changed its next evaluation. Classes, names and
drawing are listed last and are not acceptance on their own.

### M0 — Review and plan

Scope: this document; review of the bible against the implementation; Sulion plan.
Acceptance: findings, decisions and milestones recorded; the user can authorize execution
from this document. Evidence: this file and the Sulion tree.

The original M1 was split on 2026-10-25 at the user's request into M1a, M1c and M1d; the
Sulion phase that carried it is marked skipped with that note.

### M1a — Origins and stocks on the schema

Scope: `origins` on `MagicSystem` with per-origin locate, propagation and renewal kind;
`stocks` per origin with reservoirs, carriers, transfers and sinks; intensity derived from
stock and medium, with each existing preset expressed as one default reservoir so its
fields come out as they do today; the three presets and the authored source record
migrated; society reads by id and role in place of the propagation string; the crust
carrier wired for declared stocks through the transport plan (the carriage machinery only,
no new reservoir yet); budget totals (created, carried, stored, released, lost) published
per system; parameter form and rule editor follow the schema.
Depends on: nothing.
Acceptance: existing worlds regenerate with their magic fields unchanged within rounding; a
test system with two origins locates and propagates each on its own rule; a stock declared
on the crust carrier arrives where the transport plan puts the crust; the budget totals
close on a seed; existing configurations and saved maps load.
Evidence: schema and migration tests; the magic dimension and inclusion tests pass; one
short-scenario generation compared before and after and found identical; saved-map
reopening checked.
Sulion: `c6498e4a-f19e-418e-81a3-005444f44adf`; expansion `e37a0d5c-c117-404e-b104-de57655649a3`.

#### Execution steps (M1a)

1. Schema: origins, renewal, stocks. Step `fa8d7bf1-ecf2-4558-8403-f9ead7f48a29`.
   - Files: `packages/domain/src/magicSystems.ts`, `magicPresets.ts`, a new
     `magicSystems.test.ts`.
   - Outcome: `MagicSystem.origins[]` with `id`, `source`, `propagation`, `renewal`,
     `parameters` overrides and `stocks[]` (`id`, `reservoir`, `carriers[]`); a legacy
     `source`/`propagation` pair parses into one origin and is dropped from the output type;
     validation rejects duplicate origin or stock ids and accepts `source:<origin>` rule
     conditions. Presets declare their origins by name (vein, field, locus); Fire's vein
     declares a held stock on the crust carrier.
   - Verify: domain tests for legacy parse, preset parse, duplicate rejection and the
     condition field; the whole repo typechecks only after step 2, so steps 1 and 2 share the
     typecheck.
2. Generation per origin. Step `99a3cbc3-92bf-4244-ae6d-963f1eda9288`.
   - Files: `canonry/magicSources.ts`, `magicPropagation.ts`, `magicOcean.ts`,
     `magicBeams.ts`, `magicState.ts`, `magicFeatures.ts`, `magicProcesses.ts`,
     `magicMetadata.ts`, `placeGeometry.ts`, `canonry/magic.test.ts`.
   - Outcome: each origin locates and propagates with its own strategy and merged
     parameters; the field's intensity, wake and rogue are the maximum over origins and
     retained the sum; per-origin source channels feed `source:<origin>` conditions; located
     source points carry their origin; process requirements and parameter metadata come from
     every origin. The located-point list is renamed from `origins` to `located` so it does
     not collide with the schema.
   - Verify: a characterization test records inline checksums of the three presets'
     intensity, wake and source totals on the magic test scenario before the change and must
     match after; a two-origin test system locates both and takes the maximum; the existing
     41 magic tests pass.
3. Stocks and crust carriage. Step `7ded86ec-94d3-4880-829f-da63f7fb58a1`.
   - Files: `canonry/magicState.ts`, `magicSources.ts`, `advection.ts`, `field.ts`,
     `transportPlan.ts` or `transportHistory.ts`, `magicFeedback.ts`.
   - Outcome: a stock channel per origin reservoir (extensive, amount per cell); the default
     reservoir mirrors the origin's source times area after locate; plate advection stashes
     its transport plan on the field so `advectMagic` carries declared crust stocks by the
     plan's weights (conserving the total) while other carried channels keep the dominant
     copy; `magicBudget` totals (created, carried, stored, released) are recorded in the
     history cause.
   - Verify: a unit test advects a stock through a synthetic plan and checks conservation
     and arrival; a budget test on the scenario closes within rounding.
4. Society reads by role. Step `5d07c797-07b4-4efa-adae-603a8676bcc2`.
   - Files: `societyMagicAccess.ts`, `societySeeking.ts`, `societyHazards.ts`,
     `societyMagic.ts`, `societyEnvironment.ts`, `canonry/placeGeometry.ts`.
   - Outcome: `magicAt(state, role, i)` where role is quickens, stills or moves-water,
     resolved from a system's effects; the society environment re-propagates by role; vein
     geometry asks origins for a fracture propagation.
   - Verify: society tests that touch magic (seeking, hazards, practices, environment,
     sites) pass.
5. Form and configuration follow the schema. Step `51769ad5-de84-40e7-8a10-082cb5ad2e68`.
   - Files: `frontend/src/MagicSystemsForm.tsx`, `GenerationMagicConfiguration.tsx`,
     `generationMagicControls.ts`.
   - Outcome: the form edits a list of origins (source, propagation, renewal; add and
     remove) in place of the single pair; summaries name each origin's propagation;
     controls are keyed from every origin.
   - Verify: frontend typecheck; `generationMagicControls.test.ts` and
     `magicClimate.generation.test.ts` pass.
6. Exit checks and record. Step `354e0f29-b5c0-46d7-8239-9a8679dadf51`.
   - Verify: targeted vitest for magic, society and frontend; `pnpm typecheck`; eslint on
     changed packages; saved-map reopening covered by the existing inheritance tests. Plan
     document and Sulion updated; commit on main.

#### Changes and resume (M1a)

Completed 2026-10-25. Evidence: a characterization test (`magicCharacterization.test.ts`)
recorded the three presets' source, intensity, wake and retained totals on the magic
scenario before the change and matches after it; domain tests cover the legacy parse,
overrides, duplicate rejection and `source:<origin>` conditions; a two-origin test locates
both origins and takes the maximum; a synthetic transport plan carries a crust stock with
its total conserved; the budget test closes created against carried. 97 generation and
domain tests across magic, society, bindings and ecology pass, 22 frontend unit tests pass,
and the frontend magic climate scenario passes (86 s). Typecheck, eslint on packages and on
the changed frontend files, and Prettier are clean. Material choices made while building:
a system with one origin propagates from the shared `source` channel so callers that set
it directly keep working, and several origins each propagate from their own; origin
parameter overrides are applied by swapping the field's definition for the strategy call
rather than threading parameters through every strategy; the transport plan is kept on
the physical field (`transportPlan`) after plate advection, which is the one new field
property. The pre-existing frontend lint failures in `frontend/.artifacts` bundles and
`TemplateDrawing.tsx` are not part of this work. The generation guide's description of a
system as one source and one propagation is left for M8's documentation pass.

### M1b — Composition: coverage and confluences

Scope: the shared `confluences` list and the three existing meetings moved out of the
Pressure preset as processes: Shatter rim (FractureConductance up, RockResistance down,
bounded relief roughening, soil removal, steam vents), Boiling shore (coastal forcing
spike, cliff retreat, sea-floor vents) and Breach (ice-coast breach, collapse debris, cold
fog), each with a coverage taken from and displacing its parents, its own hazard and its
own class; strain as a published field; coverage per rule as the latent measure the
displacement needs, with the membership channel kept as coverage above a floor so current
readers keep working; the rule editor edits confluences. Drawing and outlining changes are
not in this milestone.
Depends on: nothing; M1a and M1b may land in either order.
Acceptance: a cell that both Fire and Aurora reach carries Fire, Aurora and Shatter rim
coverages summing to at most one; where the rim holds, fracture conductance is raised,
rock resistance lowered, relief rougher and soil gone, and those fields are not the mean of
a Fire-only and an Aurora-only neighbour; the next epoch's Fire veins follow the rim's new
fractures; disabling Fire leaves the confluence unclassified and Aurora's fields whole; a
cell one rule reaches alone is unchanged.
Evidence: unit tests on coverage derivation, displacement, the sum bound and each
confluence's field writes; the existing magic dimension, inclusion and biome tests pass;
one short-scenario generation compared before and after on a seed where Fire meets
Aurora.
Sulion: `3823c280-db91-4775-afce-c0fb0c69872b`; expansion opened 2026-10-25 (IDs in the
Sulion tree).

#### Execution steps (M1b)

Design fixed at expansion. A confluence is a record in a shared `confluences` list
(`world.confluences`, defaulting to the Canonry presets, bound through the
`magic.configured` configuration beside `magicSystems`): `systems` it reads (two or more),
a coverage `floor` each parent must reach, a `strain` scale, seed and retain conditions in
the existing rule grammar reading `system:<id>` and physical fields only, `effects` on the
physical fields (fracture conductance, rock resistance, relief roughening in metres, soil
removal share, coastal forcing, fog, ice melt in metres, debris in metres, toxicity), an
optional `hazard` (kind, rate per year at full coverage, severity, radius, cause), and a
surface priority and cartography. It is effective only when every system it reads is
enabled. Coverage: a rule may declare `coverage: { field, floor, full }`, a linear map of
that field from floor to full inside its grown region; without it a member cell has
coverage 1, so membership is unchanged. A system's coverage in a cell is the maximum over
its rules. Strain in a cell is the product of the two parents' intensities (as fractions)
times the largest neighbour difference of their intensity gap (as a fraction). Confluence
coverage is the smaller parent coverage times `clamp(0.25 + strain × scale, 0, 1)`, so a
meeting whose conditions hold always has some coverage and a sharp front has more. The
confluence's coverage is subtracted from its parents' rule coverages in the cell, and if
the coverages of all systems and confluences in a cell sum past one they scale down
together. Effects are applied once per evaluation where confluence coverage is positive,
scaled by it: fracture and rock through the existing clamps, relief as a bounded signed
noise on bedrock, soil as a share removed, coastal forcing into the external coastal
forcing, fog into `FogForcing`, ice melt from `IceThickness`, debris deposited as sediment,
toxicity into `EcologicalToxicity`. Confluences are evaluated in the post-glacial action
after both phases have run, in every epoch and at present; classification at present
reads the same members and coverage for surface codes and places. Surface codes list the
confluences after the systems as one source named Interactions. The three Pressure rules
war, steam and breach move to presets named Shatter rim, Boiling shore and Breach with
their ids kept so existing presentation and saved maps keep their colours.

1. Confluence schema and presets: `packages/domain/src/magicConfluences.ts`, `model.ts`,
   `operations.ts`, `magicSystemIntents.ts`, `featureCatalogue.ts`, `geographySurfaces.ts`;
   `generationSettings.ts`, `featureConfiguration.ts`, `atlasPublication.ts`. Verify: domain
   tests on parse, validation against system ids and own-channel conditions; settings test.
2. Coverage: `magicState.ts` (per-rule and per-system coverage), `magicFeatures.ts` (mapping
   after growth), `magicFieldDefinitions.ts`/`atlasPublications.ts` (channels), presets
   declare coverage on vein, halo, field, front. Verify: characterization unchanged;
   coverage test.
3. Evaluation and processes: new `canonry/magicConfluences.ts`; `magicProcesses.ts` runs it
   in the post-glacial action; `magicFeatures.ts` classifies confluences into
   `finalSurface`; `geographicRegions.ts` publishes confluence places. Verify: unit tests on
   strain, coverage, displacement, sum bound, each effect; the acceptance scenario.
4. Hazards, publications, frontend: `societyHazards.ts` reads confluence hazards;
   `atlasPublications.ts` channels and feature kinds; `rasterPresentation.ts`,
   `atlasState.ts`, `GenerationMagicConfiguration.tsx`, `MagicSystemsForm.tsx` (a confluence
   editor), `generationDraftEpochs.ts`. Verify: hazard test, frontend typecheck and tests.
5. Exit checks and record.

#### Changes and resume (M1b)

Completed 2026-10-25. Evidence: `magicConfluences.test.ts` (generation) checks that where
Fire and Aurora meet the Shatter rim takes coverage from both parents, every cell's
coverages sum to at most one, fractures open, rock weakens, soil goes and bedrock roughens
only where the rim holds, a sharp front strains more than a gentle one, the next Fire
propagation reaches at least as far after the rim opened its fractures, disabling Fire
leaves no rim and Aurora whole, and a rule's declared coverage maps from floor to full;
the domain tests check presets, effectiveness, validation and surface codes; the
characterization snapshot of the three presets is unchanged; 118 generation and domain
tests and 22 frontend unit tests pass; typecheck, eslint on packages and on the changed
frontend files, and Prettier are clean. Material choices made while building: a
confluence that names a system the world lacks validates and simply never holds, so the
preset meetings travel with any system list (the earlier plan to reject unknown systems
broke every fixture with a custom system); coverage is published per rule
(`magic:<system>:coverage:<rule>`) and per system (`magic:<system>:coverage`), strain as
`magic:strain`, and each confluence as `magic:confluence:<id>:members` and `:coverage`;
confluence places publish as areas under the kind `confluence:<id>` and the catalogue lists
them under Interactions; the three former Pressure rules keep their ids (war, steam,
breach) so saved maps and the palette keep their colours; society hazards are now the
confluences' declared hazards scaled by coverage at the community, replacing three
hard-coded exposures; the magic step and the world form carry a confluence editor (enable,
floor, strain scale, effects, hazard rate). Condition reading moved to `magicRegions.ts`
so confluences and rules share one grower. Course geometry for Boiling shore is not
rebuilt in this milestone; confluence places are areas until M8's presentation pass.

### M1c — Fire as material

Scope: the held, releasing and spent reservoirs for vein Fire, with the cracking agents
that move held into releasing (mining, tectonic strain, ice load, impact shock, exhumation
and frost at the surface) and release hardening the rock and sealing the conduit; the
fallen origin (impact centres as sources with a finite stock from excavation volume, ejecta
halo elongated downwind, placer trains down the drainage, hardened fan and gravels, a long
toxicity pulse on the fan, panning that draws the stock down); burial of fallen and spent
stock under sediment and exhumation by erosion, with placers below any exhumed vein; the
ember road (the plume fixed while the crust drifts, a hardened track of spent conduits
behind the live head, reopened at reduced strength under new strain); impact heat as a
coreless source; coupling 1 (ice load cracks held cores, melt pools under the ice and
bursts out as outburst floods cutting channels below the margin, and the margin cannot
cross a strong vein field); a sealed vein as a reason for society to migrate. Last: crater
lake, ejecta fan, placer band, track and compass-deviation classes.
Depends on: M1a.
Acceptance: on a seed with impacts, Fire surrounds the crater and runs down its rivers with
no conduit behind it, the fan carries toxicity and no cover for epochs while the placers
below hold cores, the stock falls under panning and never renews, and vein Fire's fields
are unchanged where no new agent acts; on a seed with drift, after the first epochs the
live field sits at the head of a hardened track of sealed conduits several cells long; an
ice sheet advancing over a vein field leaves meltwater channels below its margin and does
not cross the field; an eroded orogen exposes buried stock and its rivers carry placers;
the Fire budget closes.
Evidence: unit tests on cracking agents, the track, burial and exhumation, placers and
outburst floods; one short-scenario generation on a seed with impacts and drift, compared
before and after.
Sulion: `068c26f3-4a64-44d5-8070-c15711765b54`; expansion opened 2026-10-25 (IDs in the
Sulion tree).

#### Execution steps (M1c)

Design fixed at expansion. Stocks are amounts per cell (strength times area) and every
mutation of a stock happens once per epoch in a stock advance run with the history pass,
so re-evaluations inside an epoch never double-count; locate only reads stocks to make
sources and records what it released. The fallen origin has source `impact` and propagation
`local` (intensity is the source where the cores lie, no spread): at each impact event not
yet seeded, stock lands on the crater and its ejecta cells in proportion to ejecta
thickness, elongated downwind along the wind, scaled by a density parameter, and the
arrival epoch is recorded in a new carried channel. Each evaluation the fallen source in a
cell is its exposed held stock (exposure falls to zero as sediment buries it) times a
release share, the sum of a base share and the cracking agents present (tectonic strain,
ice load, frost on exposed ground, impact shock in the arrival epoch), capped at one, per
unit area; impact heat adds a coreless source that decays with the epochs since. The
advance moves a share of every river-carried stock down the flow targets (placers), removes
what was released from the finite stock, converts a sealing vein's held stock to spent, and
re-applies the fan's toxicity for a declared number of epochs after arrival. The vein
origin gains a spent reservoir on the crust and river carriers: exposed spent stock feeds
the vein source at a reduced strength and travels as placers; a sealed conduit under strain
above a threshold reopens with a share of its budget left. Fire melt under ice is added to
glacial meltwater so the runoff pass cuts its channels. Society: the Fire practice's deposit
reads the held stocks at its seat and extraction draws them down on the mesh; a seat whose
vein has sealed offers no Fire to seekers. Classes read `stock:<origin>/<stock>` and
`source:<origin>` conditions.

1. Schema and presets: `magicSystems.ts` (sources, propagations, parameters, `stock:`
   conditions), `magicPresets.ts`, `magicFieldDefinitions.ts` (arrival), form labels.
2. Fallen origin and stock dynamics: `magicSources.ts` (impact strategy), `magicPropagation.ts`
   (local), new `canonry/magicStocks.ts` (advance), `magicFeedback.ts` (advance from the
   history pass), `magicRegions.ts` (stock conditions).
3. Vein as material: `magicFeedback.ts` (seal to spent, meltwater), `magicSources.ts`
   (exposed spent as source, reopening).
4. Society and publication: `magicState.ts` (stock channels published and inherited,
   `drawStock`), `atlasPublications.ts`, `magicFeatures.ts`, `societyMagic.ts`,
   `societySeeking.ts`.
5. Exit checks and record.

#### Changes and resume (M1c)

Completed 2026-10-25. Evidence: `magicStocks.test.ts` checks that an impact seeds a finite
fallen stock from its ejecta once, heavier downwind, with the crater as a located point
and the release as the source where the cores lie; that the stock runs down epoch by epoch
and never renews, faster under a glacier; that burial under deep sediment stops release;
that river-carried stock moves downstream and leaves the budget at the sea; that a sealing
conduit's cores become spent ore which feeds the source again at reduced strength while the
core itself yields to another peak; that strain across the seal reopens the conduit with
part of its budget; and that Fire under ice melts it from below and writes glacial
meltwater only where the vein is. The characterization snapshot of the three presets is
unchanged. 135 generation and domain tests and 31 frontend unit tests pass; typecheck,
eslint on packages and changed frontend files, and Prettier are clean. Material choices
made while building: every stock mutation happens once per epoch in the stock advance run
from the history pass, and locate only reads stocks and records the release share, so
re-evaluations inside an epoch never double-count; the M1a source mirror now skips origins
whose strategy manages its own stock, which the first draft missed and which reset the
fallen stock on every locate; a source channel set directly without locating belongs to
the first origin, so callers that seed `source` by hand keep working with a two-origin
Fire; the fallen origin's propagation is `local` (heat where the cores lie) rather than
radial, which is cheaper and truer to gravel; the vein's `held` stays a mirror of its
located strength and its finiteness is the existing conduit budget, with the new `spent`
reservoir carrying the sealed ore; the ember road is verified by its pieces (sealing to
spent, crust carriage, reopening under strain, exhumed spent as source) and not by a
multi-epoch drift scenario, which M8's full-world run will show. The Fire practice's deposit
now reads the held stocks under the seat and extraction draws them down on the mesh; a
sealed seat offers Fire people nothing, so they move. Labels moved to `magicLabels.ts` to
keep the form under the file-length limit.

### M1d — Aurora as material

Scope: the ice, ground, moraine and shelf reservoirs; charge entering ice at the cold
source and riding `IceFlux` along `IceFlowTargets`, concentrating where ice ablates, dumped
with till at the terminus, lost in meltwater, and calved onto shelves; the ground
reservoir acting without ice at reduced strength and thawing over epochs (relict cold),
with readvance re-entraining it; the melt-line release pulse verified and added if absent;
coupling 4 (charged sliding ice erodes deeper than clean ice, cold-based ice preserves its
bed); the first half of coupling 5 (thawing ground charge collapses into small closed lake
basins, recorded for Salt's dead-lake origin). The existing cold-drainage propagation
becomes the within-epoch redistribution of the ice reservoir.
Depends on: M1a.
Acceptance: a glacier carries charge downstream so its terminus moraine holds charge after
the ice retreats; a deglaciated valley keeps cold and stillness, thaws over epochs with a
soil pulse at the melt line, and gains small closed lakes on its floor; an Aurora trough is
deeper than the same trough on the same seed without Aurora, and cold-based cells are
unchanged; shelves beside a calving Aurora coast hold charge; the Aurora budget closes.
Evidence: unit tests on ice carriage, deposition, thaw, erosion amplification and the lake
record; one short-scenario generation with glaciation, compared before and after.

### M2 — Pressure weather

Scope: storm genesis where a wake stands above cold air or a front meets upwelling; the
pulse into the air columns and its march downwind; windward rain and snow, soil scour,
dune movement, dry lee as field writes; Fire heat columns feeding a storm and Aurora cold
pinning a front as confluence processes; storm tracks as a published field; coupling 11's
coastal half (closed warm lagoons recorded for Salt, upwelling nutrients carried ashore for
cover). Last: seasonal
harbour closure as a society read, sky-reading joins the diving practice, storm-fed slope
cover named for the system.
Depends on: M1a (role reads), M1b (confluences), M1c and M1d (the Fire and Aurora
reservoirs the storm reads).
Acceptance: a Pressure coast under cold air raises storm tracks; a range on the track is
wetter on the windward side and drier in the lee than the same seed without Pressure;
windward soil is thinner where slope is high and dunes have moved on bare ground; a Fire
halo on the track strengthens the storm and an Aurora field holds a front in place.
Without Pressure, climate is as before.
Evidence: unit tests on genesis, pulse and track deposition; a short-scenario comparison of
precipitation, soil and cover with and without weather.

### M3 — Greenwood

Scope: the system as the Composition block gives it: stand and spring origins with their
renewal; root and aquifer propagation with bare rock, open water and ice as barriers;
oasis establishment; Verdure forcing in ecology (growth beyond the climate band,
establishment on bare ground, regrowth within an epoch); SoilDepth deepening; WetlandCover
and flow spreading that braids rivers through verdure; karst collapse at overdrawn
springs; the cover, peat and aquifer reservoirs with the animal carrier along migration
fronts and the wind and current propagule carriers, cover death returning the stock to
soil, burning and clearance as sinks; couplings 6 to 8 (green river mouths, herd roads and
forest islands, buried strata as spring origins); confluences Overgrowth rot, Frozen
Deepwood and Brackish wending as processes.
Last: stand, spring, oasis and sinkhole classes; Deepwood, Wending fen and Well meadow;
tending practice, lumber taboo as a clearance cost, healing well as a site.
Depends on: M1a, M1b.
Acceptance: an old-growth or karst-spring region holds forest where climate alone would
not and its soil is deeper; a river through it braids into wetland channels; a spring on
bare ground founds an oasis that next epoch's roots extend; a town that overdraws its
spring sits among sinkholes; a Fire halo over Greenwood rots and its springs boil; a
cleared Greenwood cell regrows within an epoch; the system can be disabled with no
residue.
Evidence: unit tests on propagation barriers, oasis chains, verdure forcing and collapse;
ecology tests on growth beyond the band; a short-scenario generation compared with and
without the system.

### M4 — Society as carrier and source

Scope: people as the carrier row of the material model and as a source of magic in their
own right, with the `society` phase as the machinery that makes it possible. The phase:
evaluation after the human round inside an epoch and after the present's people, with late
classify and project; locate strategies reading communities, ruins, works, connections,
polities and events; carried channels so a bound era's consequences ride the crust. The
carrier: trade moves held cores, seed and salt along connections in proportion to their
flow, so a city that imports cores cracks them in its forges and becomes a located Fire
source in a country with no vein (coupling 14), a road out of a Deepwood founds groves at
its markets and waystations, and salt trade salts the necropolises it supplies; extraction
draws vein and fallen stocks down and seals veins, and a sealed seat drives migration;
hunting pressure lowers herd populations and with them Greenwood's animal carrier; clearance
lifts the water table under cleared cells so brine can rise; burning is a Greenwood sink.
The source: the located siege event on polity fragmentation or collapse and a published
mass-death channel for Salt to read; tenure and walked-route channels for Hallowed to
read; hazards from confluence coverage with casualties, so a rim or a shatter ground kills.
Last: the society-phase contract and sequence requirements documented.
Depends on: M1a, M1c, M3.
Acceptance: a world with a Fire vein and a trading city with no vein shows a Fire source at
the city after an era of trade and none without it; a road from a Deepwood carries groves
at its stations; an era of heavy hunting lowers migration flux and Greenwood's spread
against the same seed without it; a cleared Greenwood region has a higher water table; a
polity that collapses writes a death channel at its communities and a long-tenured seat
writes tenure; hazards at a confluence rim cause casualties; a world with no human eras has
none of it and its magic is unchanged.
Evidence: society tests on trade carriage, extraction, hunting and clearance; sequence
composition tests; one short-scenario generation with a bound era, compared with and
without people.

### M5 — Salt

Scope: the system as the Composition block gives it: death and dead-lake origins, with the
dried-lake carried channel and the new located siege event on polity fragmentation or
collapse; brine seep down the drainage retained by aridity and anoxia and flushed to the
sea; crusting in closed sinks into a bed that rides the crust, is buried and exhumed,
dissolves and collapses the ground, and is squeezed up where strain is high; dust along
the wind; capillary rise where clearance lifts the water table; couplings 9 to 12 (the
zoned basin, Salt domes in fold belts, sabkha coasts behind Pressure wakes, Fire-warmed
lakes dying); Salting forcing in ecology
(thinning, infertility, grazer avoidance); desiccation of SoilWater and Moisture that
spreads drying outward epoch by epoch; glass flats as fused ground; confluences Preserved
barrow, Fired crust and Standing-dead front, and Brine shore with Pressure (a dried lagoon
behind a wake) with brine storms as its carrier. Last:
killing ground, pan, flat and dust classes; Barrow heath, Salt pan and Glass flat; mirages;
raking practice, necropolis and salt-trade reads, detour routes.
Depends on: M1a, M1b, M1d (thaw lakes), M2 (lagoons and storms), M4 (death channel,
clearance and the water table).
Acceptance: a closed basin whose lake dried carries salting that seeps downslope, crusts in
the sink and blows downwind, its surroundings are drier in the next epoch than the same
seed without Salt, and its centre is fused; the ground below a siege or mass-casualty
event in a bound era carries salting in the present with thinned cover and no grazers; an
Aurora field over a barrow preserves it; Fire over salting removes it.
Evidence: unit tests on origin detection, seep, retention, flushing and desiccation;
ecology tests on salting; a short-scenario generation with a bound era and a hazard.

### M6 — Hallowed

Scope: the system as the Composition block gives it: tenure, pilgrimage and bound-line
origins with kept renewal and decay on abandonment; propagation along used connections
and storage at shrines; Warding as the any-system process that scales other systems'
intensity and coverage inside a ring and lands the displaced amount on the rim; channel
pinning and raised resistance inside for incision, reduced coastal forcing for coasts,
storm-track deflection, with the held-back sediment and wave energy landing on the first
reach below the ring and the coast downdrift of it; coupling 13 (the ward as a dam that
pools Salt and pressurizes Fire until it lapses); Fire conduit opening breaks a line, Aurora charge reinforces it,
Salt halts at it, Veil seals at it. Last: sanctuary ring, pilgrimage line, ward line and
fading-halo classes; vow practice, temple cities, pilgrim economies, sanctuary site.
Depends on: M1b, M4; M2 for the storm-track turn; M5 for the Salt halt.
Acceptance: a long-tenured seat has a ring inside which Fire intensity, Salt seep and
storm tracks are reduced and a rim outside it where they are stronger than without the
ward; a river inside keeps its bed across an epoch where the same river without the ward
migrates; a ruined seat's ring fades over epochs; a Fire conduit opening under a kept
border breaks the line there.
Evidence: unit tests on route propagation, warding displacement, pinning and decay; society
tests on tenure; a short-scenario generation with a bound era.

### M7 — Veil

Scope: the system as the Composition block gives it: strain from every pair of enabled
systems and from confluence coverage; tear detection above a floor; wild zones where strain
moves between epochs, perturbing small relief, stream courses and cover within a bound at
each epoch boundary, bounded at about a cell per epoch; doors as carriers of seed, salt
and cores between their ends (coupling 15); stable tears paired into doors; cold pool and vegetation ring; door
edges in the travel graph; Aurora closes, Fire ruptures, Hallowed seals, carried Pressure
cannot pass, Greenwood roots knit a tear shut over epochs, Salt ground holds it open.
Last: the
unreliable-region mark and alternate feature positions derived from the recorded change;
door-keeper practice, fortresses at doors, inland door cities with port-like reach.
Depends on: M1b; M3 and M5 for the Greenwood/Salt front; M6 for the seal.
Acceptance: a world with one magic system has no Veil; a world with Fire and Aurora shows
wild zones along their rim whose relief, courses and cover differ between consecutive
epochs within the bound; where three systems meet, strain and tear coverage exceed any
pair alone; a pair of stable tears connects two distant communities so that their travel
cost and trade reach behave like a port's; the named closing conditions remove a door.
Evidence: unit tests on strain, tear detection, perturbation bounds and pairing; society
connection tests; a short-scenario generation.

### M8 — Seven-system reconciliation and presentation

Scope: curated controls for every system; presets for all seven in the catalogue and
settings; the ancillary presentation work: `finalSurface` as largest coverage with a
hatched second code, magic places outlined from coverage contours, biome naming by
strongest forcing, society site floors on coverage; product contract 10.3, ADR 0004 or a
new ADR, the generation guide, the bible's status line and backlog item 12 brought to the
implemented state; one full-world run with all seven enabled to retune reach; UI review of
the magic step.
Depends on: M1a to M7.
Acceptance: all seven can be enabled, disabled and shaped from the magic step; the
full-world run shows each system's fields and each meeting's process where the bible
places them without one saturating the map; the drawn surface shows a minority class
where its coverage passes the floor; docs describe mechanisms and leave values to code.
Evidence: `make ci`; the full-world run's log kept under `frontend/.artifacts/generation`;
doc review.

## Sulion mapping

Root `95ca0671-e12f-46ff-8bed-f1c630865ffe` (Seven magic systems).

| Milestone                                    | Phase ID                               |
| -------------------------------------------- | -------------------------------------- |
| M0 — Review and plan                         | `de026aef-92b3-4526-bbf3-c92fa9b7492e` |
| M1 — original phase, skipped after the split | `c7625bc9-22ef-4753-b1a6-bfd073a5925b` |
| M1a — Origins and stocks on the schema       | `c6498e4a-f19e-418e-81a3-005444f44adf` |
| M1b — Composition: coverage and confluences  | `3823c280-db91-4775-afce-c0fb0c69872b` |
| M1c — Fire as material                       | `068c26f3-4a64-44d5-8070-c15711765b54` |
| M1d — Aurora as material                     | `4889fdb3-d627-4cb3-bdb5-faca36b1b34e` |
| M2 — Pressure weather                        | `3ab78ce9-22c3-4a18-9cca-9cf588d31b1e` |
| M3 — Greenwood                               | `5b4b3a5f-e2df-4521-b7db-7947be01a59e` |
| M4 — Society as carrier and source           | `b22db0c9-c2a0-49a2-8574-dc89cb802e0b` |
| M5 — Salt                                    | `d3020011-9f03-4c0e-9fd4-269cd0fcc1d1` |
| M6 — Hallowed                                | `18e2a142-c750-4727-8bce-362adde87d3c` |
| M7 — Veil                                    | `e0b53d7d-3629-4309-b48a-37ee768f40fb` |
| M8 — Seven-system reconciliation             | `ad41c067-9388-4fe5-915e-ba19b0dc6f57` |

Expansion and step IDs are added by plan-phase under each milestone.

## Current state

M0 completed 2026-10-24: review and plan written; the wild-zone and Salt death-source
questions resolved from retrieved user direction the same day. 2026-10-25: the user
corrected the composition model (cells carry shares; meetings are their own processes,
never nets or blends) and the plan's weight (creation, propagation and coupling with
geology, climate and ecology are the deliverable; surface and biome classification are
ancillary). The Composition section was rewritten as one process block per system with a
step table, the meeting table and a short ancillary paragraph; M1b carries the confluence
processes and the coverage measure; presentation moved to M8; every system milestone's
acceptance is on fields and couplings. Later the same day the user asked that the systems
be physical stocks moved by the world's own carriers; the material model section was
written after web research on the real analogues and the system blocks and milestones
carry its reservoirs and carriers. On the user's review the same day, M1 was split into
M1a (schema and stocks), M1c (Fire as material) and M1d (Aurora as material); M4 was
rebuilt from a structural phase into people as carrier and source; and the three open
decisions (Brine shore, Veil's responses, the Salt detachment deferral) were taken by the
agent. The user authorized execution of every phase the same day. M1a completed
2026-10-25 (origins, renewal and stocks on the schema; per-origin generation; crust
carriage of declared stocks; society reads by role; the form edits origins). M1b completed
2026-10-25 (confluences as processes with coverage, strain, displacement and field writes;
the three meetings moved out of the Pressure preset; confluence hazards; coverage and
confluence channels published; a confluence editor). M1c completed 2026-10-25 (the fallen
origin with its finite stock, placers, burial, cracking agents and fan; spent ore, reopening
and exhumation for the vein; Fire melt as glacial meltwater; panning and sealed-seat
migration in society). M1d to M8 pending. Next action: plan-phase expands M1d.
