// Drives the local atlas server (scripts/local-atlas.sh) over its HTTP API, the way the
// frontend does: one kept verification world, real-scale maps opened from it, and a summary
// of what each map contains. See docs/local-atlas.md.
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const require = createRequire(new URL("../packages/transport/package.json", import.meta.url));
const { Encoder, Decoder } = require("cbor-x");
const encoder = new Encoder({ useRecords: false });
const decoder = new Decoder({ useRecords: false, int64AsNumber: true });
const home = process.env.ATLAS_LOCAL_HOME ?? join(homedir(), ".local/share/vellum-local-atlas");
const origin = `http://127.0.0.1:${process.env.ATLAS_LOCAL_PORT ?? 44138}`;
const worldFile = join(home, "world.json");
const lastJobFile = join(home, "last-job.json");
const emptyNavigation = { version: 0, regions: [], views: [] };

async function call(service, body) {
  const response = await fetch(`${origin}/api/${service}`, {
    method: "POST",
    headers: { "Content-Type": "application/cbor" },
    body: encoder.encode(body),
  }).catch(() => {
    throw new Error(`No local atlas at ${origin}; run make local-up`);
  });
  if (!response.ok) throw new Error(await response.text());
  return decoder.decode(new Uint8Array(await response.arrayBuffer()));
}
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const writeJson = (path, value) => writeFile(path, JSON.stringify(value, null, 2));
const clock = (started) => `${Math.round((performance.now() - started) / 1000)}s`.padStart(6);

/** Follows a job to its end, printing each step with the time since the job started. */
async function follow(status, record) {
  const started = performance.now();
  await writeJson(lastJobFile, { jobId: status.jobId, ...record });
  const log = [];
  const print = (line) => (console.log(line), log.push(line));
  let after = 0;
  let step = "";
  while (status.state === "running") {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const page = await call("generation", {
      method: "observe",
      request: { job_id: status.jobId, after },
    });
    after = page.next;
    status = page.status;
    if (status.step && status.step !== step) print(`${clock(started)} ${(step = status.step)}`);
  }
  print(`${clock(started)} ${status.state} ${status.message ?? ""}`);
  await writeFile(join(home, "last-job-steps.txt"), log.join("\n") + "\n");
  if (status.state !== "completed") {
    console.log(`Fix the cause, then make local-up and make local-resume (job ${status.jobId}).`);
    process.exit(1);
  }
  return status.result;
}

async function save(reference) {
  const saved = await call("maps/library", { method: "find", args: [reference.mapId] });
  if (saved?.reference.revision === reference.revision) return;
  await call("maps/library", {
    method: "save",
    args: [
      {
        reference,
        expectedVersion: saved?.version ?? null,
        navigation: saved?.navigation ?? emptyNavigation,
        settings: saved?.settings ?? {},
      },
    ],
  });
}

/** Writes the map's description, its GeoJSON export and a count of every published kind. */
async function report(reference, directory) {
  await mkdir(directory, { recursive: true });
  const map = await call("maps/read", { method: "open", args: [reference] });
  const exported = await call("maps/read", { method: "export", args: [reference, "geojson"] });
  await writeJson(join(directory, "map.json"), map);
  await writeFile(join(directory, "map.geojson"), new Uint8Array(exported.bytes));
  const [w, s, e, n] = map.bounds;
  const lines = [
    `${map.name}  ${JSON.stringify(reference)}`,
    `${((e - w) / 1000).toFixed(2)} × ${((n - s) / 1000).toFixed(2)} km`,
  ];
  // Counted from the exported features, so the summary shows what a reader actually gets.
  const counts = new Map();
  for (const { properties } of JSON.parse(new TextDecoder().decode(new Uint8Array(exported.bytes)))
    .features) {
    const key = `${properties.spaceId}\t${properties.layerId}`;
    const kinds = counts.get(key) ?? new Map();
    kinds.set(properties.kind, (kinds.get(properties.kind) ?? 0) + 1);
    counts.set(key, kinds);
  }
  for (const space of map.spaces) {
    const layers = map.layers.filter((entry) => entry.spaceId === space.id);
    const rasters = layers.filter((layer) => layer.source.kind === "raster").length;
    lines.push(
      `\nSpace ${space.frame?.floor ?? "surface"} (${space.id}): ${rasters} raster layers`
    );
    for (const layer of layers.filter((entry) => entry.source.kind === "vector")) {
      const kinds = counts.get(`${space.id}\t${layer.id}`);
      if (kinds)
        lines.push(
          `  ${layer.name}: ${[...kinds].map(([kind, count]) => `${kind} ${count}`).join(", ")}`
        );
    }
  }
  const summary = lines.join("\n");
  await writeFile(join(directory, "summary.txt"), summary + "\n");
  console.log(summary, `\n\nWritten to ${directory}`);
}

