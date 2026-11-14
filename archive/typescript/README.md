# TypeScript generation reference

The owner directed on 2026-11-14 that active TypeScript be limited to UI, view code
and local/remote facade bindings. This directory preserves the TypeScript generator,
its tests and the old development harness for optional port-quality investigation.
It is outside the pnpm workspace, normal CI and production imports. Do not add an
application fallback, re-export or symlink into this archive.

`packages/generation/src` retains the source before the TypeScript world/regional
runners were removed. The archived frontend harness and workload configurations
describe their original invocation paths. These are source references, not a
currently wired independent application; their supporting frontend and storage
imports require deliberate setup before running an optional reference workload.

Configuration preparation, naming and map publication run in Rust. The archive does
not authorize restoring those TypeScript implementations or reproducing their interfaces.
Use the reference to understand domain behavior and ownership, not numerical replay
or byte-identical results. Preserve the original source and license notices.
