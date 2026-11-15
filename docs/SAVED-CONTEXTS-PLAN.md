# Bounded resume and saved contexts

Status: planned, implementation pending. Owner direction: 2026-11-15.
Sulion root: `2d50d815-892d-48a7-9728-b377dda273cc`.
This turn writes the plan only. No implementation or deployment is claimed.

## Outcome and governing boundaries

Extend the existing application so interrupted world and regional jobs can resume
from their latest supported checkpoint; worlds, regions, jobs and orphans can be
found and deleted together; compatible older data remains usable without migrations.

User requirements, from the current conversation:

- Resume generation and refinement at useful, limited points with low overhead.
  Keep **one checkpoint per job**, replacing its data rather than accumulating versions.
- Integrate saved contexts and deletion into the map UI, including world/region
  relationships and orphans. GIS and numerical retention/deletion must agree.
- Attempt to load older data using the current format. Compatible data works;
  incompatible data does not load. Do not implement migrations or erase old data
  merely because the application version changed.
- The latest correction is explicit: **do not chase arbitrary resume points**.
  Extend existing mechanisms; do not build a general recovery framework, a new
  lifecycle-service architecture, or a general storage-envelope framework.

These requests supersede the older blanket exclusions of recovery and older-data
loading, only within this scope. They do not authorize legacy converters, numerical
parity work, editing/undo work, deployment changes, or changes to unrelated plans.

Preserve the subsystem boundaries in [ADR 0015](adr/0015-finished-maps-and-execution-hosts.md)
and the owner's [architecture canvas](architecture/subsystems.arconis), especially
`r_platform`, `backend`, and `browser`: Rust generation owns private numerical data;
extraction publishes GIS products; presentation reads only GIS through the existing
local/remote facade. The host coordinates lifecycle operations. `atlas-gis` acquires
no generation dependency. Only pure browser and pure backend execution are supported.
Children remain independent and pinned to captured inputs. Browser completed maps
retain explicit Save; recoverable browser jobs are a separate retention concern.

## Existing mechanisms to extend

| Source                                                                                                      | Reuse and current gap                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `archive/typescript/frontend/src/harness/resumePoint.ts`, `fieldSnapshot.ts`; archived `mapRunnerResume.ts` | Capture/restore reference, including material cargo, owner state, history and dependency facts. Port the behavior into Rust; do not import the archive or copy its per-epoch snapshot accumulation or missing-field fallback. |
| `crates/atlas-generation/src/atlas/dispatch/run.rs`, `workflow.rs`                                          | Existing sequence traversal and completed boundaries; no Rust restore entry point.                                                                                                                                            |
| `crates/atlas-generation/src/atlas/sequence.rs`, `sequence/people.rs`                                       | Formation and configured physical/human epoch boundaries.                                                                                                                                                                     |
| `crates/atlas-generation/src/atlas/regional/sequence.rs`                                                    | Initial detail and development rounds are composed as a flat process sequence; epoch callbacks alone would miss them.                                                                                                         |
| `crates/atlas-host/src/native_jobs.rs`, `browser_workspace.rs`, `browser_job.rs`                            | Existing job and host ownership. Native jobs are memory-only; browser working catalogs are disposable.                                                                                                                        |
| `crates/atlas-host/src/private_inputs.rs`, `local_inputs.rs`, `numerical_resource.rs`                       | Completed inputs and shared immutable resource references. These are not live checkpoints.                                                                                                                                    |
| `crates/atlas-gis/src/{map_store,postgres_maps}/library.rs`, `map_protocol/library.rs`                      | Existing save/list/related operations; no complete context-deletion operation.                                                                                                                                                |
| `frontend/src/FinishedMapLibrary.tsx`, `FinishedGeneration.tsx`, `usePublishedNavigation.ts`                | Existing library, job progress and explicit map navigation to extend without replacing application styling.                                                                                                                   |

The completed server-usability work supplies map discovery, timings and the regional
modal. Keep it; this plan adds recovery and lifecycle behavior. Its closed plan is
not reopened. Existing unrelated dirty files and benchmark work are outside scope.

## Fixed checkpoint contract

The following is the implementation allowlist, chosen from the current schedules.
It is not a general facility for choosing a process number or serializing at any yield.

| Job    | Supported boundary                                                                          | What may need repeating after interruption                       |
| ------ | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| World  | Initial formation and ecology initialization complete, before physical history begins       | Work since formation if the first epoch was interrupted          |
| World  | Each completed outer physical-history epoch; each completed outer human era where enabled   | The unfinished epoch/era; nested work has no separate checkpoint |
| Region | Captured context, initial relief/detail and ecology initialization complete, before round 1 | The unfinished first development round                           |
| Region | Each complete development round, after its final routing operation                          | The unfinished next round or later finalization                  |
| Either | All scheduled generation work complete, immediately before final resource/GIS publication   | Publication may restart; numerical generation does not           |

