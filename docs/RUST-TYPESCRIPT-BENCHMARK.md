# Native Rust and historical TypeScript Draft comparison

Requested 2026-11-15. All eight measurements are complete: two sizes, world
generation and sub-area refinement, in native Rust and historical TypeScript.
Sulion plan: `be2ed013-bed7-4693-991f-3f282c8e0922`.

## Completed measurements

These are corrected-source runs after the failures described below. They ran
sequentially without overlapping benchmark builds. All times include completed
publication; refinement excludes parent generation.

| Case | Native Rust | Historical TypeScript, corrected | TypeScript / Rust |
| --- | ---: | ---: | ---: |
| Small Draft world | 60.678 s | 99.532 s | 1.64 |
| Small Draft refinement | 150.720 s | 290.546 s | 1.93 |
| Medium Draft world | 203.098 s | 375.762 s | 1.85 |
| Medium Draft refinement | 494.643 s | 1,040.356 s | 2.10 |

All four completed workflows favour native Rust, by 1.64–2.10×. These ratios compare the
applications, including their different storage and publication implementations.
They do not isolate a language/compiler effect or establish output-quality parity.
These are single observations on a development server with other processes present;
there are no repeated-run confidence intervals.
This measures the requested Draft workloads, not the 4,000 × 3,000 km Standard
configuration discussed earlier; it does not explain that earlier 55-minute report.

## Fixed workloads and timing boundaries

| Case | Parent dimensions | Quality and seed | Selection rectangle, metres | Actual child extent |
| --- | --- | --- | --- | --- |
| Small | 1,000 × 750 km | Draft, 104729 | [250000, 187500, 750000, 562500] | 600 × 475 km |
| Medium | 2,000 × 1,500 km | Draft, 104729 | [500000, 375000, 1500000, 1125000] | 1,200 × 950 km |

Both applications add a 10% context margin. Each generates its own parent before
refining the same geometric selection. All default domains and history remain
enabled: physical, magic, cultural, political and built. No smaller substitute,
physical-only configuration, changed seed or fixture parent was used after failures.

Canonical inputs are `.artifacts/matched-benchmark/{small,medium}-input.json`,
exported through the historical application's normal Draft configuration path.
The Rust validator accepted their values unchanged; its normalized representation
only added explicit nulls for absent optional fields.

- Native: release `atlas_server` on this server, invoked through its real generation
  facade. The Node driver submits and observes requests; generation runs in native
  Rust. No Rust WASM generator or browser participates.
- TypeScript: the original headless Node harness invokes `generateWorld` and
  `runGeneration`, using its SQLite/file workspace and original GEOS/SQLite WASM
  dependencies. No browser or Rust generator participates.
- Native timing includes submission, private-input preparation, generation,
  finished GIS publication and retained refinement inputs. Completion and progress
  are observed once per second, so markers may lag by that interval.
- TypeScript timing includes import or child creation, preparation, generation and
  publication. Parent checkpoint export is outside its timer.
- Builds, dependency installation, service startup and post-completion map reads
  are excluded. Comparative runs are serial. Diagnostic runs that overlapped
  compilation are excluded from comparisons.

## Sources and environment

- Rust base: `6502859f81d32d1d199544ee0c4ba99d22bcf81e`.
- TypeScript base: `dc376b4318a017ba4b5fa479900d13e6969f580b`, before migration
  checkpoint `e59323a`. This predates two final archived water changes; corrected
  measurements include those exact archived files.
- Source exports and drivers remain under `.artifacts/matched-benchmark/`.
  No branch switch, clone or production deployment was required.
- Machine: Intel Core i5-8500, six physical cores, approximately 31 GiB RAM, no swap;
  Node 24.19.0. Other development processes were present.
- Rust: `rustc 1.99.0-dev (483768fa7 2026-11-12) (ohm-1.99.0-33)`, repository release
  profile with thin LTO.
- Native storage: disposable PostgreSQL 16/PostGIS 3.5 on loopback port 54349,
  separate map and generation databases per size, local resource files.
  Historical storage: its existing headless SQLite/file harness.
