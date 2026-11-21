# Society restoration: the census answers to every force

Working plan. Sulion root and milestone IDs are recorded at the end.

## Outcome and scope

People's numbers and positions on the land respond to all the forces the old society cycle
gave them, and to the ones it promised, not to food alone. Those forces are:

- food and the land's living cover;
- places that draw or repel people (seats of power, harbours, crossings, passes, sanctuaries,
  fortresses, magic seats);
- travel and contact beyond the next cell, over land, along ways and across water;
- culture and language as working systems;
- realms whose strength rises and falls with their people;
- security, siege and disaster, with their survivors;
- magic, through the rules its crafts break and the ground it makes unlivable.

Across eras these forces interact, so towns and realms grow, shift, fail and recover from the
causes the generation actually produced.

Everything is carried by the numerical fields on the land's mesh and by the place catalogue.
Processes reach each other through shared questions. No catchments, no community records and
no collected head-counts.

Out of scope:

- Regional refinement. The owner is reviewing it separately. The open sub-plan "Refined maps
  keep their inherited people" stays paused.
- The city map's layout, and city width and density. Width is reassessed after M1 and M5,
  because the draw toward places and realm cores changes how people concentrate.
- Music (backlog 28). It stays tabled unless the owner adds it.

## Requirements and boundaries

Each item gives its source.

- **Owner, 2026-11-21:** "i do not want to go back to the old system of placing cachements
  and collecting people. the numerical fields are how we should be doing all of this. and the
  POI system should be utilzied for a lot of it too. but we need to fix there deficicentsies."
- **Owner, 2026-11-21:** the census should be "a complex society people column that ebbed and
  flowed and was subject to a varity of forces, including magic, trade, culutre, food,
  security etc … numeric 'census' style influences", before the town level.
- **Owner, 2026-11-21:** restore what was lost "first", before other society work.
- **Owner, earlier and recorded in the closed society plan:**
  - procedural generation, not detailed simulation;
  - a rock-column-like retained society;
  - society uses magic in aggregate, not by trading magic materials;
  - people change geography and respond to physical and magical hazards;
  - specialization comes from activity, access and contact, not assigned archetypes;
  - regional maps do not rerun eras.
- **Owner, multi-epoch direction:** "apply the multi epoch mixing chaotic interactions to
  society, climate, magic and ecology … the chaotic interaction is key."
- **Owner direction, ADR 0012 and memory:** magic breaks a rule. A craft replaces the answer
  to a shared question for the share of people who practise it. It is never hauling, never a
  yield bonus, and never an if-case inside a process.
- **Standing:**
  - the POI catalogue is the one definition and publisher of places;
  - a missing concept becomes a contract slot, not a helper beside it;
  - one writer per human layer;
  - fix by process, not caps;
  - constants live in contracts and catalogues, not process files;
  - population bands use exaggerated realism (owner direction 2026-11-19).
- **Proposal:** restoration does not reinstate the old code. Each lost behaviour returns as
  the field, shared question or catalogue slot that carries it today.

## What was lost

The closed society plan's dependents checklist is
`git show 049fe64^:docs/SOCIETY-ECONOMY-INTERACTIONS-PLAN.md`. The old modules are at
`c774976^:packages/generation/src/society*.ts`. On 2026-11-11 the old cycle left the era
sequence at 10:58 (bdade3f), its code was deleted at 13:50 (c774976), and the plan closed at
20:51 (049fe64). The Rust port (e59323a) carried the post-rewrite TypeScript across
faithfully.

**Lost without record:**

| #   | Lost behaviour                                                                                                                                               | Home |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| L1  | Places drew people: seat ×2.5, harbour ×1.6, Fire seat ×1.4, pass ×1.3, river node ×1.2; town pull grew faster than its size.                                | M1   |
| L2  | Later towns preferred earlier ruins.                                                                                                                         | M1   |
| L3  | Migration and cultural contact beyond the next cell: along links, over sea and along ways. Islands are never resettled.                                      | M2   |
| L4  | Ground nobody could live on: ice, Fire cores, strong Quickening and Stillness.                                                                               | M3   |
| L5  | The Pressure crush zone cut coastal catch.                                                                                                                   | M3   |
| L6  | Ecology advanced through human eras. It is frozen now; the archive's era ecology step had no caller.                                                         | M4   |
| L7  | Clearance changed soil water and drew on Greenwood.                                                                                                          | M4   |
| L8  | Realm strength from support (whether its land fed its people), ruin damage, crowding and institutions; fragmented status; weak reach left land uncontrolled. | M5   |
| L9  | Contests recorded.                                                                                                                                           | M5   |
| L10 | Seats moved to a much stronger town.                                                                                                                         | M5   |
| L11 | Ruins under control were resettled. Unconfirmed.                                                                                                             | M5   |
| L12 | Sieges brought casualties, refugees, ruin and damaged works.                                                                                                 | M5   |
| L13 | Regional capitals.                                                                                                                                           | M5   |
| L14 | Language knowledge apart from use; forgetting; shared language cheapening contact and reach.                                                                 | M6   |
| L15 | Realm character in its name.                                                                                                                                 | M6   |
| L16 | People-built passes, with their road saving read by travel.                                                                                                  | M7   |
| L17 | The inert `marketTravel` parameter.                                                                                                                          | M7   |

