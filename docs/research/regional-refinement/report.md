# Regional map refinement: problem, investigation and research

Prepared 2026-10-31 for review by a non-coding agent. Images are in `images/` next to this
file. Captions that quote the product owner are marked "Owner"; everything else is the
writer's description.

The report has three independent parts:

1. **Problem statement.** What the product owner asked for and what they saw, mostly in their
   own words.
2. **Investigation.** How the current system works and why it produces what the owner sees.
   It covers the work of two coding agents: Codex (Oct 29–31) and Claude (Oct 31).
3. **Research.** Which established techniques fit the problem, from terrain-synthesis
   research, geomorphology and cartographic generalization, and how they could be put together.

Each part can be read without the others. The investigation's conclusions do not depend on
the research section.

---

## Part 1 — Problem statement

### 1.1 The product

Vellum & Vector is a browser atlas for building fictional worlds used in tabletop roleplaying
games (TTRPGs). It first generates a whole world: plate tectonics, climate, hydrology, biomes,
peoples, history and magic, simulated on a mesh of about 60,000 cells. The default world is
4,000 × 3,000 km, so each world cell is roughly 14 km across.

A user can then select a **region** (about a twelfth of the world's land) and **refine** it.
That creates a separate child map, sampled at about 2.4 km. A region can be refined again,
with each level dividing into roughly 8–12 sub-regions.

Owner, on what the product is for:

> "the generation product is only there to create an intresting map to work on. it is not the
> main purpsose. there gis and numerical layers are all there to create world history. once the
> history is created it does not need to be coherenrt udner revision. the ENTIRE purpose of
> this product is to generate maps that would be used in a TTRPG where shit like numerical
> accuracy of elevation models does not matter"

On the relation between parent and child maps:

> "i expect the smaller refined maps to be fully seperate map sharing a coridnate system and
> world history, not that the refinment of a region would effect the larger world."

> "i DO NOT WANT there to be preservation of elevation across regions."

> "the land does not need to match between seperate regional refinments"

On what refinement should do:

> "what i expect to happen is that after selecting a region to edit refinment is done at the
> new selected scale (e.g. on a stnadard world squares were orignally 200kmsq, now they are at
> ~1.5kmsq. things should be deformed and fractalized acording to pysical processes. we can
> extract the physical motivation into reusuable things, but we should not bre repated history
> and everything else"

> "real refinment would produce geoegraphically distinct items, not just make every edge
> noiser."

### 1.2 The two competing goals (Owner, latest message, verbatim)

> "there are two competing goals of the system
>
> 1. maps should look like the maps at all levels. real maps of the world don't go down into
>    micro details. autors take liberties with boundaries in order to draw a clear map. this isn't
>    the sataline view, it's the artist view. regional maps have more details not just because
>    they have more noise, but because more details are important. e.g. the missiipie and colorodo
>    river show up on a world map, but the verde river doesn't show up until you look at a arizona
>    map. lynx lake in prescott would only show up on a city map.
> 2. we need a complex geologic and numerical basis for these maps so there is authentistiy to
>    them, and we cannot generate that at the level of detail required for the entire world.
>    further, one of the eventual goals of this is collaberative map making, so diffrent people
>    could own diffrent regions."

> "you seem unable to really get itme 1 right. you are to fixated on the numbers"

Restated as requirements (the writer's restatement, to be checked against the quotes above):

- **R1. Cartographic map, not satellite image.** Each map level shows the features that matter
  _at that level's scale_. A feature appears on a map because of its importance relative to
  the map's extent, not because it passes a fixed size threshold. Boundaries and shapes can be
  simplified or exaggerated for clarity.
- **R2. New detail is new features, not more noise.** A regional map of a mountain range shows
  named peaks, valleys, passes and sub-chains that the world map summarized as "a range".
  The analogy: the Rockies on a world map; Mt. Elbert, Mt. Massive and Mt. Harvard on a
  Colorado map.
- **R3. Physical authenticity.** Features have geological and hydrological causes. A lake sits
  where there is a reason for a lake. Rivers follow the terrain. Towns sit where people would
  settle.
- **R4. Detail is generated on demand.** The world simulation cannot run at fine resolution
  everywhere. Fine detail is produced only for the region being refined.
- **R5. Regions are independent maps.** Parent and child share a coordinate system and world
  history. Nothing propagates back to the parent. Parent elevations need not be preserved.
- **R6. Collaboration (future).** Different people may own and refine different regions. This
  implies each region's refinement should depend on the shared parent and the region's own
  seed, not on a neighbour's refinement.
- **R7. Performance.** World generation and region creation/boundary finding are fast today
  and should stay fast.

### 1.3 What the owner has observed

Figures 6–17 come from builds made by Codex. Figures 1–5 come from Claude's replacement,
commit `bcca3a6`.

#### Latest build (Claude, `bcca3a6`)

![Figure 1](images/01-latest-regional-habitats.jpg)
**Figure 1.** Latest regional map with the habitat layer. Owner: "thjings are 'better'".

![Figure 2](images/02-latest-second-view.jpg)
**Figure 2.** Second image the owner sent with the comment "thjings are 'better'". It
appears to show a smaller landmass at a coarser level (writer's reading; not confirmed).

![Figure 3](images/03-latest-rivers-ridge-towns.jpg)
**Figure 3.** Latest regional map with rivers in red and elevation shading. Owner:

> "rivers are way to even, cities are better ish … although many cities are built into very
> steap cliff sides. there is no headland lakes. the elevation is till just noise - the
> regional map her represents a mountain range. it more or less looks appropraite for a world
> scale map, at world scale you see the rockies, not like elbert, massive, havard. but at the
> regional level major peaks should start to appear, and this is just one giant ridgeline"

![Figure 4](images/04-agent-render-relief.jpg)
**Figure 4.** Claude's own test render of a generated region, relief only. Each world-scale
high area becomes one dome, with a comb of nearly parallel gullies running straight down
every flank. There are no separate summits, cols or cross-valleys.

![Figure 5](images/05-agent-render-overview.jpg)
**Figure 5.** The same region with rivers and settlements. The rivers are a series of similar,
evenly spaced streams.

#### Earlier builds (Codex)

![Figure 6](images/06-codex-ranges-noisier.jpg)
**Figure 6.** Owner: "ranges look more spiky, but they do not look more realistic. there are
not more individual peaks. there are not valleys and passes and chains of mountsin. the
existing toplogies just look noiser. … this isn't refiniemtn, it's just adding a lyer of
noise."

![Figure 7](images/07-codex-towns-equidistant.jpg)
**Figure 7.** Owner: "towns are marginall better, but they seem to be spaced equidstnaatly,
not on geographically relevant features."

![Figure 8](images/08-codex-lakes-everywhere.jpg)
**Figure 8.** Owner: "there are still a fuckload of lakes everywhere"

![Figure 9](images/09-codex-too-many-rivers.jpg)
**Figure 9.** Owner: "i increased the line width of rivers to make them visible - there are a
shitload on this map still"

![Figure 10](images/10-parent-rock-barren.jpg)
**Figure 10.** The parent (world) map of a refined region. Owner: "originally this was lableld
as a range and rock barrens, with a few loose rivers and a larger one kindda in the middle.
what i would expect to see happen here is maybe some larger lakes pop up - sources of the
rivers, damns, whatever. but not a bunch of small ones. that's not really what a rock barren
is"

![Figure 11](images/11-codex-other-landmass-lakes.jpg)
**Figure 11.** Owner: "similar over on this other landmass"

![Figure 12](images/12-codex-elevation-not-fixed.jpg)
**Figure 12.** Owner: "elevation is not fixed". Speckled pits and lakes cover the land, and
the contours are ragged.

![Figure 13](images/13-codex-forest-holes-a.jpg)
![Figure 14](images/14-codex-forest-holes-b.jpg)
**Figures 13–14.** Owner: "the gaps here are less obviously lakes … in this view they look
more like holes in the forest. there are still for sure too many rivers for this zoom level.
and the patchiness is not good."

![Figure 15](images/15-codex-contours-good.jpg)
**Figure 15.** An earlier Codex build. Owner: "the elevation contours actaully look pretty
good!! but everything else doesn't". The cover is still in parent-sized squares.

![Figure 16](images/16-codex-clutter.jpg)
**Figure 16.** Owner: "the clutter is still insane"

![Figure 17](images/17-codex-cold-desert-marsh.jpg)
**Figure 17.** Owner: "the 'cold desert' became mostly a huge inalnd marsh … i would've
expected the coast to become marshy, the south east to become mountainous, and the desert to
remain desert."

### 1.4 The owner's question

> "are you even aware of what algorithms and techniques you should be using? does the
> generation not provide the correct data to work from?"

> "i think this needs a fundemtal change in approach, or, your latest change replaced some
> wrong and complex with something more accurate and simplisitc."

---

## Part 2 — Investigation

This part describes how the code currently works. It names the conceptual errors behind both
agents' attempts and answers whether the world generation supplies the data refinement needs.

### 2.1 Summary of findings

1. **Both agents treated refinement as a resolution problem, and the owner asked for a
   representation problem.** Each attempt asked "what does the ground look like at 2.4 km?"
   and then drew everything above a fixed threshold. The owner asked "what features matter on
   a map of this region?" A satellite-style answer is wrong for the product even when it is
   physically plausible. This is the owner's goal 1, and neither agent addressed it directly.
2. **The terrain method cannot create peaks.** The current method only cuts valleys into a
   smoothed copy of the parent surface. A parent elevation is an average over a ~14 km cell.
   Real summits stand well above that average and real valleys cut well below it. A method
   that only lowers the surface, and is pulled back to the averaged parent, can only produce
   one smooth dome per parent high with gullies on its flanks (Figures 3–4).
3. **River and lake rules use absolute thresholds, so density is uniform.** A stream is drawn
   wherever its catchment passes a fixed number of map samples. On a smooth dome, that
   creates evenly spaced parallel streams (Figures 3, 5). Lakes were first created by noise
   (Codex: too many, Figures 8–12). Claude then forbade them unless the parent had one (none
   in headwaters, Figure 3). Neither rule asks _why_ a lake would be there.
4. **The world generation already holds most of the causes, but refinement ignores them.**
   Glacial erosion history, tectonic strain, landform classes, world-published peaks, ranges
   and cirques, and a relative-significance model for publishing features all exist at world
   scale. Regional terrain reads none of them.
5. **Some needed data is missing.** The world does not record the structural grain of a
   mountain range (its strike direction and how it is made: fold belt, volcanic arc, fault
   block). It does not record how rugged the ground is inside a cell. And it does not give
   features a rank that persists across map levels.
6. **Settlements:** inherited towns keep their exact parent coordinates, which were chosen on
   a 14 km grid. On a 2.4 km map those points can fall on steep slopes. New villages are
   placed by a fixed spacing rule, which produces a lattice (Figure 7). Both are verified in
   code. Which of the cliff-side towns in Figure 3 are inherited and which are new has not
   been checked.
7. **Process failure:** both agents judged success by counts, timings and unit tests (no pits,
   fewer rivers, fast enough). Those numbers could pass while the map still looked wrong. The
   owner's "too fixated on the numbers" is accurate.

### 2.2 How refinement works today (`bcca3a6`)

The parent world's raster fields are sampled onto a regular grid for the region:
elevation, rock, fracture, glacial erosion, tectonic strain, ice, temperature, rainfall,
runoff, soil, cover classes, flow, river order, population, magic and others. Parent features
(rivers, towns, peaks) come along as vectors. The stages then run in this order:

| Stage     | What it does now                                                                                                                                                                                                                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Terrain   | Blurs the parent surface to remove its patch seams. Adds small fractal roughness, scaled to 0.3 × the local parent relief. Runs 48 steps of a river-incision plus hillslope-smoothing model that is pulled back toward that target every step. Fills every closed hollow except where the parent had a lake. |
| Water     | Routes flow downhill. Marks a river wherever the catchment exceeds a fixed size (128 map samples, about 740 km² at the first level, scaled by local runoff). Rejects sheet flow and very short headwaters.                                                                                                   |
| Geography | Turns river cells into line features: one per stream, from its source to the river it joins.                                                                                                                                                                                                                 |
| Landforms | Classifies ridge, valley, peak and pass from the new surface. Publishes peaks by prominence.                                                                                                                                                                                                                 |
| Cover     | Keeps the parent's cover class, with the class edges warped smoothly. Changes it only for cold new peaks, floodplains, coastal flats, steep bare ground and lakes.                                                                                                                                           |
| Places    | Keeps inherited towns at their parent coordinates. Adds villages where population supports them: best site class first, with a minimum spacing between villages. Connects them with least-cost paths.                                                                                                        |

Codex's earlier pipeline (Figures 6–17) differed mainly in two ways. Its terrain was
"interpolated parent + noise + local incision". It derived water, lakes and cover from
thresholds on that noisy surface, so every noise hollow became a lake and every noise channel
became a river.

### 2.3 Symptom by symptom

**"One giant ridgeline", no individual peaks (Figures 3, 4, 6).**
The parent stores one elevation per ~14 km cell, which is in effect a mean surface. A mountain
range at that scale is a smooth bump a few cells wide. Both pipelines treat that bump as the
shape to keep and only add small perturbations to it.

- Codex added noise, so the bump became noisier (Figure 6).
- Claude added incision. Incision only removes material, and the restoring pull keeps the
  surface near the averaged bump, so the bump gained gullies (Figure 4).

Neither can raise a summit 500–1,500 m above the parent mean, as real massifs stand above
their range's average. Neither places cols between summits, or longitudinal valleys that
split a range into sub-chains. A uniform uplift field with uniform erodibility on a smooth
dome is also the textbook setup for _consequent_ drainage: streams run straight down the
slope, roughly parallel or radiating. That is exactly what Figures 3–5 show.

**"Rivers are way too even" (Figures 3, 5) and earlier "a shitload of rivers" (Figures 9, 13).**
Both pipelines decide whether to draw a stream with an absolute catchment threshold, measured
in samples of the current map.

- Codex's threshold was low, so every sliver of flow was drawn.
- Claude's threshold is higher and the same at every level, so a map draws every stream above
  one size.

On uniform terrain under uniform rain, catchments reach that size at regular intervals, so the
drawn streams are evenly spaced. Real valley spacing is in fact fairly regular at a given
scale (Perron et al. 2009, in Part 3). Real maps do not look regular because cartographers
_select_: the large rivers, then the ones that matter locally, with density varying by climate
and rock. Neither pipeline selects. There is also no carry-over of identity: a world river
does not keep its name, and the regional map has no notion of "this is the Verde, the next
tier down from the Salt".

**Lakes: too many (Codex), then none in the headwaters (Claude).**
Codex's lakes were hollows in the noise (Figures 8, 11, 12). Claude's rule removes every
hollow unless the parent had a lake there. Both are size or provenance rules, and neither is
a cause. The owner's rock barren expectation is a few larger lakes at river sources (Figure
10). That is what glaciated mountain terrain has: cirque tarns, chains of lakes in glacial
valleys, lakes behind moraines. The world generation records cumulative glacial erosion and
ice thickness (`glacialErosion`, `iceThickness`). Refinement samples both fields and uses
neither when deciding where lakes form.

**Cities on steep cliff sides (Figure 3).**
Inherited towns are copied to their exact parent coordinates and never re-sited. Those
coordinates came from a 14 km grid. On a 2.4 km map they can land on a valley wall. The owner
has said the child need not match the parent, so moving a town to the best site within its
parent cell is allowed. Newly added villages reject slopes above 0.12 (about 7°), but the
slope is measured per 2.4 km sample, which smooths out cliffs.

**Towns evenly spaced (Figure 7) and "cities are better ish" (Figure 3).**
New villages are chosen best-site-first, then excluded within a fixed spacing of any existing
seat. With a uniform spacing rule, the result tends toward a lattice. Real settlement patterns
are clustered along valleys, coasts, river crossings and confluences, and are sparse elsewhere.

**Cover: patches, holes and the cold-desert marsh (Figures 13–17); "keep the parent class"
rejected by the owner.**
Codex re-derived cover from thresholds on noisy refined fields, which produced patches and
the inland marsh. Claude's fix kept each sample's parent class. That removes the errors but
also removes the detail. A world-scale "forest" cell is a summary of a mosaic: forest with
river meadows, rock outcrops and alpine ground above the tree line. The refined map should
reveal that mosaic, driven by the new terrain: elevation zones, valley floors, slope
direction and drainage. It should not repaint the summary label.

### 2.4 Does the world generation provide the right data?

Mostly yes, but refinement uses little of it.

| World data                                                                                        | Present at world scale                              | Used by refinement terrain/water/lakes                              |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------- |
| Elevation                                                                                         | yes                                                 | yes (as a surface to keep)                                          |
| Rock type, fracture                                                                               | yes                                                 | yes (erodibility only)                                              |
| Rainfall, runoff, temperature                                                                     | yes                                                 | yes                                                                 |
| Tectonic strain                                                                                   | yes                                                 | **no**                                                              |
| Cumulative glacial erosion, ice thickness                                                         | yes                                                 | **no** (only published or used for magic)                           |
| Landform class (range, plateau, valley …)                                                         | yes                                                 | **no** (re-classified from the new surface)                         |
| Published world peaks, ranges, cirques, fjords                                                    | yes                                                 | **no**                                                              |
| Published world rivers (named, with discharge)                                                    | yes                                                 | only as discharge entering at the frame edge; names are not carried |
| Relative feature significance (e.g. landscape share of the world extent)                          | yes, for world publication (`worldSignificance.ts`) | **no** — regional uses absolute thresholds                          |
| Range structure: strike direction, range type (fold belt, volcanic arc, fault block), main divide | **not recorded**                                    | —                                                                   |
| Ruggedness inside a cell (relief within a world cell)                                             | **not recorded**                                    | —                                                                   |
| Feature rank that persists across map levels                                                      | **not recorded**                                    | —                                                                   |

The missing items are the ones that would let a regional map lay out _distinct_ peaks,
divides and valleys in the right orientation. The unused items are the ones that would give
lakes and peaks their causes.

### 2.5 Why the iterations kept missing

- **The target was implicit.** No written description of a correct regional map existed, so
  each iteration fixed the last complaint: too many lakes became no lakes, too many rivers
  became fewer evenly spaced rivers.
- **Validation by numbers.** Tests asserted no pits, bounded counts and timings. None asserted
  what the owner judges: distinct summits, varied drainage density, lakes with causes,
  settlements at sites.
- **Simulation as the answer to goal 1.** Physical simulation gives authenticity (goal 2).
  It does not decide what to _show_ (goal 1). Both agents expected a better simulation to
  produce a better map. Cartographic selection is a separate step with its own rules.

---

## Part 3 — Research: techniques that fit this problem

### 3.1 Terrain amplification: adding real structure under a coarse surface

This is a well-studied problem in computer graphics under the name _terrain amplification_.
A useful survey is Galin et al., "A Review of Digital Terrain Modeling", _Computer Graphics
Forum_ 38(2), 2019 (Eurographics STAR). The main families:

- **Uplift + stream-power erosion.** Cordonnier, Braun, Cani, Benes, Galin, Peytavie and
  Guérin, "Large Scale Terrain Generation from Tectonic Uplift and Fluvial Erosion", _CGF_
  35(2), 2016. The input is an _uplift map_, not a height map. Erosion acting against uplift
  produces ridges, summits, cols and dendritic valleys, and the elevations are an output.
  The key difference from the current code: here the coarse map controls _uplift_, and the
  heights, including summits above the mean, are produced by the process. The current code
  holds heights to the coarse surface, which prevents that.
- **Multi-scale erosion amplification.** Schott, Galin, Guérin, Peytavie and Paris, "Terrain
  Amplification using Multi-scale Erosion", _ACM TOG_ 43(4), 2024 (SIGGRAPH). This turns a
  low-resolution terrain into a high-resolution one that stays hydrologically consistent. It
  runs fast approximations of thermal, stream-power and deposition processes at successive
  scales. This is the closest published match to "refine a region from its parent".
- **Orometry: peaks and saddles as the skeleton.** Argudo, Galin, Peytavie, Paris, Gain and
  Guérin, "Orometry-based Terrain Analysis and Synthesis", _ACM TOG_ 38(6), 2019 (SIGGRAPH
  Asia). From a coarse elevation map, it first builds a _graph of peaks and saddles_ whose
  prominence and spacing follow statistics measured on real mountain ranges. It then fills in
  a continuous surface with a river network. This directly answers "major peaks should start
  to appear": peaks are generated as features with prominence, not hoped for from noise.
- **Hydrology first.** Génevaux, Galin, Guérin, Peytavie and Beneš, "Terrain Generation Using
  Procedural Models Based on Hydrology", _ACM TOG_ 32(4), 2013. It generates the river network
  first, with Horton–Strahler ordering and watersheds, and builds terrain around it.
  Cartographic river selection then follows from the river hierarchy itself.
- **Procedural dendritic patterns.** Gaillard et al., "Dendry: A Procedural Model for Dendritic
  Patterns", I3D 2019. It evaluates branching valley patterns locally from a seed. That is
  useful when regions must be generated independently and stay deterministic (R6).

### 3.2 Geomorphology that should drive the parameters

- **Valley spacing.** Perron, Kirchner and Dietrich, "Formation of evenly spaced ridges and
  valleys", _Nature_ 460, 2009. At a given scale, the competition between channel incision and
  soil creep fixes a characteristic valley spacing. So regular spacing _within one tier_ is
  realistic. What makes real maps look irregular is the hierarchy of tiers and the
  cartographer's selection, not randomness in the ground.
- **Range structure.** Real ranges are not one dome. A fold-and-thrust belt has parallel ridges
  and long valleys along its strike (trellis drainage), cut across by gorges. A volcanic arc
  has discrete cones. A fault-block range has one steep front and one gentle back slope. This
  structure follows the tectonic setting, which the world simulation knows (plate motion,
  strain, volcanism) but does not hand to refinement.
- **Lakes have causes.** In mountains these are mainly glacial:
  - cirque tarns behind a rock lip or till dam;
  - chains of lakes down stepped glacial valleys;
  - long lakes in over-deepened troughs behind moraines.
    Other causes are tectonic basins (grabens), landslide dams, karst and volcanic craters.
    Lake _density_ is high in recently glaciated hard rock and near zero in unglaciated dry
    ranges. That density can be read from the world's glacial-erosion, ice-history and rock
    fields.

### 3.3 Cartographic generalization: what to show at each level

This is the core of goal 1. Cartographers have formal methods for it.

- **Principle of Selection (Radical Law).** Töpfer and Pillewizer, "The Principles of
  Selection", _The Cartographic Journal_, 1966. The number of features shown scales with the
  square root of the scale ratio. For the same piece of ground, a child map at about 6× finer
  scale shows roughly √6 ≈ 2.4× as many features as its parent does. That is far fewer than
  the 36× more raster samples it has. The law gives _how many_ to keep, not _which_.
- **Selection by upstream drainage area, stratified by local density.** Stanislawski, "Feature
  pruning by upstream drainage area to support automated generalization of the United States
  National Hydrography Dataset", _Computers, Environment and Urban Systems_ 33(5), 2009. The
  USGS prunes rivers by drainage area. It does this separately in each sub-basin, with a
  target density for each, so wet dissected country stays denser than dry country _after_
  generalization. That is the direct fix for "rivers way too even".
- **Rank attributes for zoom.** Natural Earth publishes `scalerank` and `min_zoom` on rivers
  and lakes: a curated rank of how important each feature is regionally. A renderer shows
  features down to the rank that fits the zoom. The atlas needs an equivalent: each feature
  carries a rank that is stable across map levels. The world map shows ranks 1–2; a region
  shows ranks 1–4, and so on. The Mississippi/Verde/Lynx Lake example from the owner is
  exactly this.
- **Exaggeration and simplification.** Cartographic relief traditions (e.g. Imhof,
  _Cartographic Relief Presentation_) emphasise main ridgelines, named peaks and passes, and
  suppress the rest. A peak earns a symbol and a name by prominence relative to the map's
  extent, not by being any local maximum.

### 3.4 Settlement siting

Standard settlement geography distinguishes the _site_ from the _situation_:

- **Site factors:** a reliable water source (wet point); dry ground in marsh or floodplain
  (dry point); a ford or bridging point; a defensible hill or river bend; shelter; flat land.
- **Situation factors:** river confluences, valley junctions and gaps through ranges where
  routes meet; the lowest bridging point of a river; coastal harbours.

A refined map should first find these _sites_ as features of the new terrain (confluences,
valley mouths, fords, passes, lake ends, harbours). It should then fill them in order of
rank, and thin them by hierarchy (a market town's hinterland), not by a fixed spacing.
Inherited towns move to the best such site within their parent cell.

### 3.5 Putting it together: a candidate architecture

This is a recommendation for discussion. It is not a decided design.

1. **The parent supplies a specification of causes, not a surface to keep.** For each region,
   the parent provides uplift or relief intent (from elevation and tectonic strain), range
   type and grain, rock, climate, glacial history, named features with their ranks, and
   boundary conditions: where rivers, ridges and roads cross the region's edge. Elevation is
   a hint, never a constraint.
2. **Skeleton first.** Place the next tier of named features as structure before any raster:
   - peaks and saddles with prominence following an orometric distribution, laid out along
     the range's grain;
   - the main divide and sub-chains;
   - valley trunks that connect to the inherited rivers and their edge crossings.
     _(Orometry, hydrology-first methods.)_
3. **Physics fills between the skeleton.** Uplift from the skeleton plus stream-power and
   hillslope processes produce the continuous surface. Summits come out above the parent mean
   and valleys below it. _(Uplift + erosion; multi-scale amplification.)_
4. **Causal features.** Lakes are placed where a cause exists: glacial overdeepening and
   cirques where glacial erosion was high, tectonic basins, and dams. Cover reveals the mosaic
   inside each parent class, driven by elevation zones, valley floors, slope and drainage.
5. **Cartographic selection.** Every feature gets a rank. Each map draws only the tiers that
   fit its scale, with counts guided by the Radical Law. Density targets are set per
   sub-basin, so dry country stays sparse. Inherited features keep their names and ranks;
   new ones get the next ranks.
6. **Independence for collaboration.** A region's output depends only on the parent
   specification, its seed and its boundary conditions. Two neighbouring regions agree at the
   edges because they share the parent's crossing points, not because either reads the other.

Expected cost: the skeleton and selection steps are graph operations on hundreds to thousands
of features and are cheap. The physics step can reuse the existing solver, run with uplift as
its input instead of being pulled back to a target. Region creation and boundary finding
are untouched.

### 3.6 Open questions for the owner

1. **Rank across levels.** Should a feature's rank be assigned once, when it is first created,
   and inherited by every deeper level? Or re-judged on each map relative to that map's
   extent? The Natural Earth practice is a stable rank.
2. **Data additions.** Is adding range type and structural grain to the world output
   acceptable? These would come from tectonic history the simulation already runs.
3. **Exaggeration.** May the regional map exaggerate relief for legibility, for example by
   making the main peaks more prominent than physics alone would?
4. **Acceptance.** The owner's judgement of rendered maps has been the real test. A short
   written checklist would give future iterations a target that is not a count. For example:
   distinct named summits on a range; drainage denser in wet country than dry; lakes only
   with a visible cause; settlements at confluences, crossings and coasts.

---

## Sources

- Galin et al. 2019, "A Review of Digital Terrain Modeling", CGF 38(2) —
  https://diglib.eg.org/handle/10.1111/cgf13657 ; PDF https://www.cs.purdue.edu/homes/bbenes/papers/Galin19CGF.pdf
- Cordonnier et al. 2016, "Large Scale Terrain Generation from Tectonic Uplift and Fluvial
  Erosion", CGF 35(2) — https://diglib.eg.org/handle/10.1111/cgf12820 ; PDF https://www.cs.purdue.edu/homes/bbenes/papers/Cordonier16CGF.pdf
- Schott et al. 2024, "Terrain Amplification using Multi-scale Erosion", ACM TOG 43(4) —
  https://h-schott.github.io/publications/mserosion/publi_mserosion.html
- Argudo et al. 2019, "Orometry-based Terrain Analysis and Synthesis", ACM TOG 38(6) —
  https://pubs.cs.uct.ac.za/id/eprint/1342/
- Génevaux et al. 2013, "Terrain Generation Using Procedural Models Based on Hydrology",
  ACM TOG 32(4) — https://www.cs.purdue.edu/homes/bbenes/papers/Genevaux13ToG.pdf
- Gaillard et al. 2019, "Dendry: A Procedural Model for Dendritic Patterns", I3D —
  https://cs.purdue.edu/cgvlab/www/publications/Gaillard19I3D
- Perron, Kirchner & Dietrich 2009, "Formation of evenly spaced ridges and valleys", Nature
  460 — https://dspace.mit.edu/handle/1721.1/64681
- Töpfer & Pillewizer 1966, "The Principles of Selection" (Radical Law); discussion in Jiang,
  https://arxiv.org/pdf/1102.1561
- Stanislawski 2009, "Feature pruning by upstream drainage area …", CEUS 33(5) —
  https://www.usgs.gov/publications/feature-pruning-upstream-drainage-area-support-automated-generalization-united-states ;
  stratified density comparison https://kartographie.geo.tu-dresden.de/downloads/ica-gen/workshop2011/genemr2011_Stanislawski.pdf
- Natural Earth river/lake rank attributes (`scalerank`, `min_zoom`) —
  https://deepwiki.com/elastic/natural-earth-vector/4.3-physical-features
- Glacial lakes and overdeepening — https://en.wikipedia.org/wiki/Overdeepening ;
  https://en.wikipedia.org/wiki/Glacial_landform
- Settlement site and situation — https://geographyfieldwork.com/SiteSituation.htm