- No TrueNAS or production service was used.

## Workload differences and phase observations

Matching creator inputs does not imply identical geography or identical work.
World surface sample counts match: 1,036 for small and 3,960 for medium, per field.
TypeScript reports 962 and 4,050 physical lattice cells for those worlds. Surface
samples and physical lattice cells are distinct representations.

Small refinement differs: TypeScript has 16,384 surface samples and 8,502 physical
lattice cells; native stores 7,392 new samples per field. Native also retains ten
captured parent field records with 1,036 samples each. The TypeScript regional
surface uses adaptive, power-of-two subdivision in `atlasInitialState.ts`.
Native physical lattice counts have not been captured, so surface counts must not
be presented as a physical-cell comparison. Both child extents are 600 × 475 km.
The native medium child stores 29,032 new samples per field, plus its captured
3,960-sample parent records. The TypeScript medium child has 65,536 surface samples
and 31,350 physical lattice cells. Both extents are 1,200 × 950 km.

The historical application persists numerical resources and feature records for
its viewer. Native additionally creates finished GIS raster products. Original
native parent catalogs contain 28 vector layers and 903 / 931 raster layers for
small / medium. These are catalog entries, not visible overlays or physical cells;
their existence does not establish that this publication volume is necessary.

These intervals use the first `Extracting ocean regions` and `Validating completed
geography` progress markers, not CPU profiling. The final interval includes
validation, publication and remaining persistence, not database writes alone.

| Small-case interval | Native world | TypeScript world | Native refinement | TypeScript refinement |
| --- | ---: | ---: | ---: | ---: |
| Submission through start of feature extraction | 31.35 s | 80.00 s | 84.33 s | 209.97 s |
| Feature extraction through start of completed-geography validation | 11.18 s | 15.31 s | 11.13 s | 74.62 s |
| Completed-geography validation through terminal completion | 18.14 s | 4.22 s | 55.27 s | 5.96 s |

Native reaches feature extraction earlier but spends longer in final publication.
The final row does not represent equivalent work because of finished GIS products.
All complete workflows still finish sooner in native.

| Medium-case interval | Native world | TypeScript world | Native refinement | TypeScript refinement |
| --- | ---: | ---: | ---: | ---: |
| Submission through start of feature extraction | 132.65 s | 322.64 s | 317.98 s | 890.19 s |
| Feature extraction through start of completed-geography validation | 32.23 s | 46.82 s | 31.13 s | 126.49 s |
| Completed-geography validation through terminal completion | 38.21 s | 6.30 s | 145.53 s | 23.67 s |

Native medium refinement's final interval is 29.4% of its total time, versus 2.3%
for historical TypeScript. Publication remains a material native cost even though
native is faster overall. The differing products prevent attributing that gap to
database choice alone; this benchmark does not identify a publication bottleneck.

Small native world used 53.03 s process CPU; refinement used 131.91 s process CPU
and reached a sampled peak RSS of 304.20 MiB. TypeScript small world used 116.635 s
process CPU and refinement used 316.087 s. Node/V8 worker threads can make process
CPU exceed elapsed time. TypeScript peak RSS was not captured; no comparative
peak-memory claim is made.

## Untouched failures and necessary corrections

The initial stopped attempt was incomplete: failures did not supply the requested
comparison. Original results remain intact; failure times are never used as
completion times or speedup denominators.

| Implementation | Case | World generation | Refinement | Failure |
| --- | --- | --- | --- | --- |
| Native Rust | Small | 66.097 s, completed | failed at 93.361 s | Invalid river geometry |
| Native Rust | Medium | 210.145 s, completed | failed at 331.041 s | Invalid river geometry |
| Historical TypeScript | Small | failed at 78.956 s | no completed parent | Invalid receiving reach |
| Historical TypeScript | Medium | failed at 344.684 s | no completed parent | Collapsed river geometry |

Corrections used for completed measurements:

