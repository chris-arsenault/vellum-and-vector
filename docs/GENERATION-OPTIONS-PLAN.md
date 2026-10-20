# Generation options and dependency-aware wizard

Execution authorized for all milestones on 2026-10-20. Initial generation is the
priority, with a smaller regional follow-on. Local implementation and validation
are in scope; publication and deployment are not requested.

## Outcome and requirements

A creator can discover the available generation processes, understand what each
changes and requires, turn applicable processes on or off, configure their
parameters, and review the actual request before generating a new world. The
primary journey is new world setup through its first complete generated map.
Subsequent generation of a new region reuses these foundations with inherited
context and a smaller, appropriate set of options.

Initial generation determines the architecture, implementation order and bulk
of acceptance checks. Redesigning regeneration, replacement of existing map
content, selective cleanup and historical configuration restoration is deferred.
Preserve existing protections and behavior without making those redesigns a
prerequisite for the new-world wizard.

Sources of requirements:

- The current request calls for a wizard, common process interfaces, a parameter
  configuration language, consolidation, and particular attention to dependencies.
- The follow-up prioritizes initial generation, gives regional generation
  secondary attention, and rejects centering the plan on existing maps.
- [Product specification](product-spec.md), sections 10–13: independently selected
  domains, applicable creation profiles, causal history, protected edits,
  inherited boundaries, reproducibility, progress and useful diagnostics.
- [AGENTS.md](../AGENTS.md) and [ADR 0003](adr/0003-frontend-session.md): browser
  memory, a Web Worker, shared domain operations and atomic publication. There is
  no backend, persistence, restart or recovery work in this proposal.
- [Generation workflows](generation-workflows.md), the common contract and fixed
  sampling direction: preserve semantic operations and configured epoch order.
  Detail controls sampling; it does not silently remove physical mechanisms.

The existing [macro finishing proposal](FEATURE-FINALIZATION-PLAN.md) owns new
landscape shaping algorithms. This proposal accommodates those processes when
implemented; it does not implement or supersede that work. Cartography changes
also remain separate. Process selection changes generated geography; layer
visibility changes its display.

## Findings from the current sources

These are source-review findings, not results from running generation or the UI.
The source bodies reviewed include the files below, relevant product/workflow
sections, ADR 0003, and Canonry's local pipeline and evolution-session classes.
The long workflow document includes superseded plans; its entire historical body
was not revalidated.

