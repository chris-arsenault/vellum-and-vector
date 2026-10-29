import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import type { AtlasFeature, Landmark, SocietyRegion } from "@atlas/domain";
import type { GenerationDiagnostic } from "@atlas/generation";

const fixtureBundle = build({
  entryPoints: [fileURLToPath(new URL("./generationFixtureRuntime.ts", import.meta.url))],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "AtlasGenerationFixture",
  platform: "browser",
}).then((result) => result.outputFiles[0].text);
const publicationBundle = build({
  entryPoints: [fileURLToPath(new URL("./fixturePublication.worker.ts", import.meta.url))],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
}).then((result) => result.outputFiles[0].text);

export interface GenerationFixtureOptions {
  /** Keep the job running until `completeGenerationFixture` is called. */
  hold?: boolean;
  /** Legacy spelling retained for deferred authoring tests. Use `numerical` in active scenarios. */
  fields?: boolean;
  /** Supply numerical preconditions without opting into raster presentation. */
  numerical?: boolean;
  /** An already completed child map for navigation scenarios. No refinement job is needed. */
  mappedRegion?: {
    name: string;
    extent: [number, number, number, number];
    features: AtlasFeature[];
  };
  /** Shape the fixture elevation as a hill instead of a ramp (needs `numerical`). */
  terrain?: boolean;
  /** Add ecology channels (needs `numerical`). */
  life?: boolean;
  /** Features the fixture publishes as generated. */
  features?: AtlasFeature[];
  /** Output of an observed refinement job; use mappedRegion for completed child-map setup. */
  regionalFeatures?: AtlasFeature[];
  /** Landmark records the fixture's run leaves in the world, as the generator would. */
  landmarks?: Landmark[];
  society?: SocietyRegion;
  diagnostics?: GenerationDiagnostic[];
}

/** UI journeys use a 16×16 fixture grid; the fixture shares the real worker output adapter. */
export async function installGenerationFixture(page: Page, options: GenerationFixtureOptions = {}) {
  const runtime = {
    hold: options.hold ?? false,
    fields: options.numerical ?? options.fields ?? false,
    terrain: options.terrain ?? false,
    life: options.life ?? false,
    ecologicalFeatures: options.features ?? [],
    regionalFeatures: options.regionalFeatures,
    landmarks: options.landmarks ?? [],
    society: options.society,
    diagnostics: options.diagnostics ?? [],
    publicationSource: await publicationBundle,
  };
  await page.addInitScript({
    content: `${await fixtureBundle}\nAtlasGenerationFixture.installGenerationFixtureRuntime(${JSON.stringify(runtime)});`,
  });
}

/** The held worker has captured its source revision and can now receive concurrent edits. */
export async function waitForGenerationFixture(page: Page) {
  await page.waitForFunction(() =>
    (window as unknown as { generationFixtureReady?(): boolean }).generationFixtureReady?.()
  );
}

export async function completeGenerationFixture(page: Page) {
  await waitForGenerationFixture(page);
  await page.evaluate(() =>
    (
      window as unknown as { completeGenerationFixture(): Promise<void> }
    ).completeGenerationFixture()
  );
}
