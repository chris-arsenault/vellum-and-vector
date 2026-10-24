# Four-pillar interconnection — working design

Status: workshop draft, 2026-10-23, second and third passes added the same day;
fourth pass (where the magic went) and the presentation delivery the same day;
fifth pass (per-system world design, retune and couplings, implemented) on
2026-10-24. The document started as **design only**. Two chunks have since been
implemented under explicit instruction: the magic presentation (phase 3) and the
magic chunk (phases 4, 5, 6 and 8; see the fifth pass). Society, the ice-age
round and the non-magical couplings (phases 7, 9 and 10) remain design. The
third pass (scale contract) is an input gathered ahead of several other
features; it is not an implementation step.

## Goal and boundaries

The four pillars are **society, magic, climate and geology**. The primary goal
is to make their interactions generate a world whose causes are apparent from
the map itself. A dam should visibly impound water; a powerful Fire wellspring
should make an otherwise cold landscape visibly alive; people should settle,
travel and work differently because of both the magical geography and the
established biomes. A large Pressure front should be capable of changing
climate, not merely decorating the ocean.

This is a **generation and world-design** problem. Labels, tooltips and
inspector prose are not substitutes for convincing geography. In particular,
neither equal numerical contributions from four systems nor four differently
colored overlays would achieve the goal. Ecology is the living response
through which several of these interactions become visible; it is not a
renaming of the four pillars.

User corrections that govern this draft:

- Fire is a **magical wellspring of life and heat**, not simply a geothermal
  anomaly. It can transform local climate and living geography well beyond
  the direct effect of warming air.
- Aurora and Pressure also need meaningful, distinct effects on ecology.
  Remove generic "altered" plants, cover and biome descriptions; identify
  actual kinds of landscape produced by their causes.
- Society must respond to the presence of magical systems and to the biomes
  already on the map. Repeated interaction should affect where people live
  and what they build, not merely add labels to preselected settlements.
- Climate and geology are distinct pillars. Do not replace them with a
  single "physical processes" category.
- Visual inspection of the generated map is decisive. Prioritize what the
  processes actually make rather than apparatus for explaining the result.

Existing project boundaries still apply: the active atlas is browser-only;
generation uses shared TypeScript processes in a worker, and authoring and
refinement must not lose protected geography or spatial consistency. The
three existing magic systems are first-class, with their own media and
behavior. Future systems remain open without forcing the current three
through an interchangeable effect menu.

## Starting conditions

These are current code observations, **not** a declaration that the behavior
below is already implemented:

| Area                       | What exists                                                                                                                                                                                                   | Missing connection                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Magic → ecology            | `canonry/ecologyProcesses.ts` translates magic into generic ecological coefficients. Fire sets a fire effect; Aurora and Pressure do not set ecological effects in `packages/domain/src/magicPresets.ts`.     | Fire lacks a magical life-generating ecology; Aurora and Pressure have no distinct living landscapes.                               |
| Ecological identity        | `canonry/ecologyMagic.ts`, `ecologyGroups.ts` and `ecologyEnvironment.ts` contain an "altered" plant group and altered biome categories.                                                                      | The result says _changed_ without depicting what the system actually did.                                                           |
| Magic → climate            | Fire contributes heat. Aurora currently uses cold terrain and ice; Pressure supplies coastal forcing.                                                                                                         | The return effect of large magical fields on climate, especially a Pressure front, is not designed as a coherent landscape process. |
| Climate, geology → magic   | Fire follows fractures, Aurora follows cold and ice, and Pressure follows connected deep ocean. Magic already contributes heat, rock resistance and coastal forcing.                                          | These interactions need to produce convincing adjacent ecological and social geography, not merely magic fields.                    |
| Biomes and magic → society | `societySupport.ts` samples temperature, water, soil and existing plant quantities; `societyMagic.ts` handles particular practices. Society now has repeated environmental feedback in `societyEvolution.ts`. | Settlement and livelihoods do not respond adequately to _which_ established biome or magical place is present.                      |
| Society → landscape        | Works can change vegetation, landform and water, with a focused environmental refresh.                                                                                                                        | The resulting lake, cleared land, changed coast or resource landscape must be geographically legible at map scale.                  |

The open magic–ecology gap and unconvincing vegetation and disturbance in
[backlog item 10](backlog.md) belong to this discussion. A biome name must
follow an actual generated ecological condition, not disguise missing cover,
disturbance or water behavior.

## Map behavior to design

The following specifies required **connections** and candidate **expressions**.
Only the requirements in the preceding section are settled. Names, shapes,
strengths and the precise ecological behavior of Aurora and Pressure remain
workshop proposals.

### Fire: warmth _and_ magical life

**Process proposal:** fracture-fed sources and their veins produce two coupled
but distinguishable influences: heat that changes air, ice and water, and
magical vitality that changes establishment, growth, survival and animal
habitat. Warming alone must not account for the entire living response. Heat,
water supply, terrain and strength of the wellspring shape which plants can
establish; vitality should not make an ice-covered cliff into an arbitrary
forest. Steam, springs and thawed drainage can carry the influence along
recognizable geographic paths. Strong sources may affect atmospheric movement
and precipitation where the generated climate supports that response.

**Visible result to seek:** a powerful wellspring interrupts a cold or sparse
region with a substantial, varied living landscape. Hot springs and wet
ground differ from dry basalt; productive groves or grasslands follow viable
water and terrain rather than concentric color bands. Veins can connect
otherwise separated pockets of life. The inner area may be too hot or
unstable for ordinary vegetation, making the gradient more interesting than
"stronger Fire means uniformly more trees." Animals and people have usable
reasons to gather at the viable edges.

**Still to decide:** what magical vitality specifically does to plant and
animal ecology, how its reach differs from heat, and what kinds of exceptional
life fit the atlas without importing named Canonry setting species.

### Aurora: cold storage, perception and living response

Aurora's established behavior follows colder terrain, accumulates in thick
ice and weakens rock. Its social medium is charged crystals and access to
ice-memory, not general-purpose energy or a fertility bonus.

**Candidate process:** let Aurora intensity and retained ice affect the
thermal and growing environment _if_ this can be reconciled with its
cold-seeking source behavior. Couple cold persistence, altered rock stability,
water release at melt margins and specific plant or animal adaptations to
the existing ecological processes. Cold land need not mean lifeless land:
consider an ice-edge or melt-line living community rather than a generic
"altered forest." A potential atmospheric cooling effect is a proposal to
evaluate, not an agreed property of the system.

**Visible result to seek:** ice fields, broken rock and distinctive living
fringes form a geographic pattern with viable archive/crystal sites and
different travel and settlement choices around its edges. Do not make all
Aurora terrain uniformly frozen, uniformly habitable or uniformly barren.

### Pressure: deep-ocean force with a climatic reach

Pressure originates in deep water and travels through connected ocean, with
reflection, focusing, wakes and coastal stress. Its societal use depends on
reachable depth and carried charge.