1. **Final archived water source restored in the historical snapshot.** A diagnostic
   small world found dry reach 374 receiving itself (`downstream: 374`). Archived
   `water/reachEvolution.ts` releases dry courses' obsolete ownership. Archived
   `world/fluvial.ts` contains the final river-mouth sediment change. Both exact
   files came from `e59323a:archive/typescript/packages/generation/src/`; both
   behaviors were already present in Rust. The initial claim that `dc376b4`
   included every final water change was wrong. No Rust adapters were imported.
2. **Former-course duplicate vertices removed in both implementations.** Native
   rejected three copies of `[794100, 528780]`; TypeScript rejected three copies
   of `[203126, 264471]` in `publishFormerCourses`. Rounded cell positions were
   checked by vertex count without removing consecutive duplicates. Native
   `atlas/state/rivers/dry.rs` and historical `area/riverPublish.ts` now remove those
   duplicates before their existing length checks. Retained course data and
   nonzero line extent remain unchanged.
3. **Native captured-river restoration publishes its network.** After the preceding
   fix, native small refinement failed at 102.471 s because Ferra River was restored
   as a feature without its reach and endpoint nodes. Its geometry was valid.
   `field/refinement/river_lineage.rs` now returns restored features to the existing
   `State::write_network` publisher in `atlas/state/rivers.rs`, which creates feature
   and graph records together. Network validation remains enabled.

Main working-tree changes are confined to those three Rust files and this report.
Historical TypeScript corrections live only in the isolated benchmark snapshot.
No geometry/network validation was disabled, no substitute generation algorithm
was introduced, and no numerical-accuracy or replay campaign was performed.

Existing archived water/deposition tests passed (14 tests), as did existing
TypeScript river-publication tests (7 tests). Touched TypeScript files passed lint;
native formatting and the release build passed. Completed workloads exercise the
actual generation and publication paths.

## Retained artifacts

Everything below is under `.artifacts/matched-benchmark/`, outside routine CI:

- `small-input.json`, `medium-input.json`: canonical configurations.
- `rust-source/`, `typescript-source/`: source exports with recorded corrections.
- `native.mjs`, `typescript-source/frontend/src/harness/matched.harness.ts`: drivers.
- Root `rust-*.json` and `typescript-*.json`, matching `.jsonl` and `.log` files:
  untouched baseline results/progress. Root PostgreSQL dumps preserve parent data.
- `diagnostic/`, `diagnostic2/`, `network-diagnostic/`, `corrected/`: diagnostic
  runs, expanded errors, source checks and early corrected attempts.
- `final/rust-small-create.json`: uncontended corrected native small world.
  `final/rust-small/` retains its resources and successful refinement resources.
  This world was generated before the later network-restoration repair, which
  changes regional refinement rather than world generation.
- `final/typescript-small-*.json`: completed diagnostic runs overlapping a native
  build. Their 107.727 s / 307.389 s timings are excluded from ratios.
- `measured/rust-small-refine.json`: completed native small refinement using its
  saved parent, whose generation is excluded from the refinement timer.
- `measured/typescript-small-{create,refine}.json`: completed corrected small runs.
- `measured/rust-medium-*.json`: completed corrected medium native results.
- `measured/typescript-medium-{create,refine}.json`: completed corrected medium
  TypeScript results, with the historical implementation's own saved parent.
- `measured/*-map.json` and `*-fields.jsonl`: native map/field metadata.
- Historical `*-workspace/` directories retain completed parent checkpoints;
  successful child output metadata is retained in result JSON.
- Build/install logs are separate from timed workloads. Diagnostic formatting was
  removed before completed measurements.
- `measured/final_{maps,generation}_{small,medium}.dump`: final native parent/child
  PostgreSQL snapshots. Resource bytes remain in the corresponding run directories.

The native driver stopped its server after each case. Final database dumps are
saved and their archive catalogs were readable. The temporary database is stopped.
No benchmark server or container remains running. Native fixes remain local and
uncommitted; no deployment was performed.
