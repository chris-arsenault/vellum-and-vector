# Real-scale generation: status and problems

Written 2026-11-17, after commit `fbf8958` reached `main`. It covers generated land on
real-scale maps (ground, water, rock, cover, trails, caves and towns), not the editing
tools.

## Short version

All the planned real-scale code is in `main` and every automated check passes. But no
real-scale map generated so far has been acceptable, and none has been generated since
most of the fixes went in. Real-scale land is made by running the regional development
pipeline, three rounds of world-scale erosion, water and people's effects, on a map a few
kilometres across. Most of the bad results traced back to that choice and were patched
one by one. The patches are tested, but not judged on a map. Generation is also too slow:
8 minutes for a 5 km map and 53 minutes for a 24 km map on the server.

## What generation does now

1. **Capture.** Opening a real-scale map from a place captures the parent's context inside
   the map's frame and publishes the child at once. On this first publication the child
   is cropped from the parent's own rasters, whose pixels are about 14 km across on the
   local test world. So the child first appears as one or two flat parent pixels.
2. **Generate.** Generating the child runs the regional development pipeline: relief
   detail, then three rounds of runoff, river courses, incision, hillslopes, sediment, ice,
   ecology and people's effects. After the rounds come the finishing steps for water and
   landforms, then places.
3. **Real-scale steps.** After that come the real-scale steps: caves, names, the town
   layout, pools, exposed rock and cliffs, trails, fords and bridges at crossings, and
   single trees, shrubs, boulders and reeds on maps with hexes of 10 m or less.

Underneath, the map is measured at real size, so channel widths, place thresholds and
object sizes are metres, not fractions of the map.

## What generated maps actually showed

Every check used the local atlas: the native server and database, on a kept
1,000 × 750 km world.

**First map: Ajarma, 5 × 3.75 km, 100 m hexes.** It took 480 seconds.

| What appeared | What was wrong |
|---|---|
| A T-shaped band of lake about 1 km wide, covering 573 of the 2,171 hexes | The parent's valley had been cut into the child as a flat-floored trench 150 m deep, at full depth on every cell, along the parent's straight river lines. Water pooled in it. |
| A town of 99 buildings | Ajarma has 22,420 people. Its main streets stopped at the trench, so few lanes and homes fitted. |
| 853 identical rectangular fields in rigid rows | Fields came from one grid laid over the whole map. |
| No caves, and a hex catalogue that counted 0 hexes | Ajarma's ground holds no cave-forming rock. The count is a separate publishing bug, still open. |

**Same map after the first fixes.** The trench became a sloped valley that drains.
The river wandered. The town had 3,742 buildings on 534 streets, and the fields became
varied blocks with strips near the town. New problems showed up:

- **Town at the edge.** The river bend moved the town about 1.75 km, to the map's west
  edge, because the bend wasn't anchored at the map's centre.
- **Floating fields.** Fields floated as separate patches with gaps between them.
- **Starburst town.** The town's growth ran out as long spokes.
- **River ends early.** One river ended about 1 km short of the map's edge.

**Volcanoes near Goshi, 24 × 18 km, 300 m hexes.** It took 53 minutes, and found
caves: 238 caves, 187 lava tubes, 51 fissures, 299 shafts and 364 entrances. It also
showed three faults:

- **Caves outside the map:** caves and entrances were placed in the lattice margin
  outside the map's frame.
- **Fields everywhere:** with no settlement in the frame, the fields code used the map's
  centre as a town. That covered the map with about 4,200 fields and a ring of strips.
- **Speed:** each development round took about 14 minutes, against about 1.5 on the
  5 km map.

**Goshi, 5 km, 100 m hexes, after the cave and field fixes.** It had 13 caves, 13 lava
tubes, 12 shafts and 12 cave mouths, all inside the frame, plus 136 scattered fields.

The owner judged none of these pictures acceptable. That judgement stands.

## What changed since those maps (code only, not yet seen on a map)

Fixes made after independent code reviews, each with a test that failed before it:

- **Rivers at real width.** On a real-scale map, rivers take their width from their own
  flow and the rock they run on. Before, widths were fractions of the map: about
  9·√(flow) metres on the test world, regardless of the bed. The land underneath (caves,
  trails, incision) now reads the same widths.
- **Places need a real size.** Passes, valleys, lakes, waterfalls and peaks must have a
  real size to appear, for example 15 m of prominence for a peak. Before, the limits were
  fractions of the map.
- **Parent geometry bent once.** Rivers, captured roads, settlements and outlines are
  carried from the parent through one smooth bend, anchored at the map's centre, then
  clipped to the frame. Towns stay on their rivers and roads still reach them.
- **Towns.** A town grows lanes only through open ground until its people are housed,
  and publishes any it can't house. Plots and fields stay out of rivers at their real
  width and off every road. Fields are blocks of varied size around scattered seeds,
  ploughed in strips near a town. With no town on the map, a block is farmed as often
  as the land's farmed share says.