**Candidate process:** a strong Pressure front changes the ocean surface
conditions encountered by climate, instead of applying a coastline-only
terrain modifier. Possible manifestations to resolve in the workshop are
forced ocean mixing and cool upwelling, persistent mist, wind and storm
convergence, or wave spray affecting nearby land. Choose mechanisms that
follow the field's paths and the world's bathymetry and winds; do not assume
that every Pressure zone causes every kind of weather. Coastal erosion and
inundation alter suitable habitat. In the sea, distinguish destructive
crush zones from potentially productive mixing or refuge waters.

**Visible result to seek:** an ocean front has a shape in sea conditions and
weather, a discernible reach onto particular coasts, different marine
ecologies on and beside it, and corresponding sheltered and exposed
settlement patterns. It must not read as an arbitrary fog circle or an
ordinary storm with a magical name.

### Climate and geology keep doing work

Geology gives these systems material paths and barriers: fractures and
conductance for Fire, rock and relief for water and ecological niches, and
depth and coast geometry for Pressure. Magic, water, weather and society in
turn shape the visible land and shoreline where the corresponding processes
permit it. Climate makes Fire, Aurora and Pressure consequences travel or
stop in plausible places; mountains, prevailing winds, drainage and connected
ocean prevent each influence from looking like a radius stamp.

The design should use existing terrain, atmosphere, water, ecology and magic
processes where they fit, then add system-specific operations where those
processes cannot produce the intended world. Do not redesign crust generation
or create a general climate engine solely to deliver this interaction work.

### Society responds, then changes the geography

Existing biome conditions should influence livelihoods and movement, not
just settlement color: fertile wetlands, grazable open country, forest
resources and thin-soil rocklands support different populations and works.
Magical geography adds distinct opportunities and constraints: viable Fire
wellsprings support concentration and routes; Aurora crystals and cold
preservation support located practices while limiting some livelihoods;
Pressure fisheries, diving access and exposed coasts lead to different
maritime settlement decisions. A society may exploit or protect such places
without every exposed group acquiring the same culture or practice.

Society feeds back through real works and use: a dam changes flow and
impounds a connected lake; clearance changes vegetation and habitat; Fire
core use can create local heat and consume a finite supply; harbors and
shoreline works change exposure to Pressure. The lake must visibly sit
upstream of its dam, not just be a nearby polygon. These environmental
changes must enter subsequent settlement, route and livelihood decisions
rather than being decorative end-of-run outputs.

## Second pass: layered coupling across all four pillars

Canonry's physical/magic coupling is the template for every pillar pair. Its
rules, restated for the atlas: a system acts through its own medium
(fractures, ice, connected ocean); it writes into shared physical fields that
the ordinary processes already consume (heat forcing, rock resistance, coastal
forcing); the physical processes keep doing the erosion, flow and
classification; each epoch interleaves the systems in causal order; the next
epoch inherits the result with the crust. Magic shows in the shape of the land,
not only in its colour, and a feature stays tied to the conduit, ridge or basin
that caused it rather than to a field threshold.

This pass extends that pattern to ecology and society and adds one human round
before the last geological epoch. Everything below is a proposal unless marked
as a user requirement. Fire as a wellspring of life and heat is a user
requirement; the particular behaviour called "quickening" is one reading of it.

### Fire: the quickening

**What it is.** Fire is living heat rising through fractures. Where it reaches
the surface it warms and it _quickens_: every living process near it runs
faster. Plants establish where the latitude forbids, grow fast, mature early,
seed heavily and die young; dead matter decays within a season; animals are
fecund and crowded. Heat and quickening are two influences with different
reach. Heat travels in air, water and steam, so it spreads with the wind and
down the drainage. Quickening stays with the conduit and the ground it has
warmed; it does not blow downwind.

**Shape on the map.** Three shapes, none of them a circle:

- Ribbons along fractures: green strips across tundra, narrow at a vein and
  broad at a core.
- Tongues down rivers: thawed water runs downstream from halos and springs,
  so a river below a wellspring stays open all winter and carries reeds, fish
  and waterfowl far beyond the heat.
- Plumes downwind: rising moist air over a strong core drops rain on the lee
  slopes, so the downwind side is the wet, wooded side and the snowline lifts
  on the warm side of a range.

Gradient outward from a strong core: heart (vents, sinter terraces, boiling
pools; too hot for ordinary plants; mats and heat-loving scrub), ember grove
(dense fast-growing broadleaf and reed; thick fast dead fuel, so natural fire
runs through every few decades and the grove regrows at once), long-season
country (grassland and open woodland with the herds of a cold world crowded
onto it), fringe (regional climate resumes). Veins repeat the sequence at a
small scale.

**Fire and geology.** Fire hardens rock (existing). Two additions: flowing
Fire keeps its conduit open, so conductance along an active vein rises slowly
each epoch; a conduit that has carried Fire to exhaustion seals with sinter
and basalt, so conductance collapses and the vein beyond it goes cold. This is
the geology that people will later exploit.

**Fire and climate.** Heat forcing (existing) plus a moisture source and a
rising-air term where intensity is high, so the ordinary climate pass produces
the plume and lifts the snowline instead of drawing a warm disc.

**Fire and ecology.** Quickening enters the ecological processes as its own
forcing, replacing the generic coefficient set: establishment and growth up,
lifespan down, decay up, fecundity up; a heat ceiling above which establishment
fails; fuel accumulation feeding the fire regime. Candidate names: sinter
terrace, ember grove, thaw meadow, warm-water reach, hot-spring fen.

**Early people and Fire.** In the cold age, Fire country is the only
dependable warmth and the only dependable green. Hunter-fisher bands settle at
the edge of halos and along tongues, never in the heart. They:

- Hunt the crowded herds on the ribbons. Over-hunting collapses a herd; without
  grazing, the grove closes over the grassland.
- Burn the groves to open them for game and travel. Under quickening the burnt
  grove returns as fire-adapted grassland that natural fire then keeps open.
- Dig into veins: pit-houses on warm ground, quarries for fire-cores (existing
  practice), and tapping, which opens a fracture or cracks a sinter plug so that
  Fire rises nearer the surface. Tapping raises local conductance; the halo
  grows; ice melts into a thaw lake; the ribbon reaches further. Heavy tapping
  exhausts the segment: it seals, the halo retreats, and a basalt scar with
  ruins is left.

**Propagation to the present.** Conductance changes travel with the crust like
magic history. In the present epoch Fire propagates further along an ice-age
tapped vein and not at all through a burnt-out one, so the present halo pattern
carries the shape of ice-age work: an extended green tongue with a ruin field
at its root, and a bite in the ribbon beyond it. Thaw lakes in ice basins drain
or remain as peat fens after retreat. Burnt grove stays grassland only where
fire or grazing kept it open. Present societies find the made wellspring, the
ruins and the larders, and settle on them.

### Aurora: the stillness (proposal)

**What it is.** Aurora gathers in cold and holds things still. Ice that holds
it does not melt when the climate says it should; rock under it goes friable
and shatters (existing); living things in it slow until they neither grow nor
die. Lichens take centuries; trees stand in rime longer than their kind should
live; carcasses and wood do not rot.

**Aurora and climate.** Charged ice is colder than its latitude and exhales
clear, dry, sinking air: a katabatic wind runs off the field and makes a dry
cold shadow downwind, the inverse of the Fire plume. Mechanism: Aurora writes
negative heat forcing and an ice-persistence term; the ice model respects
retention; the after-glaciation climate pass runs after Aurora instead of
before it. No new climate engine.