| Existing boundary                                                         | What exists and what needs consolidation                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/generation/src/process.ts`                                      | `MapProcess` already provides identity/version, parameter definitions, required/produced/invalidated facts, apply and validate. Configuration already represents ordered invocations, conditions and nested epoch loops. Extend this boundary.                                                                        |
| `mapRunner.ts`, `sequence.ts`, `configurationSchema.ts`                   | The runner resolves parameters, checks facts during execution, updates validity, records history and validates geography. Its constructor resolves process identities, but does not preflight the complete dependency sequence or effective parameters. The configuration schema validates structure.                 |
| `atlasWorkflow.ts`, `canonry/atlasSequence.ts`                            | The active app constructs its sequence from five domain names. There is no input for individual process selection. Initialization, repeated refreshes, history, extraction and projection are composed in TypeScript.                                                                                                 |
| `atlasParameters.ts`, `canonry/atlasProfile.ts`, `canonry/profile.ts`     | Seventeen creator parameters include vegetation productivity and grazing. Physical settings enter through workspace/profile construction; ecological settings also enter through captured request inputs. Native contracts principally expose adapter flags. A process-contract form alone would miss these controls. |
| `packages/domain/src/schemas.ts`, `parameters.ts`                         | Shared parameter definitions already support types, units, defaults, bounds, enums, records, lists and explicit merge behavior. Labels, explanations and form grouping are absent. Use this existing validation machinery.                                                                                            |
| `frontend/src/GenerationControls.tsx`, `DevelopmentPanel.tsx`             | Controls, limits, presets, submission conversion and last-run labels repeat information held elsewhere. All seventeen parameter controls appear together, independent of the selected domains or profile.                                                                                                             |
| `App.tsx`, `RefinementPanel.tsx`                                          | World creation precedes generation in a separate screen. Procedural refinement starts with standard quality and the world seed, without presenting the full generation controls.                                                                                                                                      |
| `PhysicalHistoryForm.tsx`, `HumanEraForm.tsx`, `MagicSystemsForm.tsx`     | History and magic have richer, separate configuration editors and presets. Their settings affect execution but are not one generation draft. Completed-history restrictions already exist and must remain.                                                                                                            |
| `packages/domain/src/ecology.ts`, `frontend/src/EcologyEpochFields.tsx`   | Six ecological epoch settings have an existing Zod schema and editor: rainfall, seasonality, productivity, fire, migration and recovery. An ecological-history preset already exists. Reuse these in the initial-generation draft.                                                                                    |
| `canonry/ecologyProcesses.ts`, `ecologyVegetation.ts`, `ecologyCarbon.ts` | Ecology already initializes, evolves, responds, buries organic material and refreshes the present. Each adapter declares only workspace input and a broad ecology output, despite more specific physical and temporal dependencies.                                                                                   |
| `frontend/src/generationJobs.ts`, `generation.worker.ts`                  | Jobs carry `AtlasGenerationInput`; the worker reconstructs configuration. The new-world review and worker need to agree on effective settings and process selections. Existing run-record restoration is secondary.                                                                                                   |
| `mapFeatures.ts`, `generationJobs.ts`                                     | Coverage must accurately describe the outputs produced by the first run. Existing domain-level removal is a constraint on later regeneration work, not a reason to build selective replacement machinery for initial generation.                                                                                      |

### Review against current code — `75690ab`

The architecture remains appropriate, but the original inventory missed the
ecology integration added in `64774d6`. This review retains the milestones and
initial-world priority, with the following changes:

- **Ecology is part of the existing generator.** `atlasSequence.ts` initializes
  ecology, evolves it before incision, responds after glacial reconciliation,
  buries organic material after coastal work and refreshes present-day biomes
  before magic classification/publication. It is currently embedded in physical
  generation, not a sixth generation domain. Include its real controls and
  outputs without implementing another ecology model or adding a domain merely
  for UI grouping. [ECOLOGY-PLAN.md](ECOLOGY-PLAN.md) owns that model's direction.
- **Dependencies include feedback and elapsed time.** Ecology changes runoff,
  evapotranspiration, root resistance and hillslope response; later physical
  operations disturb ecology. Both biological responses consume half the epoch
  duration; burial advances a separate carbon model; present reconciliation does
  not replay biological age. Preserve those roles when selecting processes.
- **Final validation assumes all physical mechanisms ran.** The generated
  `physical-structural-validation` contract requires facts including `Impacts`,
  `VolcanicConstruction` and `GlacialEvolution`. Filtering an optional producer
  out of the sequence would fail even when its mechanism can plausibly be absent.
  M2 must reconcile absence semantics with validation, not just remove invocations.
- **The effective request is incomplete today.** `nativeContext` reads complete
  world epochs, ecological adapters read `world.epochs` and captured input, and
  human processes read world eras. The generated sequence binds only temperature,
  sea level and tectonic activity as epoch variables. The configuration hash does
  not directly include all those source settings. Resolve the full typed input
  snapshot once, and include it in review, execution and run identity.
- **Seed provenance needs an explicit decision in code.** Ecological founders
  initialize from `state.domain.world.seed`, while biological response randomness
  uses `input.seed`. M1 should make the new-world wizard's chosen seed authoritative
  across its initial run, rather than retain an incidental split. The current
  discrepancy is established by source review; its geographic effect with
  different world/request seeds was not separately reproduced here.
- **Reuse schema and UI work already present.** Keep the existing ecology and
  magic Zod schemas and specialized editors. Add parameter presentation metadata
  and common draft bindings without duplicating these models into a second
  generic parameter schema. Recent layer-discovery changes are presentation
  work; this refactor does not need another layer-browser redesign.

Focused current-code checks passed: 38 tests in the three `canonry/ecology*`
unit/integration files plus frontend generation-control, physical-history and
generation-job tests. This establishes useful reusable behavior, not the new
wizard or arbitrary process omission. No full-world generation, browser suite,
build or deployment was run for this review.

### Dependency gaps that matter before toggles

1. **The same process has several causal invocations.** Climate and drainage run
   before and after terrain-changing operations. Lake reconciliation changes ice
   support; ice is refreshed again before classification. Canonry's
   `PhysicalGeographyEvolutionSession.cs` explicitly preserves this order. A graph
   with one node per process, topologically sorted once, loses that behavior.
2. **Validity has two representations.** Native algorithms check
   `PhysicalField.AvailableFacts`; the outer runner checks `GenerationState.facts`
   with prefixed native facts. Native adapters mirror changes, but additional
   initialization, magic and refinement steps must describe their effects too.
3. **A fresh world must establish its prerequisites.** With no inherited map,
   enabled processes must receive inputs from initialization or earlier selected
   work. Missing prerequisites must not be satisfied by claiming absent fields
   exist. The separate inherited-availability issue belongs to regional follow-on
   work, described below.
4. **Magic and ecology dependencies are underdeclared.** `canonry/magicProcesses.ts` declares
   only the physical workspace, with no produced or invalidated facts. Its
   implementations read and modify temperature, ice, rock resistance and coastal
   forcing. The local-effect adapters and configurable-system adapters also take
   different paths through sequence construction. `ecologyProcesses.ts` declares
   only workspace input and a broad ecology output; its actual climate, water,
   soil, disturbance and magical inputs and physical feedback also need coverage.
5. **Applicability is implicit.** `built.layout` has no declared prerequisites,
   while its landscape branch uses elevation and its interior branch lays out
   rooms. Cultural/political suitability optionally consumes climate with
   defaults. Hard requirements, optional enhancements and profile-specific inputs
   need different explanations.
6. **Zero strength and disabled execution are different.** A zero multiplier may
   still initialize arrays, classify terrain or retain history. Removing that
   invocation may leave another process without its input. Each selectable
   operation needs defined disabled behavior.
7. **Some settings bypass resolved process parameters.** Physical profile and
   epoch inputs are also read from workspace state and `world.epochs`. The
   review must describe those effective inputs, rather than showing one parameter
   path while execution consumes another.

## Recommended design

Keep the existing ordered runner. Add a complete process catalogue, one typed
configuration model and an ordered preflight analysis shared by the wizard and
execution. Use JSON as the configuration language, validated with the existing
Zod and parameter tools. A new textual grammar, expression interpreter or general
workflow engine is unnecessary for the requested choices.

The flow is:

```text
New-world draft + preset + process and history choices
                    |
          shared configuration resolution
                    |
  effective ordered invocations + parameter origins + diagnostics
                    |
            review / worker / first generated map
