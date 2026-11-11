# Product backlog

The product is browser-only, with explicit local map saves and no backend or MCP.
The backend source stays in the repository. Manual editing, its authoring tools and
undo are deferred under the [current product scope](product-spec.md); an entry
that involves them does not authorize implementation, repair or deletion of their
existing code.

## World generation

- [ ] **1. Express every generation parameter in world units.** Distances,
      elevations, areas and physical rates are declared in world units inside the
      algorithms and their parameters, so changing sampling resolution never
      changes a parameter's physical meaning. Restate the remaining thresholds
      that are written in cells, flow units or epochs, and remove output adapters
      that compensate for lattice units. Keep generation deterministic and its
      causal process sequence intact.

- [x] **2. Decide what an ice-age round's bands become.** People inside a
      geological epoch live a loose pass: they move with the wild and build
      nothing, so an epoch leaves no towns. The same people go on into the
      settled eras; nobody is founded twice
      ([ADR 0012](adr/0012-people-live-on-the-lands-layers.md)).

- [ ] **3. Ocean-surrounded worlds.** The map-boundary setting reserves this
      choice. Add a physical ocean rim that survives tectonic, erosional and
      sea-level epochs, using the existing conditioning and authored-protection
      rules; a painted border or land clipped at the map edge is not an ocean
      boundary.

- [x] **4. Let inherited weak beds affect later deformation.** Ground supplies
      finite seam thickness, continuity and cap geometry to collision and
      reactivation. Salt and ordinary weak beds use the same response; erosion
      and disruption can remove it. No fixed broad, low belt template is imposed
      ([ADR 0007](adr/0007-magic-systems-are-materials.md)).

- [ ] **5. Support true spherical worlds.** Generate a complete planet with
      spherical distances, cell areas and adjacency and no physical boundary at the
      poles. Adapt physical operators, directional fields and conservative
      material transport to the surface, and move plates by rotations about the
      planet's centre. Keep feature identity, authoring and refinement coherent
      across projection seams and poles, with local metre frames for finer
      geography. Start from an approximately uniform triangular spherical mesh
      with projected atlas views, reusing the process pipeline and epoch history
      where their geometry permits; a 3D globe viewer is separate work. Today
      pole-to-pole coverage uses cylindrical metre geometry with independent
      terrain along its closed north and south edges.

- [ ] **27. Carry very long rivers across wide continents.** Parameters support
      narrow worlds and fat ones, and an Earth-sized, full-latitude example world
      ships with the product, so continents must be able to hold rivers that cross
      them. Let the land settings produce broad, compact continents. Let major
      rivers occupy the long lows that tectonics makes: basins beside ranges, where
      mountain weight bends the crust down, rifts and failed rifts, and let them cut
      through ranges where they cross. Let sediment fill those lows into river
      plains. Judge rivers at world scale by these lows and at regional scale by
      rock, where trellis drainage forms. Spherical worlds (item 5) are separate
      work.

## People

- [ ] **28. Music as a part of culture.** Decide what music stands for in a
      generated people, how it relates to tongue, faith and custom, how it
      travels and what a map shows because of it. No taxonomy, audio or playback
      is chosen.
- [ ] **29. Exchange beyond food.** A pass brings food from where it is grown to
      where people gather. Nothing else is traded: no goods, no materials, no
      prices, and no stock of fish or game that use can wear down.

## Magic

Shared physical magic interactions are implemented in the
[generation guide](generation-workflows.md): items 4 and 6–11, existing
source/access/maintenance boundaries within item 12, and shared producers for
14–19. Regional execution remains open in those regional items. New society
designs and deferred authoring retain their separate scope.

People's use of magic follows
[ADR 0012](adr/0012-people-live-on-the-lands-layers.md): each system's craft
breaks a rule an existing process obeys. Item 12 lists the rules not yet broken.
Item 13 remains deferred authoring.

- [x] **6. Hold sea ice with Aurora shelf charge.** Marine ice reads retained
      persistence; melting and transport act on its actual carrier.
- [x] **7. Drift stocks with ocean currents.** Declared marine carriers follow
      currents and water-connected recipients alongside the other shared carriers.
