import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { MapScale } from "@atlas/domain";
import { rockCatalogue, rockKindOfCode } from "../../../packages/generation/src/rock/rockCatalogue";
import type { PhysicalField } from "../../../packages/generation/src/world/field";
import { physicalGradients } from "../../../packages/generation/src/world/physicalMetric";
import { releaseWorking } from "../../../packages/generation/src/world/physicalNumerics";
import {
  materialColours,
  surfaceMaterialCode,
  surfaceWaterCode,
} from "../../../packages/generation/src/rock/groundPresentation";
import { drawCells } from "./reliefSystems";

const remnantMaterials = new Set([
  "saltbed",
  "veinrock",
  "sinter",
  "corefall",
  "rimerot",
  "auroraCrystal",
  "crushstone",
  "rootstone",
  "tufa",
  "saltGlass",
  "keptStone",
  "tornstone",
]);
/** Current display candidates only; a material name does not identify the process that made it. */
function writeCandidates(map: PhysicalField, out: string, name: string) {
  if (!process.env.HARNESS_MATERIAL_CANDIDATES) return;
  const samples = [];
  for (let cell = 0; cell < map.mesh.count; cell++) {
    if (map.mesh.membership(cell) !== 1) continue;
    const code = surfaceMaterialCode(map, cell);
    if (code === surfaceWaterCode) continue;
    const material = rockKindOfCode(code).id;
    if (!remnantMaterials.has(material)) continue;
    samples.push({
      cell,
      material,
      x: map.mesh.x(cell) + map.mesh.origin[0],
      y: map.mesh.y(cell) + map.mesh.origin[1],
      elevationMetres: MapScale.metres(map.Elevation.get(cell), "native"),
    });
  }
  writeFileSync(
    join(out, `${name}-material-candidates.json`),
    JSON.stringify(
      {
        interpretation:
          "Actual exposed display materials, with water, ice and soil masking. Names do not establish origin: salt can be ordinary evaporite; tornstone can come from Veil or a meeting. Active forcing is not retained in physical snapshots; compare the separate magic observations.",
        completedEpochs: map.CompletedEpochCount,
        samples,
      },
      null,
      1
    )
  );
}

/** Current exposed substrate, with real relief shading; no history or active-field labels. */
export function drawMaterials(map: PhysicalField, out: string, name: string) {
  writeCandidates(map, out, name);
  const gradient = physicalGradients(
    map.mesh,
    (i) => MapScale.metres(map.Elevation.get(i), "native"),
    map.coverage
  );
  try {
    const colours = new Uint8Array(map.mesh.count * 3);
    for (let cell = 0; cell < map.mesh.count; cell++) {
      const code = surfaceMaterialCode(map, cell);
      colours.set(
        code === surfaceWaterCode ? [52, 86, 107] : materialColours[rockKindOfCode(code).id],
        cell * 3
      );
    }
    drawCells(map, out, `${name}-materials.png`, (cell) => {
      const x = gradient.x.get(cell),
        y = gradient.y.get(cell),
        light = (0.5 * x - 0.5 * y + Math.SQRT1_2) / Math.hypot(x, y, 1),
        shade = 0.45 + 0.55 * Math.max(0, light);
      return [0, 1, 2].map((channel) => Math.round(colours[cell * 3 + channel] * shade));
    });
  } finally {
    releaseWorking(map, gradient.x, gradient.y);
  }
  const entries = Object.entries(materialColours).map(
    ([id, colour], row) =>
      `<rect x="10" y="${12 + row * 22}" width="18" height="16" fill="rgb(${colour.join(",")})"/><text x="36" y="${25 + row * 22}">${rockCatalogue[id as keyof typeof rockCatalogue].name}</text>`
  );
  writeFileSync(
    join(out, `${name}-materials-legend.svg`),
    `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="${24 + entries.length * 22}"><rect width="100%" height="100%" fill="white"/><g font-family="sans-serif" font-size="13">${entries.join("")}</g></svg>`
  );
}
