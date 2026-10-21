# Generation setup workflow

Planning date: 2026-10-20. Engine baseline: `8deeeda`, pushed to `origin/main`.
Sulion plan: `20a0d5a5-6b61-444a-ba05-135bba1608b7`.

## Outcome and authority

Replace the existing wizard with a compact cartographic workspace that guides a
creator through deciding what geography to generate, configuring each capability
where it is selected, understanding its dependencies and generating the reviewed
request. Initial world generation is primary. Creating a new region is a smaller
adaptation of the same workflow.

The user requested an actual workflow using the refactored traits and process
hierarchies. Their earlier corrections require coupled behavior to appear as one
option, controls beside the corresponding option, professional visual density,
and an understandable treatment of history and magic. These are requirements.
The stages, layout dimensions and presentation interfaces below are engineering
recommendations, subject to visual and behavioral evidence during implementation.

The user's subsequent request authorizes execution of all milestones. Browser
session memory, worker execution, authored protection and
atomic publication remain agreed boundaries. There is no server, persistence,
recovery, hosted presentation service or new generation algorithm in this work.
Existing-map replacement and selective regeneration redesign remain deferred.

The architecture contract is [generation modules](generation-modules.md). The
earlier [generation options plan](GENERATION-OPTIONS-PLAN.md) retains the rejected
UI implementation and completed engine migration as history. This plan supersedes
its UI recommendations. [ADR 0003](adr/0003-frontend-session.md) supersedes older
server-job requirements in the product specification.

## Sources and gaps at planning

Reviewed source bodies:

