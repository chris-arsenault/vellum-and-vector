# Generation modules and recipes

Generation runs in the shared Rust engine, `crates/atlas-generation`, as WASM in a
browser worker or natively on the LAN backend. A recipe contains plain data. Process
implementations, settings and publication declarations stay in the engine and are
rebound before the reviewed recipe executes.

## Capability ownership

The feature `Catalogue` in `crates/atlas-generation/src/atlas/features` lists every
`Feature` with its domains, requirements, parameters, owned processes, native steps
and slots; the registry and executor do not contain per-feature execution switches.
A feature can contribute to an existing physical slot or the public
`present.products`, `present.people` and `present.after-people` slots. A new causal
phase requires a deliberate profile extension.

A `Feature` describes a delivered capability. It names its parameters, dependencies
and owned processes, and contributes actual operations. Invocation ownership binds
that feature's settings into the process's declared parameters. The feature is
separate from a published map feature, which identifies a located geographic object,
and from the domain traits used to constrain geography.

Each feature declares its supported `slots` and returns its operations from its
contribution function. Contributions outside the feature's declared process list
fail. The profile owns causal positions; feature implementations own
what they contribute there. Ecology, configured magic and located magic use this
same path. Before/after model-pass slots supply explicit process/context bindings
for interleaving influences without a feature switch in the sequence builder.

Configured magic derives further requirements from its systems' effects and
interaction rules (`atlas/configuration/magic.rs`). A diagnostic can carry a
configuration-relative `field` path, the feature and its path within that feature's
configuration. Preparation and field navigation use those paths. Independent interaction rules in disabled magic containers
participate in dependency discovery because they also participate in execution.

Glacial sculpting owns erosion, deposition and glacial relief classification as
one choice. Volcanism owns plume roots and construction. Coastal evolution owns
external forcing and natural coastal cutting. River networks remain distinct
from river incision. Shared routing, ocean geography and load response have
explicit providers and input contracts.

## Request configuration

The JSON recipe schema accepts version 2 with feature selection and owned settings:

```json
{
  "physical.river-incision": { "enabled": false },
  "physical.glacial-sculpting": { "enabled": true, "settings": { "glaciers": 0.6 } },
  "ecology.living": { "enabled": true, "settings": { "vegetation": 1.3 } }
}
```

This object is the recipe's `features` member. The request also selects its area,
seed, quality and domains. Preparation resolves and validates the complete request
before execution; preflight (`atlas/dispatch/preflight.rs`) walks the product
contracts without running simulation work. The resulting configuration includes the
named sequence, effective settings, seed, feature configurations and publication
descriptors. Sending a different request with the reviewed configuration fails.

Physical history belongs to the lifecycle configuration. Ecology owns its
per-epoch ecological regimes; configured magic owns its systems and per-epoch
activity; cultures own their operative eras. The older flat parameters, process
booleans and world settings are compatibility inputs translated at preparation.
Conflicting legacy selections for operations of one coupled feature are rejected.
Unknown feature IDs, unowned parameters and invalid nested configuration fail
validation.

Nested configuration binds into the world settings in a fixed owner order
(`atlas/configuration/bindings.rs`): the physical lifecycle, living ecology, configured
magic, then cultures. Each owner's supplied values extend its defaults and are
validated against the settings the preceding owners completed. A feature without a
binding rejects nested configuration. The clock owns epoch insertion/removal;
ecology owns ecological regimes and magic owns activity. A new feature with nested
configuration adds its binding there. Selection-only catalog calls need no world
history; execution preparation binds complete configuration before composing a recipe.

Disabling a feature either omits its complete behavior or yields a dependency
diagnostic naming the consumer and missing input. Magical coastal modification
requires coastal evolution; a pressure field with zero coastal modification does
not. People's processes join the sequence only where a cultural, political or
built feature is selected: a loose pass inside each physical epoch and the human
eras in the `present.people` slot. A human era's `mobility` and
`politicalCapacity` are era variables those passes read.

## Cartographic setup

A feature can register curated `cartography` descriptors. Each control supplies
a geographic question and a small set of choices whose patches compose existing
feature selections and owned settings. For example, River plains enables networks,
floodplains and deltas while omitting incision. No generator is introduced by a
choice. Controls are discovered from the module registry; adding a raw setting
does not automatically add a primary wizard decision.

The wizard progresses through map brief, land, landscape, magic, people and review.
Independent controls preserve unrelated settings. Matching compares only a
choice's declared inputs; other combinations appear as Custom. Initial-only
controls and choices are omitted for inherited regions. Source activity scales
existing configured systems while preserving effects, interaction rules and
shared epoch activity. Labels describe inputs and influences rather than
guaranteed geographic coverage.

Exact numeric settings and rich clocks, ecology, magic and culture configuration
remain reachable through one focused advanced editor. Closed rich disclosures
do not mount their forms. There is no full capability catalogue or execution
contract inspector in the wizard.

`frontend/src/generationFeatureAdapters.ts` registers a specialized editor,
changed-value summary and field mapping together. Adding a nested form does not
require separate editor and review dispatch tables. Configuration applicability
and clock/record epoch participation are declared on the generation feature and
projected into setup. Epoch changes preserve unrelated feature configuration.
An invalid draft keeps editable selection current while discarding executable
occurrences; launch remains blocked. Changing source/propagation reconciles raw
numeric buffers so hidden controls cannot retain unreachable errors.

