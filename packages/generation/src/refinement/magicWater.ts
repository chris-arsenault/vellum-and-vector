import { gridPosition, type Band, type MagicSystem } from "@atlas/domain";
import { channel, clamp, neighbors, type RefinementState } from "./state";
import { materialPattern, magicCoverage, originSource, stockChannel } from "./magicMaterials";

/** Resolve captured charge into cold traps and the ice/ground that already carries it. */
export function developRegionalAurora(
  state: RefinementState,
  system: MagicSystem,
  intensity: Band
) {
  const g = state.surface,
    p = system.parameters,
    pattern = materialPattern(state, system.id),
    accumulation = g.coverage.scratch("float64", "regional:aurora-drainage", g.active.length),
    source = originSource(state, system.id, system.origins[0].id),
    ground = stockChannel(state, system.id, `${system.origins[0].id}/ground`),
    iceStock = stockChannel(state, system.id, `${system.origins[0].id}/ice`),
    stocks = Object.entries(g.channels).filter(([name]) => name.startsWith("magic:aurora:stock:"));
  for (let i = 0; i < intensity.length; i++) {
    const cold = clamp((15 - g.channels.temperature.get(i)) / 30),
      density = concentrateCharge(state, stocks, pattern, i),
      latent = magicCoverage(state, system.id, i) * 1000 * pattern.get(i),
      present = Math.max(density.mobile, latent, source.get(i));
    source.set(i, clamp(present * (0.2 + cold * 0.8), 0, 1000));
    accumulation.set(i, present * g.measures.get(i));
    const relict =
      Math.log2(1 + density.fixed) * system.parameters.logScale * system.parameters.relictStrength;
    intensity.set(i, Math.max(intensity.get(i) * (0.4 + cold * 0.6), relict));
  }
  iceStock.fill(0);
  ground.fill(0);
  for (const i of g.coverage.order(g.channels.temperature, true))
    drainCharge(state, p, intensity, accumulation, { ice: iceStock, ground }, i);
  g.coverage.release(pattern);
  g.coverage.release(accumulation);
}
function concentrateCharge(
  state: RefinementState,
  stocks: [string, Band][],
  pattern: Band,
  i: number
) {
  const g = state.surface;
  let mobile = 0,
    fixed = 0;
  for (const [name, values] of stocks) {
    values.set(i, values.get(i) * pattern.get(i));
    const density = values.get(i) / g.measures.get(i);
    if (name.endsWith("/ice") || name.endsWith("/ground")) mobile += density;
    else fixed += density;
  }
  return { mobile, fixed };
}
function drainCharge(
  state: RefinementState,
  p: MagicSystem["parameters"],
  intensity: Band,
  accumulation: Band,
  reservoirs: { ice: Band; ground: Band },
  i: number
) {
  const g = state.surface;
  let target = i;
  for (const j of neighbors(g, i))
    if (g.channels.temperature.get(j) < g.channels.temperature.get(target)) target = j;
  const ice = clamp(g.channels.ice?.get(i) ?? 0),
    capture = target === i ? 1 : 0.15 + ice * 0.8,
    local = (accumulation.get(i) * capture) / g.measures.get(i),
    strength = Math.log2(1 + local) * p.logScale * (ice > 0 ? 1 : p.relictStrength);
  intensity.set(i, clamp(Math.max(intensity.get(i), strength), 0, 1000));
  const retained = accumulation.get(i) * capture;
  if (ice > 0) reservoirs.ice.set(i, retained);
  else reservoirs.ground.set(i, retained);
  if (target !== i) accumulation.add(target, accumulation.get(i) * (1 - capture));
}

/** Fine bathymetry redirects and reflects captured ocean forcing; no ancient event is added. */
export function developRegionalPressure(
  state: RefinementState,
  system: MagicSystem,
  intensity: Band
) {
  const g = state.surface,
    pattern = materialPattern(state, system.id),
    fronts = g.coverage.scratch("float64", "regional:pressure-fronts", intensity.length),
    source = channel(state, "magic:pressure:source", "relative-intensity");
  for (let i = 0; i < intensity.length; i++) {
    const ocean = g.channels.water.get(i) === 1,
      input = Math.max(source.get(i), intensity.get(i) * pattern.get(i));
    fronts.set(i, ocean ? clamp(input, 0, 1000) : 0);
    intensity.set(i, ocean ? intensity.get(i) * 0.3 : 0);
    if (!ocean) source.set(i, 0);
  }
  if (system.parameters.rayCount > 0)
    for (let i = 0; i < fronts.length; i++) {
      if (fronts.get(i) <= 0) continue;
      if (
        [...neighbors(g, i)].some(
          (j) => fronts.get(j) > fronts.get(i) || (fronts.get(j) === fronts.get(i) && j < i)
        )
      )
        continue;
      for (let ray = 0; ray < system.parameters.rayCount; ray++)
        tracePressure(
          state,
          system,
          intensity,
          i,
          (ray * Math.PI * 2) / system.parameters.rayCount,
          fronts.get(i)
        );
    }
  g.coverage.release(fronts);
  g.coverage.release(pattern);
}

function tracePressure(
  state: RefinementState,
  system: MagicSystem,
  intensity: Band,
  start: number,
  angle: number,
  energy: number
) {
  const g = state.surface,
    p = system.parameters,
    step = g.scope.resolution ?? 1000,
    origin = gridPosition(g, start),
    depth = g.channels.waterDepth,
    startDepth = Math.max(1, depth.get(start));
  let x = origin.x,
    y = origin.y,
    vx = Math.cos(angle),
    vy = Math.sin(angle),
    reflected = false,
    last = start;
  for (let travel = 0; energy > 0 && travel <= p.rayDistance; travel += step) {
    const col = Math.round(((x - g.bounds[0]) / (g.bounds[2] - g.bounds[0])) * (g.width - 1)),
      row = Math.round(((y - g.bounds[1]) / (g.bounds[3] - g.bounds[1])) * (g.height - 1));
    if (col < 0 || row < 0 || col >= g.width || row >= g.height) break;
    const i = row * g.width + col;
    if (g.channels.water.get(i) !== 1) {
      if (reflected) break;
      // The coast reflects the arriving front back into its own connected basin.
      const at = gridPosition(g, last);
      x = at.x;
      y = at.y;
      vx = -vx;
      vy = -vy;
      energy *= 0.5;
      reflected = true;
    } else {
      const focusing = clamp(Math.sqrt(startDepth / Math.max(1, depth.get(i))), 0.5, 2);
      intensity.set(
        i,
        clamp(intensity.get(i) + ((energy * p.rayIntensity) / 1000) * focusing, 0, 1000)
      );
      last = i;
    }
    x += vx * step;
    y += vy * step;
    energy -= (p.rayDecay * step) / 10000;
  }
}
