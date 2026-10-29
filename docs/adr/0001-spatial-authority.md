# 0001 — One spatial model for progressive world authoring

Direction recorded 2026-10-18.

**Superseded for regional maps by the user's 2026-10-29 correction:** Maps share
world coordinates and completed history, but each map develops its own geography.
Regional refinement does not preserve parent elevation, frozen boundary samples
or exact shores and does not change parent or sibling maps. Cross-map numerical
consistency and seamless zoom are not product requirements; seamless zoom is
explicitly undesired. The older composition and boundary provisions below are
historical design context where they conflict with that direction. Generation
serves tabletop mapmaking rather than continued simulation under revision.

Regional maps keep independent records in the existing browser catalog. Feature
IDs identify map-local geography; `placeId` relates a captured place across maps.
Creation records its source revision, imports bounded geographic context and
pins map-owned numerical descriptors to immutable resources. Shared bytes are
storage reuse: later parent publications replace their own references, never a
child's captured inputs. Child generation publishes local records and resources.
Active readers stop at the map's ownership boundary. Parent links locate maps
and record provenance; they do not supply live fallback geography. Opening an
older saved region captures its existing composed geography before detaching it.

Current runtime and authority are governed by [ADR 0003](0003-frontend-session.md):
the browser GIS workspace and shared TypeScript validation. The PostGIS, service and
hosted persistence provisions here are deferred; spatial identity and authoring rules
remain applicable.

## Context

A creator moves between continents, regions, sites and interiors while editing
the same world. Progressive generation and overlapping political/cultural views
need stable geographic facts, explicit ownership of detail and predictable local
editing. The [product contract](../product-spec.md) defines these behaviors.

## Decision

Define the atlas domain model in shared TypeScript modules. A world declares a
fictional planar engineering CRS, east/north coordinates in metres, upward
elevation, a vertical datum, a domain polygon and a versioned precision policy.
Use internal PostGIS SRID 0 together with the world's explicit CRS identity.
Local frames carry origin, rotation, scale and vertical/floor offsets, with
invertible local/world transforms. GeoJSON interchange includes the declared
world reference and local/vertical metadata.

The world reference also declares its map boundary. Cylinder is the default for
new worlds and identifies the chart's east and west edges. Nothing leaves edges
open; absent metadata means Nothing for existing maps. Ocean surrounded is
reserved and unavailable until its physical ocean rim is implemented. Cylinder
uses reciprocal periodic physical adjacency, periodic geographic causes and
short seam links. Pole-to-pole coverage retains cylindrical geometry and local
terrain along closed north/south numerical faces. Distances and represented
areas retain the existing metre chart approximation; they are not geodesic
spherical measurements. True spherical worlds remain deferred in the
[backlog](../backlog.md).

Keep canonical features in the authoritative chart. Cut crossing geometry into
parts while retaining its semantic identity, profiles and shared network
junctions. The editor repeats the chart through OpenLayers and normalizes edits
back into it. Child extents inherit world topology and retain their local parent
interfaces rather than becoming independent wrapping worlds.

Mapped areas have a geographic parent, a footprint and a creation profile:
World, Region, Local, Site or Interior. Profiles can be skipped when the finer
area has a valid parent context. Finer data is materialized for the requested
extent. Views select presentation and level of detail from those shared facts.

Keep one semantic feature identity with linked base and finer representations.
Compose authoritative geometry by replacing covered portions with valid finer
representations. Retain source geometry, authorship, protection and provenance
for each representation. Each feature/area representation has its own stable
identity and validity interval. Feature metadata changes retain unchanged
representation revisions. Keep versioned composed spatial indexes so pinned
jobs and historical reads resolve the geometry for their input revision.
Relations such as a border following a river resolve
through the referenced feature. Rendering, queries, exports and dependency
analysis consume the same composition.

Located interiors, caves and floors have explicit space identities. Scope spatial
queries by world and space as well as geometry. Persist the resolved space on
area revisions and update dependent locations through the same operation when
their containment changes. Model entrances, stairs, roads,
passages and portals as connections between located endpoints. Maintain directed
network reaches and shared junctions where continuity matters.

Use PostGIS geometry for authoritative vectors, exact spatial predicates and
GiST indexes over composed geometry. Shared TypeScript validation and mature GIS
libraries support previews; the data-access boundary applies authoritative
checks against the current database revision. Numerical fields have specialized
typed grids and coverage masks alongside vector and network representations.

## Refinement and authoring contracts

An area inherits effective traits and a versioned boundary contract from its
geographic context. Keep local authoring intent distinct from effective inherited
constraints. Contracts retain crossing identities/positions, relevant field-edge
conditions, receiving connections and applicable epoch context. Same-detail
materialization has one authoritative owner at each location and layer.

Procedural detail uses those interfaces and retains coarse geography outside its
coverage. Geographic regions may nest under the same Region creation profile;
profile names do not bound nesting or dispatch to site/interior generators.

Ordinary creative edits target linked map-only representations and sampled
overlays. Procedural geometry, numerical arrays and society remain independent
generation context. Map composition, selection and export consume the drawings;
generation omits them from inputs and retains them at publication. Shared
two-dimensional anchors remain attached without imposing numerical boundary
samples on map editing. Physical reconciliation remains a specialized operation.
Structural edits block geographic generation requests intersecting their original
or current local geometry or brush footprint in the same located space. Names
and cartographic styles remain eligible. Existing finer drawings keep precedence;
untouched descendants and neighboring regions can refine independently. Retain
the replaced procedural representation and the original mapped shape alongside
an edit, so composition, source reads and undo have distinct authority. Removing
a mapped feature uses an intentionally empty representation rather than deleting
its procedural source. No separate lock registry or inverse simulation is needed.

Physical, magical, cultural, political and built data share this model. Cultural
prevalence can overlap; claims, sovereignty, administration and effective control
remain distinct facts. Derived traits describe results, while authored traits
express constraints and geographically scoped exceptions with causes.

Templates declare local units, frames, spaces, content and placement requirements.
Instantiation binds their content to a geographic parent, assigns instance
identities and connects actual access endpoints. Each instance retains its exact
definition version and independent authored state.

## Operations and history

Expose the same typed preview, validate, commit, generate, reconcile and undo
operations to UI and MCP clients. Commands carry actor, operation identity,
expected versions and spatial scope. Commit coherent changes transactionally,
retain history, and advance versions monotonically. Undo records a new revision.

Completed generation history supplies causes and inherited context. Ordinary
editing changes the present. Invalidation identifies the derived facts affected
by an edit; targeted generation updates those facts while preserving authored
representations and stable semantic identities.
