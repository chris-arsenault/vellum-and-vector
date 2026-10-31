import {
  originParameters,
  type Band,
  type MagicOrigin,
  type MagicStock,
  type MagicSystem,
} from "@atlas/domain";
import { channel, clamp, type RefinementState } from "./state";
import { siteStrength } from "../canonry/magicStocks";
import {
  combineSources,
  magicCoverage,
  materialPattern,
  originSource,
  presentValue,
  stockChannel,
} from "./magicMaterials";

/** Develop present ore and releases. No impact, forge era or conduit lifetime is replayed. */
export function developRegionalFire(state: RefinementState, system: MagicSystem) {
  const g = state.surface,
    pattern = materialPattern(state, system.id),
    source = channel(state, "magic:fire:source", "relative-intensity"),
    hasContext = Object.keys(g.channels).some(
      (name) => name.startsWith("magic:fire:stock:") || name.startsWith("magic:fire:coverage")
    );
  if (hasContext)
    for (let i = 0; i < source.length; i++)
      source.set(i, siteStrength(source.get(i) * pattern.get(i)));
  for (const origin of system.origins) developFireOrigin(state, system, origin, pattern);
  combineSources(state, system);
  g.coverage.release(pattern);
}

function developFireOrigin(
  state: RefinementState,
  system: MagicSystem,
  origin: MagicOrigin,
  pattern: Band
) {
  const g = state.surface,
    p = originParameters(system, origin),
    own = originSource(state, system.id, origin.id),
    stocks = origin.stocks.map((stock) => ({
      stock,
      values: stockChannel(state, system.id, `${origin.id}/${stock.id}`),
    }));
  for (let i = 0; i < own.length; i++) {
    let release = own.get(i) * pattern.get(i);
    for (const { stock, values } of stocks) {
      const density = depositDensity(state, origin, stock, values, pattern.get(i), i);
      values.set(i, density * g.measures.get(i));
      release = Math.max(release, materialRelease(state, origin, stock, density, p, i));
    }
    const active = g.channels.water.get(i) === 1 ? 0 : release;
    channel(state, "magic:fire:intensity", "relative-intensity").set(
      i,
      Math.max(presentValue(state, "magic:fire:intensity", i), clamp(active, 0, 1000))
    );
    own.set(i, siteStrength(active));
  }
}

function depositDensity(
  state: RefinementState,
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

function fireDepositCoverage(state: RefinementState, i: number) {
  const c = state.surface.channels,
    deposits = ["core", "vein", "placer", "fan"].map((rule) => c[`magic:fire:coverage:${rule}`]);
  if (!deposits.some(Boolean)) return magicCoverage(state, "fire", i);
  return deposits.reduce((share, values) => Math.max(share, values?.get(i) ?? 0), 0);
}

function materialRelease(
  state: RefinementState,
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
