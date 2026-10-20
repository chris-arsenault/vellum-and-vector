import { mkdir, writeFile } from "node:fs/promises";
import { surfaceCode } from "../packages/domain/src/index";
import { macroFixture } from "../packages/generation/src/canonry/macroFixtures";
import { nearestTriangle } from "../packages/generation/src/canonry/mesh";
import { beginFinishing, finishedElevation } from "../packages/generation/src/canonry/macroTerrain";
import { composePass, crossingPath } from "../packages/generation/src/canonry/macroRelief";
import { composeRiverNetwork } from "../packages/generation/src/canonry/macroRivers";
import {
  composeBiologicalRegions,
  composeReefs,
} from "../packages/generation/src/canonry/macroCover";
import { initializeMagic } from "../packages/generation/src/canonry/magicState";

const panels: string[] = [];
function panel(
  title: string,
  value: (x: number, y: number) => number,
  palette: "terrain" | "cover",
  line: number[][] = []
) {
  const size = 420,
    step = 5,
    rectangles: string[] = [];
  for (let y = 0; y < size; y += step)
    for (let x = 0; x < size; x += step) {
      const v = value((x / size) * 200_000 - 100_000, (y / size) * 200_000 - 100_000),
        t = Math.max(0, Math.min(1, palette === "terrain" ? v / 2200 : v)),
        color =
          palette === "terrain"
            ? `rgb(${Math.round(90 + t * 150)},${Math.round(125 + t * 100)},${Math.round(75 + t * 155)})`
            : `rgb(${Math.round(215 - t * 175)},${Math.round(205 - t * 95)},${Math.round(145 - t * 85)})`;
      rectangles.push(`<rect x="${x}" y="${y}" width="${step}" height="${step}" fill="${color}"/>`);
    }
  const path = line
    .map(([x, y]) => `${((x + 100_000) / 200_000) * size},${((y + 100_000) / 200_000) * size}`)
    .join(" ");
  panels.push(
    `<g transform="translate(${(panels.length % 2) * 460 + 20},${Math.floor(panels.length / 2) * 465 + 45})"><text y="-12" font-size="18">${title}</text>${rectangles.join("")}${path ? `<polyline points="${path}" fill="none" stroke="#135cc1" stroke-width="3"/>` : ""}</g>`
  );
}
const pass = macroFixture(),
  work = pass.physical!,
  mesh = work.map.mesh;
const beforePass = finishedElevation(work);
panel("Mountain crossing: before", (x, y) => beforePass(x, y) / 1024, "terrain");
composePass(
  work,
  nearestTriangle(mesh, 0, 0),
  nearestTriangle(mesh, -45_000, 0),
  nearestTriangle(mesh, 45_000, 0)
);
const passRead = finishedElevation(work);
panel(
  "Mountain crossing: after",
  (x, y) => passRead(x, y) / 1024,
  "terrain",
  work.finishing!.passes[0].profile.points
);

const river = macroFixture(),
  rw = river.physical!,
  rm = rw.map;
for (let i = 0; i < rm.mesh.count; i++) {
  rm.Elevation[i] = (300 - rm.mesh.x[i] * 0.001) * 1024;
  rm.BedrockElevation[i] = rm.DrainageElevations[i] = rm.Elevation[i];
  rm.DrainageBasinIds[i] = 1;
}
const route = crossingPath(
  rw,
  nearestTriangle(rm.mesh, -80_000, 0),
  nearestTriangle(rm.mesh, 80_000, 0),
  nearestTriangle(rm.mesh, 0, 0),
  150_000
);
for (let n = 0; n < route.length - 1; n++) {
  const i = route[n];
  rm.FlowTargets[i] = route[n + 1];
  rm.RiverOrders[i] = 3;
  rm.RiverWidth[i] = 200;
  rm.RiverDepth[i] = 4;
}
beginFinishing(rw, river.surface);
const beforeRiver = finishedElevation(rw);
panel(
  "River network: before",
  (x, y) => beforeRiver(x, y) / 1024,
  "terrain",
  route.map((i) => [rm.mesh.x[i], rm.mesh.y[i]])
);
const paths = composeRiverNetwork(river, 42),
  afterRiver = finishedElevation(rw);
panel(
  "River network: after",
  (x, y) => afterRiver(x, y) / 1024,
  "terrain",
  paths.reaches!.get(route[0])!.points
);

const reef = macroFixture(),
  fw = reef.physical!,
  fm = fw.map;
initializeMagic(reef);
for (let i = 0; i < fm.mesh.count; i++) {
  fm.WaterKindCodes[i] = 1;
  fm.WaterDepths[i] = 60 * 1024;
  fm.Temperature[i] = 550;
  const radius = Math.hypot(fm.mesh.x[i], fm.mesh.y[i]);
  const filled = radius > 22_000 && radius < 80_000 && i % 7 !== 0;
  fw.magic!.naturalSurface[i] = surfaceCode(filled ? "Reef" : "Ocean");
  if (radius < 22_000) fm.WaterDepths[i] = 300 * 1024;
}
const reefBefore = fw.magic!.naturalSurface.slice();
panel(
  "Reef body: before",
  (x, y) => Number(reefBefore[nearestTriangle(fm.mesh, x, y)] === surfaceCode("Reef")),
  "cover"
);
const reefs = composeReefs(fw);
panel("Reef body: after", (x, y) => reefs[nearestTriangle(fm.mesh, x, y)], "cover");

const forest = macroFixture(),
  bw = forest.physical!,
  bm = bw.map;
for (let i = 0; i < bm.mesh.count; i++) {
  bm.TreeCover[i] = bm.BroadleafCover[i] = i % 11 === 0 ? 0 : 0.8;
  if (!bm.TreeCover[i]) bm.GrassCover[i] = 0.8;
}
const beforeForest = bm.TreeCover.slice();
panel(
  "Woodland community: before",
  (x, y) => beforeForest[nearestTriangle(bm.mesh, x, y)],
  "cover"
);
composeBiologicalRegions(bw);
panel("Woodland community: after", (x, y) => bm.TreeCover[nearestTriangle(bm.mesh, x, y)], "cover");
await mkdir(".artifacts", { recursive: true });
await writeFile(
  ".artifacts/macro-finishing.svg",
  `<svg xmlns="http://www.w3.org/2000/svg" width="940" height="1870" style="background:#eee;font-family:sans-serif">${panels.join("")}</svg>`
);
console.log(".artifacts/macro-finishing.svg");
