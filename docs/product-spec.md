# World Atlas Creator

**Product and map authority — 2026-10-29 user correction:** This is a mapmaking
tool for tabletop roleplaying. Generation supplies interesting maps and world
history; numerical accuracy is secondary. Regional maps share coordinates and
completed history, but develop independently. Elevation, coastlines and other
geography need not remain physically consistent with parent maps or old history
under revision. Child refinement never changes parent or sibling maps.
The starting regional outline does not limit changes to that map's own geometry;
generation, later reads and export retain local geography beyond it. Zoom
stays on the current map; switching maps is explicit. Seamless cross-map zoom is
undesired. This supersedes the older single-authority and frozen-boundary
requirements throughout this design baseline.

**Dedicated regional refinement — 2026-10-30 user correction:** Refine the captured
present surface with regional algorithms at the selected physical scale. Do not
initialize another world, reconstruct tectonics, replay epochs or run society
eras. Shared physical calculations and browser execution/storage infrastructure
remain useful. Refinement must add actual terrain, coastal structure, smaller
drainage, habitat patches and places; denser samples of unchanged classes do not
meet this requirement. Smaller settlements do not require exact inherited
population allocations.

**Deferred product scope — 2026-10-28:** Manual editing, its associated authoring
tools, and undo are out of active scope pending proper design. Stop implementation
and repair work on them. Preserve the existing code and tests for future redesign;
this direction does not authorize deleting them or preventing their return. Older
requirements for these features describe future scope, not acceptance criteria for
current work. Their existing implementation is not accepted product behavior.
Generation, regional selection and refinement, inspection, presentation, explicit
local saves and export remain active scope. Completed causal generation history
is separate from undo.

**Current implementation scope — updated 2026-10-27:** The user has deferred the
backend and MCP until the frontend product functions. The browser owns a local GIS
workspace and runs generation in a worker. Explicit local map saves rooted in IndexedDB
allow reopening geography without regeneration; unsaved changes disappear on
reload, and generation stops when the tab closes. [ADR 0003](adr/0003-frontend-session.md)
supersedes this document's backend, durable-job, recovery and service requirements
for current work. Geographic authoring remains deferred as described above.

**Regional refinement and map authority — 2026-10-26:** Geographic regions can
nest arbitrarily within the existing map type. Refinement elaborates retained
terrain, drainage, living landscapes and society without replaying completed
epochs or eras. Ordinary creative edits change linked two-dimensional map
representations and surface overlays; they do not reconstruct the procedural
world. This direction supersedes older requirements for physical consistency of
every manual edit. Site, city-layout and interior development remain outside
this regional flow.