| Boundary                                                                                                                       | Reuse and required change                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GenerationWizard.tsx`, `GenerationProcesses.tsx`, `GenerationParameters.tsx`, `GenerationHistory.tsx`, `GenerationReview.tsx` | Current stages are World, Processes, Parameters, History and magic, Review. Selection still uses nine legacy aliases; settings and nested configuration live elsewhere. Review emphasizes invocation counts. Replace that organization.                                                              |
| `generationDraft.ts`, `generationRecipe.ts`                                                                                    | Drafts still originate as schema version 1 with flat parameters and process switches. Version 2 supports feature-owned settings/configuration. Normalize once at the boundary and use feature ownership for editing.                                                                                 |
| `features.ts`, `physicalFeatures.ts`, `domainFeatures.ts`, `atlasModules.ts`                                                   | There are 26 physical/shared features and six ecology, magic, human and built features. They own coupled operations, numeric schemas, nested configuration and prerequisites. Their metadata lacks a complete workflow hierarchy, explanatory copy and context-specific control availability.        |
| `processTraits.ts`, `process.ts`, `sequence.ts`, `productLedger.ts`                                                            | Operational traits, invocation ownership, nested epochs, required/produced/invalidated products and reconciliation declarations already exist. Project them for inspection; preserve their execution authority.                                                                                      |
| `atlasWorkflow.ts`, `featureDependencies.ts`, `generationJobs.ts`                                                              | Preparation supplies resolved settings and diagnostics, including conditional magical dependencies. Worker configuration is checked against the reviewed request. Use these results rather than maintaining UI dependency rules.                                                                     |
| `App.tsx`, `atlasState.ts`, `styles.css`, `generationWizard.css`                                                               | Setup occupies a welcome page with a decorative half-screen grid, 48px card padding and full-width form controls. The wizard adds a 62vh nested scrolling region. Give setup its own application workspace. `createWorldSnapshot` already supports a supplied world ID without installing a session. |
| `RegionalGeneration.tsx`, `traits.ts`, `areaConstraints.ts`                                                                    | Regional setup uses the same wizard, but hides geological options by their old group label. Actual engine contracts support local choices such as omitted impacts while retaining inherited history. Resolve availability from context; reuse effective spatial traits and boundary rules.           |
| `HistoryDraftEditor.tsx`, `MagicSystemsForm.tsx`, generation/browser tests                                                     | Existing field editors and tested operations are reusable. Their large combined forms need to be split by feature ownership. The human editor currently exposes compatibility-only settings that must not be presented as operative controls.                                                        |

Both user-supplied screenshots were inspected. They show separated erosion and
deposition choices, a bulk-disable workaround, long per-option paragraphs, and
numeric fields stretched across most of the screen. Those are specific design
failures to remove; changing colors or reducing outer margins alone is insufficient.

## Recommended interaction model

### Decisions and navigation

Use six navigable stages. Each stage has a concrete decision and an output summary.
Back, Next and direct navigation preserve the same draft. Defaults are usable;
after naming and sizing the world, a creator can go directly to Review and generate.
The rail distinguishes Defaults, Edited and Needs attention instead of forcing
every panel to be opened as a completion ritual.

| Stage                   | Creator decision                           | Main controls and resulting summary                                                                                                                                                                                                                       |
| ----------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| World                   | What am I creating?                        | Name, metric extent, seed, detail and starting configuration. Shared epoch names/order/durations are available here. Separate blank creation from procedural setup as an explicit starting choice.                                                        |
| Land and materials      | What constructs and reshapes the land?     | Foundation, tectonics, mountains, volcanism, impacts, material response, faults and landform outputs. Select and tune each capability together.                                                                                                           |
| Water, climate and life | What environmental systems should develop? | Ocean, climate, rivers, sediment, coasts, ice and ecology. Show the hierarchy and causal relationships between network, incision, transport and classification.                                                                                           |
| Magic and influences    | Which causal systems alter that geography? | Configured systems and existing located sources use the same feature-panel pattern, with source, propagation, effects and epoch activity together. Show actual affected geography and prerequisites.                                                      |
| People and places       | Which human geography should be produced?  | Cultures, political territories and built geography remain independent choices. Cultural duration/mobility and starting counts appear with their owners. World-scale built outputs are settlements and roads; finer profiles expose their actual layouts. |
| Review and generate     | What will this request produce?            | Resolved choices, departures from defaults, expected output layers, history and inherited restrictions, unresolved diagnostics and direct links back to controls. Launch the exact reviewed request.                                                      |

These stages organize decisions, not the generator's execution order. Magic and
ecology participate within physical epochs. Do not depict execution as completing
all geology, then all magic, simply because those controls occupy different stages.

### Workspace and density

Replace the setup-specific welcome layout with a full-height workspace using the
application's existing typography, native controls and visual conventions. Retain
the independent template-library flow. Avoid a new visual/component framework.

Proposed desktop structure:

```text
New world / Regional context                  Seed · Detail
──────────────────────────────────────────────────────────
Stage rail       Capability hierarchy and controls   Summary
World            Rivers                             Outputs
Land             ☑ River networks                   Changes
Water…             ☐ River incision                 Issues
Magic…                 Strength [1.0] ×             Edit links
People…             ☑ Floodplains
Review              ☑ Deltas
                 Requires: water balance · transport
