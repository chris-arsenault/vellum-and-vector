import { gridPosition } from "@atlas/domain";
import { fractalNoise } from "../canonry/noise";
import { channel, clamp, distance, neighbors, spacing, type RefinementState } from "./state";
import { inheritedSampler, regionalTerrainContext, settleRegionalPits } from "./terrainStructure";

/** Minimum rolling relief as a slope over one coarse sample. */
const rollingSlope = 0.002;
/** Horizontal displacement varies coastlines and divides without serrating every height. */
const displacementShare = 0.18;
/** Local hillslope redistribution, a fraction of neighboring height differences. */
const relaxationShare = 0.12;

export function refineTerrain(state: RefinementState) {
  channel(state, "fracture", "ratio");
  const grid = state.surface,
    height = grid.channels.elevation,
    rock = channel(state, "rock", "ratio", 1),
    [dx, dy] = spacing(grid),
    wavelength = Math.max(state.parentSpan, Math.max(dx, dy) * 4),
    at = inheritedSampler(state);
  if (!state.input.domains.includes("physical")) {
    updateSlopes(state);
    return;
  }
  regionalTerrainContext(state);
  channel(state, "sediment", "metre");
  for (let i = 0; i < height.length; i++) {
    const p = gridPosition(grid, i),
      resistance = clamp(rock.get(i), 0.6, 1.4),
      warpX = fractalNoise(p.x, p.y, state.input.seed ^ 0x51a3, wavelength * 2, 2),
      warpY = fractalNoise(p.x, p.y, state.input.seed ^ 0x7c4b, wavelength * 2, 2),
      amplitude =
        (rollingSlope * state.parentSpan + state.terrain!.relief.get(i) * 0.06) * resistance,
      variation = fractalNoise(p.x, p.y, state.input.seed ^ 0x5e1f, wavelength / 2, 2);
    height.set(
      i,
      at(
        p.x + warpX * wavelength * displacementShare,
        p.y + warpY * wavelength * displacementShare
      ) +
        variation * amplitude
    );
  }
  relaxSlopes(state);
  settleRegionalPits(state);
  updateSlopes(state);
}
export function gradient(state: RefinementState, i: number, inherited = false) {
  const g = state.surface,
    h = inherited ? state.inheritedHeight : g.channels.elevation,
    [dx, dy] = spacing(g),
    x = i % g.width,
    y = Math.floor(i / g.width),
    left = x > 0 ? i - 1 : i,
    right = x + 1 < g.width ? i + 1 : i,
    below = y > 0 ? i - g.width : i,
    above = y + 1 < g.height ? i + g.width : i;
  return {
    gx: (h.get(right) - h.get(left)) / ((right - left) * dx || dx),
    gy: (h.get(above) - h.get(below)) / (((above - below) / g.width) * dy || dy),
  };
}
/** A local relaxation redistributes loose material without imposing a parent's elevation. */
export function relaxSlopes(state: RefinementState) {
  const grid = state.surface,
    height = grid.channels.elevation,
    delta = grid.coverage.scratch("float64", "regional:hillslope", height.length),
    sediment = channel(state, "sediment", "metre");
  for (let i = 0; i < height.length; i++)
    for (const j of neighbors(grid, i)) {
      if (j <= i) continue;
      const difference = height.get(i) - height.get(j),
        talus = distance(grid, i, j) * 0.35;
      const moved =
        (Math.sign(difference) * Math.max(0, Math.abs(difference) - talus) * relaxationShare) / 8;
      delta.add(i, -moved);
      delta.add(j, moved);
      if (moved > 0) sediment.add(j, moved);
      else sediment.add(i, -moved);
    }
  for (let i = 0; i < height.length; i++) height.add(i, delta.get(i));
  grid.coverage.release(delta);
}
export function updateSlopes(state: RefinementState) {
  const slope = channel(state, "slope", "ratio");
  for (let i = 0; i < slope.length; i++) {
    const { gx, gy } = gradient(state, i);
    slope.set(i, Math.hypot(gx, gy));
  }
}