`FeatureApplicability` retains functional scalar consumers, epoch bindings,
initial-only fields and inherited-source availability. Projected scalar
descriptors distinguish their canonical `owner` from the
`controlFeature` whose operations consume them. Sea-level baseline is presented
with Ocean geography while retaining its existing compatibility ownership. Linked
epoch views likewise share one clock value; physical rainfall is editable with
climate even when living ecology is off because precipitation consumes that value.

The setup projection (`atlas/configuration/presentation.rs`) reads the prepared request
and registry. It exposes
context and feature applicability, editable settings/configuration and invocation
IDs used to locate real diagnostics. The prepared request remains the authority
for execution, dependency diagnostics and publications. The setup projection
never selects or executes processes and does not copy the execution tree into
the UI. Review shows curated choices, shared history and optional changed values;
normalized recipe JSON remains available on demand.

The UI draft normalizes compatibility inputs to feature ownership. Epoch rename,
insertion, deletion and reorder update the single physical clock and keyed
ecological/magical configurations together. Form and JSON edits use that draft;
JSON exports normalized compatibility fields and reports regeneration when owned
values supersede them. Temporary invalid text is separate from committed numeric
values and blocks launch. Review uses prepared values; installing a new world
uses its reviewed draft snapshot and stable identity. Region setup uses the full
source snapshot, inherited definitions and the reviewed source version.

## Process execution and validity

Every operation is a command of one kind: initialization, work, elapsed, event or
publication. Elapsed commands receive explicit years. Ecology runs two half-epoch responses,
then full-duration burial; present classification adds no biological age. Native
land-ice passes remain repeated state-changing passes. Configured magical history
advances once per epoch; located-source storage uses elapsed years.

Every process binds a command. Commands remain trusted operations over shared
mutable state, rather than a runtime capability sandbox.

One `ProductLedger` drives prerequisite checks, preflight and execution. For world
steps a product is a band, `field:<band>`, recorded as written when a selected step
that declares writing it runs, or when the map inherits it. A step can do without a
band it does not list as needed, since an unwritten band reads as nothing happened;
a feature that is switched off holds its histories as nothing having happened. Epoch
response products expire at epoch boundaries.

Process product definitions are the provider authority. Distinct processes
cannot both produce an exclusive product; repeated invocations of one provider
remain legal. Shared-state/additive products explicitly permit multiple writers.
Preflight and runtime enforce the same rule. Retained products use separate
identities. Declarations remain implementation obligations: the ledger does not infer
numerical correctness from channel allocation. The forcing-only projector has
its own contract and does not claim flow or drainage; full projection declares
only the selected output aliases it actually creates.

The numerical map stays shared and typed. Several mechanisms contribute to the
same material budget or fracture conductivity without requiring the optional
fault-network generator. Material transformations check the common sediment
budget.

A transfer can declare a `reconciliation`: its possible invalidations, a child
sequence and guaranteed products, carried in the reviewed recipe. Preflight
checks both outcomes; execution runs only the declared child branch, with the
same executor, selection, bound settings and ledger, and checks its guarantees
before committing the outer operation's products. No current process declares
one.

## Output publication

A module declares field or geographic publications with complete layer metadata.
Fields include units and intensive, extensive or categorical quantity semantics.
Geographic declarations identify supported kinds and network output. Native
channel conversion remains in `field/projection/channels.rs`; feature publication
definitions select its bindings before final projection.

The candidate publisher validates registered products, installs compatible new
layers, creates field resources and coverage, and marks generated area layers.
Unknown channels or geographic outputs fail instead of falling into a default
layer. Inactive known buffers can remain inherited working inputs without being
published. Existing compatible layer styling and authored protection remain
authoritative. A replacement revision becomes current only after the run completes
and the map's current revision is still the one it started from.

Configured magic's source/propagation declarations hold their operations,
requirements, applicable parameters and displayed choices together. Adding a
built-in strategy extends its domain schema and strategy declaration. Magic field
descriptors supply unit, quantity, initial value, carried lifetime and publication
to allocation, advection, inheritance and projection.

These are current implementation mechanics. Per the user's 2026-10-22
clarification, the seven magic systems are first-class world processes;
system-specific code is permitted. Read
[magic source authority](../AGENTS.md#magic-source-authority),
[the product contract](product-spec.md#103-magical-generation--the-seven-systems)
and [ADR 0007](adr/0007-magic-systems-are-materials.md). No system is reduced to
generic effects and Canonry's named setting lore is not imported. No speculative
extension framework or universal spell-composition language exists.

Located-source heat, cold, coastal pressure and erosion resistance have physical
consumers. Uplift, gravity, fertility and luminous sources currently publish
intensity only. Their existing definitions remain valid; authoring and preparation
explicitly identify the missing physical feedback.

The climate sequence retains its existing approximation: configured thermal magic
adjusts temperature and ice after the native precipitation pass. Precipitation
from that pass remains retained until the next scheduled climate calculation.
At that calculation, the moisture-transport step carries part of each cell's
external heat forcing downwind with the air.
