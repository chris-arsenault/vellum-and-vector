# Generation modules and recipes

Generation runs in browser memory through the same TypeScript modules in the
editor and worker. A recipe contains plain data. Process implementations, schemas
and publication factories stay in the application and are rebound before the
worker executes the reviewed recipe.

## Capability ownership

`GenerationModule` registers its feature definitions, process factories and output
definitions together. The application composition root is
`packages/generation/src/atlasModules.ts`; the registry and executor do not contain
per-feature execution switches. A module can contribute to an existing physical
slot or the public `present.products`, `present.people` and
`present.after-people` slots. A new causal phase requires a deliberate profile
extension.

`GenerationFeature` describes a delivered capability. It owns numeric parameter
definitions, an optional Zod schema for nested configuration, dependencies and
actual operation contributions. Invocation ownership binds that feature's
settings into the process's declared parameters. The feature is separate from
`AtlasFeature`, which identifies a located geographic object, and from the domain
traits used to constrain geography.

Each feature declares its supported `slots` from `generationSlots.ts` and returns
its operations from `contribute`. Contributions outside the feature's declared
process list fail. The profile owns causal positions; feature implementations own
what they contribute there. Ecology, configured magic and located magic use this
same path. Before/after model-pass slots supply explicit process/context bindings
for interleaving influences without a feature switch in the sequence builder.

`conditionalRequires` derives requirements from the resolved configuration and
actual source context. A requirement can carry a configuration-relative
`Diagnostic.field` path. Preparation, dependency repair and field navigation use
those declarations. Independent interaction rules in disabled magic containers
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
seed, quality and domains. `prepareAtlasGeneration` resolves and validates the
complete request before execution. The resulting configuration includes the
named sequence, effective settings, seed, feature configurations and publication
descriptors. Sending a different request with the reviewed configuration fails.

Physical history belongs to the lifecycle configuration. Ecology owns its
per-epoch ecological regimes; configured magic owns its systems and per-epoch
activity; cultures own their operative eras. The older flat parameters, process
booleans and world settings are compatibility inputs translated at preparation.
Conflicting legacy selections for operations of one coupled feature are rejected.
Unknown feature IDs, unowned parameters and invalid nested configuration fail
validation.

An optional feature-owned `configurationBinding` projects nested values into the
existing world-settings representation. It returns a patch over declared
`fields`; `epochFields` permits changing only named fields of existing epochs,
preserving every other value and the clock's identity/order. Adapters receive
clones, and undeclared patches fail. The clock owns epoch insertion/removal;
ecology owns ecological regimes and magic owns activity. New modules can keep
their configuration entirely in resolved feature bindings without adding world
settings. Selection-only catalog calls need no world history; execution
preparation binds complete configuration before composing a recipe.

Disabling a feature either omits its complete behavior or yields a dependency
diagnostic naming the consumer and missing input. Magical coastal modification
requires coastal evolution; a pressure field with zero coastal modification does
not. Legacy human `physicalEpoch` and `politicalCapacity` values remain metadata;
nondefault values produce a warning because the current human algorithms do not
simulate their effects.

## Cartographic setup

A feature can register curated `cartography` descriptors. Each control supplies
a geographic question and a small set of choices whose patches compose existing
feature selections and owned settings. For example, River plains enables networks,
floodplains and deltas while omitting incision. No generator is introduced by a
choice. Controls are discovered from the module registry; adding a raw setting
does not automatically add a primary wizard decision.

The wizard progresses through map brief, land, landscape, people and review.
Independent controls preserve unrelated settings. Matching compares only a
choice's declared inputs; other combinations appear as Custom. Initial-only
controls and choices are omitted for inherited regions. Source activity scales
existing configured systems while preserving effects, interaction rules and
shared epoch activity. Labels describe inputs and influences rather than
guaranteed geographic coverage.

Exact numeric settings and rich clocks, ecology, magic and culture configuration
remain reachable through one focused advanced editor. Closed rich disclosures
do not mount their forms. There is no full capability catalogue or execution
contract inspector in the wizard. The former stage/family/order/summary metadata
and unused occurrence/publication display copies were removed.

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

`projectGenerationSetup` reads the prepared request and registry. It exposes
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

