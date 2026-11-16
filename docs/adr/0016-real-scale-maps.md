# 0016 — Real-scale maps: hexes from triangles, generated land, GIS authoring

Owner direction recorded 2026-11-16. Adds real-scale map kinds beside the World and
Region maps of [ADR 0005](0005-scale-contract.md) and
[ADR 0008](0008-regional-refinement-is-conditioned-amplification.md), and lifts the
authoring deferral for those kinds only.

## Context

World and regional maps describe averages: a cell holds shares of cover, people and
materials, and a place on it stands for something somewhere inside. A tabletop creator
also needs maps where things are their real size: a forest trail, a glen, a canyon, a
cave, a town with streets and addresses, a building's floors. On those maps each hex is
one thing, and the creator builds on generated land with editing tools.

## Decision

**Kinds.** A real-scale map is a ground map (outdoor land, and underground spaces for
caves), a ground map carrying a settlement plan (streets, plots, buildings, addresses), or
a structure map (a building's levels). Villages, suburbs, towns and cities are one kind at
different density. A castle is a ground map whose buildings open as structure maps.

**Hexes are built from the shared triangles.** Every map, real-scale included, runs on the
one triangular lattice class. There is no hex lattice. The triangle corners fall into three
classes and every triangle has one corner of each; taking one class as hex centres groups
the six triangles around each centre into a hex, and these hexes tile the map. A hex whose
side is several triangle edges holds six times that number squared. The triangles stand on
a vertical edge, so the hexes are pointy-topped. The hex is the play and display unit; the
triangles inside it carry the generated detail. A creator chooses the hex size from a fixed
ladder declared in `crates/atlas-generation/src/atlas/resolution.rs`; the detail setting
chooses how many triangle edges make one hex side and never changes the hex size. The
ladder replaces the earlier fixed Local, Site and Interior cell areas.

**What a map can express is separate from what is generated.** Only the ground is tied to
the lattice. Water, ways, plots and fields, structures, objects and clutter, labels and
creator layers are free GIS shapes in metres: lines with a width at each vertex and
rotated outlines, drawn in a fixed order of kinds. Each hex takes its play marks from the
shapes that cover or cross it. Display, inspection, export and editing treat a shape the
same whoever made it. Generation fills the land and, on a settlement, the society
features generated there; clutter, furniture, decor and interior walls are authored.

**The parent supplies starting conditions.** A real-scale map captures its parent's
present context and generates from it. The only obligation is that major landmarks
([ADR 0006](0006-landmarks-are-injected-causes.md)) inside the map's frame appear and
roughly agree. Nothing is conserved, fitted or reconciled against the parent.

**Authoring is real-scale only and works on the 2D map.** The first edit makes the map's
published GIS layers its authority; generation no longer rewrites it. Authored features
are ordinary GIS features with identity, attributes and relations, and editing reshapes
them under that identity, so a dragged river stays one river and its bridge stays on it.
Tools read published layers, including the context rasters, never private generation
resources ([ADR 0015](0015-finished-maps-and-execution-hosts.md)). World and regional
maps stay read-only. A static markup overlay with no map interaction is later work.

## Alternatives

- A hex lattice for real-scale maps. Rejected by the owner: the lattice is triangular so
  that hexes can be built from it.
- One map type per scale band. Rejected: the kinds follow what a creator places, not
  the size of the hex.
- Settlement plans as their own map. Rejected: a town's streets need its land, and a
  village is streets and outdoors together.

## Consequences

The architecture check needs no exception for a second lattice. Real-scale maps cost
detail squared per hex, which bounds how many hexes across a map can be. Hex marks are
derived and recomputed after edits. World and regional generation, their resolutions and
their across-map rules are unchanged.