**Deferred and never delivered:**

| #   | Behaviour                                                                    | Home |
| --- | ---------------------------------------------------------------------------- | ---- |
| D1  | Seeking: people and realms favour country their practices suit.              | M7   |
| D2  | Hazards where magic systems meet. Their settings are inert.                  | M3   |
| D3  | Institutions and cultural origins. The layers are registered with no writer. | M6   |
| D4  | Administration districts. The layer is registered with no writer.            | M5   |

**Removed on purpose** (owner-held, see Decisions):

| #   | Behaviour                                        | Home                                   |
| --- | ------------------------------------------------ | -------------------------------------- |
| R1  | Survivors of disasters displaced.                | M5                                     |
| R2  | Hunting and fishing deplete stocks (backlog 29). | M4                                     |
| R3  | Per-people traits.                               | Deferred                               |
| R4  | Drawn records acting on generation.              | Deferred                               |
| R5  | Skill raising yields.                            | Stays removed: magic is no yield bonus |

**Gaps in the place catalogue this plan fixes:**

- **Offers are read only on town maps.** Every entry's People role declares `offers` (water,
  food, power, defence, trade, materials, sanctity), but only town development reads them
  (`atlas/town/providers.rs`). The world's people never feel a place.
- **Hazards are read nowhere.** `threatens` is declared and has no consumer.
- **Registered layers with no writer:** institutions, cultural origins and administration.
- **No people-built pass,** and the regional-capital role is never assigned.

## Decisions

**Owner-decided** (2026-11-21):

- **Survivors move (R1).** Owner: "survivors should move". Survivors of disasters and sieges
  move along the going to where there is room. In M5.
- **Hunting and fishing wear down game and fish (R2).** Owner: "bring it back". This is
  people's use of the ecology's own stocks, and it closes part of backlog 29. In M4.
- R3 and R4 stay deferred, and music stays tabled, unless the owner says otherwise.

**Agent choices** (revisable with evidence):

- **A place's pull comes from what it offers and who values it; neither side owns it.** See
  "Architecture review" under the M0 verdicts.
  - Places keep speaking the seven benefits they already declare.
  - People's needs say how much each benefit is worth to whom, here and now.
  - The pull is the product of the two. The gathering step asks one shared question and knows
    neither places nor needs.
  - A town's own crowd pulls more than in proportion to its size through the same question.
- **A place's threat is read from the catalogue's People threats.** It is a contribution to
  the shared harm question and, where a threat makes ground unlivable, to a new shared
  question: can people live here. Habitability stops being "not water".
- **Travel uses the travel reach.**
  - Movement and contact choose destinations within the travel reach, which already crosses
    water and follows worn ways.
  - Arrivals still need room.
- **Ecology runs during human eras.** It uses the shared ecology owners with an era's
  exposure; ecology already reads people's farmland, clearance and harm.
- **Realm strength reads the realm's people.**
  - It combines the share of its people its land feeds, its ruined towns, its crowding and its
    institutions, all read from the layers and the place records.
  - Contests, fragmentation and uncontrolled land come out of the same strength.
  - Sieges are the catalogue's siege event acting on the layers through harm, with survivors
    (R1, accepted).
- **Language is two shares per tongue: known and used.**
  - Contact between people with a shared tongue costs less, through the travel-friction
    question.
  - Institutions are catalogue places that carry tongue and faith and add to realm strength.

## M0 verdicts and contract

### Architecture review: is "draws people" a place attribute?

**No.** The method in `MATERIALS-AND-PROCESSES-ARCHITECTURE.md` decides it.

1. **The axes.** Three things grow independently:
   - kinds of place, about 60 and growing;
   - what people do with a place: settle, flee to it, seat a realm, make contact, found a
     town, build a district;
   - who the people are: their craft, faith, tongue and realm, and whether they are hungry
     or in danger.

   A harbour draws fishers and traders. A Fire core draws Fire practitioners and repels
   everyone else. A shrine draws its own faith. Walls draw people who are in danger.

2. **The ownership question is the warning sign.** A `People.draws` slot on every entry would
   make the place own a rule that depends on the people too. It would duplicate `offers`
   (two slots for nearly the same concept). Every new kind of person, such as pilgrims or
   raiders, would then mean editing many entries.
3. **The vocabulary in the middle already exists.** The seven benefits: water, food, power,
   defence, trade, materials, sanctity. About 48 entries already declare them. Town
   development already reads them from the consumer side (`atlas/town/providers.rs:166`):
   trade becomes markets, sanctity institutions, power and materials production. So places
   cost M×K and consumers N×K, instead of M×N.
4. **Separate reading, deciding and writing.**
   - Reading: a query, rebuilt each era, projects the catalogue's offers and threats into
     benefit bands and threat bands on the land. This is the facade. It is the only code
     that knows places exist, and people's code never names a place kind.
   - Deciding: each consumer turns benefit bands into its own decision.
   - Writing: owner operations alone.
