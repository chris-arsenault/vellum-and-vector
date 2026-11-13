import { test, expect, type Page } from "./uiTest";
import { canvas, openFixtureMap, openMapSettings, pointFeature } from "./harness";

function courses() {
  return ["perennial", "seasonal", "dry"].map((regime, n) => ({
    ...pointFeature(["Running river", "Seasonal river", "Old named river"][n], "river", "rivers", {
      regime,
      order: 2,
      discharge: regime === "dry" ? 0 : 40,
      widths: [8, 8],
      depths: [1, 1],
      elevations: [10, 10],
      discharges: regime === "dry" ? [0, 0] : [40, 40],
      flowingMonths: [12 - n * 6, 12 - n * 6],
    }),
    geometry: {
      type: "LineString" as const,
      coordinates: [
        [150, 250 + n * 250],
        [850, 250 + n * 250],
      ],
    },
  }));
}

/** Count visible dry-ground ink, without reading the renderer's styles or feature metadata. */
async function dryInk(page: Page) {
  const png = (await canvas(page).screenshot()).toString("base64");
  return page.evaluate(async (png) => {
    const image = new Image();
    image.src = `data:image/png;base64,${png}`;
    await image.decode();
    const surface = document.createElement("canvas");
    surface.width = image.width;
    surface.height = image.height;
    const context = surface.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, surface.width, surface.height).data;
    let brown = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i] > pixels[i + 1] * 1.1 && pixels[i + 1] > pixels[i + 2] * 1.1) brown++;
    return brown;
  }, png);
}

async function drawn(page: Page) {
  await openMapSettings(page);
  await page.getByRole("radio", { name: "Drawn map", exact: true }).check();
  await page.getByRole("button", { name: "Map", exact: true }).click();
}

test("draws named seasonal and dry courses differently from running rivers @rendering", async ({
  page,
}) => {
  const features = courses();
  await openFixtureMap(page, "River regimes", { features });
  await drawn(page);
  await expect.poll(() => dryInk(page)).toBeGreaterThan(0);
  const withRegimes = await dryInk(page);
  await canvas(page).screenshot({ path: ".artifacts/water/river-regimes.png" });
  await openFixtureMap(page, "River regimes", {
    features: features.map((feature) => ({
      ...feature,
      attributes: {
        ...feature.attributes,
        regime: "perennial",
        flowingMonths: [12, 12],
        discharge: 40,
        discharges: [40, 40],
      },
    })),
  });
  await drawn(page);
  await expect.poll(() => dryInk(page)).toBeLessThan(withRegimes);
  await canvas(page).screenshot({ path: ".artifacts/water/all-perennial.png" });
});