**Aurora and ecology.** Preservation as its own forcing: establishment,
growth and decay down, survival up. Standing biomass persists without
turnover. Candidate outcomes: rime forest at the field margin (old trees, no
saplings), glow-lichen barrens on prism scree, melt-line fen where seasonal
melt releases centuries of preserved matter in one pulse (the one rich strip,
and the one place people live), carcass fields that feed scavengers. Nothing
inside the field is farmable.

**Early people and Aurora.** Crystal harvest on prism ridges, cold larders
that keep food for decades, ice-reading. Exploitation: quarrying prisms removes
the reservoir, so that ridge's Aurora capacity falls, its ice melts on the
ordinary schedule and the melt line moves; the quarried ridge, already
weakened, fails into scree fans.

**Propagation to the present.** Relict Aurora ice survives the warm present
only where retention held; quarried ridges are the gaps in it, with scree fans
and melt channels below them. Larders become archive sites that present
communities seek out.

### Pressure: the weight that moves water (proposal)

**What it is.** Pressure is force from the deep. Its rays, reflections and
focusing are already modelled. What it does to the world is move water: a
front lifts cold deep water to the surface (upwelling), piles surface water
against the coast it strikes (set-up and surge), and leaves a calm, stratified,
warm dead layer in its wake. Crush zones are dead seabed.

**Pressure and climate.** Pressure writes a sea-surface temperature anomaly
(cold where it upwells, warm in wakes) and a fog and moisture source over the
upwelling band. The climate pass then produces cool fog coasts where a front
lands and storm convergence where rays interfere. Mechanism: Pressure runs
after ocean geometry and currents are set and before the epoch's climate pass,
instead of after glaciation. Its coastal forcing still feeds the coasts at the
end of the epoch. Only fronts above a strength threshold write weather, so
weak rays stay invisible in the sky.

**Pressure and ecology.** Upwelling bands are the fisheries (a nutrient
forcing in the marine ecology); crush zones are barren; lattices are rough
reef and kelp water; wakes are empty warm water. On land, scoured coasts and
salt marsh behind surge lines; fog heath and moss forest where fog lands.

**Early people and Pressure.** The ice-age coast lies forty metres below the
present one. Fishers work the upwelling coasts; divers settle where deep water
lies close inshore; both build weirs and breakwaters in sheltered bays.

**Propagation to the present.** Sea level rises and drowns the ice-age coast.
The weirs and breakwaters become shoals, and shoals reflect rays. The present
Pressure field is therefore shaped in part by ice-age shoreline work: a drowned
weir line focuses a front onto a coast that would otherwise be calm, and that
coast gets the upwelling, the fog and the fishing town. Over-fished runs
recover across the epoch unless the stock was extirpated.

### Non-magical couplings at the same fidelity

- Ecology → geology: vegetation cover damps hillslope flux and sediment
  yield; cleared or burnt land gullies and its deltas grow; peat and reef
  build material.
- Ecology → water: wetlands and peat hold water and flatten floods.
- Climate → ecology → climate: seasonality and moisture set cover; cover
  feeds back only through erosion and water. Albedo and evapotranspiration
  feedbacks are excluded as illegible at atlas scale.
- Society → geology: tapping (conductance), quarrying and passes (relief and
  rock), harbours and weirs (coast geometry and bathymetry), dams (water and
  sediment).
- Society → ecology: clearance, burning, hunting, conservation, grazing.
- Society → magic: tapping and exhaustion of Fire conduits; prism quarrying of
  Aurora capacity; shoreline works that reflect Pressure.

### Settlement location obeys geology

Current behavior, read from `societyGeography.ts` on 2026-10-23: community
seeds are dry-land cells ranked by an exponential random draw weighted by local
support capacity (farming, grazing, gathering, fishing), then thinned by a
spacing filter of one nominal spacing per profile (100 km at World) with a
radius that shrinks where capacity is high. The seed cell is the settlement
site. Nothing in the choice looks at relief, routes, coast shape or river
geometry, so settlements land as a near-equidistant scatter over whatever is
fertile. Pass and harbor works are placed afterwards from the community, not
the other way round.

**Design.** Separate the population unit from the site. The unit is the
catchment (the third pass already moves World society onto catchments). The
site is the one place inside the unit that the geography offers, and the
geography offers sites in a definite order of reliability:

1. **Passes.** Where the cheapest routes between two lowlands funnel through a
   gap in relief. The settlement sits at the foot of the pass on the last flat
   ground, one on each side if both sides are populated. Passes are rare and
   create towns out of proportion to their farmland, because everything moving
   between the lowlands goes through them.
2. **Rivers.** Confluences, fords (a wide shallow reach between two gorges), the
   head of navigation, and the valley mouth where a river leaves the hills for
   the plain and drops its load. A range front therefore reads as a line of
   towns, one at each valley mouth, strung along the piedmont.
3. **Harbors.** A sheltered bay (coast concavity), deep water near shore, an
   estuary, and a lee from the prevailing weather and from Pressure surge. A
   straight exposed coast has fishing camps, not ports.
4. **Plains.** Fertile open ground is where people are, not where towns are.
   Plains carry dispersed farmsteads and villages (latent at World under the
   third pass) and a town only at a node on the plain: a crossing, a spring in
   dry country, a lake shore, the edge of a marsh.

Magic adds sites of its own at the same rank as rivers: a Fire halo edge, an
Aurora melt line, a Pressure upwelling coast, the archive sites and ruins the
ice-age round left.

**Mechanism.** Site opportunity is a scored field computed from fields that
already exist: route centrality on the current society route graph (edges cost
distance plus rise, so the graph already knows where passes are), river order
and confluence, coast shelter and depth, buildable slope, water access, and
magical opportunity. The site is a hard choice, not a weighting: each catchment
takes its best-ranked site class, and within that class the highest opportunity
× capacity cell; the random draw only breaks ties among cells of the same
class. Capacity still decides how large the settlement grows and whether the
catchment is settled at all. The spacing filter stays as the territory floor;
it stops deciding the site. The result is settlements that cluster along
rivers and coasts and at range fronts, with empty interiors, instead of a
lattice. Variety comes from the geography differing between catchments, not
from noise in the choice.

**The mountain fortress.** A refuge on a defensible crag above a route node is
a real site class but a rare one. It requires three things at once: a route to
control (a pass or a river gorge below), relief that is defensible but still
reachable (a knoll or spur, not a summit), and a reason, which is political
pressure or a hazard in the lowland below (raids across a polity border, floods,
a volatile Fire halo). Its population stays small; it is a seat, not a market.
Scarcity comes from the conjunction, not from a quota: most passes get a foot
town, a few get a fortress above it, and only when the era's political capacity
and contact produce the pressure.

**Across epochs.** Ice-age camps use the magical and food-driven sites (halo
edge, melt line, upwelling coast, river crossings on herd routes) and ignore
passes and harbors, which mean nothing to a mobile band. Present towns sit on
ice-age ruins only where the ruin coincides with a present site class; a camp
on a halo edge that burned out is a ruin field with no town. Site opportunity
is recomputed each era from the geography of that era, so a river that shifted,
a harbor that silted, or a coast that drowned moves the town.

