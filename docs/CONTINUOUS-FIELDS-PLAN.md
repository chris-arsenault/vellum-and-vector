# Generation-owned continuous geography

This replaces the acceptance claims withdrawn from plans `2d1eaf21` and
`1423c25b`. Execution plan: `a97a4e37-fa0f-49ca-a876-a42bb86e7884`.

## Contract

The user's October 20–22 direction governs this work: causal tectonics, erosion,
hydrology, climate, ecology and configured magic evolve geography. Numerical
samples support those operations; they do not prescribe visible boundaries.
Generation owns one prepared continuous field throughout the process lifecycle.
Extraction, publication, queries and rendering consume that field. Preserve
physical units, receiving-water boundaries, latitude frames, ecological feedback,
scoped authored protection, geographic identities and browser-only execution.

The user's subsequent correction is explicit: keep the existing resolution
unchanged. Do not infer a metre-level target or add numerical accuracy/refinement
requirements. A hydrology rewrite is not authorized. Existing water algorithms
and budgets remain the baseline; explain any necessary algorithmic departure and
obtain agreement before implementing it. The bounded tasks below supersede the
canceled continuous-pass, reservoir-budget and portal-graph plans.

The user's latest correction changes execution order: establish working generation
with unit and integration tests before running any more browser tests. Stop the
prolonged polygon edge-case investigation. Address failures demonstrated by the
integrated generation path; retain unresolved checks without treating each as
authorization for another numerical subsystem.

The subsequent correction is explicit: stop chasing numerical precision,
sub-millimetre accuracy and performance problems; complete the features. Defer
profiling and optimization. Timings and numerical differences are not completion
prerequisites. The immediate target is generated terrain, vegetation, lakes,
connected rivers, landforms and magic geography delivered through publication,
queries and authoring. Repair functional blockers to that path with unit and
integration tests. Preserve the existing resolution, hydrology and architecture.

Rejected implementations are explicit: a regular publication map alongside a
source reconstruction map; spline fitting deferred to tile or query consumers;
natural boundaries made by smoothing binary category/component masks; hand-placed
replacement geography. Shared-consumer agreement and passing tests do not excuse
these violations. Read this contract before implementation notes after a resume.

## Implementation decisions

The existing causal numerical operations and mesh topology remain. Their arrays
become nodal field coefficients, with prepared spatial derivatives owned by the
generation workspace. Preparation is an explicit operation; evaluation cannot fit
missing coefficients. Affine unit views avoid copying native arrays into a second
publication lattice. Publication retains the same support and coefficient buffers.
Discrete identities and drainage connectivity remain discrete.

The common process lifecycle must commit changed fields after authored composition.
Within-process reads following a mutation need an explicit preparation boundary as
well. Actual array writes, including ecology, magic and remeshing, determine which
fields need preparation; product fact names alone do not enumerate those writes.
The specific derivative representation and update mechanism are implementation
choices, subject to measured cost and independent contract review.

Task 3 visual inspection found that the adaptive spline's cell-centre correction
manufactured repeating vegetation scallops even for inputs constant across the
band. The existing shared Hermite spline remains; the extra interior correction
is removed. Samples control the spline rather than requiring exact interpolation
at every centre. Exact centre matching was an agent-derived implementation check,
not a user requirement. Preserve shared-face continuity, bounds, causal behavior,
authoring and conservation checks; do not add refinement to hide the defect.

Within one support topology, derivative records and buffers retain identity so
borrowed views advance with their native values at a synchronous producer commit.
No consumer may run between mutation and preparation. Remeshing replaces support
and values together and rebinds publication; old readers belong to the old support.
Structured-cloned delivery is an isolated completed snapshot.

Natural structures retain quantitative predicates over causal fields. Ecology uses
its cover/environment decision tree; landforms use relief and material history;
magic retains configured seed-and-retain semantics; lake components use terrain
at the physical stage and drainage associations. Extraction traces those fields
and attaches identity. It does not fit a field to the resulting labels.

