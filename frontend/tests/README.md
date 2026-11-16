# Browser scenarios

Import `test` and `expect` from `./uiTest`. Ordinary scenarios start from a
completed, supplied map:

```ts
import { test, expect } from "./uiTest";
import { openFixtureMap } from "./harness";

test("finds a named place in the registry", async ({ page }) => {
  await openFixtureMap(page);
  // Open the registry and assert the user-visible result.
});
```

The Playwright server command runs `make browser-fixture` once before the build.
The Rust example publishes 25 explicit samples and supplied geographic records
through the ordinary publication and save path. It does not run generation
algorithms. Its ignored artifact contains only the saved GIS catalog and map assets,
with no private numerical resources.

`PreparedMaps` loads those files once per Playwright worker. Each scenario receives
independent OPFS copies and opens the saved map through the normal facade.
`openFixtureMap` returns the published map reference. Extend the supplied records
when a UI assertion needs additional geography; do not generate a world for setup.

Playwright still gives each test an independent context, including an isolated
persistent profile for WebKit. Reuse immutable map data, not live pages, writable
contexts or another test's output. A retry or different test order must work.

## Rendering and generation

- Add `@rendering` to a scenario only when it asserts pixels, rendered geometry,
  canvas changes or visual continuity. Numerical metadata and form controls are
  insufficient. The test-build alias bypasses raster drawing in other scenarios.
  GIS metadata, overlay controls and map reads remain real. Production builds use
  the ordinary drawing modules.
- Add `@generation` only when the scenario observes configuration submission,
  progress, cancellation or publication. A dedicated configuration-test file can
  instead declare `test.use({ generationLifecycle: "the boundary being tested" })`.
  Undeclared generation fixture requests fail. Real generation remains blocked
  even with this declaration. A declared scenario runs `refine` in the real worker,
  because Refine only captures the parent's geography into the child map and
  publishes it; it generates nothing. Reuse a completed parent for regional jobs.
- Keep supplied lifecycle responses in `scenarioBoundary.ts`. Do not add sleeps,
  larger worlds, timeout increases or parameter matrices to establish setup.
- Retained `@deferred-authoring` scenarios keep their existing behavior for future
  redesign and remain excluded from routine runs.

For each new assertion, identify the smallest relevant UI boundary and check
whether an existing scenario can share its map. Domain algorithms, numerical
perturbations and geometry variants belong in explicit-input Rust tests. Full
generation workloads run separately from the UI suite; the old TypeScript
generation tests remain archived and outside CI.

Run focused cases with `pnpm --dir frontend exec playwright test tests/<file>`.
Compare affected scenario timings after fixture changes. A passing small-grid
check alone does not establish that a scenario avoids unnecessary renderer or
publication work. Do not solve a slowdown by raising timeouts or deleting required
UI assertions.
