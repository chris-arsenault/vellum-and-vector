import Feature from "ol/Feature.js";
import Point from "ol/geom/Point.js";
import GeoJSON from "ol/format/GeoJSON.js";
import { Fill, Stroke, Style } from "ol/style.js";
import { fieldInterpolator, spatial, presentedFeatureStyle } from "@atlas/domain";
import type { Geometry, Point as GeoPoint } from "geojson";
import type { LoadedDrawnMapInput as DrawnMapInput } from "./drawnMap";
import { drawnIcon, type DrawnIconKind } from "./drawnSymbols";
import { biomeTreatment } from "./drawnEcology";
import { drawingGeography } from "./drawnGeography";
import { bounds } from "./presentation";
import type { LoadedRaster as Raster } from "./types";
import { terrainWater } from "./terrainWater";

// Symbol spacing describes visual density at the subject scale, not generated detail.
export const terrainSymbolsAcrossSubject = 32;
export const illustratedMountainHeightMetres = 600;
export const illustratedReliefMetres = 80;
export const illustratedTreeCover = 0.3;

export interface TerrainMark {
  coordinate: [number, number];
  kind: DrawnIconKind;
  size: number;
}
function jitter(x: number, y: number) {
  const h = Math.imul(x ^ 1234567, 374761393) ^ Math.imul(y ^ 7654321, 668265263);
  return ((h >>> 0) % 1000) / 1000;
}
/** A fixed world lattice makes symbols repeatable across pan and composition reopen. */
export function terrainMarks(input: DrawnMapInput, footprint: Geometry): TerrainMark[] {
  if (!input.view.terrain) return [];
  const box = bounds(footprint),
    covered = spatial.pointCoverage(footprint);
  const step =
    Math.max(box[2] - box[0], box[3] - box[1]) / terrainSymbolsAcrossSubject / input.view.density;
  const samples = terrainSamplers(input),
    forests = biomeCover(input);
  const excluded = terrainExclusions(input);
  const enabled = {
    tree: layerVisible(input, "ecology"),
    mountain: layerVisible(input, "geology"),
  };
  const clearings = input.features
    .filter((f) => f.kind === "settlement" && f.geometry.type === "Point")
    .map((f) => (f.geometry as GeoPoint).coordinates);
  const marks: TerrainMark[] = [];
  for (let y = Math.floor(box[1] / step); y * step < box[3]; y++) {
    for (let x = Math.floor(box[0] / step); x * step < box[2]; x++) {
      const p = {
        x: (x + 0.2 + jitter(x, y) * 0.6) * step,
        y: (y + 0.2 + jitter(y, x) * 0.6) * step,
        z: 0,
      };
      if (!covered(p)) continue;
      if (clearings.some(([x, y]) => Math.abs(x - p.x) < step * 1.5 && Math.abs(y - p.y) < step))
        continue;
      const mark = markAt({ p, x, y, step, samples, forests });
      if (mark && terrainShown(mark, enabled, excluded, p)) marks.push(mark);
    }
  }
  return marks;
}
function terrainShown(
  mark: TerrainMark,
  enabled: Record<"mountain" | "tree", boolean>,
  excluded: ReturnType<typeof terrainExclusions>,
  p: { x: number; y: number; z: number }
) {
  const family = mark.kind === "mountain" ? "mountain" : "tree";
  return enabled[family] && !excluded.some((e) => e.kind === family && e.covers(p));
}
function terrainExclusions(input: DrawnMapInput) {
  return input.features.flatMap((f) => {
    if (!["forest", "peak", "hill", "ridge"].includes(f.kind) || !featureHidden(input, f))
      return [];
    const geometry = f.footprint ?? f.geometry;
    if (!geometry.type.includes("Polygon")) return [];
    return [
      { kind: f.kind === "forest" ? "tree" : "mountain", covers: spatial.pointCoverage(geometry) },
    ];
  });
}
function layerVisible(input: DrawnMapInput, id: string) {
  return input.styles.find((s) => s.layerId === id)?.visible !== false;
}
function featureHidden(input: DrawnMapInput, feature: DrawnMapInput["features"][number]) {
  const layer = input.styles.find((s) => s.layerId === feature.layerId);
  if (layer && !presentedFeatureStyle(input.world, feature, layer).visible) return true;
  const own = input.view.overrides[feature.id];
  return !!own && (!!own.hidden || !!own.illustrationHidden);
}
function markAt({
  p,
  x,
  y,
  step,
  samples,
  forests,
}: {
  p: { x: number; y: number; z: number };
  x: number;
  y: number;
  step: number;
  samples: ReturnType<typeof terrainSamplers>;
  forests: ReturnType<typeof biomeCover>;
}): TerrainMark | null {
  const sample = samples.find((s) => s.covers(p));
  const elevation = sample?.height(p) ?? 0;
  if (sample && sample.water(p, elevation).kind > 0) return null;
  if (sample && mountainAt(sample.height, p, elevation, step) && jitter(x + 1, y + 1) > 0.35)
    return {
      coordinate: [p.x, p.y],
      kind: "mountain",
      size: 18 + Math.round(10 * Math.min(1, elevation / 4000)),
    };
  const biome = forests.find((f) => f.covers(p));
  if (biome)
    return { coordinate: [p.x, p.y], kind: biome.symbol, size: 18 + Math.round(jitter(y, x) * 4) };
  const trees = samples.some((s) => s.tree && s.covers(p) && s.tree(p) >= illustratedTreeCover);
  return trees
    ? { coordinate: [p.x, p.y], kind: "tree", size: 15 + Math.round(jitter(y, x) * 5) }
    : null;
}
function mountainAt(
  height: (p: { x: number; y: number; z: number }) => number,
  p: { x: number; y: number; z: number },
  elevation: number,
  step: number
) {
  if (elevation < illustratedMountainHeightMetres) return false;
  const neighbors = [
    [-step, 0],
    [step, 0],
    [0, step],
    [0, -step],
  ].map(([dx, dy]) => height({ ...p, x: p.x + dx, y: p.y + dy }));
  return elevation - Math.min(...neighbors) >= illustratedReliefMetres;
}
function terrainSamplers(input: DrawnMapInput) {
  return input.base
    .slice()
    .reverse()
    .map((r) => ({
      covers: spatial.pointCoverage(r.footprint),
      height: fieldInterpolator(r.field, "elevation"),
      water: terrainWater(r),
      tree: treeSampler(input.rasters, r),
    }));
}
function treeSampler(rasters: Raster[], base: Raster) {
  const trees = rasters.find((r) => r.areaId === base.areaId && r.channel === "treeCover");
  return trees ? fieldInterpolator(trees.field, trees.channel) : null;
}
function biomeCover(input: DrawnMapInput) {
  const geography = drawingGeography(input.features, input.base);
  return input.features.flatMap((f) => {
    const biome = biomeTreatment(f),
      shape = geography.get(f.id);
    return biome && shape && !featureHidden(input, f)
      ? [{ symbol: biome.symbol, covers: spatial.pointCoverage(shape) }]
      : [];
  });
}
export function illustratedTerrain(input: Pick<DrawnMapInput, "view">, marks: TerrainMark[]) {
  return marks.map((mark) => {
    const feature = new Feature({ geometry: new Point(mark.coordinate) });
    feature.setStyle(
      new Style({
        image: drawnIcon(mark.kind, mark.size, input.view.style === "ink"),
        zIndex: mark.kind === "mountain" ? -20 : -30,
      })
    );
    return feature;
  });
}
/** Coast echoes are display buffers; the physical shoreline is always the original. */
export function coastEchoes(ocean: Geometry, step: number) {
  return [step * 0.1, step * 0.23].flatMap((distance) => {
    const inner = spatial.buffer(ocean, -distance);
    if (!inner) return [];
    const feature = new Feature({ geometry: new GeoJSON().readGeometry(inner)! });
    feature.setStyle(
      new Style({
        fill: new Fill({ color: "#00000000" }),
        stroke: new Stroke({ color: "#6e938955", width: 0.6 }),
        zIndex: -80,
      })
    );
    return [feature];
  });
}
