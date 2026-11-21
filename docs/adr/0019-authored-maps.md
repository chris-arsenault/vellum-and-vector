# 0019 — Authored maps: blank ocean, GIS authority, one command set for UI and agents

The owner's 2026-11-21 direction: after generation work, build authoring of every level —
world, region and city — starting from a blank all-ocean map, with light or no procedural
generation. The same operations are offered to agents over MCP. Generation merging with
authoring, multi-user editing and image overlays are later work. This lifts the 2026-10-28
deferral of World and Region authoring that [ADR 0016](0016-real-scale-maps.md) left in place.

## Context

A finished map is a GIS store: vector layers plus one terrain raster that the viewer draws
(`terrainBands` in `packages/map/src/terrain.ts`: height, coverage, water class, ice, surface
class, gradients and paint). Presentation, inspection, export and saving read only that store
([ADR 0015](0015-finished-maps-and-execution-hosts.md)). Real-scale authoring already rewrites
vector features through one command path (`atlas-map` `EditCommand`, `atlas-gis` `EditStore`)
with undo. What was missing is a map that starts without generation and a way to author the
terrain raster.

## Decision

**An authored map is an ordinary published map.** It begins as the publication of an all-ocean
source: a descriptor, the vector layers of its profile and a terrain raster. It has no
numerical generation state. Its GIS layers are its authority from the start. Viewing,
inspection, export, saving and refinement read it as they read any other map.

**Coast polygons are the authority for land and sea.** Land is drawn as polygons with
identity. The terrain raster follows them: outside every coast the height lies below sea
level, inside it lies above, with a shore transition. A coast with no sculpting still reads
as low land.

**Elevation is the one authored raster.** The terrain raster's height is edited by a brush
and by height shapes: guide lines with heights, and features such as mountain areas and peaks
that carry height. Every other terrain band (relative height, water class, gradients,
display height) is derived from the height and the coasts when the raster is written.
Rivers are plain line features and never change height. No other raster is authored.

**One command set.** Vector edits stay `EditCommand` in `atlas-map`/`atlas-gis`. Terrain
edits are a second command family handled in `atlas-host` beside structure-map calls, because
writing the raster needs the publication codec in `atlas-generation` that `atlas-gis` must not
depend on. An edit that touches both a coast and the terrain applies as one undoable step.
The UI and the MCP server both call that surface; MCP adds no domain logic.

**Places.** Every feature kind in the publication catalogue is placeable. The catalogue is the
only list of kinds; palettes and the MCP kind listing read it.

## Alternatives

- Treat elevation as vector zones, ridges and peaks only. Rejected: the viewer draws relief
  and contours from a raster, and a second relief renderer would duplicate it.
- Let a generated map become editable at its first edit, as real-scale maps do. Rejected for
  World and Region: it drags numerical state into authoring. Generation on an authored map is
  later work.
- Carve valleys along drawn rivers. Rejected by the owner.

## Consequences

- `editable()` in `atlas-map` accepts authored maps in addition to real-scale ones; world and
  regional maps from generation stay read-only.
- The raster is rewritten when a stroke or height shape commits; the stroke previews in the
  client first.
- Parent-to-child refinement from an authored map is out of scope until generation joins
  authoring.
