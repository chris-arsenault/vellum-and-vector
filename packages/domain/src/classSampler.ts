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

/**
 * The class at a point, reconstructed from per-cell memberships. Each candidate class's
 * 0/1 membership is interpolated with the shared Hermite patches and the highest wins.
 * Cell centres keep their stored class; boundaries fall where membership crosses one
 * half, which is where region outlines are traced, so raster fills and vector outlines
 * agree. Grids without an adaptive topology keep their nearest-cell class.
 */
export function classInterpolator(
  grid: GridSurface,
  channel: string,
  locate: AdaptivePointLocator = adaptivePointLocator()
): (p: Position) => number {
  const overlays = [...(grid.overlays ?? [])]
    .reverse()
    .filter((overlay) => overlay.channels.includes(channel))
    .map((overlay) => ({
      covered: spatial.pointCoverage(overlay.grid.scope.footprint),
      at: classInterpolator(overlay.grid, channel, locate),
    }));
  const base = baseClassSampler(grid, channel, locate);
  return (p: Position) => {
    const overlay = overlays.find((candidate) => candidate.covered(p));
    return overlay ? overlay.at(p) : base(p);
  };
}
/**
 * Regular grids interpolate continuous channels bilinearly, so class memberships blend
 * over the same four corner cells; ties go to the nearest cell.
 */
function latticeClassSampler(grid: GridSurface, channel: string) {
  const width = grid.width ?? 0,
    height = grid.height ?? 0;
  if (width < 2 || height < 2) return (p: Position) => interpolateSample(grid, channel, p, true);
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
      bestWeight = -Infinity;
    for (let a = 0; a < 4; a++) {
      if (!mask[a]) continue;
      const code = codes[a];
      let weight = 0;
      for (let b = 0; b < 4; b++) if (mask[b] && codes[b] === code) weight += weights[b];
      if (weight > bestWeight || (weight === bestWeight && code === nearest)) {
        best = code;
        bestWeight = weight;
      }
    }
    return best;
  };
}
function latticeMembership(grid: GridSurface, channel: string, width: number) {
  const values = grid.channels[channel],
    active = grid.active;
  let previous = -1,
    held: { codes: number[]; mask: number[] };
  return (cell: number) => {
    if (cell !== previous || !values.immutable || !active.immutable) {
      const corners = [cell, cell + 1, cell + width, cell + width + 1];
      held = { codes: corners.map((i) => values[i]), mask: corners.map((i) => active[i]) };
      previous = cell;
    }
    return held;
  };
}
function baseClassSampler(grid: GridSurface, channel: string, locate: AdaptivePointLocator) {
  const values = grid.channels[channel];
  requireThat(values, "missing_channel", `Field channel ${channel} is unavailable.`);
  const t = grid.topology;
  if (!t) return latticeClassSampler(grid, channel);
  const active = grid.active;
  const patches = new Map<number, ReturnType<typeof prepareAdaptivePatches>>();
  const membership = (code: number) => {
    let patch = patches.get(code);
    if (!patch) {
      patch = prepareAdaptivePatches(t, (leaf: number) =>
        active[leaf] && values[leaf] === code ? 1 : 0
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
      if (active[cell]) found.add(values[cell]);
      if (!ring) return;
      for (let at = t.offsets[cell]; at < t.offsets[cell + 1]; at++)
        visit(t.neighbors[at], ring - 1);
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
    if (codes.length <= 1) return codes[0] ?? values[leaf];
    let best = values[leaf],
      bestValue = -Infinity;
    for (const code of codes) {
      const value = evaluatePreparedAdaptiveCell(membership(code)(leaf), u, v);
      if (value > bestValue) {
        best = code;
        bestValue = value;
      }
    }
    return best;
  };
}
