# Seven magic systems

Status: working plan, opened 2026-10-24. Planning only; the request that created this
document authorized the review and the plan, not implementation. All delivery
milestones are pending.

Sulion root: `95ca0671-e12f-46ff-8bed-f1c630865ffe`.

## Outcome and authority

The atlas generates and lets a creator configure all seven systems of the
[magic lore bible](lore/magic.md): Fire with vein and fallen cores, Aurora, Pressure with
sea-born weather, and the new Greenwood, Salt, Veil and Hallowed. Each system acts through
its own medium, leaves its own map signature and biomes, is read by society as a site,
extraction, hazard or route effect, and interferes with the others as the bible's
[meeting table](lore/magic.md#how-the-seven-touch) says. A world with one system enabled
and a world with all seven both generate without a system standing in for another.

Source of the requirement: the user's direction of 2026-10-24 to design the remaining
systems (consolidated in [magic system candidates](magic-system-candidates.md)), the lore
bible written to that design, backlog item 12, and the request of 2026-10-24 to review the
bible against the three implemented systems and plan the remaining work.

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

What exists, read 2026-10-24:

| Concern                           | Where                                                                                                                                                                | Shape today                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| System definition                 | `packages/domain/src/magicSystems.ts`, `magicPresets.ts`                                                                                                             | One `source`, one `propagation`, `phase` in {climate, post-glacial}, flat parameters and effects, history retention, feature rules with seed/retain conditions and `system:<id>` cross-reads                                                                                                                                                                |
| Source and propagation strategies | `packages/generation/src/canonry/magicSources.ts`, `magicPropagation.ts`, `magicOcean.ts`, `magicBeams.ts`                                                           | geothermal, cold, deep-ocean, placed; fracture, cold-drainage, ocean-rays, radial. Strategy declarations drive contracts and the parameter form                                                                                                                                                                                                             |
| Field channels                    | `canonry/magicFieldDefinitions.ts`, `magicState.ts`                                                                                                                  | intensity, history, firstEpoch, stored, retained, coastalHistory, source, wake, rogue, sealed, radii; carried channels advect with the crust                                                                                                                                                                                                                |
| Feedback                          | `canonry/magicFeedback.ts`                                                                                                                                           | heat and melt, quickening and stillness, moved water (upwelling, sea surface, fog, wake warming), rock resistance, conduit opening and sealing, coastal forcing, history retention                                                                                                                                                                          |
| Orchestration                     | `canonry/magicProcesses.ts`, `domainContributions.ts`, `canonry/atlasSequence.ts`                                                                                    | Evaluation in the climate and post-glacial slots of each epoch and of the present; classify and project before the present's people; the human round runs inside an epoch after ecology responds and before coasts, storage and history                                                                                                                     |
| Classification                    | `canonry/magicFeatures.ts`, `packages/domain/src/geographySurfaces.ts`, `featureCatalogue.ts`                                                                        | Rule regions grown from seeds; positional surface codes; interaction rules (war rim, steam fracture, breach) live on the Pressure preset and stay effective through `independentInteraction`                                                                                                                                                                |
| Ecology                           | `canonry/ecologyBiomes.ts`, `packages/domain/src/ecology.ts`                                                                                                         | Biomes outlined from Quickening, Stillness and FogForcing: Ember grove, Thaw meadow, Rime forest, Glow-lichen barrens, Fog heath, Moss forest                                                                                                                                                                                                               |
| Society                           | `societyMagic.ts`, `societyMagicAccess.ts`, `societySites.ts`, `societyHazards.ts`, `societyNativeWorks.ts`, `packages/domain/src/society.ts`, `societyPractices.ts` | Practices fire-forge, aurora-archive, pressure-diving; site classes fire-seat, melt-line, fishery-coast, halo-edge; magical hazards; cold-age works (tapping, quarrying, weir). `magicAt` finds a system by its propagation string                                                                                                                          |
| Routes                            | `societyGeography.ts`, `mapRouting.ts`                                                                                                                               | Travel edges of kind land, river, sea between adjacent cells; connections keep the cheapest crossing per pair of countries                                                                                                                                                                                                                                  |
| Controls and UI                   | `magicCartography.ts`, `frontend/src/MagicSystemsForm.tsx`, `MagicRuleEditor.tsx`, `GenerationMagicConfiguration.tsx`                                                | Per-system curated controls patch parameters and effects; the form edits source, propagation, phase, parameters, effects and rules                                                                                                                                                                                                                          |
| Physical media available          | `canonry/field.ts`, `atlasProjection.ts`                                                                                                                             | Impact excavation, rim and ejecta thickness and `Feature.ImpactCenter` across epochs; lakes as water kind 2 with outlets and overflow; carbonate ratio (karst); tree, wetland and peat cover, soil water and depth; drainage basins and flow targets; wind direction and speed; sea-surface anomaly already warms and moistens the air columns above a wake |
| Society media available           | `societyRound.ts`, `societyHazards.ts`, `societyPolitics.ts`                                                                                                         | Communities with founding and peak, ruined camps of earlier rounds, works, connections, polity sovereignty and control, hazard events with casualties. No battle, siege or famine event exists yet                                                                                                                                                          |

## Review: the three implemented systems against the bible

Fire, Aurora and Pressure are implemented as the product contract describes. The bible and
the candidates design ask for these changes.

**Fire**

- Fallen origin: none of it exists. Craters, ejecta and impact centres are generated and
  travel with the crust, but Fire locates only geothermal maxima. Needed: a second origin
  located at impact centres, propagating as ejecta (radial and downwind) and as placer
  deposits down the drainage, with a finite stock that does not renew; crater lake, ejecta
  fan, placer band and compass-deviation features; a panning extraction in society that
  runs out, distinct from mined vein cores.
- Vein origin: matches the bible (conduit opening and sealing, Ember grove and Thaw meadow,
  warmth carried downstream, basalt scar). Society does not yet read a sealed vein as a
  reason to leave; the seat only loses intensity.
- Interference to add later: rot halo and steam fractures at Greenwood springs (M3), burnt
  Salt ground (M5), broken Hallowed ward lines (M6), ruptured Veil doors (M7).

**Aurora**

- Relict cold: the bible says charge remains in the ground after the ice retreats and keeps
  formerly glaciated valleys cold. `heldCharge` gates cooling and stillness on at least a
  skin of ice, so a relict field with no ice casts no cold shadow. Revise so strong stored
  charge acts without ice, at reduced strength.
- Melt-line release: the bible's fertile strip where preserved matter thaws is implemented
  only through the preservation term of carbon decay. Verify in M1 whether the melt line
  shows raised soil and cover, and add a release term if it does not.
- Otherwise unchanged, as the candidates design decided. Other systems read it: Salt's
  undeath (M5), Hallowed crystals and reinforced wards (M6), closed Veil doors (M7), the
  frozen Greenwood front (M3).

**Pressure**

- Weather: none of it exists as weather. Warm wakes already warm and moisten the air
  columns above them, so some of the storm is emergent, but there is no storm genesis,
  storm track, windward deposition, soil scour, dune movement or dry lee, and no seasonal
  harbour closure or sky-reading practice.
- Interference to add later: Fire heat columns feed a storm (M2), Aurora cold pins a front
  (M2), a Hallowed rim turns a track (M6), carried charge cannot pass a Veil door (M7),
  upwelling salts coastal Greenwood springs (M3).

**Cross-cutting**

- The schema holds one source and one propagation per system. Fire, Greenwood and Salt
  each need two origins with their own locate rule and propagation; Veil's source is
  derived from other systems' fields; Hallowed and Salt are sourced from society.
- The phase vocabulary names only climate and post-glacial. Salt's death origin and all of
  Hallowed need a phase evaluated after people have acted.
- Interaction rules belong to the Pressure definition. With seven systems and eleven
  meetings, pairwise interference needs a home that no single system owns.
- `magicAt` in society identifies a system by its propagation. Once propagation moves to
  origins, society must read a system by id or by a declared role.
- Travel edges connect adjacent cells only. Veil doors need an edge between two distant
  cells.
- Surface codes are positional over all systems' rules. Adding rules to an earlier system
  renumbers later ones. Each generation stores its own `magicSystems`, so saved maps
  resolve against their own definitions; verify this in M1 before changing presets.

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
  source channels where a rule needs them (fallen versus vein). Reason: the bible gives one
  effect set per system and distinct locations per origin. Alternative rejected: separate
  systems per origin, which would make Fire two systems with two forges.
- Renewal is a declared kind per origin (conduit-fed, accumulating, continuous, finite,
  kept, emergent) that selects which existing mechanism applies: the conduit budget and
  sealing, storage retention, a stock channel that extraction draws down, a maintenance
  read, or a parent read. No new generic renewal engine.
- Interference rules move to a shared `interference` list in generation settings, using the
  rule schema that already exists, classified by the same region growth. A rule names the
  systems it reads and is effective when all are enabled. Reason: removes the ownership
  wart the generation guide already records and scales to eleven meetings. Alternative:
  leave rules on the acting system; rejected because several meetings have no single actor.
- Society phase. The phase enum gains `society`. A society-phase system is evaluated after
  the human round inside an epoch, so the epoch's coasts, storage and history see it, and
  again after the present's people with a late classify and project for society-phase
  fields. Society-phase locate strategies read `state.society`, `state.rounds` and
  published society channels. Alternative: evaluate society-sourced systems only from bound
  eras; rejected because a present pilgrim road must show on the present map.
- Each new system gets one living or physical forcing channel named for its medium, which
  ecology, society and classifiers read, in the pattern of Quickening, Stillness and
  FogForcing: Greenwood verdure, Salt salting, Hallowed warding, Veil tearing. Biomes are
  outlined from the forcing and the cover it produced, as `ecologyBiomes.ts` does now.
- Each new system gets one practice channel beside fire-forge, aurora-archive and
  pressure-diving, a work kind, a site class where the bible names a settlement reason, a
  hazard where it names a danger, and a control set in `magicCartography.ts`.
- Veil doors are edges of kind `door` in the society travel graph and a published paired
  feature. Route lines drawn on the map are not rerouted through doors in this plan.
- Society reads a system by id, with a role lookup (which enabled system quickens, stills,
  moves water, greens, salts, wards) replacing the propagation-string match.

**Provisional assumptions.**

- Impact centres from earlier epochs remain locatable after advection through
  `Feature.ImpactCenter` or the excavation field. Checked at the start of M1.
- A closed-basin lake that dries between epochs can be recorded by comparing water kind
  per epoch in a carried channel. Checked at the start of M5.
- Storm genesis can be driven by the existing sea-surface anomaly and air-column exchange,
  with a storm-track pass adding deposition, scour and lee drying. Checked at the start of
  M2; if the columns cannot carry it, a separate storm field is added and the reason
  recorded.
- The saved-map store resolves surface codes against the generation's own
  `magicSystems`. Checked in M1 before any preset changes.

**Decisions resolved from prior user direction (2026-10-24).** Both questions raised in
the first draft were answered from retrieved transcripts rather than put to the user.

- Wild zones change the world physically. A tear's instability perturbs cover and small
  relief in its cells at each epoch boundary within a bound, through the same ecology
  disturbance and surface edits the other processes use. The cartographic mark (region
  unreliable, features in alternate positions) is derived from the recorded change, with
  the previous epoch's positions published beside the current ones. Cosmetic-only marking
  is rejected by the user's standing rule that geography is the result of processes and
  by the direction that magic is powerful and visible. The bound keeps a wild zone from
  rewriting a mountain range.
- Salt's death origin reads every mass-death record society already produces and gains
  one located conflict event. Existing records: hazard events with casualties at a
  position, communities' die-off deaths when population exceeds capacity, ruined and
  abandoned settlements, and polities whose status became fragmented or collapsed with
  their communities and cause. M5 adds a siege event at each community of a polity that
  fragments or collapses, with casualties scaled to its population, so the bible's
  battlefields and sieges exist without a separate war simulation. The user asked for
  societies that collapse and fall and for hazards that wipe out towns; the bible names
  battlefields as Salt's first source, so a Salt that could not read a killing ground
  would miss its headline signature.

**Deferred.**

- Whether ADR 0004 is amended or a new ADR records the seven-system shape. Agent decides
  in M8 from the size of the change.

## Milestones

### M0 — Review and plan

Scope: this document; review of the bible against the implementation; Sulion plan.
Acceptance: findings, decisions and milestones recorded; the user can authorize execution
from this document. Evidence: this file and the Sulion tree.

### M1 — Origins on the schema; Fire's fallen cores; Aurora's relict cold

Scope: `origins` on `MagicSystem` with migration of the three presets and the authored
source record; per-origin locate and propagation; renewal kinds; interference list moved
out of the Pressure preset; society reads by id and role; parameter form and rule editor
follow the schema. Fire gains the fallen origin: impact centres as sources, ejecta and
placer propagation, finite stock, crater lake, ejecta fan, placer band and compass
deviation features, panning extraction in society with depletion, a sealed vein as a
reason to migrate. Aurora's held charge acts without ice at reduced strength; melt-line
release verified and added if absent.
Depends on: nothing.
Acceptance: a world with impacts shows fallen Fire around craters and down the rivers below
them with no conduit behind it; vein Fire is unchanged in behaviour; a society beside a
crater field pans a stock that runs out; a formerly glaciated valley stays cold after the
ice retreats; disabling Fire still leaves the Fire/Aurora rim classified when both others
are enabled; existing configurations load.
Evidence: unit tests on origin location and propagation per origin; the magic dimension and
inclusion tests pass; one short-scenario generation compared before and after on a seed
with impacts; saved-map reopening checked.

### M2 — Pressure weather

Scope: storm genesis where a warm wake meets cold air or a strong front meets upwelling;
storm tracks carried inland by the prevailing wind; windward rain and snow, soil scour,
dune movement, dry lee; seasonal harbour closure as a society read; sky-reading joins the
diving practice; Fire heat columns feed a storm; Aurora cold pins a front. Storm-fed slope
cover named for the system.
Depends on: M1 (role reads, interference list).
Acceptance: a Pressure coast under cold air raises storm tracks visible on the map, a
range on the track is wet on the windward side with a dry lee behind it, and a harbour on
the track is marked seasonal. Without Pressure, climate is as before.
Evidence: unit tests on genesis and track deposition; a short-scenario comparison of
precipitation and cover with and without weather.

### M3 — Greenwood

Scope: new system with stand and spring origins; root-and-aquifer propagation that follows
connected cover and drainage basins and cannot cross bare rock, open water or ice; oasis
establishment at springs on bare ground; verdure forcing read by ecology (forest beyond
its climate band, deeper soil, braided wetland channels, regrowth within an epoch);
Deepwood, Wending fen and Well meadow; sinkholes where springs are overdrawn; tending
practice, lumber taboo as a clearance cost, healing well as a site; interference: Fire
rot halo and steam fractures at springs, Aurora frozen front, Pressure-salted coastal
springs.
Depends on: M1.
Acceptance: an old-growth or karst-spring region holds forest where the biome gradient
would not, with the bible's three biomes named; a Fire halo over Greenwood rots; a society
in Deepwood tends rather than clears; the system can be disabled with no residue.
Evidence: unit tests on propagation barriers and oasis chains; ecology biome tests; a
short-scenario generation reviewed on the map.

### M4 — Society-sourced magic phase

Scope: the `society` phase; evaluation after the human round inside an epoch and after the
present's people with late classify and project; locate strategies that read communities,
ruins, works, connections, polities and events; carried channels so a bound era's
consequences travel with the crust; sequence and contract requirements updated.
Depends on: M1.
Acceptance: a test system in the society phase sourced from community tenure appears on
the present map at old seats and at the ruins of a bound era, and is absent in a world
with no human eras.
Evidence: sequence composition tests; a short-scenario generation with a bound era.

### M5 — Salt

Scope: new system with death and dead-lake origins; the death origin reads hazard
casualties, die-off deaths, ruined settlements and collapsed or fragmented polities, and
society gains a located siege event when a polity fragments or collapses; brine-seep
propagation downslope with groundwater, retained in dry or anoxic ground, crusting in
basins and carried on as dust downwind; salting forcing read by ecology (thinning cover,
avoided grazing, infertile soil, desiccation front, glass flats); Barrow heath, Salt pan
and Glass flat; mirages as a perception feature; raking practice, necropolis and
salt-trade reads, detour routes; interference: Aurora undeath, Fire burns clean,
Greenwood front with dying trees.
Depends on: M1 (dead-lake origin), M4 (death origin).
Acceptance: a closed basin whose lake dried shows a pan and glass flat with drying spreading
from it; the ground below a siege or mass-casualty event in a bound era is a Barrow heath
in the present; an Aurora field over a barrow is marked undeath; Fire-using societies burn
it.
Evidence: unit tests on origin detection and seep; ecology biome tests; a short-scenario
generation with a bound era and a hazard.

### M6 — Hallowed

Scope: new system sourced from community tenure, pilgrimage destinations and bound lines
(walls, borders, river banks); propagation along kept routes with decay when a shrine or
line is abandoned; warding forcing that damps other systems inside and concentrates them
at the rim; stabilization of rivers and coasts within a ward; sanctuary rings, pilgrimage
lines, maintained and lapsed ward lines, ruins with a fading halo; vow practice, temple
cities and pilgrim economies, a sanctuary site class; interference: Fire conduit breaks a
line, Aurora reinforces it, a rim turns a Pressure track, halts Salt and seals Veil.
Depends on: M4; M2 for the storm-track turn; M5 for the Salt halt.
Acceptance: a long-tenured seat has a sanctuary ring inside which Fire halos cool and Salt
stops, a rim outside it where those effects are stronger, and a river that keeps its bed;
a ruined seat's ring fades over epochs; borders of a polity that kept its line show as
ward lines.
Evidence: unit tests on route propagation and damping; society site tests; a
short-scenario generation reviewed on the map.

### M7 — Veil

Scope: derived source from steep gradients between Fire and Aurora, Pressure and Aurora on
a coast, and Greenwood and Salt; small or shifting tears as wild zones that perturb cover
and small relief at each epoch boundary within a bound, with the unreliable-region mark
and alternate feature positions derived from the recorded change; large stable tears
paired as doors; tearing forcing read by ecology and cartography; door edges in the
travel graph; door ring and cold pool features; door-keeper practice, fortresses at doors,
inland door cities with port-like reach; interference: Aurora closes, Fire ruptures,
Hallowed seals, carried Pressure cannot pass.
Depends on: M1; M3 and M5 for the Greenwood/Salt front; M6 for the seal.
Acceptance: a world with one magic system has no Veil; a world with Fire and Aurora shows
wild zones along their rim whose cover and relief differ between consecutive epochs and
whose map region is marked unreliable; a pair of stable tears connects two distant
communities so that their travel cost and trade reach behave like a port's; closing
conditions remove a door.
Evidence: unit tests on tear detection and pairing; society connection tests; a
short-scenario generation reviewed on the map.

### M8 — Seven-system reconciliation

Scope: curated controls for every system; presets for all seven in the catalogue and
settings; product contract 10.3, ADR 0004 or a new ADR, the generation guide, the bible's
status line and backlog item 12 brought to the implemented state; one full-world run with
all seven enabled to retune reach and rarity; UI review of the magic step.
Depends on: M1 to M7.
Acceptance: all seven can be enabled, disabled and shaped from the magic step; the
full-world run shows each system's signature without one saturating the map; docs
describe mechanisms and leave values to code.
Evidence: `make ci`; the full-world run's log kept under `frontend/.artifacts/generation`;
doc review.

## Sulion mapping

Root `95ca0671-e12f-46ff-8bed-f1c630865ffe` (Seven magic systems).

| Milestone                                                         | Phase ID                               |
| ----------------------------------------------------------------- | -------------------------------------- |
| M0 — Review and plan                                              | `de026aef-92b3-4526-bbf3-c92fa9b7492e` |
| M1 — Origins on the schema; Fire fallen cores; Aurora relict cold | `c7625bc9-22ef-4753-b1a6-bfd073a5925b` |
| M2 — Pressure weather                                             | `3ab78ce9-22c3-4a18-9cca-9cf588d31b1e` |
| M3 — Greenwood                                                    | `5b4b3a5f-e2df-4521-b7db-7947be01a59e` |
| M4 — Society-sourced magic phase                                  | `b22db0c9-c2a0-49a2-8574-dc89cb802e0b` |
| M5 — Salt                                                         | `d3020011-9f03-4c0e-9fd4-269cd0fcc1d1` |
| M6 — Hallowed                                                     | `18e2a142-c750-4727-8bce-362adde87d3c` |
| M7 — Veil                                                         | `e0b53d7d-3629-4309-b48a-37ee768f40fb` |
| M8 — Seven-system reconciliation                                  | `ad41c067-9388-4fe5-915e-ba19b0dc6f57` |

Expansion and step IDs are added by plan-phase under each milestone.

## Current state

M0 completed 2026-10-24: review and plan written; the wild-zone and Salt death-source
questions resolved from retrieved user direction the same day. M1 to M8 pending; nothing
is implemented. Next action: authorization of M1; then plan-phase expands M1.
