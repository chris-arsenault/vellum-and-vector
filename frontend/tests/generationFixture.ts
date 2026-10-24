import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import type { AtlasFeature, SocietyRegion } from "@atlas/domain";
import type { GenerationDiagnostic } from "@atlas/generation";

const fixtureBundle = build({
  entryPoints: [fileURLToPath(new URL("./generationFixtureRuntime.ts", import.meta.url))],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "AtlasGenerationFixture",
  platform: "browser",
}).then((result) => result.outputFiles[0].text);

/** UI journeys use small fields; the fixture shares the real worker output adapter. */
export async function installGenerationFixture(
  page: Page,
  hold = false,
  terrain = false,
  life = false,
  ecologicalFeatures: AtlasFeature[] = [],
  society?: SocietyRegion,
  diagnostics: GenerationDiagnostic[] = []
) {
  const options = { hold, terrain, life, ecologicalFeatures, society, diagnostics };
  await page.addInitScript({
    content: `${await fixtureBundle}\nAtlasGenerationFixture.installGenerationFixtureRuntime(${JSON.stringify(options)});`,
  });
}

export async function completeGenerationFixture(page: Page) {
  await page.evaluate(() =>
    (
      window as unknown as { completeGenerationFixture(): Promise<void> }
    ).completeGenerationFixture()
  );
}
