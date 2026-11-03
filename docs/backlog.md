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

- [ ] **2. Decide what an ice-age round's bands become.** A mobile band in the
      round grows under the same support as a settled era, so many lasting camps
      reach the resident concentration of a present town and publish as World
      ruins by the [ADR 0005](adr/0005-scale-contract.md) rule. Decide whether a
      round produces towns at all, and whether its survivors seed the present
      instead of the settled eras starting again from founders.

- [ ] **3. Ocean-surrounded worlds.** The map-boundary setting reserves this
      choice. Add a physical ocean rim that survives tectonic, erosional and
      sea-level epochs, using the existing conditioning and authored-protection
      rules; a painted border or land clipped at the map edge is not an ocean
      boundary.

- [ ] **4. Let buried Salt beds shape the fold belt above them.** A thick Salt bed
      carried under a collision acts as a detachment, so the belt above it folds
      broad and low. Add that response to mountain building when a concrete
      requirement reaches into that module
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

## Magic

- [ ] **6. Hold sea ice with Aurora shelf charge.** Shelf charge already writes
      ice persistence on ocean cells; let sea ice read it as land ice does.
- [ ] **7. Drift stocks with ocean currents.** Move the stocks that declare a
      current carrier during the stock advance, alongside river, ice, animal and
      crust carriers.
- [ ] **8. Green river mouths.** Carry Greenwood litter with river sediment to
      floodplains and deltas.
- [ ] **9. Raise brine under clearance.** Let Salt stocks read soil water, so
      clearance that lifts the water table brings brine up.
- [ ] **10. Dry closed lagoons into Salt sources.** A closed warm lagoon behind a
      Pressure coast dries to a sabkha that becomes a Salt source, and storm
      tracks lift its dust.
- [ ] **11. Mark Veil wild zones as unreliable on the map,** publishing the
      previous epoch's feature positions beside the current ones.
- [ ] **12. Society practices for every system.** Add Greenwood tending (with a
      lumber taboo as a clearance cost), Hallowed vows, Veil door-keeping,
      Pressure sky-reading, temple cities, pilgrim economies, fortresses at doors,
      mirages and detour routes, each with a field behind it.
- [ ] **13. Author ward lines and paired doors.** Let an authored magic source be a
      line for a ward and two linked ends for a door.

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
- [ ] **19. Regional society.** Add embankments, drained marsh and breakwaters;
      hamlets, shrines and way-stations; canals, portage pairs, and fortress gorge
      dams sited by dam demand at narrows. Realize harbour and pass demands and site
      forges, dive sites and archives. Publish population per hinterland, give
      captured seats hierarchy roles and name villages in the owning community's
      language. Add the connection graph with sea links, let hazards penalize
      proposals, and read livelihood per cell. Decay the works of ruins, keep
      captured highways and roads as worn ground by class, publish land-use
      features, and merge trunk ways by their combined traffic.
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