### The epoch loop as layers

Per geological epoch, in causal order. "Exists" marks a slot already in the
sequence; the rest are moves or additions.

1. Tectonics; advect magic history and human-made conductance and bathymetry
   with the crust (advection exists; carried channels extended).
2. Ocean geometry and currents (exists).
3. Pressure: sources, rays, ocean forcing (SST anomaly, upwelling nutrients,
   surge, fog). Moved earlier.
4. Fire: sources, propagation on inherited conductance, heat and ice melt,
   quickening, rock hardening, conduit evolution.
5. Climate pass, now seeing Fire heat and moisture and Pressure SST and fog
   (exists; gains inputs).
6. Water: drainage with warm-water tongues below halos.
7. Ecology evolve with quickening and preservation forcings, fire regime and
   marine nutrients (exists; new forcings).
8. Incision and sediment, modulated by cover (exists; coupling added).
9. Glaciation; then Aurora (retention, ice persistence, cold shadow); then the
   after-glaciation climate pass and post-glacial melt. Aurora moves inside the
   ice group.
10. Ecology respond (exists).
11. Human round, only in an epoch with a bound era: settle, use, exploit; apply
    works to conductance, cover, herds, water and coast; local Fire
    re-propagation and ecology refresh around the works.
12. Coasts with Pressure and shoreline-work forcing (exists).
13. Burial, storage, history (exists).

The present epoch keeps the same order and then runs the full society eras.

### The ice-age round (user requirement: one human round before the last epoch)

A human era can bind to a physical epoch; the existing `physicalEpoch` era
setting is today legacy metadata and would carry this. An era bound to "Cold
age" runs as layer 11 of that epoch: short, mobile, low political capacity, no
polities or borders, settlements as camps and seasonal stations. Its works are
the cold-age set: tapping, burning, hunting, prism quarrying, larders, weirs
and breakwaters. The era ends inside the epoch; its works stop being
maintained; their physical consequences persist and advect. Default schedule:
an "Ice age" era bound to Cold age, then "Settlement" in Present.

Present-day society reads the inherited works as ruins and sites, the altered
conductance through the Fire field, the altered bathymetry through the
Pressure field, and the altered cover through ecology. Nothing is labelled as
inherited; it is simply the geography.

### Additional review scenes

6. **Tapped vein:** cold-age people tap a vein. In the present the halo runs
   further along it and ends at a basalt scar; ruins sit at the tapping; the
   present town sits on the ruins.
7. **Drowned weir:** a cold-age weir line is now a shoal. A present Pressure
   front reflects off it onto a coast that would otherwise be calm; fog,
   upwelling and a fishing settlement follow.
8. **Quarried prism ridge:** a gap in relict Aurora ice above a scree fan and
   melt channel, with the archive site at the old larder.
9. **Overhunted ribbon:** a vein ribbon whose herd was extirpated is closed
   grove in the present; the neighbouring ribbon is open grassland.
10. **Range front:** a line of towns at the valley mouths along a piedmont, a
    pair of pass towns on either side of the one gap in the range, one
    fortress on a spur above the pass on the side with the contested border,
    and villages but no towns on the plain between them.

### Questions this pass raises

- Is quickening the right reading of a wellspring of life? The alternative is
  abundance without acceleration (bigger, not faster), which gives old forests
  rather than fast groves.
- Should Aurora's climate effect be the dry cold shadow, or only ice
  persistence with no atmospheric reach?
- Should exhausted Fire conduits ever reopen (tectonics, a new epoch), or is
  burnout permanent?
- How large should the ice-age round be: a handful of camps, or enough to mark
  most Fire ribbons?
- Resolved: site opportunity is a hard choice of the best site per catchment,
  with the random draw breaking ties only. Chosen so that range fronts and
  river chains read unmistakably on visual inspection.

## Third pass: scale contract — realized, latent and absent

Analysis and design input, 2026-10-23. Applies to every process, not only
society. User direction that governs it:

- World-profile processes are fast and have world fidelity. They resolve what
  the world mesh resolves and nothing finer.
- "Latent" means **unrealized**, not hidden. The latent space is the set of
  edges a finer profile can refine over time. A river channel is tens to
  hundreds of metres wide; its minor tributaries do not exist at World even
  where the ground dips. Regional refinement may generate a tributary from that
  dip. The World never generates it, so there is nothing to hide.
- Each feature kind needs a stated scale at which it is working.

The bounded society delivery (`8b32668`, `4cbf7ca`, uncommitted follow-ups)
read "latent" as _hidden_: `societyMapScope.ts` withholds non-major communities
and works from the World map while `societyWorks.ts` and `societyEnvironment.ts`
still place and apply them. That is the mismatch this pass corrects.

### Three states of a fact at a profile

| State        | Meaning                                                                                                                                                                                                                       | Example at World                                                                                                      |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Realized** | Generated at this profile's fidelity and authoritative here, published as features or fields. Cartography may generalize it at a zoom; it still exists.                                                                       | Trunk rivers, named ranges, biome regions, Fire halos, capitals and their routes, polities, population fields         |
| **Latent**   | A quantity, budget or propensity this profile computed for a unit it resolves (cell, catchment, reach, coast segment). A finer profile reads it as forcing and may realize features from it. No geometry finer than the mesh. | Runoff and catchment area per cell; fracture conductance; cover and soil fields; a catchment's population and demands |
| **Absent**   | Not generated at this profile. Nothing stored, nothing hidden.                                                                                                                                                                | Sub-cell tributaries, individual dams, farms, villages, buildings                                                     |

"Hidden" is not a fourth state. A computed thing the map withholds is either
realized-and-generalized, legitimate when it is at mesh fidelity (the retained
sub-threshold drainage reaches in `world.drainage` are channels the mesh
actually resolved), or a sub-mesh fact that should not have been computed at
this profile. The current society output is the second kind: on the default
World a run produced 671 community points and 1,279 located works with radii
up to 5 km on a mesh of roughly 13 km cells, then published 98 of the points.

[Product spec 12.2](product-spec.md#122-authorship-and-materialization-states)
lists "Unmaterialized". Proposal: split it into latent and absent and adopt
the three words there.

### Resolution rule

A process at profile P may realize a feature when either

1. its physical footprint spans at least _k_ cells of P's mesh (propose _k_ = 2
   on the smaller dimension; a workshop choice), or
2. it belongs to a category P designates as **major**, whose influence is
   cell-scale even when its geometry is a point: a capital, a Fire core, a
   trunk-river crossing.