async function world(fresh) {
  if (!fresh) {
    const kept = await readJson(worldFile).catch(() => null);
    const map =
      kept &&
      (await call("maps/read", { method: "open", args: [kept.reference] }).catch(() => null));
    if (map) {
      console.log(`Kept world: ${map.name} ${JSON.stringify(kept.reference)}`);
      return;
    }
  }
  const [choice] = await call("generation", { method: "configurations" });
  const configuration = await call("generation", {
    method: "validate",
    request: {
      ...choice.values,
      name: "Local verification world",
      worldId: crypto.randomUUID(),
      width: 1_000_000,
      height: 750_000,
      recipe: { ...choice.values.recipe, quality: "draft", seed: 42 },
    },
  });
  const status = await call("generation", { method: "create", request: configuration });
  const reference = await follow(status, { kind: "world" });
  await save(reference);
  await writeJson(worldFile, { reference });
  await report(reference, join(home, "world"));
}

/** A tiny outline around the point; the engine centres the real-scale frame on it. */
function pointSelection(map, [x, y]) {
  const d = 1e-3;
  const ring = [
    [x - d, y - d],
    [x + d, y - d],
    [x + d, y + d],
    [x - d, y + d],
    [x - d, y - d],
  ];
  return {
    parent: map.reference,
    spaceId: map.primarySpaceId,
    geometry: { type: "Polygon", coordinates: [ring] },
    featureIds: [],
    regionPath: [],
  };
}
/** The world's settlements, largest first, with the point each is drawn at. */
async function settlements(reference) {
  const exported = await call("maps/read", { method: "export", args: [reference, "geojson"] });
  const { features } = JSON.parse(new TextDecoder().decode(new Uint8Array(exported.bytes)));
  return features
    .filter((feature) => feature.properties.layerId === "vector:settlements")
    .filter((feature) => feature.geometry?.type === "Point")
    .map((feature) => ({
      name: feature.properties.name,
      position: feature.geometry.coordinates,
      population: Number(feature.properties.population ?? 0),
    }))
    .sort((a, b) => b.population - a.population);
}
/** `x,y` in world metres, or the name of one of the world's settlements. */
async function point(reference, at) {
  const numbers = at.split(",").map(Number);
  if (numbers.length === 2 && numbers.every(Number.isFinite)) return numbers;
  const found = (await settlements(reference)).find((entry) => entry.name === at);
  if (!found) throw new Error(`No settlement named ${at}; run node scripts/local-atlas.mjs places`);
  return found.position;
}
async function places() {
  const { reference } = await readJson(worldFile);
  for (const entry of await settlements(reference))
    console.log(entry.name.padEnd(28), entry.position.map(Math.round).join(","), entry.population);
}
const hexMetres = { "1.5m": 1.5, "3m": 3, "10m": 10, "30m": 30, "100m": 100, "300m": 300 };

async function realScale(options) {
  const { reference } = await readJson(worldFile).catch(() => {
    throw new Error("No kept world; run make local-world");
  });
  const parent = await call("maps/read", { method: "open", args: [reference] });
  const at = await point(reference, options.at);
  const choice = {
    kind: options.kind,
    hexSize: options.hex,
    hexesAcross: Number(options.across),
  };
  const width = choice.hexesAcross * hexMetres[choice.hexSize];
  const name = options.name ?? `${choice.kind} ${choice.hexSize} ${choice.hexesAcross}`;
  const configuration = await call("generation", { method: "configuration", request: reference });
  Object.assign(configuration, { name, width, height: width * 0.75 });
  configuration.recipe.quality = options.detail;
  const request = { selection: pointSelection(parent, at), configuration, realScale: choice };
  const review = await call("generation", {
    method: "review",
    request: { method: "refine", request },
  });
  const errors = review.diagnostics.filter((item) => item.severity === "error");
  if (errors.length) throw new Error(JSON.stringify(errors, null, 2));
  if (review.input.settings) configuration.recipe.settings = review.input.settings;
  const status = await call("generation", { method: "refine", request });
  const result = await follow(status, { kind: "real", name });
  await finish(result, name);
}
async function finish(result, name) {
  await save(result);
  const directory = join(home, "maps", name.replace(/[^\w.-]+/g, "-"));
  await report(result, directory);
  await writeFile(join(directory, "steps.txt"), await readFile(join(home, "last-job-steps.txt")));
}

