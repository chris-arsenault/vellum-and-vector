# Four-pillar interconnection — working design

Status: workshop draft, 2026-10-23. **Design only.** We will continue to refine
the behavior and generation processes before implementing them. This document
does not authorize runtime changes.

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

## Proposed generation approach for discussion

This is a **process sketch**, not a mandated order or a command to implement:

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
