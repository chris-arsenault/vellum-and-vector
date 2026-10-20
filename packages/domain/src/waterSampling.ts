import { fieldInterpolator, type Grid } from "./grids";
import type { Position } from "./model";
import { spatial } from "./spatial";

/** Geometric water identity remains aligned with the composed shoreline at every zoom. */
export function waterIdentity(grid: Grid) {
  const ocean = grid.ocean ? spatial.pointCoverage(grid.ocean) : () => false,
    lakes = (grid.waterBodies ?? []).map((body) => ({
      body,
      covers: spatial.pointCoverage(body.footprint),
    }));
  return (p: Position) => {
    const lake = lakes.find((entry) => entry.covers(p));
    if (lake)
      return { kind: 2, id: Number(lake.body.id), level: lake.body.fixedLevel ?? lake.body.spill };
    const sea = grid.channels.seaLevel?.[0] ?? 0;
    return ocean(p) ? { kind: 1, id: 1, level: sea } : { kind: 0, id: 0, level: sea };
  };
}

/** Water geometry and final sampled depth agree across split layer resources. */
export function waterFieldInterpolator(
  grid: Grid, channel: string, original: (name: string) => (p: Position) => number
) {
  const base = original(channel);
  if (!hasWaterGeometry(grid) || !["water", "waterBody", "waterLevel", "waterDepth"].includes(channel)) return base;
  const identity = waterIdentity(grid),
    elevation = grid.channels.elevation ? fieldInterpolator(grid, "elevation") : null,
    depth = grid.channels.waterDepth ? original("waterDepth") : () => 0;
  return (p: Position) => {
    const body = identity(p),
      amount = elevation ? Math.max(0, body.level - elevation(p)) : depth(p),
      wet = body.kind > 0 && amount > 0;
    if (channel === "water") return wet ? body.kind : 0;
    if (channel === "waterBody") return wet ? body.id : 0;
    return channel === "waterLevel" ? body.level : wet ? amount : 0;
  };
}
function hasWaterGeometry(grid: Grid) {
  return Boolean(grid.ocean || grid.waterBodies?.length);
}
