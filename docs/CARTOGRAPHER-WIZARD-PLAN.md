# Cartographer generation wizard

Planning date: 2026-10-21. Reviewed application baseline: `13be040`.
Sulion root: `776bc927-679a-4a4a-a19c-a04d1d4c0a5a`.

## Outcome, authority and previous failure

A cartographer describes the desired world through a curated, low-dimensional
set of geographic controls. Each meta-parameter composes existing feature
selections and settings into the existing generation recipe. The wizard helps
make those choices without requiring knowledge of the process registry or its
individual tuning parameters. Rearranging the existing forms is insufficient.
Initial generation is the primary journey. New-region creation is a smaller
adaptation after that journey works.

The user rejected the delivered interface three times and requested a plan and
accountability. The original request authorized planning; the subsequent request
to execute all phases authorizes local implementation and validation. Commit,
push and deployment are outside this execution request.

Execution update: the user's subsequent request to execute all phases authorizes
local implementation and validation of this revised plan. Commit/push and
deployment are not requested. The earlier planning-only statements record the
previous boundary and no longer block implementation.

The [previous workflow plan](GENERATION-WORKFLOW-PLAN.md) already promised most of
these outcomes. Its completion claim did not establish them. The implementation
renders a registry catalogue inside staged navigation, then treats successful
form editing and submission as proof of a cartographic workflow. This plan
replaces its interaction design and product acceptance claim. Preserve useful
engine work documented in [generation modules](generation-modules.md) and the
[contract consolidation](GENERATION-CONTRACTS-PLAN.md).

Browser memory, one canonical recipe, the existing worker, deterministic causal
execution, authored protection and atomic publication remain boundaries. No new
numerical algorithms, persistence, recovery, workflow interpreter or existing-map
replacement project is proposed. The concurrent `CLIMATE-PLAN.md` is separate
work; integrate its actual supported controls if it lands, without taking over
its algorithms or claiming them complete.

**Scope correction:** The user's coastline descriptions illustrate the level of
abstraction, not requested coastline settings, a prescribed first proving case,
or authorization to add generators. Do not turn example words into algorithm
requirements. Curate the controls from existing capabilities. A desired meaning
that existing controls cannot support is a documented limitation, not an
instruction to invent its implementation.

## Requirements and evidence

User requirements come from the initial-generation request and subsequent
corrections in this conversation:

- Guide creation of a new world; give new regions secondary attention.
- Reduce the cardinality of user decisions through curated meta-parameters that
  compose existing settings and feature choices. Dynamically discover suitable
  definitions from registered features where useful; do not generate the primary
  interface from every low-level parameter.
- Present inseparable operations as one option. Preserve independent choices
  where they produce different useful behavior.
- Put enablement and operative parameters together. Processes are organized
  around delivered features through the existing common contracts and traits.
- Use a professional cartographic application layout with useful density.
- Make dependencies understandable without making the user assemble support
  processes. History and magic use the same causal configuration foundation.
- Remove unnecessary display attributes and the obsolete presentation machinery
  that produces them. Hiding, renaming or parking them in advanced UI does not
  satisfy this requirement.
- Repair the current Firefox history/JSON CI failures with normal tracing,
  existing timeouts and meaningful behavior assertions retained.
- Deliver an actual wizard and demonstrate that it satisfies these requirements.

The following bodies were reviewed for this plan. Older documents establish
intent; current code establishes implementation. No claim of a new engine audit
or complete review of the product specification is made.

| Source                                                                                         | Reviewed scope and implication                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `product-spec.md`                                                                              | Sections 1–2, 10–11, 13 and the creation-flow requirements in 4.3: geographically coherent creation, independent domains, causal history and useful generation status. ADR 0003 supersedes service and persistence requirements.                       |
| `GENERATION-WORKFLOW-PLAN.md`                                                                  | Entire plan, including its implementation and acceptance notes. Professional layout and visual inspection were already promised; repeating them without a different acceptance method is insufficient.                                                 |
| `GENERATION-CONTRACTS-PLAN.md`, `generation-modules.md`                                        | Entire documents: retain feature ownership, declared dependencies, registered configuration adapters, process traits and the exact prepared request.                                                                                                   |
| `GENERATION-OPTIONS-PLAN.md`                                                                   | Opening requirements and supersession notices, lines 1–70. Earlier backend redesign and execution sections were not reassessed here.                                                                                                                   |
| `GenerationWizard.tsx`, `GenerationFeaturePanel.tsx`, `generationWorkflowPresentation.ts`      | Navigation currently filters features by stage and maps each into the same panel; every panel exposes its own toggle, status and dependencies. Replace this as the primary layout.                                                                     |
| `GenerationWorldStep.tsx`, `generationStartingPoint.ts`, `atlasParameters.ts`                  | Existing extents, sampling, seeds and parameter presets are reusable. Crust fraction is an initial condition, not a guaranteed final land percentage. Presets change specific controls, not every aspect of a world.                                   |
| `GenerationReview.tsx`, `GenerationExecutionInspector.tsx`, `useGenerationWorkflow.ts`         | Review repeats feature data and eagerly mounts execution details. Preserve the prepared draft and launch identity; replace the presentation and defer hidden content.                                                                                  |
| `generationPresentation.ts`, `physicalFeatures.ts`, `domainFeatures.ts`                        | All 32 builtin capability identities and their current settings/contributions. The engine's presentation categories must not dictate the wizard's page composition.                                                                                    |
| `GenerationTimeline.tsx`, epoch/culture/magic configuration components, `MagicSystemsForm.tsx` | Reuse clock bindings, field buffers and rich editors. The magic form currently exposes source, propagation, phase and many effect fields together; inspect its subordinate controls when adapting each section.                                        |
| Existing CI screenshots                                                                        | Inspected environment and magic desktop images from run `39518949013`, at `55cc813`. They show the catalogue and oversized system form; these are historical images, not a fresh rendering of `13be040`. Current source retains that layout structure. |

