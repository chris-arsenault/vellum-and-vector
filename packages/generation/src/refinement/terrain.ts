import { gridPosition } from "@atlas/domain";
import { fractalNoise } from "../canonry/noise";
import { channel, clamp, distance, neighbors, spacing, type RefinementState } from "./state";

/** Minimum rolling relief as a slope over one coarse sample. */
const rollingSlope = 0.008;
/** Coastal displacement extends through this vertical band in metres. */
const coastalBand = 180;
/** Local hillslope redistribution, a fraction of neighboring height differences. */
const relaxationShare = 0.12;

export function refineTerrain(state: RefinementState) {
  const grid = state.surface,
    height = grid.channels.elevation,
    rock = channel(state, "rock", "ratio", 1),
    fracture = channel(state, "fracture", "ratio"),
    [dx, dy] = spacing(grid),
    wavelength = Math.max(state.parentSpan / 2, Math.max(dx, dy) * 4),
    octaves = Math.max(1, 1 + Math.floor(Math.log2(wavelength / (Math.max(dx, dy) * 2)))),
    datum = grid.channels.seaLevel?.get(0) ?? 0;
  if (!state.input.domains.includes("physical")) {
    updateSlopes(state);
    return;
  }
  for (let i = 0; i < height.length; i++) {
    const p = gridPosition(grid, i),
      { gx, gy } = gradient(state, i, true),
      slope = Math.hypot(gx, gy),
      direction = Math.atan2(gy, gx),
      across = p.x * Math.cos(direction) + p.y * Math.sin(direction),
      along = (-p.x * Math.sin(direction) + p.y * Math.cos(direction)) / 3,
      resistance = clamp(rock.get(i), 0.6, 1.4),
      amplitude =
        Math.max(rollingSlope * state.parentSpan, slope * state.parentSpan * 1.2) * resistance,
      warp =
        fractalNoise(p.x, p.y, state.input.seed ^ 0x51a3, wavelength * 2, 2) * wavelength * 0.3,
      relief =
        fractalNoise(across + warp, along, state.input.seed ^ 0x5e1f, wavelength, octaves) *
        amplitude,
      nearShore = Math.max(0, 1 - Math.abs(state.inheritedHeight.get(i) - datum) / coastalBand),
      shore =
        fractalNoise(p.x + warp, p.y - warp, state.input.seed ^ 0x7c4b, wavelength / 2, octaves) *
        coastalBand *
        nearShore ** 2 *
        (0.4 + clamp(fracture.get(i)));
    height.set(i, state.inheritedHeight.get(i) + relief + shore);
  }
  relaxSlopes(state);
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