- [x] **8. Carry Greenwood litter into receiving ground.** River sediment moves
      charged organic material into deposits and retained beds; groundwater can
      leach it and return charge at suitable ground. Braided-channel morphology
      remains shared river work.
- [x] **9. Mobilise existing brine under clearance.** Reduced root uptake returns
      actual stored groundwater and its dissolved charge. Water volume per area
      is not treated as a water-table elevation; clearance cannot create Salt.
- [x] **10. Develop isolated basins and move their residue.** Shared coastal
      contact, sediment movement, connectivity and drying support Salt formation;
      storms carry actual grains. Available material and water determine whether
      the sequence completes, and later deposits can cover its residue.
- [x] **11. Show actual Veil displacement.** Completed surveys retain overlapping
      wild-zone identities; inspection compares earlier and current footprints.
      Disjoint or ended patches do not acquire invented trajectories.
- [ ] **12. Rules people's magic does not yet break.** A rule can be broken only
      once a process asks it as a shared question. Still written inside their
      processes: a wall holding in a siege (Fire), the season that vegetation
      and climate feel inside a hearth ring (Fire), when the ice ends (Aurora),
      where storms go (Pressure), tongues and faiths crossing a door (Veil), and
      whose tongue the born take, which readers of old ice would answer
      (Aurora). Also open: the practitioners' own price is told in a place's
      record and not modelled; people who leave a craft's medium keep the craft
      and never forget it; a held sea bed has not been traced through the lake
      solver; Hallowed wards on a draft world are too weak for vowed ground to
      appear; Salt and Hallowed stocks neither age nor grow during the human
      eras. Temple cities, pilgrim traffic and fortresses at doors have no
      mechanism yet.
- [ ] **13. Author ward lines and paired doors.** Let an authored magic source be a
      line for a ward and two linked ends for a door.

Explicit preserved organisms, resurrection and new biological mass-death models
remain undecided ecology/society proposals. Current meetings use existing material,
vegetation, mortality and hazard mechanisms; their names do not imply those added
simulations.

## Regional refinement

- [ ] **14. Regional terrain.** Add calderas as closed-basin roots with crater
      lakes, lava plateaus, and spring lines at escarpment feet. Add landmark
      responses (falls lip retreat lengthening the gorge, scarp and rim retreat,
      breach deepening) and conjunctions (a canyon bridge town, falls portages,
      dome-ring trough roads, escarpment pass towns). Keep flat parent ground flat
      so small rivers get valley floors and riparian strips, and keep shore relief
      on resistant rock near the parent's low coastal heights.
- [ ] **15. Regional coasts.** Re-root the drainage network at a moved shore, add
      barred lagoons through longshore drift, add depth classes (shoal and
      intertidal, bay, shelf), and let the shore read magic's declared coastal
      forcing.
- [ ] **16. Regional climate.** Carry moisture downwind on the captured wind and
      form fog belts on Pressure coasts.
- [ ] **17. Regional ecology.** Form peat bogs behind moraines.
- [ ] **18. Regional magic.** Resolve captured stocks onto their carriers, add a
      regional storm medium, crust dried basins as Salt beds, retrace Pressure rays
      near a changed coast, give the Hallowed rim a geographic width, measure Veil
      strain per metre, release Fire from captured cores, base aquifer springs on
      network catchment, scale door pairing distance to the frame, and add
      magic-landmark conjunctions.
