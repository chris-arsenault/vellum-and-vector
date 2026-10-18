# 0001 — One spatial model for progressive world authoring

Direction recorded 2026-10-18.

Current runtime and authority are governed by [ADR 0003](0003-frontend-session.md):
browser memory and direct TypeScript validation. The PostGIS, service and
persistence provisions here are deferred; spatial identity and authoring rules
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

Generate or author the interior against those interfaces. Preserve compatible
crossings and protected work, and retain coarse geography outside the refined
coverage. Explicit reconciliation previews affected parent, neighbor, network and
thematic dependencies before changing an established interface.

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
