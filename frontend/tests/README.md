# Browser scenarios

Import `test` and `expect` from `./uiTest`. Ordinary scenarios start from a
completed, supplied map:

```ts
import { test, expect } from "./uiTest";
import { openFixtureMap, pointFeature } from "./harness";

test("finds a named place in the registry", async ({ page }) => {
  await openFixtureMap(page, "Registry", {
    features: [pointFeature("Falls", "waterfall", "geology")],
  });
  // Open the registry and assert the user-visible result.
});
```

`PreparedMaps` prepares each small numerical/map configuration once per Playwright
worker. Preparation uses the supplied 16 × 16 worker output and the real
publication/save path. It retains the saved SQLite catalog and immutable resource
bytes in memory for that run. Names and supplied features do not create new
templates. Each scenario receives its own OPFS files and saved-map registration;
the application opens its normal writable workspace from that save. No generated
artifact is committed and no production persistence behavior changes.

Use `numerical: true` only when the scenario needs numerical preconditions, such
as regional setup or stored field metadata. It does not enable raster rendering.
Use `mappedRegion: { name, extent, features }` when navigation needs an existing
child map. Do not walk through creation and refinement to obtain that child.
For an observed refinement job, supply its output through `regionalFeatures`;
the fixture does not republish the parent's supplied geography into the child.
The restored world retains completed generation history but starts with no live
jobs. `openFixtureMap` returns its world identity and original generation input
when a submission test needs to compare inherited settings.

Playwright still gives each test an independent context, including an isolated
persistent profile for WebKit. Reuse immutable map data, not live pages, writable
contexts or another test's output. A retry or different test order must work.

## Rendering and generation

- Add `@rendering` to a scenario only when it asserts pixels, rendered geometry,
  canvas changes or visual continuity. Numerical metadata and form controls are
  insufficient. Test-build aliases bypass raster drawing and omit numerical fields
  from illustrated drawing in other scenarios. Field metadata, overlay controls,
  and workspace/refinement reads remain real. A raster worker started outside this
  boundary fails the test. Never suppress `readRasters`: it also supplies metadata
  needed by the overlay UI. Production builds use the ordinary drawing modules.
- Add `@generation` only when the scenario observes configuration submission,
  progress, cancellation or publication. A dedicated configuration-test file can
  instead declare `test.use({ generationLifecycle: "the boundary being tested" })`.
  Undeclared generation fixture requests fail. Real generation remains blocked
  even with this declaration. Reuse a completed parent for regional jobs.
- Keep lifecycle fixtures in `installGenerationFixture` and use `hold` plus
  `completeGenerationFixture` for controlled transitions. Do not add sleeps,
  larger worlds, timeout increases or parameter matrices to establish setup.
- Retained `@deferred-authoring` scenarios keep their existing behavior for future
  redesign and remain excluded from routine runs.

For each new assertion, identify the smallest relevant UI boundary and check
whether an existing scenario can share its map. Domain algorithms, numerical
perturbations and geometry variants belong in constructed Vitest cases. Shared
full generations remain in `src/worldIntegration.generation.test.ts`; multiple
assertions consume the same result there.

Run focused cases with `pnpm --dir frontend exec playwright test tests/<file>`.
Compare affected scenario timings after fixture changes. A passing small-grid
check alone does not establish that a scenario avoids unnecessary renderer or
publication work. Do not solve a slowdown by raising timeouts or deleting required
UI assertions.