5. **Default for the many, intercept for the few.** Most places only declare offers. A place
   whose pull really is unlike its benefits intercepts at one named point, a responder on
   `draw`, rather than through a slot every entry must answer.
6. **Proven against examples not in the room:**
   - A new oracle: declares sanctity and trade; no people code changes.
   - Pilgrimage: one valuation, sanctity of one's own faith; no place entry changes.
   - Coastal raiders: a valuation of others' trade; no place entry changes.
   - Realm seat choice: another reader of the same bands.
   - The town map keeps working: it already reads the same offers.

   With a `draws` slot, the pilgrimage and raider examples would each edit every shrine and
   harbour.

7. **What stays out.** Food and water offers do not add pull where the land's support already
   counts that food. The old plan warned against benefits "awarded twice through support and a
   POI bonus". Each food or water offer is checked against the yields in M1.

**What the catalogue lacks for this:**

- **Offers have no reach and no beneficiary.** `Benefits` is a bare map from benefit to
  strength. It gains a reach, so a harbour's trade is felt over its hinterland, not on its
  anchor cell. It also gains an optional "for whom": the faith a shrine serves, the craft a
  forge serves, the realm a seat serves.
- **Threats name no harm.** `Hazard` has a description, reach and severity. It gains the harm
  modes it acts through (shake, burn, scour, drown and the like) so harm can apply it.

These extend existing slots; the entries already answering them keep their answers.

**People's needs are one definition.** A needs table in the people facts says how each
benefit is valued, and by whom:

- **Trade:** by everyone, scaled by the crowd.
- **Power:** by those who hold with the place's realm.
- **Defence:** by people under harm.
- **Sanctity:** by a faith's own.
- **Materials:** by the crafts that work them.
- **Water and food:** only where the yields leave them unmet.

The old pulls (seat ×2.5, harbour ×1.6, Fire seat ×1.4, pass ×1.3, river node ×1.2) become
starting values in that table, not code in the gathering step.

### What the contract gains

**Places are known during the eras.**

- Each era, after `human.places`, the catalogue's places are found from the current state.
  The same `places_of` finding feeds the epoch place effects (`field/poi/publication.rs:28`).
- A query projects their offers into benefit bands, over each offer's reach and for whom, and
  their threats into threat bands by harm mode. These are the facade above.
- The bands are rebuilt every era, so places that appear, grow or end change what people feel
  in the next era.

**New shared questions.** Consumers ask them; responders contribute.

| Question                                          | Base answer                                                     | Responders                                                                                                                                        | Readers                                           |
| ------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `draw`: how strongly a cell pulls people who move | The crowd within the travel reach, growing faster than its size | Benefit bands valued by people's needs; ruins and standing remains (more under a realm's control); seeking, from crafts suited to the medium here | Gathering (spill and drain) and refugee survivors |
| `livable`: the share of a cell people can live on | Dry land, with thick ice removing it                            | Magic media that refuse people: Fire cores, strong Quickening and Stillness                                                                       | Every reader of today's `habitable`               |

**Existing questions gain responders.**

- **`harm`:** place threats spread over each threat's reach, hazards where magic systems
  meet, and siege harm. Defence offers scale it down.
- **`travelFriction`:** the catalogue's Movement road and boat costs, already declared per
  entry, including people-built passes. Shared tongue lowers it for identity contact and
  realm reach.
- **`wildYield` and shore catch:** the Pressure crush zone cuts coastal catch, as a magic
  medium response. Game and fish worn down by people's take lower what the wild feeds.

**Contract extensions, not new slots:**

- **`People.offers`** gains a reach and an optional beneficiary per benefit.
- **`People.threatens`** gains harm modes.
- **No `draws` slot.** Defence's pull rises with the harm around it because the needs table
  values defence by harm, so frightened country gathers behind walls without a place knowing
  why.

**New catalogue entries:**

- **Institution:** a meeting house, temple or academy where a tongue's or faith's people
  concentrate. It offers sanctity to its faith and contact to its tongue's speakers, through
  the beneficiary on its offers, and adds to realm strength. It is published on the
  registered `institution` layer.
- **Cultural origin:** the hearth of a founding tongue or faith, published on the
  `culturalOrigin` layer.
- **People-built pass:** cut where busy ways climb a col. Its road cost is read by travel.

**New people operations:**

- **Flee:** after a strike or siege, survivors move along the going to cells with room, and
  their record names where they went. The owner's move operation does the moving.
- **Take:** people's hunting and fishing become a share the ecology's animal kernels ask for
  through a shared question, `taken`. The ecology owner writes the stocks; people never do.

**Ecology during eras:** the shared ecology development runs in the era loop with the era's
years as exposure. Vegetation asks a `cleared` question, answered by people's farmland,
pasture and built ground. Soil water and Greenwood respond through their owners.

**Realm strength:** `capacity × √(seat townsfolk ÷ least)`, multiplied by:

- **support:** the share of the realm's people its land feeds, relaxing over the years;
- **(1 − ruined share)** of its places;
- **1 ÷ crowding;**
- **(1 + institutions).**

