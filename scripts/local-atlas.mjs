// Drives the local atlas server (scripts/local-atlas.sh) over its HTTP API, the way the
// frontend does: one kept verification world, real-scale maps opened from it, and a summary
// of what each map contains. See docs/local-atlas.md.
import { createRequire } from "node:module";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { deflateSync } from "node:zlib";
import { retainTownStage, retainedTownPictures } from "./town-preview.mjs";

const require = createRequire(new URL("../packages/transport/package.json", import.meta.url));
const { Encoder, Decoder } = require("cbor-x");
const encoder = new Encoder({ useRecords: false });
const decoder = new Decoder({ useRecords: false, int64AsNumber: true });
// One atlas for every worktree, kept in the main checkout; reports and pictures go to the
// checkout running the check, so they sit under its root.
const checkout = fileURLToPath(new URL("..", import.meta.url));
const main = resolve(
  checkout,
  execFileSync("git", ["-C", checkout, "rev-parse", "--git-common-dir"], {
    encoding: "utf8",
  }).trim(),
  ".."
);
const home = resolve(process.env.ATLAS_LOCAL_HOME ?? join(main, ".artifacts/local-atlas"));
const reports = join(checkout, ".artifacts/local-atlas");
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

/** An RGB PNG; `pixel(x, y)` returns [r, g, b] with y counted from the top. */
function png(width, height, pixel) {
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) rows.set(pixel(x, y), y * (width * 3 + 1) + 1 + x * 3);
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes) => {
    let c = 0xffffffff;
    for (const byte of bytes) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Saves a job preview (each world epoch, and the start and each round of regional
 * development) as a shaded elevation picture, sea and lakes blue, scaled 4×.
 */
async function savePreview(event, directory) {
  const { grid, ancestry } = JSON.parse(new TextDecoder().decode(new Uint8Array(event.map.bytes)));
  const label = (ancestry ?? []).map((epoch) => epoch.id).join(" ") || "final";
  const { width, height, channels, active } = grid;
  const elevation = channels.Elevation.values;
  const water = channels["Water Kind Codes"]?.values ?? channels.WaterKindCodes?.values;
  const land = elevation.filter((value, cell) => active[cell] && Number.isFinite(value));
  const low = Math.min(...land);
  const high = Math.max(...land);
  const scale = 4;
  const at = (x, y) => (height - 1 - Math.floor(y / scale)) * width + Math.floor(x / scale);
  const bytes = png(width * scale, height * scale, (x, y) => {
    const cell = at(x, y);
    if (!active[cell]) return [40, 40, 40];
    const shade = Math.round((255 * (elevation[cell] - low)) / Math.max(high - low, 1e-9));
    return water && water[cell] > 0 ? [60, 110, 200 - shade / 4] : [shade, shade, shade];
  });
  const name = `${String(event.epoch).padStart(2, "0")}-${label.replace(/[^\w]+/g, "-")}.png`;
  await writeFile(join(directory, name), bytes);
  return { file: name, label, lowest: low, highest: high, townFabric: grid.townFabric };
}

/**
 * Follows a job to its end, printing each step with the time since the job started. With
 * `until`, the job is cancelled once a preview whose label contains it is saved.
 */
async function follow(status, record, until) {
  const started = performance.now();
  await writeJson(lastJobFile, { ...record, jobId: status.jobId });
  const directory = join(reports, "previews", status.jobId);
  await mkdir(directory, { recursive: true });
  const index = join(directory, "previews.json");
  const retained = await readJson(index).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const previews = new Map(retained.map((p) => [p.file, p]));
  const log = [];
  const print = (line) => (console.log(line), log.push(line));
  let after = 0;
  let step = "";
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    // A server busy publishing can be slow to answer; a dropped poll is retried.
    const page = await call("generation", {
      method: "observe",
      request: { job_id: status.jobId, after },
    }).catch((error) => {
      // A restarted server retains job status but starts a new observation stream.
      if (String(error).includes("Unknown generation event cursor")) after = 0;
      print(`${clock(started)} poll failed, retrying: ${error}`);
      return null;
    });
    if (!page) continue;
    const drained = after === page.next;
    after = page.next;
    status = page.status;
    if (status.step && status.step !== step) print(`${clock(started)} ${(step = status.step)}`);
    for (const event of page.events) {
      if (event.kind !== "preview") continue;
      const { townFabric, ...preview } = await savePreview(event, directory);
      if (townFabric) await retainTownStage(directory, townFabric);
      previews.set(preview.file, preview);
      print(`${clock(started)} picture ${join(directory, preview.file)}`);
      if (until && preview.label.includes(until))
        status = await call("generation", { method: "cancel", request: { job_id: status.jobId } });
    }
    if (status.state !== "running" && drained) break;
  }
  print(`${clock(started)} ${status.state} ${status.message ?? ""}`);
  for (const { file, svg, label } of await retainedTownPictures(directory)) {
    const path = join(directory, file);
    await writeFile(path, svg);
    previews.set(file, { file, label });
    print(`${clock(started)} picture ${path}`);
  }
  await writeFile(join(home, "last-job-steps.txt"), log.join("\n") + "\n");
  await writeFile(join(directory, "steps.txt"), log.join("\n") + "\n");
  await writeJson(index + ".tmp", [...previews.values()]);
  await rename(index + ".tmp", index);
  if (until && status.state === "cancelled") process.exit(0);
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
  await report(reference, join(reports, "world"));
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
  const { reference } = await readJson(
    options.parent ? join(reports, "maps", options.parent, "map.json") : worldFile
  ).catch(() => {
    throw new Error("No kept world; run make local-world");
  });
  const parent = await call("maps/read", { method: "open", args: [reference] });
  const at = await point(reference, options.at);
  const choice = {
    kind: options.kind,
    hexSize: options.hex,
    hexesAcross: Number(options.across),
  };
  const width = options.width
    ? Number(options.width)
    : choice.hexesAcross * hexMetres[choice.hexSize];
  const name = options.name ?? `${choice.kind} ${choice.hexSize} ${choice.hexesAcross}`;
  const directory = join(reports, "maps", name.replace(/[^\w.-]+/g, "-"));
  if (await readJson(join(directory, "map.json")).catch(() => null))
    throw new Error(`A result named ${name} already exists; choose a new --name`);
  const configuration = await call("generation", { method: "configuration", request: reference });
  Object.assign(configuration, { name, width, height: width * 0.75 });
  configuration.recipe.quality = options.detail;
  const selection = pointSelection(parent, at);
  if (options.width) {
    const half = Number(options.width) / 2;
    const [x, y] = at;
    selection.geometry.coordinates = [
      [
        [x - half, y - half * 0.75],
        [x + half, y - half * 0.75],
        [x + half, y + half * 0.75],
        [x - half, y + half * 0.75],
        [x - half, y - half * 0.75],
      ],
    ];
  }
  const request = { selection, configuration, ...(options.width ? {} : { realScale: choice }) };
  const review = await call("generation", {
    method: "review",
    request: { method: "refine", request },
  });
  const errors = review.diagnostics.filter((item) => item.severity === "error");
  if (errors.length) throw new Error(JSON.stringify(errors, null, 2));
  if (review.input.settings) configuration.recipe.settings = review.input.settings;
  const status = await call("generation", { method: "refine", request });
  const captured = await follow(status, { kind: "real", name });
  await save(captured);
  const developed = await call("generation", { method: "configuration", request: captured });
  developed.recipe.quality = options.detail;
  const regeneration = { reference: captured, configuration: developed };
  const developmentReview = await call("generation", {
    method: "review",
    request: { method: "regenerate", request: regeneration },
  });
  const failures = developmentReview.diagnostics.filter((item) => item.severity === "error");
  if (failures.length) throw new Error(JSON.stringify(failures, null, 2));
  const running = await call("generation", { method: "regenerate", request: regeneration });
  await finish(await follow(running, { kind: "real", name }, options.until), name, running.jobId);
}
async function finish(result, name, jobId) {
  await save(result);
  const directory = join(reports, "maps", name.replace(/[^\w.-]+/g, "-"));
  await report(result, directory);
  const observed = join(reports, "previews", jobId);
  await copyFile(join(observed, "steps.txt"), join(directory, "steps.txt"));
  const previews = await readJson(join(observed, "previews.json"));
  for (const { file } of previews)
    await copyFile(join(observed, file), join(directory, `preview-${basename(file)}`));
  await writeJson(join(directory, "previews.json"), previews);
}

