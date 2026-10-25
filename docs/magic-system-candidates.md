# Magic system candidates

Design for the magic systems beyond Fire, Aurora and Pressure. Opened
2026-10-24 from the question "which established tropes do the three not cover,
and what would cover them in a mapping product?" Consolidated the same day to a
target of seven systems: the three current ones extended, plus four new. All
seven were implemented on 2026-10-25 by the
[seven magic systems plan](MAGIC-SYSTEMS-PLAN.md); this document is the design
record behind them. The systems are defined in the
[product contract](product-spec.md#103-magical-generation--the-seven-systems),
coupled through [ADR 0004](adr/0004-coupling-through-each-systems-medium.md) and
modelled as materials by [ADR 0007](adr/0007-magic-systems-are-materials.md).
The [magic lore bible](lore/magic.md) gives each of the seven its
setting-neutral character, practice, cost and lore.

## What a system must have

Each system, current or new, names:

- a **source** the generator can locate from physical geography or history;
- a **medium** no other system uses, and the propagation that medium implies;
- a **physical consequence** on climate, water, rock or living cover;
- a **map signature**: a field, feature, line or point the atlas draws, and
  biomes named for the system and the cover it produced;
- a **society reading**: a site class, an extraction, a hazard or a route effect;
- **interference** with at least one other system, with its own cause.

A trope that acts only on characters (illusion, mind control, shapeshifting)
has no geographic footprint and is out of scope.

## What the current three cover

| System         | Medium              | Propagation                    | Effect domain                           | Tropes owned                                                         |
| -------------- | ------------------- | ------------------------------ | --------------------------------------- | -------------------------------------------------------------------- |
| Captured Fire  | stone, mineral fuel | fracture network               | transformation, destruction, extraction | fire and forge magic, dwarven craft, magic as ore, volcanic geomancy |
| Aurora-light   | ice, sky charge     | cold drainage, retained in ice | perception, preservation, stasis        | scrying, divination, memory reading, time and stasis, oracle         |
| Pressure-depth | deep water          | ocean rays, reflections, wakes | force, communion, long-distance speech  | telekinesis, telepathy, drowned god, sea-witch, sonar-song           |

Media the three leave unused: air, living matter, the dead, fresh groundwater,
space itself, anything society makes. Effect domains they leave uncovered:
growth, blight, weather, translocation, sanctity, enchanted material. All three
are physically sourced and run in the climate or post-glacial phase, so nothing
in the world is yet caused by people.

## The seven

The ten original candidates (inventory below) fold into seven systems. Each
merge joins things that share a medium or a physical cause, never things that
merely share a mood.

### Fire, extended with fallen cores (absorbs Starfall)

A fire-core is a mineral store of energy. The generator already produces two
kinds of place that hold one: geothermal veins under land, and impact craters
with their ejecta. A Fire source gains an **origin**.

- **Vein origin** is Fire as it exists today: located at geothermal maxima, fed
  through the fracture network, opening its conduits until the vein seals.
- **Fallen origin** is a crater from the impact history. Its cores are a finite
  stock with no conduit behind them. They do not travel through fractures; the
  impact scattered them as ejecta, radially and downwind, and rivers carry the
  fragments on as placer deposits. A fallen core carries a foreign metal, so a
  crater field deviates compasses and forges a different steel.
- **Map:** vein Fire keeps its halos, Ember groves and Thaw meadows. Fallen
  Fire adds crater lakes, ejecta fans, placer bands on river maps and compass
  deviation zones drawn as cartographic warnings.
- **Society:** a second extraction mode. Vein cores are mined at a seat and
  renew while the conduit is open. Fallen cores are panned from gravels and
  quarried from a crater field, and they run out. Smith cultures, wars over
  crater fields, navigation that fails near them.
- **Interference:** unchanged. A fallen core cracks like any other.

### Aurora, unchanged

Aurora already owns preservation, stasis, scrying and memory, the largest trope
share of the three. Nothing folds into it. Its charge is read by two other
systems: Salt's dead do not rest under Aurora stillness, and Hallowed wards
store charge in crystal.

### Pressure, extended with weather (absorbs Gale)

Pressure already changes local climate: a shoaling ray lifts cold water and
fogs the coast it faces, a wake leaves warm still water. Weather is the
continuation of that onto land, not a second medium. The front still moves
water; the storm is what the moved water does to the air above it.

- **Storm genesis:** a warm wake under a cold sky, or a strong front meeting a
  cold upwelling band, raises a storm that the prevailing wind carries inland.
  The track deposits rain and snow on windward slopes, scours soil, drives
  dunes and leaves a dry lee.
- **Map:** storm tracks as lines from the sea, a weather-wall range with a lee
  desert behind it, harbours unusable for part of the year. Fog heath and Moss
  forest stay; a storm-fed slope adds its own cover.
- **Society:** sky-reading joins depth practice. Sail routes follow the fronts,
  a pass closes in the storm season, a coast is settled on its lee side.
- **Interference:** Fire heat columns feed a storm; Aurora's cold shadow pins a
  front in place; a Hallowed rim turns a track.

Air as an independent medium is given up by this merge. Storms only come from
the sea, which is also where most storms come from.

### Greenwood (new; absorbs Wellwater)

Life magic, druidic and fae-forest, with healing waters inside it.

- **Source:** two origins, one medium. Old-growth stands and deep peat, and
  spring outcrops where an aquifer reaches the surface.
- **Medium:** sap and groundwater: the water inside living things and the
  ground that feeds them. It spreads root to root through connected cover and
  along aquifers to emerge at springs. Where it emerges on bare ground it makes
  an oasis, and the oasis grows cover, so the two origins meet.
- **Effect:** forest holds beyond its climate band, soil deepens, rivers braid
  into wetland, cleared land regrows within an epoch. At a spring the water
  heals and fertilizes; drawn too hard, the karst beneath collapses.
- **Map:** a forest wall that ignores the biome gradient, clearings that read
  as wounds, roads that silt over, spring lines, oasis chains, sinkhole fields.
  Biomes: Deepwood, Wending fen, Well meadow.
- **Society:** forest peoples, lumber taboo, clearing as an act of war, a
  country whose border is a treeline, spa towns, water rights, the healing well
  as a pilgrim site.
- **Interference:** Fire quickening overdrives it into rot and boils its
  springs into steam fractures. Aurora stillness freezes its front. Salt kills
  it from below, and it buries Salt under peat.

### Salt (new; absorbs Grave)

Death magic: necromancy, cursed ground, the desert that remembers. Salt is the
medium because salt is what preserves the dead and what a dead lake leaves.

- **Source:** two origins. Mass death read from history: battlefields and
  sieges of human eras, famine years, burnt ground, matter released where
  Aurora retreats. And dead water: endorheic basins, playas and lakes that
  dried.
- **Medium:** brine. It seeps with groundwater downslope and is retained where
  the ground is dry or anoxic; where it reaches a basin it crusts, and the
  evaporite wind carries it on.
- **Effect:** cover thins, grazers avoid, soils sour, a desiccation front
  spreads from each basin, flats turn to glass. Mirage is its perception face:
  the dead are seen in salt.
- **Map:** the layer that is mostly a history product. Barrows along old war
  routes, a blighted band downstream of an ancient siege, salt roads, dead
  lakes, glass flats. Biomes: Barrow heath, Salt pan, Glass flat.
- **Society:** necropolises in salt, detour routes, salt trade as trade in the
  medium of death, cultures that farm the blight.
- **Interference:** Aurora stillness over Salt is undeath, preserved dead that
  do not rest, a signature no one has to author. Fire burns it clean. Greenwood
  and Salt fight a front wherever they meet.

### Veil (new; absorbs Doors and Wild zones)

Translocation and chaos: portals, thin places, the otherworld, the Blight.
Veil has no source of its own. It is what happens where two other systems
interfere hard enough to tear the world.

- **Source:** interference. Where two systems' fields meet at a steep gradient,
  the Fire/Aurora rims, steam fractures and Pressure/Aurora breaches the
  current design already produces, and the new fronts Greenwood and Salt add.
- **Medium:** the tear. A small or shifting tear is a wild zone; a large stable
  tear pairs with another stable tear elsewhere as a door, a connection between
  located spaces as the product contract defines portals.
- **Effect:** in a wild zone, terrain and cover change between epochs with no
  cause a surveyor can name. At a door, a ring of odd cover and a cold pool.
- **Map:** regions marked unreliable with features in alternate positions, and
  doors that give the routing graph shortcuts, so trade geography stops being
  Euclidean and insets become part of the atlas.
- **Society:** the frontier, avoided and scavenged; door-empires; fortresses at
  doors; inland cities that behave like ports.
- **Interference:** Veil is made of it. Aurora crystals close a door, Fire
  release ruptures one, carried Pressure cannot pass, a Hallowed ward seals one.

### Hallowed (new; absorbs Bound lines)

Sanctity and warding: divine ground, consecration, runic binding, geomancy.
The one system that society makes.

- **Source:** people. It accumulates where they gather over eras, strongest at
  long-tenured seats and pilgrim destinations, and where they bind a line: a
  wall, a border, a river bank.
- **Medium:** the route network and the bound line. It travels along pilgrim
  roads, is stored at shrines in crystal and stone, holds along a ward line,
  and decays when the shrine or the line is no longer kept.
- **Effect:** inside it the other systems are damped: Fire halos cool, Salt
  halts, Veil seals, a storm track turns. Along a ward line bound geography
  stops moving: the river stops meandering, the coast stops eroding, a border
  becomes a physical discontinuity. Whatever it damps accumulates at its rim.
- **Map:** pilgrimage lines, sanctuary rings, ruins that still hold a halo,
  maintained and lapsed ward lines. The cartographer's own trope: a drawn line
  becoming a world fact.
- **Society:** temple cities, pilgrim economies, surveyor-mages, borders that
  hold because the ground does and visibly fail when the ground is abandoned.
- **Interference:** it is the interference system. Fire conduit opening breaks
  a ward; Aurora reinforces one; its rim is its cost.

### The set

| System    | Medium                  | Domain                | Trope cluster                              |
| --------- | ----------------------- | --------------------- | ------------------------------------------ |
| Fire      | stone and fallen stone  | transform, extract    | forge, ore, volcano, star-metal            |
| Aurora    | ice                     | preserve, perceive    | scrying, memory, stasis, oracle            |
| Pressure  | deep water and its sky  | force, speak, weather | telekinesis, telepathy, drowned god, storm |
| Greenwood | sap and groundwater     | grow, heal            | druid, fae-wood, holy well, oasis          |
| Salt      | brine                   | blight, death         | necromancy, cursed ground, desert, mirror  |
| Veil      | the tear                | translocate, unmake   | portal, thin place, wild magic, the Blight |
| Hallowed  | the kept route and line | sanctify, bind        | holy ground, ward, rune, geomancy, border  |

## Source attributes the consolidation needs

The current schema gives a system one source strategy, one propagation, one
effect set, and gives a placed source a position, radius, strength, start epoch
and effect name. The seven need a little more on the source.

- **Origin.** A system can locate sources of more than one origin (Fire: vein,
  fallen; Greenwood: stand, spring; Salt: death, dead lake). Each origin names
  its own locate rule and its own propagation; effects stay per system. This
  replaces the single propagation per system with one per origin.
- **Renewal.** How a source's stock behaves across epochs: conduit-fed (vein
  Fire), accumulating (Aurora), continuous (Pressure, springs), finite (fallen
  Fire, a dead lake's crust), kept (Hallowed, decaying when abandoned),
  emergent (Veil, existing only while its parents interfere). Today only the
  conduit budget and storage decay express this.
- **Shape.** A source is a point with a radius today. Hallowed ward lines are
  lines; a Veil door is a pair of points with a connection between them. The
  authored-source record gains a geometry and an optional partner.
- **Derived sources.** Veil locates sources by reading other systems' intensity
  fields. Feature rules can already test `system:<id>` conditions; the source
  strategy needs the same read.

## Prerequisites

Two prerequisites are decided before Salt, Hallowed or Veil is built:

- **Society-sourced magic.** Salt's death origin and all of Hallowed are caused
  by people, so a magic system must be able to run after a human era. The magic
  phase vocabulary today names only the climate and post-glacial phases.
- **Nonlocal routing.** Veil doors require the routing graph to accept edges
  between non-adjacent located spaces.

Fire's fallen origin, Pressure's weather and Greenwood fit the existing source,
propagation and effect contracts once origins carry their own propagation.

## Candidate inventory

The ten candidates as first listed, and where each went.

| Candidate   | Trope cluster                       | Folded into             |
| ----------- | ----------------------------------- | ----------------------- |
| Greenwood   | life, druidic, fae-forest           | Greenwood               |
| Grave       | death, necromancy, cursed ground    | Salt                    |
| Gale        | storm, weather, air                 | Pressure                |
| Doors       | portals, thin places, otherworld    | Veil                    |
| Starfall    | celestial, star-metal, omen         | Fire (fallen origin)    |
| Hallowed    | divine, holy ground, wards          | Hallowed                |
| Wellwater   | healing, holy wells, water of life  | Greenwood (spring)      |
| Bound lines | runic warding, geomancy             | Hallowed (ward line)    |
| Wild zones  | chaos, mutation, the Blight         | Veil (unstable tear)    |
| Salt        | desert, glass, mirror, salt-binding | Salt (dead-lake origin) |
