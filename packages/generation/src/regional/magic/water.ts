import { gridPosition, type Band, type MagicSystem } from "@atlas/domain";
import { channel, clamp, neighbors, type RegionalState } from "../state";
import { materialPattern, magicCoverage, originSource, stockChannel } from "./materials";

/**
 * Aurora is charge held in ice and, weaker, in thawed ground. Preparation concentrates the
 * captured stocks into deposits and drains the mobile charge toward the cold traps once;
 * each response reads the reservoirs against the present cold and ice.
 */
export function prepareAurora(state: RegionalState, system: MagicSystem) {
  const g = state.surface,
    pattern = materialPattern(state, system.id),
    accumulation = g.coverage.scratch("float64", "regional:aurora-drainage", g.active.length),
    origin = system.origins[0].id,
    source = originSource(state, system.id, origin),
    ground = stockChannel(state, system.id, `${origin}/ground`),
    iceStock = stockChannel(state, system.id, `${origin}/ice`),
    stocks = Object.entries(g.channels).filter(([name]) => name.startsWith("magic:aurora:stock:"));
  for (let i = 0; i < g.active.length; i++) {
    const cold = clamp((15 - g.channels.temperature.get(i)) / 30);
    let mobile = 0;
    for (const [name, values] of stocks) {
      values.set(i, values.get(i) * pattern.get(i));
      if (name.endsWith("/ice") || name.endsWith("/ground"))
        mobile += values.get(i) / g.measures.get(i);
    }
    // Reservoirs hold what was captured as stock, coverage or source; the field is derived
    // from them, never turned back into stock.
    const latent = magicCoverage(state, system.id, i) * 1000 * pattern.get(i),
      present = Math.max(mobile, latent, source.get(i));
    source.set(i, clamp(present * (0.2 + cold * 0.8), 0, 1000));
    accumulation.set(i, present * g.measures.get(i));
  }
  iceStock.fill(0);
  ground.fill(0);
  // Charge drains toward the coldest neighbour and is caught by ice on the way.
  for (const i of g.coverage.order(g.channels.temperature, true)) {
    let target = i;
    for (const j of neighbors(g, i))
      if (g.channels.temperature.get(j) < g.channels.temperature.get(target)) target = j;
    const ice = clamp(g.channels.ice?.get(i) ?? 0),
      capture = target === i ? 1 : 0.15 + ice * 0.8,
      retained = accumulation.get(i) * capture;
    if (ice > 0) iceStock.set(i, retained);
    else ground.set(i, retained);
    if (target !== i) accumulation.add(target, accumulation.get(i) * (1 - capture));
  }
  g.coverage.release(pattern);
  g.coverage.release(accumulation);
}

export function respondAurora(state: RegionalState, system: MagicSystem, intensity: Band) {
  const g = state.surface,
    p = system.parameters,
    stocks = Object.entries(g.channels).filter(([name]) => name.startsWith("magic:aurora:stock:"));
  for (let i = 0; i < intensity.length; i++) {
    const cold = clamp((15 - g.channels.temperature.get(i)) / 30),
      ice = clamp(g.channels.ice?.get(i) ?? 0);
    let mobile = 0,
      fixed = 0;
    for (const [name, values] of stocks) {
      const density = values.get(i) / g.measures.get(i);
      if (name.endsWith("/ice") || name.endsWith("/ground")) mobile += density;
      else fixed += density;
    }
    const held = Math.log2(1 + mobile) * p.logScale * (ice > 0 ? 1 : p.relictStrength),
      relict = Math.log2(1 + fixed) * p.logScale * p.relictStrength;
    intensity.set(i, clamp(Math.max(intensity.get(i) * (0.4 + cold * 0.6), held, relict), 0, 1000));
  }
}

/**
 * Pressure travels through connected deep water. Preparation keeps the captured front energy
 * as the system's source once; each response redirects it through the present bathymetry
 * and reflects it from the present coast.
 */
export function preparePressure(state: RegionalState, system: MagicSystem) {
  const g = state.surface,
    pattern = materialPattern(state, system.id),
    source = channel(state, "magic:pressure:source", "relative-intensity"),
    inherited = channel(state, "magic:pressure:intensity", "relative-intensity");
  for (let i = 0; i < source.length; i++) {
    const ocean = g.channels.water.get(i) === 1,
      input = Math.max(source.get(i), inherited.get(i) * pattern.get(i));
    source.set(i, ocean ? clamp(input, 0, 1000) : 0);
  }
  g.coverage.release(pattern);
}

export function respondPressure(state: RegionalState, system: MagicSystem, intensity: Band) {
  const g = state.surface,
    source = channel(state, "magic:pressure:source", "relative-intensity");
  for (let i = 0; i < intensity.length; i++)
    intensity.set(i, g.channels.water.get(i) === 1 ? intensity.get(i) * 0.3 : 0);
  if (system.parameters.rayCount <= 0) return;
  // Rays depend on the connected water and its depth. The traced field is kept while the
  // ocean's extent is unchanged, so a round that moved no coast does not retrace it.
  let ocean = 0;
  for (let i = 0; i < g.active.length; i++) if (g.channels.water.get(i) === 1) ocean++;
  const kept = state.natural["pressure:rays"],
    unchanged = kept && state.magic?.pressureOcean === ocean;
  if (unchanged) {
    for (let i = 0; i < intensity.length; i++)
      if (g.channels.water.get(i) === 1)
        intensity.set(i, clamp(intensity.get(i) + kept.get(i), 0, 1000));
    return;
  }
  const before = g.coverage.copyBand(intensity);
  for (let i = 0; i < source.length; i++) {
    if (source.get(i) <= 0 || g.channels.water.get(i) !== 1) continue;
    if (
      [...neighbors(g, i)].some(
        (j) => source.get(j) > source.get(i) || (source.get(j) === source.get(i) && j < i)
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
        source.get(i)
      );
  }
  const rays = (state.natural["pressure:rays"] ??= g.coverage.copyBand(intensity));
  for (let i = 0; i < intensity.length; i++) rays.set(i, intensity.get(i) - before.get(i));
  g.coverage.release(before);
  if (state.magic) state.magic.pressureOcean = ocean;
}

function tracePressure(
  state: RegionalState,
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