async function resume(jobId) {
  const last = await readJson(lastJobFile).catch(() => ({}));
  const id = jobId ?? last.jobId;
  if (!id) throw new Error("No job to resume");
  const current = await call("generation", { method: "status", request: { job_id: id } });
  // A job that completed while its driver was gone only needs its report.
  const status =
    current.state === "completed" || current.state === "running"
      ? current
      : await call("generation", { method: "resume", request: { job_id: id } });
  const record = last.jobId === id ? last : { kind: "real", name: id };
  const result = await follow(status, record);
  if (record.kind === "world") {
    await save(result);
    await writeJson(worldFile, { reference: result });
    await report(result, join(reports, "world"));
  } else await finish(result, record.name ?? id, id);
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
    until: { type: "string" },
    parent: { type: "string" },
    width: { type: "string" },
  },
});
/** Pictures of a kept map in the frontend the server hosts: default, hex fill, caves. */
async function view(name) {
  const directory = join(reports, "maps", name);
  const map = await readJson(join(directory, "map.json"));
  const title = map.name;
  const ancestors = [];
  let parent = map.parent;
  while (parent) {
    const ancestor = await call("maps/read", { method: "open", args: [parent] });
    ancestors.unshift(ancestor.name);
    parent = ancestor.parent;
  }
  const playwright = createRequire(new URL("../frontend/package.json", import.meta.url));
  const { chromium } = playwright("@playwright/test");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    const previews = await readJson(join(directory, "previews.json")).catch(() => []);
    for (const { file } of previews.filter(({ file }) => file.endsWith(".svg"))) {
      const source = join(directory, `preview-${basename(file)}`);
      await page.setContent(await readFile(source, "utf8"));
      const path = source.replace(/\.svg$/, ".png");
      await page.locator("body > svg").screenshot({ path });
      console.log(path);
    }
    page.on("pageerror", (error) => console.log("Page error:", error.message));
    await page.goto(`${origin}/`);
    await page.getByRole("button", { name: "Server maps", exact: true }).click();
    // Child maps are listed under their parent's entry.
    const library = page.getByRole("dialog");
    for (const ancestor of ancestors)
      await library
        .getByRole("button", { name: `Regions and jobs for ${ancestor}`, exact: true })
        .click();
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
    if (map.realScale) {
      await hexView("Grid over the map");
      const surface = page
        .getByRole("region", { name: "Real-scale map", exact: true })
        .getByRole("radio", { name: "Surface", exact: true });
      if (await surface.count()) await surface.check();
      await settled();
    }
    await picture("map.png");
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    await page.getByRole("radio", { name: "Drawn map", exact: true }).check();
    await page
      .getByRole("combobox", { name: "Map theme", exact: true })
      .selectOption("infrastructure");
    await page.getByLabel("Sheet legend", { exact: true }).check();
    await settled();
    const downloading = page.waitForEvent("download", { timeout: 90_000 });
    await page.getByRole("button", { name: "Download map PNG", exact: true }).click();
    await (await downloading).saveAs(join(directory, "sheet.png"));
    await picture("drawn-map.png");
    if (!map.realScale) return;
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    await page.getByRole("radio", { name: "Raster investigation", exact: true }).check();
    await page.getByRole("button", { name: "Close panel", exact: true }).click();
    await hexView("Fill each hex by what covers it");
    await settled();
    await picture("hex-fill.png");
    await hexView("Grid over the map");
    await page.getByRole("button", { name: "Close panel", exact: true }).click();
    const exported = await readJson(join(directory, "map.geojson"));
    if (exported.features.some((feature) => feature.properties.kind === "building")) {
      await page.getByRole("button", { name: "Fit map", exact: true }).click();
      const box = await canvas.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, -300);
      await settled();
      await picture("streets.png");
    }
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
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

