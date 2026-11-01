import {
  KeyedHeap,
  originParameters,
  type Band,
  type MagicOrigin,
  type MagicStock,
  type MagicSystem,
} from "@atlas/domain";
import { siteStrength } from "../../canonry/magicStocks";
import { generationFeatures } from "../../generationFeatures";
import {
  channel,
  clamp,
  distance,
  insideFrame,
  neighbors,
  cellAt,
  type RegionalState,
} from "../state";
import {
  capturedSource,
  combineSources,
  intensityChannel,
  magicCoverage,
  materialPattern,
  originSource,
  presentValue,
  stockChannel,
} from "./materials";

/**
 * Fire is stone that holds heat: fallen cores, veins along fractures, forge-cracked stock.
 * Preparation resolves the captured material into deposits once; each response reads the
 * exposed deposits against the present fractures and sediment and carries vein heat along
 * the conduits as they are now.
 */
export function prepareFire(state: RegionalState, system: MagicSystem) {
  const g = state.surface,
    pattern = materialPattern(state, system.id),
    source = channel(state, "magic:fire:source", "relative-intensity"),
    hasContext = Object.keys(g.channels).some(
      (name) => name.startsWith("magic:fire:stock:") || name.startsWith("magic:fire:coverage")
    );
  if (hasContext)
    for (let i = 0; i < source.length; i++)
      source.set(i, siteStrength(source.get(i) * pattern.get(i)));
  for (const origin of system.origins) {
    const stocks = origin.stocks.map((stock) => ({
      stock,
      values: stockChannel(state, system.id, `${origin.id}/${stock.id}`),
    }));
    for (let i = 0; i < g.active.length; i++)
      for (const { stock, values } of stocks)
        values.set(
          i,
          depositDensity(state, origin, stock, values, pattern.get(i), i) * g.measures.get(i)
        );
  }
  seedCapturedCores(state, source);
  capturedSource(state, system.id).copyFrom(source);
  g.coverage.release(pattern);
}

/** A captured core place is a located source whether or not its stock was resolved here. */
function seedCapturedCores(state: RegionalState, source: Band) {
  for (const f of generationFeatures(state, { areaId: state.input.areaId })) {
    if (f.kind !== "fire:core" || f.geometry.type !== "Point") continue;
    const [x, y] = f.geometry.coordinates;
    if (!insideFrame(state, x, y)) continue;
    const i = cellAt(state, x, y);
    source.set(i, Math.max(source.get(i), Number(f.attributes.intensity ?? 500)));
  }
}

export function respondFire(state: RegionalState, system: MagicSystem, intensity: Band) {
  const g = state.surface;
  for (const origin of system.origins) {
    const p = originParameters(system, origin),
      own = originSource(state, system.id, origin.id),
      stocks = origin.stocks.map((stock) => ({
        stock,
        values: stockChannel(state, system.id, `${origin.id}/${stock.id}`),
      }));
    for (let i = 0; i < own.length; i++) {
      let release = 0;
      for (const { stock, values } of stocks)
        release = Math.max(
          release,
          materialRelease(state, origin, stock, values.get(i) / g.measures.get(i), p, i)
        );
      const active = g.channels.water.get(i) === 1 ? 0 : release;
      own.set(i, siteStrength(active));
    }
  }
  const source = combineSources(state, system);
  for (let i = 0; i < source.length; i++) {
    intensity.set(i, Math.max(intensity.get(i), source.get(i)));
    if (source.get(i) > 0 && g.channels["magic:hallowed:intensity"])
      g.channels["magic:hallowed:intensity"].set(i, 0);
  }
  spreadFire(state, system, source, intensity);
}

function depositDensity(
  state: RegionalState,
  origin: MagicOrigin,
  stock: MagicStock,
  values: Band,
  weight: number,
  i: number
) {
  const captured = values.get(i) / state.surface.measures.get(i),
    latent =
      origin.source === "geothermal" && stock.reservoir === "held"
        ? fireDepositCoverage(state, i) * 1000 * (0.2 + presentValue(state, "geothermal", i) * 0.8)
        : 0;
  return Math.max(captured, latent) * weight;
}

function fireDepositCoverage(state: RegionalState, i: number) {
  const c = state.surface.channels,
    deposits = ["core", "vein", "placer", "fan"].map((rule) => c[`magic:fire:coverage:${rule}`]);
  if (!deposits.some(Boolean)) return magicCoverage(state, "fire", i);
  return deposits.reduce((share, values) => Math.max(share, values?.get(i) ?? 0), 0);
}

function materialRelease(
  state: RegionalState,
  origin: MagicOrigin,
  stock: MagicStock,
  density: number,
  p: MagicSystem["parameters"],
  i: number
) {
  const fracture = state.surface.channels.fracture.get(i),
    exposure = clamp(1 - presentValue(state, "sediment", i) / p.buryDepth);
  if (stock.reservoir === "spent") return density * exposure * p.exhumedRelease;
  switch (origin.source) {
    case "forge":
      return (density * 1000) / p.forgeStrength;
    case "impact":
      return (
        density *
        exposure *
        clamp(
          p.fallenRelease +
            fracture * p.strainCracking +
            presentValue(state, "ice", i) * p.iceCracking
        )
      );
    case "geothermal":
      return presentValue(state, "magic:fire:sealed", i)
        ? 0
        : density *
            exposure *
            (0.15 + fracture * 0.35 + presentValue(state, "geothermal", i) * 0.5);
    default:
      return 0;
  }
}

/** Vein releases travel along fractures; fallen and forge stocks release where they lie. */
function spreadFire(state: RegionalState, system: MagicSystem, source: Band, intensity: Band) {
  const g = state.surface,
    front = new KeyedHeap("max"),
    carried = g.coverage.scratch("float64", "regional:fire-conduit", intensity.length),
    p = system.parameters,
    sealed = (j: number) =>
      g.channels.water.get(j) === 1 || presentValue(state, "magic:hallowed:intensity", j) >= 500;
  for (let i = 0; i < source.length; i++) {
    const conduit = conduitRelease(state, system, source, i);
    if (conduit <= 0) continue;
    carried.set(i, conduit);
    front.push(i, conduit);
  }
  while (front.size) {
    const i = front.pop();
    if (front.poppedKey() !== carried.get(i)) continue;
    for (const j of neighbors(g, i)) {
      if (sealed(j)) continue;
      const fracture = (g.channels.fracture.get(i) + g.channels.fracture.get(j)) / 2,
        cost =
          ((p.baseCost + ((1 - clamp(fracture)) * 1000) / p.conductanceDivisor) *
            distance(g, i, j)) /
          1000,
        next = carried.get(i) - cost;
      if (next <= carried.get(j)) continue;
      carried.set(j, next);
      front.push(j, next);
    }
  }
  for (let i = 0; i < intensity.length; i++)
    intensity.set(i, Math.max(intensity.get(i), carried.get(i)));
  g.coverage.release(carried);
}

/** The release at a cell that travels along fractures: vein origins, or an unattributed source. */
function conduitRelease(state: RegionalState, system: MagicSystem, source: Band, i: number) {
  const g = state.surface;
  let attributed = 0,
    release = 0;
  for (const origin of system.origins) {
    const own = g.channels[`magic:fire:origin:${origin.id}:source`]?.get(i) ?? 0;
    attributed = Math.max(attributed, own);
    if (origin.propagation === "fracture") release = Math.max(release, own);
  }
  return attributed === 0 ? Math.max(release, source.get(i)) : release;
}

export { intensityChannel };
