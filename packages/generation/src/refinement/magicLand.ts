import { KeyedHeap, type Band, type MagicOrigin, type MagicSystem } from "@atlas/domain";
import { channel, clamp, distance, neighbors, type RefinementState } from "./state";
import { siteStrength } from "../canonry/magicStocks";
import {
  combineSources,
  magicCoverage,
  materialPattern,
  originSource,
  presentValue,
  stockChannel,
} from "./magicMaterials";

/** Present groundwater leaches this share of exposed buried charge over the resolved flow path. */
const groundwaterLeachShare = 0.2;
/** Buried charge per square metre that supports a fully charged spring. */
const springChargeDensity = 300;

/** Root-carried sap and buried strata develop groves and water-fed spring lines. */
export function developRegionalGreenwood(
  state: RefinementState,
  system: MagicSystem,
  intensity: Band
) {
  const g = state.surface,
    pattern = materialPattern(state, system.id);
  for (const [name, stock] of Object.entries(g.channels))
    if (name.startsWith("magic:greenwood:stock:"))
      for (let i = 0; i < stock.length; i++) stock.set(i, stock.get(i) * pattern.get(i));
  routeAquifer(state, system);
  for (const origin of system.origins) developGreenwoodOrigin(state, system, origin, pattern);
  spreadRoots(state, system, combineSources(state, system), intensity);
  g.coverage.release(pattern);
}
function developGreenwoodOrigin(
  state: RefinementState,
  system: MagicSystem,
  origin: MagicOrigin,
  pattern: Band
) {
  const g = state.surface,
    own = originSource(state, system.id, origin.id),
    stocks = origin.stocks.map((stock) => ({
      stock,
      values: stockChannel(state, system.id, `${origin.id}/${stock.id}`),
    }));
  for (let i = 0; i < own.length; i++) {
    let sap = 0,
      buried = 0;
    for (const { stock, values } of stocks) {
      if (stock.reservoir === "sap") sap += values.get(i) / g.measures.get(i);
      else buried += values.get(i) / g.measures.get(i);
    }
    let release = own.get(i) * pattern.get(i);
    if (origin.source === "verdant")
      release = Math.max(release, groveStrength(state, system, sap, pattern.get(i), i));
    if (origin.source === "aquifer")
      release = Math.max(release, springStrength(state, system, buried, i));
    const open = g.channels.water.get(i) === 0 && presentValue(state, "ice", i) < 0.1;
    own.set(i, open ? siteStrength(release) : 0);
  }
}
function groveStrength(
  state: RefinementState,
  system: MagicSystem,
  sap: number,
  weight: number,
  i: number
) {
  const vegetation = clamp(
      presentValue(state, "treeCover", i) + presentValue(state, "wetlandCover", i)
    ),
    latent = magicCoverage(state, system.id, i) * weight * 1000;
  return Math.max((sap * 500) / system.parameters.groveSap, latent * vegetation);
}
function springStrength(state: RefinementState, system: MagicSystem, buried: number, i: number) {
  const g = state.surface,
    p = system.parameters,
    recharge =
      g.channels.flow?.get(i) ??
      (presentValue(state, "runoff", i) * presentValue(state, "catchmentArea", i)) / 31557600,
    available =
      buried + presentValue(state, "magic:greenwood:stock:stand/stratum", i) / g.measures.get(i);
  if (
    g.channels.rock.get(i) > p.springRock / 4000 ||
    g.channels.slope.get(i) > 0.01 ||
    recharge <= 0 ||
    available <= 0 ||
    presentValue(state, "magic:greenwood:sealed", i)
  )
    return 0;
  const support = Math.max(0.01, (p.springFlow * (g.scope.resolution ?? 1000) ** 2) / 200_000_000);
  return 600 * clamp(recharge / support) * clamp(available / springChargeDensity);
}

function springGround(state: RefinementState, system: MagicSystem, i: number) {
  const c = state.surface.channels;
  return c.rock.get(i) <= system.parameters.springRock / 4000 && c.slope.get(i) <= 0.01;
}