Current CI at `13be040` failed in Firefox: two 120-second history/JSON timeouts,
34 passes in 15.4 minutes; Chromium and WebKit passed. The preceding trace had
about 22,000 elements and 410 execution rows even with the inspector closed.
The current-commit Firefox container reproduction timed out with normal tracing;
the identical diagnostic passed in 17 seconds including the build with tracing
off. This supports fixing eager hidden content. It does not measure ordinary
untraced user latency or excuse disabling CI tracing.

## Curated control model comes before screen design

The main design deliverable is a small vocabulary of useful cartographic
meta-parameters, with explicit mappings into the existing feature recipe. The
previous five-screen proposal and its switch-by-switch contents are withdrawn
as the primary design. Decide the control vocabulary first; arrange the wizard
around those decisions afterward. The coastline example prescribes neither
that vocabulary nor the proving case.

### Curate from existing behavior

1. Inventory current configurable feature selections, owned numeric/nested
   settings, applicable profiles and dependencies. Follow actual consumers,
   including shared epoch values. Internal profile constants are not additional
   public controls merely because they exist in source.
2. Identify user-facing geographic dimensions that those inputs can influence.
   Combine related low-level inputs into one meaningful control. Merge redundant
   controls and discard proposed meanings that the existing configuration cannot
   support. Keep required extent/name/detail inputs distinct from this curation.
3. Give each candidate a short geographic name, bounded choices or a meaningful
   range, a default, an explanation of its scope, and an explicit recipe mapping.
   A qualitative choice may enable several features and set several parameters.
   It must reduce decisions rather than rename every existing field.
4. Check whether the candidate adds an independent useful decision. If two
   controls effectively do the same thing, combine them or keep the secondary
   tuning in advanced settings. Do not create every combination as a named
   preset. Several independent curated axes should compose.
5. Test representative existing generation configurations before accepting a
   label or range. These are parameter sweeps and geographic inspection using
   the current generator, not new generator development. Where the effect is
   conditional or variable, state it. Do not invent certainty or repair a weak
   abstraction by adding a simulation feature.

The first catalogue should be small enough to understand as a world brief.
There is no fixed count requirement. The point is a substantial reduction from
the available low-level configuration, not an arbitrary quota.

### Candidate dimensions to evaluate

These are agent proposals grounded in currently exposed settings, not settled
names, promised geographic results or user requirements. M0 must consolidate
and validate the actual set before building the UI.

| Candidate dimension    | Existing configuration to evaluate                                  | Curation question                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Land arrangement       | Existing continent presets, assemblies and initial crust fraction   | Can a few existing configurations express useful initial arrangements without asking for both a preset and all its constituent numbers? |
| Geological activity    | Existing tectonic, volcanic and epoch activity selections/settings  | Which combinations yield a useful overall choice, and which independent event choices deserve optional detail?                          |
| Thermal climate        | Baseline temperature and existing epoch offsets                     | Which small set of conditions is meaningful at world scale without duplicating every epoch field?                                       |
| Moisture regime        | Existing rainfall controls and epoch multipliers                    | Can dry-to-wet intent be expressed with one bounded control while leaving causal climate active?                                        |
| River/valley character | River-network selection, incision and existing erosion settings     | Which geographic options meaningfully combine delivery and terrain response without making routing a separate task?                     |
| Glacial influence      | Existing land-ice/sculpting selections, strength and epoch activity | Can current and historical ice choices be expressed clearly without three coupled process switches?                                     |
| Living landscape       | Existing ecology selection, productivity and grazing settings       | What does the current model support as a useful influence rather than a guaranteed vegetation paint?                                    |
| Cultural geography     | Culture selection, starting count and operative spread settings     | Can presence and distribution complexity be selected without exposing every era field?                                                  |
| Political geography    | Independent politics selection and starting count                   | Which small set of territorial choices is supported, separately from culture?                                                           |
| Places and connections | Existing built-geography selection and profile applicability        | What useful choice exists now, without inventing a density parameter?                                                                   |
| Causal influences      | Existing registered systems, enablement and strength                | Which system-level choices can be presented without exposing propagation/effect internals by default?                                   |

This table is a starting search space, not eleven mandatory controls. A row may
be combined, split only for a distinct useful decision, or omitted when evidence
does not support its proposed meaning. Other useful existing capabilities may
supply a better dimension. Do not make literal examples from the conversation
into required entries.

### Meta-parameter definition and composition

A curated definition needs a stable identifier, geographic meaning, supported
values, default, applicability, the feature-owned input paths it affects and a
deterministic mapping to those inputs. Reuse feature schemas, configuration
adapters, publication metadata and declared requirements.

Feature modules can register curated definitions or contribute supported choices
to a shared curated dimension. The UI can discover these dynamically. Registration
does not automatically promote every feature or setting into the primary wizard;
curation determines what belongs there. A new registered low-level parameter must
not automatically increase the number of primary user decisions.

The concrete implementation should be a small typed data/function boundary over
existing recipe editing. No new workflow language, generator, execution scheduler
or duplicate parameter schema is needed. Only introduce metadata that the chosen
catalogue actually consumes.

Apply a curated selection as one deterministic patch to the existing canonical
recipe. Preserve unaffected settings. Reprepare with the existing engine so its
dependencies, applicability and validation remain authoritative. Show geographic
consequences and any required companion changes without exposing bookkeeping.

