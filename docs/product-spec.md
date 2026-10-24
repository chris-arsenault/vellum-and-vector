# World Atlas Creator

**Current implementation scope — 2026-10-18:** The user has deferred the backend,
all persistence and MCP until the frontend product functions. The browser owns
session memory and runs generation in a worker; closing or reloading the tab
discards state and stops generation. [ADR 0003](adr/0003-frontend-session.md)
supersedes this document's backend, durable-job, recovery and service requirements
for current work. Geographic authoring behavior remains the product direction.

**Magic direction — clarified 2026-10-22:** Fire, Aurora and Pressure are
first-class world effects and processes with distinct physical motivations.
Use Canonry as a mechanism reference without importing its named setting lore.
Future magic systems remain open; extensibility must preserve the current three's
specific behavior. Source placement, system-specific settings and shaping remain;
see section 10.3 and [magic source authority](../AGENTS.md#magic-source-authority).

## Product, Domain, and Generation Design — Implementation-Agent Handoff

**Status:** Consolidated design baseline (v0.1)  
**Date:** 2026-10-17  
**Audience:** Product/design agents, domain architects, GIS specialists, procedural-generation engineers, UI implementers, test agents  
**Source project:** [chris-arsenault/the-canonry-game](https://github.com/chris-arsenault/the-canonry-game)  
**Scope:** Product behavior, domain concepts, architectural constraints, and acceptance contracts. This is **not** a code design or mandate to reuse Godot, the Canonry kernel, or any specific database.

---

## 1. Executive summary

Build a web-based, GIS-oriented creator for fictional worlds in which geography can be procedurally generated, edited, and progressively refined from global scale to individual sites and interiors. The differentiator is **sparse, geographically anchored, multi-level creation**: users generate only the level of detail they care about, while maintaining physical, spatial, historical, political, and cultural consistency with the larger world.

The product draws heavily on _The Canonry Game_'s deterministic, causal, multi-epoch physical geography generator. Its generation model includes geology, crust evolution, tectonics, hydrology, erosion, climate, glaciation, coasts, and several interacting magical forces. The new product must generalize and extend this approach to:

1. Support refinement on demand at a finite set of **creation profiles**, rather than precomputing the whole world at every resolution.
2. Provide **fast manual and semantic editing**, even when high-fidelity procedural generation takes minutes or up to an hour.
3. Maintain a **rigorous coordinate and spatial-reference model** for geographic features at every level, using mature GIS concepts and tooling wherever feasible.
4. Treat **physical, magical, political, cultural, and future custom GIS layers** as shared world data, not map-specific drawings.
5. Introduce **independent, causally interacting generation domains** for political and cultural geography alongside physical and magical systems.
6. Provide a persistent **agent-accessible domain service**, eventually exposed through MCP, which edits the same authoritative world model as the graphical UI.

**Core product rule:** A finished world map, from a continent map to a tavern floor plan, must have a traceable geographic parent and a resolvable world location. Only _templates_ may be authored independently of a world.

**Core generation rule:** Child maps inherit constraints and boundary conditions, not an obligation to clone their parent's geometry. Users may reshape the interior freely where those constraints and physical laws permit. Established map-boundary interfaces remain locked during ordinary editing.

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
- Use a **finite, genre-neutral set of creation levels**; levels are neither arbitrarily recursive nor an infinite zoom ladder. A user can skip intermediary creation levels.
- Leave large parts of the world ungenerated or under-detailed indefinitely.
- Support procedural generation at most levels and direct editing at all appropriate levels. The balance should shift toward manual creation at small scales.
- Preserve Canonry's causal geography and the distinct Fire, Aurora and Pressure systems, including historical effects and system-specific creator controls.
- Make physical consistency the default. Traits and inherited constraints limit refinement; exceptions must have explicit authored or supernatural causes.
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
7. **One editing semantics.** Direct tools, procedural jobs, and agents create the same domain operations with validation, preview, history, and undo where applicable.
8. **Dependencies are explicit.** A change identifies what it invalidates and what requires reconciliation; no unannounced large-area rewriting.
9. **Cost follows requested detail.** Fine generation should only occur where explicitly materialized, not over the entire planet by default.
10. **Do not build a civilization simulator by accident.** Political and cultural generation can be staged and historically causal without implementing Canonry's entire gameplay runtime.

### 2.3 Non-goals for the first usable product

- Running an ongoing civilization simulation or continuously advancing in-world time after generation.
- Editing historical epochs as a timeline editor, or providing a time slider through past map snapshots.
- Generating every level everywhere or maintaining an infinitely deep map hierarchy.
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

**Implementation option:** Start with a planar world and one coherent, explicit world CRS; preserve the domain abstraction for spherical/wrapped worlds. Whether spherical worlds are required at initial release must be decided explicitly rather than silently precluded.

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

**Mapped area** owns a parent reference, creation profile, geographic footprint, local coordinate frame, inherited-effective traits, boundary-contract version, area-specific generation configuration, generation/materialization state, and authored-content protections.

**Layer definition** owns a semantic name, supported geometry/field/network representation(s), feature schema, allowed creation profiles, style/filter metadata, validation rules, source (manual/imported/generated/derived), and optional generation-domain registration.

**Spatial feature** owns a persistent ID, type, geometry/field/network coverage and its geographic reference, semantic attributes, causal provenance, authored state, associations, and any linked coarse/detail geometries. At least one resolvable map/world location is required for a committed spatial feature.

**Domain entity** owns its semantic ID and characteristics; it may relate to many features or layers. A kingdom, for instance, can have sovereign territory, claimed areas, actual-control areas, capital points, and routes without being a single polygon.

**Generation record** owns a seed, algorithm/configuration versions, parent constraint versions, epochs/history parameters, output extent and layers, completion state, warnings, and provenance for generated features. This supports reproducibility and safe regeneration, not just logging.

**Template** owns a declared local space and parent-context contract, internal features, optional generation recipe, parameters, and insertion rules. Instantiation creates bound world objects with stable instance IDs.

### 6.2 Feature identity and cross-scale geometry

- A river, kingdom, mountain range, or road retains stable **semantic identity** regardless of the current rendering scale.
- At coarse scale, a feature may have a generalized geometry or skeletal constraint; refinement may produce detailed geometry for only part of its extent.
- Detailed geometry is linked to the same feature identity, not represented as an unrelated duplicate feature.
- Coarse display geometry is generalized/derived from available authoritative detail where possible, while previously established parent skeletons remain constraints where detail has not been materialized.
- No generalized map may invent a contradictory new source, endpoint, border ownership, or connection for the same feature.
- Significant boundary-altering changes require explicit reconciliation, potentially including updates to the parent summary and adjacent mapped areas.
- **Feature identity is not the same as a specific coordinate or sample index.** IDs should remain stable under reasonable editing and resampling.

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

### 7.3 Political and cultural modeling

**Political geography must not be reduced to a single mutually exclusive territory layer.** Distinguish, at minimum:

- Sovereign or recognized state territory.
- Administrative subdivisions and jurisdictions.
- Territorial claims and disputes (overlapping allowed).
- Effective control/occupation (may differ from claims or sovereignty).
- Relevant capitals, institutions, and political relations.

**Cultural geography must not be forced into exclusive polygons.** Multiple cultures, languages, traditions, and religions may coexist geographically. Support distributions/prevalence fields and optionally inferred boundaries for cartographic presentation. Store genuine institutions, communities, and important sites as entities/features.

Political and cultural map content should be available at every creation level where meaningful. World and Region generators can model states, cultural distributions, and broad administrative structure; Local/Site generation can model wards, local control, groups, property, and institutions. Interior maps can display ownership, restricted areas, affiliations, and artifacts without requiring a dedicated interior nation-state generator.

---

## 8. Traits, physical consistency, and authored exceptions

### 8.1 Trait classes

| Class                  | Meaning                                                              | Examples                                                              |
| ---------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Hard constraint**    | Enforced generation/edit bound unless an authorized exception exists | Maximum relief, frozen river crossing, coastal outlet requirement     |
| **Soft tendency**      | Shapes likelihood/strength; not an invariant                         | Forested, volcanically active, river-rich                             |
| **Derived trait**      | Computed from generated or authored data                             | Glaciated, densely inhabited, drought-prone                           |
| **Exception/override** | Explicit reason to violate an inherited/default constraint           | Fire-heated refuge within a cold region, maintained ice-free crossing |

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

---

## 9. Boundary contracts and successive refinement

### 9.1 Why boundaries are locked

A child map must be generatable and editable without requiring the whole world to be regenerated. Establish **stable boundary conditions for each mapped area**, derived from its parent and neighboring authoritative features. These are **generation interfaces**, not physical walls or necessarily political borders.

Boundary contracts are **immutable during ordinary local generation and editing**. They may change only through an explicit higher-impact operation that reports required reconciliation. This is an accepted product simplification for the initial implementation.

### 9.2 Initial boundary contract contents

| Category           | Required inherited/cross-boundary data                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Physical surface   | Edge elevation/relief or equivalent boundary samples; coastline intersections; major terrain form continuity                         |
| Hydrology          | River inlet/outlet locations and direction, receiving water bodies, relevant water-surface levels and approximate discharge/balance  |
| Networks           | Road/path/cave connections, crossing positions, connection classifications and topology                                              |
| Fields             | Required edge behavior/samples for climate, relevant magical influences, and other causally coupled fields                           |
| Spatial features   | IDs and crossing anchors of features spanning the area; stable parent-feature references                                             |
| Thematic layers    | Parent political/cultural coverage or distributions and any necessary border-crossing relationships, interpreted at the target scale |
| Historical context | Relevant epoch forcing, physical substrate history, migration/settlement history and preserved consequences                          |

For continuous fields, a boundary may require a profile/gradient or neighboring influence halo, not a single scalar. The actual interpolation/numerical representation is an implementation decision.

### 9.3 Refinement contract — normative behavior

1. **Select:** User chooses parent, extent, and creation profile.
2. **Resolve:** System gathers effective traits, relevant parent features, historical forcing, available layer data, and neighboring conditions.
3. **Contract:** Establish a versioned boundary contract with crossing anchors and fixed environmental conditions.
4. **Choose:** User selects generation domains, detail quality, manual/blank/template mode, and any lawful local specializations.
5. **Generate or author:** Interior detail is created with deterministic inputs and source provenance. The area may remain mostly blank.
6. **Validate:** Check inherited hard constraints, crossing topology, feature identity, hydrology, permitted exceptions, and protected authored content.
7. **Commit:** Publish a coherent new area snapshot/transaction. Derived parent-scale presentation updates without creating competing semantic features.
8. **Continue:** Later edits and regenerations use the same constraints and preserve protected work.

### 9.4 Allowed and disallowed examples

**Allowed:** At Region scale a river has fixed north inlet and south outlet. Local generation adds many internal bends, tributaries, oxbows, river terraces, and islands while preserving the in/out connections and physically coherent downstream flow.

**Disallowed ordinary edit:** Move the river's southern outlet to an adjacent watershed without modifying the boundary contract and the relevant parent/neighbor areas.

**Allowed by explicit reconciliation:** User elects to redirect the river across the region boundary. System shows the affected upstream/downstream reaches, areas, road crossings, and political boundaries that follow the waterway, and requires an explicit higher-impact change.

**Allowed with supernatural cause:** Captured Fire maintains an ice-free river crossing inside an otherwise frozen region. Its heat and meltwater affect downstream processes while contracted external connectivity remains valid.

### 9.5 Reconciling impacts

- Ordinary geometry operations update local visible geometry immediately; expensive derived analyses may be marked dirty and processed later.
- Regeneration operates over declared affected fields/dependencies and geographic extents, not by replacing all child content.
- Parent-to-child input changes do not silently overwrite authored content. Show conflicts and allow targeted regeneration/rebase.
- Explicit boundary modification must identify impacted siblings, parents, connected features, and layers before commit.
- Feature relations such as “political border follows river” should bind to river geometry/identity, not duplicate an unrelated approximate polyline.
- Region creation boundaries can be arbitrary geographic polygons. A continuous river/forest/culture can cross them even though generation responsibility is partitioned.

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
- Named geological feature extraction where supported (rivers, lakes, peaks, craters) and additional generalized GIS features in the new product.
- Deterministic seeds and structural correctness; rendered geographic review as a complementary quality gate.

**Do not assume Canonry already supports arbitrary selected-region refinement.** Its current latent-world geography is generated globally, then exposed and summarized at different rendering/gameplay resolutions. Sparse _generation_ with stable child boundaries is new work.

### 10.3 Magical generation — Fire, Aurora and Pressure

These are three distinct authored systems, not examples of interchangeable
source/effect combinations. Read Canonry's [lore bible, section 7](../../the-canonry-game/docs/lore/lore-bible.md#7-the-three-fires--magic-system)
and [physical generation design, sections 8–11](../../the-canonry-game/docs/design/physical-microgeography-worldgen.md#8-fracture-network-and-fire),
alongside the corresponding implementations. Lore explains motivations;
implementation establishes which geographic mechanisms exist. Named gods,
peoples, artifacts, places and events are reference context, not atlas content
requirements. Social applications below are setting-independent adaptations.

- **Captured Fire:** Fire-cores are mineral stores of geothermal energy, mined
  from veins and released by cracking. Geographic Fire follows fracture
  conductance, heats terrain, melts ice and hardens rock; it is a wellspring of
  life as well as heat, quickening growth, turnover, seeding and decay around
  its cores (Ember grove, Thaw meadow), opening the conduits it flows through
  until a spent vein seals, and carrying warmth down the rivers below it.
  Society uses cores for heating, forging, cutting and excavation; release can
  rupture structures and injure practitioners. Extraction, access and depletion
  have social consequences.
- **Aurora-light:** Aurora accumulates toward colder terrain and is retained in
  thick ice; its geological influence weakens rock. It acts through the charge
  its ice holds: stored charge keeps ice from ablating, casts a cold shadow of a
  few degrees, and stills the life within (slow growth and turnover, preserved
  matter; Rime forest, Glow-lichen barrens), releasing what it preserved where
  the field retreats. Aurora-crystals collect and store charge for slow
  perception, distant seeing, preservation and ice-memory reading. Cognitive
  strain is a proposed cost of sustained practice. It is not an offensive beam,
  generic fertility source or interchangeable fuel for Fire.
- **Pressure-depth:** A deep-ocean pressure locus drives geographic pressure
  propagation. Ocean paths, reflection and overlapping rays produce crush zones,
  coastal stress and wake/rogue-impact history, and a front moves water: where a
  ray shoals it lifts cold deep water (upwelling, a cold sea surface, fog on the
  coast it faces; Fog heath, Moss forest), and its wakes leave warm still water,
  so a large front changes the local climate. Practitioners descend into deep
  water, carrying charge for subsonic communication and directed force. Depth
  tolerance constrains access; costs of sustained practice remain an adaptation
  proposal. The source's named deity and current are not required.
- **Interference:** The disciplines do not combine cleanly. Preserve Fire/Aurora
  interference, dissipation of carried Pressure near Aurora-crystals, and
  destructive Fire/Pressure contact. Geographic thermal war rims, steam fractures
  and Pressure/Aurora breaches retain their separate causes and physical substrate.
- **History:** Retain and advect geographic consequences where geology moves
  them. Numerical activity history is distinct from the lore's readable ice-memory.

Creators place and shape sources, works and conditions of these systems and
adjust meaningful system-specific parameters. Future magic systems may add their
own world effects and processes through the shared generation structure. The
current three must remain first-class implementations with their own state,
causal feedback and interactions. This does not require building a universal
spell editor or speculative extension framework now. Do not import the reference
game's named lore or global ice age, or erase established mechanisms to make
every system fit one generic vocabulary.

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
- Regionally refined distributions, communities, and local variations respecting coarse inherited totals/biases without pretending precision that was never generated.

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

| Decision                        | Product constraint                                  | Recommended starting point                                                   | Must be proven before committing                                             |
| ------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| World geometry                  | Exact spatial reference at all levels               | Planar world first; abstract for globe/wrapping                              | Transformation validity, area/distance correctness, future CRS extensibility |
| Authoritative features          | Persistent IDs, geometry, queries, overlays         | GIS vector model, likely spatial DB                                          | Cross-scale feature identity; custom world CRS and local coordinates         |
| Generated fields                | Causal simulation, multiple resolutions             | Adapt Canonry field model plus tiled/coarse/fine artifacts                   | Edge/halo consistency, generation costs, versioned output                    |
| Region ownership                | No conflicting detail in overlaps                   | Explicit nonoverlapping materialization ownership; overlapping views allowed | Correct handling of arbitrarily drawn selection and existing generated areas |
| Political/cultural spatial data | Overlap, claims, diffusion                          | Polygons + fields + relations rather than exclusive polygons                 | Query and visualization of many-to-many coverage                             |
| Local site/interior geometry    | Small-unit precision and world anchoring            | Local frames with GIS anchor plus vertical metadata                          | Invertible transforms, valid entrances, cross-map connections                |
| Long jobs                       | Minutes/hour acceptable with transparent progress   | Persisted server jobs with stage reporting and cancel                        | Consistent results, no partial published state, resource/cost controls       |
| Magic shaping                   | Authored Fire, Aurora and Pressure; reproducibility | System-specific controls over existing process contracts                     | Distinct media, costs, interference and causal geographic feedback           |

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

1. **Global topology and projection:** Whether v1 is planar only or includes spherical/wrapped worlds; choose before designing storage transforms and geometry indexes.
2. **Numerical refinement strategy:** How Canonry's globally connected microtriangle graph is adapted to selected child extents/halos and possibly other geometry; verify drainage, erosion and glacial boundary correctness.
3. **Authority across varying detail:** How coarse parent constraint geometry, high-resolution child geometry, cross-area patches, and cartographic generalization are stored and reconciled.
4. **GIS persistence split:** Which data live in a spatial database versus raster/tile/object storage versus generator artifacts; evaluate costs and query/edit patterns.
5. **Magic fidelity and social use:** Represent fire-core extraction and release, Aurora crystal/ice-memory practices, depth-dependent Pressure use and their distinct costs and interference at atlas scale. Distinguish lore-supported additions from existing implementations.
6. **Political/cultural generation fidelity:** Select plausible initial algorithms and scale-dependent state without inventing a full agent-based history simulation.
7. **Large-region resource budget:** Implement deterministic job execution, reproducible intermediate state, bounded resource use, cancel/restart, stage reporting, and failure recovery.
8. **Cartographic styling:** Establish presentation presets/symbols/generalization independently of geographic truth; exact visual styles and hand-drawing palettes are deferred.
9. **Template updates:** Defaults for propagating improvements to already placed instances; never silently rewrite existing instances.
10. **Cross-area reconciliation UX:** Start with locked boundaries and impact-reporting; more automatic propagation can come later if demonstrated safe.

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
