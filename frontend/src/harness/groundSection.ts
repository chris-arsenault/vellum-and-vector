import { writeFileSync } from "node:fs";
import { groundOf } from "../../../packages/generation/src/rock/ground";
import { rockKindOfCode } from "../../../packages/generation/src/rock/rockCatalogue";
import type { PhysicalField } from "../../../packages/generation/src/world/field";

type Facet = "land" | "cut";
const facets: readonly Facet[] = ["land", "cut"];
const metres = 1024;
// Fixed across snapshots: clipping is visible; JSON retains every recorded interval.
const lower = -12_000,
  upper = 12_000,
  sectionTop = 350,
  sectionHeight = 480;
const y = (height: number) =>
  sectionTop + ((upper - height / metres) / (upper - lower)) * sectionHeight;
const colour = (kind: number) => `hsl(${(kind * 137.508) % 360} 48% 66%)`;
const escape = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const label = (x: number, y: number, value: string) =>
  `<text x="${x}" y="${y}">${escape(value)}</text>`;

/** Explicit cell samples; their order is not a claim that they form a continuous transect. */
function cellsOf(text: string, count: number) {
  const cells = text.split(",").map((value) => Number(value.trim()));
  if (
    text.split(",").some((value) => !value.trim()) ||
    cells.some((cell) => !Number.isInteger(cell) || cell < 0 || cell >= count)
  )
    throw new Error("HARNESS_SECTION_CELLS must contain valid comma-separated cell indices.");
  return [...new Set(cells)];
}

function samplesOf(map: PhysicalField, cells: number[]) {
  const ground = groundOf(map);
  return cells.map((cell) => ({
    cell,
    x: map.mesh.x(cell) + map.mesh.origin[0],
    y: map.mesh.y(cell) + map.mesh.origin[1],
    elevationMetres: map.Elevation.get(cell) / metres,
    facets: facets.map((facet) => ({
      facet,
      layers: ground.section(cell, facet).map((layer) => ({
        ...layer,
        kindName: rockKindOfCode(layer.kind).id,
        secondaryKindName: rockKindOfCode(layer.secondaryKind).id,
      })),
    })),
  }));
}
type Sample = ReturnType<typeof samplesOf>[number];
type Layer = Sample["facets"][number]["layers"][number];

