# Generation contract consolidation

Execution authorized by the user's 2026-10-21 request to plan and address the
interface review at `55cc813`. Sulion root: `7eaba1d5-206e-40cb-8e14-da20be8ce5bb`.
This follows the completed implementation plans in
[generation options](GENERATION-OPTIONS-PLAN.md) and
[generation workflow](GENERATION-WORKFLOW-PLAN.md); it corrects their overstated
architectural completion claims. Their historical execution notes remain history.

## Outcome and boundaries

Delivered capabilities own their configuration, causal contributions, conditional
requirements and products through stable interfaces. Initial-world generation is
primary; region generation reuses those interfaces with inherited inputs. Fix the
review's correctness defects and make a stateful extension demonstrate the actual
contract. Local implementation and validation are authorized. The user's
subsequent 2026-10-21 request also authorizes commit and push on the current
branch. Deployment is not requested.

User requirements come from the current request and preceding corrections:
feature-oriented traits and ownership, coupled operations selected together,
parameters edited with their capability, and trustworthy dependencies. Browser
memory, the existing Web Worker, authored protection, atomic publication and
Canonry's causal order remain agreed boundaries. No service, persistence,
recovery, graph compiler, new wizard layout or existing-map replacement project.

Implementation choices below are engineering decisions, not additional user
requirements. Keep native adapters for actual physical semantics. Remove dead
contract promises rather than building unnecessary mechanisms to support them.

## Evidence and disposition

The review read the runner, product ledger, module/feature registry, atlas
composition, magic lifecycle/publication and frontend configuration adapters.
Focused probes reproduced four backend counterexamples. The default registry has
82 executable behaviors; all 32 builtin features lack feature-level `deliveries`.
The inventories are grouped policies, not a total bug count: 14 central engine
integration cases, 26 native physical adapter policies, four core compatibility
mechanisms and a partly overlapping inventory of 40 frontend rules.

| Finding                                                                                           | Planned disposition                                                                                                                                    |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Forcing-only projection declares absent flow/drainage                                             | Declare actual outputs for each invocation and test channel/fact agreement.                                                                            |
| Exclusive process products can have competing providers                                           | Check distinct process providers from resolved process contracts; allow repeat invocations of the same provider.                                       |
| Freshness is advertised but unused                                                                | Use existing separate retained product identities; remove unused freshness vocabulary unless a current consumer establishes another requirement.       |
| Async material balance completes late                                                             | Await asynchronous balance through the behavior interface and test failure propagation.                                                                |
| Legacy apply escape path; native fact bridge; deferred whole-map validation; retained empty facts | Remove unused execution compatibility where feasible; preserve the other mechanisms with explicit tested semantics, not a blanket abstraction rewrite. |
| Unknown slots and contributions outside feature ownership                                         | Validate against explicit supported slots and registered owned processes.                                                                              |
| Ecology/configured/local magic bypass contributions                                               | Put actual contributions at explicit existing causal positions, owned by their feature. Preserve exact order and elapsed semantics.                    |
| Central nested configuration dispatch and settings mutation                                       | Bind configuration through the owning feature; constrain compatibility adapters to their declared settings fields.                                     |
| Magic dependencies skip active rules in disabled containers                                       | Discover dependencies from the same effective operations/rules used during execution.                                                                  |
| Coastal/ecological dependency patches and field routing                                           | Feature-owned conditional requirements include editable configuration paths; projection carries diagnostic field references.                           |
| Fixed magic strategy dispatch and duplicated requirements                                         | Keep actual algorithm choices; colocate strategy requirements and parameter applicability with strategy metadata.                                      |
| Magic quantity/lifetime inferred in several adapters                                              | Declare channel semantics once and reuse in state transfer, projection, remeshing and publication.                                                     |
| Rich editor/review dispatch; three fixed epoch participants                                       | Register frontend adapters once; feature metadata declares shared-epoch participation and configuration applicability.                                 |
| Invalid nested edits freeze controls                                                              | Draft selection remains authoritative while preparation is invalid; execution stays blocked until valid.                                               |
| Hidden raw fields retain invisible blocking errors                                                | Reconcile temporary buffers with declared field applicability when choices change.                                                                     |
| Located effects advertised without physical consumers                                             | Inspect actual consumers and align supported authoring with implemented semantics; do not claim generic intensity is a physical effect.                |
| Extension tests only prove established-slot scalar work                                           | Exercise carried state over epochs, a new output and actual worker execution; keep deliberate new causal phases as a profile change.                   |