Rules for all supported boundaries:

- Keep one latest committed checkpoint under the stable job identity. Overwrite its
  contents; no epoch files, revision history, selectable snapshots or backup chain.
  Retire it when the result is durably published or the job is deleted.
- Replace checkpoint data and its boundary marker consistently with ordinary storage
  transactions/atomic replacement. Temporary journal/staging space is not retained
  checkpoint history. Do not destroy the last usable checkpoint before replacement
  commits, and do not claim zero write or temporary-space cost.
- A restart offers a UI action to resume; it does not automatically launch work.
  Resume means continue from the latest supported boundary, not from the crash site.
  Before the first checkpoint, offer a clearly labelled restart from the beginning.
- Persist the original effective request, job/map identities, captured parent revision
  and input references. A resumed region does not recapture its parent's current state.
- Use the Memento idea locally: each existing owner captures/restores its continuing
  data through a typed contract. Rebuild services, queries, spatial indexes and other
  disposable caches. Preserve rock/material cargo, water, magic, people, regional
  continuing state, records, history and scheduler facts where subsequent work needs them.
  Do not serialize the object graph or bypass owner mutation boundaries.
- Serialize numerical blocks without assembling a second full in-memory world merely
  to encode it. Reuse pinned immutable inputs by reference. Do not introduce delta
  chains, event sourcing, a generic snapshot engine or a new compression subsystem.
- A failed checkpoint write must not advance the recorded resume point. Report it and
  retain the previous checkpoint; map production must not report a nonexistent recovery
  point. Restore errors remain errors rather than substituting an approximate state.
- Publication retries use the same intended result identity and existing atomic-head
  behavior; they must not create a second world. The pre-publication checkpoint does
  not imply recovery inside extraction, raster encoding, SQL batches or tile creation.

**Explicitly excluded:** per-process snapshots, solver iterations, timer checkpoints,
arbitrary instruction offsets, nested-epoch checkpoints, custom checkpoint selection,
pause-anywhere, automatic retry loops, distributed execution and exact replay/parity.
If a long segment is interrupted, recompute that segment. Its duration is not a reason
to add another checkpoint kind. Do not reorder algorithms to manufacture more boundaries.

## Saved-context and compatibility design

Use existing Rust host operations to coordinate stores; do not add a separate service
layer. Add enough durable job/context metadata to list records without loading numerical
state or successfully decoding the whole map. This is needed for interrupted jobs and
incompatible/orphaned records to remain discoverable and deletable.

The library opens on worlds with their regions and jobs. A world exposes its children;
a region exposes ancestry, children and associated work. Keep explicit map navigation.
Show interrupted, failed and incomplete work in context, with an unattached section for
missing parents, unmatched GIS/numerical records and unreferenced stored resources.
Do not invent parentage. Resource inspection is a management operation, not a viewer read.

Deletion removes the selected map's GIS records, private references, saved view state
and unshared files, or a selected job's metadata, checkpoint and unshared working inputs.
Deleting a job does not delete its completed result. Proposed UI behavior: deleting a
parent alone leaves independent children accessible as unattached maps; an explicit
delete-with-descendants action states its scope. Running jobs must stop before their
resources are removed. Surviving maps and jobs retain all shared input bytes they need.

Use existing database transactions for related metadata where possible; host coordination
must account for separate browser catalogs and nontransactional filesystem removal.
Unfinished cleanup must be safe to retry and visible, not an unreported partial deletion.
No background garbage-collection platform is required. Do not infer that an unknown or
incompatible resource is unreferenced merely because its payload failed to decode.

For compatibility, extend existing repository codecs with a common load/save policy and
format metadata. This is the repository pattern already present, not a new envelope or
plugin framework. Keep format versions separate from map revisions, optimistic write
versions and application releases. Each subsystem owns its typed current payload reader.

- Attempt the current decoder and required domain/resource validation on old records;
  a different stored version alone is not grounds to wipe data or demand conversion.
- Existing records without the new metadata are tried as their actual current payload,
  without a bulk rewrite or a second legacy generator/reader implementation.
- Successful subsequent writes use current metadata. Failed loads preserve original
  bytes and return a useful compatibility error; the context list remains usable.
- Shape compatibility is not enough when units, representation or meaning have changed.
  Those required semantics belong in the owning format contract. No fabricated required
  state, silent field dropping or alternate old-version implementations.