- [ ] **19. Regional people.** A regional map lives its inherited people with
      the world's pass and reads its places, ways, fords, bridges and mills
      from its own layers. Open:
  - Built ground, remains and farmland far from people are inherited as an
    even share of each parent cell and stay as squares. Gather them as people
    are gathered, so a town has an old quarter and a region can find its own
    ruins.
  - Cultural regions and realms are the parent's outlines; read them from the
    region's layers. Restore each realm's seat and whether it has ended, so a
    region can find capitals.
  - A town the parent recorded keeps the parent's point and population while
    its crowd may sit a few cells away. Reconcile the record with the crowd.
  - Craft places captured from the parent and those read from the region's
    layers are not reconciled.
  - Ways do not hear the road costs and joined cells that places declare
    (worn ground at a town, a bridge, a door's two ends). A way that passes
    between two river cells diagonally finds no crossing.
  - Advancing ice and erosion beyond the redrawn relief do not damage what
    grows on a region.
  - Embankments, drained marsh, breakwaters, canals, portages and way-stations
    have no catalogue entries.
- [ ] **20. Let different people own and refine different regions** of one world.

## Editor and storage

- [ ] **21. Provide cartography toolsets for different layers.** Supply tools for
      terrain, water networks, transport, settlements and structures, political
      boundaries, cultural distributions and magical geography: drawing,
      reshaping and field editing, with symbols, labels, colours, fills, line
      styles and presentation at each scale. Tools edit the shared world geography
      and keep feature identity. Interaction toolsets exist for terrain strokes and
      landforms, rivers and lakes, roads, settlements, buildings and interiors,
      political layers, cultural origins and distributions, magical source
      placement and typed custom surveys; presentation changes wait for the
      owner's direction.
- [ ] **22. Mark blocks used on sample reads.** The
      [block cache](../packages/domain/src/lattice/blockCache.ts) evicts by a clock
      whose used flag is set only when a block is pinned, so per-sample passes
      through `Band.get` and `Band.set` evict first-in, first-out. Set the flag on
      reads at a cost the resident path does not notice, and compare with
      `make test-perf`.
- [ ] **23. Send generated records to the catalog as one encoding.** Carry the
      stored form (value text plus WKB geometry bytes) across the worker port
      instead of a structured clone, and compare in-progress records, protection
      and identity against the source in that form.
- [ ] **24. Count features without a per-commit scan.** Catalog commits recount
      a world's features with a full count on every commit; maintain the count
      with the commit.
- [ ] **25. Store presentation attribute discovery.** The presentation catalog
      discovers feature attributes with a JSON scan per request; derive them once
      per record revision like the other stored products.

## Hosted workspace

- [ ] **26. Add a hosted workspace with agent operations.** Private persistent
      geography in PostgreSQL/PostGIS, numerical resources in S3, authenticated
      spatial and domain operations, MCP and agent operations over the same
      contracts, and long-running generation for an eventual paid deployment. - Requirements: separate domain logic from the browser implementation;
      preserve geographic identity, representation precedence, authored
      protection, scoped spaces, semantic profiles, completed history and
      map-only editing. The local browser product stays usable without an
      account, and nothing uploads automatically. - Owner decisions: hosted job lifetime and save semantics (how Save map and
      named versions appear in hosted mode), paid access and billing scope,
      authorization of any data upload or production cutover, and Fine
      generation. - Boundaries: build on the `SpatialStore` and `ResourceStore` ports with a
      PostGIS adapter that is its own query implementation, not a SQL
      translation of SQLite or a second copy of the authoring rules. Use scoped
      SQL, indexed predicates and bulk transactions, never per-cell RPC or whole
      `World` rebuilds. Keep binary formats and partition ids identical across
      OPFS and S3, with short-lived scoped resource access and a private bucket.
      Authorize at the service boundary: the shared load balancer validates the
      token issuer and signature, the service checks the token's purpose and
      this application's client id, and the token subject owns the data; no
      client-supplied tenant id grants access. - Generation runs as a job outside the HTTP functions, pinned to its inputs,
      recipe, seed and code versions, with one attempt, explicit retry from the
      pinned inputs, and cancellation that stops compute and blocks
      publication. Initial generation stays visibly incomplete while it
      publishes; regeneration switches references atomically. Moving a local
      map to hosted is an explicit export and import with stable identities. - Platform: use the shared Ahara load balancer, VPC, RDS, Cognito and state
      bucket, with no NAT gateway or remote-state reads, and reconcile the
      existing Ahara registrations for this project. - Starting material: `backend/`, `db/migrations` and
      `infrastructure/backend-prototype` are preserved for inspection, not
      reactivation. Derive a fresh reviewed schema from the browser domain;
      inspect the applied migration history before choosing a transition and
      never rewrite an applied migration.

The [product contract](product-spec.md) supplies the geographic and authoring
requirements. [ADR 0003](adr/0003-frontend-session.md) defines the execution and
session boundary, and the [generation design](generation-workflows.md) describes
the generation processes.
