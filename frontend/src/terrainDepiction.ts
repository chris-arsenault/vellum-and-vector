import { typePresentation } from "./featureTypePresentation";
import type { CartographicPresentation, LayerStyle } from "./types";
import type { Geometry, Point as GeoPoint } from "geojson";
import type { RenderFeature, FeatureAppearance } from "./renderFeature";
import type { DrawnIconKind } from "./drawnSymbols";
import type { DrawingGeography } from "./publishedAppearance";
import { biomeTreatment } from "./drawnEcology";
import { bounds } from "./presentation";

export const terrainSymbolsAcrossSubject = 32;
export const illustratedMountainHeightMetres = 600;
export const illustratedReliefMetres = 80;
export const illustratedTreeCover = 0.3;
type Point = { x: number; y: number; z: number };
export interface TerrainSampler {
  covers(point: Point): boolean;
  /** Published ground height in metres. */
  height(point: Point): number;
  water(point: Point, height: number): number;
  tree: ((point: Point) => number) | null;
}
export interface TerrainDepiction<F extends RenderFeature> {
  view: CartographicPresentation;
  features: F[];
  styles: LayerStyle[];
  appearance: FeatureAppearance<F>;
  geography: DrawingGeography;
  samples: TerrainSampler[];
  coverage: (polygons: Geometry[], points: Point[]) => Promise<boolean[][]>;
}
export interface TerrainMark {
  coordinate: [number, number];
  kind: DrawnIconKind;
  size: number;
}
function jitter(x: number, y: number) {
  const h = Math.imul(x ^ 1234567, 374761393) ^ Math.imul(y ^ 7654321, 668265263);
  return ((h >>> 0) % 1000) / 1000;
}
/** The drawing lattice follows the selected subject and density, independently of generation. */
export async function depictTerrain<F extends RenderFeature>(
  input: TerrainDepiction<F>,
  footprint: Geometry
): Promise<TerrainMark[]> {
  if (!input.view.terrain) return [];
  const box = bounds(footprint);
  const step =
    Math.max(box[2] - box[0], box[3] - box[1]) / terrainSymbolsAcrossSubject / input.view.density;
  const samples = input.samples,
    forests = biomeCover(input),
    excluded = terrainExclusions(input);
  const enabled = {
    tree: layerVisible(input, "ecology"),
    mountain: layerVisible(input, "geology"),
  };
  const clearings = input.features
    .filter((feature) => feature.kind === "settlement" && feature.geometry.type === "Point")
    .map((feature) => (feature.geometry as GeoPoint).coordinates);
  const marks: TerrainMark[] = [];
  const candidates = terrainCandidates(box, step);
  const coverage = await input.coverage(
    [footprint, ...forests.map((entry) => entry.shape), ...excluded.map((entry) => entry.shape)],
    candidates.map((entry) => entry.p)
  );
  candidates.forEach(({ p, x, y }, index) => {
    if (!coverage[0][index]) return;
    if (clearings.some(([x, y]) => Math.abs(x - p.x) < step * 1.5 && Math.abs(y - p.y) < step))
      return;
    const forest = forests.find((_, i) => coverage[1 + i][index]);
    const mark = markAt({ p, x, y, step, samples, forest });
    const hidden = excluded.filter((_, i) => coverage[1 + forests.length + i][index]);
    if (mark && terrainShown(mark, enabled, hidden)) marks.push(mark);
  });
  return marks;
}
function terrainCandidates(box: number[], step: number) {
  const candidates: { p: Point; x: number; y: number }[] = [];
  for (let y = Math.floor(box[1] / step); y * step < box[3]; y++) {
    for (let x = Math.floor(box[0] / step); x * step < box[2]; x++) {
      const p = {
        x: (x + 0.2 + jitter(x, y) * 0.6) * step,
        y: (y + 0.2 + jitter(y, x) * 0.6) * step,
        z: 0,
      };
      candidates.push({ p, x, y });
    }
  }
  return candidates;
}
function terrainShown(
  mark: TerrainMark,
  enabled: Record<"mountain" | "tree", boolean>,
  excluded: { kind: string }[]
) {
  const family = mark.kind === "mountain" ? "mountain" : "tree";
  return enabled[family] && !excluded.some((entry) => entry.kind === family);
}
function terrainExclusions<F extends RenderFeature>(input: TerrainDepiction<F>) {
  return input.features.flatMap((feature) => {
    if (
      !["forest", "peak", "hill", "ridge"].includes(feature.kind) ||
      !featureHidden(input, feature)
    )
      return [];
    const geometry = feature.footprint ?? feature.geometry;
    if (!geometry.type.includes("Polygon")) return [];
    return [
      {
        kind: feature.kind === "forest" ? "tree" : "mountain",
        shape: geometry,
      },
    ];
  });
}
function layerVisible<F extends RenderFeature>(input: TerrainDepiction<F>, id: string) {
  return input.styles.find((style) => style.layerId === id)?.visible !== false;
}
function featureHidden<F extends RenderFeature>(input: TerrainDepiction<F>, feature: F) {
  const layer = input.styles.find((style) => style.layerId === feature.layerId);
  if (layer && !typePresentation(input.appearance.type(feature), layer).visible) return true;
  const own = input.view.overrides[feature.id];
  return !!own && (!!own.hidden || !!own.illustrationHidden);
}
function markAt({
  p,
  x,
  y,
  step,
  samples,
  forest,
}: {
  p: Point;
  x: number;
  y: number;
  step: number;
  samples: TerrainSampler[];
  forest: { symbol: DrawnIconKind } | undefined;
}): TerrainMark | null {
  const sample = samples.find((entry) => entry.covers(p));
  const elevation = sample?.height(p) ?? 0;
  if (sample && sample.water(p, elevation) > 0) return null;
  if (sample && mountainAt(sample.height, p, elevation, step) && jitter(x + 1, y + 1) > 0.35)
    return {
      coordinate: [p.x, p.y],
      kind: "mountain",
      size: 18 + Math.round(10 * Math.min(1, elevation / 4000)),
    };
  if (forest)
    return { coordinate: [p.x, p.y], kind: forest.symbol, size: 18 + Math.round(jitter(y, x) * 4) };
  const trees = samples.some(
    (entry) => entry.tree && entry.covers(p) && entry.tree(p) >= illustratedTreeCover
  );
  return trees
    ? { coordinate: [p.x, p.y], kind: "tree", size: 15 + Math.round(jitter(y, x) * 5) }
    : null;
}
function mountainAt(
  height: TerrainSampler["height"],
  point: Point,
  elevation: number,
  step: number
) {
  if (elevation < illustratedMountainHeightMetres) return false;
  const neighbors = [
    [-step, 0],
    [step, 0],
    [0, step],
    [0, -step],
  ].map(([dx, dy]) => height({ ...point, x: point.x + dx, y: point.y + dy }));
  return elevation - Math.min(...neighbors) >= illustratedReliefMetres;
}
function biomeCover<F extends RenderFeature>(input: TerrainDepiction<F>) {
  return input.features.flatMap((feature) => {
    const biome = biomeTreatment(feature),
      shape = input.geography.get(feature.id);
    return biome && shape && !featureHidden(input, feature)
      ? [{ symbol: biome.symbol, shape }]
      : [];
  });
}
