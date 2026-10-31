import { originParameters, type Band, type MagicOrigin, type MagicSystem } from "@atlas/domain";
import { clamp, distance, neighbors, type RefinementState } from "./state";
import { magicCoverage, materialPattern, presentValue, stockChannel } from "./magicMaterials";

interface SaltReservoirs {
  system: MagicSystem;
  origin: MagicOrigin;
  p: MagicSystem["parameters"];
  brine: Band;
  bed: Band;
  dust: Band;
  moved: Band;
}

/** Brine follows fine drainage; exposed beds dissolve or blow downwind. No new deaths or dead lakes. */
export function developRegionalSalt(state: RefinementState, system: MagicSystem, intensity: Band) {
  const g = state.surface,
    pattern = materialPattern(state, system.id);
  for (const origin of system.origins) {
    const reservoirs: SaltReservoirs = {
      system,
      origin,
      p: originParameters(system, origin),
      brine: stockChannel(state, system.id, `${origin.id}/brine`),
      bed: stockChannel(state, system.id, `${origin.id}/bed`),
      dust: stockChannel(state, system.id, `${origin.id}/dust`),
      moved: g.coverage.scratch("float64", "regional:salt-carriage", intensity.length),
    };
    for (let i = 0; i < intensity.length; i++) weatherSalt(state, reservoirs, pattern.get(i), i);
    for (let i = 0; i < intensity.length; i++) reservoirs.dust.add(i, reservoirs.moved.get(i));
    routeBrine(state, reservoirs);
    g.coverage.release(reservoirs.moved);
  }
  releaseSaltField(state, system, intensity);
  g.coverage.release(pattern);
}

function weatherSalt(state: RefinementState, r: SaltReservoirs, weight: number, i: number) {
  const g = state.surface,
    moisture = g.channels.moisture.get(i),
    exposure = clamp(1 - presentValue(state, "sediment", i) / r.p.buryDepth),
    latent =
      r.origin.id === r.system.origins[0].id
        ? magicCoverage(state, r.system.id, i) * r.p.saltFull * g.measures.get(i)
        : 0,
    deposit = Math.max(r.bed.get(i), latent) * weight,
    dissolved = deposit * exposure * r.p.dissolveShare * moisture,
    bare = 1 - clamp(g.channels.treeCover.get(i) + presentValue(state, "grassCover", i)),
    lifted = (deposit - dissolved) * exposure * r.p.dustShare * bare * (1 - moisture),
    carried = (r.dust.get(i) + lifted) * (1 - r.p.dustSettle),
    target = downwind(state, i);
  r.bed.set(i, deposit - dissolved - lifted + r.dust.get(i) * r.p.dustSettle);
  r.brine.set(i, r.brine.get(i) * weight + dissolved);
  applySaltBed(state, r, dissolved, i);
  r.dust.set(i, target < 0 ? carried : 0);
  if (target >= 0 && g.channels.water.get(target) !== 1) r.moved.add(target, carried);
}

function applySaltBed(state: RefinementState, r: SaltReservoirs, dissolved: number, i: number) {
  const g = state.surface,
    glass = clamp(r.bed.get(i) / g.measures.get(i) / r.p.glassBed - 1),
    collapse = r.p.sinkDepth * clamp(dissolved / g.measures.get(i) / r.p.saltFull);
  g.channels.rock.add(i, (glass * r.p.glassResistance) / 4000);
  g.channels.elevation.add(i, -collapse);
}

function routeBrine(state: RefinementState, r: SaltReservoirs) {
  const drainage = state.drainage;
  if (!drainage) return;
  for (let k = drainage.count - 1; k >= 0; k--) {
    const i = drainage.order.get(k),
      j = drainage.receiver.get(i),
      retained = clamp(
        presentValue(state, "wetlandCover", i) + presentValue(state, "soilCarbon", i) / 20
      ),
      flushed =
        r.brine.get(i) * r.p.brineFlush * state.surface.channels.moisture.get(i) * (1 - retained);
    r.brine.add(i, -flushed);
    if (
      j < 0 ||
      state.surface.channels.water.get(i) === 2 ||
      presentValue(state, "magic:hallowed:intensity", j) >= 500
    ) {
      const crust = r.brine.get(i) * r.p.crustShare;
      r.brine.add(i, -crust);
      r.bed.add(i, crust);
    } else {
      const seep = r.brine.get(i) * r.p.seepShare;
      r.brine.add(i, -seep);
      if (state.surface.channels.water.get(j) !== 1) r.brine.add(j, seep);
    }
  }
}

function releaseSaltField(state: RefinementState, system: MagicSystem, intensity: Band) {
  const g = state.surface,
    stocks = Object.entries(g.channels).filter(([name]) => name.startsWith("magic:salt:stock:"));
  for (let i = 0; i < intensity.length; i++) {
    let density = 0;
    for (const [, stock] of stocks) density += stock.get(i) / g.measures.get(i);
    const burning =
      clamp(presentValue(state, "magic:fire:intensity", i) / 1000) * system.parameters.saltBurn;
    for (const [, stock] of stocks) stock.set(i, stock.get(i) * (1 - burning));
    intensity.set(
      i,
      clamp(
        Math.max(intensity.get(i) * 0.3, (density * 1000) / system.parameters.saltFull) *
          (1 - burning),
        0,
        1000
      )
    );
  }
}

function downwind(state: RefinementState, i: number) {
  const g = state.surface,
    wx = presentValue(state, "windEast", i),
    wy = presentValue(state, "windNorth", i);
  let target = -1,
    best = 0;
  for (const j of neighbors(g, i)) {
    const alignment =
      (((j % g.width) - (i % g.width)) * wx +
        (Math.floor(j / g.width) - Math.floor(i / g.width)) * wy) /
      distance(g, i, j);
    if (alignment > best) {
      best = alignment;
      target = j;
    }
  }
  return target;
}