/** A cell-sampled elevation crop, with fixed colours and no extra terrain detail. */
function crop(map: PhysicalField, samples: Sample[]) {
  const xs = samples.map((sample) => sample.x),
    ys = samples.map((sample) => sample.y),
    west = Math.min(...xs),
    east = Math.max(...xs),
    south = Math.min(...ys),
    north = Math.max(...ys),
    padding = 2 * map.mesh.spacing,
    span = Math.max(east - west + 2 * padding, (north - south + 2 * padding) * 3.2),
    x0 = (west + east - span) / 2,
    y0 = (south + north + span / 3.2) / 2,
    pixels: string[] = [];
  for (let row = 0; row < 30; row++)
    for (let col = 0; col < 96; col++) {
      const cell = map.mesh.cellAt(
        x0 + ((col + 0.5) * span) / 96 - map.mesh.origin[0],
        y0 - ((row + 0.5) * span) / 96 - map.mesh.origin[1]
      );
      const height =
        cell < 0 || map.mesh.membership(cell) !== 1
          ? NaN
          : (map.Elevation.get(cell) - map.EffectiveSeaLevel) / metres;
      pixels.push(
        `<rect x="${40 + col * 7.5}" y="${60 + row * 7.5}" width="7.5" height="7.5" fill="${heightColour(height)}"/>`
      );
    }
  for (const sample of samples) {
    const x = 40 + ((sample.x - x0) * 720) / span,
      y = 60 + ((y0 - sample.y) * 720) / span;
    pixels.push(
      `<circle cx="${x}" cy="${y}" r="4" fill="white" stroke="black"/>`,
      label(x + 6, y - 5, String(sample.cell))
    );
  }
  return { bounds: [x0, y0 - span / 3.2, x0 + span, y0], svg: pixels.join("") };
}
function heightColour(height: number) {
  if (!Number.isFinite(height)) return "#fff";
  const bands: [number, string][] = [
    [0, "#232d46"],
    [500, "#96b96e"],
    [1000, "#d7cd78"],
    [2000, "#d79646"],
    [3000, "#b45032"],
    [4000, "#6e3228"],
    [Infinity, "#f5f5f5"],
  ];
  return bands.find(([limit]) => height <= limit)![1];
}
function layerPicture(layer: Layer, x: number) {
  const top = Math.max(sectionTop, y(layer.top)),
    bottom = Math.min(
      sectionTop + sectionHeight,
      layer.basement ? sectionTop + sectionHeight : y(layer.bottom)
    );
  if (bottom <= top) return "";
  const description = `${layer.kindName}; ${layer.medium}; ${layer.top / metres} to ${layer.bottom / metres} m; strength ${layer.strength}; damage ${layer.damage}; formed ${layer.formedMin}–${layer.formedMax}; altered ${layer.altered}; grain ${layer.grainX},${layer.grainY}; mixed ${layer.mixed}; secondary ${layer.secondaryKindName} share ${layer.secondaryShare}${layer.basement ? "; basement continues below recorded interval" : ""}`;
  return `<g><title>${escape(description)}</title><rect x="${x}" y="${top}" width="54" height="${bottom - top}" fill="${colour(layer.kind)}" stroke="#444" stroke-width="0.5"/>${layer.basement ? label(x + 4, bottom - 5, "↓") : ""}</g>`;
}
function samplePicture(sample: Sample, index: number) {
  const x = 90 + index * 170;
  return (
    label(x, sectionTop - 42, `Cell ${sample.cell}`) +
    sample.facets
      .map(({ facet, layers }, at) => {
        const left = x + at * 72,
          share = layers[0]?.share ?? 0;
        return (
          label(left, sectionTop - 24, facet) +
          label(left, sectionTop - 8, `${(share * 100).toFixed(1)}%`) +
          layers.map((layer) => layerPicture(layer, left)).join("") +
          (layers.length ? "" : label(left, sectionTop + 20, "absent"))
        );
      })
      .join("")
  );
}
function sectionSvg(samples: Sample[], terrain: string) {
  const width = Math.max(820, 100 + samples.length * 170),
    kinds = [
      ...new Map(
        samples.flatMap((sample) =>
          sample.facets.flatMap(({ layers }) =>
            layers.map((layer) => [layer.kind, layer.kindName] as const)
          )
        )
      ).entries(),
    ],
    legendY = sectionTop + sectionHeight + 55,
    height = legendY + 30 + Math.ceil(kinds.length / 4) * 24,
    ticks = [-12_000, -8000, -4000, 0, 4000, 8000, 12_000].map(
      (height) =>
        label(4, y(height * metres) + 4, String(height)) +
        `<path d="M65 ${y(height * metres)} H${width - 20}" stroke="#ddd"/>`
    ),
    legend = kinds.map(
      ([kind, name], at) =>
        `<rect x="${40 + (at % 4) * 190}" y="${legendY + Math.floor(at / 4) * 24}" width="14" height="14" fill="${colour(kind)}"/>` +
        label(60 + (at % 4) * 190, legendY + Math.floor(at / 4) * 24 + 12, name)
    );
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><style>text{font:12px sans-serif;fill:#111}</style><rect width="100%" height="100%" fill="white"/>` +
    label(40, 22, "Ground samples: elevation crop above; material columns below") +
    label(
      40,
      42,
      "Equal-width facet panels show shares, not subcell positions or a continuous transect."
    ) +
    terrain +
    ticks.join("") +
    samples.map(samplePicture).join("") +
    label(
      40,
      sectionTop + sectionHeight + 22,
      "Metres above field datum; view clips at ±12 km. Down arrow: basement continues; JSON retains recorded intervals."
    ) +
    legend.join("") +
    "</svg>"
  );
}

/** Optional local artifacts beside replay's ordinary terrain images; never changes the field. */
export function writeGroundSection(map: PhysicalField, stem: string, selection: string) {
  if (!selection.trim()) return;
  const samples = samplesOf(map, cellsOf(selection, map.mesh.count)),
    terrain = crop(map, samples);
  writeFileSync(
    `${stem}-section.json`,
    JSON.stringify(
      {
        cellSpanMetres: map.mesh.spacing,
        verticalUnitsPerMetre: metres,
        seaLevelMetres: map.EffectiveSeaLevel / metres,
        cropBounds: terrain.bounds,
        sectionViewMetres: [lower, upper],
        interpretation:
          "Independent cell samples. Facet shares have no represented subcell positions. Basement continues below its recorded depth.",
        samples,
      },
      null,
      2
    )
  );
  writeFileSync(`${stem}-section.svg`, sectionSvg(samples, terrain.svg));
}
