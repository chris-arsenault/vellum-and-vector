import type { Position } from "./model";
import { requireThat } from "./errors";
import { spatial } from "./spatial";
import type { GridSurface } from "./grids";
import { interpolateSample } from "./grids";
import {
  adaptivePointLocator,
  prepareAdaptivePatches,
  type AdaptivePointLocator,
} from "./adaptivePoint";
import { evaluatePreparedAdaptiveCell } from "./adaptiveHermite";
import { fieldPosition } from "./gridPeriodicity";

/**
 * The class at a point, reconstructed from per-cell memberships. Each candidate class's
 * 0/1 membership is interpolated with the shared Hermite patches and the highest wins.
 * Cell centres keep their stored class. Regular grids blend memberships bilinearly.
 * Region margins can use classMarginInterpolator to trace the same winning transition.
 */
export function classInterpolator(
  grid: GridSurface,
  channel: string,
  locate: AdaptivePointLocator = adaptivePointLocator()
): (p: Position) => number {
  return classEvaluator(grid, channel, locate);
}
/** Signed margin of a family against other classes, using the raster's exact class weights. */
export function classMarginInterpolator(
  grid: GridSurface,
  channel: string,
  includes: (code: number) => boolean,
  locate: AdaptivePointLocator = adaptivePointLocator()
) {
  return classEvaluator(grid, channel, locate, includes);
}
function classEvaluator(
  grid: GridSurface,
  channel: string,
  locate: AdaptivePointLocator,
  includes?: (code: number) => boolean
): (p: Position) => number {
  const overlays = [...(grid.overlays ?? [])]
    .reverse()
    .filter((overlay) => overlay.channels.includes(channel))
    .map((overlay) => ({
      covered: spatial.pointCoverage(overlay.grid.scope.footprint),
      at: classEvaluator(overlay.grid, channel, locate, includes),
    }));
  const base = baseClassSampler(grid, channel, locate, includes);
  return (p: Position) => {
    const overlay = overlays.find((candidate) => candidate.covered(p));
    return overlay ? overlay.at(p) : base(fieldPosition(grid, p));
  };
}
/**
 * Regular grids interpolate continuous channels bilinearly, so class memberships blend
 * over the same four corner cells; ties go to the nearest cell.
 */
function latticeClassSampler(
  grid: GridSurface,
  channel: string,
  includes?: (code: number) => boolean
) {
  const width = grid.width ?? 0,
    height = grid.height ?? 0;
  if (width < 2 || height < 2)
    return (p: Position) => singleClass(interpolateSample(grid, channel, p, true), includes);
  const [x0, y0, x1, y1] = grid.bounds;
  const readCell = latticeMembership(grid, channel, width);
  return (p: Position) => {
    const gx = Math.max(0, Math.min(width - 1, ((p.x - x0) / (x1 - x0)) * (width - 1))),
      gy = Math.max(0, Math.min(height - 1, ((p.y - y0) / (y1 - y0)) * (height - 1)));
    const x = Math.min(Math.floor(gx), width - 2),
      y = Math.min(Math.floor(gy), height - 2),
      tx = gx - x,
      ty = gy - y,
      i = y * width + x;
    const { codes, mask } = readCell(i),
      weights = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty];
    const nearest = codes[(Math.round(gy) - y) * 2 + Math.round(gx) - x];
    let best = nearest,
      bestWeight = -Infinity,
      inside = 0,
      outside = 0;
    for (let a = 0; a < 4; a++) {
      if (!mask[a]) continue;
      const code = codes[a];
      const weight = membershipWeight(codes, mask, weights, code);
      if (includes) {
        if (includes(code)) inside = Math.max(inside, weight);
        else outside = Math.max(outside, weight);
      }
      if (weight > bestWeight || (weight === bestWeight && code === nearest)) {
        best = code;
        bestWeight = weight;
      }
    }
    return includes ? inside - outside : best;
  };
}
function membershipWeight(codes: number[], mask: number[], weights: number[], code: number) {
  let weight = 0;
  for (let b = 0; b < codes.length; b++) if (mask[b] && codes[b] === code) weight += weights[b];
  return weight;
}
function latticeMembership(grid: GridSurface, channel: string, width: number) {
  const values = grid.channels[channel],
    active = grid.active;
  let previous = -1,
    held: { codes: number[]; mask: number[] };
  return (cell: number) => {
    if (cell !== previous || !values.schema.immutable || !active.schema.immutable) {
      const corners = [cell, cell + 1, cell + width, cell + width + 1];
      held = {
        codes: corners.map((i) => values.get(i)),
        mask: corners.map((i) => active.get(i)),
      };
      previous = cell;
    }
    return held;
  };
}
function singleClass(code: number, includes?: (code: number) => boolean) {
  return includes ? (includes(code) ? 1 : -1) : code;
}
function baseClassSampler(
  grid: GridSurface,
  channel: string,
  locate: AdaptivePointLocator,
  includes?: (code: number) => boolean
) {
  const values = grid.channels[channel];
  requireThat(values, "missing_channel", `Field channel ${channel} is unavailable.`);
  const t = grid.topology;
  if (!t) return latticeClassSampler(grid, channel, includes);
  const active = grid.active;
  const patches = new Map<number, ReturnType<typeof prepareAdaptivePatches>>();
  const membership = (code: number) => {
    let patch = patches.get(code);
    if (!patch) {
      patch = prepareAdaptivePatches(t, (leaf: number) =>
        active.get(leaf) && values.get(leaf) === code ? 1 : 0
      );
      patches.set(code, patch);
    }
    return patch;
  };
  // Classes that can reach a cell's patch: its own and those sharing an edge or a corner.
  const candidates = new Map<number, number[]>();
  const candidatesAt = (leaf: number) => {
    let codes = candidates.get(leaf);
    if (codes) return codes;
    const found = new Set<number>();
    const visit = (cell: number, ring: number) => {
      if (active.get(cell)) found.add(values.get(cell));
      if (!ring) return;
      for (let at = t.offsets.get(cell); at < t.offsets.get(cell + 1); at++)
        visit(t.neighbors.get(at), ring - 1);
    };
    visit(leaf, 2);
    codes = [...found];
    candidates.set(leaf, codes);
    return codes;
  };
  return (p: Position) => {
    const x = Math.max(t.bounds[0], Math.min(t.bounds[2], p.x)),
      y = Math.max(t.bounds[1], Math.min(t.bounds[3], p.y));
    const { leaf, u, v } = locate(t, x, y);
    if (leaf < 0) return NaN;
    const codes = candidatesAt(leaf);
    if (codes.length <= 1) return singleClass(codes[0] ?? values.get(leaf), includes);
    let best = values.get(leaf),
      bestValue = -Infinity,
      inside = 0,
      outside = 0;
    for (const code of codes) {
      const value = evaluatePreparedAdaptiveCell(membership(code)(leaf), u, v);
      if (includes) {
        if (includes(code)) inside = Math.max(inside, value);
        else outside = Math.max(outside, value);
      }
      if (value > bestValue) {
        best = code;
        bestValue = value;
      }
    }
    return includes ? inside - outside : best;
  };
}