## Reuse and assumptions

`process.ts`, `processTraits.ts`, `productLedger.ts`, `preflight.ts` and
`mapRunner.ts` remain execution authority. `features.ts`, `generationModules.ts`
and `atlasModules.ts` remain registration/configuration authority. Domain
algorithms remain in their current generation modules. Publication remains
descriptor-driven. Frontend specialized forms remain, behind one adapter boundary.
No React dependency enters domain/generation modules.

Assumptions to check: existing causal positions can express current special
schedulers; explicit retained product identities suffice for freshness; shared
epoch operations can preserve arbitrary extra feature configuration. Read the
local Canonry pipeline/session bodies before changing composition.

## Milestones

### M0 — reliable execution contracts

Correct output declarations, competing-provider validation, behavior completion
and contribution registration. Acceptance: the four contract counterexamples
fail safely or produce correct products; repeat invocation remains legal;
existing generation sequences preflight. Files: core contracts/runner/preflight,
projection adapter and focused tests. Evidence: meaningful regression tests and
existing ledger/sequence/module tests. No numerical algorithm rewrite.

### M1 — feature-owned integration

Move configuration binding, conditional requirements and ecology/magic causal
contributions into their owning interfaces. Consolidate magic strategy and field
metadata. Acceptance: the central sequence no longer schedules those capabilities
by identity; disabled-container dependencies are correct; state/quantity metadata
has one authority; existing causal ordering and feedback remain intact.
Depends on M0 for final integration, but independent implementation can overlap.

### M2 — registered configuration workflow

Register rich editor, summary, field and epoch adapters. Preserve edits on invalid
preparation, clean hidden raw errors, and use declared applicability. Acceptance:
a new nested epoch participant needs no central dispatch edits; custom properties
survive clock changes; invalid fields cannot freeze unrelated controls or leave
unreachable blocking errors. No visual redesign. Implementation can overlap M1
through agreed interfaces; final integration depends on M1.

### M3 — extension and geographic acceptance

After M0–M2, exercise a stateful module through the runner and real worker boundary,
plus representative initial world and inherited region generation. Run repository
gates and relevant browser regressions. Update `generation-modules.md` and affected
existing architecture documentation to describe actual guarantees and remaining
deliberate boundaries. Final review checks all dispositions above. Do not create
a separate verification report.

## Current state

M0–M3 are complete locally. Final CI passed 469 tests across 80 suites plus lint,
formatting, workspace typechecks and Terraform formatting. Seventeen related
browser journeys passed. Two actual initial-world/regional generation checks
passed, including completed-history/boundary preservation and inherited impact
history when the local impact feature is off. A separately bundled production
worker executed and published the new two-epoch extensive inventory. No blockers
or user decisions remain. Commit and push are authorized by the follow-up request.

## M0–M2 execution expansion

Expansion Sulion: `31b6e92c-fb54-415e-8176-9eae43086459`, steps 1–3.

These milestones share an integration boundary, expanded together because the
implementation tasks can run independently before a shared verification gate.

1. Reliable products and behavior completion (M0).
   - Files: process behaviors, ledger/preflight/runner, atlas projection and tests.
   - Change: correct actual projected outputs; check distinct exclusive providers;
     await balance; remove dead freshness vocabulary and unused legacy execution.
   - Verify: focused counterexample regressions plus existing contract tests.
