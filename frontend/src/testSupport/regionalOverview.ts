import { mkdir, writeFile } from "node:fs/promises";
import { gridPosition, type AtlasFeature } from "@atlas/domain";
import type { CompletedBoundary } from "@atlas/generation";
import type { Geometry } from "geojson";
import { surfacePalette } from "../rasterPresentation";

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
        `<path d="${path(f.geometry)}" stroke="${color}" fill="none" stroke-width="1.4" vector-effect="non-scaling-stroke"/>`,
      ];
    if (f.geometry.type !== "Point") return [];
    const [x, y] = f.geometry.coordinates,
      fill = f.kind === "settlement" ? "#27251d" : "#b44b21";
    return [`<circle cx="${x}" cy="${y}" r="${(e - w) / 600}" fill="${fill}"/>`];
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="800" viewBox="${w} ${s} ${e - w} ${n - s}"><g transform="translate(0 ${s + n}) scale(1 -1)">${cells.join("")}${paths.join("")}</g></svg>`;
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
