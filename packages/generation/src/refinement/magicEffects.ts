import { gridPosition, type Band, type MagicSystem } from "@atlas/domain";
import { fractalNoise } from "../canonry/noise";
import { channel, clamp, neighbors, type RefinementState } from "./state";
import { presentValue } from "./magicMaterials";
import { routeRegionalWater } from "./water";
import { updateSlopes } from "./terrain";
import { settleRegionalPits } from "./terrainStructure";

/** Local changes to a captured present, rather than another epoch of cumulative work. */
export function developMagicGeography(
  state: RefinementState,
  systems: MagicSystem[],
  previous: Map<string, Band>
) {
  for (const [name, unit] of [
    ["ice", "ratio"],
    ["runoff", "metre/year"],
    ["soilDepth", "metre"],
    ["wetlandCover", "ratio"],
  ])
    channel(state, name, unit);
  let changed = false;
  for (const system of systems) {
    const intensity = state.surface.channels[`magic:${system.id}:intensity`],
      before = previous.get(system.id)!;
    for (let i = 0; i < intensity.length; i++) {
      const delta = (intensity.get(i) - before.get(i)) / 1000;
      changed = applyMaterialChange(state, system, delta, i) || changed;
      if (system.id === "pressure") {
        pressureCoast(state, system, intensity, before, i);
        changed ||= intensity.get(i) > 0;
      }
      if (system.id === "veil") changed = veilRelief(state, system, i) || changed;
    }
  }
  if (changed) {
    settleRegionalPits(state);
    updateSlopes(state);
    routeRegionalWater(state);
  }
}
function applyMaterialChange(
  state: RefinementState,
  system: MagicSystem,
  delta: number,
  i: number
) {
  if (!delta) return false;
  const c = state.surface.channels,
    e = system.effects;
  c.rock.set(i, Math.max(0.01, c.rock.get(i) + (delta * e.rockResistance) / 4000));
  c.fracture.set(i, clamp(c.fracture.get(i) + (delta * e.conduitOpening) / 1000));
  const heldIce = delta * e.icePersistence * clamp(1 - Math.max(0, c.temperature.get(i)) / 15),
    melted = delta * e.iceMelt * Math.min(1, c.ice.get(i));
  c.ice.set(i, Math.max(0, c.ice.get(i) + heldIce - melted));
  if (c.iceThickness) c.iceThickness.set(i, c.ice.get(i) * 1000);
  if (c.water.get(i) === 0) changeLivingMedium(state, system, delta, i);
  return true;
}
function changeLivingMedium(state: RefinementState, system: MagicSystem, delta: number, i: number) {
  const c = state.surface.channels,
    e = system.effects;
  if (e.verdure) {
    c.soilDepth.set(i, Math.max(0.02, c.soilDepth.get(i) + delta * e.verdure * 0.3));
    c.runoff.set(i, Math.max(0, c.runoff.get(i) * (1 - delta * e.verdure * 0.25)));
    c.wetlandCover.set(
      i,
      clamp(
        c.wetlandCover.get(i) + Math.max(0, delta) * e.verdure * clamp(1 - c.slope.get(i) / 0.01)
      )
    );
  }
  if (e.salting) {
    const drying = clamp(1 - delta * e.salting * system.parameters.desiccation, 0.1, 2);
    c.moisture.set(i, clamp(c.moisture.get(i) * drying));
    if (c.rainfall) c.rainfall.set(i, Math.max(0, c.rainfall.get(i) * drying));
    c.runoff.set(i, Math.max(0, c.runoff.get(i) * drying));
  }
}
function veilRelief(state: RefinementState, system: MagicSystem, i: number) {
  const g = state.surface;
  if (g.channels.water.get(i) !== 0) return false;
  const p = gridPosition(g, i),
    wild = presentValue(state, "magic:veil:wild", i),
    relief =
      fractalNoise(p.x, p.y, state.input.seed ^ 0x7e11, (g.scope.resolution ?? 1000) * 4, 2) *
      wild *
      system.parameters.wildRelief,
    door = presentValue(state, "magic:veil:origin:door:source", i) > 0;
  g.channels.elevation.add(i, relief);
  if (door) g.channels.elevation.add(i, -system.parameters.doorPool);
  return relief !== 0 || door;
}

function pressureCoast(
  state: RefinementState,
  system: MagicSystem,
  intensity: Band,
  previous: Band,
  i: number
) {
  const g = state.surface;
  if (g.channels.water.get(i) !== 1) return;
  const shoaling = clamp(1 - g.channels.waterDepth.get(i) / 1000),
    forcing = (intensity.get(i) / 1000) * shoaling,
    upwelling = channel(state, "upwelling", "ratio"),
    fog = channel(state, "fog", "ratio");
  upwelling.set(i, clamp(forcing * system.effects.upwelling));
  g.channels.temperature.add(
    i,
    (((intensity.get(i) - previous.get(i)) * system.effects.seaSurface) / 10) * shoaling
  );
  for (const j of neighbors(g, i)) {
    if (g.channels.water.get(j) !== 0) continue;
    fog.set(j, Math.max(fog.get(j), forcing * system.effects.fog));
    const ward = clamp((g.channels["magic:hallowed:intensity"]?.get(j) ?? 0) / 1000),
      retreat = forcing * system.effects.coastalForcing * (1 - ward);
    g.channels.elevation.add(j, -retreat);
  }
}