**Magic direction — clarified 2026-10-22, completed 2026-10-25:** the seven
magic systems (Fire, Aurora, Pressure, Greenwood, Salt, Hallowed, Veil) are
first-class world effects and processes with distinct physical motivations.
Use Canonry as a mechanism reference without importing its named setting lore.
Each system keeps its specific behavior; none is reduced to generic effects.
Source placement, system-specific settings and shaping remain; see section 10.3
and [magic source authority](../AGENTS.md#magic-source-authority).

## Product, Domain, and Generation Design — Implementation-Agent Handoff

**Status:** Consolidated design baseline (v0.1)  
**Date:** 2026-10-17  
**Audience:** Product/design agents, domain architects, GIS specialists, procedural-generation engineers, UI implementers, test agents  
**Source project:** [chris-arsenault/the-canonry-game](https://github.com/chris-arsenault/the-canonry-game)  
**Scope:** Product behavior, domain concepts, architectural constraints, and acceptance contracts. This is **not** a code design or mandate to reuse Godot, the Canonry kernel, or any specific database.

---

## 1. Executive summary

Build a web-based creator for fictional-world maps used in tabletop roleplaying.
Generate interesting geography and history, then develop the maps the creator
needs. Maps remain geographically located in their world and can diverge under
revision without reconstructing the world's past.

The product draws heavily on _The Canonry Game_'s deterministic, causal, multi-epoch physical geography generator. Its generation model includes geology, crust evolution, tectonics, hydrology, erosion, climate, glaciation, coasts, and several interacting magical forces. The new product must generalize and extend this approach to:

1. Support refinement on demand at a finite set of **creation profiles**, rather than precomputing the whole world at every resolution.
2. Provide **fast manual and semantic editing**, even when high-fidelity procedural generation takes minutes or up to an hour.
3. Maintain a **rigorous coordinate and spatial-reference model** for geographic features at every level, using mature GIS concepts and tooling wherever feasible.
4. Treat **physical, magical, political, cultural, and future custom GIS layers** as shared world data, not map-specific drawings.
5. Introduce **independent, causally interacting generation domains** for political and cultural geography alongside physical and magical systems.
6. Provide a persistent **agent-accessible domain service**, eventually exposed through MCP, which edits the same authoritative world model as the graphical UI.

**Core product rule:** A finished world map, from a continent map to a tavern floor plan, must have a traceable geographic parent and a resolvable world location. Only _templates_ may be authored independently of a world.

**Core generation rule:** Regional maps elaborate inherited geography and retain meaningful connections. Direct map editing preserves spatial identity and shared two-dimensional anchors without requiring edited drawings to satisfy the simulation's numerical boundary conditions.

**Core historical rule:** Generation may model the world's past at multiple scales. Once generation completes, history is fixed; normal editing changes the present, not the past.

### 1.1 Strength of requirements

- **Accepted:** A decision explicitly established in the design conversation.
- **Design baseline:** A necessary interpretation or cohesive proposal derived from accepted requirements. Implementation agents should follow it unless they identify a specific conflict.
- **Implementation option:** A candidate technology or realization that requires an architecture decision; do not silently treat it as an accepted product requirement.
- **Deferred:** A future capability or explicitly out-of-scope item.

The requirements and invariants below supersede architectural suggestions from earlier discussion when they conflict.

---

## 2. Product goals, principles, and non-goals

### 2.1 Primary goals — accepted

- Create a world at coarse geographic scale, select areas, create more detailed geographic maps, place POIs, develop individual sites, and eventually create structures and interiors.
- Keep creation profiles distinct from geographic nesting. Geographic regions support arbitrary nesting down to a useful minimum size within the same map type; names do not prescribe ranks or generation behavior. A user can skip unused creation profiles.
- Leave large parts of the world ungenerated or under-detailed indefinitely.
- Support procedural generation at most levels and direct editing at all appropriate levels. The balance should shift toward manual creation at small scales.
- Preserve Canonry's causal geography and the seven distinct magic systems, including historical effects and system-specific creator controls.
- Make procedural geography physically plausible. Traits and inherited context guide generation; direct map drawings do not require inverse physical reconstruction.
- Support political, cultural, and arbitrary future GIS overlays, with independent generation and editing capabilities.
- Support reusable standalone **templates**, later inserted into geographically anchored maps.
- Provide a persistent backend/domain model usable by both UI actions and agents.
- Permit long-running, high-quality procedural generation with transparent status and user-controlled detail; keep ordinary manual editing responsive.

### 2.2 Design principles

1. **One world, multiple representations.** Physical fields, vector features, networks, entities, and rendered map views describe the same spatial world. Display pixels do not own domain truth.
2. **Generate causes, preserve consequences.** Terrain and magic arise from interacting systems and historical stages, not merely recolored noise or fixed category quotas.
3. **Refine, do not regenerate blindly.** More detailed maps elaborate established features and historical constraints without erasing prior user work.
4. **Authorial intent outranks procedure.** Procedural systems respect explicitly authored, protected facts and declared exceptions.
5. **Strong location identity.** Every committed world map and spatial feature resolves into the world's spatial reference, including indoor and vertical positions.
6. **A layer is not a map.** World-level layers are observed through different map extents, scales, filters, and styles.
7. **Shared identity and history.** Direct map tools and procedural jobs use shared domain operations and undo while validating the representation each operation changes.
8. **Dependencies are explicit.** A change identifies what it invalidates and what requires reconciliation; no unannounced large-area rewriting.
9. **Cost follows requested detail.** Fine generation should only occur where explicitly materialized, not over the entire planet by default.
10. **Do not build a civilization simulator by accident.** Political and cultural generation can be staged and historically causal without implementing Canonry's entire gameplay runtime.

### 2.3 Non-goals for the first usable product

- Running an ongoing civilization simulation or continuously advancing in-world time after generation.
- Editing historical epochs as a timeline editor, or providing a time slider through past map snapshots.
- Generating every level everywhere or generating new detail merely by zooming.
- Enforcing realistic Earth physics on worlds with explicit supernatural exceptions.
- Requiring 3D modeling or true spherical globe rendering for the initial editor.
- Duplicating ArcGIS/QGIS's full analysis, survey, or enterprise administration product surface.
- Producing final custom painting/drawing palettes in this specification; those tools are a later focused design task.
- Multiplayer simultaneous editing, public publishing portals, or a comprehensive lore-writing system as prerequisites for the geographic editor.

---

## 3. Vocabulary and conceptual separation

Use these terms consistently in domain and UI requirements:

| Term                  | Definition                                                                                                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **World**             | Top-level project with a defined spatial reference, laws, magical-system definitions, history configuration, layers, entities, and generation state.                   |
| **Creation profile**  | A finite functional level, such as Region or Interior, that determines appropriate generators, editor tools, and default visualizations. Not a fixed zoom or distance. |
| **Mapped area**       | A persisted, geographically anchored extent where content has been explicitly refined/materialized under a creation profile; it has a parent and a boundary contract.  |
| **Map view**          | A presentation of an area using layer selection, styling, projection, zoom, and filters. Views do not create a second copy of geography.                               |
| **Layer definition**  | A world-scoped semantic and spatial data schema, with representation, validation, style defaults, and optional generator association.                                  |
| **Spatial feature**   | An identifiable river, border, road, summit, parcel, building, etc., with geometry and/or spatial coverage.                                                            |
| **Domain entity**     | A political organization, culture, settlement, religion, institution, etc., with properties and relationships that may own or influence geographic features.           |
| **Spatial field**     | A continuous or sampled quantity over an area: elevation, moisture, magical intensity, cultural prevalence, etc.                                                       |
| **Boundary contract** | Versioned inherited conditions at the edge of a mapped area: geometry, elevations, entry/exit connections, relevant field samples, and other cross-area invariants.    |
| **Traits**            | Explicit constraints, biases, and derived descriptions controlling or characterizing a region or feature.                                                              |
| **Template**          | A detached map/feature definition in a declared local coordinate space with a required parent-context type; it becomes geographically anchored only upon insertion.    |
| **Generation domain** | A cohesive set of generators and historical processes, such as Physical, Magical, Cultural, Political, or Built Environment.                                           |
| **Refinement**        | Creating additional spatial detail from inherited world data and constraints, while preserving previously committed higher-level semantics and authored information.   |

Two distinctions are especially important:

- A **political province** is a geographic/domain feature; a **regional mapped area** is a unit of authoring and materialization. Their boundaries need not be identical.
- **Zoom**, **cartographic scale**, **geographic extent**, **creation profile**, and **generation resolution/quality** are separate concepts. Neither display zoom nor pixel density silently creates world detail.

---

## 4. Geographic hierarchy and creation profiles

### 4.1 Initial finite creation profiles — design baseline

| Profile      | Typical authoring focus                                        | Examples                                           | Generation/edit balance                |
| ------------ | -------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------- |
| **World**    | Global shape, major geography, climate, macro-magical patterns | Continents, oceans, global watersheds, empires     | Strongly procedural                    |
| **Region**   | Causal detailed geography and major human geography            | Mountain ranges, rivers, provinces, cities         | Procedural + semantic edits            |
| **Local**    | Individual landscapes and settlement surroundings              | Valleys, woodlands, farms, roads, village environs | Mixed                                  |
| **Site**     | Place layout, infrastructure, detailed terrains                | Town, castle, ruins, cave network                  | Mixed + direct construction            |
| **Interior** | Fine-grained constructed or natural spaces                     | Tavern, building floor, crypt, cavern              | Primarily manual + assisted procedural |

These are **defaults**, not strict size bands. A cave network may be geographically large; a small island may fit in a Local map. A site can have multiple subspaces and floors without inventing a sixth generic recursion level. A world may add more domain-specific profiles later, but profile count remains bounded and intentionally designed.

This table retains the broader design baseline. Current geographic refinement uses
World and recursively nested Region maps. It does not advance through this table
or switch to another map type when a selected region becomes small.

### 4.2 Hierarchy invariants — accepted/baseline

- A committed mapped area has exactly one geographic parent (except the World root), a creation profile, a geographic footprint or anchor, and a resolvable world transform.
- A mapped area can be created directly beneath the nearest applicable existing ancestor, skipping unused profiles. Skipped levels do **not** require dummy fully generated maps.
- A POI can be placed on a higher-level map and refined directly into a Site or Interior when its context allows.
- Mapped areas do not force full coverage: an undeveloped portion of a continent remains visible using existing coarse geography, with finer content absent rather than secretly synthesized.
- Templates alone may lack a world location. Their required placement context, internal units, and local origin remain explicit.
- Physical connectivity may cross hierarchy branches (roads, caves, rivers, portals). The containment tree is not the entire topology.
- Administrative and cultural features may cross mapped-area boundaries; they do not define the map hierarchy.

### 4.3 Creating a mapped area

A user may choose an extent by **existing geographic feature**, **freehand geographic polygon/rectangle**, or **fixed grid/tile**. The new area is created from the selected geographic extent, not from screen pixels. A map creation flow should offer:

1. Creation profile (suggested from content and scale, editable).
2. Creation approach: procedural, blank/manual, or template insertion.
3. Extent and parent anchoring; scale and local units shown clearly.
4. Effective inherited traits and boundary conditions, with important restrictions highlighted.
5. Generation domains and quality/detail settings.
6. An optional preview, expected workload/cost when measurable, and a clear **Create/Generate** action.

Blank/manual creation still inherits the boundary contract and geographic parent; it simply omits optional interior procedural content.

### 4.4 Overlap and competing authority — design baseline

Geographic **views** and thematic **features** may overlap freely. Two independently generated patches of the **same world layer at the same effective detail** must not silently own conflicting facts for the same location. A practical initial policy is to reject or explicitly reconcile overlapping materialized generation ownership, while allowing overlapping mapped views into shared spatial features. Later implementations may support compositing/merging refined patches, but must retain a single authoritative result per location and layer.

### 4.5 Geographic region selection

World geography is selective. Named regions represent coherent major landscapes,
water systems and supported political territories; exceptional mountains, falls
and magical sites can qualify without large area. Extent alone does not establish
significance. Ordinary local patches and tributaries remain in the physical
fields and retained networks. Unnamed landscapes and unclaimed country are valid.
Selection can suggest subdivisions when a geographic polygon is too large for
useful detail at the next scale.

The raster independently colors local conditions across the map. Naming a region
does not recolor it or remove color elsewhere. Corresponding ecological margins
reuse the raster's classification and sampling so forest-to-plains transitions
agree. A point or course's influence footprint does not make it a selectable
region. Drawing, selection and export consume the published area geometry.

Regions subdivide an existing geographic map on demand. Their parent links support
arbitrary nesting until the selected area is too small or narrow to be useful.
Country, state and county are examples of names, with no required sequence or
depth. Each region retains its source map's creation profile and existing detail.
Selecting or entering it does not start generation, copy numerical fields or
reveal latent rivers and settlements. Other map types, including city layouts,
sites and interiors, are outside this regional selection and refinement flow.

A Regions click queries the spatial index. An existing child region under the
click opens; otherwise the generated geographic and social polygons covering the
click become candidates, clipped to the parent and outside committed siblings. A
location without a polygon offers no candidate; regions never need to cover the
map. Candidates rank by useful area at the next fixed regional scale, independent
of zoom. Large polygons also offer approximate geographic subdivisions clipped to
the shore and influenced by nearby settlements. Natural regions near the useful
size take preference; whole landmasses and small named regions remain choices.
Seam-connected geography remains one candidate on cylindrical worlds. Long coastal
belts can offer compact subdivisions even when their land area is modest.
Subdivision size and count are approximate, with no equal-area solve or hard
size restriction. Creators can draw a closed outline, or a
dividing line whose endpoints snap to nearby edges and which splits the polygons
it crosses. Candidates remain previews until kept. Committed siblings form a
partial subdivision with shared edges and no overlapping interiors.

Creators can revisit children through the region list and ancestor breadcrumbs,
rename regions, adjust outlines and remove unreferenced leaves. Outline changes
keep existing children contained. Removing a region requires first removing its
children and any saved map compositions that use it. These operations use the
existing history and undo.

Region views carry stable identity, source area, name, parent and world-coordinate
footprint in `world.views`. Saved layer compositions can reference that identity
as their subject. Selection frames the map and shows region outlines while reads
continue to use the source map. Cartographic presentation consumes the selected
identity, footprint and ancestor path; it owns illustration, clipping, typography
and sheet layout. Explicit local Save map retains committed regions and view
references, and GIS exports include region metadata.

### 4.6 Refine a selected geographic region

An explicit Refine action links a finer mapped area to the existing region
subject. The subject retains its original source and hierarchy; its nearest
refined ancestor supplies procedural context. A child remains a geographic map
at every nesting depth. A fixed physical resolution ladder follows its captured
refinement level and requested detail. The default-world usable land calibrates
the first scale; successive levels aim for roughly eight to twelve useful
subregions. Geographic shape and coastal context vary the resulting sample count.

Regional setup offers detail, seed and inherited magic/people choices. It does
not offer another physical or human history. Parent terrain must exist before
detail generation; selection and cartographic framing remain usable without it.
Returning from setup or cancelling a job retains the selected subject. Completed
regional output arrives through the existing worker and atomic publication.

Terrain and water develop from parent context without locking inherited heights
or shores. The child map includes a rectangular working area around the selected
subject, with surrounding land and sea available for independent development even
outside the source map's footprint. Climate responds to finer relief; habitats
and existing magical landscapes follow their own media without creating another
history or renewing inherited material stocks. Known places remain available;
regional algorithms add smaller settlements, local ways and POIs from useful
sites. Completed society history provides context without a population-accounting
gate or another settlement era.

Finer features and fields stay on their regional map. Creation captures context
within the child's extent and pins its numerical input resources. Replacing the
parent's resources cannot change an existing child. Zooming out shows that
map's extent, never the surrounding parent world. Returning to the parent uses
explicit map navigation and retains the parent's geography.

---

## 5. Spatial reference and coordinate requirements

### 5.1 World reference — hard requirement

Every world must explicitly define its coordinate reference model, including:

- Geometry/topology: planar, wraparound, spherical, or another supported world model.
- Coordinate reference identity, axes, orientation, measurement units, and horizontal distance semantics.
- World scale and, where relevant, radius/circumference and projection properties.
- Vertical reference and units, with explicit treatment of elevation, depth, and floor offsets.
- Valid extent/domain and any wrap, discontinuity, pole, or projection singularity behavior.
- Consistent transformations to/from every mapped area's local coordinate system.

Do not assume Earth's WGS84 coordinates for fictional planets. An Earth-like geographic projection may be useful for display or interchange, but the fictional world needs its own declared parameters.

**Current implementation:** Use one planar metre chart with an explicit map boundary. New worlds default to **Cylinder**, joining east and west in physical generation and the editor. **Nothing** retains open edges and permits geography to continue off-map. **Ocean surrounded** is a reserved, unavailable choice pending an ocean-rim boundary condition. Latitude coverage is independent: pole-to-pole cylinders close north/south outlets while retaining local terrain, longitude and metre-scale geometry at those edges. This remains an approximate chart-based physical model with a flat editor; it does not provide geodesic spherical distances or a 3D globe. Existing maps without boundary metadata retain open edges. Refinement inherits its world's boundary choice and keeps local parent interfaces.

### 5.2 Local coordinate frames

- Regional/local maps use world-anchored local frames to avoid huge values or precision loss during fine editing.
- Sites/interiors use local metric or declared world-unit frames with position, orientation, elevation, and potentially floor/level identifiers.
- Mapping local-to-world and world-to-local must be unambiguous and invertible within the supported extent; non-affine world projections are permitted where needed.
- Connected vertical spaces (floors, caves, shafts, sewers, bridges) have explicit elevation and entrance/exit topology rather than being treated as unrelated 2D drawings.
- Portals and other nonlocal magic are **connections between located spaces**, not coordinate-system hacks.

### 5.3 GIS interoperability

The system must support standard GIS geometry and spatial query concepts: points, lines, polygons, multipolygons, spatial intersections/containment, distances, areas, coordinate conversion, and indexed geographic extent queries. It must also support spatial rasters/fields and connected networks without forcing all content into polygons.

Prefer recognized standards and established libraries when feasible (e.g., OGC Simple Features, CRS conventions, OGC API Features, GeoPackage, GeoJSON where applicable). Interchange must preserve custom world CRS metadata or explicitly document transformations and losses. GIS-compatible export is a target; a full third-party GIS-server deployment is not required for product correctness.

---

## 6. Canonical domain model

### 6.1 Main persisted concepts

**World** owns the global spatial reference, world topology/physical law configuration, magical-system definitions, epoch schedule, available creation profiles, registered layer definitions, root map, and world provenance/version.

**Mapped area** owns its geography, generation inputs, local traits, footprint,
coordinate frame and generation configuration. Its parent and captured source
revision record location and provenance. Regional maps share the world catalog
and immutable resource storage without sharing mutable geographic authority.

**Layer definition** owns a semantic name, supported geometry/field/network representation(s), feature schema, allowed creation profiles, style/filter metadata, validation rules, source (manual/imported/generated/derived), and optional generation-domain registration.

**Spatial feature** owns a persistent ID, type, geometry/field/network coverage and its geographic reference, semantic attributes, causal provenance, authored state, associations, and any linked coarse/detail geometries. At least one resolvable map/world location is required for a committed spatial feature.

**Domain entity** owns its semantic ID and characteristics; it may relate to many features or layers. A kingdom, for instance, can have sovereign territory, claimed areas, actual-control areas, capital points, and routes without being a single polygon.

**Generation record** owns a seed, algorithm/configuration versions, parent constraint versions, epochs/history parameters, output extent and layers, completion state, warnings, and provenance for generated features. This supports reproducibility and safe regeneration, not just logging.

**Template** owns a declared local space and parent-context contract, internal features, optional generation recipe, parameters, and insertion rules. Instantiation creates bound world objects with stable instance IDs.

### 6.2 Feature identity and cross-scale geometry

- A river, kingdom, mountain range, or road retains stable **semantic identity** regardless of the current rendering scale.
- A feature record belongs to one map. A separate place identity relates captured
  geography across maps while allowing each map's geometry and attributes to change.
- Refinement initializes local records from source geography once. Later source
  changes do not propagate to the child, and child generation does not update the
  parent feature or its displayed shape.
- Each map's scene, inspection and export use its own geography at every zoom.
- **Feature identity is not the same as a specific coordinate or sample index.** IDs should remain stable under reasonable editing and resampling.

A feature's primary geometry expresses its geographic meaning: a located site,
a supported course, or an area. An optional polygon footprint records known
surroundings or affected geography under that same identity. Primary geometry
and footprint compose independently through finer representations. Creators can
edit either role and undo the change; moving a site leaves its surroundings in
place. Spatial discovery considers both roles, and GIS export retains both.
Classification bands remain areas when the source supplies no physical course.

### 6.3 Data representations

| Representation                   | Core uses                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------ |
| **Vector points/lines/polygons** | POIs, rivers, roads, boundaries, parcels, buildings, sites                           |
| **Continuous/sampled fields**    | Elevation, temperature, moisture, magical intensity, population/cultural prevalence  |
| **Networks/topology**            | Hydrology, roads, trade routes, cave passages, portals, pedestrian connections       |
| **Named domain entities**        | States, cultures, languages, settlements, guilds, faiths, organizations              |
| **Relationships**                | Sovereignty, claims, adjacency, membership, trade, influence, ownership, situated-in |
| **History/provenance**           | Epoch causes, material origin, feature creation, authored changes, generator inputs  |

The model must not lose overlapping properties when one displayed surface is chosen. Canonry's distinction between physical material, natural surface, magical intensity, historical effects, nonexclusive flags, and final presentation surface is a critical precedent.

---

## 7. Layer system and map views

### 7.1 World-scoped layer registry — accepted

Layers belong to the **world** and are visible through geographically scoped map views. They must not be copied into independent data islands at each map level. A layer may be empty, coarse, partially refined, or richly detailed in different parts of the same world.

The initial layer families should include:

| Family           | Representative layers                                                                | Storage/representation                          |
| ---------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------- |
| Physical terrain | Elevation, geology, landforms, slope, biomes, land cover                             | Fields + vector features                        |
| Water/climate    | Rivers, lakes, drainage, precipitation, temperature                                  | Networks + fields + polygons                    |
| Magical          | Sources, intensity, consequences, anomaly coverage                                   | Entities + fields + vector features             |
| Transportation   | Roads, routes, bridges, passes, ports                                                | Connected networks + features                   |
| Settlement/built | Settlements, districts, parcels, buildings, structures                               | Entities + polygons + networks                  |
| Political        | Sovereignty, administration, claims, actual control, jurisdictions                   | Entities + overlapping polygons/fields          |
| Cultural         | Cultural prevalence, language, religions, traditions, migration routes, institutions | Entities + overlapping fields + features        |
| Custom GIS       | User-created surveys, sightings, ecological niches, sacred zones                     | Schema-defined vector, field, or network layers |

Predefined layer families provide a ready-to-use vocabulary; new layer definitions are user-extensible. A user must be able to add a layer without writing or registering a generator.

### 7.2 Visualization

A map view can combine any authorized layers with style, opacity, labels, selection, attribute filters, scale-dependent visibility, and appropriate aggregation/generalization. Start with presets such as **Physical, Political, Cultural, Magical, Infrastructure**, plus a user-defined composition.

Display resolution must never be confused with generation status. When a layer has only coarse information, show an appropriately generalized result or an explicit not-refined indication; do not generate fine-scale roads or local cultural polygons silently during zoom.

The renderer can display the same stable world feature at multiple scales without duplicating its domain identity. Multiple specialized visualizations are allowed: borders for jurisdictions, heatmaps for cultural prevalence, lines for networks, region fills for claims, point symbols for sites, and field maps for magic.

Terrain contours retain emphasized index lines while crowded intermediate lines
fade. Nested contour intervals transition with map scale above the creator's
chosen minimum, independently of visual vertical exaggeration. Bounded display
interpolation smooths regular elevation grids for contours and relief while
physical heights, water boundaries and authored patch ownership retain their
domain authority. Elevation colouring keeps dry summits rocky; snow and ice use
their own surface and physical fields.

The drawn presentation uses the same region subjects, source-area reads and
selectable features as raster investigation. Ink-and-wash and monochrome
treatments combine territory washes, existing watercourses and routes, terrain
illustrations and ranked labels. Physical, political, cultural and infrastructure
compositions share this presentation. Control and claims keep separate boundary
treatments; cultural, language and religious fields can overlap as independent
hatches, while population uses proportional dots.

Geographic subjects supply stable identity, footprint and ancestry. Display masks
preserve holes and disconnected parts without changing source geometry. A drawn
sheet presents one chart with paper margins; raster presentation retains its
navigation constraints. Symbol density and label eligibility describe depiction,
never generation detail. Terrain marks derive from existing elevation, water,
woodland features and cover fields, with room around inhabited places.

Composition-specific finishing moves labels, draws their courses, chooses symbols
and suppresses illustrations while preserving geographic feature identity and
position. Saved views retain those settings through existing view commands,
history, undo and explicit local map saves. Multiple compositions may reference
the same geographic region. Optional sheet furniture and local PNG export use
the same drawing, with no hosted renderer or new geographic data source.

### 7.3 Political and cultural modeling

**Political geography must not be reduced to a single mutually exclusive territory layer.** Distinguish, at minimum:

- Sovereign or recognized state territory.
- Administrative subdivisions and jurisdictions.
- Territorial claims and disputes (overlapping allowed).
- Effective control/occupation (may differ from claims or sovereignty).
- Relevant capitals, institutions, and political relations.

**Cultural geography must not be forced into exclusive polygons.** Multiple cultures, languages, traditions, and religions may coexist geographically. Support distributions/prevalence fields and optionally inferred boundaries for cartographic presentation. Store genuine institutions, communities, and important sites as entities/features.

Political and cultural map content should be available at every creation level where meaningful. World and Region generators can model states, cultural distributions, and broad administrative structure; Local/Site generation can model wards, local control, groups, property, and institutions. Interior maps can display ownership, restricted areas, affiliations, and artifacts without requiring a dedicated interior nation-state generator.

### 7.4 Feature types and Atlas discovery

Feature controls organize terrain, water, ecology, magic, inhabited places,
transport, works, society, politics, history, structures and custom content into
searchable groups. Published biome and settlement-role attributes supply finer
types; magic types follow configured systems, classification rules and their
interactions. Parent visibility preserves individual child settings. Each type
has independent visibility, labels and appearance, including optional footprint
display. Counts describe unique eligible identities in the current map. Hidden
types are excluded from ordinary picking and snapping under both default and
advanced styles. Session views retain these settings.

Continuous fields remain independent overlays. Their discovery groups distinguish
magic systems, population and cultural, language and religious distributions.
Turning off site symbols does not remove a field or alter the base surface.

The Atlas provides **Maps** for mapped-area navigation and **Features** for a
sortable, filterable registry. Features defaults to named content and can include
generic components explicitly. Whole-world, current-map and viewport scopes
combine with type, attribute, status, authorship, protection, profile and located
space filters. Selectable columns retain numerical values, units and explicit
unknowns; settlement residents remain distinct from community population.
Custom attributes and separately owned authored magic sources are included.

Each semantic identity has one row. A major landmark
([ADR 0006](adr/0006-landmarks-are-injected-causes.md)) is one such identity:
its row is the generated realization under its name, carrying target and
measured signature, maintenance total and captured river or source strength,
typed by its catalogue kind under Terrain and geology for a landscape kind and
under Magic for a magic kind. A detected peak, gorge or waterfall standing on the
landmark is not a second row, and a magic landmark's injected source is not a
located source of its own. Discovery retains hidden
features and opens existing finer maps or interiors through the inspector
without changing saved visibility or generating detail. Current-map and viewport reads respect composed
geometry, profile eligibility and located spaces. Edits, undo and delivered
initial-generation features refresh the registry; incomplete delivery is marked.

---

## 8. Traits, physical consistency, and authored exceptions

### 8.1 Trait classes

| Class                  | Meaning                                                         | Examples                                                              |
| ---------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Hard constraint**    | Enforced procedural bound unless an authorized exception exists | Maximum relief, frozen river crossing, coastal outlet requirement     |
| **Soft tendency**      | Shapes likelihood/strength; not an invariant                    | Forested, volcanically active, river-rich                             |
| **Derived trait**      | Computed from generated or authored data                        | Glaciated, densely inhabited, drought-prone                           |
| **Exception/override** | Explicit reason to violate an inherited/default constraint      | Fire-heated refuge within a cold region, maintained ice-free crossing |

Traits should be typed, parameterizable, and scale-aware. A coarse `flat` constraint generally means a bound on regional relief/grade, not mathematically zero micro-relief at interior scale. `Cold` implies a climate envelope with permissible local variation, not identical temperature everywhere.

### 8.2 Inheritance

- Each mapped area gets an **effective constraint set** from its ancestors, filtered/specialized for its spatial extent and creation profile.
- A more specific area may narrow a constraint; a contradiction must be rejected, reconciled, or explicitly authorized through a causal override.
- User-authored exceptions must identify their source and effect, be geographically scoped, and appear in provenance/diagnostics.
- Derived traits describe current results and never masquerade as hard authoring intent.
- Generator settings and field data remain accessible; simple trait labels are a controlled authoring interface, not the complete physical model.

### 8.3 Validation policy

The default is **physical plausibility**, not absolute realism. Check topology, continuity, energy/material or flow feasibility where the generator supports it, and logical consistency of cause/effect. Do not use arbitrary global percentages as pass/fail proxies for map quality: Canonry's worldgen documents explicitly reject percentage-based quality gates in favor of structural validation and rendered geographic inspection.

Example: a river may meander or branch internally but must satisfy its required inlet/outlet elevations, network continuity, and water budget unless an authored magical mechanism explicitly changes them.

These physical checks govern procedural results and specialized physical edits.
Ordinary map edits validate geometry, location, identity and references. A drawn
river bend or painted elevation does not need to reconstruct a feasible water
budget, climate or society underneath it.

---

## 9. Boundary contracts and successive refinement

### 9.1 Independent regional geography

A child is a separate map, initialized from captured parent context. The selected
outline identifies its subject and does not limit its own generated geometry.
Its working frame includes nearby coastal context, and presentation follows its
developed fields and features. Regional generation may change elevation,
drainage and shores without reconciling the parent. Completed history remains
available as context.

### 9.2 Inherited context

Terrain, climate, drainage, materials, landmarks and society provide starting
conditions. Shared coordinates locate places across maps. Their earlier numerical
values are not obligations on the new geography. Creating a region records its
identity and outline; it does not load and copy every numerical layer.

### 9.3 Refinement contract — normative behavior

1. **Select:** Choose a geographic subject and outline within its parent.
2. **Resolve:** Read this map's pinned present fields, known places and completed history; do not read live parent or sibling products.
3. **Locate:** Keep the map's world coordinates and source relationships.
4. **Choose:** Select regional detail, seed and applicable domains.
5. **Refine:** Develop finer surface geography through dedicated regional algorithms without world initialization or advancing time.
6. **Validate:** Check product ownership, located space, identity and authored protection without requiring outline containment or parent-height agreement.
7. **Publish:** Install the finer map as one coherent regional operation; preserve its source map and existing drawings.
8. **Present:** Explore and export the separate map. Manual authoring remains deferred.

### 9.4 Allowed and disallowed examples

**Allowed:** Select an island and refine its bays, cliffs, rivers and relief on a
separate regional map. The world map retains its original island.

**Disallowed:** Require inherited elevation samples to match before refinement
can run, rewrite the world from the child, or reveal another map by zooming out.

### 9.5 Reconciling impacts

- Ordinary geometry operations update local visible geometry immediately; expensive derived analyses may be marked dirty and processed later.
- Regeneration operates over declared affected fields/dependencies and geographic extents, not by replacing all child content.
- Later parent changes do not replace a child's captured inputs or local geography.
- Changing a regional map does not require rewriting parent or sibling maps.
- Feature relations such as “political border follows river” should bind to river geometry/identity, not duplicate an unrelated approximate polyline.
- Region creation boundaries can be arbitrary geographic polygons. A continuous river/forest/culture can cross them even though generation responsibility is partitioned.

### 9.6 Direct mapped authoring

Ordinary drawing, moving, reshaping and painting write map-only representations
or sampled overlays. Existing procedural geometry, terrain arrays, drainage,
material records and society remain context for generation. Shared feature IDs
and references link those records to the drawings. Moving a town symbol also
moves its attached mapped route endpoints in the same operation.

Reads, selection, rendering and GIS downloads compose mapped geometry. Surface
overlays stay scoped to their map; a child drawing does not appear on its parent,
and later parent painting preserves existing child detail. Undo restores each
mapped operation together. Local saves retain these representations and overlays.

Generation excludes map-only edits from its inputs and retains their drawings at
publication. Replaced fine procedural representations remain available underneath
their drawings. Removing a feature from a map hides that representation and
retains its source; existing finer drawings keep their precedence.

Structural drawings restrict automatic geographic generation to untouched
geography. A request that intersects an edited feature's original or current
local geometry, surrounding footprint, or a painted surface patch is blocked
in that located space, with the drawing and owning map identified. Moving a town
includes its attached mapped routes. New drawings protect their current geometry;
removing generated geography protects its former location. Names and visual
styles do not impose this restriction. Existing children remain usable, and
untouched children or neighboring regions can still refine from their original
procedural context. Undo restores both the drawing and its generation eligibility;
restoring a feature's original structural drawing also removes its restriction.
No whole-region freeze or inverse simulation follows from a local edit.

---

## 10. Procedural generation domains

### 10.1 General generation contract

A generator declares: supported creation profiles; inputs and prerequisites; causal facts read/produced/invalidated; spatial extent and required halo; history/epoch assumptions; deterministic seed inputs; configurable quality/cost; result feature types; validation checks; and which outputs may be protected or selectively regenerated.

The product supports both **full creation** and **selected-domain generation**. Running the cultural generator must not inherently rerun geology; running a building layout generator must not inherently recalculate continental tectonics. However, generators may require recomputing specifically affected derived data or fail when their input state is inconsistent.

### 10.2 Physical geography — Canonry reuse target

The correct reference is [The Canonry Game](https://github.com/chris-arsenault/the-canonry-game), not `the-canonry`. Its physical generator is a **pass-ordered, causal, deterministic, multi-epoch system** on a global microtriangle lattice with projection to coarser hexes for gameplay/presentation.

Preserve the concepts and, where suitable, adapt the algorithms for:

- Crust assembly and plate/province evolution; collision, rifting, transform margins and inherited tectonic history.
- Orography, volcanic construction, impact cratering, differential material resistance, mass wasting.
- Ocean connectivity, shelves/bathymetry, currents, coastal erosion and sedimentation.
- Climate, atmospheric transport, precipitation, temperature, moisture and runoff.
- Drainage conditioning, lake water balance, river network continuity, fluvial erosion, floodplains and deltas.
- Glaciation, glacier flow, glacial erosion/deposition, retreat and inherited landforms.
- Material and surface classifications that do not erase underlying physical fields.

Continental ancestry remains distinct from current moving plate membership.
Geological history can split, transport and collide fragments, open and close
basins, and construct subduction arcs. Initial land fraction sets formation's
physical budget; later exposed land follows material, basin capacity and water
exchange with grounded ice. Terrain choices preserve authored climate history.
Geological intervals remain independent of the model years used by life and society.

Major landmarks extend this generator without a second engine
([ADR 0006](adr/0006-landmarks-are-injected-causes.md)). A world is owed a
configured number of major landscape landmarks (great mountain, great canyon,
great ring structure, great escarpment, great falls) and major magic landmarks
(a great source of each material magic system). The generator sites each at the
epoch it forms in from the terrain of that moment, injects the kind's causes,
restores the measured signature at the end of every later epoch and at present,
booking each correction, names it and publishes it as one feature; a rerun keeps
the landmarks it already has. The surrounding geography responds through the
same processes as everywhere else, water is captured rather than fabricated, and
naturally emerging landforms and their detection are unchanged. Creators rename,
re-measure, move or remove the result; nothing is placed before generation.

- Named geological feature extraction where supported (rivers, lakes, peaks, craters) and additional generalized GIS features in the new product.
- Deterministic seeds and structural correctness; rendered geographic review as a complementary quality gate.

**Do not assume Canonry already supports arbitrary selected-region refinement.** Its current latent-world geography is generated globally, then exposed and summarized at different rendering/gameplay resolutions. Sparse _generation_ with stable child boundaries is new work.

### 10.3 Magical generation — the seven systems

Seven distinct authored systems, not examples of interchangeable source/effect
combinations: Fire, Aurora, Pressure, Greenwood, Salt, Hallowed and Veil. The
[magic lore bible](lore/magic.md) carries each system's setting-neutral
character, practice and cost; [ADR 0007](adr/0007-magic-systems-are-materials.md)
records the model they share. Lore explains motivations; implementation
establishes which geographic mechanisms exist. Named gods, peoples, artifacts,
places and events are reference context, not atlas content requirements. Social
applications below are setting-independent adaptations.

Every system is a material: stocks in named reservoirs that the world's own
transports carry (crust, ice, rivers, groundwater, wind, currents, animals and
people), with origins that make it, a medium it propagates through and a forcing
it writes into the shared physical fields the ordinary processes consume. Each
cell carries shares of every class rather than one winner, and the meetings
between systems are processes of their own, never a blend or a net of their
parents.

- **Fire:** vein cores on fracture-fed geothermal maxima, fallen cores in the
  crust and gravels around impact craters, and forge cores where people crack
  what they mined and carried. Fire follows fracture conductance, heats terrain,
  melts ice and hardens rock, quickens the living, opens the conduits it flows
  through until a spent vein seals, and carries warmth down the rivers below it;
  spent ore rides the crust and is exhumed, placers wash downstream.
- **Aurora:** charge accumulating toward colder terrain and held in ice, ground,
  moraine and shelf; ice carries it and dumps it where it ends, meltwater takes a
  share. Stored charge keeps ice from ablating, casts a cold shadow, stills the
  life within and cuts deeper under charged sliding ice; thawing ground settles.
- **Pressure:** a deep-ocean locus whose rays, reflections and wakes crush,
  stress coasts and move water: upwelling and a cold sea surface where a ray
  shoals, fog on the coast it faces, warm still water in its wakes, and storms
  raised on sharp sea fronts that the air columns carry inland as rain, scour
  and dunes.
- **Greenwood:** sap and groundwater. Old stands and deep peat are its sources,
  springs on soft rock below a catchment its wells; it travels between roots
  through connected cover, rides in the gut of grazing herds, is gathered and
  planted by trade, is buried as peat into a stratum the crust carries and an
  aquifer leaches. Verdure grows forest past its climate, deepens soil and
  braids the rivers that cross it; springs drawn past their recharge collapse.
- **Salt:** brine, bed and dust. Made where the ground records mass death and
  where a lake died in a closed basin; brine seeps down the drainage, is flushed
  by moisture and kept by peat, crusts to bed at pits; bed dissolves on wet
  ground, blows as dust on bare ground, domes under strain and burns under
  Fire. Salting thins cover, starves soil, turns grazers away and dries the air;
  deep bed fuses the pan to glass.
- **Hallowed:** made by people. Kept seats ward rings that reach with their
  tenure; kept frontiers, works and pilgrim roads are lines. Inside a ward every
  other system is scaled down and what is removed lands on the rim; fractures,
  brine, storms and coasts are turned and their burden displaced; rivers and
  coasts hold inside. An abandoned seat fades.
- **Veil:** derived from the strain between every other system. Strain above a
  floor is a tear; a tear that shifts is a wild zone whose ground and cover move
  within a bound; stable tears far apart pair into doors that join distant
  places in the travel graph. Aurora's charge closes a door, a Fire release
  ruptures it, a ward seals it.
- **Meetings:** each named meeting is a confluence with its own process, hazard
  and class, taking coverage from the systems that made it: Shatter rim, Boiling
  shore, Breach, Overgrowth rot, Frozen Deepwood, Brackish wending, Preserved
  barrow, Fired crust, Standing-dead front and Brine shore. Hallowed and Veil
  are the any-system meetings.
- **Society:** people are a carrier and a source. Trade moves cores, seed and
  salt along the ways; extraction, hunting, clearance and burning act on the
  stocks and their media; tenure, walked routes, kept lines and the dead are
  recorded on the ground for the society-phase systems to read.
- **History:** every stock and record rides the crust where geology moves it.
  Numerical activity history is distinct from the lore's readable ice-memory.

Creators place and shape sources, works and conditions of these systems and
adjust meaningful system-specific parameters through curated controls. All
seven remain first-class implementations with their own state, causal feedback
and interactions; no universal spell editor or speculative extension framework
is implied. Do not import the reference game's named lore or global ice age, or
erase established mechanisms to make every system fit one generic vocabulary.

Magic feeds physical processes at the correct causal stage. Society can change
access, extraction, use and local physical conditions, and those changes feed
back into the appropriate system. Proposed social operations are distinguished
from implemented geographic behavior; [ADR 0004](adr/0004-coupling-through-each-systems-medium.md)
records how the pillars couple.

### 10.4 Cultural generation — new independent axis

Culture has identity and spatial prevalence, but should not be assumed to occupy mutually exclusive political polygons. Generate or author:

- Cultural origins/centers and population distributions, including multiple cultures in the same location.
- Migration, settlement patterns, language/religious affinities, and cultural diffusion relevant to the scope.
- Major cultural institutions and sites.
- Regionally refined communities and local variations informed by captured context, without requiring exact inherited population totals.

Dependencies can include terrain suitability, navigable routes, water, climate, magical hazards/opportunities, existing populations, historical eras, and neighboring cultures. The cultural generator should support separate seeds/options and targeted regeneration. Historical outcomes are projected into a static present-day state.

### 10.5 Political generation — new independent axis

Generate or author:

- States/polities and relationships among them.
- Claims, sovereignty, administration, effective control, and disputes as **distinct spatial facts**.
- Capitals, major jurisdictions, provinces, local districts, and political sites at appropriate scales.
- Territorial expansion or contraction and historical events sufficient to causally produce current borders.
- Borders influenced by terrain, rivers, connectivity, defense, population, cultural geography, resources, infrastructure, and established political relationships.

Political and cultural generation must be independently selectable and must not be conflated. Culture can cross borders; a state can encompass multiple cultures; claims can overlap; borders need not follow the boundaries of generation patches.

The initial generator can use a constrained historical model rather than a complete simulation of individual political actors. At World/Region scale, establish coherent polity patterns and subdivisions; at Local/Site, optionally refine administrative areas, ownership, guilds, and institutions. Interior layers can display ownership/control without running a macro-state generator.

### 10.6 Settlement, infrastructure, and built environment

Geography and human domains inform settlement and infrastructure placement. Include roads, ports, routes, settlements, structures, and their network/topological constraints as a generation domain or subdomain with explicit dependencies. At Site and Interior profiles, use specialized algorithms for layout, cave passages, parcels, building footprints, walls, rooms, and furnishings, together with direct authoring.

Do not require all content categories to be generated at every level; generators advertise where they are applicable.

---

## 11. Multi-epoch history and present-day editing

### 11.1 Historical scope — accepted

Preserve all major aspects of Canonry's multi-epoch causal generation and extend historical generation into smaller areas where meaningful. An epoch can impose geology, climate, magical conditions, cultural patterns, political changes, and settlement/infrastructure processes. Generated effects accumulate: erosion, deposition, fractures, glacial landforms, buried settlements, abandoned routes, ruined structures, etc.

History is **generation context and provenance**, not an interactive timeline in the initial product. Once an area has completed generation, ordinary editing acts on its **present-day** representation. A user can change a current river or modify ruins without automatically rerunning the entire past; changing historical generation assumptions is a distinct, explicitly destructive/reconciliatory operation.

### 11.2 Scale-specific historical processes

| Profile  | Representative historical causes and retained consequences                                               |
| -------- | -------------------------------------------------------------------------------------------------------- |
| World    | Plate assembly, orogeny, glacial epochs, global magical catastrophes, migrations, imperial rise/fall     |
| Region   | Watershed evolution, volcanism, localized glaciation, territorial changes, settlement growth/abandonment |
| Local    | River migration, landslides, ecosystem succession, fields, roads, demographic shifts                     |
| Site     | Construction stages, collapses, erosion, warfare, occupation, abandonment, rebuilding                    |
| Interior | Renovation, deterioration, flooding, deposits, use changes, buried/blocked passages                      |

For caves, a coherent history can inherit rock composition, fractures, elevation, groundwater/erosion, climate phases and magic from the parent; subsequently generate dissolution, collapses, sedimentation, flooding and habitation. Avoid generating a cave history independently that contradicts its region's rock and water history.

### 11.3 Historical inheritance

A child's generation history must derive from applicable parent epoch forcing and preserved physical/cultural/political consequences. The child adds spatial/temporal resolution and local processes, not arbitrary historical contradictions. It is not necessary to store a complete full-resolution map of every historical epoch; retain enough historical causes, state, and provenance to reproduce and explain the current outcome.

---

## 12. Editing, regeneration, and templates

### 12.1 Editing modes

**Semantic editing:** Create/reconfigure meaningful features and entities—river, road, mountain, forest, country, disputed border, cultural field, magical source, settlement, building. The service evaluates physical/topological/domain constraints and updates or invalidates downstream effects.

**Direct geometric editing:** Sculpt terrain or field values, reshape polygons and network paths, draw walls and cave passages, place structures and objects. Direct editing becomes dominant at Site/Interior levels. Tool-palette specifics are deferred.

**Procedural editing:** Generate a selected extent/domain, rerun a specific generator with adjusted constraints, fill a blank area, or replace selected generated output without overwriting authored protected work.

These are different authoring interactions over a **shared domain model**; none should silently replace semantic features with pixels.

### 12.2 Authorship and materialization states

The system must distinguish at least:

- **Latent:** A quantity, budget or propensity this profile computed for a unit it resolves (a cell, catchment, reach or coast segment), which a finer profile reads as forcing and may realize as features. No geometry finer than the mesh; nothing is hidden.
- **Absent:** Not generated at this profile. Nothing stored, nothing hidden; a finer profile generates it from the latent quantities and its own terrain. Coarse inherited geography may still be displayed.
- **Generated:** Content exists and can be selectively regenerated.
- **Authored:** Explicit user/agent edits exist.
- **Protected/locked:** Content or boundary conditions may not be overwritten by ordinary generation.
- **Intentionally empty:** User explicitly chose absence of detail/features, not merely “not generated yet.”
- **Invalidated/needs reconciliation:** Derived content is stale because dependencies changed.

These states may coexist within one area and vary by feature/layer. A single area-level `generated=true` flag is insufficient.

### 12.3 Re-generation policy

- Default regeneration preserves manual edits, templates and protected features, external boundary contracts, and linked feature identity.
- Users can target particular domains, sublayers, or regions. The system previews removals and changes when any saved content would be replaced.
- Reproducible results are tied to seed, algorithm version, parameter version, parent constraints, and epoch inputs.
- Partial regeneration must not silently delete siblings, change contracted crossings, or erase historical provenance needed elsewhere.
- Destructive rebase/reconciliation is a separate, explicit action with impact inspection and rollback/versioning.

### 12.4 Templates — accepted

Templates are authorable independent local spaces that declare a compatible geographic parent and a local coordinate frame (e.g., building interior within a structure, city block within a settlement, cave complex within compatible geology, island group within a coastal/oceanic region). Template content can mix manual geometry, domain entities, and procedural recipes.

Instantiation must:

1. Check the target parent's profile, area, units, physical traits, footprint and relevant terrain/network constraints.
2. Bind the template's local transform and features to world positions, including vertical/floor references.
3. Assign instance identities without confusing the reusable definition with the placed instance.
4. Integrate entrance/exit connections, relevant layers, and inherited constraints.
5. Produce a final **geographically parented** mapped area/features; never leave a committed free-floating tavern.

Whether later edits to a template propagate to existing instances is **not accepted**; default to no silent propagation, with explicit update/rebase as a future capability.

---

## 13. Web application and user workflows

### 13.1 Primary editing environment

- Main map canvas with pan, zoom, selection, geographic area refinement, and layer-aware inspection.
- Visible parent/child breadcrumb and geographic context; users can jump between creation levels without losing location.
- Layer panel supporting overlays, ordering, visibility, opacity, style, and scale-filtering.
- Feature/entity inspector exposing attributes, relationships, source, history, provenance, and current generation state.
- Creation tools appropriate to the current profile and selected layer; manual tools remain fast.
- Explicit distinction between **zooming** and **creating detail**.
- “Refine here” workflow for geographic selections and POIs; template insertion as an alternate creation flow.
- Visibility for ungenerated versus intentionally empty versus stale/refinement-needed geography.
- Optional analysis views for elevation, drainage, geology, climatic fields, magical intensities, political claims, cultural prevalence, etc.

### 13.2 High-quality generation experience

A generation request exposes: area, domains, inherited constraints, proposed boundary contract, seed/reproducibility, quality/detail preset, estimated complexity if known, and expected resource/time category. Generation can take minutes or **up to an hour**; that is acceptable as a stated product constraint.

The UI must show server-backed job state and meaningful stage progress (for example geology → climate/hydrology → magic → cultural/political → validation), as well as cancellation and failure diagnostics. Intermediate previews are desirable but must be distinguished from committed valid output. Closing the browser must not turn a running server job into an invisible or unknowable operation.

Quality presets should primarily control **spatial sampling/detail, algorithm depth, optional generation stages, and quality/accuracy tradeoffs**, not randomly remove causally required checks. A low-detail preview may be approximate; a committed full-quality result must satisfy structural contracts.

### 13.3 Manual-edit responsiveness

Common direct edits (select, move a POI, reshape a feature, sculpt a small local area, add a wall) must give immediate feedback without waiting for global physical, political, or cultural generation. More expensive derived field/network calculations are queued or explicitly requested, and their stale state is surfaced.

Suggested performance target—not a previously approved SLA—is perceptibly immediate interaction on supported hardware, typically under ~100 ms to visual feedback for common edits; measure and adjust against real-world test scenes. No normal manual edit should synchronously start an hour-long generator.

### 13.4 Representative user journeys

**World to tavern:** Create world → generate macro geography/magic/history → choose valley region → refine geography → generate/place settlement → refine site → place tavern footprint → instantiate or draw interior → preserve world anchor and return to regional view.

**Independent template:** Create tavern template in local units → design rooms/furniture → place into a geographically located building footprint → validate door/street connection → instantiate as anchored Interior map.

**Political/cultural view:** Generate geography → establish cultural distributions → generate historical polities/claims → show political overlay → refine border region → preserve polity identity and inherited border/network relationships → examine culture prevalence without enforcing one-to-one borders.

**River change:** Inspect existing watershed → draw/describe internal meander → validate invariant inlet/outlet and flow → preview local adjustments and invalidations → commit without changing adjacent region boundaries.

**Magical exception:** Establish captured-Fire heating at a frozen crossing → preview thaw, water and Aurora-reservoir changes → apply the change while keeping contracted external connections.

---

## 14. Persistent domain service and agent/MCP access

### 14.1 Architecture boundary — accepted

The backend is authoritative for persisted spatial and semantic state. The web client and agents are **two clients of the same versioned domain operations**. MCP is an interface/protocol over the service, not an independent store of agent-authored map facts.

Domain operations should expose intent and behavior, not merely a low-level “update arbitrary GIS rows” escape hatch.

### 14.2 Required operation families

| Family       | Representative capabilities                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Explore      | List worlds/areas/creation profiles/layers, inspect feature/entity/history, query spatial extent and intersections, read parent constraints |
| Analyze      | Analyze route/hydrology feasibility, show affected dependencies, explain generated feature causes, inspect boundary conditions              |
| Propose      | Create a candidate feature or change set, choose constraints/quality, preview GIS geometry and likely effects                               |
| Validate     | Enforce CRS, profile/containment, topology, trait, boundary, field and domain invariants                                                    |
| Commit       | Apply an authorized, version-checked transactional change with provenance and stable IDs                                                    |
| Generate     | Start/status/cancel/inspect a long-running scoped generation job; select domain/extent/quality/seed                                         |
| Reconcile    | Inspect conflicts and request explicitly authorized boundary or cross-scale changes                                                         |
| Undo/version | Undo user edits when possible, inspect history, restore a prior coherent snapshot or transaction                                            |
| Templates    | Create, inspect, validate, instantiate and update template definitions/instances                                                            |

An agent prompt such as “Add a river through the center of this region” should resolve the target area, inspect elevation and contracted waterways, propose a hydraulically coherent route, validate/preview it, and commit only the accepted operation. Agent and UI behavior must share validation logic and explain meaningful failures.

### 14.3 Edit safety

- Read and write scopes are explicit. Agents cannot bypass locked boundary contracts or protected authored content.
- Changes have an expected world/area version, enabling conflict detection and protection against stale agent context.
- Long-running operations are job-based and idempotent where feasible; a duplicate request must not create two rivers or two identical generation jobs accidentally.
- Multi-feature edits commit atomically, or fail without leaving orphaned partial geometry.
- Audit records identify actor (person/agent/generator), inputs, affected feature IDs, spatial scope, result, and invalidations.
- The UI can display agent-proposed changes on the map before applying them. High-impact/destructive changes need explicit confirmation.

---

## 15. Architecture guidance and implementation-dependent decisions

### 15.1 Prefer a GIS-capable authoritative spatial model

**Accepted requirement:** Use robust GIS-compatible coordinates and geometric/topological operations, including arbitrary overlays and scale-aware feature retrieval. **Recommended implementation direction:** A hybrid architecture where mature GIS/spatial persistence handles world reference, vector features, topology/query functions, and political/cultural overlays; specialized field/grid representations support Canonry-derived numerical generation.

Potential implementations include PostGIS for authoritative spatial features and relational associations, with field/raster storage and generated artifacts kept in formats suited to their size/access patterns. PostGIS is a strong candidate, **not an approved dependency**. The choice should be validated against hosting complexity/cost, custom fictional CRS support, raster needs, editing throughput, and agent-query semantics.

### 15.2 Retain the causal engine; do not preserve its gameplay-specific shape blindly

The Canonry engine provides domain-neutral physical layers and domain-specific magical layers. The replacement/extension should preserve the **causal contracts and algorithms**, not assume its Godot UI, hex runtime kernel, fixed-size simulation buffers, or icebound setting belong in the atlas product.

Current Canonry generation uses a global algebraic microtriangle lattice; its hex cells are later projections. That separation is useful. Whether the atlas retains the microtriangle grid for all physical generation, uses regional local meshes/rasters, or introduces hybrid sampling is a major technical decision. Whatever is chosen must satisfy reciprocal adjacency, projection integrity, boundary constraints, physically coherent hydrology, and deterministic cross-scale results.

Canonry's full-generation pipeline was designed for globally constructed fields and may take minutes. Selected-area refinement with halo constraints, local fields, cross-level summaries, and edit-aware invalidation is a new subsystem, not a trivial interface wrapper.

### 15.3 Decision table for implementation agents

| Decision                        | Product constraint                                | Recommended starting point                                                   | Must be proven before committing                                             |
| ------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| World geometry                  | Exact spatial reference at all levels             | Planar metre chart with explicit edge identification                         | Transformation validity, area/distance correctness, future CRS extensibility |
| Authoritative features          | Persistent IDs, geometry, queries, overlays       | GIS vector model, likely spatial DB                                          | Cross-scale feature identity; custom world CRS and local coordinates         |
| Generated fields                | Causal simulation, multiple resolutions           | Adapt Canonry field model plus tiled/coarse/fine artifacts                   | Edge/halo consistency, generation costs, versioned output                    |
| Region ownership                | No conflicting detail in overlaps                 | Explicit nonoverlapping materialization ownership; overlapping views allowed | Correct handling of arbitrarily drawn selection and existing generated areas |
| Political/cultural spatial data | Overlap, claims, diffusion                        | Polygons + fields + relations rather than exclusive polygons                 | Query and visualization of many-to-many coverage                             |
| Local site/interior geometry    | Small-unit precision and world anchoring          | Local frames with GIS anchor plus vertical metadata                          | Invertible transforms, valid entrances, cross-map connections                |
| Long jobs                       | Minutes/hour acceptable with transparent progress | Persisted server jobs with stage reporting and cancel                        | Consistent results, no partial published state, resource/cost controls       |
| Magic shaping                   | Seven authored systems; reproducibility           | System-specific controls over existing process contracts                     | Distinct media, costs, interference and causal geographic feedback           |

If a decision cannot be resolved by a narrow prototype or documented trade-off, record it as an architecture decision rather than burying it in code.

### 15.4 Proposed implementation slices (sequencing, not a substitute for complete product scope)

1. **Spatial foundation:** World reference, mapped area hierarchy, local frames, vector/field layer registry, geometry operations, persistence, basic web map and layer viewer. Test transforms and authoritative feature identity.
2. **Physical generation + first refinement:** Reuse Canonry physical/history core, coarse world result, Region refinement with locked physical/hydrological crossings, user-selectable quality and long-running jobs.
3. **Editing and regeneration:** Manual terrain/feature editing, semantic feature operations, authored protections, per-domain invalidation, previews, undo, explicit reconciliation.
4. **Magic authoring:** Shape Fire, Aurora and Pressure sources, works and conditions, preserving their distinct propagation, physical consequences, social uses and historical effects.
5. **Political/cultural axes:** World/Region generators, population/cultural fields, polities/claims/control, historical inheritance, layer presets and scale-specific refinement.
6. **Local/site/interior and templates:** Settlement/network layouts, cave and construction histories, vertical coordinates, building interiors and template instantiation.
7. **Agent integration and expansion:** Expose existing domain service through MCP, propose/preview/commit flows, generalized custom GIS layers/import-export, broader content coverage.

**Important:** The backend domain-command shape should be considered from slice 1; do not defer it until MCP integration. Political/cultural layer **representation** should also be designed from slice 1 even if generators are delivered later. The slices are a suggested incremental validation path, not permission to omit accepted requirements from the target design.

---

## 16. Functional requirements checklist

The following are target-product requirements. `Core` means foundational to the intended product, not necessarily delivered in the first engineering sprint.

| ID      | Requirement                                                                                                  | Priority                |
| ------- | ------------------------------------------------------------------------------------------------------------ | ----------------------- |
| GEO-01  | A declared world spatial reference resolves coordinates across all committed map areas and features.         | Core                    |
| GEO-02  | Finite creation profiles permit skips, POI-driven refinement, and sparse mapped-area coverage.               | Core                    |
| GEO-03  | Child areas have versioned, locked-by-default boundary and inherited-trait contracts.                        | Core                    |
| GEO-04  | Coarse and detailed geometries maintain stable semantic identity, topology, and appropriate generalization.  | Core                    |
| GEO-05  | Meaningful physical, vertical, and nonlocal network connections survive crossing map boundaries.             | Core                    |
| LYR-01  | All thematic layers are world-scoped and queried by geographic extent, not owned by a specific rendered map. | Core                    |
| LYR-02  | Built-in physical, water, magic, transport, settlement, political, and cultural layer families exist.        | Core                    |
| LYR-03  | Arbitrary user-defined GIS-compatible layers can be created without new generators.                          | Core                    |
| LYR-04  | Map views provide layer combinations, styling, visibility, and scale-dependent presentation.                 | Core                    |
| GEN-01  | Causal, deterministic multi-epoch physical world generation preserves Canonry's major processes.             | Core                    |
| GEN-02  | Fire, Aurora and Pressure retain their distinct mechanisms and affect geography, society and history.        | Core                    |
| GEN-03  | Independent cultural and political generators exist at applicable creation profiles.                         | Core                    |
| GEN-04  | Generators can operate on selected areas/domains and respect parent constraints and protected edits.         | Core                    |
| GEN-05  | Generation quality is configurable; jobs expose progress/failure and may run for up to an hour.              | Core                    |
| GEN-06  | Historical forcing is inherited at lower levels; post-generation editing changes present state only.         | Core                    |
| EDIT-01 | Direct and semantic edits remain interactive without waiting for global procedural regeneration.             | Core                    |
| EDIT-02 | Authored, generated, protected, intentionally empty, and stale states are distinguishable.                   | Core                    |
| EDIT-03 | Edits and regeneration validate spatial, hydrological, trait, and boundary contracts.                        | Core                    |
| EDIT-04 | High-impact changes provide impact inspection and explicit reconciliation.                                   | Core                    |
| TMP-01  | Detached templates declare parent-context/coordinate requirements and bind to real geography on placement.   | Core                    |
| DOM-01  | The UI and agents consume the same versioned domain operations and validation.                               | Core                    |
| DOM-02  | Backend supports spatial queries, preview/commit, generator jobs, feature history, and undo/versioning.      | Core                    |
| DOM-03  | MCP exposes appropriate authorized domain operations without direct mutable-store bypass.                    | Planned interface       |
| INT-01  | GIS-compatible geometric interchange is supported with documented CRS/metadata behavior.                     | Core                    |
| EXT-01  | New generation domains and layer types can be registered without rewriting the world/mapped-area model.      | Architecture constraint |

---

## 17. Acceptance scenarios and invariants

These are product acceptance cases, not implementation-specific unit-test scripts.

### Scenario A — Sparse world and skipped levels

Generate a world, refine one small polygon to Region, place a POI, then create its Site and a building Interior without creating a Local map. The rest of the world has only inherited coarse geography, the Site and Interior have valid parent lineage and world position, and zooming into unrelated areas does not fabricate fine features.

### Scenario B — Physically bounded river meander

A parent river crosses a mapped area at known endpoints with specified direction/flow. Regenerate the interior at higher resolution and manually add loops/oxbows. The river remains continuous and plausibly downstream, its feature ID is stable, its contracted crossings do not move, and no neighbor requires regeneration. Attempting to move an outlet through an ordinary edit produces a clear validation failure or a separate reconciliation workflow.

### Scenario C — Trait inheritance and magical exception

A Region inherits `flat | cold`. Its child produces low relief and consistent climate. Captured-Fire heating creates a localized thaw, changing water and Aurora retention. The final map retains natural fields, separate magical influences, effects and identifiable history rather than merely replacing its biome color.

### Scenario D — Historical inheritance at a cave

A cave is refined beneath a glaciated limestone landscape. Its rock, fractures, erosion, water and ice-era context agree with the parent. A later manual chamber edit changes the present cave without rewriting the region's geological epochs. A cave entry remains correctly located on the surface map.

### Scenario E — Political and cultural independence

Generate cultures and then states over a shared physical map. Two cultures may overlap inside one state; a territorial claim may overlap another state's control; a language boundary need not match a political boundary. Refine a border Region without creating new unrelated polity or culture IDs. Switching from Political to Cultural view changes presentation, not world data.

### Scenario F — Arbitrary GIS overlay

Add a custom archaeological-survey point/polygon layer with user-defined attributes, place features at Region and Site scales, query intersections with a river basin, and export spatial data retaining interpretable coordinate-reference metadata. This layer need not have a procedural generator.

### Scenario G — Templates

Design a standalone tavern Interior in local units and instantiate it in a world-located settlement structure. Its origin, orientation, floor heights, and access connections resolve into world geography. The detached definition remains reusable. The placed instance cannot exist without a valid geographic parent.

### Scenario H — Slow generation, fast editing

Start a high-fidelity regional generation job estimated to require many minutes. The UI reports stages and can inspect prior committed content. Independently edit a small already-materialized map with immediate feedback. Cancellation or generation failure leaves committed world state coherent; no half-generated artifacts are presented as final.

### Scenario I — Agent edits use the same rules

An agent proposes “Add a river through the center of this region.” It reads the area and contracted inputs, returns a proposal, identifies affected features, validates the path, and commits through the shared domain service. It cannot bypass locks or erase manually authored content. Undo/history identifies the actor and changes.

### Structural invariants

- Every committed mapped area and located feature has a valid world transform and parent/anchor.
- No two materialized patches silently own contradictory authoritative facts at identical location/layer/detail.
- Connected features across region boundaries maintain compatible, reciprocal topology and required physical fields.
- Cross-scale generalized and detailed representations of one feature preserve stable identity.
- Historical generation is deterministic for a stable declared seed/configuration/algorithm version; normal present-day edits do not mutate that history.
- Political and cultural coverage allow overlap and have distinct semantics.
- Mandatory layer/trait/geometry identifiers resolve; failed validation does not partially commit inconsistent spatial data.
- Protected authored content is not overwritten by ordinary regeneration.

---

## 18. Known risks and explicitly unresolved implementation choices

These issues need engineering decisions/prototypes, but **do not block the product specification**:

1. **Global topology and projection:** Cylinder and open metre charts are supported. Ocean-rim generation and geodesic spherical geometry remain deferred.
2. **Numerical refinement strategy:** How Canonry's globally connected microtriangle graph is adapted to selected child extents/halos and possibly other geometry; verify drainage, erosion and glacial boundary correctness.
3. **Authority across varying detail:** How coarse parent constraint geometry, high-resolution child geometry, cross-area patches, and cartographic generalization are stored and reconciled.
4. **GIS persistence split:** Which data live in a spatial database versus raster/tile/object storage versus generator artifacts; evaluate costs and query/edit patterns.
5. **Magic fidelity and social use:** Represent fire-core extraction and release, Aurora crystal/ice-memory practices, depth-dependent Pressure use and their distinct costs and interference at atlas scale. Distinguish lore-supported additions from existing implementations.
6. **Political/cultural generation fidelity:** Select plausible initial algorithms and scale-dependent state without inventing a full agent-based history simulation.
7. **Large-region resource budget:** Implement deterministic job execution, reproducible intermediate state, bounded resource use, cancel/restart, stage reporting, and failure recovery.
8. **Template updates:** Defaults for propagating improvements to already placed instances; never silently rewrite existing instances.
9. **Cross-area reconciliation UX:** Start with locked boundaries and impact-reporting; more automatic propagation can come later if demonstrated safe.

Agent teams should document design decisions with invariants, alternatives, constraints, and a smallest proving prototype. They should not replace this product scope with a conventional raster map painter or a purely GIS dataset viewer.

---

## 19. Source review and research references

### Canonry — authoritative internal precedent

- [Repository: chris-arsenault/the-canonry-game](https://github.com/chris-arsenault/the-canonry-game)
- [Causal physical world generation design](https://github.com/chris-arsenault/the-canonry-game/blob/main/docs/design/physical-microgeography-worldgen.md): ordered physical and magic layers, global lattice, history, validation.
- [Physical geography pipeline](https://github.com/chris-arsenault/the-canonry-game/blob/main/src/Engine.WorldGen/PhysicalGeneration/Pipeline/PhysicalGeographyPipeline.cs): explicit stage and dependency ordering.
- [Physical geography evolution session](https://github.com/chris-arsenault/the-canonry-game/blob/main/src/Engine.WorldGen/PhysicalGeneration/PhysicalGeographyEvolutionSession.cs): interleaved multi-epoch phases.
- [Ice Remembers world-generation orchestrator](https://github.com/chris-arsenault/the-canonry-game/blob/main/src/IceRemembers.Seed/PhysicalGeneration/IceRemembersWorldGenerationOrchestrator.cs): domain magic forcing interleaved with physical evolution.
- [Magical field and environmental effect implementations](https://github.com/chris-arsenault/the-canonry-game/tree/main/src/IceRemembers.Seed/PhysicalGeneration/Layers): Fire, Aurora, Pressure, interactions, advection, feedback.
- [Growing map](https://github.com/chris-arsenault/the-canonry-game/blob/main/docs/systems/26-growing-map.md): latent coarse world versus materialized gameplay frontier. **Do not confuse revealing latent fields with generating new detail.**
- [Map/spatial model](https://github.com/chris-arsenault/the-canonry-game/blob/main/docs/systems/04-map-spatial.md) and [map visualization](https://github.com/chris-arsenault/the-canonry-game/blob/main/docs/systems/10-map-visualization.md): projection and display separated from generated geography.
- [Geological feature identification](https://github.com/chris-arsenault/the-canonry-game/blob/main/src/Engine.WorldGen/PhysicalGeologicalFeatureIdentification.cs): named features identified on the generation lattice before downstream projection.

### External design precedents — informative, not mandatory technology choices

- [USGS National Map / US Topo](https://www.usgs.gov/programs/national-geospatial-program/us-topo-maps): standardized topographic products and geographic themes.
- [USGS Watershed Boundary Dataset](https://www.usgs.gov/national-hydrography/watershed-boundary-dataset): nested physically meaningful watershed units.
- [USFS FSTopo](https://www.fs.usda.gov/managing-land/maps): forest cartography and standardized layers.
- [Esri ArcGIS Pro documentation](https://pro.arcgis.com/en/pro-app/latest/help/mapping/): authoritative geographic data separated from cartographic presentation, attribute validation, and topology.
- [QGIS user manual](https://docs.qgis.org/latest/en/docs/user_manual/): geographic extent-based atlas generation and scale-dependent views.
- [OGC API Features](https://ogcapi.ogc.org/features/overview.html): standards-based feature access.
- [OGC Simple Feature Access](https://www.ogc.org/standards/sfa/): standard vector geometry semantics.
- [Worldographer](https://worldographer.com/): explicit world/region/detail map creation and hierarchical hex refinement.
- [Azgaar Fantasy Map Generator](https://azgaar.github.io/): generation domains, thematic layers, and geographically constrained editing.
- [Campaign Cartographer](https://www.profantasy.com/products/cc3.asp): separate overland, city and dungeon workflows.
- [World Anvil](https://www.worldanvil.com/): linked maps, POIs, and hierarchical world atlas organization.

The external products establish proven interaction and spatial-data patterns; they do not solve the new product's causal, edit-aware, multi-epoch _generation refinement_ problem.

---

## 20. Implementation-agent handoff instructions

Treat this document as the **product/domain contract**, not as permission to start by selecting a web framework and building a renderer. Begin implementation planning with these deliverables, in order:

1. **Domain/coordinate ADR:** world geometry, local frames, vertical frames, feature identity, geographic containment, ownership of overlapping refinement patches, and GIS interoperability.
2. **Refinement-contract proof:** one parent geographic field and one bounded child area, a river/road crossing, inheritance of constraints, and safe localized re-generation with authored-content protection.
3. **Generator abstraction:** domain-neutral layer contract, long-running job contract, history/provenance, spatial extents and invalidation; identify which Canonry components are kept, adapted, or replaced.
4. **World-layer and entity schema:** physical/magic/cultural/political/custom layer types, relations, overlapping coverage, and style/view separation.
5. **Editor/domain command specification:** manual geometry change, semantic feature change, template instantiate, boundary reconciliation, undo, versioning, agent preview/commit.
6. **Thin integrated vertical slice:** create world → generate coarse geography → refine one region with locked river crossings → edit a POI/road → toggle a political or cultural overlay → query and modify the same world via the domain API.

For each work packet, identify user-visible behavior, owning domain layer, invariants, dependencies, acceptance tests, performance impact, and any deliberate deferrals. Prefer narrow reuse of proven Canonry algorithms and mature GIS tooling. Avoid adding full simulation systems, independent per-level stores, or global regeneration when the product only requires a local edit.

**Definition of product success:** A creator can build a geographically and historically coherent world piece by piece, at multiple meaningful levels, while the same world is available as editable spatial features and layers to humans, generators, and agents—without sacrificing manual editing responsiveness or silently discarding user-authored detail.
