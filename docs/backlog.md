# Product backlog

Requested 2026-10-18. UI and interaction work takes priority. The current product remains browser-only,
with no backend, persistence or MCP; preserve the existing backend source.

- [ ] **1. Use metric units inside the generation algorithms.** Express distances,
      elevations, areas and physical rates in declared world units inside the
      algorithms and their parameters. Replace lattice-unit assumptions and output
      adapters that compensate for them. Changing sampling resolution must not change
      the physical meaning of a parameter. Retain deterministic generation and its
      causal process sequence.

      Recommended next physical-generation work. The source inventory maps all
      55 physical contracts and 15 magic layers; it establishes concrete magic,
      execution and extraction differences, not complete application parity.
      Compare reference algorithms while converting their dimensions. Relief
      loss already occurs during generation. Domain coverage,
      feature geometry and cartographic display also need correction; unit
      conversion alone will not resolve them. See the recorded
      [generation and display findings](generation-workflows.md#generation-and-display-findings-2026-10-18).

      Execution is now scoped to **top-level world generation** in the
      [physical-dimensions plan](generation-workflows.md#world-generation-with-physical-dimensions--execution-plan),
      Sulion `c024ba6d-9344-47a2-b9ac-10a6c3faf42a`. Standard/Fine must change
      sampling rather than feature size. Regional generation remains later work;
      world outputs must retain physical dimensions, identities and topology for it.
      Top-level M0–M4 implementation is complete, including physical dimensions,
      reviewed algorithm corrections and continuous river geometry. Regional
      generation remains pending.

- [x] **2. Make the UI a workflow surface.** Organize the editor around creating a
      world, choosing geography, refining it, generating selected systems and
      authoring the result. Present tools and next actions in the context of the
      current creation profile, layer and selection. Forms and record inspectors
      support those workflows rather than defining the product's navigation.

- [x] **3. Design and implement substantial political and cultural generators.**
      Develop both domains beyond their initial implementations, with explicit
      geographic and historical causes and meaningful creator controls. Preserve
      overlapping cultural prevalence, languages, religions and communities.
      Distinguish political sovereignty, administration, claims, disputes and actual
      control. Keep cultures and polities independent, with stable identities and
      coherent regional refinement.

      Delivered as bounded aggregate society generation: population and migration,
      joint affiliations and diffusion, political reach/collapse/recovery, present
      authoring and inherited refinement.
      The subsequent population correction replaces whole-era single-pass updates
      with repeated environmental feedback and settlement establishment,
      abandonment and recovery. Local histories distinguish settlement residents
      from rural catchment populations; unoccupied catchments are not towns.
      Four-pillar integration followed; see
      [ADR 0004](adr/0004-coupling-through-each-systems-medium.md).

- [x] **4. Fix map interaction behavior.** Reported symptom: attempts to interact
      with the map pan it instead of performing the selected action. Make selection,
      drawing, feature manipulation and brushes work alongside navigation, with clear
      active-tool feedback and cancellation. Verify the actual pointer and keyboard
      workflows on the map, including editing existing geometry.

- [ ] **5. Provide cartography toolsets for different layers.** Supply tools suited
      to terrain, water networks, transport, settlements and structures, political
      boundaries, cultural distributions and magical geography. Include the relevant
      drawing, reshaping and field-editing operations, together with symbols, labels,
      colours, fills, line styles and presentation at different scales. Tools must
      edit the shared world geography and preserve feature identity.

      Interaction toolsets implemented: terrain strokes and landforms; rivers and
      lakes; roads; settlements, buildings and interiors; sovereignty,
      administration, claims and control; cultural origins and distributions;
      magical source placement and movement; typed custom surveys. Presentation
      changes are excluded by the user's current direction and remain untouched.

- [x] **6. Create regions directly on the map.** Let creators draw or select an
      extent, adjust its outline visually, choose its creation profile and see its
      parent context and inherited interfaces. Region creation must not require
      typing coordinates and dimensions into text boxes. Keep numeric entry available
      as an optional precision control.

- [ ] **7. Preserve the three authored magic systems.** Per the user's 2026-10-22
      clarification, treat Fire, Aurora and Pressure as first-class world effects
      and processes: physical motivations, media, propagation, feedback and
      interference. Adapt social uses without importing named setting lore.
      Retain source shaping and system-specific controls, and leave future magic
      systems open through shared process contracts. See [the product contract](product-spec.md#103-magical-generation--fire-aurora-and-pressure).

      Implemented automatic and placed sources, fracture transport, cold drainage
      and ice retention, ocean rays and wakes, heat/ice/rock/coastal feedback,
      advected history, configurable feature regions and cross-system interactions.
      Each system also has its own living and climatic medium
      ([ADR 0004](adr/0004-coupling-through-each-systems-medium.md)): Fire's
      quickening and conduit evolution, Aurora's stored charge,
      stillness and ice persistence, Pressure's climate-phase upwelling, sea
      surface, fog and wake warming. Those mechanisms use declarative
      definitions, per-epoch activity, storage and source timing. Society retains
      finite core extraction/use, crystal charge and reader access, depth-limited
      Pressure practice, and aggregate injuries/strain, and reads magic in its
      site choice. Item 10's magic/ecology gaps are closed by that plan.

- [x] **8. Expose meaningful generation parameters beyond detail level.** Provide
      understandable controls for the applicable physical, magical, cultural and
      political processes, including history and epoch settings. Show units, useful
      defaults and the expected effect of controls; offer presets and advanced
      settings where appropriate. Keep sampling/detail separate from the settings
      that determine the world's character, and retain the chosen configuration for
      reproducibility within the session.

      Implemented landscape presets, fifteen parameters including initial culture and
      polity counts, physical history presets and per-epoch controls, cultural
      spread history, magical source settings and retained session configurations.
      Further political and cultural controls belong with the generators in item 3.

- [x] **9. Inject and preserve major landscape landmarks during epochs.** Provide
      an optional generation process for deliberately introducing exceptional
      landscapes at chosen points within the epoch sequence: Niagara-scale falls,
      a Grand Canyon-scale gorge, a Matterhorn-like peak, and other epic locations.
      Let creators guarantee these landmarks' presence, location and defining
      physical characteristics. Preserve those characteristics through subsequent
      epochs while integrating the surrounding procedural terrain, geology,
      drainage and magical effects into coherent geography.

      Keep naturally emerging landforms and their existing generation and feature
      detection routes available alongside deliberate injection. Injected landmarks
      participate in the shared causal generation system and remain identifiable
      through later evolution.

      Delivered 2026-10-25 ([ADR 0006](adr/0006-landmarks-are-injected-causes.md)):
      a landmark catalogue (two great mountains, great canyon, two great ring
      structures, great escarpment, great falls), placement tools and panel, local
      saves and wizard listing; emplacement and maintenance processes in the
      physical epochs with the maintenance booked; river capture; one registry
      row per landmark with target and measured signature; the great falls held
      cell to cell at World and left to regional refinement to realize. The
      remaining Region-scale realization is carried by the terrain and rivers
      subplan of the regional refinement plan. Observed cost: a 4,500 m volcanic
      cone pays roughly a fifth of its relief per epoch to isostatic subsidence;
      the other kinds hold with corrections only where sea level or deposition
      moves their reference bands.

- [x] **10. Rework the interaction between magic and ecology.** Delivered
      2026-10-24 ([ADR 0004](adr/0004-coupling-through-each-systems-medium.md)):
      each system acts through its own medium (quickening, stillness, fog) and
      names its own biomes; the generic altered group, cover and biome names are
      removed. Original statement kept below. Magic reaches
      vegetation only through generic ecological effects, so the three systems'
      own rules barely shape the living landscape. Fire heats land to 46–60 °C
      and its fire effect holds grass along its veins; Aurora and Pressure have
      no ecological effect at all. Ecology itself shows gaps the named biomes
      exposed (2026-10-23 Draft world): fire activity and flood frequency are
      zero everywhere, conifer cover is essentially absent, and 58–62% of land
      carries under 12% plant cover. Define how each system's physical rules
      change vegetation, and make the ecological disturbance regimes produce
      results that biome naming can use.

      Remove "altered" as an ecological descriptor. It is too generic: the
      altered plant group, altered cover, and biome names such as
      "Wildwood-altered woodland" say that magic changed something without
      saying what. Replace it with effects and names that follow the
      responsible system's rules.

      **Sequencing correction, 2026-10-23:** complete the society generation
      plan through M4, including E1's society/environmental feedback, before
      this item. Address it in the
      separately designed society–magic–physical–geology discussion, alongside
      the other cross-system gaps. The latest user correction explicitly excludes
      this work from society delivery. B1 was stopped before runtime changes;
      its goals and design require separate agreement.

- [ ] **11. Decide what an ice-age round's bands become.** On the default draft
      World most lasting camps of the round reach the concentrated-resident
      threshold that makes a present town a World feature, because a mobile
      band grows under the same support and growth as a settled era. Under
      [ADR 0005](adr/0005-scale-contract.md) those camps publish as World ruins
      by the same rule as present towns, which is consistent; whether a round
      should produce towns at all is a design question for the round, not for
      the publication rule. The round's people are discarded when it ends; the
      settled eras start again from founders. With the adaptive cycle and the
      three default settled eras the land fills without them, so whether the
      round's survivors should seed the present remains open on its own merits
      (2026-10-25).

- [ ] **12. Reach seven magic systems.** [Magic system candidates](magic-system-candidates.md)
      consolidates ten candidates into four new systems (Greenwood, Salt, Veil,
      Hallowed) and two extensions of current ones (Fire gains fallen cores from
      impact craters, Pressure gains sea-born weather). Sources gain origin,
      renewal and shape attributes so one system can hold two origins with their
      own propagation. The [magic lore bible](lore/magic.md) carries each
      system's setting-neutral character, practice and cost. Society-sourced
      systems need a magic phase after a human era; Veil doors need nonlocal
      routing edges. Decide those two prerequisites before implementing any of
      the four. The [seven magic systems plan](MAGIC-SYSTEMS-PLAN.md) reviews
      the bible against the implementation and sequences the work (2026-10-24).

- [ ] **13. Keep a child's epochs from moving its parent's cell means.** A Region
      over a mountain belt ends its epochs with its land about 150 m away, on
      average per parent cell, from the World surface it inherited (worst cells
      above 350 m), with or without realized relief. Incision, hillslopes and
      Cold-age glacial erosion at the child's mesh do this. Under
      [ADR 0005](adr/0005-scale-contract.md) the parent is authoritative at its
      mesh; decide whether child epochs should conserve parent-cell means, or
      whether the World should carry the erosion its children will do.

- [ ] **14. Generalize Region relief features for the map.** Realized relief gives
      a 300 km belt Region on the order of a thousand peaks and two thousand
      cirque cells, plus lakes where the texture closes depressions. The
      classification is right at cell scale; what the map shows at a zoom is a
      cartographic generalization question
      ([ADR 0005](adr/0005-scale-contract.md)).

- [ ] **15. Ocean-surrounded worlds.** The map-boundary setting reserves this
      choice but leaves it unavailable. Add a physical ocean rim that survives
      tectonic, erosional and sea-level epochs, using the existing conditioning
      and authored-protection rules. A painted border or clipping land at the
      map edge does not establish an ocean boundary.

The [product contract](product-spec.md) supplies the geographic and authoring
requirements. [ADR 0003](adr/0003-frontend-session.md) defines the current execution
and session boundary; the [generation design](generation-workflows.md) records
the existing physical port and its atlas adapters.