M2 review found that tracing correct polygons alone left nearest-sample category
queries as a competing authority. Classification therefore prepares ordered
category regions before publication. Landform, biome, natural cover, material and
magic queries use those regions; native labels are computational samples. Feature
extraction consumes the same prepared geography. Water stages and ecological
inputs must be prepared before this classification, including runs without magic.

River channel geometry owns shared junctions, explicit face crossings and
terrain-guided paths. Each connecting chord stays inside its routed control volume.
The producer chooses a quadratic curve within each convex control volume;
de Casteljau subdivision resolves that curve without repeating valley searches.
Physical coverage uses JSTS variable-width buffers with explicit station radii.
The existing linearly interpolated drainage elevation profile belongs to that channel graph; the
interpolated surrounding terrain is not an off-channel hydraulic-head model.
These are implementation choices preserving causal routing, not an authorization
to smooth a mesh path in a renderer or feature extractor.

Plate motion follows the tectonic producer's warped nearest-site provinces. Each
province supplies a constant material velocity; its geographic boundary comes
from the distance predicates and recorded warp parameters. Interpolating those
velocities across province identities introduces deformation absent from the
reference process. M2 integration exposed this error when occurrence transport
exhausted 4 GB of heap. The generic filled-area deformation prototype is being
replaced by province-owned translation, shared material-arrival ownership and
split geological structures. Keep the actual source partition and epoch warp
seed; site drift uses raw motion while material transport uses rounded motion.

Rigid province motion covers generated velocities. Authored motion is a separate,
existing input: scoped X and Y edits must compose over that law in their actual
footprints, including patches smaller than a numerical cell. Unchanged pieces
remain rigid; variable authored pieces require local deformation and arrival
density from their area change. Local integration starts at authored support and
quality detail, then checks displacement at triangle probes against the existing
10 m geographic approximation after applying the actual epoch distance. This is
an empirical integration check, not a universal error certificate. Conservative
transfer clips source preimages rather than dividing quantized image area by a
Jacobian; it retains material through compression and geographic collapse. The
same composed motion must drive physical
transport, history and geological structures. Native sample overrides alone do
not satisfy this requirement. Each inherited motion component retains its own
partition or prepared parent authority until a tectonic producer replaces it.

Water keeps its existing causal routing, lake budgets and erosion rules. Its
continuous representation must be owned by generation and consumed directly.
Retain preparation after field mutations, physical stages, confluences, receiving
water and material accounting. Do not introduce a replacement hydraulic solver,
additional carving, or stage changes to make geometry fit.

The attempted shared-pass solver and its reservoir controls were removed
under task 1. A reproduced failure showed a prescribed route
through numerical centres overstates the available escape height. The proposed
portal graph and connected-lobe budget replacement are canceled. Do not conceal
remaining water-boundary failures by weakening product
checks or restoring consumer-side mask smoothing.

The bounded water repair uses the existing lake outlet records and drainage
parents to delimit each pool's generated footprint. A cross-section at the
recorded outlet link separates the terrain-at-stage contour from downstream water;
following existing drainage parents associates the section with its receiving
pool across intervening dry cells. This is a geographic representation choice,
not a spill-height computation or hydrology change. All three retained reservoir
checks pass with unchanged stages, budgets, resolution and assertions.

## Milestones

### M0 — Causal field lifecycle

Split eager preparation from pure evaluation. Follow a real causal mutation into
the next dependent process, then through a structured-cloned result. Establish
ownership and coefficient freshness explicitly before expanding publication.

Execution:

1. `smoothSamples.ts`: represent serializable prepared derivatives; prepare eagerly
   and evaluate without fitting. Preserve useful continuous mathematics and bounds.
2. Physical field/process lifecycle: own prepared fields with the numerical degrees
   of freedom; declare actual mutations, cover internal dependency boundaries.