`ProcessBehavior` supplies executable initialization, model-pass, elapsed,
transfer, material-transformation, forcing-contributor and extraction interfaces.
Elapsed behavior receives explicit years. Ecology runs two half-epoch responses,
then full-duration burial; present classification adds no biological age. Native
land-ice passes remain repeated state-changing passes. Configured magical history
advances once per epoch; located-source storage uses elapsed years.

Every process must bind a behavior; the legacy `apply` fallback is removed.
Material transformation awaits both transformation and balance, including
asynchronous failure. Behaviors remain trusted operations over shared mutable
state, rather than a runtime capability sandbox.

One `ProductLedger` drives prerequisite checks, preflight and execution. Native
`AvailableFacts` is a runtime view of that ledger. Missing, stale and explicitly
initialized-empty products differ; each consumer names the initializer whose
empty result it accepts. Epoch response products expire at epoch boundaries;
carried material, ice state and histories use separate retained products.
Explicitly omitted event writers can declare persistent neutral history. An
ordinary empty computation still becomes stale when invalidated.

Process product definitions are the provider authority. Distinct processes
cannot both produce an exclusive product; repeated invocations of one provider
remain legal. Shared-state/additive products explicitly permit multiple writers.
Preflight and runtime enforce the same rule. Retained products use separate
identities; there is no unused `freshness` option or second feature-level delivery
list. Declarations remain implementation obligations: the ledger does not infer
numerical correctness from channel allocation. The forcing-only projector has
its own contract and does not claim flow or drainage; full projection declares
only the selected output aliases it actually creates.

The numerical map stays shared and typed. Several mechanisms contribute to the
same material budget or fracture conductivity without requiring the optional
fault-network generator. Material transformations check the common sediment
budget. Conditional regional reconciliation uses the same executor, selection,
bound settings and ledger; it cannot introduce another epoch or replay ice
accumulation.

A transfer's `reconciliation` declares its possible invalidations, child sequence
and guaranteed products. These declarations travel in the reviewed recipe.
Preflight checks both changed and unchanged outcomes; execution runs only the
declared child branch and checks its guarantees before committing the outer
operation's products. Carried lake inventory is separate from outlet topology
that remeshing invalidates.

## Output publication

A module declares field or geographic publications with complete layer metadata.
Fields include units and intensive, extensive or categorical quantity semantics.
Geographic declarations identify supported kinds and network output. Native
channel conversion remains in `canonry/atlasChannels.ts`; module publication
definitions select its bindings before final projection.

The candidate publisher validates registered products, installs compatible new
layers, creates field resources and coverage, and marks generated area layers.
Unknown channels or geographic outputs fail instead of falling into a default
layer. Inactive known buffers can remain inherited working inputs without being
published. Existing compatible layer styling and authored protection remain
authoritative. The editor publishes the complete candidate only after worker
completion and the existing world-version check.

Configured magic's source/propagation declarations hold their operations,
requirements, applicable parameters and displayed choices together. Adding a
built-in strategy extends its domain schema and strategy declaration. Magic field
descriptors supply unit, quantity, initial value, carried lifetime and publication
to allocation, remeshing, advection, inheritance and projection; those adapters
no longer infer semantics from field-name suffixes.

A separate stateful system can register its own module, configuration, existing
causal-slot contributions and outputs. This does not automatically make it a
built-in `MagicSystem` or add a new causal phase. The extension acceptance fixture
executes an extensive inventory through two epochs, changes its configuration,
disables it and publishes a new layer. A separate bundled worker runs the complete
recipe using the production worker handler and real structured-clone messages;
the Node test bridge supplies the browser messaging API, while browser journeys
exercise the actual browser worker.

Located-source heat, cold, coastal pressure and erosion resistance have physical
consumers. Uplift, gravity, fertility and luminous sources currently publish
intensity only. Their existing definitions remain valid; authoring and preparation
explicitly identify the missing physical feedback. This refactor adds no new
physical model for those effects.

The climate sequence retains its existing approximation: configured thermal magic
adjusts temperature and ice after the native precipitation pass. Precipitation
from that pass remains retained until the next scheduled climate calculation.
The refactor changes contracts and composition without adding hidden climate or
ice passes to erase that approximation.