2. Feature ownership and causal composition (M1; integrates #1).
   - Files: feature/module interfaces, atlas composition, magic dependencies,
     strategies, fields and their tests.
   - Change: explicit supported contribution slots/context, owned configuration
     binding, effective-operation dependency discovery and field metadata reuse.
     Preserve the numerical order and actual state transformations.
   - Verify: sequence characterization, missing-dependency regression, configuration
     ownership and magic state/quantity tests.
3. Registered configuration and valid drafts (M2; integrates #2).
   - Files: setup projection and frontend adapters/forms/workflow tests.
   - Change: register specialized editor/summary/epoch behavior together; consume
     projected applicability and field references; keep draft controls responsive
     while invalid and reconcile hidden raw fields.
   - Verify: nested epoch extension and raw-field regression checks, then focused
     browser workflows at the shared integration gate.

Steps remain unfinished until their focused checks and shared type integration
pass. Root owns composition and plan/docs; separate agents own core execution,
magic internals and frontend adapters. File boundaries are coordinated explicitly.

### Implementation decisions and evidence

- Feature-owned contributions preserve the reference order; physical refinement
  hooks and physical gating now belong to their delivering features as well.
  Independent review found no ordering/version blocker. The registry validates
  known slots and declared process membership.
- Process contracts are the single provider authority. Removed the unused
  feature-level deliveries list, unused freshness vocabulary and legacy apply
  path. Four native products were corrected to shared-state after inspecting
  their actual multiple writers. Core regression suites passed.
- Configuration patches are cloned and constrained to declared top-level or
  per-epoch fields. Shared-epoch adapters cannot replace physical clock values;
  an explicit regression checks this boundary. Numerical operations remain
  trusted callbacks over shared state; this is not a capability sandbox.
- Located source effects with no physical consumer retain their data and current
  intensity output, with explicit metadata/warnings. Inventing new gravity,
  uplift or fertility algorithms would exceed this architecture repair.
- A separately bundled worker executed the complete two-epoch recipe with a new
  registered extensive inventory and published its layer. The production handler
  runs in a separate realm through a Node messaging bridge; browser behavior is
  separately checked through the existing Playwright workflows.
- Initial full CI found selection-only callers being forced to bind history,
  an outdated native-only inventory assertion and a frontend test importing an
  undeclared dependency. These were corrected; the affected 45-test subset
  passed. Independent review also found aggregate-clock and cultural-field
  navigation issues; their focused regressions and 17 rebuilt browser journeys
  passed. The final repository and geographic checks subsequently passed.

## M3 execution expansion

Expansion Sulion: `6278a3c4-aea0-4d5a-bfe4-87b86292356b`, steps 1–3.

1. Repository acceptance [depends on M0–M2].
   - Files: affected sources/tests and existing repository checks.
   - Change: correct only demonstrated integration regressions; finish formatting.
   - Verify: `make ci` on the final integrated source, preserving existing checks.
2. Geographic and worker acceptance [depends on M0–M2].
   - Files: existing geographic tests and the new stateful module/worker fixture.
   - Outcome: complete initial geography, carried extensive output and inherited
     regional history/boundary behavior use the same feature interfaces.
   - Verify: actual world/region generation tests, separately bundled production
     worker acceptance and the 17 related browser journeys already passed.
3. Architecture and final review [depends on #1, #2].
   - Files: `generation-modules.md`, this plan and affected prior plan pointers.
   - Change: document actual ownership, trusted-operation boundaries, metadata and
     extension steps; check each finding's disposition against source bodies.
   - Verify: source/diff/document review. No separate report artifact.

### Final evidence and limits

- `make ci`: passed, 469 tests / 80 suites; existing warnings in unchanged
  `magicSystems.ts` and `TemplateDrawing.tsx` remain nonblocking. A final workspace
  typecheck and focused projection check cover removal of obsolete legacy trait
  display vocabulary after the broad run.
- Playwright: 17 related Chromium journeys passed after rebuilding the app,
  including invalid-name switch responsiveness, hidden numeric-field cleanup,
  cartography, history, editing and wizard behavior. Temporary preview stopped.
- Actual geographic checks: `generationWorkflow.generation.test.ts` and
  `physicalRegional.generation.test.ts`, two tests passed. The first invocation
  unintentionally selected the entire expensive suite; test listing confirmed
  the CLI filter issue, that run was stopped and the two-file command corrected.
  No broad Standard/Fine comparison is claimed from the interrupted run.
- Stateful extension: module-only tests cover changed settings and disabling;
  separately bundled worker coverage executes the complete production recipe
  and real structured-clone messages across two epochs and publishes a new layer.
- Independent reviews checked causal order, versions, feature gating, draft
  preservation and diagnostic routing. The two routing defects found in review
  were fixed with focused regressions. `git diff --check` passes.
- Current architecture documentation describes trusted mutable numerical
  operations, deliberate profile extension for new phases, specialized forms
  registered once, and intensity-only located effects. The refactor does not
  claim to sandbox kernels or implement missing physical models.