Identify overlapping writes while curating the catalogue. Prefer independent
input ownership; where a useful cross-feature dimension coordinates values,
define that composition explicitly. Do not silently let the last selected
control overwrite another control's meaning or add a generic constraint solver.

Advanced tuning remains available. Derive a curated control's displayed value
from the corresponding recipe values; if advanced edits no longer match a known
choice, show Custom for that control. Selecting a curated value replaces its
declared inputs, not the entire recipe. Do not maintain a second competing
authoritative set of high-level and low-level values. Versioned recipe export
and the reviewed worker configuration remain the execution truth.

### Wizard built around the resulting vocabulary

Once M0 has a concrete catalogue, arrange a short progression from map brief,
through the curated geographic decisions, to review and generation. The number
of screens follows the validated controls. Page names and process categories do
not establish the design.

Each primary control shows its geographic meaning, current choice and relevant
companion options together. Put lower-level settings in optional advanced detail
at their owner. Coupled feature choices remain coupled. Internal support processes
are selected through existing composition rather than presented as a to-do list.

History is shared temporal context; curated controls may set supported temporal
patterns using the existing clock and bindings. Exact epochs remain advanced
editing. Magic uses the same curation/composition boundary as other features,
with its richer existing editor available when requested. Neither requires a
separate configuration architecture.

Review describes the selected geographic intent and actual resolved choices,
including Custom values and intentional omissions. Change links return to the
curated decision or its advanced editor. Generation launches the exact prepared
request. No map preview, percentage, runtime estimate or guaranteed geographic
outcome is invented.

Recipe JSON remains an optional editing/export tool mounted when requested.
Remove the full process-contract display described below rather than relocating
it into Technical details. Preserve unfinished edits across navigation; invalid
text cannot launch stale values. Retain existing progress, cancellation,
version-conflict handling and atomic editor handoff.

## Required removal of obsolete display attributes

This is deletion work in the existing modules, projections, components, styles
and tests. Do not keep a dormant copy of the old catalogue or inspector. The
32-feature inventory below protects useful configuration behavior, not the
existence of a display attribute or a panel for every feature.

| Remove                                      | Concrete implementation boundary                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Old per-feature page placement              | Delete `FeaturePresentation.stage`, `family`, `order`, their declarations in physical/domain feature metadata, the old `GenerationSetupStage` category contract and setup sorting/defaults based on those fields. Curated definitions own the new presentation; diagnostic navigation targets their actual controls. Do not retain aliases for the old pages.                                        |
| Generic per-feature descriptive boilerplate | Remove the old `FeaturePresentation.summary` catalogue copy and its renderer. Keep only curated control explanations and contextual messages that help make or repair a choice. Do not copy all 32 summaries into new metadata.                                                                                                                                                                      |
| Redundant state decoration and counts       | Delete repeated On/Off badges beside switches, scheduled-operation/support-process counters, Defaults/Edited stage decoration, repeated dependency paragraphs and repeated complete output-layer lists. Remove their derived display fields/helpers and CSS where they have no remaining functional consumer.                                                                                        |
| Full execution-contract inspector           | Delete `GenerationExecutionInspector.tsx` and inspector-only grouping/trait/timing/status/product-list/publication-binding renderers and styles. Remove full invocation contracts and raw parameter/product trees from the browser UI; do not preserve them under an advanced disclosure. Engine process traits and product contracts remain execution/validation authority.                         |
| Inspector-only projection attributes        | Remove display copies of bound parameters, input/output/invalidation lists, reconciliation contract text and occurrence decoration from `generationPresentation.ts` / `setupProjection.ts` when their only production consumer is the retired inspector. Inspect references before deletion; retain only minimal data actually needed for applicability, diagnostics or curated control composition. |
| Retired generic panels and fixtures         | Remove superseded feature-catalogue components, display-only helpers, exports, selectors and tests that exist solely to assert the removed presentation. Rewrite relevant journey locators while preserving their domain behavior assertions. No hidden fallback renderer for the old catalogue.                                                                                                     |

Applicability and configuration behavior currently share `FeaturePresentation`
with decoration. Preserve needed consumer bindings, initial/inherited constraints,
epoch participation and publication applicability through the smallest existing
or revised contract that their actual consumers need. Do not delete correctness
metadata merely because it was placed in a presentation type. Conversely, do not
retain that entire type to avoid separating the useful fields.

During M0–M3, record each removed field/component and each retained non-obvious
attribute's concrete consumer in this plan's implementation notes. A retained
attribute must support a named creator action or existing correctness behavior.
Speculation, backwards compatibility for an internal display shape and keeping a
test green are not retention reasons. Remove it when its replacement lands;
final cleanup is a completion condition, not an optional follow-up.

Acceptance: reference searches, typechecks and diff review show the old display
schema/producers/consumers removed, with no unused aliases or dormant panels.
The primary and advanced views contain only the retained tasks. A collapsed
inspector containing thousands of hidden elements cannot remain because that
inspector no longer exists.

Implementation inventory: deleted `GenerationFeaturePanel`,
`GenerationExecutionInspector`, `generationExecutionPresentation`,
`physicalPresentation` and the duplicate `generationStartingPoint` helper,
including their obsolete tests/styles. Removed `FeaturePresentation`,
`GenerationSetupStage` and `SetupInvocation`; no aliases remain. Removed stage,
family, order, summary, elapsed-display notes, bound-parameter/product/reconciliation
copies, global/per-feature publication copies, repeated diagnostics, reverse
dependencies, setting-consumer path strings, public inherited channels and
public applicability copies. The prepared engine contract remains intact.