```

### One catalogue, with separate execution and presentation concerns

Extend the current process definitions rather than creating a competing registry.
The catalogue must be inspectable without constructing a numerical workspace or
running algorithms. Runtime factories can still bind seeds and scoped inputs.

Each registered definition should describe:

- Stable process identity/version and its existing apply/validate implementation.
- Supported profiles and contexts, applicable phases, and whether the process is
  a creator choice or required setup/refresh/validation/publication work.
- Typed parameters and defaults, with labels, help, units, grouping, input step
  and ordinary/advanced visibility. Validation constraints have one owner;
  presentation metadata references those definitions rather than copying limits.
- Required, produced and invalidated facts, including profile/parameter-specific
  variants where needed; optional inputs and their actual fallback behavior.
- Output descriptions sufficient to explain what a fresh run generates and to
  publish truthful field/layer coverage.
- Temporal role where relevant: initialization, an elapsed-time response,
  retained material evolution, present reconciliation or extraction. Record the
  existing phase and duration binding; no new time scheduler is needed.
- Disabled behavior, including any necessary neutral initialization. A neutral
  provider is an explicit operation with real output semantics, never a fake
  assertion that an omitted process produced valid facts.

Keep React control components in the frontend. Domain parameter validation does
not need to depend on React. Prefer small typed TypeScript conditions over a new
declarative rule language. Do not build a generic read/write permission framework
or model every numerical helper as a separate selectable process.

Named generation groups make the catalogue usable: geological construction,
volcanism, impacts, climate, water, river erosion, glaciers, coastal evolution,
ecology, magic, cultures, politics and built layout. Groups reference real invocations;
they do not introduce a second execution contract. Advanced inspection exposes
individual registered processes and where they occur. Required steps have a
reason instead of a switch that cannot work.

Grouping follows actual behavior. Ecology's two elapsed-time responses are one
coherent evolution choice at their required causal positions; its initialization,
present classification and carbon consequences have explicit dependencies.
Advanced process inspection still shows the individual stages. Allow an individual
stage to be disabled only when a valid resulting temporal and dependency contract
is defined. Subprocess controls such as fire and migration already have parameters;
do not turn every helper into a new registered process to expose them.

Inventory all current configurable inputs. Show useful creator parameters in
the normal flow and supported specialist settings under Advanced. Document
implementation constants as such; do not expose unvalidated numerical internals
as if every value were a supported creator option.

### One effective configuration

Separate the editable selection from the resolved invocation sequence, while
keeping both typed parts of the same configuration boundary:

- A schema version; profile, scope, seed and detail; selected domains and
  process/group settings; complete typed physical/ecological epochs, magic and
  human-history inputs.
- Defaults and preset expansion owned by the catalogue/profile definitions.
- Explicit process enable/disable overrides and process-owned parameters.
- An effective sequence using the existing `ProcessConfiguration` representation,
  with resolved parameter origins and inclusion reasons for review.

Preserve the current runner's precedence for ordinary process parameters:
definition defaults, configuration values, bound epoch values, then invocation
overrides. Adapt physical-profile settings into this model explicitly. Baseline
temperature plus an epoch climate offset is a physical composition rule, not
ordinary last-value-wins overriding; label it accordingly.

Ecological productivity multiplies the creator's vegetation control by the epoch
productivity setting. Ecological rainfall scales the computed physical
precipitation; the global rainfall parameter adjusts selected profile terms.
These are distinct composition rules, not interchangeable overrides. Explain
their scope in the form and effective values in review.

Keep the seventeen existing creator parameter names: source review found no
collisions, and the profile adapter deliberately maps these controls to native
physical parameters. Process switches use stable qualified process identities;
history, ecology and magic retain their existing nested schemas. Do not add a
second parameter namespace or interpreter without a concrete collision. Complete
magic definitions now travel as structured settings; the older serialized
`magicConfiguration` parameter remains for existing configuration consumers.

Reuse `ecologyEpochSchema`, `magicSystemSchema` and existing domain validation as
the owners of their nested settings. A common catalogue can reference typed
parameter groups and their editors without re-encoding every magic rule or
ecological record into `ParameterDefinition`. Keep the existing generic scalar
resolver where it fits, and retain specialized validation where it is already
correct. The required standardization is one authoritative definition and one
resolved request, not one universal form or parameter interpreter.

Start a new-world draft from catalogue/profile defaults and the selected preset.
Make preset changes, explicit overrides and effective values understandable.
Preserve explicit values such as zero, false and empty supported collections.
Region generation later adds parent-derived starting values and fixed inherited
constraints; it does not determine the new-world configuration model.

The worker validates and executes the same effective request shown in review.
It must not independently rebuild a different default sequence. All world-level
settings consumed by adapters must come from that resolved input snapshot, and
participate in its identity. Preserve both biological half-epoch responses and
the separate burial duration without aging the world during final refresh.
Retain the
effective configuration in the completed session record so the creator can
inspect what made the new world. These inputs remain in memory; this does not
require a configuration restoration or replay subsystem.
Strictly reject unknown option names and unsupported configuration versions;
session-only scope does not require a historical migration subsystem.

Local JSON editing can be a secondary advanced view of this configuration, with
path-specific errors and no execution on parse. The wizard remains the primary
authoring flow. Arbitrary user scripts and arbitrary process reordering are not
needed; ordinary TypeScript continues to own reusable sequence composition.

### Validate dependencies in execution order

Resolve selections against the existing causal sequence, then walk the same
expanded stages as the runner, without executing generation algorithms:

1. Validate configuration shape, identities, versions, applicability and effective
   parameters. Bind concrete epoch variables and evaluate existing conditions.
2. Start with the actual new-world inputs and facts established by initialization.
   Validate parameter units and process compatibility. Every additional required
   fact must be produced at the correct position in the selected sequence.
3. Track available facts and their provider at each invocation. Apply epoch
   resets, required-fact checks, invalidations and productions in runner order.
4. Report every actionable missing or stale prerequisite with the affected
   invocation, phase/epoch, fact, prior provider or invalidator and repair options.
5. Keep runtime parameter, fact, output and geographic validation. Preflight
   establishes declared compatibility; it cannot prove generated geography valid.

Use the native fact definitions as the authority for native state and derive
outer-runner views from them. Give atlas-only steps honest fact effects. Avoid
two independently maintained dependency catalogues. Cross-epoch feedback is
explicit carried state through the existing loop; an unsatisfied dependency
within an invocation is an error, not an invitation to iterate to convergence.

Retain reference order and repeated reconciliation blocks. Do not automatically
find arbitrary providers, topologically sort process types or insert new physics
passes. Profile composition supplies the valid causal positions and documented
dependency groups. Include required support work with an explanation. If a
creator explicitly disables a prerequisite, keep that choice visible and show
how to restore it or disable affected dependent choices. Do not silently turn it
back on. These are ordinary option corrections, not a new approval workflow.

Representative dependency behavior:

| Choice                                        | Expected explanation or result                                                                                                                                                                                                         |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Include cultures in a new world               | Generate them after their required terrain inputs. Explain optional climate inputs and any fallback. Politics remains independently selectable.                                                                                        |
| Disable river erosion but keep rivers         | Separate the terrain-cutting operation from drainage and present river extraction. Keep whichever support steps the selected outputs require.                                                                                          |
| Disable glaciers                              | Remove the selected glacial behavior and handle dependent ice, meltwater and classification inputs explicitly. Decide neutral-state requirements from the implementation, not by claiming zero arrays are automatically fresh facts.   |
| Enable an ocean-dependent magic system        | Show its ocean/bathymetry inputs and causal phase within initial world generation. Explain whether an ocean is absent rather than fabricate a source.                                                                                  |
| Disable all magic                             | Generate the first world without the requested magical effects; required empty buffers may still initialize.                                                                                                                           |
| Configure ecological history                  | Use the existing wet/dry/cold/recovery regime controls. Preserve half-epoch biology before incision and after glacial reconciliation, then downstream carbon burial and present classification.                                        |
| Disable ecological evolution                  | Define the resulting initialized/neutral state and dependent outputs explicitly. Update runoff/erosion input semantics accordingly; do not leave another present-stage adapter silently evolving or initializing the omitted behavior. |
| Disable a prerequisite for a selected process | Identify the dependent choice before generation starts and offer a valid correction. Do not rely on existing terrain to conceal the missing producer.                                                                                  |

### First-run execution and outputs

Turning a process off must omit its behavior from the new world's construction,
while retaining any explicitly required neutral initialization. Distinguish
omission from a zero-strength execution that still produces or classifies data.
Validate representative combinations against actual geographic outputs.

Retain structural validation for water, networks, material state and spatial
publication. Distinguish those invariants from an assumption that each optional
mechanism must have run. Use explicit absence/neutral semantics or a selected
profile's validation adapter as justified by the actual outputs. Do not mark an
omitted process's fact fresh just to satisfy the full reference contract, or
weaken physical invariants to make a switch pass. Keep generated reference
contracts as reference data; atlas adaptations belong in the atlas boundary.

Publish only the fields, features and coverage actually produced. A selected
domain alone must not label every possible output as generated. Preserve the
existing atomic publication, cancellation and concurrent-edit checks. Initial
generation needs no selective replacement or cleanup of an older map.

### Wizard behavior

Use one controlled in-memory draft across steps. Back/Next navigation preserves
values. Cancelling the wizard discards the draft without applying its settings.
Reuse existing history and magic field editors as draft editors; they should not
save world settings merely because a wizard step changed.

| Step                        | Creator sees and controls                                                                                                                                                                                                           |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. World and starting point | World name, dimensions, seed, detail and a named generation preset with its concrete changes. Preserve the option to create manually.                                                                                               |
| 2. Generation processes     | Grouped on/off choices, concise effects and outputs, availability and dependency reasons. Expand to inspect individual processes, required support work and causal positions.                                                       |
| 3. Parameters               | Controls for the applicable selections, with defaults, units, bounds, help and value origins. Advanced settings remain discoverable. Keep inactive choices available for inspection without pretending they affect this run.        |
| 4. History and magic        | Physical epochs with their ecological regimes, human eras and per-system magic settings in the same draft. Reuse the ecological-cycle preset and expose magical effects on living cover, fire, preservation and altered vegetation. |
| 5. Review and generate      | Selected and required work in causal order, effective settings and expected outputs, with dependency errors linked to their controls. Show cost categories only where evidence supports them.                                       |

Review expands repeated work by epoch; it does not flatten the history to one
instance of each process. Generation progress uses the same labels and invocation
identity. Errors preserve structured diagnostics across the worker boundary rather
than reducing every problem to an unlocated string.

Make this the primary new-world creation flow: configure first, then generate
the first map. The draft should include history and magic before initial
generation, without requiring a creator to find and save separate editor forms.
Reuse the existing UI components and keep manual creation available.

`createWorld` currently installs default epochs, eras and magic systems before
the generation form is shown. Adapt that existing creation boundary to accept
the validated draft before the first worker request. Do not create defaults,
start generation and then apply the user's history afterward. This needs no
new transaction service or provisional-world storage model.

### Regional generation after the first world

After the initial flow works, adapt the same catalogue and draft controls to
generating a newly selected region. Retain boundary drawing, then show its
profile, inherited geographic constraints and applicable local process choices.
Do not ask the creator to choose continents or rewrite world history again.

Inspect inherited inputs before advertising prerequisites as satisfied. The
current `canonry/atlasWorkspace.ts` import marks all native produced facts
available except `Validated`; narrow that declaration to what was actually
supplied or established where the regional path needs it. Preserve existing
locked crossings, parent history and authored protections. One representative
new-region journey establishes this adaptation; no child-generator redesign,
cave/interior expansion or regional simulation rewrite is part of this plan.

Existing-map regeneration stays on its current path. New process switches are
introduced through initial world and new-region generation; do not route them
into replacement of existing generated content until that behavior is separately
designed. Reworking cleanup, stale-output reconciliation, output ownership for
selective replacement and last-run restoration is deferred. Existing correctness
controls remain in place.

## Decisions, assumptions and scope limits

The catalogue extension, JSON representation, grouped controls, ordered preflight,
wizard step layout are recommendations derived from
this investigation. They are not additional user requirements. Refine them when
a simpler complete implementation satisfies the outcome.

Provisional assumptions to resolve in M0–M2:

- Existing process boundaries can support useful individual switches. Read each
  implementation before classifying it as optional; split a combined adapter only
  when distinct requested choices need different prerequisites or outputs.
- The first-run path can use existing publication metadata without introducing
  output ownership for selective replacement. Check actual first-run coverage.
- Static fact analysis is sufficient for useful initial configuration preflight.
  State-dependent conditions still require runtime validation; inherited-input
  inspection is a bounded follow-on for new regions.

There is no blocking user decision for this proposal. The exact ordinary/advanced
parameter grouping and wizard wording remain product-review choices for M3,
informed by the completed catalogue and a working flow. The recommended initial
scope supports individual process switches within valid profiles and phase order;
it does not include a visual node editor or unrestricted sequence rearrangement.
Those would be separately scoped authoring capabilities if requested.

## Milestones and Sulion mapping

Root plan: `1a01bbef-e1b7-4e26-ae34-06695732772f`.
All milestones were authorized on 2026-10-20. Execution expansions and outcomes
appear below.

### M0 — Complete the process catalogue

Inventory processes used in initial world generation, their actual reads/writes,
parameters, phase occurrences, outputs, temporal roles and disabled behavior. Include
the five ecology adapters and physical consumers of ecological state. Record regional
applicability without expanding into all child profiles. Distinguish active atlas
adapters from legacy exported/test processes. Make the catalogue inspectable and
unify parameter definitions/presentation references. Trace generated Canonry
contracts to their fixture source before changing them.

Acceptance: every active invocation is explainable through the catalogue; native
profile inputs and world-level history/magic inputs have explicit owners. Every
proposed switch is classified as optional, dependent, or required with a concrete
reason. Existing defaults and causal behavior remain intact.

Evidence: source inventory and focused catalogue/parameter behavior checks.
Use river erosion, ecology's paired responses, magic feedback and world settlement as
representative dependency cases; do not create tests that only restate metadata.

Primary boundaries: `process.ts`, `atlasParameters.ts`, `canonry/atlasProcesses.ts`,
`atlasProfile.ts`, `magicProcesses.ts`, `ecologyProcesses.ts`, domain ecological
and magic schemas, shared parameter definitions and relevant
process adapters. Sulion phase: `39ec7016-6639-41d1-8c7e-c4e7b17dc89f`.

### M1 — Resolve and validate configuration [depends on M0]

Resolve new-world presets, typed options and history into the actual ordered
configuration. Share stage expansion and parameter semantics with execution.
Repair missing fact declarations needed by initial-generation preflight.
Provide structured missing/stale input diagnostics with causal explanations.
Bind the complete ecological/physical epochs and human/magic inputs, including
their settings outside invocation parameters, to one resolved request. Normalize
initial-run seed use across ecological founders and subsequent responses.

Acceptance: invalid selections are explained before a worker starts. A fresh
world's enabled sequence establishes every required fact in causal order. Epoch
resets, repeated invocations, explicit false/zero, conditions and parameter origins
behave correctly. An unchanged default request resolves to the existing semantic
sequence. Changing an ecological epoch setting changes the effective request's
identity even when temperature, sea level and tectonic strength stay the same.

Evidence: focused cases for a disabled producer, invalidated drainage, changing
epoch context, optional climate, first-run initialization and parameter conflicts.
Include global/epoch rainfall and productivity composition, complete-input run
identity and a chosen generation seed different from the draft's starting seed.
Preflight acceptance is explicitly not evidence of geographic correctness.

Primary boundaries: `configurationSchema.ts`, `sequence.ts`, `mapRunner.ts`,
`atlasWorkflow.ts`, `canonry/atlasSequence.ts` and catalogue
adapters. Sulion phase: `fae98512-ba4d-4911-b17e-940d42b6ff77`.

### M2 — Make process selection safe [depends on M1]

Execute the reviewed effective configuration on a new world. Implement real
omission/neutral semantics and accurate first-run coverage. Retain effective run
inputs in memory and carry structured diagnostics through workers.
Handle final validation's existing full-pipeline fact requirements explicitly
for disabled optional mechanisms. Preserve coupled ecological responses, required
physical refreshes and downstream organic history when their processes are enabled.
Preserve stable semantic invocation identity and random streams where applicable;
removing a stage must not accidentally renumber unrelated random streams.

Acceptance: individual optional processes can be disabled without dishonest facts
or accidental execution of their behavior. Enabled processes produce coherent
geography through the configured epochs. Cancellation and publication remain
correct. Review, worker and resulting-world inspection agree.

Evidence: fresh worlds with impacts/erosion/glacier/magic choices and independent
cultural/political selections. Check disabled and neutral paths geographically,
plus ecology enabled/disabled and a complete default multi-epoch world. Reuse
existing ecology tests for time, feedback and publication; extend them for
selection behavior rather than reimplementing their algorithms or duplicating
their coverage. Reuse existing publication checks.
Retain determinism within the atlas; exact Canonry numbers/hashes are not targets.

Primary boundaries: `atlasWorkflow.ts`, process adapters, first-run publication,
`frontend/src/generationJobs.ts`, `generation.worker.ts`, and the domain run record.
Sulion phase: `779d6d5a-018a-4e9c-98ad-159e9bc7efad`.

### M3 — Deliver the shared generation wizard [depends on M1, M2]

Implement the new-world draft and steps above from creation through its first
generated map. Reuse existing history, ecological regime and magic controls with draft state.
Generate controls from the catalogue and show dependency explanations at the
choice that caused them. Keep keyboard navigation, labels and focus usable.

Acceptance: creators can find options, disable a process, resolve a dependency,
configure applicable parameters/history, review and generate. Back navigation
retains input, cancel does not apply draft settings, and manual creation remains
available. History and magic can be configured before the first generation
without separately saving settings in an existing map editor.

Evidence: focused browser journeys for first generation, a blocked dependency,
independent culture/politics and custom physical/ecological epochs and magic;
inspect the actual worker
request and resulting first map. Keep browser fixtures small where possible.

Primary boundaries: `App.tsx`, `DevelopmentPanel.tsx`, `GenerationControls.tsx`,
history/magic form components, `EcologyEpochFields.tsx`, the `createWorld`
boundary, generation hooks and styles.
Sulion phase: `fd99c067-e887-4602-9489-a50d5f4705c4`.

### M4 — Consolidate and verify behavior [depends on M3]

Remove superseded parameter lists, preset copies and alternate request-building
paths after the shared flow replaces them. Retain useful independent magic/history
editing through shared components. Reconcile maintained usage/generation docs;
preserve historical backend source and reference schedules needed by tests.

Then adapt new-region generation as described above, reusing the initial flow
with applicable process choices and inherited constraints. Keep this smaller
than the initial-generation work; it does not depend on redesigning regeneration.

Acceptance: adding a supported process or creator parameter requires its definition
and implementation, without another hardcoded frontend parameter list. Default
multi-epoch generation retains the required physical and magical operations.
Ecological controls and existing succession/feedback behavior survive consolidation.
Review descriptions match first-run outputs. A creator can generate a new region
with appropriate options while preserving its inherited boundaries and history.
Existing-map regeneration and manual editing retain their current behavior.

Evidence: focused domain/generation and browser checks, typecheck/lint/build and
the repository's required checks at implementation time. Include a representative
complete world and a child run to catch integration failures. Measure meaningful
preflight/wizard overhead if observed; add no runtime caps or hard performance
budgets. No separate verification or handoff report files.

Sulion phase: `a8d9ac7e-9a8a-4630-8d76-b959f7bdaef0`.

## Execution expansions

### M0 execution

Expansion `cf3fd6b1-b4fb-4973-a375-95d194eab005`.

1. Catalogue and parameter ownership (`6b5f29b5-68a4-4ae3-8d5c-c474179ee836`):
   add inspectable descriptors for every registered atlas/native process and
   creator parameter. Reuse generated native contracts and existing domain
   schemas; identify required steps, optional effects and ecological time roles.
   Wire parameter metadata into the existing controls so it has a real consumer.
2. Contract verification (`d790694d-f78d-4713-92e0-26f656517dcf`): check the
   catalogue against real sequences and registry contracts, exercise bounds,
   and retain existing parameter and ecological behavior. Complete both after
   shared typecheck and focused tests.

M0 complete: shared parameter definitions now own schema, bounds, labels and
presets; current controls consume them. Registry contracts are inspectable and
every active invocation has a description and causal role. Typecheck, four
catalogue/control tests and fifteen existing control/history/ecology tests passed.

### M1 execution

Expansion `61938607-c8cc-46c1-bf87-2e95d193f25e`.

1. Resolve typed run inputs (`5de29dbe-6dd5-4147-b84f-f83f754aeba7`): use existing
   domain schemas for complete epoch/magic/human inputs, normalize one run seed,
   and retain this snapshot in configuration identity and worker inputs.
2. Ordered preflight and identity (`f44f1bc5-322a-4e29-adb0-5b229c1b5e5a`): walk
   the runner's stages with the registry's actual contracts; share parameter
   resolution, explain invalidated inputs and test full-input identity. Runtime
   geographical validation remains authoritative.

M1 complete: typed settings and one chosen run seed feed both review and worker.
The complete settings snapshot participates in configuration identity; supplied
reviewed configurations must match. Shared parameter resolution and ordered fact
diagnostics passed typecheck and six focused request/registry/worker tests.

### M2 execution

Expansion `9028b507-297c-43a2-9ab3-7cca024a7188`.

1. Selection and absence contracts (`7be7e16b-c193-4993-9f50-006356133edd`):
   omit optional invocations without renumbering other stages. Native algorithms
   can consume initialized zero event histories for absent impacts/volcanism;
   adapt those atlas prerequisites explicitly, retaining all structural numerical
   validation. Coupled glacier transport and ecology timing remain coherent.
2. Geographic behavior (`d3ce749e-eed4-4bac-b28a-cdd33760d1c1`): execute full
   configured worlds with optional effects disabled, verify absent outputs,
   repeatability, history, ecology feedback and publication. Keep existing-map
   replacement on its legacy path.

M2 complete: all-optional-off first-world generation and the existing four-epoch
ecology plus magic-publication journey passed. Seventeen focused contract and
publication tests passed. Optional event histories remain absent rather than
being declared produced; atlas consumers explicitly accept initialized absent
histories while all structural validators still run. Ecology burial names its
retained response context, preserving the existing approximation after coasts.

### M3 execution

Expansion `42dfcdb7-28db-4436-bd9c-63a373f14baa`.

1. Shared draft editors (`0bb8456f-9894-4b9a-9675-a910b4e90716`): extract
   controlled history, ecology and magic editor bodies, preserving existing
   editor operations. Define a versioned JSON recipe and pure preview snapshot.
2. Wizard and first-run handoff (`5ec5e277-7dab-49ae-8b1f-77c0aab4d896`):
   implement world/process/parameter/history/review steps with ordered diagnostics,
   preserve drafts across navigation and create from validated settings before
   the first worker starts. Exercise real request capture and browser navigation.

M3 complete: the first-world browser journey passed with optional switches,
dependency correction, back navigation, ecological epochs, JSON editing and exact
worker request capture. Manual creation, cancellation and concurrent-edit browser
checks passed; 269 normal unit tests passed. Pure previews use a valid temporary
UUID without registering a world. Review keeps formation, epochs and present work
in their actual order.

### M4 execution

Expansion `69cec7fd-c87e-4d64-bccc-86eef4464bcb`.

1. Regional generation and consolidation (`a63c8b27-d319-4001-9c15-7269f20a82f5`):
   hand procedural area creation to the same wizard, bind fixed parent history
   and crossings, and infer inherited native facts from actual channels and
   explicitly initialized material. Remove duplicate parameter labels and retain
   the existing manual/blank and regeneration paths.
2. Integrated verification (`63788487-f977-43bf-ac03-188c87a6ad8b`): exercise a
   real generated parent and new child, complete generation combinations, wizard
   and existing browser journeys, lint, format, typecheck, build and required CI
   checks. Update existing usage documentation with the final behavior.

M4 implementation is complete. Newly created procedural areas enter the shared
wizard with inherited history fixed and geological construction controls inactive.
Inherited facts follow supplied channels, scope and units; initialized material
and inert geothermal inputs are explicit. Missing event histories are accepted as
absent numerical inputs by atlas contracts, without declaring the events produced.
This also preserves applying magic to manually painted elevation. Existing native
physical validators still run.

The full generation suite exposed a pre-existing grazing roundoff failure,
reproduced against unchanged `75690ab` in a temporary source copy. Exhausting tiny
grass stocks could leave negative cover around 1e-30. Bounding the remaining stock
at zero preserves the consumed biomass and strict nonnegative validation. A focused
regression exercises that conversion. Integration correction branch:
`28d67f1e-e2c3-4d2f-812c-2bbf96ba630d`.

## Completed state

M0–M4 are complete. `make ci` passes with 272 unit tests, lint, formatting,
typecheck and Terraform formatting checks. The production build passes. All
eight generation test files passed across the suite run and corrected-case
reruns, including Standard/Fine worlds, omitted optional processes, ecological
feedback, authored terrain and a generated parent/new child with protections.
The full 18-journey browser suite passes; the three wizard journeys passed again
after adding cancellation of a new-world draft, bringing coverage to 19 journeys.
Existing lint warnings and the build's large-bundle warning remain nonblocking.

The plan is complete. Existing-map replacement redesign remains deferred.