/** Saves raster layers of a kept map as GeoTIFFs beside its report, e.g. raster:Elevation. */
async function raster(name, layerIds) {
  const directory = join(reports, "maps", name);
  const map = await readJson(join(directory, "map.json"));
  for (const id of layerIds) {
    const layer = map.layers.find((entry) => entry.id === id && entry.source.kind === "raster");
    if (!layer) throw new Error(`No raster layer ${id}`);
    const { mapId, revision } = map.reference;
    const url = `${origin}/api/maps/${mapId}/${revision}/assets/${layer.source.data.assetId}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${id}: ${response.status} ${await response.text()}`);
    const file = join(directory, `${id.replace(/[^\w.-]+/g, "-")}.tif`);
    await writeFile(file, new Uint8Array(await response.arrayBuffer()));
    console.log(file);
  }
}

/** Writes what each process recorded doing to a kept map, in run order. */
async function history(name) {
  const directory = join(reports, "maps", name);
  const { reference } = await readJson(join(directory, "map.json"));
  const entries = await call("maps/read", { method: "history", args: [reference, null] });
  await writeJson(join(directory, "history.json"), entries);
  console.log(join(directory, "history.json"));
}

const [command, argument] = positionals;
if (command === "world") await world(values.fresh);
else if (command === "real" && values.at && hexMetres[values.hex]) await realScale(values);
else if (command === "region" && values.at && values.width) await realScale(values);
else if (command === "resume") await resume(argument);
else if (command === "places") await places();
else if (command === "view" && argument) await view(argument);
else if (command === "town-previews" && argument && values.name) {
  const output = join(reports, "maps", values.name);
  const index = join(output, "previews.json");
  const previews = new Map((await readJson(index)).map((item) => [item.file, item]));
  for (const { file, svg, label } of await retainedTownPictures(join(reports, "previews", argument))) {
    await writeFile(join(output, `preview-${file}`), svg);
    previews.set(file, { file, label });
  }
  await writeJson(index, [...previews.values()]);
}
else if (command === "history" && argument) await history(argument);
else if (command === "raster" && argument && positionals[2])
  await raster(argument, positionals.slice(2));
else if (command === "summary" && argument) {
  const directory = join(reports, "maps", argument);
  await report((await readJson(join(directory, "map.json"))).reference, directory);
} else {
  console.error(`Usage:
  node scripts/local-atlas.mjs world [--fresh]
  node scripts/local-atlas.mjs places
  node scripts/local-atlas.mjs summary|view <map folder under ${join(reports, "maps")}>`);
  console.error(`
  node scripts/local-atlas.mjs real --at x,y [--hex 100m] [--across 50] [--kind ground|structure]
                                    [--detail draft|standard|fine] [--name name]
                                    [--until "<stage picture label, e.g. Initial regional detail>"]
  node scripts/local-atlas.mjs resume [jobId]
  node scripts/local-atlas.mjs town-previews <jobId> --name <existing map folder>
  node scripts/local-atlas.mjs region --at Town --width metres --name name [--parent map-folder]
real and region accept --parent to refine a previously generated map instead of the world.
--at is in world metres; hex sizes: ${Object.keys(hexMetres).join(", ")}`);
  process.exit(2);
}