- Apply compatibility at the requested capability: GIS reads validate GIS contracts;
  refinement validates captured numerical inputs; resume validates owner snapshots and
  the supported schedule boundary. Incompatible numerical state cannot be resumed or
  refined, but must not force the GIS reader to open generation storage.
- Do not add migration runners, converters, per-version switch chains, or promise that
  incompatible database layouts can be opened. Report incompatibility without resetting
  the database. Add new job metadata storage without rewriting existing world payloads.

## Milestones

All milestones are pending. Mechanisms above are implementation choices within the
user boundaries; simplify them when evidence supports it. Do not expand checkpoint scope.

### M0 — Current-format save/load policy

Sulion phase: `9eeb3b9b-02ca-4c60-8403-8037293b05b1`.
Extend current GIS, private-input and numerical readers/writers with format metadata,
shared compatibility policy and listable failure metadata. Apply the same policy to the
checkpoint records introduced in M1. Document actual compatibility semantics in code.
Acceptance: compatible older payloads load; incompatible ones remain stored and listed;
normal viewing never opens private generation storage. Check explicit input records,
missing required fields, semantic incompatibility and resource-reference failures with
focused contract tests. Do not generate worlds to test decoding.

### M1 — Fixed-boundary job recovery [depends on M0]

Sulion phase: `ff5c2dcb-9cb9-483c-8fc1-8aa36ae6d534`.
Inventory continuing state at the allowlisted boundaries against the archived harness
and current Rust owners; implement capture/restore and scheduler continuation. Persist
jobs and captured input ownership on their execution host, replacing one checkpoint.
Connect restart discovery and explicit Resume through the existing generation facade.
Browser recovery reopens its local job; native recovery needs no browser runtime.
Acceptance: world and regional jobs continue after host restart from the latest committed
supported boundary; unfinished segments repeat; earlier completed segments are skipped;
pre-publication recovery produces one result. Unit checks exercise explicit state and
scheduler contracts, including a failed replacement retaining the previous checkpoint.
Shared real-workload interruption checks belong in M4, not a new harness per owner.

### M2 — Coherent context inventory and deletion [depends on M0, M1]

Sulion phase: `441814d9-e0c3-48e7-a515-327dcc74932c`.
Extend existing host/catalog operations for complete and incomplete maps, jobs, missing
parents, unmatched store records and unreferenced resources. Coordinate metadata removal,
shared-resource retention and file cleanup. Keep lifecycle mutations separate from the
GIS-only read capability. Acceptance: deleting a parent leaves independent children
viewable and refinable; deleting a job leaves its completed map; removing the last
reference permits byte cleanup; interrupted cleanup can finish without breaking live
references. Use explicit small catalog/resource fixtures on both storage adapters.

### M3 — Integrated saved-context browser [depends on M1, M2]

Sulion phase: `7b0b1160-9516-4fab-acfb-1e9a7ca275f0`.
Extend the existing library, progress UI and navigation with world/region relationships,
Resume/Open/Delete actions, scope-aware deletion and unattached/incompatible entries.
Preserve existing styling, regional modal and browser explicit saves. Acceptance: users
can find a finished or abandoned refinement from its world or the unattached section,
resume eligible jobs and delete selected contexts without losing unrelated maps.
Extend existing supplied-fixture UI scenarios; no real generation for UI setup.

### M4 — Focused validation and consolidation [depends on M0–M3]

Sulion phase: `695bc557-bf85-4fb6-aafd-b4705e6e6157`.
Run relevant lint, type, Rust, architecture and focused storage/UI checks. Use the same
small/medium Draft world and region workload definitions already established to measure
checkpoint write duration, peak temporary space and final retained size. Reuse outputs
for interruption/resume and publication checks; no Fine runs, numerical accuracy chase,
exact-replay comparisons, full interruption matrix or unrelated benchmark project.
Report actual overhead; if material, improve encoding/I/O or propose fewer allowlisted
boundaries rather than adding recovery precision or weakening generated behavior.

Update affected owner-direction marks and their registry alongside implementation.
Consolidate implemented behavior into the product contract, generation guide and ADR
0015; revise their obsolete recovery exclusions. Preserve the source architecture
diagrams and update only relevant annotations if needed. Then delete this working plan
and its repository references and close the Sulion plan. No separate validation report.

## Current state and next action

Source inspection and the bounded design are complete; implementation has not started.
No blocking user choice remains. Next implementation phase is M0. Re-read current Sulion
guidance and the affected source before editing; keep unrelated plans and changes alone.
Actual checkpoint overhead is unmeasured. This plan makes no time or throughput guarantee.
