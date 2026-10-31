import { mkdir, writeFile } from "node:fs/promises";
import { gridPosition, type AtlasFeature } from "@atlas/domain";
import type { CompletedBoundary } from "@atlas/generation";
import type { Geometry } from "geojson";
import { surfacePalette } from "../rasterPresentation";
import { rasterLimits, tilePainter } from "../rasterTiles";

/** Local generated artifact for inspecting the same workload's geography together. */
export async function regionalOverview(result: CompletedBoundary, features: AtlasFeature[]) {
  const g = result.state.surface,
    [w, s, e, n] = g.bounds,
    dx = (e - w) / (g.width! - 1),
    dy = (n - s) / (g.height! - 1),
    colors = new Map(surfacePalette(result.state.domain.world).map((c) => [c.code, c.color])),
    cells: string[] = [];
  for (let i = 0; i < g.active.length; i++) {
    const p = gridPosition(g, i),
      fill = colors.get(g.channels.finalSurface.get(i)) ?? "#ded6b7";
    cells.push(
      `<rect x="${p.x - dx / 2}" y="${p.y - dy / 2}" width="${dx}" height="${dy}" fill="${fill}"/>`
    );
  }
  const paths = features.flatMap((f) => {
    const color = f.kind === "river" ? "#22628f" : f.kind === "road" ? "#705231" : null;
    if (color)
      return [
        `<path data-kind="${f.kind}" d="${path(f.geometry)}" stroke="${color}" fill="none" stroke-width="1.4" vector-effect="non-scaling-stroke"/>`,
      ];
    if (f.geometry.type !== "Point") return [];
    const [x, y] = f.geometry.coordinates,
      fill = f.kind === "settlement" ? "#27251d" : "#b44b21";
    return [
      `<circle data-kind="${f.kind}" cx="${x}" cy="${y}" r="${(e - w) / 600}" fill="${fill}"/>`,
    ];
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="800" viewBox="${w} ${s} ${e - w} ${n - s}"><g transform="translate(0 ${s + n}) scale(1 -1)"><g shape-rendering="crispEdges">${cells.join("")}</g>${paths.join("")}</g></svg>`;
  await mkdir(".artifacts/regional", { recursive: true });
  await writeFile(".artifacts/regional/standard-overview.svg", svg);
}

function path(g: Geometry): string {
  if (g.type === "LineString")
    return `M${g.coordinates.map((p) => p.slice(0, 2).join(",")).join("L")}`;
  if (g.type === "MultiLineString")
    return g.coordinates.map((coordinates) => path({ type: "LineString", coordinates })).join("");
  return "";
}

/** The production terrain painter, without cover wash, for inspecting developed relief. */
export async function regionalReliefOverview(result: CompletedBoundary) {
  const g = result.state.surface,
    raster = {
      id: g.id,
      areaId: g.scope.areaId,
      field: g,
      water: g,
      ice: g,
      footprint: g.scope.footprint,
      bounds: g.bounds,
      channel: "elevation",
    },
    size = 512,
    pixels = tilePainter(raster, rasterLimits([raster]))(g.bounds, size),
    rows: string[] = [];
  for (let y = 0; y < size; y++) {
    let x = 0;
    while (x < size) {
      const start = x,
        offset = (y * size + x) * 4,
        color = Array.from(pixels.slice(offset, offset + 3)).join(",");
      x++;
      while (
        x < size &&
        Array.from(pixels.slice((y * size + x) * 4, (y * size + x) * 4 + 3)).join(",") === color
      )
        x++;
      rows.push(
        `<rect x="${start}" y="${y}" width="${x - start}" height="1" fill="rgb(${color})"/>`
      );
    }
  }
  await mkdir(".artifacts/regional", { recursive: true });
  await writeFile(
    ".artifacts/regional/standard-relief.svg",
    `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="${(1400 * (g.bounds[3] - g.bounds[1])) / (g.bounds[2] - g.bounds[0])}" viewBox="0 0 ${size} ${size}" preserveAspectRatio="none" shape-rendering="crispEdges">${rows.join("")}</svg>`
  );
}