The strength decides control. Below the control threshold, land is left unheld. A close
runner-up records a contest. A realm falling below its own reach fragments into successors,
through the existing successor founding. A seat moves to a town much stronger than its own.

**Language:** each identity-column layer gains a known tongue, beside the tongue it uses.

- Contact teaches it.
- Disuse over the years forgets it.
- A tongue known or used in common lowers contact and reach costs.

### Verdict for every row

| Row                                         | Verdict                                                                           | Carried by                                                                               | Milestone |
| ------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------- |
| L1 places draw people                       | Restore                                                                           | `draw` question from benefit bands and people's needs; offers gain reach and beneficiary | M1        |
| L2 ruins draw founders back                 | Restore                                                                           | `draw` responder from ruin remains and standing                                          | M1        |
| L3 travel and contact beyond the next cell  | Restore                                                                           | Gathering and identity contact choose within the travel reach; travel crosses water      | M2        |
| L4 unlivable ground                         | Restore                                                                           | `livable` question with magic-media responders                                           | M3        |
| L5 Pressure cuts coastal catch              | Restore                                                                           | Magic responder on shore catch                                                           | M3        |
| L6 ecology through eras                     | Restore                                                                           | Shared ecology development in the era loop                                               | M4        |
| L7 clearance changes land                   | Restore                                                                           | `cleared` question asked by vegetation; soil water and Greenwood through their owners    | M4        |
| L8 realm strength from its people           | Restore                                                                           | Realm strength terms above                                                               | M5        |
| L9 contests recorded                        | Restore                                                                           | Contest on the place record when the runner-up is close                                  | M5        |
| L10 seats move to stronger towns            | Restore                                                                           | Seat moves with inertia                                                                  | M5        |
| L11 ruins under control resettled           | Restore (old code confirmed: a ruin under control over 80 years became inhabited) | `draw` responder from controlled ruins                                                   | M5        |
| L12 sieges with casualties and works damage | Restore                                                                           | Siege as a strike: harm on place cells, the catalogue event command for works, then flee | M5        |
| L13 regional capitals                       | Restore                                                                           | Role assignment in place roles                                                           | M5        |
| L14 language knowledge, use and forgetting  | Restore                                                                           | Known tongue per column layer; friction responder                                        | M6        |
| L15 realm character in its name             | Restore                                                                           | Naming term from the realm's leading crafts, places and coast                            | M6        |
| L16 people-built passes                     | Restore                                                                           | New catalogue entry; Movement costs read by `travelFriction`                             | M7        |
| L17 `marketTravel`                          | Delete unless M7's exchange work uses it                                          | —                                                                                        | M7        |
| D1 seeking                                  | Build                                                                             | `draw` responder from crafts and their medium; Fire people leave sealed veins            | M7        |
| D2 hazards where magic systems meet         | Build                                                                             | `harm` responder from the inert confluence hazard settings                               | M3        |
| D3 institutions and cultural origins        | Build                                                                             | New catalogue entries on their registered layers                                         | M6        |
| D4 administration districts                 | Build                                                                             | Publication of each held town's district on the registered layer                         | M5        |
| R1 survivors flee                           | Restore (owner)                                                                   | Flee operation                                                                           | M5        |
| R2 hunting and fishing deplete              | Restore (owner)                                                                   | `taken` question, ecology owner writes the stocks                                        | M4        |
| R3 per-people traits                        | Stay deferred                                                                     | —                                                                                        | —         |
| R4 drawn records acting                     | Stay deferred                                                                     | —                                                                                        | —         |
| R5 skill raises yields                      | Stay removed: magic is no yield bonus                                             | —                                                                                        | —         |

The place offers field and the `draw` question come first (M1). Every later milestone
contributes to them, so M2 to M7 depend on M1's contract even where the plan lists M0.

## Milestones

Every milestone follows the same checks:

- **Unit tests** on small supplied fields for each new operation and question.
- **One run of the kept world** per milestone, read as a cartographer reads it, using the
  place listing, the realm and territory layers and the population raster.
- **No numeric targets,** and no refinement or city runs.
- **Before each commit:** a read-only review by subagent against this plan.

### M0 — Verdicts and contract

**Scope:**

- Write a verdict for every L, D and R row. For each, name the field, shared question or
  catalogue slot that will carry it, or mark it dropped with its reason.
- Name each new shared question and contract slot, with its writer and its readers.
- Record owner answers to the decisions.
- No code.

**Acceptance:** every row has a verdict and a home. The owner has seen the verdicts that
reinstate or drop behaviour.

### M1 — Places draw people [depends on M0]

**Scope:**

- Offers gain a reach and a beneficiary, and threats gain harm modes. Existing answers are
  extended; entries without a beneficiary serve everyone.
- The era's place query projects offers and threats into benefit and threat bands. It is the
  only code that reads the catalogue for people.
- People's needs table values each benefit by whom and by circumstance, and answers the
  `draw` question from the benefit bands. The gathering step reads `draw`.
- Seats offer power to their realm. Each entry's offers are checked so seats, harbours,
  crossings, passes, sanctuaries, fortresses and magic seats say what they give; food and
  water offers are checked against the yields.
- A town's crowd draws more than in proportion to its size.
- Earlier ruins and standing works draw founders back (L2).