- **Caves stay inside the frame.**

## Open problems, most important first

1. **The pipeline doesn't fit the job.** The regional pipeline treats every map as "the
   same kind of map of a smaller country" (ADR 0005): erosion, channel sizes and how much
   a process acts are all set as fractions of the map. Real-scale maps are meant to show
   things at their real size (ADR 0016). Measuring at real size fixes the units, not the
   processes. Three rounds of world-scale erosion and people's effects on a 5 km map is
   still the wrong model of how a glen or a river valley gets its shape. The trench,
   the straight rivers and the lakes were all symptoms of this, patched one at a time.
   A dedicated real-scale ground pipeline would take the parent's context as starting
   conditions, shape relief at real size, add water as lines with real widths, then
   cover, then people's features. It hasn't been designed.

2. **Too slow for normal use on the server.**
   - **Times:** 5 × 3.75 km took about 8 minutes; 24 × 18 km took 53 minutes.
   - **Cause:** the slowest steps (water development, people's effects on the land,
     river erosion) took 8 to 10 times as long on the 24 km map, with only about 2.6
     times the triangles. Smoothing repeats in proportion to the square of the parent's
     cell size over the triangle size. A shortcut skips that work when the parent's cell
     is wider than the whole map, which is true at 5 km and false at 24 km.
   - **Rasters:** each map also publishes 897 raster layers, which takes about a minute.
     Most of them, such as per-epoch magic stocks and every rock layer's attributes,
     mean nothing on a 5 km map.

3. **Nothing has been judged against a target.** There's no written description of what
   a good 100 m river map, 30 m village, cave level or 1.5 m glen should look like. Every
   number added for real scale is a first guess, never seen on a generated map:
   - the size thresholds for places;
   - how thin loose cover must be for exposed rock (0.3 m);
   - the trail costs;
   - the densities of trees, shrubs, boulders and reeds;
   - the field block size (about 220 m) and strip width (about 22 m);
   - how far carried rivers wander from the parent's lines (8% of the parent's cell
     size).

4. **The first look is a few flat pixels.** Under the new capture-then-generate flow, a
   real-scale child first appears cropped from 14 km parent pixels. That is honest about
   what the parent knows, but it's what a creator sees until generation finishes, and
   that takes minutes. Nobody has seen this end to end on the server yet.

5. **Smaller gaps in generation:**
   - **Way network not bent:** the parent's way network, as opposed to the road
     features, isn't bent, so travel calculations still use the parent's straight lines.
   - **Crossings unnumbered:** fords and bridges laid by the crossing step aren't
     numbered in the map key.
   - **Hex count:** the hex layer's catalogue counts 0 hexes.
   - **Not seen since:** the river that ended 1 km short of the edge hasn't been seen
     since the fixes.

6. **Browser generation of large maps fails, cause unknown.** A 24 × 18 km map failed
   in the browser with an engine exception that had no message. A native trace pointed
   to the browser engine running out of its 2 GB of memory, but that was never
   confirmed. No fix was kept.

7. **Outside real scale.** A 4,000 × 3,000 km Draft world with seed 42 fails natively
   with "Rivers: Geometry collapses at its declared precision", but generates in the
   browser. Not investigated.

## How the verification went wrong

- **Judging a half-built pipeline.** For a day, maps were generated and patched while
  water, rock, trails, cover and three tool milestones weren't built yet. Each fix cost
  an 8-to-50-minute run of every system at once.
- **Unreadable pictures.** The pictures came from the app's raw data view: shaded
  rasters, every hex outlined, all layers on and no legend.
- **Code reviews ran without a map.** The reviews found real defects, but none of the
  fixes has been seen on a map.
- **Now:** the code is complete and visual review hasn't started.

## Recommended next steps

1. **Write targets.** For each kind of real-scale map, describe what a good result looks
   like, with two or three published tabletop maps as references, and agree them with
   the owner.
2. **Design the real-scale ground pipeline** as a short document before writing code:
   what it keeps from the parent, how relief, water, cover and people's features are
   made at real size, and which regional processes it reuses, if any.
3. **Check each part on its own, in seconds.** Give each generation part a quick check
   that draws only its own output on a simple made-up input, and iterate there.
4. **Fix the smoothing cost,** and publish only the raster layers a real-scale map uses.
5. **Then a full map,** drawn in the map presentation with a legend, one run per batch of
   fixes on the kept world.

## Where things are

- **Code:** `main`, commits `0a5a4ab` (local atlas), `a8c1f20` (valley, bend, fields,
  growth), `1a0f83b` (the remaining milestones and review fixes) and `fbf8958` (the
  merge with `main`).
- **Working plan:** `docs/REAL-SCALE-MAPS-PLAN.md`, whose M2 step notes 1–17 record each
  run and fix.
- **Harness:** `docs/local-atlas.md`. Its commands are `make local-up`,
  `make local-world`, `make local-real`, and `--until` to stop after a chosen stage.
