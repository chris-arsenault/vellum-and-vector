# Scale contract across generation pillars — working plan

Status: planning, 2026-10-24. The user asked for a plan that addresses the scale
contract in depth after a final bug-fix round against the four-pillar plan. No
implementation is authorized by this document; M0 is design and reconciliation.

Sulion root: `e02ba59f-1078-4326-abe4-151e3b23c929`.

## Outcome and scope

Every generation process states, per creation profile, what it **realizes**
(generated at that profile's fidelity and authoritative there), what it leaves
**latent** (a quantity computed for a unit the mesh resolves, which a finer
profile reads as forcing) and what is **absent** (not generated, nothing stored
or hidden). World runs resolve only mesh-scale facts and are fast. Finer
profiles realize inherited latent quantities against their own terrain.

In scope: the contract and its per-process table; the World side of society
works (structural kinds become demand-only, intensive kinds keep field
forcing); World society cost; publication gating for every era; the
realization interface and society's realization at Region; one verification
per pillar that the table matches the code.

Out of scope: regional terrain and drainage synthesis
([regional refinement plan](REGIONAL-REFINEMENT-PLAN.md), Sulion `6bda9dba`,
M2); the defects now being fixed under Sulion `cd507f80` (four-pillar review
fixes); a declaration registry or framework that nothing reads; new magic,
ecology or climate behavior beyond what the
[four-pillar plan](FOUR-PILLAR-INTEGRATION-PLAN.md) has delivered.

Boundaries that govern this plan are recorded on the Sulion root and repeated
in [Decisions](#decisions). The product and architecture authorities remain
[product-spec.md](product-spec.md), the ADRs and
[generation-workflows.md](generation-workflows.md).

## Context and reuse map

The design is the four-pillar plan's
[third pass](FOUR-PILLAR-INTEGRATION-PLAN.md#third-pass-scale-contract--realized-latent-and-absent):
three states, the resolution rule, the per-profile working scales and the
per-pillar table. The ninth pass implemented a reduced reading of it
(`societyDemand.ts`: demands spread over the unit's medium cells, realized at
the nearest medium cell at finer profiles). The review of 2026-10-24 found
these gaps, which this plan addresses:

| Finding                                                                                                                                                                                                                                                       | Where                                                                                                                             | Milestone |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Structural works spread as fields: a dam demand puts every river cell of its unit in `EngineeredDams`, so any pond beside them qualifies as a lake; pass, harbour and dam demands edit elevation.                                                             | `societyDemand.ts`, `societyWorks.ts` (`applyWorkSample`), `societyEnvironment.ts` (`refreshWater`), `lakeStage.ts` (`qualifies`) | M1        |
| World society is about two thirds of a draft run (99 s total, round 28 s, present 34 s). Each cycle with a changed work level edits elevation and triggers the full-mesh hydrology refresh; Fire core use edits temperature and ice and re-propagates Aurora. | `societyEnvironment.ts` (`refreshNative`, `refreshWater`, `refreshMagicPathways`), `societyMagic.ts` (`fireUse`)                  | M2        |
| Ice-age camps with a peak of 20 people publish as World ruins (173 on the continental draft) while present towns need 5,000 concentrated residents.                                                                                                           | `societyRound.ts` (`endRound`), `societyMapScope.ts`                                                                              | M3        |
| Hazard radii of 1.5–10 km on 13–27 km cells; cold-age site boxes of 15–30 km; a 100 km dive search per community per cycle.                                                                                                                                   | `societyHazards.ts`, `societyWorks.ts`, `societyMagic.ts`                                                                         | M3        |
| Region realization locates at the nearest medium cell to the seat, never applies the realized work, inherits demands only when the seat is inside the child footprint, conserves nothing.                                                                     | `societyDemand.ts` (`realizeDemands`), `societyInheritance.ts`, `societyWorks.ts` (`applyPresentWorks`)                           | M4        |

In flight under `cd507f80` on 2026-10-24 (working tree, uncommitted): weirs flag
a shoal only on a standing work over water (`societyNativeWorks.ts`); demand
inheritance by heir share (`societyInheritance.ts`); round maintenance at 40
hands. M0 re-reads these before expanding M1 and M4.

Reuse: the catchment units and ten-year cycle (`societyEvolution.ts`), the
site ranking (`societySites.ts`), `isMajorSettlement`, `world.drainage`
retained reaches, the profile-aware reader (`composition.ts`), the lake-stage
engineered-dam path, and the existing `demand` flag on `SocietyWork`.

Measurements to reuse as baselines: continental draft 99 s with round 28 s
and present 34 s; oceanic draft round adds 24 s to 48 s (four-pillar plan,
seventh and ninth passes). Standard and Fine meshes are four and sixteen times
the Draft cell count.

## Decisions

### User requirements

- Latent means unrealized, never a hidden record. The latent space is the set
  of edges a finer profile may refine. World processes are fast and have world
  fidelity. Source: user, 2026-10-23, session `eac6f55b` turn 517.
- World and Region are distinct creation profiles. Zoom never materializes
  regional detail; regional features never leak into World. Source: user turn
  `01a1624c-599c-7bf1-9637-19d90755e636 / 18661021`.
- The scale contract was gathered as input while other features land first.
  This plan is planning only until the user authorizes execution. Source: user,
  2026-10-23 ("we're just gathering inputs for now") and 2026-10-24 ("setup a
  new plan").
- Work on main only; commit and push only when asked. Canonry is design, not
  parity. Do not drive magic density toward rarity without asking. Source:
  standing user corrections recorded on earlier plans.

### Agent-derived choices

- **Resolution rule.** A process at profile P realizes a feature only when its
  footprint spans at least _k_ cells of P's mesh or it is a designated major
  category. Everything finer becomes a latent quantity on the containing unit.
  Rationale: it is the one rule that makes "latent" mean the same thing in
  every pillar.
- **Intensive versus structural.** Cleared share, withdrawal, hunting
  pressure, heat budget and conductance fraction are intensive: a fraction per
  cell means something, so they spread as field forcing. A dam, weir, pass cut
  or harbour fill is structural: a fraction of one is meaningless, so at World
  it is demand with units and no physical consequence, realized and applied at
  the child. Alternative rejected: keep spreading structures but gate their
  consumers; that leaves the World computing below its mesh.
- **Cost rule.** No full-mesh hydrology refresh or magic re-propagation inside
  the ten-year cycle at World. Refresh once per era, or when a realized
  structure changes. Alternative: keep per-cycle refresh and optimize it;
  rejected because demands no longer change terrain at World, so the trigger
  has nothing to do.
- **One publication rule per profile for every era.** Camps meet the same test
  as towns or appear as a mesh-scale ruin field at a sealed vein or drowned
  weir line.
- **Child conservation.** A child conserves parent totals within a tolerance
  set at M0, never edits parent facts, and keeps unmet demand as a latent
  remainder.
- **Ownership split with regional refinement.** This plan owns the contract,
  the World side and the realization interface, and realizes society demands
  against whatever Region surface exists. Terrain and drainage synthesis stay
  with the regional plan's M2. M4 re-reads that plan's state.

### Provisional assumptions

- _k_ = 2 cells on the smaller dimension is a workable default. Checked at M0
  against the magic feature rules and the biome minimum.
- Per-catchment scalar demands with units suffice at World; fields are needed
  only at Region and below. Checked at M1 by the inventory of consumers.
- World society cost is dominated by the per-cycle hydrology refresh and Aurora
  re-propagation. Checked by profiling at the start of M2.
- The `cd507f80` fixes land before M1 and M4 expand. Checked by reading the
  tree at M0.

### Deferred decisions

- **[DECISION] _k_ and the major categories per pillar.** Owner: user.
  Trigger: M0 table draft. Affects M1, M3, M5.
- **[DECISION] Whether World ever realizes a structure under the major-works
  exception** (a trunk-river dam whose impoundment spans _k_ cells, a canal, a
  long wall) or publishes none until Region. Owner: user. Trigger: M0.
  Affects M1.
- **[DECISION] Durable record.** Whether the settled contract becomes ADR 0004
  or a section of generation-workflows.md. Recommendation: ADR, because it is a
  cross-cutting rule about what each profile may generate. Owner: user.
  Trigger: end of M0.
- **Conservation tolerance.** Owner: agent, within the user's outcome.
  Trigger: M4 expansion, from the inheritance arithmetic.

## Milestones

### M0 — Reconcile and settle the contract

Scope: read what `cd507f80` landed in `societyNativeWorks.ts`,
`societyInheritance.ts`, `societyWorks.ts` and `societyRound.ts`; classify every
`SocietyWorkKind` as intensive or structural with its demand unit; propose _k_
and the major categories per pillar; settle the Region realization interface
(what a child reads: demand per kind per unit with units, unit footprint,
seat, inherited totals); publish the per-process realized/latent/absent table
as the declaration each process is held to.

Acceptance: a table naming, for each registered process, what it realizes,
leaves latent and leaves absent at World and Region, with the consumer of each
latent channel; the three user decisions above answered or explicitly left
open with their trigger; the work-kind classification recorded.

Evidence: source review of the process contracts and the four-pillar plan's
third pass; the table and decisions in this document. No runtime change.

Sulion: `493cd9d7-0036-4c9f-8818-6b950a98fcab`.

### M1 — Structural works are demand-only at World [depends on M0]

Scope: generated dam, weir, pass and harbour works at World carry demand with
units and make no elevation, `EngineeredDams`, shoal or lake changes. Tapping
and quarrying stay field forcing as conductance and stored-charge fractions
along their medium. Clearance, burning, hunting, conservation, irrigation
withdrawal and Fire heat keep field forcing. Authored works with positions stay
located at every profile. If the user chooses the major-works exception at M0,
implement its realization rule here.

Acceptance: a World run's lake set, terrain and shoal flags are identical with
and without society demands; intensive forcing still changes cover, discharge
and herds over the demanding unit; demands carry units.

Evidence: unit checks on `workSamples` and `refreshWater` consumers; a draft
World inventory of lakes and `EngineeredDams` before and after society;
inspection of the cover and population layers for the intensive effects.

Sulion: `71421496-6643-4605-9fc7-b903f8ab4d5f`.

### M2 — World society cost [depends on M1]

Scope: move the full-mesh hydrology refresh and magic re-propagation out of
the ten-year cycle; the cycle writes intensive field forcing and refreshes
society support and connections only; one environmental refresh per era, or
when a realized structure changes; remove the per-cycle `synchronizeNative`
interpolation of unchanged channels.

Acceptance: society time on the continental draft falls to a fraction of the
physical pass stated at M0; population totals, settlement counts and site
classes stay within an inspection tolerance of the current output; Draft and
Standard both measured.

Evidence: CPU profile before and after on the same seed; timing table in this
document; map inspection of settlements and cover.

Sulion: `09914e0c-241e-4600-af86-82aafa765bcc`.

### M3 — Publication gating and ruins [depends on M0]

Scope: round camps are not World features; a mesh-scale ruin field is realized
where a sealed vein or drowned weir line carries camps at its root (the
seventh pass's open item); hazards at World are unit rates with unit-scale
consequences, not point radii; cold-age site and dive searches are bounded by
the unit rather than fixed kilometre boxes.

Acceptance: the World ruins layer contains only features meeting the major
rule or the ruin-field rule; present towns still prefer camp sites through the
latent site bonus; hazard outcomes unchanged in kind.

Evidence: feature inventory of the ruins layer on the continental draft;
inspection; unit checks on the ruin-field rule.

Sulion: `89780f8a-0791-4f87-b8ae-5a7b24ff54e4`.

### M4 — Region realization of inherited demands [depends on M1; coordinates with regional M4]

Scope: inherited demands locate against the Region's refined channels, coast
and relief (a dam where the valley narrows on the inherited or refined
channel, a harbour on the sheltered refined shore) instead of the nearest
medium cell to the seat; realized works are applied on the Region surface so
their physical consequences exist there; demands are inherited by unit overlap
share; parent totals are conserved within the M0 tolerance; unmet demand stays
a latent remainder and is inspectable.

Acceptance: review scene 4 at Region: the dam's lake sits upstream of the dam
on the map and the downstream channel changes; the World map is unchanged by
the child; a demand with no site is reported, not forced.

Evidence: a Region generated under a World with dam and harbour demands,
inspected; focused inheritance and conservation checks; a World feature and
lake inventory before and after the child.

Sulion: `5370830a-1774-4b51-8251-5408b42f7598`.

### M5 — Declarations verified for the other pillars [depends on M0]

Scope: one verification per pillar that the M0 table matches code. Hydrology:
whether a Region rerun generates tributaries from inherited runoff or only
surfaces retained reaches (`refinedDrainageFeatures`); record the result as a
regional-plan dependency if the latter. Ecology: the biome minimum
`share × land` scales with area. Magic: sub-mesh features (vents, terraces,
single prisms) are absent at World and the feature rules are cell-scale.
Geology and climate: fields are the latent space and nothing sub-mesh is
realized at World.

Acceptance: each row of the table has a verification note; mismatches of one
line are fixed, larger ones go to the backlog with the owning plan named.

Evidence: source review per pillar with the file and rule cited; a draft World
feature inventory per layer.

Sulion: `05c8d4dd-e181-449f-af54-c4901c530070`.

## Sulion mapping

| Milestone | Phase ID                               | State   |
| --------- | -------------------------------------- | ------- |
| M0        | `493cd9d7-0036-4c9f-8818-6b950a98fcab` | pending |
| M1        | `71421496-6643-4605-9fc7-b903f8ab4d5f` | pending |
| M2        | `09914e0c-241e-4600-af86-82aafa765bcc` | pending |
| M3        | `89780f8a-0791-4f87-b8ae-5a7b24ff54e4` | pending |
| M4        | `5370830a-1774-4b51-8251-5408b42f7598` | pending |
| M5        | `05c8d4dd-e181-449f-af54-c4901c530070` | pending |

## Current state

Plan established 2026-10-24. No milestone has started. The four-pillar review
fixes (`cd507f80`) are in progress in another session and touch the same
society files; M0 begins by reading their landed state.

Next action: when the user authorizes it, expand M0 with plan-phase and answer
the three user decisions.