**Acceptance:** on the kept world:

- the largest towns sit at seats, harbours, crossings and magic seats, as well as on the best
  farmland;
- a seat that moves takes people with it over the following eras;
- abandoned towns are resettled on their ruins when the country recovers.

#### M1 execution

Sulion: milestone `5f5b0f89-b8f7-4307-8038-366ca1c2dc12`; expansion
`c9aaf266-b6ce-4bd7-96e7-4e9aa796a3f8`.

1. **Offers name whom they serve.**
   - `Benefits` becomes a type that still reads like the benefit map, plus an optional
     beneficiary (a tradition and its code).
   - A capital's power serves its realm, a shrine's sanctity its faith, and a forge's power and
     materials the Fire craft.
   - Every other entry is unchanged and serves everyone.
2. **The era's place offers.**
   - `field/poi/offered.rs` finds every entry's places with `places_of`. It adds each offer's
     strength on the place's cells, multiplied by the share of the cell's people it serves.
     It spreads each threat's severity over the cells within its reach.
   - The bands are held on the field, rebuilt by a `human.place-offers` step at the start of
     every era.
3. **People's needs and the draw question.**
   - `field/people/needs.rs` holds the needs table and answers `draw`:
     - base: the cell's people;
     - addition: ruins' remains as the crowd they once housed;
     - scale: `1 + Σ need × offer`.
   - Gathering's drain spreads `draw` instead of raw people. It weighs each cell by its
     concentration above the country around it, so pull grows faster than size.
4. **Checks.**
   - Unit tests on valuation, serving and the concentration weight.
   - clippy and the touched tests.
   - One kept-world run read through the place listing.
   - A read-only subagent review, then commit.

**Deviations from the M0 contract, with their evidence:**

- **Offers gain a beneficiary but no reach.** Gathering already spreads pull over the people's
  travel reach, so a place only needs to say what it offers on its own ground. A second reach
  per offer would duplicate that spreading.