Whatever the process would otherwise decide below that footprint becomes a
latent quantity on the unit that contains it. The child profile realizes from
the quantity using its own terrain, including authored terrain, and conserves
the parent's totals within a stated tolerance
([spec §9](product-spec.md#9-boundary-contracts-and-successive-refinement)).
A child never edits the parent's realized facts.

### Working scales by profile

Extents are defaults, not bands (spec 4.1). The surface grid is about
extent / 256 per cell at Standard; Draft halves and Fine doubles the linear
density. The default 4,000 × 3,000 km World therefore has cells near 13 km at
Standard, 27 km at Draft and 7 km at Fine.

| Profile  | Typical extent | Standard cell | Society unit spacing (`communitySpacing`) |
| -------- | -------------- | ------------- | ----------------------------------------- |
| World    | 2,000–6,000 km | 8–25 km       | 100 km                                    |
| Region   | 200–1,000 km   | 1–4 km        | 25 km                                     |
| Local    | 20–100 km      | 80–400 m      | 2.5 km                                    |
| Site     | 1–10 km        | 4–40 m        | 250 m                                     |
| Interior | under 1 km     | under 4 m     | 25 m                                      |

What each pillar realizes at World, what it leaves latent for the child, what
is absent, and where the absent things first appear:

| Pillar              | Realized at World                                                                                                                                                                                                                                                                          | Latent at World (child forcing)                                                                                                                                        | Absent at World                                                                                                                            | First realized                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Geology and terrain | Continents, ranges, prominent peaks, craters, gorges and falls at cell scale, material histories                                                                                                                                                                                           | Crust, material ledgers, fracture conductance, noise wavelengths above the cell                                                                                        | Hillslope forms, cliffs, terraces, scree                                                                                                   | Region (landforms), Local (hillslope)                                                         |
| Hydrology           | Every reach between confluences of the mesh flow graph, mapped above 350 m³/s and retained below; lakes of at least a cell; deltas                                                                                                                                                         | Runoff, catchment area, flow direction, channel width and depth profiles, lake stage                                                                                   | Tributaries below cell catchment, meanders, oxbows, springs, braids                                                                        | Region (tributaries, meander belt), Local (oxbows, springs)                                   |
| Climate             | Temperature, moisture, wind and seasonality fields; snowline; fog and SST bands if the Pressure proposal lands                                                                                                                                                                             | The same fields plus lapse and aspect rules                                                                                                                            | Valley microclimate, frost hollows, the shadow of one sub-cell ridge                                                                       | Region and Local, by rerunning climate on refined relief                                      |
| Ecology             | Cover, soil, disturbance and animal fields; named biomes above `share × land`, split along drainage divides                                                                                                                                                                                | Cover, soil, fuel, flood frequency and herd density fields                                                                                                             | Stands, groves, clearings, wetlands below a cell                                                                                           | Region (patches, gallery forest on realized channels), Local                                  |
| Magic               | Sources and cores, veins resolved by conductance, halos, Aurora fields and prism ridges, Pressure rays, fronts and wakes, landmark regions                                                                                                                                                 | Conductance, intensity, storage, retention and SST anomaly fields; the second pass's society deltas (tapping, quarrying, shoals) as field changes                      | Individual vents, sinter terraces, single prism outcrops, one weir's reflection                                                            | Region (vents, terraces), Local and Site                                                      |
| Society             | Catchments near 100 km as population units with groups, livelihoods and affiliations; capitals, regional centres, towns of at least 5,000 concentrated residents and their ruins; routes between them; polities; events of at least 10,000 people; population, culture and language fields | Per-catchment urban share not located to a site; works **demand** per kind as a budget with units; aggregate environmental forcing already applied; practice resources | Located works (dam, harbour, pass, irrigation, clearance polygons), minor settlements as sites, local roads, fields, institution buildings | Region (towns, dams, harbours, passes, clearance), Local (villages, fields), Site (buildings) |

### What changes for society

Current behavior, read from the code on 2026-10-23: `societyWorks.ts` proposes
point works per community with radius min(5 km, 200 m × √area), anchors dams
and irrigation to retained reaches and searches 10 km of shore for harbours;
`societyEnvironment.ts` applies them as local earthworks and vegetation and
water changes with a focused refresh every ten-year cycle; `societyMapScope.ts`
withholds non-major communities and all works from the World map;
`societyInheritance.ts` copies the works inside a child footprint and the Region
publishes every one of them. The ten-year loop for population, migration,
contact and politics is sound and stays.

Proposed:

1. **Demand, not works, at World.** World society computes works demand per
   catchment per kind as a budget with units, from the same livelihood and
   environmental reads it uses today: irrigated share of farmland, cleared
   share, storage volume wanted, maritime traffic, hunting pressure, core
   extraction, crystal harvest, diving. No positions, no radii.
2. **Feedback through fields.** World feedback applies demand as aggregate
   forcing on the catchment's cells, in the Canonry pattern of writing into
   shared fields and letting the ordinary processes respond: cleared share
   lowers tree cover and raises grass over the farmable cells; withdrawal
   reduces discharge downstream of the catchment by its fraction; core use adds
   a heat budget; hunting lowers herbivore density. Earthworks are absent at
   World. The environmental refresh operates on fields over catchments, not on
   point works.
3. **Major-works exception.** When a demand's realized footprint would meet the
   resolution rule at World, the World realizes it as a feature with its
   physical consequence as geography: a dam whose impoundment covers _k_ cells
   of a trunk river and its lake polygon, a canal joining two trunk rivers, a
   long wall. Candidate rule: realize when demanded storage against the reach
   gradient yields a lake of at least _k_ cells; otherwise stay latent.
4. **Realization at Region.** `refineSociety` keeps inheriting catchment
   aggregates and adds a realization stage after the Region's physical
   refinement and before present works: locate towns for the inherited urban
   share within the finer catchments; locate works from inherited demand
   against the refined channels, coast and relief; apply them as located
   earthworks there (this is where the current point-work code belongs);
   conserve the parent's population, cleared share and withdrawal within
   tolerance; report demand with no site (no valley to dam) as a latent
   remainder rather than forcing one. Authored terrain before realization
   changes the result; authored works remain protected.
5. **Cartography unchanged in rule, changed in role.** `isMajorSettlement`
   remains the World publication rule for realized settlements. It stops
   acting as a filter over sub-mesh records because those records no longer
   exist at World.
6. **Speed.** World society becomes O(catchments × cycles) field work. Measure
   against the recorded 30–103 s evolution figures before and after; the
   target is a fraction of one physical pass, set at the workshop.

### What changes for the other pillars

Mostly declarations rather than new code. Each process registers the profiles
it realizes at, the latent channels it publishes for children, and the
realization it performs when run at a child profile with inherited latent
inputs. Candidates:

- **Hydrology.** A Region rerun of drainage on the refined mesh generates
  tributaries from inherited runoff and relief; parent trunk channels are fixed
  crossings. Today `refinedDrainageFeatures` only surfaces the parent's
  retained reaches; it does not generate new ones. The documented Region
  physical sequence should produce them; [backlog item 1](backlog.md) still
  marks regional generation pending, so verify rather than assume.
- **Ecology.** The biome minimum `share × land` already scales with the area,
  so Region biomes are smaller patches automatically. Declare it.
- **Magic.** Conductance, intensity and storage fields are already the latent
  space. Region realizes vents and terraces from them. The second pass's
  society deltas (tapping, quarrying, shoal reflectivity) are written as field
  changes at the profile where the work is realized, then summarized to the
  parent as aggregate forcing.
- **Geology and climate.** Already field-latent. Declare Region realization:
  landforms, and climate rerun on refined relief.

### Open questions for the workshop

- The value of _k_ and the per-pillar major categories at each profile.
- Demand representation. Recommend per-catchment scalars with units at World,
  fields at Region and below.
- Conservation tolerance when a child realizes inherited totals.
- Whether a parent is ever updated from a child's realization. Recommend no:
  the parent stays fixed until regenerated, consistent with spec §9.
- Whether the World publishes any works under the major-works exception, or
  none until Region.

## Fourth pass: where the magic went

User observation, 2026-10-23, from Canonry screenshots: Aurora fields (teal),
geothermal vents (hatched brown), a midline ridge and hot springs are all
visible as distinct surfaces in Canonry and none of them are visible on the
atlas map. Measured on one draft World (seed 104729, 2,000 × 1,000 km, one
Formation epoch only, 16,836 cells of which 3,925 are land), generated by the
display test on 2026-10-23:

| Where the magic is                    | Count                                                                                                                                                                              |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Magic places as vector features       | 110 Fire cores, 24 veins, 28 hot springs, 76 vents, 27 basalt flats, 46 halos; 8 Aurora fields, 2 wells, 7 prisms; 184 rogue impacts, 98 steam fractures, 26 crush zones, 22 wakes |
| Cells with a magic final-surface code | 13,658 of 16,836 (81 percent)                                                                                                                                                      |
| Pressure crush zone cells             | 11,378, against 12,911 water cells; Pressure intensity is at its 1,000 ceiling across the sea                                                                                      |
| Fire feature cells on land            | 1,779 of 3,925 (45 percent)                                                                                                                                                        |
| Aurora field cells                    | 0: the rule needs ice 260 and this warm epoch peaks at 140                                                                                                                         |

So the classification is running with Canonry's thresholds and the places are
produced. They are lost between generation and the eye, for four reasons:

1. **The magic layer is hidden by default.** Its family is `magic`; the
   default physical presentation shows physical, water, transport, built and
   custom families only. Magic appears under the magical preset alone.
2. **One colour for everything.** Every magic place on the layer draws in the
   layer colour with a 40 percent fill. A hot spring, a vent, an Aurora field
   and a crush zone are the same lavender blob. Canonry gives each surface
   type its own colour and hatching.
3. **No land cover base.** The atlas base is hillshade and an elevation ramp.
   The final-surface classification, which carries the magic surface codes,
   is an opt-in overlay rendered through a continuous ramp, so categories are
   illegible even when turned on. Canonry paints every hex by surface type.
4. **Saturation.** Pressure fills the sea at maximum intensity, so crush zone
   and lattice cover most water cells; Fire features cover nearly half the
   land. Drawn as-is, the map would be a wash, not detail. This is the
   "bland field-threshold" anti-pattern the Canonry design warns against, and
   it comes from field strength and reach, not from the feature rules.

Aurora in a warm present is the separate, known case: retention scales with
ice thickness, so the default Present epoch (ice 0, 15 °C) keeps Aurora
history but almost no Aurora field. Recovering it means relict ice on high
ground, or Aurora that lives in cold air rather than only in ice, which is the
per-system world-design question.

**Recovery scope, split in two.** Presentation (parent plan phase 3): a
land-cover or surface base that shows natural and magic surfaces by category
with a legend; per-kind symbols for magic places; the magic layer visible in
the physical preset. This is the review instrument for every later phase, so
it is the one piece recommended for early implementation under explicit
instruction. Retune (parent plan phase 5, after the per-system world design):
Fire and Pressure reach and strength so features are rare and shaped, with
each system's reach and rarity target stated in its world-design section;
Aurora viable in the present per the world-design answer. Draft-quality
sampling of a 2,000 km world at 11 km cells also hides veins and springs by
construction; the scale contract above says where they are realized.

**What this changes in the plan.** Process parity with Canonry does not give
result parity: the atlas world is larger, warmer and more oceanic, so
Canonry's strength, reach and threshold defaults saturate here. Every magic
design section must state reach and rarity, not only mechanism.

**Presentation delivered (2026-10-23, user-authorized).** The default base map
is now "Surface": the terrain tile carries the final-surface class as a band,
natural classes take a colour each and magic classes take the colour of their
feature rule, under the same hillshade and contours. The surface code catalogue
lives in the domain (`surfaceCategories`, `magicSurfaceCode`) and generation
assigns codes through it, so a legend entry always names the rule that wrote
the cell. Magic places on the magic layer draw with a colour and mark per rule,
and the layer is visible in the physical preset. Broad field classes (crush
zone, wake, lattice, halo, Aurora field) tint the relief at 35 to 80 percent
instead of replacing it; without that the Pressure field painted the whole sea
one flat slate, which is the saturation finding made visible. The retune
itself remains phase 5.

The first cut sampled the class per pixel from the nearest cell and brought
back cell squares. Classes are now reconstructed from per-cell memberships
over the grid's own interpolation support (bilinear on the published World
grid, the shared Hermite patches on adaptive fields), and the class with the
highest membership wins. Cell centres keep their class; boundaries fall where
one membership overtakes another, the same rule region outlines use, so the
raster fill and the vector outline of a place agree. Cost measured on the
draft World: about 10 ms more per 258-pixel terrain tile on a 150 ms base.

## Fifth pass: the world of each system, and what the code now does

Implemented 2026-10-24 under the instruction "let's do the major chunk of plan",
read as the magic chunk: this per-system world design (parent phase 4), the
reach and rarity retune (phase 5) and the Fire, Aurora and Pressure couplings
into climate, ecology and geology (phases 6 and 8). The three sections below are
the design the code follows; where a mechanism from the second pass was
deferred it says so. Society mechanisms (phase 7) are described as the reads
the society processes will make, not implemented.

Every system acts in the Canonry pattern: it writes into shared physical
fields that the ordinary processes already consume, and the ordinary processes
keep doing the work. New shared fields: `Quickening` and `Stillness` (living
forcings, 0–1), `IcePersistence` (share of ablation held, 0–1),
`ExternalUpwelling` and `ExternalSeaSurfaceForcing` (what Pressure moved, read
by the next circulation pass) and `FogForcing` (0–1 on coasts). Both magic
evaluations re-apply every system's heat, melt, living and ocean forcing, so a
system evaluated in the other phase keeps its contribution and a changed one
replaces its own. Named living landscapes come from the forcing _and_ the cover
it produced; a bare quickened crag is still bare rock.

Measurements below are from the default three-epoch draft World (seed 104729,
2,000 × 1,000 km, Formation, Cold age, Present; 16,836 cells of which 1,785 are
land and 15,051 sea), generated by `frontend/.artifacts/generation/magic-world.ts`
in 48 s. The baseline on the same world before this pass: 80 Fire cores and
Fire-coded cells on 45 percent of land; Pressure crush zones on 85 percent of
the sea; four relict Aurora fields. The first cut of this pass tuned toward
rarity (6 cores, crush on 4 percent of the sea); the user asked for more
density and the defaults below are the raised ones.

### Fire: a wellspring in the fractured crust

**Magical geology and biomes.** Fire rises where the crust is fractured and hot:
a core sits on a heat maximum under land (fracture conductance, tectonic strain
and volcanic activity together), never on the sea floor, whose heat shows as
hydrothermal vents through the ordinary geothermal field. Cores keep 90 km
apart and need a source density of 300, so a World carries about one per
10,000 km² at most. Cores are chosen afresh at every evaluation from the heat
maxima of that epoch: there is no persistent core object, and what travels with
the crust is the Fire history, the stored charge, the sealed state and the
opened conductance of its conduits. A conduit a core has opened stays a heat
maximum where the crust carries it, so a long-lived core re-forms on the same
moving ground; a core whose ground drifts under the sea stops being a core, its
seabed keeps the history, and its heat shows as vents. The user's explicit
sources on the map are the exception and persist by their own definition.
Heat follows the fracture network: through unfractured rock
it dies within 10 km; along a conductive vein it travels 30–70 km. Veins are the
geology people exploit, and they evolve: an active conduit (intensity 230 or
more) opens by up to 120 conductance each epoch it carries Fire, so a long-lived
vein reaches further in the present than it did at formation; a conduit that has
carried 2,400 summed intensity seals with sinter and basalt, its conductance
collapses to the floor, it no longer feeds a core, and the surface above it is a
**Basalt scar** (new feature rule). Around a core the quickening runs: every
living process near the conduit runs faster. Growth rate × (1 + 2 q), turnover
× (1 + 3 q) (mature early, die young), seeding faster, decay × (1 + 3 q), and
fuel builds so natural fire risk × (1 + 3 q). The result is named from the
cover it made: **Ember grove** where the quickening grew a canopy of 0.3 or
more, **Thaw meadow** otherwise; the core cell itself is too hot for ordinary
plants (the existing warmth ceiling). Hot springs, basalt flats and vents keep
their Canonry rules. The direct burn effect falls from 0.8 to 0.3 so the grove
regrows between the fires the fuel now causes.

**Local climate and transport.** Heat forcing is unchanged (36 °C at a core
cell, falling with reach) and the air already carries half of it downwind. Two
additions make the plume: hot ground is a moisture source (a column over forcing
of 200 or more gains up to 60 percent of its saturation deficit) and it lifts
the air (the column wrings out 1 − exp(−forcing/250) of its water), so the rain
falls on the lee side and the downwind slope is the wet, wooded side. The
thawed-river tongue of the second pass is deferred: it needs the drainage pass
to carry heat, which is phase 10 work.

**Human use and exposure.** Cores are the fire-core deposit the existing
forge practice mines and consumes. The quickened country raises plant
production and herbivores, which the society support reads (farming, grazing,
gathering) already sample, so the halo edge is the richest ground in cold
country without any society code changing. Phase 7 adds the sites: the halo
edge at the rank of a river site, and an on-land core as the seat of a large
settlement (user requirement). Exposure: the heart is uninhabitable; heavy use
exhausts a conduit (sealing is the geology of the "tapped vein" scene).

**Reach and rarity target.** Cores: at most one per 10,000 km² of land, all on
land (raised from one per 25,000 km² at the user's request, 2026-10-24, after
a first cut that read too sparse). Fire-touched land: under 25 percent of land
at any intensity, under 8 percent above the vein threshold. Measured: 8 cores
on 220,000 km² of land (the heat maxima, not the cap, limit this seed), 12 core
cells, 9 vein cells, 48 hot-spring cells, 16 halo cells; 235 land cells (13
percent) with any intensity; 67 Thaw meadow and 2 Ember grove cells (this world
has little forest anywhere). Controls: "Core-site prevalence", "Thermal reach"
and "Heat and quickening" (adds the quickening to the thaw control).

### Aurora: the stillness held in charged ice

**Magical geology and biomes.** Aurora gathers in cold and routes to colder
ground (unchanged). What is new is that it stays: charge stored in ice outlasts
the epoch that gathered it. Each epoch stores half of its fresh intensity and
keeps 30 percent of what was stored before, so relict charge marks the ground
that held the most during the Cold age. Stored charge from 300 to 450 holds ice
still: up to 90 percent of ablation is prevented where the climate's deficit
is marginal (under 600 units) and the ice is at least 150 thick; a warm lowland
still loses its glacier and a thinning skin goes with the climate. So relict
Aurora fields survive the warm present on high ground and in the far north,
where the field rule (intensity 470, ice 260) still holds, with melt lines and
frost prisms at their edges. Between its own evaluations a system is present
only as the charge it stored: at the start of an epoch Aurora's live field of
the last epoch is gone with that epoch's climate, and it re-forms in the ice
season. Stillness is the living forcing, and it belongs to the charged field:
it is scaled by the charge the ice holds (a strong live field above intensity
600, or relict charge above 300, and only where at least a skin of ice remains),
not by the wide cold drainage. Under it,
growth × (1 − 0.7 s), turnover × (1 − 0.85 s) (trees stand past their span),
seeding × (1 − 0.9 s) (no saplings), decay × (1 − 0.9 s) and organic
preservation 1.5, so standing biomass persists without turnover. Named cover:
**Rime forest** where a canopy of 0.3 stands in stillness of 0.45 or more,
**Glow-lichen barrens** on bare charged ground. Rock softening is unchanged.
Deferred: the melt-line fen, where seasonal melt releases centuries of preserved
matter in one pulse; it needs a memory of last epoch's stillness.

**Local climate and transport.** Charged ice exhales cold: heat forcing −0.03
per intensity unit scaled by the held charge, so a full field is 3 °C colder
than its latitude and the air carries the shadow downwind through the same
share as Fire's heat. The dry katabatic character is implicit: colder air
saturates lower. The second pass's open question (shadow or persistence only)
is answered with both, persistence doing most of the work. The shadow has to be
small and held: a first cut at −5 °C over the whole cold drainage leaked the
Cold age's shadow into the present's climate passes, and three quarters of
this world's land kept thin ice that a no-magic control world did not have.
Holding the shadow to charged ice and letting the live field lapse between
evaluations brought the present back to the control's ice within 41 cells,
all of them relict fields.

**Human use and exposure.** Crystals and the archive practice are unchanged.
Nothing inside a field is farmable: stillness halves plant production at full
strength, and the field is ice. The melt line is the one rich strip and the one
place to live; phase 7 makes it a site. Quarrying prisms removes the reservoir
(second pass) and is deferred with the society works.

**Reach and rarity target.** Relict fields: under 8 percent of land in a warm
present, on high and northern ground; stillness that names cover only inside
and at the edge of fields. Measured: five relict Aurora fields on 61 land
cells (3.3 percent) on the northern island arcs, three frost prisms, three melt
lines; land with any ice 119 cells against 77 in the no-magic control and
relict ice 260 or thicker on 58; stillness above zero on 144 cells; no rime
forest or glow barrens named in this unwooded, mostly ice-free present (the
Cold age names them). Control: "Stillness" (persistence, stillness, shadow and
preservation together).

### Pressure: the weight that moves water

**Magical geology and biomes.** One deep locus sends 128 standing rays (Canonry:
1,200) that lose 8 energy per 10 km (about 1,200 km of reach; reflections cost
more), each depositing 110 intensity per step at full strength, so rays separate
into visible spokes beyond about 100 km and their crossings, their foci on
coasts and the locus reach the crush threshold. Twenty-four coastal rogue
bursts (24 rays of 300 km) and sixteen ancient wakes (700 km, strength 150)
replace Canonry's 200 and 260.
Pressure now evaluates in the climate phase, once the ocean has its geometry,
so the epoch's later climate passes see the water it moves. Where a ray above
160 intensity shoals (shelf, water shallower than 400 m, or a shore cell) it
lifts deep water: upwelling of (intensity − 160) per mille (capped at 1,000), a
sea-surface cooling of 0.1 per unit capped at 6 °C, and fog on the land it
faces. Upwelling feeds the existing marine nutrient term, so the band is the
fishery; crush zones are dead water for fauna (animal toxicity 0.5); wakes
leave a warm still layer (+3 °C). Named cover on the coast: **Fog heath**
where fog of 0.3 or more wets a cover of 0.12, **Moss forest** where it grew a
canopy of 0.4. The **Upwelling front** is a new feature rule on the sea (ray
above 250 over upwelling above 250), and "Upwelling water" is a new natural
surface at 450 per mille, whether a gyre's eastern boundary or a front made it.

**Local climate and transport.** The cold surface is carried ashore by the air
columns' existing sea exchange, so coasts facing a front are cooler; fog drips
300 mm/year and cools 2 °C at full share. The forcing persists in the shared
fields, so the next circulation and climate passes include it; in the present
it is also applied at once, since no climate pass follows.

**Human use and exposure.** Fisheries follow the upwelling bands through the
aquatic fauna field, which the society fishing read samples only along rivers
today; coastal fishing, harbours in the lee of fronts, and divers' access to
deep water are phase 7 reads. Exposure: coastal forcing (erosion) is unchanged
and now follows rarer, stronger fronts; a crush coast is barren of fish.

**Reach and rarity target.** Rays touch most of the sea at some intensity and
read as spokes; crush and lattice each under 15 percent of the sea, fronts and
wakes each under 6 (raised from crush under 5 and lattice under 8 at the user's
request, 2026-10-24). Measured: crush 13.9 percent, lattice 14.0, front 5.0,
wake 4.8, together 38 percent of the sea with the rays visible from the locus
outward; fog on 1,165 land cells (64 percent of a very coastal land) with 81
Fog heath cells where it was strong enough to name cover.
Controls: "Ocean influence extent" (now with ray decay), "Moved water" (new),
"Ancient wake prevalence" and "Rogue-impact prevalence" at the new scale.

### The natural classifier under the magic

The Surface base showed the relief classes as broad tracts because they ran
before the living cover: 16 percent of land was "River channel" and 13 percent
"Ridge". Now a relief class names a cell only where the ground is bare (cover
under 0.12): scree, ridge and exposed shelf (bare lowland the sea has washed);
"River channel" needs a river of order 4; floodplains need intensity 250; a
"Current channel" is an intensified boundary current (780); a polynya needs
real sea ice beside it. Living cover is the land surface, and the hillshade
carries the relief.

### What this pass leaves open

- The thawed-river tongue (Fire heat carried down the drainage) and the
  melt-line fen (Aurora's pulse of preserved matter): both need a process to
  carry a magical quantity through water or time; phase 10.
- Society reads of the new fields (phase 7): quickening and the halo edge as
  sites, the melt line as a site, coastal fishing from upwelling, fronts and
  wakes in harbour choice, the on-land core as a seat.
- The generic altered ecology (plant group, cover, biome names) is dormant: no
  preset sets `ecologicalAlteration`. Removing the machinery is the cleanup the
  user's correction asks for and is not done here.
- Reach and rarity were tuned on one oceanic seed; a continental seed should
  be measured before the targets are called settled.

## Proposed generation approach for discussion

This is a **process sketch**, not a mandated order or a command to implement.
"The epoch loop as layers" above supersedes its step order; the constraints
here still apply:

1. Establish geology, relief, ocean geometry, water and a baseline climate.
2. Place and propagate each magic system through its proper medium. Apply
   Fire's heat **and** living influence, Aurora's ice/rock effects, and
   Pressure's ocean/coast effects using system-specific operations.
3. Refresh affected climate, water and magical pathways in causal order.
   Define the Pressure-to-weather and any Aurora-to-weather mechanism before
   deciding where its refresh runs; avoid recirculating an entire world
   blindly. A changed climate must reach ecology in this same generated map.
4. Run ecology on the resulting water, temperature, substrate and magical
   conditions. Generate plants, animals, disturbance and biomes from their
   actual mechanisms. Replace the generic "altered" group and names with
   outcomes attributable to the relevant system.
5. Let society establish and repeatedly adjust populations, settlements,
   works and connections against this living and magical geography. Apply
   society's changed water, land, climate or magic conditions back to the
   affected processes, then let population and built geography respond.
6. Publish the resulting map only when fields, water bodies, biome extents,
   works and settlements agree spatially. Continue to support ordinary
   authoring and selected-area generation rather than requiring a world
   rebuild for every local work.

This uses the existing shared process/workspace and browser-worker model.
Exact refresh order, spatial extent and quantitative behavior follow from
the mechanisms we settle during the workshop, not from a universal coupling
framework. No requirement for a wholly new simulation architecture follows
from this draft.

## Review scenes

We will inspect generated maps, not treat an implementation passing unit
checks as proof that the product behavior works. These are cases to develop
and compare, not required events in every world:

1. **Fire in cold country:** compare a cold landscape with and without a
   strong Fire wellspring. Look for changed local weather, thawed water and
   viable, visibly differentiated plant and animal country; settlement
   and roads should respond to the actual usable geography.
2. **Aurora at the ice edge:** compare an Aurora field and its margins.
   The ice, rock, vegetation and human uses should form one spatial pattern,
   without generic "altered" cover or Fire-like warmth.
3. **Pressure crossing an ocean and reaching shore:** the source, marine
   ecology, weather front, exposed coast and sheltered human geography
   should line up. Compare front-enabled and front-disabled maps.
4. **Dam and downstream country:** a dam creates an upstream lake and
   changes the downstream channel, habitat and settlement conditions.
   Inspect the actual network and map; a detached pond is a failure.
5. **Mixed-system geography:** where magic systems touch, decide which
   interactions are genuinely supported and show their different living,
   weather and terrain outcomes without flattening them into one magical
   corruption type.

For each scene, look at the map at world and regional scale. Reject a result
that only appears in a numeric field, tooltip, biome label or prose
description. A meaningful mechanism may need changed visual geography
before it counts as complete.

## Questions for the next design pass

- **Fire:** What makes its life-giving presence magical rather than simply
  hotter and wetter terrain? What should its ecosystems look like at the
  intense center, viable margins and fracture-fed outliers?
- **Aurora:** Should it actively cool climate, primarily preserve ice, or
  work another way? What living communities, if any, visibly thrive there?
- **Pressure:** Which weather mechanisms best express a _large magical
  pressure front_ without reducing it to ordinary low-pressure weather?
  Which marine and coastal life benefits, and which is crushed or displaced?
- **Society:** Which magical opportunities become reliable settlement
  attractors, and which cause avoidance? How should different established
  biomes change livelihoods without dictating cultures or political borders?
- **Geography:** What map scale and spread would make each system feel
  powerful without turning every world into a uniformly transformed map?
- **Controls:** Which few creator choices shape those outcomes while
  useful defaults still generate the whole interaction unaided?

Resolve the world-design questions, revise this process sketch, and only
then plan implementation slices. The draft examples and names are not
accepted canon or an implementation checklist.
