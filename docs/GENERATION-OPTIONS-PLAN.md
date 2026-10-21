# Generation options and dependency-aware wizard

**Current direction — 2026-10-20:** The user rejected the delivered workflow and
clarified that generation architecture is the purpose of this work. The earlier
completion claim below does not establish that architecture as complete. The
[backend architecture redesign](#backend-architecture-redesign--2026-10-20)
supersedes the earlier UI layout and configuration implementation recommendations.
Earlier execution notes remain as history of `ab2ccf6`.

The subsequent UI planning request is recorded in
[Generation setup workflow](GENERATION-WORKFLOW-PLAN.md). Its execution replaces
the earlier wizard with feature-owned controls and shared chronology; that plan
records current implementation and acceptance state and supersedes this document's
earlier UI recommendations.

The 2026-10-21 interface review found gaps in the engine completion claim below.
The corrective contract work is tracked in
[generation contract consolidation](GENERATION-CONTRACTS-PLAN.md). Current API
guarantees and deliberate boundaries are described in
[generation modules](generation-modules.md); earlier execution notes retain their
historical scope.

Execution authorized for all milestones on 2026-10-20. Initial generation is the
priority, with a smaller regional follow-on. Local implementation and validation
are in scope; publication and deployment are not requested.

The backend redesign's D0 and M0–M4 milestones are complete. The active engine
uses feature-owned configuration, executable process traits, one product ledger,
declared conditional reconciliation and module-owned publication. Current usage
is documented in [generation modules](generation-modules.md). The new workflow
uses version 2 feature ownership; legacy flat inputs remain import compatibility.

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

## Earlier completion claim — withdrawn for the architecture

M0–M4 are complete. `make ci` passes with 272 unit tests, lint, formatting,
typecheck and Terraform formatting checks. The production build passes. All
eight generation test files passed across the suite run and corrected-case
reruns, including Standard/Fine worlds, omitted optional processes, ecological
feedback, authored terrain and a generated parent/new child with protections.
The full 18-journey browser suite passes; the three wizard journeys passed again
after adding cancellation of a new-world draft, bringing coverage to 19 journeys.
Existing lint warnings and the build's large-bundle warning remain nonblocking.

These checks passed, but they did not establish complete process ownership,
selection semantics or a satisfactory workflow. The architectural completion
claim is withdrawn. Existing-map replacement redesign remains deferred.

## Backend architecture redesign — 2026-10-20

### Outcome, authority and scope

The user now explicitly prioritizes the generation engine: stable interfaces,
trait-based processes organized around the features they deliver, substantial
architectural design, and complete coverage instead of a nine-process switch
table. Coupled behavior must be one configuration choice. Initial world
generation remains primary; inherited regional generation is a secondary
application of the same contracts. UI work is deferred.

Here, backend means shared domain/generation code and its browser-worker adapter.
ADR 0003 still governs execution: browser memory, one working numerical state,
validated candidate geography and atomic publication. There is no server,
database, persistence, restart, recovery, remote plugin loader or MCP work.
Existing-map replacement and selective cleanup remain outside this refactor.

This section specifies the architecture and migration. Its TypeScript shapes and
module boundaries are proposals, not claims that the interfaces are implemented.
The requirements above come from the user. The decomposition, trait names and
migration phases below are engineering recommendations, subject to the behavior
checks stated here. The earlier authorization to execute did not make the
earlier implementation choices requirements.

### Source findings and reuse boundary

The baseline is `ab2ccf6`. Three independent reviews inspected the implementation,
product contract, spatial traits/composition, configuration and publication. The
Canonry `PhysicalGeographyPipeline.cs`, `PhysicalGeographyLayerContract.cs` and
complete `PhysicalGeographyEvolutionSession.cs` were read in
`../the-canonry-game/src/Engine.WorldGen/PhysicalGeneration/`.
The linked `FEATURE-FINALIZATION-PLAN.md` is absent in this checkout; no claim
about its contents or implementation follows from that link.

The identity inventory covers all 55 entries in `contracts.generated.json` and
their sequence sites. Detailed algorithm-body inspection focused on shared
material, ice, ecology, magic, hydrology, refinement and publication behavior.
This is not a new line-by-line semantic audit of every numerical kernel. The
responsibility assignments below are design proposals; migration must establish
each selected mechanism's complete reads, effects and valid disabled behavior.

Retain these existing mechanisms:

- `MapProcess`, `MapRunner`, ordered TypeScript sequences and epoch expansion as
  the low-level execution foundation. Preserve apply/validate, cancellation,
  deterministic seeds, private working state and publication protections.
- The Canonry numerical algorithms and the actual ordering of repeated passes.
  Semantic operations matter; numerical equality with Canonry is not a target.
- Existing Zod schemas and typed parameter validation, GIS feature identity,
  network/crossing rules, authored fields and domain invariants.
- Complete request identity and ordered preflight, after their inputs and
  contracts are made authoritative through the new binding boundary.

Replace these demonstrated sources of architectural inconsistency:

- `optionalProcesses`, prefix-based ecology grouping and global prerequisite
  deletion in `selectedNativeContract`; nonmembership is not a required reason.
- Public settings scattered between flat parameters, profile construction,
  captured `AtlasGenerationInput`, direct `world.epochs`/human-era reads and
  magic definitions. Resolved inputs must control actual execution.
- Opaque nested execution: `adaptiveWater` directly invokes drainage processes,
  and adaptive ice invokes ice flow outside the outer plan. The generated plan
  currently does not fully describe the work the engine can execute.
- Broad extraction followed by deleting unwanted channels, and publication's
  central channel-to-layer table with an unknown-channel fallback to climate.
- Invocation IDs suffixed with array indexes. Adding a feature must not renumber
  unrelated stages or alter their independent random-stream identities.

Current examples demonstrate why these are functional issues. Coastal evolution
off leaves `external-coastal-forcing`, which can still cut and deposit terrain.
Deep-ocean source placement reads `world.seed`, bypassing the request seed.
Magic classification reads configured environmental fields not fully represented
by `magicRequirements`. `atlas:ecology-response` has no epoch lifetime today;
default sequence order conceals that gap.

### Separate the things being modeled

| Concept            | Stable responsibility                                                                                                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Generation feature | A requested delivery such as river networks, impact geography, glacial sculpting, living ecology or one configured magical system. Owns its settings, support requirements, complete behavior and publishable products.         |
| Process            | A concrete numerical/domain operation at a named causal occurrence. Implements behavioral traits, consumes bound inputs and contributes changes to the shared working state. A process can support several generation features. |
| Geographic feature | An actual river, crater, forest, polity or building with stable domain identity, geometry, relationships and authored protection. Continue to use `AtlasFeature` and existing domain composition.                               |
| Spatial trait      | Existing hard/tendency/derived/exception constraints on geography. Preserve `domain/traits.ts`; it is not a process capability registry.                                                                                        |
| Working product    | A typed field, material/history state, forcing, network or candidate collection used between processes. Several processes may contribute to the same final geographic product.                                                  |

A process is not required to own a unique output layer or a unique geographic
object. Glaciers, rivers and coasts all change terrain and sediment. A magic
system can change temperature and ice while contributing its own fields and
places. Their contributions must compose through shared product contracts.

### Stable definition and execution boundaries

One generation module registers feature definitions, their process
implementations and product definitions. The application composition root imports
the modules. A new feature using existing behavioral interfaces, representations
and causal slots should require that registration and its implementation, not
edits to generic planning, selection, preflight, execution or publication code.
A genuinely new physical phase or representation can require a deliberate
contract/profile extension; this is not a universal plugin interpreter.

The stable boundaries should be small and typed. Illustrative signatures:

```ts
interface GenerationFeature<C> {
  id: FeatureId;
  version: string;
  settings: SettingsSchema<C>;
  profiles: readonly Profile[];
  resolve(draft: unknown, context: ConfigurationContext): BoundFeature<C>;
  contribute(bound: BoundFeature<C>, profile: ProfileSlots): Contributions;
}

interface ProcessDefinition<C, P> {
  id: ProcessId;
  version: string;
  contract(settings: C, binding: InvocationBinding): EffectiveContract;
  behavior: ProcessBehavior<C, P>;
  validate(context: RunContext, ports: P, settings: C): Diagnostic[];
}

interface ProductDefinition<T> {
  id: ProductId<T>;
  representation: ProductRepresentation;
  unit: Unit;
  lifetime: ProductLifetime;
  composition: ProductComposition<T>;
  publication?: PublicationDefinition<T>;
}
```

`GenerationFeature.resolve` only validates and binds configuration; it must not
run numerical generation. `contribute` supplies known operations to the ordered
profile, rather than executing a hidden subpipeline. Public schemas belong to
features. Internal process settings are explicit typed projections of resolved
feature settings, with actual defaults, unit conversion and epoch composition.
They do not introduce another independent default authority.

`ConfigurationContext` contains the declared profile, scope, input availability
and draft schedule. `RunContext` contains the immutable resolved invocation,
seed streams, epoch/occurrence binding, scope and progress/cancellation services.
World data required for generation arrives through explicit scoped ports. A
process does not obtain settings or randomness by reaching back into a mutable
world or request object. Settings are decoded before crossing the worker boundary;
the worker validates and executes the same bound recipe.

Separate the serializable `ResolvedRecipe` from worker-local `BoundExecution`.
The transferable recipe contains definition IDs/versions, decoded settings,
semantic occurrence keys, product handles/input bindings, source revisions and
seed provenance. Schemas, functions, ports, runtime registry objects and numerical
workspace references do not cross structured clone. The worker rebinds those
handles to the statically registered implementations and actual source products,
verifies the reviewed recipe identity and validates its bindings. It does not
reconstruct a different sequence or default configuration. This preparation is
ordinary typed sequence resolution, not a new bytecode/workflow compiler.

Initially a generic adapter can expose these definitions through `MapProcess`.
That adapter is only migration scaffolding. Moving ownership, settings, actual
input binding, nested execution and output contribution is required for a migrated
feature to count as complete. A descriptor around unchanged bypasses does not.

### Operational traits, not descriptive tags

Use TypeScript structural interfaces and small shared implementations. Traits
provide operations or enforce invariants. A `traits: ["terrain", "historical"]`
list is insufficient. A process implements only the behaviors it actually has.

| Behavioral trait                 | Actual operation and obligation                                                                                                                                                                                                                      |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initializer                      | Initializes defined working products once for its scope, including any declared empty/neutral inputs. It cannot mark omitted events as produced.                                                                                                     |
| Model pass                       | Applies one explicit numerical occurrence. Every invocation is significant unless the implementation separately establishes repeatability. Land-ice balance belongs here, including present-stage occurrences.                                       |
| Elapsed evolution                | Advances specified state by an explicitly bound number of years. The runner passes that duration; the process cannot infer elapsed time from an unrelated world array.                                                                               |
| Carried state / spatial transfer | Initializes and transfers retained state through epoch transitions, plate advection or remeshing with a declared intensive/extensive/category rule. Reuse actual transfer algorithms and protected-boundary composition.                             |
| Material transformation          | Cuts, transports or deposits material using shared numerical operations and the existing conservation accounting, then validates its promised balance. Track contributions from all participating features, not an independent budget per UI choice. |
| Forcing contribution             | Produces a typed heat, coastal, biological or other forcing for a declared consuming process/causal position. The target feature owns applying it; a modifier cannot secretly execute a disabled target's behavior.                                  |
| Geographic extraction            | Converts selected final working products into candidate fields, features, networks or entities using existing GIS identity and protection operations. Declares actual output definitions and validates them.                                         |

For example, process behavior is an operation-bearing discriminated union, not
a bag of flags: an elapsed implementation has `advance(context, ports, settings,
years)`, a model pass has `applyPass(context, ports, settings)`, a transfer has
`transfer(context, ports, mapping)`, and extraction has `extract(context, ports,
candidates)`. Material, forcing and carried-state helpers compose these operations
where the actual algorithms need them. The generic runner dispatches on these
behavioral interfaces, never on glacier, river or magic IDs.

Use domain ports for terrain/material, climate, hydrology, ice, ecology, magical
fields and candidate geography over the shared in-memory workspace. Numerical
kernels can migrate through compatible typed views; do not rewrite their
arithmetic merely to change an interface. Eliminate ambient configuration reads
in each migrated slice. Do not add a runtime permission/proxy engine over every
array, or claim that `Readonly<Float64Array>` prevents element mutation.

Spatial authority remains a shared execution service: bind affected scope and
halo, compose authored/inherited values at the existing causal positions and
validate publication. Processes still declare their actual spatial needs. A
trait name does not confer permission to alter protected geography.

### Product validity, shared state and absence

Replace unrelated string fact sets with typed product keys and one run-local
availability ledger. Native `AvailableFacts` becomes an adapter view of that
authority; `MapRunner`, `applyNativeStep` and regional adapters must not maintain
independent versions of truth. The existing requires/produces/invalidates
mechanism can implement the first step; a new general event store is unnecessary.

The common executor checks prerequisites, applies the operation, validates its
result and commits the effective validity transition exactly once. Native
adapters do not commit another transition alongside `MapRunner`. Initialization
and remeshing also use this authority. Native algorithms that query availability
read the translated view; they cannot silently manufacture another fact set.

Each product declares representation, units, spatial frame, lifetime and write
composition. A product handle binds the definition to a configured instance and
scope: intensity for magic system A differs from intensity for system B. Causal
validity belongs to that bound product, not a global product-name boolean.
Distinguish:

- Missing input: neither provided nor initialized. A required consumer fails.
- Explicitly empty/neutral input: established by a declared initializer with
  physical meaning, such as no impact history or bare ecological cover.
- Current derived value: valid for the required scope, forcing and causal point.
- Carried state: sediment, cohorts, soil, event history or other accumulated state
  intentionally preserved across epochs.
- Stale derived value: still allocated in memory but invalid for a consumer that
  requires current geography. It is not interchangeable with missing or empty.

Requirements specify current, carried or accepted optional input, with a named
fallback implementation where one is supported. Producers and invalidators
drive the same checks in preflight and execution. An epoch-local response cannot
satisfy a later epoch merely because a string remains in a set. Remeshing also
invalidates derived geometry-dependent products or transfers them through their
declared operation.

Retained access to a previous calculation must identify its causal meaning.
Ecological burial currently uses the retained response context after coasts, not
a newly computed post-coast climate. Preserve that explicit approximation. Do
not create automatic snapshots of every field: retaining a value after
invalidation is permitted only while that value actually remains available; a
specific old value overwritten later requires explicit retained storage.

Product composition must distinguish a single replacing producer, ordered
in-place material transformations, accumulated history and explicitly combined
forcing. Exclusive-provider conflicts apply to a particular bound product and
causal occurrence. Climate replacements at different occurrences, or an explicit
temperature replacement followed by magical modification, remain valid.
Different ordered terrain modifiers are expected collaborators, not duplicate producers.
The erosion display, for example, combines several retained erosion histories;
none should erase another feature's contribution.

Disabled behavior belongs to input/product and feature definitions, not global
deletion of requirements. Fracture generation may accept initialized empty impact
history. Delta generation still needs valid floodplain input. Sediment transport
can remain necessary when impacts, slope transport or glaciers create loads even
with river incision disabled. Empty oceans with valid bathymetry can mean no
deep-ocean magical source; missing bathymetry is a different condition.

An effective contract must make those rules executable. For example, a resolved
externally forced coastal pass contains the following information (an excerpt;
the complete contract retains all applicable reference/atlas invalidations):

```text
operation: coasts.external-forcing@<implementation-version>
owner: selected coastal-evolution feature
occurrence: coastal-evolution / epoch.coasts.external / <epoch-id>
behavior: ModelPass + MaterialTransformation
settings: resolved epoch coastal strength and coast profile values
inputs:
  terrain, ocean, bathymetry, currents -> current at the coastal entry point
  landscape history -> carried material/history
  external coastal forcing -> bound contributions for this occurrence;
                              explicit zero-field initializer if none exist
effects:
  transform terrain/material; accumulate external coastal erosion history
  produce coastal evolution evidence
  invalidate dependent climate/water/ice/landform products
validation:
  valid forcing location/range, material accounting and structural geography
seed: resolved invocation stream, with the declared native salt
```

The same bound input/effect records drive preflight and the executor's commit.
The zero forcing field is an actual initialized input; it is not a claim that a
pressure system ran. The material operation is the existing cut/deposit kernel
adapted to explicit ports/settings. It cannot be invoked by magic behind a
disabled coastal feature. Glacial erosion/deposition similarly bind the ice-flow
state at entry to their paired operation: changing terrain does not authorize an
unplanned additional ice relaxation between those coupled passes.

### Causal composition and temporal semantics

Preserve named profile templates and ordinary TypeScript sequence composition.
The Canonry session's actual phase order is geology, climate, hydrology,
glaciation, post-glacial reconciliation, domain forcing, coasts and history,
followed by present evaluation and publication. Atlas ecological and magical
contributions occur at their existing interleaving positions.

A feature contributes at explicit slots, such as `epoch.before-incision`,
`epoch.after-incision.climate`, `epoch.after-glaciation.ecology`,
`epoch.coastal-forcing` and `present.river-extraction`. Slot definitions preserve
the internal ordering of climate/drainage blocks and repeated ice occurrences.
Registration cannot arbitrarily reorder causal stages.

The profile names the supported providers for required products. Resolve their
participation from selected deliveries, declared inputs and material obligations.
Shared support is included for actual consumers, with a recorded reason. Do not
search arbitrary providers, silently enable an explicitly disabled feature or
topologically sort unique process types. A foundational terrain source is a real
requirement; deleting the only elevation producer cannot create a valid world.

Several features may request the same named support occurrence. Emit that
occurrence once only when its semantic key, settings and bindings agree. Never
deduplicate by process ID or apparent equality of inputs. Two land-ice passes at
different positions are different operations: `landIce.ts` adds/ablates existing
thickness on each call, even during final reconciliation. Ice-flow also retains
cumulative maxima. Preserve those behaviors unless a separate algorithm change
is explicitly justified.

Shared support has a canonical profile/provider owner, independent of its
requesters. The occurrence key uses that provider, semantic slot and epoch;
requesting features and inclusion reasons are separate provenance. Adding or
removing ecology cannot rename drainage support merely because rivers were its
other requester. If two requests for the same occurrence disagree on settings
or bindings, report both requesters as a conflict; do not choose the first,
duplicate the pass or silently merge incompatible model choices.

Time must be bound per operation:

| Existing behavior                 | Required binding                                                                                                                             |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Most physical layers              | Numerical model passes with epoch strengths; not automatically elapsed-year integration                                                      |
| Ecological evolution and response | Two distinct invocations, each with half the physical epoch duration                                                                         |
| Organic burial/thermal maturity   | Its own full-epoch duration after coastal work                                                                                               |
| Present ecological classification | No added biological age                                                                                                                      |
| Configured magical history        | One defined accumulation per epoch; no accidental duplication during support passes                                                          |
| Local magic storage               | Its existing elapsed-duration behavior                                                                                                       |
| Cultural history                  | Currently aggregates years and mobility; physical-epoch linkage and political-capacity effects are not implemented by the present algorithms |

Do not advertise unused human-history fields as operative process traits. In
the version-1 ingress adapter, preserve `politicalCapacity` and `physicalEpoch`
as inert compatibility metadata. Existing default values do not block a run;
nondefault requested values receive a specific nonblocking compatibility
diagnostic explaining their lack of effect. The new operative settings schema
contains only supported behavior and rejects unsupported semantic options as
unknown. Diagnostics distinguish warnings from errors; only errors block
execution. Extending the human model requires a separately defined algorithm
change, not metadata claiming it exists.

Nested regional refinement must use the same definitions and executor. A
remeshing operation has a declared conditional reconciliation branch; preflight
checks both branch outcomes, and runtime executes reconciliation only when the
mesh changes. The unchanged-mesh branch retains existing validity; the changed
branch invalidates affected products and must restore its promised postconditions
through selected definitions. Only outputs guaranteed across the branch join
can satisfy later consumers. Test both outcomes and a provider available only
inside one branch. It cannot directly rerun every drainage process with the raw
reference contract outside feature selection. Internal numerical iterations
within one algorithm remain helpers of that algorithm, not new user processes.

### Configuration, identity and publication

Use versioned JSON decoded by the registered feature schemas. Each feature owns
its complete scalar and nested settings, epoch-varying fields, merge/composition
rules and baseline defaults. Epoch bindings reference that same owner. Physical
temperature offsets, multiplicative ecological productivity and rainfall
composition remain domain rules, not a generic last-value-wins accident.

Produce an immutable resolved request with feature instances, effective settings
per occurrence, input bindings, source revisions, sampling detail and seed
provenance. Retain provenance from actual setting layers rather than guessing
that equality with a default establishes its origin. Preflight and execution
consume that same request; mutation of the caller's draft cannot change a run.

Feature-specific invocation identity uses feature instance, process definition,
semantic slot and epoch ancestry. Shared support uses its canonical profile/provider
owner instead of any requesting feature instance. Identity excludes array
position, requester order, label text and current checkbox ordering. Retain
documented native salts through the adapter.
All seed consumers, including magic source placement, use the resolved seed or an
explicitly declared parent/source seed binding. Inserting an unrelated feature
must not change existing invocation keys or independent random streams. Actual
shared terrain changes can still causally change the resulting geography.

Working products and publishable products are distinct. River routing can be
needed by sediment or ecology even when river vector output is omitted. A
disabled river delivery should not delete another feature's hydrology support.
Conversely, keeping a working buffer is not evidence that a layer was requested
or generated.

Product publication definitions declare channel schemas, units, quantities,
feature/entity/network types, layer bindings and coverage semantics. Registered
extractor processes own the numerical/domain-to-candidate algorithms. Publication
does not run hidden numerical or extraction callbacks. A module publishing a new
layer supplies its complete domain layer definition and applicable area bindings;
the generic boundary validates or installs those definitions in the candidate,
checking conflicting IDs. Adding a channel must not depend on a separate edit to
the builtin world-layer list. Split the broad native extractor into selected
contributions while preserving the shared water geometry
and network dependencies. Compose one candidate `DomainSnapshot`, validate it,
then publish atomically through the existing browser adapter. Unknown product
bindings fail explicitly; there is no fallback that silently puts a new channel
on the climate layer. Use existing geographic identity and representation rules,
not a second atlas object model.

A compatibility adapter may translate current `AtlasGenerationInput` and recipe
version 1 into feature-owned requests while callers migrate. It is a single
ingress adapter, not a second active planner or nine-ID selection authority.
Reject unrepresentable half-coupled legacy choices. No persistence migration or
historical configuration restoration is needed for the current session model.

Implementation boundaries should follow the existing package responsibilities:

| Boundary                              | Implementation responsibility                                                                                                                                                       |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Generation feature modules            | Own supported delivery configuration, internal process settings projections, operational implementations, products and contributions. Keep numerical kernels beside their adapters. |
| `process.ts` and the common executor  | Stable process behavior/context/contract types and the single validity transition. No feature-ID branching.                                                                         |
| Product definitions/binding           | Typed identities, units, lifetime, composition, instance/scope binding and declared publication metadata. No second geographic model.                                               |
| Profile sequence construction         | Explicit named causal occurrences, chosen providers and conditional branches; preserve reference order.                                                                             |
| Configuration preparation/preflight   | Validate and resolve feature schemas into the data-only recipe; check actual effective contracts and branch postconditions.                                                         |
| Numerical workspace and transfer      | One shared state, domain ports, existing spatial transfer and protected/inherited authority.                                                                                        |
| Geographic extraction and publication | Selected extractor operations produce candidates; generic publication validates registered product/layer bindings and commits through the existing domain boundary.                 |
| Worker/caller adapters                | Validate/rebind the same recipe, report structured diagnostics and retain current cancellation/version behavior. Old input translation is confined to ingress.                      |

The first implementation slice should establish these interfaces before choosing
final file granularity. They are responsibility boundaries, not a quota of new
folders, registries or wrappers. Numerical results can change when correcting seed
authority or binding semantics; preserve geographic mechanisms and determinism
for the versioned atlas recipe rather than promising old hashes or Canonry arrays.

### Delivery walkthroughs and hard cases

**River geography with incision disabled.** River delivery requests routing,
discharge, channel geometry and network extraction. Incision is a separate
terrain-changing contribution. Disabling incision omits its cutting operation
and associated post-incision participation; routing remains for selected
consumers. Sediment transport remains when other enabled sources create loads.
Publication receives real river profiles and networks, not channels relabeled
as a river feature. Climate/drainage occurrences retain the profile's causal
positions.

**Glacial sculpting.** One settings record owns erosion and deposition together,
their material accounting and retained geomorphic evidence. Ice balance, ice
flow, loading and meltwater are explicit shared/ice-system dependencies. A
supported ice-without-sculpting configuration is different from disabling the
entire ice system. Each has its own valid requirements and output expectations;
do not make a glacier toggle secretly retain unspecified ice advancement.

**Pressure and coastal evolution.** Pressure produces intensity, history and a
coastal forcing contribution. Coastal evolution consumes that contribution and
owns both natural and externally forced cut/deposit operations. If the target
feature is disabled while an enabled system still requests coastal modification,
reject that specific incompatible effect. The caller can retain the pressure
field by setting its coastal effect to zero. Do not silently re-enable coasts or
silently ignore a requested effect. With coast modification disabled and no
enabled modifier targeting it, neither natural nor magical coastal cutting runs.

**Ecology and magic.** Ecology owns initialization, both half-epoch responses,
soil/cohort/animal state, burial and selected extraction. A magic condition
reading peat or tree cover requests that actual typed product at the
classification occurrence. Its selected source, propagation, effect and rule
implementations contribute their own requirements. Missing ecology yields a
diagnostic naming the rule, not a generic magic-is-enabled check. A system that
needs no ecology does not acquire that requirement from another system's schema.

**Spatial refinement.** A child imports valid scoped products and explicitly
initialized material. Boundary crossings and authored geography remain fixed.
Remeshing transfers actual carried state, invalidates derived fields, then
executes only the selected reconciliation branch. No full epoch is replayed just
because resolution changed. This remains one bounded regional acceptance case,
not a new regional simulation or existing-map replacement project.

### Complete native responsibility inventory

All names below are `canonry.<name>`. This accounts for all 55 native definitions;
it is a proposed responsibility map, not 55 promised independent switches.
Shared participation and disabled semantics must be established from the actual
implementation in the migration phase, before a selectable capability ships.

| Delivery or shared responsibility                      | Native definitions                                                                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Terrain source and initial material                    | `tectonic-provinces`, `continental-sutures`, `tectonic-margins`, `continental-domains`, `tectonic-uplift`, `landscape-initialization` |
| Tectonic history and carried crust                     | `plate-advection`, `tectonic-epoch-activity`                                                                                          |
| Mountain/range construction                            | `orogenic-construction`                                                                                                               |
| Volcanic geography and thermal participation           | `mantle-plume-roots`, `volcanic-construction`                                                                                         |
| Impact geography and excavation history                | `impact-cratering`                                                                                                                    |
| Hillslope material transport at distinct occurrences   | `mass-wasting`, `post-fluvial-mass-wasting`                                                                                           |
| Shared bedrock/sediment/ice load response              | `crustal-support`, `lithospheric-flexure`                                                                                             |
| Continental margins and marine deposits                | `continental-margin-evolution`, `marine-sedimentation`                                                                                |
| Initial coastal construction                           | `coastal-detail`                                                                                                                      |
| Fault/fracture and geothermal products                 | `fracture-network`, `geothermal`                                                                                                      |
| Ocean classification, depth and landmass products      | `ocean-connectivity`, `ocean-distance`, `bathymetry`, `landmasses-and-shelf-groups`                                                   |
| Ocean circulation and thermal inputs                   | `ocean-currents`, `warmth-sources`                                                                                                    |
| Atmosphere and climate products                        | `temperature`, `atmospheric-flow`, `moisture-transport`, `precipitation`                                                              |
| Shared hydrologic state and river/lake deliveries      | `runoff`, `drainage-conditioning`, `lake-basins`, `drainage-guidance`, `flow-routing`, `river-network`                                |
| River terrain incision                                 | `ancestral-fluvial-erosion`                                                                                                           |
| Shared fluvial sediment movement                       | `sediment-transport`                                                                                                                  |
| Ice system and coupled glacial sculpting               | `land-ice-mass-balance`, `ice-flow`, `glacial-erosion`, `glacial-deposition`, `glacial-meltwater`, `glacial-runoff`                   |
| Retained glacial geography                             | `glacial-landforms`                                                                                                                   |
| Sea-ice delivery                                       | `sea-ice`                                                                                                                             |
| Whole coastal modification, including external forcing | `external-coastal-forcing`, `coastal-erosion-and-deposition`                                                                          |
| River shape and depositional geography                 | `river-channel-geometry`, `river-floodplains`, `river-delta-formation`                                                                |
| Shared present landform classification                 | `landform-classification`                                                                                                             |
| Epoch completion and physical invariants               | `physical-epoch-history`, `physical-structural-validation`                                                                            |

The migration inventory also includes all non-native participants:

- Atlas initialization, beginning epochs, forcing transfer, projection and
  geographic extraction (`canonry.initialize`, `begin-epoch`, `forcing`,
  `project`, `features`), plus preparation of generated domain content.
- Conditional `refine-climate`, `refine-water` and `refine-ice` branches and their
  direct numerical calls. World sampling remains fixed; regional adaptive
  behavior is preserved through the same execution boundary.
- Ecology `initialize`, `evolve`, `respond`, `burial` and `present`, with actual
  vegetation, soil, animal, carbon and migration operations underneath.
- Configured magic `initialize`, `climate`, `rocks`, `post-glacial`, `coast`,
  `history`, `classify` and `project`; conditional source, propagation, effects
  and rule readers participate in the same typed requirement contract.
- `magic.thermal`, `magic.material`, `magic.advanceStorage` and `magic.advection`.
  Retain local-source semantics while sharing typed settings, forcing, seed and
  carried-state interfaces with configured systems.
- `human.cultures`, `human.politics` and `built.layout`, including entity and
  network publication and their actual supported historical inputs.
- Legacy exported/test-only terrain, climate and hydrology implementations.
  Identify them explicitly as compatibility implementations or retire them from
  active registration; do not present both as competing current generators.

### Migration milestones and evidence

Root: `32e24ce4-fc09-4aea-affb-97602f6fa0a0`. This design replaces the architectural
completion claim of root `1a01bbef-e1b7-4e26-ae34-06695732772f`; the older root's
record remains history, not evidence of completion of this work.

**D0 — Architecture and migration design.** Source/reference inspection,
operational trait model, complete identity inventory, ownership proposal and
counterexample walkthroughs. Accept when independent review has challenged
shared products, temporal behavior, configuration authority, hidden regional
execution and publication. Phase `7dcb4c66-c8f1-4c2b-8fc0-12791af986be`.

**M0 — Stable contracts and reference slice [depends on D0].** Introduce the
definition/binding/product/trait boundary and authoritative validity executor.
Migrate complete river/incision/glacier/sediment examples and the pressure/coast
interaction as demanding reference slices. Use the actual kernels, not stand-in
implementations. Prove whole coupled choices, real omission, shared support,
conditional forcing, explicit time and output declarations. A trivial feature
that only publishes a label does not establish the architecture. Phase
`07efb086-12c8-4ea8-915f-db169a6333ca`.

**M1 — Physical feature migration [depends on M0].** Move every native inventory
row and its active atlas adapters through the common contracts. Complete the
algorithm-body ownership/absence audit for each row. Reconcile profile
construction, selected inputs, material budgets, conditional support and all
causal occurrences. No native implementation defaults to required because its
definition is missing. Default generation retains all semantic operations;
selectable features have explicit supported omissions or dependencies. Phase
`d01e8c9d-28c4-4635-b4a8-cdeb1b65b657`.

**M2 — Ecology, magic and people [depends on M0, M1].** Bind all effective
settings and seeds through invocation context, including nested rules and all
source modes. Migrate actual temporal and forcing behavior; remove direct
configuration reads from world/request closures. Preserve existing domain
behavior and explicitly reject unsupported temporal semantics rather than
advertise nonexistent ones. Phase `53ff2d84-1db2-480c-8370-fbb8e8eace18`.

**M3 — Publication, regional integration and retirement [depends on M1, M2].**
Split selected geographic extraction, publish registered products through the
existing candidate/atomic boundary, and migrate conditional refinement through
the same executor. Replace central channel classification, raw native nested
execution, prefix family matching and requirement deletion. Move existing callers
through the single compatibility ingress, then retire duplicate active paths.
UI redesign is not a milestone. Phase `e1d3e192-f2f5-4af4-a5ad-18af4aa2ae2b`.

**M4 — Architectural behavior verification [depends on M3].** Acceptance includes:

1. A new feature module supplies its schema, real behavioral implementation,
   products and phase contributions using existing interfaces/representations/
   slots. Only registration changes outside that module; generic selection,
   execution, preflight and publication remain generic. Novel representations
   or causal phases require an explicit bounded contract extension.
2. Conflicting source-world settings and a request seed different from the world
   seed cannot override the resolved settings. Changing the caller's draft after
   preparation cannot change generation.
3. Glacier erosion/deposition cannot be half-selected in a valid recipe. River
   geography still works with incision disabled. Other sediment sources retain
   valid transport and conservation behavior.
4. Coast modification disabled means no natural or external coastal cut/deposit
   invocation; an enabled magical coastal effect produces the specific dependency
   error. A pressure field with zero coastal effect remains valid.
5. Missing, stale, explicit-empty and carried products exercise different
   behavior. A prior epoch's ecology response cannot satisfy a new epoch; retained
   material and cohorts survive the transition. Do not deduplicate repeated ice
   model passes.
   Native-to-atlas-to-native invalidation uses one committed validity transition;
   both remeshing branch outcomes satisfy their declared postconditions.
6. Ecological biological duration is half plus half, burial gets its own duration
   and present classification adds no biological age. Magic history/storage keep
   their distinct actual time bindings.
7. Enabled magic rules derive their actual dependencies. An empty ocean with
   valid bathymetry is distinguishable from missing bathymetry or ecology.
8. Several processes contribute terrain, material or forcing without losing
   another contribution; incompatible exclusive producers fail before execution.
9. A new declared channel and genuinely new layer publish with their complete
   units, layer metadata and coverage through planning, worker execution and
   candidate discovery without central channel-name or builtin-layer edits.
   Unknown products fail; disabled outputs are not
   published merely because working buffers exist.
10. Registering an unrelated feature leaves existing invocation IDs and independent
    random streams stable. Relevant shared geographic changes remain causal.
11. Each feature-disable request against an otherwise-default fresh world yields
    either a valid omitted configuration or the exact dependency diagnostic
    before execution. Run actual geography checks for supported omissions and
    explicit valid adjustments of dependent choices; do not require an invalid
    combination to execute. Check material/time invariants and output absence,
    not only filtered process names.
12. Complete default multi-epoch worlds, one generated parent/new region, protected
    edits, boundary crossings, worker cancellation/stale-version handling and
    atomic publication continue to work. Run repository-required checks and build.

Phase `dc82c0d6-8673-4af1-b83d-a8bd0964da5d`. Focused behavior evidence belongs
throughout migration; M4 integrates it rather than discovering basic contract
defects only at the end. No separate verification report files are required.

### Decisions, assumptions and current state

User requirements are backend priority, stable interfaces, trait-based behavior,
feature-oriented composition, coherent coupled choices and initial-generation
priority. Existing browser-only execution and domain identity/protection remain
agreed boundaries. This design does not silently expand the human simulation,
physical models, persistence or UI scope.

Proposed module boundaries, typed product ledger, named causal slots and trait
interfaces are engineering choices. They are justified by observed shared state,
hidden execution and parameter/publication bypasses. They must remain small:
ordinary TypeScript, existing schemas, one working map and known ordered phases.
A generic rule interpreter, arbitrary workflow graph, runtime array permissions
and automatic recovery solve no demonstrated requirement here.

Feature granularity and valid disabled modes require algorithm-specific evidence.
The inventory is a starting proposal, not permission to expose arbitrary switches
or claim all null/zero states physically valid. The first reference slices must
invalidate or refine this proposal before broad migration if it cannot represent
those actual behaviors simply. Do not weaken invariants or omit a feature to
force a proposed abstraction to fit.

Architecture design and independent review are complete. The reviewers' identified
contradictions were corrected: canonical shared-support identity, valid versus
invalid omission cases, conditional branch guarantees, one validity-commit point,
worker transport, scoped writer conflicts, extraction ownership, new-layer
registration and unsupported human-history compatibility. All 55 native IDs are
mapped exactly once in the inventory; this checks inventory coverage, not kernel
correctness.

Execution of M0–M4 is authorized by the user's request to execute all phases.
The earlier 272-test and browser results are baseline evidence, not evidence
that these new contracts have been implemented.

### M0 execution expansion

Attached plan `51300447-73a7-4362-a8fa-dd876f230c4f`:

1. Contracts and validity authority (`0bb5c5cf-da23-422f-9e34-e21a59177179`):
   implement executable process traits, explicit parameter bindings and one
   product ledger shared by preflight, execution and native adapters.
2. Feature binding and causal reference slices
   (`fb9611f5-2c7b-4338-a58a-3b4f01018fc3`): establish feature definitions,
   owned schemas, stable named occurrences and explicit absence initializers;
   compose rivers, coupled glaciers and coastal pressure through that interface.
3. Reference behavior verification (`0a4cc0cf-f893-452a-b882-b3398da6931b`):
   exercise actual kernels and delivered geography, sediment conservation,
   dependency errors, validity transitions and stable invocation identities.

The engine reviewer owns the core process, runner, preflight, ledger and native
contract adapter. The primary agent owns feature binding and workflow migration.
The other reviewers supply source-backed physical ownership and behavioral
fixtures, then receive bounded migration work. Numerical kernels retain their
arithmetic unless a demonstrated contract defect requires a change. No UI
redesign is part of this execution.

M0 reference execution is complete: 13 focused tests cover settings, dependency
diagnostics, coupled selection, actual coastal and glacier material budgets and
river geometry without incision. The full default native order remains 162
occurrences for a one-epoch fresh world, matching the reference composition.

### M1–M3 execution expansion

Attached plan `10ea5d8b-dd9b-4eaa-8919-f7644fea08ad` spans the closely coupled
migration boundaries; these steps run concurrently with separate file ownership.

1. Physical capability migration: cover all 55 native definitions, bind settings
   and products, give omitted histories real neutral initialization, retain the
   material budget and test both valid omissions and exact dependency failures.
2. Ecology, magic and people: use the reviewed request for settings and seed,
   declare biological and storage durations, derive magical input requirements
   and preserve unsupported legacy human-history metadata without claiming it
   changes geography.
3. Publication and regional integration: select channels and geographic extractors
   before output creation, carry complete publication descriptors to the editor,
   install registered layers generically and run conditional remesh reconciliation
   through the same executor and validity authority.

The source review established that invalidating an explicitly omitted event
history does not create events. Those neutral products have an explicit
`retainOnInvalidation` initializer policy; ordinary empty products still become
stale on invalidation. Producing the product removes that policy. This preserves
the distinction between known absent history and missing or stale computation.

The physical migration checks now cover all 55 native definitions, all 26
independent disable requests and 16 supported omissions through actual fresh-world
generation. A real parent/region check retains inherited impact history when new
local impacts are disabled. Fracture conductivity is a shared material-state
product; the optional fault network is a separate delivery.

Module registration now owns schemas, runtime factories, contributions and
publications. Feature-local numeric names have explicit legacy projections, so
an extension's `temperature` cannot overwrite physical temperature. Nested clock,
ecological, magical and cultural configuration has named owners. A module
extension runs through the actual worker handler, including an existing physical
slot, a new parameter, nested configuration and a new layer. Caller draft changes
cannot mutate the prepared request.

### Remesh contract correction

Independent review found a prerequisite defect in M3: runtime remeshing revoked
topological products without declaring those changes to preflight, and the
conditional child reconciliation was absent from the reviewed recipe. M3 was
blocked on attached sub-plan `cb3714a7-6441-4ee0-8e4b-233c8b18b820`:

1. Declare the existing child sequences and invalidations, inspect changed and
   unchanged validity branches, join their guarantees and bind the child metadata
   into the reviewed request.
2. Migrate physical transfer adapters and distinguish carried water/ice state
   from reset outlet/routing indices. Keep the original conditional operations;
   do not add accumulation or climate passes to make prerequisites pass.
3. Test both branch outcomes, missing child producers, extension consumers and
   the representative inherited region.

This corrects the implementation to the planned common dependency interface; it
does not add a general scheduler or change the browser session scope. Immediate
revocation of invalid topology is permitted during transfer. Produced validity
still follows successful operation validation through the common ledger.

The remesh correction is complete. Changed and unchanged water, ice and climate
fixtures, native regional-only branch declarations and stale outlet rejection
pass. `LakeState` carries water inventory; `LakeOutlets` represents topology that
transfer resets. Ice reconciliation routes the existing thickness rather than
accumulating another pass. Child sequences and their guarantees now participate
in the reviewed configuration and are checked by preflight and execution.

Versioning uses JSON recipe schema versions 1/2, resolved configuration version 4
and concrete process versions. There is no separate per-feature migration layer:
this browser session has no stored execution state to migrate. Feature-owned
schemas and reviewed module/branch declarations establish the current interface.

### M4 execution expansion

Attached plan `85e75d1d-9603-406f-9fe4-b568933a547d`:

1. Run repository-required lint, format, type, unit and Terraform format checks.
2. Run all actual generation scenarios, including 16 supported omissions, complete
   multi-epoch worlds, protected edits and inherited regions. Heavy world checks
   remain in the existing generation suite; cheap contract checks run normally.
3. Run browser workflows and the production build, inspect the final diff and
   finish architecture documentation and plan state. No external publication, commit or
   push is included in the current request.

M4 is complete. `make ci` passed lint, formatting, domain/generation/frontend
typechecks, unit tests and Terraform formatting. The final expanded unit suite
passes 367 tests. All 27 actual generation cases pass across the full suite and
focused corrected-case reruns, including Standard/Fine worlds, complete histories,
16 supported omissions, authored protections and inherited regions. All 19
browser workflows and the production build pass; the temporary preview stopped.

The broad runs found three outdated test integrations: fabricated magic field
units, a removed serialized magic parameter, and direct invocation without the
common ledger commit. They now use registered output metadata, feature-owned
configuration and the common validity contracts. Magic-only publication tests
also pass their original snapshot, matching the editor, and verify retained
volcanic geography is unchanged. No dependency or publication checks were weakened.
Existing lint warnings and the build's large-bundle warning remain nonblocking.