──────────────────────────────────────────────────────────
Cancel                         Back       Next / Generate
```

Begin with a 176–200px rail, flexible main pane and optional 260–300px summary at
large desktop sizes. Use roughly 8–16px internal gaps and 16–24px outer gutters;
these are starting values to inspect, not acceptance thresholds. Put labels,
appropriately sized controls and units on compact rows. Keep critical dependency
messages visible; disclose extended explanation and execution details on demand.

Use one main content scroll region with a stable header and action bar. Avoid
nested fieldset scroll areas and viewport-height caps inside the welcome card.
At narrower widths collapse the summary and then the rail while keeping all
controls, navigation, focus indicators and actions reachable. Density must preserve
readable text, usable pointer targets and keyboard operation.

### Capabilities, ownership and traits

The primary hierarchy is **stage → geographic family → generation feature**.
An expanded feature contains its switch, owned settings, nested configuration,
outputs and dependencies. Processes are subordinate implementation details.

Separate the presentation tree from the dependency graph. Water balance is a
shared prerequisite for several capabilities; it must not be duplicated as
independent switches under rivers and glaciers. Link to its single owning panel.
Every registered feature is accounted for as a choice, shared provider or
context-inapplicable capability with an explanation. Never infer Required from
missing presentation metadata.

Proposed feature placement, covering all 32 current feature identities:

| Stage / family                    | Feature IDs                                                                                                                                    | Controls or explanation                                                                                                                                          |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| World / shared time               | `physical.lifecycle`                                                                                                                           | Epoch identity/order/duration; structural validation explained as part of producing valid geography.                                                             |
| Land / continental construction   | `physical.foundation`, `physical.tectonic-history`, `physical.mountains`                                                                       | Crust assemblies, provinces, starting crust fraction, drift and epoch tectonic strength, beside their owning choices.                                            |
| Land / event geography            | `physical.volcanism`, `physical.impacts`                                                                                                       | Volcanic roots/construction as one feature; impact budget and size; relevant epoch modulation.                                                                   |
| Land / material response          | `physical.hillslopes`, `material.load-response`                                                                                                | Separate capabilities with their actual shared material and load dependencies. No invented parameters where none exist.                                          |
| Land / structure and relief       | `physical.coastal-construction`, `physical.fractures`, `physical.geothermal`, `physical.landforms`                                             | Distinguish initial coast construction, optional fault network, geothermal output and landform classification.                                                   |
| Water / ocean and shores          | `ocean.geography`, `physical.ocean-circulation`, `physical.continental-margins`, `physical.coastal-evolution`                                  | Ocean/bathymetry, circulation, coupled margin/deposits, coupled natural/external coastal evolution.                                                              |
| Water / climate                   | `physical.climate`                                                                                                                             | Baseline temperature, rainfall and sea-level controls plus correctly labeled epoch modulation.                                                                   |
| Water / river systems             | `water.routing`, `physical.river-networks`, `physical.river-incision`, `material.fluvial-transport`, `physical.floodplains`, `physical.deltas` | Shared water balance, network output, optional incision and sediment-dependent outputs are related choices with distinct semantics.                              |
| Water / ice                       | `physical.land-ice`, `physical.glacial-sculpting`, `physical.sea-ice`                                                                          | Land ice/meltwater; one sculpting choice for erosion, deposition and glacial relief; sea ice separately.                                                         |
| Life / ecology                    | `ecology.living`                                                                                                                               | Vegetation/grazing controls and ecological regimes for the shared epochs.                                                                                        |
| Magic / influences                | `magic.configured`, `magic.local`                                                                                                              | Configured systems/activity and the sources actually available in this setup. A new world without placed sources says so; it does not imply they were generated. |
| People / distributions and places | `human.cultures`, `human.politics`, `built.layout`                                                                                             | Independent culture/polity controls, operative cultural eras and profile-appropriate built output.                                                               |

Glacial erosion/deposition/relief, volcanic roots/construction, margin evolution/
marine deposition and external/natural coastal change each remain one coupled
choice. River networks and incision remain distinct. There is no bulk-disable
button compensating for an incorrectly split feature.

Use operational traits to explain what a choice does, not as top-level menus:

| Process behavior        | Useful presentation                                                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Initialize              | Initial conditions and shared inputs established for the chosen capability.                                                              |
| Model pass              | Repeated causal responses; repeated ice passes do not imply additional elapsed years.                                                    |
| Elapsed                 | Actual bound duration and epoch fraction. Ecology's two half-epoch responses and present classification retain their different meanings. |
| Material transformation | Inputs, redistributed material and declared balance checks.                                                                              |
| Forcing contributor     | What supplies a forcing and which physical response consumes it.                                                                         |
| Transfer                | Inherited geography and declared reconciliation, primarily in region context.                                                            |
| Extract                 | Delivered fields, geographic objects and networks, separated from simulation work.                                                       |

Provide a secondary execution inspector using the real sequence: phase/epoch,
owned invocation, behavior, inputs/outputs and bound duration. Preserve actual
order and occurrence identity. Summarize repeated passes without losing the
individual occurrences. Remove the undifferentiated support-process counter.

Domain spatial traits are a different contract. Show effective hard constraints,
tendencies and scoped exceptions in the relevant context, with inherited sources.
Derived traits describe results; they are not editable generation intentions.
Do not invent a generic mapping from labels such as Cold to arbitrary parameters,
or expand this task into a new trait-authoring subsystem.

### Dependencies and edits

Keep `prepareAtlasGeneration` and its diagnostics authoritative. The presentation
may traverse declared feature prerequisites to offer an explicit **Enable required
features** action listing its changes. Reprepare every proposed change; conditional
magic requirements still come from the engine rather than a second UI ruleset.

Switching a feature off changes that feature. Preserve its configured values for
re-enabling. If selected dependents become invalid, show the affected choices next
to it, mark the relevant stages and provide links or explicit repair actions.
Do not silently disable unrelated features, change magical effects, or enable a
feature again behind the creator's back. Repairs are ordinary editing actions;
there is no separate approval workflow.

For example, turning off coastal evolution while Pressure has nonzero coastal
forcing points to that system's effect control and offers enabling coastal
evolution. Zero coastal forcing is valid. Turning off glacial sculpting leaves
land ice as its independent choice. Turning off floodplains identifies enabled
deltas as a dependent choice.

Numeric fields support temporary invalid text and report local errors without
coercing an empty field to zero. Review cannot launch a stale last-valid value
while an invalid edit is displayed. Warnings remain visible and nonblocking;
errors block generation. Cross-stage diagnostics allow navigation to their repair.

### One history, with controls at their owners

History is shared temporal input, not another generation domain. Maintain one
epoch list under `physical.lifecycle.configuration`. Expose its compact timeline
from World and the feature stages. The timeline edits names, order and duration;
epoch-specific tectonic, climatic, ecological and magical values appear within
their owning feature panels using that same selected epoch.

Physical epoch fields remain owned by `physical.lifecycle.configuration`; the
related physical panels edit those shared fields through linked views. They do
not create additional feature-local copies of the physical clock configuration.

Ecology owns its per-epoch regimes; configured magic owns systems and activity;
cultures own their operative eras. A structural epoch edit must update those
keyed configurations together: rename preserves associated settings, insertion
uses declared defaults, deletion removes orphan keys and reorder preserves values.
Retain existing epoch identity/seed semantics; do not add a new chronology model.

Magic is another causal feature family. It uses the same selection, parameter,
dependency and output presentation as physical and human capabilities, with
specialized editors for its richer configuration. It is not a separate kind of
execution. Existing system/rule editors can supply fields without dictating the
workflow layout. Legacy human `physicalEpoch` and `politicalCapacity` remain
inspectable compatibility metadata with warnings, not operative setup controls.

## Presentation and draft architecture

Add the smallest missing bridge between registered engine capabilities and React:

- Module-owned, React-independent descriptive metadata for family placement,
  explanatory summary and ordering. Reuse feature labels, numeric definitions,
  process ownership and publication descriptors. Add narrowly typed applicability
  information only where current profile/context composition cannot explain it.
- A read-only setup projection combining those definitions with the prepared
  request, actual invocations/behaviors, diagnostics and output bindings. It can
  explain Selected, Off, Needed by another choice, Inherited and Unavailable here.
  Needed is contextual; it is not a permanent classification of a process.
- Reusable feature panels for scalar controls and bounded, explicitly registered
  editors for lifecycle, ecology, magical systems and cultural eras. A new scalar
  feature gets a complete panel without editing a central switch list. Rich new
  configuration may register a specialized editor; arbitrary Zod form generation
  and a configurable workflow interpreter are unnecessary.

The draft edits version 2 feature selections and owned values. Flat parameters,
legacy settings and process switches remain boundary compatibility inputs where
the existing recipe schema requires them; they are not independently editable
authorities. Normalize imports through the existing resolver, show conflicts, and
export the current resolved values. The advanced JSON editor refreshes from the
current draft and applies atomically without starting generation or losing text
edits on an unrelated rerender.

Keep a stable unregistered draft world identity and build its snapshot through
`createWorldSnapshot`. Review and creation must use that same source identity and
resolved settings; the current placeholder-preview/new-random-world split must
not create a second configuration. Register the selected world only on Create or
Generate using the existing session mechanism. Cancel drops the draft. A draft
edit invalidates its prepared review, and Generate sends the current prepared
configuration through the existing worker validation. No saved draft store or
execution recovery is introduced.

This is primarily frontend work. Generation-module changes describe existing
ownership and applicability; they do not change numerical kernels or replace
the executor. Keep changes to shared schemas proportionate to these concrete gaps.

## Review and new-region adaptation

Review uses resolved configuration, not the draft's legacy parameter table.
Show selected geographic capabilities and changed values with units, disabled
deliveries, history and output layers. Each item links to its editor. Keep raw
process/fact details behind the execution inspector. Generation choices remain
separate from map-layer visibility controls.

Display detail/sampling information already supported by the engine and measurable
workload context such as epoch count. Do not fabricate completion times or an
uncomputed map preview. During generation, use real progress events and their
feature/epoch ownership; retain existing cancellation, conflict and publication
behavior.

For a new region, reuse the workspace with a context header showing extent,
parent, effective traits and fixed crossings. Completed world history and system
definitions are inherited; show their meaningful summary rather than entire
disabled forms. Resolve local capability availability from the actual profile
and inputs. Do not blanket-hide Geology: show inherited event history and the
local operations that actually run. Inherited construction values that a local operation
does not consume must not look editable. The already-created region keeps its
identity when setup is cancelled; no job starts until Generate region.

## Milestones and acceptance

### M0 — Feature presentation and canonical draft

Inventory every current feature, setting and nested configuration against actual
consumers. Establish descriptive metadata, context projection, v2 normalization,
stable draft identity and diagnostic ownership. Identify which settings have a
meaningful effect in initial and inherited modes before exposing them.

Acceptance: all 32 registered features are accounted for; coupled groups have one
identity; a separately registered scalar feature appears with its settings,
prerequisites and outputs without central alias edits. Imported legacy requests
retain effective behavior, and toggling a feature preserves its owned values.
Review/launch use one draft source and configuration. Evidence: focused projection,
normalization and worker-input tests, not another numerical parity project.

### M1 — Compact world and physical workflow [depends on M0]

Implement the workspace, stage navigation, World/blank entry, feature hierarchy and
co-located physical/ecological scalar controls. Wire dependency explanations and
explicit repair actions. Replace the decorative setup layout and the separate
Processes/Parameters pages; preserve unrelated map and library styling.

Acceptance: configure a world with rivers enabled and incision disabled, glacial
sculpting selected as one choice, and modified volcanic strength without visiting
a parameter warehouse. Back/direct navigation preserves edits; default settings
can proceed directly to Review. Inspect real desktop and narrow layouts with the
default and expanded capability panels. Density and discoverability require visual
judgment; passing click tests alone does not establish an acceptable design.

### M2 — Shared history and causal influences [depends on M0, M1]

Integrate the common timeline, feature-owned epoch controls, configured magic,
available located sources and independent human/built choices. Reuse and split
the current nested editors. Add trait-derived explanations and execution inspection.

Acceptance: a duration edit is visible wherever that epoch is used; rename,
insert, delete and reorder preserve correct feature bindings. A Pressure/coast
conflict links to the actual effect and target controls, and zero forcing is
accepted. Cultures and politics remain independent. Unsupported human metadata
is not offered as operative simulation. Present ecology adds no biological age;
repeated model passes do not masquerade as elapsed history.

### M3 — Review, generation and new-region integration [depends on M1, M2]

Replace review with resolved geographic outcomes and edit links, wire the prepared
request to creation/generation, and adapt new-region setup to inherited context.
Migrate JSON editing/import and retire legacy wizard-only aliases/helpers and
duplicate controls once their remaining callers are accounted for. Existing-map
generation retains its behavior; use shared field components where appropriate
without expanding this into its workflow redesign.

Acceptance: JSON and form edits round-trip without conflicting authorities;
reviewed values equal worker inputs; an error blocks launch and a warning does
not. Cancelling new-world setup creates no world or job. A generated parent/new
region retains its boundary and completed history while allowing supported local
choices. Cancellation and edits made during generation retain their existing
semantics. No field family disappears merely because an old page was retired.

### M4 — Workflow and geographic acceptance [depends on M3]

Exercise complete new-world decisions, defaults, dependency repair, invalid local
input, JSON changes, region setup and worker publication. Inspect desktop, narrow
and keyboard operation, including long histories and magical-system definitions.
Verify an added module appears through the common presentation interface.

Use focused behavior tests and browser journeys tied to the decisions above,
representative actual generation for changed request shapes, repository-required
checks and the production build. Reuse existing engine tests for unchanged
mechanisms. Retain useful images in ignored local test artifacts; create no
separate verification report. Record material visual findings and final evidence
in this working plan when implementation occurs.

## Sulion mapping and current state

| Milestone                                          | Phase ID                               | State    |
| -------------------------------------------------- | -------------------------------------- | -------- |
| D0 — Workflow design                               | `3742fd58-8ae5-4ce7-82a1-8714c03dff4d` | Complete |
| M0 — Feature presentation and canonical draft      | `c05f38f2-4801-4ca5-848b-cbfab8927fb7` | Complete |
| M1 — Compact world and physical workflow           | `cc84e287-2d77-4c48-9783-f2e8c241b89e` | Complete |
| M2 — Shared history and causal influences          | `b81168d1-70aa-447d-ab82-7ccc6c8672bd` | Complete |
| M3 — Review, generation and new-region integration | `94f64ea8-6398-4804-bf80-bdcfb987b084` | Complete |
| M4 — Workflow and geographic acceptance            | `f648ed1a-b141-4f47-89e5-b7b0c904c1e8` | Complete |

All milestones are complete locally. The workflow uses registered capabilities,
owned settings and actual process traits, with shared chronology and contextual
regional controls. Implementation includes the consumer corrections and rendered
layout changes recorded below. Changes are not committed or pushed by this
execution; the earlier engine baseline remains `8deeeda`.

## M0 execution expansion

Expansion `28dcf2a2-75a2-416c-ade3-ad9ff75fe869` establishes the shared inputs to
the workflow before the React layout replaces its consumers.

1. Registered capability presentation (`aecbc5c2-63ff-4944-93b3-1eff1ebe80da`):
   extend module-owned feature descriptions and project the actual prepared
   configuration into hierarchy, availability, dependency and trait inspection
   data. Cover extension discovery and real conditional dependencies.
2. Canonical draft and temporal ownership (`e3703d20-ed66-45a5-bc03-2d1dbd7b3085`):
   normalize version 1/2 input, preserve feature values and draft world identity,
   update keyed epoch configuration atomically, and reuse session installation
   for the exact prepared source. Keep these helpers independent of React.
3. Foundation integration checks (`7b2427c2-fe61-44ef-9b63-fe031efd6dc8`):
   check the new projection and normalization against actual preparation and
   worker contracts, including coupled choices, imported compatibility values,
   renames and a registered extension. Run focused checks and type/lint gates.

The existing engine and browser checks at `8deeeda` are the baseline. The primary
agent owns workflow integration; bounded work on presentation, canonical drafts
and independent browser review has separate file ownership. No numerical kernel
changes are planned.

Source correction during M0: the regional sequence does not run impact, volcanic
or mountain construction again. The earlier local-impact example established
retention when its local writer was disabled, not an active local constructor.
The presentation will explain inherited history and disable inoperative controls;
this UI refactor will not add construction algorithms. The canonical draft also
needs transient invalid-number state shared by rich and scalar editors, because
their previous `Number("")` conversion silently supplied zero. That field state
belongs to M0's input foundation and is verified through browser consumers later.

M0 is complete: six capability projection tests, 15 canonical draft/epoch tests
and five field-state tests pass, along with relevant typechecks and lint. A short
20-test engine composition/trait/projection bundle also passes. The prepared
source identity is now used when installing a new world and starting its worker.

## M1 execution expansion

Expansion `ee973aab-9996-4e39-8ba7-f7ef56b4635b`:

1. Workspace and navigation (`64805c98-6b16-442c-b0d4-ca3037d29f32`): replace the
   setup welcome layout, add six navigable stages, compact world/blank controls
   and stable actions. Keep rich editors and final review migration in M2/M3.
2. Capability decisions and repair (`90577a36-bffb-40d2-aa9c-e4dcbfedc855`): render
   the registered hierarchy with feature-owned scalar controls, retained off
   values, contextual provider links and explicit dependency repair. No UI
   execution switches or hidden parameter page remains in the new flow.
3. Workflow integration checks (`518ad842-17a3-46eb-9328-d49fc03e2157`): exercise
   direct/back navigation, coupled controls, modified scalar values and invalid
   field retention. Inspect actual desktop and narrow rendering; completion
   depends on that evidence rather than CSS declarations alone.

M1 is complete. Three browser journeys pass after desktop and narrow inspection
and corrections to control widths, disclosure density and summary alignment.
Blank creation builds world data independently of generation preflight. Detail
sample counts sit beside the selector so option names remain readable.

## M2 execution expansion

Expansion `494e0c3d-d6db-40b2-9ac9-c9146364c274`:

1. Shared chronology and feature configuration: one selected epoch and structural
   editor use the existing atomic draft helpers. Feature panels edit linked
   physical values and owned ecology values; invalid text remains visible.
2. Causal systems and human geography: configured magic and activity reuse the
   numeric-safe editors. Located sources remain honest about available inputs.
   Human eras expose operative controls and disclose compatibility metadata.
3. Execution inspection and integration: secondary inspection uses actual
   invocation traits, conditional scheduling, elapsed duration and reconciliation
   declarations. Browser checks exercise cross-stage chronology and causal repair.

Consumer review refined linked views for tectonic, hydrological and glacial
strengths and sea level at their actual consuming features. Mountain construction,
for example, consumes tectonic strength even when plate evolution is off. Epoch rainfall is stored
in the existing ecology regime but scales physical precipitation independently of
living ecology; its operative control therefore lives with climate, retains the
single underlying value, and explains that behavior. These are presentation and
parameter-visibility corrections, with no numerical kernel changes.

The same consumer audit places shared scalar controls through projected
`owner` and `controlFeature` descriptors. Sea-level baseline remains compatible
with its existing configuration owner but appears with Ocean geography, whose
constructor actually consumes it, even if climate is off. No second value is
introduced. Shared epoch strengths similarly appear beside their actual
consumers, using one raw field buffer and the same clock value.

## M3 execution expansion

Expansion `53e3d35d-438f-43e7-97e3-4008ccccc894`:

1. Resolved outcomes and JSON: replace invocation-count review with geographic
   choices, operative values, owned configuration summaries and editor links.
   JSON refreshes from the current normalized draft, retains unapplied text across
   navigation, applies atomically, and blocks launching a different last-valid draft.
2. Generation and regional workspace: retain reviewed source/configuration on
   launch. Reuse the workspace in a native modal with inherited context, effective
   spatial traits and fixed crossings; cancellation keeps the created region.
3. Retire superseded wizard and integration: check remaining references before
   removing old wizard-only pages. Exercise imports, launch identity, cancellation
   and scoped regional controls without changing existing-map editing workflows.

## M4 execution expansion

Expansion `6586e13a-d5e4-4832-b592-bb2e82aa7af4`.
Acceptance proceeds alongside the final M2/M3 integration fixes. Browser checks
cover completed initial-world choices, explicit repairs, invalid numeric/name
text, atomic JSON, warnings, independent human geography and inherited regional
setup. Actual generation checks a changed feature-owned world recipe and a child
region with the same completed history and fixed boundary. Repository CI,
production build, all browser journeys and independent source/rendered reviews
complete the remaining checks. Concrete failures are fixed in their owning
milestone before closure; no separate verification report is created.

Repository CI passes with 428 tests, workspace type checks, lint, formatting and
Terraform formatting. Two pre-existing lint warnings remain in `magicSystems.ts`
and `TemplateDrawing.tsx`. A representative actual generation test passes using
a modified feature-owned world recipe and subsequent region refinement, retaining
the completed epochs and fixed boundary; it took 57.5 seconds in this run.

Independent review corrected source/propagation parameter visibility, shared
physical consumers, orphan field buffers after structural edits, and actual
nested-value summaries in Review. Desktop and narrow inspection also removed
repeated inactive explanations and sparse grid rows. Numeric/code inputs now
keep stable accessible names when their described errors appear.

Browser acceptance covers all 34 journeys: the full run passed 32 and exposed
two unstable accessible-label failures; the final focused rebuild passed all
10 cases, including both corrected failures. Existing editor/atlas authoring
journeys passed, as did new shared-history, causal repair, JSON authority,
independent feature, inherited-context and cancellation checks. Production builds
pass. Final desktop/narrow Review, execution inspection, long-history keyboard
navigation, physical controls and regional layouts were inspected. Local images
remain in ignored `frontend/test-results/artifacts/`; temporary preview servers
are stopped. Final formatting, type and diff checks pass.
