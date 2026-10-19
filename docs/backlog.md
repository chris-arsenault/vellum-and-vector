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

- [ ] **3. Design and implement substantial political and cultural generators.**
      Develop both domains beyond their initial implementations, with explicit
      geographic and historical causes and meaningful creator controls. Preserve
      overlapping cultural prevalence, languages, religions and communities.
      Distinguish political sovereignty, administration, claims, disputes and actual
      control. Keep cultures and polities independent, with stable identities and
      coherent regional refinement.

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

- [x] **7. Implement customizable magic.** Complete the magical generation and
      authoring workflow, including defining a world's magical systems, placing and
      shaping sources, and configuring their rules and interactions. Support the
      applicable propagation, storage, decay and epoch behavior, with causal effects
      on physical geography and visible explanations of those effects. Existing
      forcing processes do not by themselves complete this capability.

      Implemented automatic and placed sources, fracture transport, cold drainage
      and ice retention, ocean rays and wakes, heat/ice/rock/coastal feedback,
      advected history, configurable feature regions and cross-system interactions.
      Fire, Aurora and Pressure are editable examples of the same vocabulary.
      Variants, per-epoch activity, storage and source timing use that configuration.

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

- [ ] **9. Inject and preserve major landscape landmarks during epochs.** Provide
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
      through later evolution. Design the preservation and integration behavior as
      part of this future work.

      **Deferred: outside the current continuous-terrain and adaptive-generation
      replacement plan.**

The [product contract](product-spec.md) supplies the geographic and authoring
requirements. [ADR 0003](adr/0003-frontend-session.md) defines the current execution
and session boundary; the [generation design](generation-workflows.md) records
the existing physical port and its atlas adapters.