3. Verify a causal process mutation and next-process read, cloned consumer behavior,
   and independent source review. Partial implementation is not phase completion.

### M1 — One field through publication and authoring [depends on M0]

Remove regular physical publication resampling and duplicate reconstruction stores.
Adapt domain schemas, scoped composition, publication, water, queries and raster
workers to prepared fields. Preserve adaptive children and protected patches.
Verify off-sample reads, unit transformations, worker delivery and local authoring.

### M2 — Continuous natural structures [depends on M1]

Replace landform/magic/lake category-mask contours with causal field predicates and
connected geography. Use the same ecology semantics for world and child scopes.
Verify topology, process causality, identity and shared point/polygon boundaries.

Execution:

1. Trace water at physical stage and associate connected wet components with body
   members. Remove fitted body-membership masks. Remove the ecology label fallback;
   world and adaptive child scopes require prepared ecological fields.
2. Trace landform predicates over erosion, deposition, relief and flow; trace magic
   configured quantitative conditions and retain components reached by causal seeds.
   Discrete identity selects components, never defines a fitted boundary.
3. Move river path preparation into causal channel geometry, preserving confluences,
   receiving water and profiles. Review the removal list independently and run
   focused geographic, authoring and identity checks before accepting M2.

### M3 — Complete feature delivery [depends on M2]

Run unit and integration checks over the complete generation-to-editor contract,
including water connections, ecological regions, magic history, publication and
authoring. Fix functional failures and complete remaining feature behavior. Browser
checks follow working generation. Precision and performance investigations are
deferred under the user's correction; retain existing failed checks honestly.

## Bounded remaining tasks

Work one bounded task at a time. The latest user correction puts the integrated
generation test ahead of further isolated geometry work or browser testing.
At each boundary report the code
changed, the observed result, checks run and any remaining failure. Do not convert
a failed check into authorization for a new subsystem. Tests for agent-invented
precision or replacement algorithms must not become product requirements.

Comparison points: `8c49645` precedes the rejected continuous-field commit;
`66eded2` introduced publication reconstruction copies and consumer fitting;
`48f3ea7` only optimized ecology test predicates. Use source-level comparisons,
not whole-commit rollback: `66eded2` also contains climate work to preserve.

1. **Remove unauthorized hydrology changes — completed.** Review and selectively remove the
   new pass-driven flood/guidance/incision changes, lake-discovery changes and
   experimental reservoir controls. Preserve generator preparation hooks and
   unrelated water/climate improvements. Done when existing hydrology behavior
   is restored, its focused checks pass, and the removed additions are identified.
   No resolution or quality-setting changes.
2. **Verify the generator-to-consumer field path — completed.** Retain the implemented M0/M1
   work. Follow a real process mutation through preparation, publication, worker
   delivery and the first tile/query read. Done when the same field authority is
   used throughout, with no consumer fitting or duplicate publication lattice,
   and authored/inherited field checks pass. Repair concrete gaps only.
3. **Finish vegetation end to end — completed.** Scope: ecology producers, biome/cover
   classification, vegetation geometry and its map consumers. Done when a real
   generated scene has continuous cover and boundaries following that cover at
   the existing resolution, with no first-view smoothing work. Check a causal
   climate/cover change and authored protection; inspect the rendered result.
4. **Finish water representation without replacing hydrology — implemented; integration pending.** Scope: producer
   lake/river geography and its extraction/publication consumers. Done when lake
   identity/stages, connected rivers and receiving-water boundaries survive the
   existing generation workflow, and consumers reuse prepared geography. A solver
   incompatibility must be reported with its concrete case before any algorithm
   expansion; it cannot be hidden by a mask, changed stage or omitted feature.
5. **Finish the remaining natural regions — in progress.** Scope: landform/magic predicates,
   category geography and polygon operations. Resolve the reproduced invalid
   subtraction using actual operands. Done when these regions are prepared from
   causal fields without categorical-mask fitting, and the full classification
   replay completes. Preserve demonstrated spatial-index and noding improvements.
