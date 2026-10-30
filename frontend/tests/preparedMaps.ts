import { expect, type BrowserContext, type Page } from "@playwright/test";
import { installGenerationFixture, type GenerationFixtureOptions } from "./generationFixture";
import { captureMap, restoreMap, type MapArchive } from "./mapArchive";
import { installScenarioBoundary } from "./scenarioBoundary";
import type { WorldOptions } from "./harness";
import type { MapCustomization } from "./fixtureMap.worker";
import type { AtlasGenerationInput } from "@atlas/generation";

const prepared = new WeakMap<Page, PreparedMaps>();
export const attachPreparedMaps = (page: Page, maps: PreparedMaps) => prepared.set(page, maps);
interface PreparedMap extends MapArchive {
  input: AtlasGenerationInput;
}

async function storagePage(page: Page) {
  await page.goto("/tests/fixtureMap.html");
  await page.waitForFunction(() => typeof window.customizeFixtureMap === "function");
}

/** One immutable archive per numerical/map configuration per Playwright worker. */
export class PreparedMaps {
  private archives = new Map<string, Promise<PreparedMap>>();
  constructor(private context: () => Promise<BrowserContext>) {}

  get(
    fixture: GenerationFixtureOptions,
    options: WorldOptions & { detail?: "draft" | "standard" }
  ) {
    const input = {
      numerical: fixture.numerical ?? fixture.fields ?? false,
      terrain: fixture.terrain ?? false,
      life: fixture.life ?? false,
      ...dimensions(options),
      boundary: options.boundary ?? "open",
      detail: options.detail ?? "standard",
    };
    const key = JSON.stringify(input);
    let archive = this.archives.get(key);
    if (!archive) {
      archive = this.prepare(input);
      this.archives.set(key, archive);
    }
    return archive;
  }

  private async prepare(input: {
    numerical: boolean;
    terrain: boolean;
    life: boolean;
    width: number;
    height: number;
    boundary: string;
    detail: string;
  }) {
    const context = await this.context();
    try {
      await context.addInitScript(installScenarioBoundary, { rendering: false, generation: true });
      const page = await context.newPage();
      await installGenerationFixture(page, input);
      await page.goto("/");
      await page.getByLabel("World name", { exact: true }).fill("Shared fixture atlas");
      await page.getByLabel("Width · km").fill(String(input.width));
      await page.getByLabel("Height · km").fill(String(input.height));
      await page
        .getByLabel("Map boundary", { exact: true })
        .selectOption(input.boundary === "cylinder" ? "1" : "0");
      await page.getByLabel("Detail level").selectOption(input.detail);
      await page.getByRole("button", { name: /Review & generate/ }).click();
      await page.getByRole("button", { name: "Generate world", exact: true }).click();
      await expect(page.locator(".job-row strong").first()).toHaveText("completed");
      await page.getByRole("button", { name: "Save map", exact: true }).click();
      await expect(page.locator(".header-meta")).toHaveText("Saved locally");
      const generationInput = (await page.evaluate(() =>
        Reflect.get(window, "generationFixtureInput")
      )) as PreparedMap["input"];
      await storagePage(page);
      return { ...(await captureMap(page)), input: generationInput };
    } finally {
      await context.close();
    }
  }
}

export async function openFixtureMap(
  page: Page,
  name: string,
  fixture: GenerationFixtureOptions = {},
  options: WorldOptions & { detail?: "draft" | "standard" } = {}
) {
  const maps = prepared.get(page);
  if (!maps) throw new Error("Import test from ./uiTest to reuse prepared maps.");
  const archive = await maps.get(fixture, options);
  // Parent geography is already in the saved map. A refinement publishes only
  // explicitly supplied child features, never the parent fixture a second time.
  await installGenerationFixture(page, {
    ...fixture,
    features: [],
    regionalFeatures: fixture.regionalFeatures ?? [],
    landmarks: [],
    society: undefined,
  });
  await storagePage(page);
  await restoreMap(page, archive);
  await page.evaluate(
    (customization) => window.customizeFixtureMap(JSON.parse(customization)),
    JSON.stringify({
      summary: archive.summary,
      name,
      fixture,
    } satisfies MapCustomization)
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Saved maps", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: new RegExp(`^${name} Revision`) })
    .click();
  await expect(page.getByRole("application", { name: "World map canvas" })).toBeVisible();
  await expect(page.locator(".job-row")).toHaveCount(0);
  return { id: archive.summary.id, input: structuredClone(archive.input) };
}

function dimensions(options: WorldOptions) {
  return { width: options.width ?? options.km ?? 1, height: options.height ?? options.km ?? 1 };
}