async function resume(jobId) {
  const last = await readJson(lastJobFile).catch(() => ({}));
  const id = jobId ?? last.jobId;
  if (!id) throw new Error("No job to resume");
  const status = await call("generation", { method: "resume", request: { job_id: id } });
  const result = await follow(status, last.jobId === id ? last : { kind: "real", name: id });
  if (last.kind === "world") {
    await save(result);
    await writeJson(worldFile, { reference: result });
    await report(result, join(home, "world"));
  } else await finish(result, last.name ?? id);
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    fresh: { type: "boolean", default: false },
    kind: { type: "string", default: "ground" },
    hex: { type: "string", default: "100m" },
    across: { type: "string", default: "50" },
    at: { type: "string" },
    name: { type: "string" },
    detail: { type: "string", default: "draft" },
  },
});
/** Pictures of a kept map in the frontend the server hosts: default, hex fill, caves. */
async function view(name) {
  const directory = join(home, "maps", name);
  const { name: title } = await readJson(join(directory, "map.json"));
  const playwright = createRequire(new URL("../frontend/package.json", import.meta.url));
  const { chromium } = playwright("@playwright/test");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    page.on("pageerror", (error) => console.log("Page error:", error.message));
    await page.goto(`${origin}/`);
    await page.getByRole("button", { name: "Server maps", exact: true }).click();
    // Child maps are listed under their parent's entry.
    const library = page.getByRole("dialog");
    const world = library.getByRole("button", { name: /^Regions and jobs for/ }).first();
    await world.waitFor();
    await world.click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: new RegExp(`^${title}`) })
      .first()
      .click();
    const canvas = page.getByRole("application", { name: "World map canvas" });
    const settled = () =>
      page.waitForFunction(
        () =>
          document.querySelector('[aria-label="World map canvas"]')?.getAttribute("aria-busy") ===
          "false",
        undefined,
        { timeout: 120_000 }
      );
    await canvas.waitFor();
    await settled();
    const picture = async (file) => {
      const close = page.getByRole("button", { name: "Close panel", exact: true });
      if (await close.count()) await close.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: join(directory, file) });
      console.log(join(directory, file));
    };
    // The hex view is remembered with the map, so each picture sets its own.
    const hexView = async (label) => {
      await page.getByRole("button", { name: "Appearance", exact: true }).click();
      await page.getByLabel(label, { exact: true }).check();
      await settled();
    };
    await hexView("Grid over the map");
    await picture("map.png");
    await hexView("Fill each hex by what covers it");
    await settled();
    await picture("hex-fill.png");
    await hexView("Grid over the map");
    const caves = page.getByLabel("Caves", { exact: true });
    if (await caves.count()) {
      await caves.check();
      await settled();
      await picture("caves.png");
    }
  } finally {
    await browser.close();
  }
}

const [command, argument] = positionals;
if (command === "world") await world(values.fresh);
else if (command === "real" && values.at && hexMetres[values.hex]) await realScale(values);
else if (command === "resume") await resume(argument);
else if (command === "places") await places();
else if (command === "view" && argument) await view(argument);
else if (command === "summary" && argument) {
  const directory = join(home, "maps", argument);
  await report((await readJson(join(directory, "map.json"))).reference, directory);
} else {
  console.error(`Usage:
  node scripts/local-atlas.mjs world [--fresh]
  node scripts/local-atlas.mjs places
  node scripts/local-atlas.mjs summary|view <map folder under ${join(home, "maps")}>`);
  console.error(`
  node scripts/local-atlas.mjs real --at x,y [--hex 100m] [--across 50] [--kind ground|structure]
                                    [--detail draft|standard|fine] [--name name]
  node scripts/local-atlas.mjs resume [jobId]
--at is in world metres; hex sizes: ${Object.keys(hexMetres).join(", ")}`);
  process.exit(2);
}