| Retained declaration              | Concrete consumer                                                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `settingConsumers`                | `projectSetting` enables actual scalar controls and locates their consuming feature, including sea level with oceans.                       |
| `epochControls`                   | `generationEpochFields` and `GenerationEpochConfiguration` edit the single shared epoch value. Only these controls are projected to the UI. |
| `initialOnlySettings`             | Setup projection and invalid-draft editing disable values that cannot be reapplied to inherited geography.                                  |
| `requiresLocatedSources`          | Availability checks identify an empty located-source capability; `locatedSources` keeps that empty task out of the advanced selector.       |
| `publicationProfiles`             | Setup availability checks distinguish inherited fields from unavailable operations at the current scale. No output catalogue is rendered.   |
| `configurationPresentation`       | Configuration applicability determines editability; declared epoch bindings preserve clock/record ownership during history edits.           |
| Invocation IDs                    | `diagnosticFeature` finds the editor for actual preparation errors. Full invocation contracts are not projected.                            |
| Private scheduled process/version | Scalar applicability resolves the actual registered contract version. This is not a public display attribute.                               |

## Specific repair of the current CI failures

Latest run checked on 2026-10-21:
[`39529994929` at `13be040`](https://github.com/chris-arsenault/vellum-and-vector/actions/runs/39529994929).
Firefox: 34 passed, two 120-second timeouts, 15.4 minutes of test execution.
Chromium and WebKit passed; the main CI job was skipped. These are current
observed failures, not hypothetical final acceptance work.

1. `frontend/tests/generationHistory.test.ts:85`,
   **shares epoch duration and preserves keyed ecology and magic through structural history edits**.
   Hosted failure exhausted the whole-test timeout in `captureReview` while
   checking `.setup-actions` visibility at narrow width (`:79`, called at `:131`).
   Preserve shared-clock/keyed configuration, responsive-layout and launch-input
   assertions. Determine from the repaired trace whether any layout defect
   remains after removing the eager DOM; the timeout alone does not establish one.
2. `frontend/tests/generationHistory.test.ts:190`,
   **preserves dirty JSON across stages, applies owned values atomically and regenerates compatibility copies**.
   Hosted failure exhausted the whole-test timeout while checking Generate world
   was enabled (`:225`). Preserve dirty-text retention, invalid-JSON blocking,
   atomic apply, compatibility normalization and the absence of an implicit job.
   The local container reproduction hit the same overall timeout earlier in the
   journey; the final waiting locator is not itself proof of a button-state bug.

Repair and verification within the UI replacement, not a separate prerequisite:

- Use the existing failed-run logs and local reproduction as the baseline;
  another baseline reproduction is needed only if new uncertainty justifies it.
  Do not add another expensive numerical browser test.
- As the replacement review/UI lands in M0, delete the full eager execution
  display and its unnecessary metadata as above. This deletion is the repair;
  do not optimize or temporarily rebuild the display that is being removed.
  Check other retained disclosures for eager hidden bodies and mount their useful
  content only when requested. Preserve field buffers and JSON text on unmount.
- Rerun both exact journeys together with `trace: retain-on-failure`, the existing
  120-second test timeout, 30-second expectation timeout and current single-worker
  behavior. Changing selectors for the redesigned UI is expected; deleting or
  weakening the behaviors they assert is not a repair.
- Exercise the eight-epoch journey with review closed/open JSON transitions and
  advanced parameter editing. Measure DOM and interaction changes and report
  representative timings. No hard node budget or extra runtime caps are proposed.
- Run the full Firefox browser suite after focused passes, then the final browser
  matrix and repository-required checks on the integrated revision. If a real
  subsequent defect appears, read its logs and fix that defect. Do not increase
  timeouts, add retries, disable tracing, skip the failures or alter shared CI
  infrastructure to disguise this application regression.

M0 cannot close while these failures remain unresolved. M4 cannot close without
the full Firefox regression result and final matrix evidence or an explicitly
reported unverified remote result where publication was not authorized. Keep
fixture browser journeys and headless numerical generation separate. The earlier
17-second trace-off run is diagnostic evidence only, not acceptance evidence.

## Dependency behavior and contract reuse

Curated controls compose existing engine features without replacing their
identities or execution hierarchy. Their changes update existing v2 feature
selections and owned values. React renders the curated definitions; existing
scalar fields and registered rich editors supply advanced tuning. Do not
introduce a schema-generated low-level wizard, alternate recipe language, new
process switch table or graph scheduler.

- Initialization, validation and numerical bookkeeping remain internal. Their
  correctness is mandatory; presenting each as an option is unnecessary.
- Coupled operations already share one feature. The interface must not split
  those operations and offer a later “disable together” repair.
- When adding a capability requires other configurable features, expose a
  concrete edit such as **Enable deltas with floodplains and sediment transport**.
  Apply the named changes as one draft edit and reprepare using declared
  requirements. Do not require the user to find prerequisites on other pages.
- When removing a provider affects selected deliveries, show the affected
  outcomes beside that choice and offer the explicit combined edit, such as
  **Omit river networks, floodplains and deltas**. Never silently undo an explicit
  choice, zero magical effects or remove unrelated features.
- Conditional requirements come from feature-owned declarations and preparation,
  including configured magic. A nonzero coastal Pressure effect links to its
  actual effect and coastal target; zero coastal forcing introduces no such
  requirement. Ordinary actions list their effects rather than causing a modal
  approval sequence. Imports and temporary invalid text still receive local
  diagnostics when a valid combined edit cannot be inferred.
- Preserve existing field-buffer, epoch-binding and invalid-draft handling.
  Local disclosure must not erase invalid edits or leave hidden blocking errors.

Process traits retain actual timing, material movement, forcing and inheritance
semantics in the engine. Use them only where needed to describe a meaningful
curated choice or actual progress. They do not require a browser menu or full
contract inspector. Wizard order is independent of causal execution order.

### Technical coverage retained behind curated controls

This is an advanced-access inventory, not the proposed primary control list or
page renderer. Preserve useful existing choices and explain internal/inherited
ones. Accounting for all 32 identities does not establish useful curation.
Technical options remain discoverable without becoming 32 primary tasks.

| Decision / access point                                  | Existing feature identities                                                                                                                    |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial land arrangement                                 | `physical.foundation`; lifecycle participation explained with generation/history rather than a compulsory checkbox                             |
| Continents and mountains                                 | `physical.tectonic-history`, `physical.mountains`                                                                                              |
| Volcanic and impact terrain                              | `physical.volcanism`, `physical.impacts`                                                                                                       |
| Rock structure and slopes, with local technical detail   | `physical.hillslopes`, `material.load-response`, `physical.fractures`, `physical.geothermal`                                                   |
| Initial coast construction                               | `physical.coastal-construction`                                                                                                                |
| Climate and seas                                         | `ocean.geography`, `physical.ocean-circulation`, `physical.climate`, `physical.continental-margins`, `physical.coastal-evolution`              |
| Rivers and valleys, with local technical detail          | `water.routing`, `physical.river-networks`, `physical.river-incision`, `material.fluvial-transport`, `physical.floodplains`, `physical.deltas` |
| Ice and glacial terrain                                  | `physical.land-ice`, `physical.glacial-sculpting`, `physical.sea-ice`                                                                          |
| Living landscape                                         | `ecology.living`                                                                                                                               |
| Terrain classification, under landscape technical detail | `physical.landforms`                                                                                                                           |
| Shared generation history                                | `physical.lifecycle`; preserve supported advanced omission semantics without presenting structural validation as an optional correctness check |
| Influences and their geographic links                    | `magic.configured`, `magic.local`; absent located sources explained contextually                                                               |
| People and places                                        | `human.cultures`, `human.politics`, `built.layout`                                                                                             |

At M1/M2, reconcile existing scalar, nested and epoch fields with the curated
mapping or optional technical access point. Keep this in the same catalogue,
not a second parameter registry. Registered extensions can supply curated
descriptors and existing advanced editors. No new primary control is created
solely because a module registered another scalar. No executor changes or
duplicate schemas are needed to discover a descriptor. Rich interaction still
requires deliberate design; metadata does not establish usability.

## Layout and navigation

Use the existing application styling and useful components with compact labeled rows,
readable type, visible units and controls sized to their values. A small step
navigation rail, the current decision and a short relevant consequence summary
are sufficient. Avoid the repeated On badge beside an already checked switch,
per-feature scheduled-operation counts, repeated dependency boilerplate and the
full output-layer list on every step. There is no decorative welcome half-screen.

One main pane scrolls. Heading and Back/Next actions remain reachable. Keyboard
order follows the decision, focus moves to the new heading, and Change links open
and focus their target. Selecting another step preserves the draft. Defaults
allow skipping to review; visiting every step is not a requirement. Navigation
indicates current choices and actual issues without ceremonial completion ticks.

Inspect 1440 × 900 and 1280 × 800 desktop layouts plus a narrow 390px layout.
These are representative review scenes, not new hard performance or pixel
budgets. Preserve readable labels, pointer targets and focus rings while reducing
empty space. Use local diagrams only when they explain extent, relationships or
time. No fabricated geographic preview, remote image generation or hosted
presentation service is needed for this wizard.

## New-region adaptation

After the initial journey is complete, reuse its decisions with a context header
for the selected extent, parent map, effective traits and fixed crossings. Start
with the inherited brief; do not ask the user to choose world continents again.
Offer only locally operative settings, with inherited geology, history and magic
summarized where relevant. Preserve parent identities, boundary contracts and
authored protection. Existing created-region cancellation semantics remain.
Existing-map replacement and regeneration redesign remain deferred.

## Accountability during execution

These are working rules for the implementation agent, not product features or
new user approval ceremonies:

1. At each phase start, read `sulion plan current`, the phase body and relevant
   source. Tie changes to the user requirements above. Record consequential
   design changes and why; do not substitute component completion for behavior.
2. First produce the curated catalogue with actual existing-input mappings.
   Choose a representative cross-feature control from that catalogue, then prove
   it with existing generation and in the real application before spreading the
   UI. No particular example from the conversation dictates that proving case.
   Inspect desktop/narrow states, keyboard operation and traced interactions.
3. Publish the first-slice images and concrete findings to the user as a progress
   update, without making them run a design review or blocking on ceremonial
   approval. Use local artifacts. User corrections govern the remaining work.
4. A phase closes only with its stated evidence. In this document, record concise
   actual results, artifact paths and remaining limits under that phase. If
   something is implemented but uninspected, say so and leave acceptance pending.
5. Keep correctness, interaction performance and product judgment distinct.
   Passing tests cannot establish professional layout or a useful decision flow.
   A screenshot cannot establish worker correctness or complete control coverage.
6. Before final completion, replay the journeys below without process IDs or JSON
   as navigation aids, inspect all representative screens, and compare the
   result to the requirements. Do not ask the user to discover the omissions.
   State any failing or unverified outcome instead of saying the plan is complete.

Reject a milestone's product claim if obsolete display attributes, producers or
dormant panels remain without a concrete retained consumer; if its primary screen is still a flat feature
list; enablement and its operative settings require different destinations;
internal support counts stand in for geographic consequences; inactive forms
dominate the page; or the only evidence is tests/CSS that were not inspected in
the rendered application. A stage rename or a smaller margin cannot satisfy the
replacement on its own. Completion notes must distinguish implemented behavior,
the implementer's visual assessment, and explicit user acceptance. Never claim
the last of these without receiving it.

Also reject the curation claim if the new controls merely rename existing fields,
if a user still configures their constituents separately to express ordinary
intent, or if convenient labels have no supported mapping. A literal example
becoming an unsolicited generator requirement is a scope failure, not progress.

## Milestones and observable acceptance

### D0 — Product contract and accountability

Revised after the user's clarification: curation of existing generation inputs
is the primary design work. The earlier screen-by-screen controls are withdrawn.
Examples are illustrative, and no new generators or algorithms are authorized.
This document records the proposed abstraction, candidate dimensions, mapping
rules, retained behavior and the work still needed to choose the concrete set.

### M0 — Prove one cartographic journey

First author the concrete curated catalogue from current features and consumers.
For every retained meta-parameter record its useful meaning, bounded choices,
default, exact affected inputs, combination behavior, applicability and limitations.
Reject redundant dimensions and unsupported labels. Choose one representative
cross-feature control from that work; do not choose it from a literal example.

Implement its deterministic composition into the existing recipe and prove its
meaning with representative runs of the current generator. Then implement the
brief, curated choice, review and existing generation/editor handoff as one
application slice. Delete the old eager execution display and its display-only
attributes during this replacement. That removal addresses the identified CI
cause; there is no separate preliminary CI repair or temporary inspector rewrite.
Remove inspector-only tests and preserve/update meaningful history, JSON, layout
and launch assertions.

Acceptance: a small set of geographic choices substitutes for many constituent
settings; ordinary use needs no process knowledge or advanced editor. Unrelated
edits survive. The selected intent resolves to the reviewed worker input. The
representative generated geography supports the label across more than one seed.
If not, improve the curation or choose a supported dimension; do not add a
generator to make an attractive label true.

Both named failing Firefox journeys and the full Firefox suite must pass after
the replacement with normal tracing and existing timeouts. The retired display
must be absent. Investigate any failure that remains from its actual logs rather
than assume every symptom was caused by the removed DOM.

Evidence: concrete catalogue and input mappings in this plan, representative
headless generation and inspected output, focused composition checks, and a
fixture-based UI journey with inspected desktop/narrow images and keyboard flow.
Keep browser tracing/timeouts; measure default/eight-epoch interaction without
new hard caps. A renamed parameter or attractive screen alone cannot close M0.

### M1 — Complete physical world design [depends on M0]

Execution expansion: physical applicability and independent/nested matching,
followed by deletion of unconsumed global occurrence/publication/diagnostic
projection copies. The retained advanced editor uses actual scalar consumers,
epoch bindings and diagnostic owner IDs; unused reverse-dependency/display
projections have no product consumer and will be deleted rather than preserved
for tests. Verify focused composition, inherited applicability and existing
field/history tests, then relevant rebuilt browser journeys.

M1 expansion: `fdee56d2-0a3c-4822-906d-22e421b58de2`, steps 1–2. Completed:
all choices prepare through the actual schema/preflight, with Custom matching
including declared nested values. Region choices omit initial-only incision.
Removed unused global invocation/publication lists, per-feature reverse dependency
and diagnostic copies, consumer path strings and unused setting-reason prose.
Only scalar/configuration applicability and invocation IDs used by diagnostic
navigation remain in the setup view. Also deleted the obsolete starting-preset
helper and its tests; curated patch/independence tests cover the replacement.
31 focused tests and typechecks pass; 12 rebuilt Chromium journeys pass (29.8s),
including shared history, field repair and the two CI regressions.

Implement the validated physical/ecological meta-parameters and arrange their
wizard progression. Combine related existing controls behind meaningful choices;
preserve exact numeric and temporal tuning in optional advanced detail. Reuse
schemas, feature bindings, field buffers and shared epoch identity.

Acceptance: the normal workflow expresses geographic intent with substantially
fewer decisions than the low-level catalogue. Independent curated dimensions
compose without overwriting one another. Advanced edits show Custom where
appropriate; reselecting a curated option changes only its declared inputs.
Existing useful controls remain reachable without dominating the primary flow.
Delete the replaced stage/family/order/summary fields, generic physical feature
panels, obsolete sorting/navigation helpers and their display-only tests/styles
as their curated replacements land.

Evidence: natural-world journey, mapping/consumer review, focused composition and
field checks, representative existing-generator outputs for affected choices,
and rendered default, advanced, inactive and invalid states. No algorithm work.

### M2 — Integrate influences and human geography [depends on M1]

Expansion `85add08e-5256-4b1d-9622-f5dd1e036bf4`, steps 1–2, completed.
Configured influence inclusion uses the common feature contract; the optional
source view derives lower/ordinary/higher activity from existing system strength
values (0.4/1/2). It preserves distributions, effects, independent rules and
epoch activity. Region source definitions remain inherited. Omitting a feature
discards its inactive invalid field buffers without discarding the shared clock.
31 focused tests and 11 rebuilt Chromium journeys pass (28.4s), including both
history/JSON regressions and independent people/source choices. Desktop and
narrow influence screenshots were inspected in `frontend/test-results/artifacts/`.

Execution steps: add one common configured-influences choice and a compact
source-activity view populated from existing system definitions, retaining
advanced system/rule editing at its owner. Then verify independent people choices,
shared epoch activity, omission semantics and the exact reviewed request. No
strategy, physical feedback or generator is added. The source-activity choices
change existing strength values; independent rule behavior is retained, and
omitting the entire feature omits its complete contributions.

Complete curated choices for the supported human and magical capabilities.
Discover descriptors from registered features where useful. Keep cultures,
politics and built geography independently selectable. Rich rule/system/era
editors remain optional detail over the same underlying values.

Acceptance: users can choose supported influence and human-geography intent
without configuring each propagation parameter or era. Existing dependencies and
shared timing are respected. A new registered raw setting does not automatically
become another primary decision. No empty located-source task appears. Remove
remaining obsolete domain presentation attributes and generic catalogue panels
rather than retain an advanced copy of them.

Evidence: causal-world and independent-human journeys, descriptor discovery and
mapping checks, relevant adapter/epoch regressions and inspected rendered states.
Validate the meanings actually chosen in M0, not a new list invented while coding.

### M3 — Review, generate and refine a new region [depends on M1, M2]

Expansion `9114a0bb-14da-4b24-b681-7a7b64dfb598`, steps 1–2. Real curated
world/region generation and inherited impact-history checks pass (2 tests,
93.1s). Four rebuilt browser journeys pass (20.9s), covering regional applicability,
read-only source activity, completed-history rejection and both setup cancellation
paths. The final review also removes unconsumed public context/channel and
applicability copies; epoch control descriptors remain for actual editors, and
private process versions remain for correct scalar-consumer lookup.

Execution expansion: (1) verify truthful intent review, field repair and inherited
regional choices, and update the maintained module documentation to describe the
curated descriptors and minimal applicability projection; (2) exercise actual
curated world/region generation and retained worker launch/cancel/failure paths.
Keep the existing atomic publisher and worker contracts. No new execution layer.

Complete intent-led review, exact worker launch, real progress/failure/cancel and
editor handoff. Keep recipe JSON on demand; complete the display-removal inventory
without restoring the full execution inspector. Adapt the curated
controls to inherited regional context after initial-world creation works.

Acceptance: review describes curated choices and Custom departures truthfully.
Invalid edits cannot launch stale values. Success opens the generated world.
New-region choices use actual local applicability and preserve parent history,
identities, boundaries and authored protection. Retain cancellation semantics.
Retire old UI/helper code only after reviewing its remaining useful callers.

Evidence: fixture launch/failure/cancel journeys, existing worker contract checks
and representative actual initial-world/new-region headless generation. Fixture
screenshots establish interaction, not the quality of generated geography.

### M4 — Establish product acceptance [depends on M3]

Expansion `e1e87696-c8c3-40eb-8523-96e417309003`, steps 1–2. Required
repository checks pass: 468 tests across 79 files, lint, format, types and
Terraform formatting. After the final clock disclosure change, focused browser
navigation, lint and types also pass. Five real generation checks cover two river
seeds, contrasting thermal/rainfall choices and world/region inheritance.
Screenshot inspection found and corrected a shared definition-list style that
overlapped review rows. The corrected 1440px Review and 1280px Landscape views
were inspected. Two initial Chromium matrix attempts were stopped deliberately
for these source corrections; neither is counted as completed evidence.

Final-source Chromium: 40 passed, 131.3 seconds including build/setup. Firefox:
40 passed, 137.9 seconds. No skipped or flaky journeys. The two named Firefox
regressions take 4.56s and 1.89s. Tracing, test/expectation timeouts, worker count
and CI workflows are unchanged. Final DOM measurements: Landscape 160, Review
146, eight-epoch Review with JSON open 153, compared with the earlier roughly
21,892-element eager display. These are observations, not runtime budgets.
WebKit: 40 passed, 139.5 seconds, with no skipped, unexpected or flaky results.
All 120 browser journeys pass. Test containers and preview servers stopped.
Existing lint warnings in `magicSystems.ts` and `TemplateDrawing.tsx`, and the
existing production chunk-size warning, remain nonblocking. Machine-readable runs are ignored local artifacts at
`frontend/.artifacts/ci/curated-{chromium,firefox,webkit}-final.json`.

Execution expansion: (1) run required repository checks and the full browser
matrix against the integrated source with unchanged tracing/timeouts; inspect
1440/1280/narrow views and long history, and review the removal inventory;
(2) reconcile actual results, remaining geographic limitations and local-only
publication status in this existing plan. Do not convert agent visual assessment
into explicit user acceptance or add hard performance budgets.

Replay the integrated journeys and inspect all primary and important advanced/error
states. Review the curated vocabulary itself: useful meaning, reduced decisions,
independence, supported mappings and geographic evidence. Run required checks and
Chromium/Firefox/WebKit browser checks with normal tracing/timeouts.

Acceptance: the wizard lets a cartographer express intent without translating it
into process configuration. No useful choice was lost; no example was promoted
into an unsolicited generator requirement. Actual generation supports the chosen
meanings, with limitations stated. Desktop/narrow/keyboard operation is usable,
including long history and the retained advanced editing tools. Reference/diff
review confirms obsolete display attributes, producers and consumers are deleted.
Both named regression behaviors, the full Firefox suite and the final browser
matrix remain required; a clean new UI does not substitute for their results.

Evidence: concise actual results and local image paths in this plan, final
curation/control-coverage review, representative headless generation, production
build and required checks. Distinguish implementation, visual assessment and
explicit user acceptance. No separate verification report or invented runtime
budget. Report remote CI as unverified if publication was not authorized.

## Journeys that define acceptance

| Journey                | Decisions and required observation                                                                                                                                                                                                             |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| J1 — First world       | Set name/extent/detail, accept curated defaults, review and generate into the editor without opening process inspection, history internals or JSON.                                                                                            |
| J2 — Geographic intent | Compose several independent validated meta-parameters. Review describes their meanings. Existing generation produces evidence of those influences without requiring individual process configuration.                                          |
| J3 — Causal influences | Choose a supported influence, change its curated activity and revisit the same owned values in optional technical detail. Declared dependencies and the shared clock remain authoritative.                                                     |
| J4 — Human geography   | Choose cultural intent while omitting political territories; choose built geography independently. Review and execution retain the distinction.                                                                                                |
| J5 — Custom tuning     | Adjust an underlying value in advanced detail, observe Custom on the affected curated control, navigate away/back, then reselect a curated value. Only its declared inputs change. Invalid or unapplied JSON edits cannot launch stale values. |
| J6 — Long history      | Use eight epochs, edit and review curated choices with tracing enabled, and open/close retained advanced editing and JSON. The retired execution inspector and its hidden contract tree are absent.                                            |
| J7 — New region        | Inspect inherited context, select a supported local curated choice, generate and retain boundaries/history/identity. Cancel preserves the existing region and starts no job.                                                                   |

## Sulion mapping and current state

### M0 execution expansion

Sulion expansion: `71d999b7-996c-4087-a902-fabe2e5fe324`; steps 1–3.

1. Curated vocabulary and recipe composition: feature-owned choice definitions
   compose existing inputs, preserve unrelated values, resolve ordinary declared
   prerequisites and derive Custom from the canonical draft. Verify patch
   independence, registry discovery, disabled values and invalid combinations.
2. First workflow and deletion: replace catalogue selection with curated decisions,
   first brief/review/launch path, and delete the full execution display and its
   display-only projection. Preserve scoped advanced settings and diagnostics.
   Inspect the actual first slice before extending the remaining interactions.
3. Evidence: representative existing-generation output, inspected desktop/narrow
   screenshots and keyboard path, named Firefox regressions and full Firefox
   suite with unchanged tracing/timeouts. Record material failures honestly.

The initial concrete vocabulary is: land arrangement (mixed/broad/island),
tectonic history (quiet/moving crust), geological events (quiet/volcanic/impacts/
mixed), thermal climate (cold/temperate/warm), rainfall (dry/mixed/wet), sea level
(lower/reference/higher), river terrain (omitted/channels/plains/incised), glacial
influence (no land ice/ice only/sculpted/strongly sculpted), coastal change
(off/ordinary/strong), living cover (off/lower/ordinary/higher productivity), cultural geography
(none/few/many), political geography (none/few/many), places/routes (off/on) and
configured influences (off/on), with optional per-source activity choices.
These use existing selections/settings only. Climate permits or limits ice and
vegetation; the labels describe generation influences, not guaranteed coverage.
Exact mappings are declared with their feature definitions in source and tested.

M0 evidence: curated composition and focused projection/draft tests passed (23
tests). Two real Draft worlds at seeds 73 and 104729 publish river geography
without incision or glacial-sculpting output for the selected plains/ice-only
choices. The first test incorrectly inspected discarded scratch state; it was
corrected to inspect the delivered channels, which are the actual product output.
No generator changed. The first rendered selector needed an explicit accessible
label, and inspection corrected footer sizing and excessive row height.

All 38 Firefox browser journeys passed with tracing and timeouts unchanged in
the CI image, 137.9 seconds including build/setup. Both previously failing
history/JSON journeys also passed separately in 20.2 seconds. First-slice DOM
measurements: Landscape 151 elements, Review 142. Local evidence:
`frontend/.artifacts/ci/curated-firefox-suite.json` and
`frontend/test-results/artifacts/curated-{landscape,review}-desktop.png` plus
`curated-landscape-narrow.png`. These fixture screenshots establish UI behavior,
not generated-geography appearance. Final integrated results are recorded in M4.

| Milestone      | Phase ID                               | State                                  |
| -------------- | -------------------------------------- | -------------------------------------- |
| D0             | `10a62e0b-8086-46b0-89ad-fa4f25c39ef0` | Revised planning complete              |
| R0 (withdrawn) | `a3e3c0bb-3c7a-454d-aec8-64c58d0d0c85` | Skipped; duplicate work merged into M0 |
| M0             | `92b5556b-051a-48d6-a61f-cd549db71064` | Completed                              |
| M1             | `9e9ef1f7-c430-41ac-b256-b7b98ce10c13` | Completed                              |
| M2             | `546dfdcd-912e-4320-82de-70f170a8989e` | Completed                              |
| M3             | `8f037942-0306-4045-b620-88543588d5f0` | Completed                              |
| M4             | `e6758bba-2175-4600-b5a5-3cb5d856f4e6` | Completed                              |

The screen-first proposal was insufficient. The implemented catalogue composes
existing settings and selections, replacing the obsolete eager display in the
same work. R0 remains withdrawn because verification follows that deletion.
Integrated implementation passes the named Firefox regressions, required
repository checks and all 40 journeys in each of Chromium, Firefox and WebKit.
No generator or numerical algorithm changed; no commit or push was requested.

Evidence limits: generation checks exercise representative seeds and published
outputs, not a guarantee of particular coastlines, land percentages, ice coverage
or biomes. Choices express influences supported by existing generators. Fixture
screenshots and browser journeys establish interaction, not terrain quality.
The canonical recipe remains authoritative through curated and advanced edits.

All authorized local implementation and checks are complete. Hosted CI has not
been rerun on these unpushed changes. Implementation and inspected images do not
constitute explicit user acceptance.