- **A ninth word joins the vocabulary: rule.** In the catalogue, power means mills, falls,
  dams and furnaces; town development reads it as production. A seat's authority is a
  different benefit, so capitals offer rule to the realm they govern (found from the realm's
  seat record, not their cell's majority). Town development reads rule as an institution.
- **People feel every place that is present, published or not.** The realization gate kept
  harbours, shrines, forges, mills, fords, bridges, mines, archives, irrigation, clearance and
  dams off the world map, so the eras never saw them. `realized::present` counts those works
  everywhere and keeps every other gate, so landforms below a map's significance still don't
  exist there.
- **Offers in water reach the shore.** A harbour stands on a sea cell, so its offer goes to
  the dry cells beside it. Each offer is felt most where the place's people gather.
- **Offers multiply per benefit.** This copies the old site draws: a seat that is also a
  harbour draws like both, and a benefit offered everywhere scales everyone alike. A first
  additive version let common offers swamp rare ones, so the average draw ran 17 times the
  people.
- **Markets order food for those a place draws.** Arrivals were bounded by the food their
  markets commissioned for the crowd already there, so pull could not grow a seat. The demand
  now uses the people raised by their relative draw against the country around.
- **Harm modes move to M3,** their first consumer. M1 reads one threat band, which only sets
  how much defence is wanted.
- **Ruined works join ruins' remains** in the latent crowd that draws people back.

**Evidence:**

- **Checks:** unit tests on valuation, multiplication, threat saturation, serving, relative
  draw and concentration weight; clippy with warnings as errors; the architecture checks.
- **Trace of the era's offers** (`ATLAS_TRACE_PEOPLE`), from the last era of a full draft
  world: 25 settlements (5 capitals with rule), 6 harbours, 28 forges, 59 shrines,
  2 dams, 14 passes and 26 volcanoes all offer.
- **Trace of the strongest draw:** on the world map the densest cells hold 250–380 people
  per km² against 110–175 in the country around. Relative draw reaches 1.5 at the strongest
  place and 1.1–1.3 at capitals and harbours.
- **Town listing:**
  - Rivassanrema's spot grew from 530k to between 606k and 734k across runs.
  - Capitals keep their rank, ±20%.
  - Sakohe's capital fell from 378k to 141k, because a seat founded elsewhere took its rule.
- **Verdict on acceptance: PARTLY.** Places now pull people and their pull reaches the food
  supply, but at world scale they shift sizes modestly rather than reorder the towns. A world
  cell holds a city as a share of 200 km², and the arrivals a market orders stay bounded by
  the country around. The pull strengths are starting values in the needs table, to tune
  from how maps look.
- **Left to M5:** seat moves and resettling ruins under control.

### M2 — People and ideas travel beyond the next cell [depends on M0]

**Scope:**

- Migration chooses destinations within the travel reach, across water and along ways.
- Contact for tongues, faiths and customs reaches along the same reach.

**Acceptance:**

- an island emptied after founding is resettled;
- coastal places across a strait share tongue or faith more than places the same distance
  apart overland with no way between them;
- ways carry identity between towns that do not touch.

#### M2 record

**What was built:**

- **Movers choose along a route.** From each inhabited cell, a route climbs a guide field
  across any ground travel allows, water and worn ways included: pull for the drain, spare
  food felt over the reach for the spill. Every dry cell on it is a candidate beside the
  neighbours.
  - A route's steps add their costs in ranges before decaying, as one journey of that length
    would (`reach::ranges_of`, `passed_over`). It ends where the going passes on less than a
    tenth.
  - Arrivals are admitted at the actual far target.
  - The cells between a journey's ends are worn into ways by its admitted travellers.
- **Tradition pressure spreads over the same reach.** Tongue, faith and custom spread
  through `Passage::reach_each`, the shared reach for values that are not one number. Each
  cell keeps its own tradition in a reserved slot and resists with it, felt over the same
  reach. It feels the three strongest others.
- **One sweep count.** `REACH_SWEEPS` replaces the literal 48 in food, crowds, places,
  contact and routes.

**Evidence:**

- Unit tests on route decay and carried pressures.
- Clippy, and the architecture checks.
- A full draft world: in one move, 5,763 of 7,290 arrivals came from beyond the next cell
  and 4,695 crossed water (`people.journeys`, counted after admission). The largest town is
  a capital at Rivassanrema's old spot, 733k.

**Deviation:** links that skip cells (Veil doors) are not yet in the going. Backlog 12
already lists doors carrying tongues and faiths as open. They join with the catalogue's
road and boat costs in M7, where Movement costs reach travel.

**Not observed:** whether a particular emptied island was resettled, or whether coastal
places across a strait share traditions more than overland ones. The traces show the
journeys and contact happening; no named island or strait was followed.

### M3 — Ground that harms or refuses people [depends on M0]

**Scope:**

- The shared habitability question, answered by water, ice and magic media (L4).
- Catalogue threats contribute to harm, including hazards where magic systems meet (D2).
- The Pressure crush zone cuts coastal catch (L5).

**Acceptance:** no one lives in Fire cores, under thick ice or in strong Quickening and
Stillness. People thin near magic meetings that threaten them, and their record names the
cause.

#### M3 record

**What was built:**

- **`livable`.** A shared question whose base is dry ground. Fire (Quickening) and Aurora
  (Stillness) take it away as their medium passes 0.6, and all of it at full
  (`magic::responders::left_to_the_living`). It is read by founding, growth, spill, drain and
  the inherited placement on refined maps.
- **Magic meetings strike.** A meeting with hazard settings strikes the living places on the
  ground it covers, at its own yearly rate and severity, scaled by how much of the place it
  covers. The strike is recorded as an event of the meeting's own kind and cause. The map
  state gains `meeting_hazards()` to read them.
- **Pressure's crush cuts the catch.** Where the Pressure system's intensity reaches 360
  thousandths, boats keep three tenths of the shore catch: the old society cycle's rule.

**Deviations, with their reasons:**

- **Catalogue place threats raise the defence need but do not strike.** Most of them
  describe a hazard the land already strikes: a peak's avalanche, a harbour's tsunami, a
  river's flood. Disaster sites also threaten from the events they record, so striking with
  them counted dangers twice and fed back each era. That first version raised events from 14
  to 271 and cut settlements from 25 to 20. The old cycle struck with the land's hazards and
  the magic meetings, and so does this.
- **No `harm` responder for threats.** `harm` is a vulnerability multiplier that also
  deepens hunger, so a threat added there would starve people near every hazard. Strikes
  carry the danger instead.
- **Harm modes stay unbuilt.** Meeting strikes wear through one shake-and-burn mix, as the
  land's upheavals do, until a meeting's hazard states its own way of harming. `Hazard`
  gains modes when a consumer needs to tell them apart.
- **Ice is left to the harvests,** which already shrink under it. Counting it again in
  `livable` starved icy margins twice.
- **The crush cut reads the Pressure system's intensity, not "dangerous sea" places.** A
  first version cut the catch under every sea-group place's hazard, headland wrecks and
  strait races included; settlements fell from 24 to 20.
- **City growth on city maps does not read `livable`.** City maps are part of the paused
  refinement work.

**Evidence:**

- Unit test of the refusal curve; clippy; the generation test suite.
- A full draft world with this milestone alone (ecology ablated):
  - 23 settlements, 14 ruins, 18 events.
  - Two meetings strike per era (thermal fracture over 3 cells, a Pressure ice breach over
    1).
  - 19 dry cells are fully refused, with no one left on them.

### M4 — Living land through the human eras [depends on M0; DECISION R2]

**Scope:**

- Ecology advances during human eras (L6).
- Clearance changes soil water and Greenwood (L7).
- If accepted, hunting and fishing wear down game and fish, and that changes what the wild and
  the shore feed (R2).

**Acceptance:**

- forest returns on farmland abandoned in an earlier era;
- a long-farmed country holds less game than an untouched one;
- people respond to both in later eras.

#### M4 record

**What was built:**

- **The ecology runs in every human era.** The existing `ecology.human-time` step was built
  and never called, in the archive as in Rust. It now runs after people work the land, over
  the era's years, under the era's own physical epoch.
- **People answer four shared questions** (`field/people/land_use.rs`): `cleared` (fields and
  buildings), `grazed` (pasture), `hunted` (people who live on the wild) and `fished` (shore
  people).
  - Ecology's steps ask them through projected queries and pass the answers to the forcing.
    Ecology names no human layer, and a craft could break any of the four.
  - Refined maps develop without them, so refinement is unchanged while it is under review.
- **Vegetation:** suitability falls with the cleared share. Trees cannot take fields,
  buildings or pasture; grass keeps pasture.
- **Animals:** game falls with hunting after it grazes (`exp(−hunted × years / 150)`, the old
  cycle's rate). Fish fall with fishing after they regrow, so the take lasts the era.
- **People's food reads cover on the ground it grows on.** Ecology's tree and grass cover now
  fall with the fields, so wild food, herds and the woods' cost on crops read cover per share
  of wild or open ground. Without this, clearing was counted twice and fed itself until cells
  were fully farmed.

**Deviations:**

- **Soil water and Greenwood follow through their existing owners only.** Infiltration and
  evapotranspiration read cover, and Greenwood sources need canopy and canopy age, so cleared
  groves stop being sources. The old cycle also returned groundwater to the soil and drew
  Greenwood sap by the cleared share; neither is rebuilt here. During present eras no water
  step runs, so soil water follows only in the next epoch.
- **Hunting is felt per era, not as a loss in game's regrowth.** Each era leaves game below
  its carrying level by that era's take.
- **The era step reads its years from the era**, not from a duration binding.

**Evidence:**

- Unit tests on clearing shares, the take and how many hunt.
- Clippy, the generation suite and the architecture checks.
- A full draft world (with M5 also in the tree):
  - Forest biome regions fall from 5 to 2. Dense countryside on a world map is nearly fully
    farmed, and the living land now honours that.
  - Four of the five largest towns are capitals of 256k–455k; the largest, a market town,
    holds 531k.
  - The world holds 4.85M people, against 5.70M when food read cell-wide cover (the double
    count) and 5.43M before this milestone. Reading wild food per share of wild ground makes
    uncleared land worth more, so people clear more slowly. It also restores the woods' cost
    on crops that held before this milestone.

**Not observed:** forest returning on a named abandoned field.

#### M5 and M6 record

M5 and M6 share the realm-strength code and are committed together.

**What was built (M5):**

- **Realm health.** It moves over 80 years toward `fed × (1 − 0.75 × declined)`. Here `fed`
  is the share of the realm's people its land feeds, and `declined` is how far its towns
  have fallen from their peak. Strength is multiplied by health. A successor begins at the
  old cycle's 0.65.
- **Seat moves.** A seat moves to a town of its own allegiance 1.5× larger than it, and the
  move is traced.
- **Contests.** A runner-up within 0.8 of the holder is recorded as `contestedBy` on living
  towns.
- **Unheld ground.** Ground no realm reaches forgets its realm at the pace held ground takes
  one up, so allegiance shrinks with reach.
- **Sieges.** A town taken by a living realm from another is besieged. Wear runs at six to nine
  tenths magnitude, divided by (1 + its defence offer). Two exceptions:
  - an ended realm's towns pass on without a fight;
  - a town that rises to seat a realm of its own is not besieged.
- **Survivors flee.** After every strike and siege, 0.6 × severity of the survivors move along
  the going (travel cost, links included) to the reachable cell with the most room. Room
  is reckoned as growth reckons it. Every mover is admitted in the same proportion. The event
  records how many fled and the town they reached.
- **Other restored mechanisms:**
  - ruins draw founders back where a realm holds the ground;
  - regional capitals follow the old rule: two towns of their realm within 0.0375 of the span,
    none larger, none a seat;
  - administration districts are published as `jurisdiction` on `administration`;
  - each realm carries the old collapsed / fragmented / active status.

**What was built (M6):**

- **A known tongue on every identity layer.** Contact teaches its tongue: two thirds of those
  it reaches come to know it, and the rest take it up and keep their old tongue as known.
  A known tongue fades over 300 years where under 1% of the people on and around the cell
  speak it (`field/people/speech.rs`).
- **A tongue in common cheapens travel.** `travelFriction` gains a responder: up to 0.3 off
  where the people understand the tongue spoken around them. Linguistic frontiers slow
  contact and realm reach.
- **Institutions** (`field/poi/institutions.rs`). Every town of 8× the least town keeps a
  meeting house. It offers:
  - sanctity to its faith;
  - trade to its tongue's speakers;
  - 0.1 × size of rule to its realm.

  Realm strength gains the rule its towns other than the seat give it, as the old
  institutional influence did.
- **Cultural origins.** Each living tongue and faith has a hearth at its founding origin. The
  hearth offers sanctity to its people.
- **Realm character in its name.** At publication a realm's name ends in a word chosen in this
  order:
  1. a craft a third of its people keep: the old Hold, Conclave and Covenant, with Circle,
     Compact, Oath and Threshold for the later crafts;
  2. otherwise a livelihood half of them live by: Commonwealth, Horde, League or Confederacy;
  3. otherwise Concord, where three tongues are in common use.

**Deviations:**

- **Crowding is folded into the fed share**, not a separate divisor on reach.
- **Ruin is read as decline from the towns' peak**, not as a ruined share of places.
- **Sieges change no ground.** Their works damage is the wear on the standing layer; the
  catalogue's event command is not called for them. Walls are counted twice: once through
  the defence offer and once through standing's resistance to wear.
- **Survivors go to the cell with the most room**, not to a neighbouring town.
- **Fishing and gathering in a realm's character** are estimated from coastal cells and
  unworked ground, until yields expose their sources.
- **District names** are the realm's name; districts are written before towns are named.

**Evidence:**

- Unit tests:
  - flight admission;
  - realm term, status and renaming;
  - speech in use and understood across a frontier;
  - an overlay clearing allegiance;
  - health holding.
- Clippy, the touched suites and the architecture checks.
- One draft world, before the speech fix:
  - 4 realms, three named Oath and one Commonwealth;
  - 13 institutions and 22 hearths;
  - two seats moved to towns that outgrew them;
  - two sieges, one killing 39,833 and sending 114,285 to a nearby town;
  - floods recording where survivors went.
- That world's tongue trace showed the forgetting defect that `speech.rs` fixes: tongues
  were judged by the learner's own cell, so a frontier forgot its neighbours' tongue within
  the era. The fix is unit-tested, not yet seen on a world.

### M5 — Realms rise and fall with their people [depends on M1; DECISION R1]

**Scope:**

- Realm strength from support, ruin, crowding and institutions (L8).
- Contests and fragmentation recorded (L9).
- Uncontrolled land under weak reach.
- Seats move to a much stronger town (L10).
- Ruins under control resettled, after confirming the old behaviour (L11).
- Sieges with casualties, ruin and damaged works, and survivors if accepted (L12, R1).
- Regional capitals (L13).
- Administration districts written to their registered layer (D4).
- Defence offers lower harm in sieges.

**Acceptance:**

- a realm whose land fails loses reach in the next era;
- its frontier towns change hands, with casualties and survivors in their records;
- a large rich town can draw a seat to itself;
- the administration layer shows districts.

### M6 — Language and culture as working systems [depends on M2]

**Scope:**

- Known and used shares per tongue, with forgetting (L14).
- Shared tongue cheapens contact and realm reach.
- Institutions and cultural origins as catalogue places on their registered layers (D3). They
  carry tongue and faith and add to realm strength.
- Realm character in its name (L15).

**Acceptance:**

- multilingual frontiers appear, where a tongue is known but not used;
- a realm reaches further through people who share its tongue;
- the institutions layer has places whose records say what they carry.

### M7 — Practice, access and exchange [depends on M1, M2]

**Scope:**

- Seeking (D1): people and realm reach favour country their crafts suit, as a contribution to
  the draw question.
- Fire people leave sealed veins.
- People-built passes as a catalogue entry, with their road saving read by travel (L16).
- `marketTravel` either drives way traffic or is deleted (L17).
- Re-scope backlog 29's exchange beyond food with the owner, if M1's trade offers leave it
  open.

**Acceptance:**

- crafts cluster where their medium lies and move with it;
- a pass that people cut changes the roads and towns on both sides.

### M8 — Durable record [depends on M1–M7]

**Scope:**

- Update ADR 0012 and the generation workflow guide to the mechanisms as built.
- Close the verdict table.
- Move anything still open to the backlog.

**Acceptance:** the documents describe the running code, and no checklist row is left without
a verdict.

## Technical details

**Owners and callers:**

- **The people pass:** `field/people/pass.rs`, which calls found, learn, feed, grow, gather,
  harden and dwell.
- **Questions:** `field/people/questions.rs` and `answers.rs`, where `ResponseKind` is Base,
  Add, Scale or Break.
- **Catalogue contract:** the People role (`offers`, `threatens`) in `field/poi/contract.rs`,
  with `catalogue.rs::offers_for`.
- **Travel:** `field/people/travel.rs` and `reach.rs`.
- **Identity:** `identity_era.rs` and `identity_sunder.rs`.
- **Realms:** `realm_era.rs` and `realm_seats.rs`.
- **Hazards and events:** `land_events.rs` and `events.rs`.
- **The era sequence:** `atlas/sequence/people.rs`.

**Pattern:** Dependency Inversion through the existing question book.

- Places, magic and terrain contribute Add, Scale or Break answers.
- The pass and the realm, identity and event steps only ask questions.
- A new force is a new responder, not an edit to its consumers.
- The catalogue stays the one place a kind of place is defined, so its pull and threat live
  in its entry.
- **Cost:** answering the draw and habitability questions over every cell, every pass. They
  are cell-local or reach-based, like support and travel.

**Uncommitted work in the tree** (another plan's, kept as is):

- the refined-map people change;
- the trace logging;
- the harness place listing with built area;
- the crash-handling work.

## Sulion mapping and current state

- **Root:** `73694486-64f5-447c-bed1-08aa63983d35` (Society restoration: the census answers
  to every force).
- **Phases:** M0 to M8, all pending.
- **Next action:** M0 verdicts, and the owner's answers to the R1 and R2 decisions.