6. **Complete the product path.** Establish working generation and publication
   through unit and integration tests at existing settings. Resolve functional
   failures across the requested features, then inspect the editor and run required
   CI. Do not resume a precision or performance campaign. Completion requires a
   working integrated result, not just focused tests.

Task 1 restored the previous flood, guidance, lake discovery and outlet incision;
the erosion preparation hook remains. Removed the pass solver, profile envelopes,
reservoir cuts and their unused state. Restored the earlier channel approximation
policy without changing mesh or quality settings. Existing water/river checks pass
(26 tests), as does typechecking. The three retained reservoir-boundary failures
were subsequently repaired in task 4. Task 2 passes 24 focused checks, including a real
tectonic process through publication, cloned delivery and the first tile read;
missing producer coefficients are rejected by the tile consumer. Task 3 removed
the adaptive cell-centre correction responsible for mesh scallops. Forty-six
focused checks and eighteen additional contour/publication checks pass. The
browser displays cover and boundaries produced by ecology initialization,
evolution, response and presentation across a rainfall gradient. Selection,
protection, refinement and export pass; the inspected scene has no repeating
cell scallops. Feedback reads now evaluate the prepared field instead of treating
stored spline coefficients as point values.

Task 4's stage-only contour merged downstream water. The producer now uses existing
outlet links and receiving-pool relationships to delimit that contour. All three
retained reservoir checks pass without changing their assertions. Complete-world
integration remains pending.

Task 5 captured the actual invalid polygon subtraction. Floating overlay output
was valid; the existing precision reducer created a self-intersection. The common
output path now re-nodes invalid reduced polygon boundaries at unchanged declared
precision and reduces mixed collection members individually. A regression retains
the failing boundary segments. Classification now traces only unclaimed geography;
landform rules no longer repeat exclusions already applied by ordered consumers.
The complete-world integration has passed natural classification. Magic-history
checks now compare evaluated continuous values while retaining exact discrete epoch
markers; the broader feature group passes 43 tests. Water checks also pass as noted
above. Magic classification repeatedly rebuilt the complete seed geometry for each
retained component; it now uses the existing reusable intersection-area operation,
with the common polygon overlay behavior. All 24 focused magic/spatial checks pass.
The complete-world run with that change was stopped without a result after it
completed all three epochs and natural classification but did not return from magic
classification. Feature extraction and final publication remain unverified. Contour closure, lint and timed-out
integration checks remain unresolved. Precision and performance investigations are
deferred. No further browser test or Standard measurement is a prerequisite to
establishing working generation through unit and integration tests.

The latest broad unit/integration run passes 615 tests with one retained contour-closure
failure. Three previously timed-out integrations were excluded from that run.
Typechecking and the production build pass. These results
do not close M2 or M3 while full feature delivery remains unverified.

## Prior implementation evidence

M0 and M1 are accepted after focused causal tests and independent ownership review.
Prepared publication, typed unit views, consumer migration and owner rebinding are
implemented. Authored motion has passed independent review. M2 remains open for the
bounded tasks above; M3 remains pending. Joint precision noding
resolved the reproduced third-epoch plate overlay failure. The latest Draft run
then exhausted the heap in river coverage construction: recursive full-cell
valley searches produced a 51,537 km path across a 25 km edge. Fixed producer curves
and standard variable-width buffering repair that path and coverage allocation;
full classification replay remains open.
Boolean contour tracing now restricts later predicates to their existing geographic
scope. Fixed-support scalar combinations evaluate existing prepared jets together
to retain cancellation in interval bounds; adaptive clamped fields retain their
separate bounds. The attempted continuous water solver and spill sections were
removed under task 1. An earlier Draft pass
does not validate the current implementation. Pre-existing changes to
`generation-workflows.md` and `generation-control-mappings.md` belong to separate
work and are outside this edit scope.