function routeAquifer(state: RefinementState, system: MagicSystem) {
  const g = state.surface,
    stratum = g.channels["magic:greenwood:stock:stand/stratum"],
    drainage = state.drainage,
    origin = system.origins.find((o) => o.source === "aquifer");
  if (!stratum || !drainage || !origin) return;
  const water = stockChannel(state, system.id, `${origin.id}/aquifer`);
  for (let k = drainage.count - 1; k >= 0; k--) {
    const i = drainage.order.get(k),
      j = drainage.receiver.get(i),
      leached = stratum.get(i) * groundwaterLeachShare * clamp(presentValue(state, "runoff", i));
    stratum.add(i, -leached);
    water.add(i, leached);
    if (
      j < 0 ||
      springGround(state, system, i) ||
      presentValue(state, "magic:hallowed:intensity", j) >= 500
    )
      continue;
    const carried = water.get(i);
    water.set(i, 0);
    if (g.channels.water.get(j) !== 1) water.add(j, carried);
  }
}
function rootCover(state: RefinementState, i: number) {
  return clamp(
    presentValue(state, "treeCover", i) +
      presentValue(state, "grassCover", i) +
      presentValue(state, "wetlandCover", i)
  );
}
function rootBarrier(state: RefinementState, system: MagicSystem, i: number) {
  return (
    state.surface.channels.water.get(i) !== 0 ||
    presentValue(state, "ice", i) > 0.1 ||
    rootCover(state, i) < system.parameters.rootFloor
  );
}
function spreadRoots(state: RefinementState, system: MagicSystem, source: Band, intensity: Band) {
  const g = state.surface,
    queue = new KeyedHeap("max");
  for (let i = 0; i < intensity.length; i++)
    if (source.get(i) > intensity.get(i)) {
      intensity.set(i, source.get(i));
      queue.push(i, source.get(i));
    }
  while (queue.size) {
    const i = queue.pop();
    if (queue.poppedKey() !== intensity.get(i)) continue;
    for (const j of neighbors(g, i)) {
      if (rootBarrier(state, system, j)) continue;
      const next =
        intensity.get(i) -
        (system.parameters.rootCost * distance(g, i, j)) / 1000 / (0.1 + rootCover(state, j));
      if (next <= intensity.get(j)) continue;
      intensity.set(j, next);
      queue.push(j, next);
    }
  }
}

/** Kept context locates wards; fine relief shapes their reach without inventing another human era. */
export function developRegionalHallowed(
  state: RefinementState,
  system: MagicSystem,
  intensity: Band
) {
  const g = state.surface,
    pattern = materialPattern(state, system.id),
    source = channel(state, "magic:hallowed:source", "relative-intensity"),
    seat = originSource(state, system.id, "seat"),
    line = originSource(state, system.id, "line"),
    queue = new KeyedHeap("max");
  for (let i = 0; i < intensity.length; i++) {
    const latent = magicCoverage(state, system.id, i) * pattern.get(i) * 1000,
      strength =
        g.channels.water.get(i) === 0
          ? clamp(
              Math.max(
                source.get(i) * pattern.get(i),
                seat.get(i) * pattern.get(i),
                line.get(i),
                latent
              ),
              0,
              1000
            )
          : 0;
    source.set(i, siteStrength(strength));
    if (strength > intensity.get(i)) {
      intensity.set(i, strength);
      queue.push(i, strength);
    }
  }
  while (queue.size) {
    const i = queue.pop();
    if (queue.poppedKey() !== intensity.get(i)) continue;
    for (const j of neighbors(g, i)) {
      if (g.channels.water.get(j) !== 0) continue;
      const cost =
          ((1000 * distance(g, i, j)) / system.parameters.wardReach) *
          (1 + g.channels.slope.get(j)),
        next = intensity.get(i) - cost;
      if (next <= intensity.get(j)) continue;
      intensity.set(j, next);
      queue.push(j, next);
    }
  }
  g.coverage.release(pattern);
}
