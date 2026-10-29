/** Local Draft/Standard workload and map artifacts; never used as unit-test setup. */
import { mkdir, writeFile } from "node:fs/promises";
import { generateAtlas } from "@atlas/generation";
import {
  classInterpolator,
  spatial,
  surfaceCategories,
  type AtlasFeature,
  type Grid,
  type World,
} from "@atlas/domain";
import type { Geometry } from "geojson";
import { newGenerationDraft, prepareDraft } from "../src/generationDraft";
import { generationSnapshot } from "../src/generationJobs";
import { generationStorageFixture } from "../../packages/storage-browser/src/generationFixture";

const draft = newGenerationDraft();
draft.width = Number(process.env.WIDTH ?? 3_000_000);
draft.height = Number(process.env.HEIGHT ?? 2_000_000);
draft.recipe.seed = Number(process.env.SEED ?? 42);
draft.recipe.quality = process.env.QUALITY === "standard" ? "standard" : "draft";
draft.recipe.domains = ["physical", "magic", "cultural", "political", "built"];
const output = `.artifacts/world-geography/${draft.recipe.quality}-${draft.recipe.seed}`;
await mkdir(output, { recursive: true });
const storage = await generationStorageFixture();
try {
  const { source, input, diagnostics } = prepareDraft(draft);
  if (diagnostics.some((d) => d.severity === "error")) throw new Error(JSON.stringify(diagnostics));
  storage.source(source);
  const start = performance.now();
  const result = await generateAtlas(source, input, {
    ...storage.options,
    diagnostic: (d) => console.log(JSON.stringify(d)),
    progress: (_path, _fraction, message) => {
      if (/^Starting|^Completed|year/.test(message))
        console.log(`${Math.round((performance.now() - start) / 1000)}s ${message}`);
    },
  });
  const snapshot = generationSnapshot(result, input, "geography-workload", source),
    features = [...storage.options.features.values()];
  snapshot.world.features = Object.fromEntries(features.map((f) => [f.id, f]));
  const summary = {
    quality: input.quality,
    seconds: (performance.now() - start) / 1000,
    samples: result.state.surface.active.length,
    byKind: Object.fromEntries(
      [...new Set(features.map((f) => f.kind))]
        .sort()
        .map((kind) => [kind, features.filter((f) => f.kind === kind).length])
    ),
    regions: features
      .filter((f) => f.geometry.type.includes("Polygon"))
      .map((f) => ({
        id: f.id,
        kind: f.kind,
        areaKm2: spatial.area(f.geometry) / 1e6,
        breadthKm: Number(f.attributes.breadth ?? 0) / 1000,
      })),
    diagnostics: result.state.diagnostics ?? [],
  };
  console.log(JSON.stringify(summary));
  await writeFile(`${output}/inventory.json`, JSON.stringify(summary));
  await writeFile(`${output}/features.json`, JSON.stringify(features));
  const base = raster(result.state.surface, snapshot.world);
  for (const theme of ["ecology", "sovereignty", "geology"])
    await writeFile(
      `${output}/${theme}.svg`,
      svg(
        base,
        features.filter(
          (f) => f.layerId === theme || ["river", "lake", "landmark"].includes(f.kind)
        ),
        theme
      )
    );
} finally {
  storage.close();
}

function raster(grid: Grid, world: World) {
  const at = classInterpolator(grid, "finalSurface"),
    palette = surfaceCategories(world.magicSystems),
    colors = new Map(palette.map((c) => [c.code, c.color])),
    rows: string[] = [],
    width = 750,
    height = Math.round((width * draft.height) / draft.width);
  for (let row = 0; row < height; row++) {
    let last = "",
      start = 0;
    for (let col = 0; col <= width; col++) {
      const color =
        col === width
          ? ""
          : (colors.get(
              at({
                x: ((col + 0.5) * draft.width) / width,
                y: draft.height - ((row + 0.5) * draft.height) / height,
                z: 0,
              })
            ) ?? "#d9d3ad");
      if (color !== last) {
        if (col > start)
          rows.push(
            `<rect x="${start * 2}" y="${row * 2}" width="${(col - start) * 2}" height="2" fill="${last}"/>`
          );
        last = color;
        start = col;
      }
    }
  }
  return rows.join("");
}
function path(geometry: Geometry): string {
  const line = (points: number[][], close = false) =>
    points
      .map(
        ([x, y], i) =>
          `${i ? "L" : "M"}${(x * 1500) / draft.width},${((draft.height - y) * 1500) / draft.width}`
      )
      .join(" ") + (close ? "Z" : "");
  switch (geometry.type) {
    case "Polygon":
      return geometry.coordinates.map((r) => line(r, true)).join(" ");
    case "MultiPolygon":
      return geometry.coordinates.flatMap((p) => p.map((r) => line(r, true))).join(" ");
    case "LineString":
      return line(geometry.coordinates);
    case "MultiLineString":
      return geometry.coordinates.map((l) => line(l)).join(" ");
    case "GeometryCollection":
      return geometry.geometries.map(path).join(" ");
    default:
      return "";
  }
}
function svg(base: string, features: AtlasFeature[], theme: string) {
  const escape = (s: string) =>
      s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;"),
    mark = (f: AtlasFeature) => {
      const color =
          f.kind === "river"
            ? "#174ea5"
            : f.kind === "lake"
              ? "#537f95"
              : theme === "sovereignty"
                ? "#ac2030"
                : "#35252a",
        title = `<title>${escape(`${f.name} (${f.kind})`)}</title>`;
      if (f.geometry.type === "Point")
        return `<circle cx="${(f.geometry.coordinates[0] * 1500) / draft.width}" cy="${((draft.height - f.geometry.coordinates[1]) * 1500) / draft.width}" r="3" fill="${color}">${title}</circle>`;
      return `<path d="${path(f.geometry)}" fill="none" fill-rule="evenodd" stroke="${color}" stroke-width="${f.kind === "politicalRegion" ? 0.6 : 1.1}" ${f.kind === "politicalRegion" ? 'stroke-dasharray="5 4"' : ""}>${title}</path>`;
    };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="${(draft.height * 1500) / draft.width}" viewBox="0 0 1500 ${(draft.height * 1500) / draft.width}">${base}${features.map(mark).join("")}</svg>`;
}
